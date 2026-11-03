// 경쟁점 가동률 측정기 — 사내 서버 저장소(2026-11-03, Firebase에서 옮기는 중).
//
// 왜: 측정·저장을 사내 서버로 옮긴다(정식 운영 품의 5절). Firebase 문서 모양을 그대로 담아 웹 코드를 적게 바꾼다.
// 무엇: SQLite 파일 하나(~/ping-store/store.db)에 컬렉션·문서 ID·JSON. 날짜(Timestamp)는 {"__ts": ISO 문자열}.
// 누가 부르나: 웹 서버(Vercel)만 — 요청마다 비밀 열쇠로 서명(HMAC)한다. 열쇠는 전송되지 않는다.
//   서명 = HMAC-SHA256(열쇠, `${x-ts}\n${경로}\n${본문}`), 시각 차이 5분 넘으면 거절.
// 열쇠 파일: ~/ping-store/secret (권한 600). 웹 쪽 환경변수 PING_STORE_SECRET과 같아야 한다.
// 암호화(2026-11-03): 공유기 포트로 인터넷을 지나가는데 HTTPS가 아니라서, 요청·응답 본문을 같은 열쇠로 AES-256-GCM 암호화한다
//   (경쟁점 IP 목록 등이 그대로 보이지 않게). 본문 = {"iv","ct","tag"}(base64). 서명은 암호문 위에. 오류 응답({error})만 평문.
//
// 창구(전부 POST JSON, /health만 GET·서명 없음):
//   /v1/get    {c, id}                         → {doc: {...}|null}
//   /v1/list   {c, where?, idFrom?, idTo?}     → {docs: [{id, data}]}   where: [[필드(점으로 깊이), "=="|"in"|">="|"<"|"<=", 값]]
//   /v1/getMany {c, ids}                       → {docs: {[id]: {...}|null}}  (한 시간 기록 때 그날 문서 300여 개를 한 번에)
//   /v1/add    {c, data}                       → {id}
//   /v1/commit {writes: [...]}                 → {ok}  한 묶음은 전부 되거나 전부 안 된다.
//     write = {op: "set", c, id, data}          통째로 바꿈
//           | {op: "merge", c, id, data}        깊게 합침(Firestore set merge:true). 값 {"__inc": n}=더하기, {"__del": true}=칸 지우기
//           | {op: "update", c, id, data}       키가 점 경로("hours.13"). 문서가 없으면 묶음 전체 실패(Firestore updateDoc과 같다)
//           | {op: "delete", c, id}
// 측정 결과 기록(recordRound)은 다음 단계에서 이 서버 안으로 옮긴다.
import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const HOME = process.env.HOME;
const DB_PATH = process.env.PING_STORE_DB ?? `${HOME}/ping-store/store.db`;
const PORT = Number(process.env.PING_STORE_PORT ?? 19100);
let SECRET = null; // serve()가 읽는다 — 테스트는 열쇠 없이 makeStore만 쓴다.
const MAX_SKEW_MS = 5 * 60_000;
const MAX_BODY = 8 * 1024 * 1024;

export function openDb(path = DB_PATH) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS docs (c TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (c, id)) WITHOUT ROWID;`);
  return db;
}

// ---------- 문서 다루기(테스트가 직접 부른다) ----------
const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v) && !("__ts" in v) && !("__inc" in v) && !("__del" in v);

function applyMerge(target, patch) {
  const out = { ...(target ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && v.__del === true) delete out[k];
    else if (v && typeof v === "object" && "__inc" in v) out[k] = (typeof out[k] === "number" ? out[k] : 0) + Number(v.__inc);
    else if (isPlain(v)) out[k] = applyMerge(isPlain(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

function applyUpdate(target, patch) {
  let out = { ...target };
  for (const [path, v] of Object.entries(patch)) {
    const keys = path.split(".");
    // 점 경로를 깊은 객체로 펴서 합친다. 맨 끝 값이 객체면 통째로 바꾼다(Firestore updateDoc과 같다).
    const leaf = v && typeof v === "object" && (v.__del === true || "__inc" in v) ? v : isPlain(v) ? { __replace: v } : v;
    const nested = keys.reduceRight((acc, key) => ({ [key]: acc }), leaf);
    out = applyMergeReplacing(out, nested);
  }
  return out;
}
function applyMergeReplacing(target, patch) {
  const out = { ...(target ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && "__replace" in v) out[k] = v.__replace;
    else if (v && typeof v === "object" && v.__del === true) delete out[k];
    else if (v && typeof v === "object" && "__inc" in v) out[k] = (typeof out[k] === "number" ? out[k] : 0) + Number(v.__inc);
    else if (isPlain(v)) out[k] = applyMergeReplacing(isPlain(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const cmpVal = (v) => (v && typeof v === "object" && "__ts" in v ? v.__ts : v);
function matches(data, where) {
  return where.every(([field, op, value]) => {
    const got = cmpVal(getPath(data, field));
    const want = cmpVal(value);
    if (op === "==") return got === want;
    if (op === "in") return Array.isArray(value) && value.map(cmpVal).includes(got);
    if (got == null) return false;
    if (op === ">=") return got >= want;
    if (op === "<") return got < want;
    if (op === "<=") return got <= want;
    if (op === ">") return got > want;
    throw new Error(`모르는 비교: ${op}`);
  });
}

export function makeStore(db) {
  const getStmt = db.prepare("SELECT data FROM docs WHERE c = ? AND id = ?");
  const putStmt = db.prepare("INSERT INTO docs (c, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (c, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at");
  const delStmt = db.prepare("DELETE FROM docs WHERE c = ? AND id = ?");
  const listStmt = db.prepare("SELECT id, data FROM docs WHERE c = ? ORDER BY id");
  const rangeStmt = db.prepare("SELECT id, data FROM docs WHERE c = ? AND id >= ? AND id < ? ORDER BY id");
  const read = (c, id) => {
    const row = getStmt.get(c, id);
    return row ? JSON.parse(row.data) : null;
  };
  const put = (c, id, data) => putStmt.run(c, id, JSON.stringify(data), new Date().toISOString());
  return {
    get: (c, id) => read(c, id),
    getMany: (c, ids) => Object.fromEntries(ids.map((id) => [id, read(c, String(id))])),
    list({ c, where = [], idFrom, idTo }) {
      const rows = idFrom != null ? rangeStmt.all(c, idFrom, idTo ?? "￿") : listStmt.all(c);
      return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) })).filter((d) => matches(d.data, where));
    },
    add(c, data) {
      const id = randomBytes(15).toString("base64url").slice(0, 20);
      put(c, id, data);
      return id;
    },
    commit(writes) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const w of writes) {
          if (!w || typeof w.c !== "string" || typeof w.id !== "string" || !w.id) throw new Error("c·id가 없습니다");
          if (w.op === "set") put(w.c, w.id, w.data ?? {});
          else if (w.op === "merge") put(w.c, w.id, applyMerge(read(w.c, w.id), w.data ?? {}));
          else if (w.op === "update") {
            const cur = read(w.c, w.id);
            if (!cur) throw new Error(`없는 문서: ${w.c}/${w.id}`);
            put(w.c, w.id, applyUpdate(cur, w.data ?? {}));
          } else if (w.op === "delete") delStmt.run(w.c, w.id);
          else throw new Error(`모르는 쓰기: ${w.op}`);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    replaceAll(docs) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DELETE FROM docs");
        for (const d of docs) put(d.c, d.id, d.data);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// ---------- 암호화 ----------
const encKey = (secret) => createHash("sha256").update(`ping-store-enc
${secret}`).digest();
export function seal(secret, obj) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") });
}
export function unseal(secret, text) {
  const { iv, ct, tag } = JSON.parse(text);
  const d = createDecipheriv("aes-256-gcm", encKey(secret), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"));
}

// ---------- 서명 ----------
export function sign(secret, ts, path, body) {
  return createHmac("sha256", secret).update(`${ts}\n${path}\n${body}`).digest("hex");
}
function verify(req, path, body) {
  const ts = Number(req.headers["x-ts"]);
  const sig = String(req.headers["x-sig"] ?? "");
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return "시각이 맞지 않습니다";
  const want = Buffer.from(sign(SECRET, ts, path, body), "hex");
  const got = Buffer.from(sig, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return "서명이 틀립니다";
  return null;
}

// ---------- HTTP ----------
function serve() {
  SECRET = readFileSync(process.env.PING_STORE_SECRET_FILE ?? `${HOME}/ping-store/secret`, "utf8").trim();
  if (SECRET.length < 32) throw new Error("열쇠가 너무 짧습니다");
  const store = makeStore(openDb());
  const handlers = {
    "/v1/get": (b) => ({ doc: store.get(b.c, b.id) }),
    "/v1/list": (b) => ({ docs: store.list(b) }),
    "/v1/getMany": (b) => ({ docs: store.getMany(b.c, Array.isArray(b.ids) ? b.ids.slice(0, 5000) : []) }),
    "/v1/add": (b) => ({ id: store.add(b.c, b.data ?? {}) }),
    "/v1/commit": (b) => (store.commit(Array.isArray(b.writes) ? b.writes : []), { ok: true }),
  };
  const server = createServer((req, res) => {
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/health") return send(200, { ok: true });
    const handler = handlers[path];
    if (req.method !== "POST" || !handler) return send(404, { error: "없는 창구" });
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const denied = verify(req, path, body);
      if (denied) return send(401, { error: denied });
      try {
        const out = seal(SECRET, handler(unseal(SECRET, body)));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(out);
      } catch (error) {
        send(400, { error: String(error?.message ?? error) });
      }
    });
  });
  server.on("error", (error) => {
    // 이미 떠 있으면(포트 겹침) 조용히 끝낸다 — start.sh가 5분마다 불러도 둘이 돌지 않게.
    if (error.code === "EADDRINUSE") process.exit(0);
    throw error;
  });
  server.listen(PORT, "0.0.0.0", () => console.log(`${new Date().toISOString()} ping-store 시작 :${PORT} ${DB_PATH}`));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) serve();
