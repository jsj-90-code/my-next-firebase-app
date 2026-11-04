// 게토 연동 자료 받는 프로그램 (측정 서버 192.168.0.17에서 돈다)
//
// 규격: docs/getto-receiver-spec.md (2026-11-04 게토 회신에 맞춘 수신서버 기능명세)
//   매장 카운터 PC(initiator) → 이 서버(responder), TCP, Noise_XK_25519_ChaChaPoly_SHA256
//   서버 키로 개발/운영을 가른다(같은 포트). 매장은 1회용 등록토큰으로 자기 키를 묶는다.
//   자료 하나마다 ACK. 같은 (매장, 종류, 집계 시작~종료)는 revision이 같거나 크면 덮어쓴다.
//
// 기록 위치 (GETTO_INBOX_DIR, 기본 ~/getto-inbox):
//   events/YYYY-MM-DD.jsonl                        접속·인증·수신·오류 (env 공통)
//   <env>/received/YYYY-MM-DD/<매장>_<msgId>.json   받은 메시지 원문 전부(재전송분 포함)
//   <env>/current/<매장>/<종류>/<시작>__<끝>.json    최신값(중복 덮어쓴 결과)
// 키·매장 등록부: registry.mjs (GETTO_KEYS_DIR, 기본 ~/getto-receiver/keys) — 관리: keys.mjs
//
// 실행: node receiver.mjs   (포트 GETTO_INBOX_PORT, 기본 19000)
// 이미 떠 있으면 포트가 겹쳐 조용히 끝난다 — start.sh가 5분마다 불러도 하나만 돈다.

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { XKHandshake, FrameReader, frame } from "./noise.mjs";
import { PROLOGUE, AppAssembler, AppError, encodeApp, validateData } from "./protocol.mjs";
import { loadServerKeys, authenticate } from "./registry.mjs";

const PORT = Number(process.env.GETTO_INBOX_PORT || 19000);
const DIR = process.env.GETTO_INBOX_DIR || path.join(os.homedir(), "getto-inbox");
const MAX_CONNECTIONS = 1000;
const MAX_CONN_PER_STORE = 5;
const MAX_BYTES_PER_STORE_PER_DAY = 500 * 1024 * 1024;
const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 15 * 60_000;
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 20; // 같은 IP가 10분에 20번 인증 실패하면
const BLOCK_MS = 60 * 60_000; // 1시간 막는다
const PREVIEW_BYTES = 64;

fs.mkdirSync(path.join(DIR, "events"), { recursive: true });

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 23);
  return `${local}${sign}${p(off / 60)}:${p(off % 60)}`;
}

function logEvent(ev) {
  try {
    fs.appendFileSync(path.join(DIR, "events", `${today()}.jsonl`), JSON.stringify({ t: nowIso(), ...ev }) + "\n");
  } catch (e) {
    console.error("event log failed:", e.message);
  }
}

function diskHasRoom() {
  try {
    const s = fs.statfsSync(DIR);
    return s.bavail * s.bsize > MIN_FREE_BYTES;
  } catch {
    return true;
  }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9_.+-]/g, "-").slice(0, 80);

// ── 실패 IP 막기 ─────────────────────────────────────────────
const fails = new Map();
function ipBlocked(ip) {
  const f = fails.get(ip);
  return f && f.blockedUntil > Date.now();
}
function noteFail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || now - f.start > FAIL_WINDOW_MS) f = { start: now, n: 0, blockedUntil: 0 };
  f.n++;
  if (f.n >= FAIL_LIMIT) {
    f.blockedUntil = now + BLOCK_MS;
    logEvent({ ev: "ip_blocked", ip, minutes: BLOCK_MS / 60000 });
  }
  fails.set(ip, f);
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of fails) if (now - f.start > FAIL_WINDOW_MS && f.blockedUntil < now) fails.delete(ip);
}, 60_000).unref();

// ── 매장별 사용량 ─────────────────────────────────────────────
const storeConns = new Map(); // `${env}/${storeId}` → 열린 연결 수
const storeBytes = new Map(); // `${day}/${env}/${storeId}` → 바이트

// ── 자료 저장 + 중복 처리 ─────────────────────────────────────
/** 반환: "stored" | "unchanged" | "superseded" */
export function storeData(dir, env, m, body) {
  // 같은 내용인지는 payload로 본다(재전송은 msgId·generatedAt이 달라도 같은 자료)
  const sha = crypto.createHash("sha256").update(JSON.stringify(m.payload)).digest("hex");
  const revision = m.revision ?? 0;
  const receivedAt = nowIso();

  // 1. 받은 원문은 전부 남긴다
  writeAtomic(path.join(dir, env, "received", today(), `${safe(m.storeId)}_${safe(m.msgId)}.json`), body);

  // 2. 최신값
  const cur = path.join(dir, env, "current", safe(m.storeId), safe(m.kind), `${safe(m.periodStart)}__${safe(m.periodEnd)}.json`);
  if (fs.existsSync(cur)) {
    const old = JSON.parse(fs.readFileSync(cur, "utf8"));
    if (old.revision > revision) return { status: "superseded", sha, revision: old.revision };
    if (old.revision === revision && old.sha256 === sha) return { status: "unchanged", sha, revision };
  }
  writeAtomic(cur, JSON.stringify({ receivedAt, revision, sha256: sha, msgId: m.msgId, message: m }) + "\n");
  return { status: "stored", sha, revision };
}

// ── 연결 처리 ────────────────────────────────────────────────
let seq = 0;
let open = 0;

function handleConnection(socket) {
  const id = `${Date.now()}-${++seq}`;
  const ip = socket.remoteAddress || "?";
  const remote = `${ip}:${socket.remotePort}`;
  open++;

  if (open > MAX_CONNECTIONS || ipBlocked(ip)) {
    logEvent({ ev: open > MAX_CONNECTIONS ? "reject_too_many" : "reject_blocked_ip", id, remote });
    open--;
    socket.destroy();
    return;
  }

  socket.setKeepAlive(true, 60_000);
  socket.setNoDelay(true);
  logEvent({ ev: "connect", id, remote, open });

  const reader = new FrameReader();
  const assembler = new AppAssembler();
  let hs = null; // XKHandshake
  let env = null;
  let keySlot = null;
  let transport = null; // { send, recv }
  let storeId = null;
  let storeKey = null;
  let firstBytes = Buffer.alloc(0);
  let stats = { frames: 0, messages: 0, stored: 0 };
  let closed = false;

  const hsTimer = setTimeout(() => {
    if (!storeId) {
      logEvent({ ev: "handshake_timeout", id, remote });
      noteFail(ip);
      socket.destroy();
    }
  }, HANDSHAKE_TIMEOUT_MS);

  socket.setTimeout(IDLE_TIMEOUT_MS, () => {
    logEvent({ ev: "idle_close", id, remote, storeId });
    socket.end();
  });

  const send = (obj) => {
    if (!closed && transport) socket.write(encodeApp(transport.send, obj));
  };

  const fail = (code, message, extra = {}) => {
    logEvent({ ev: "fail", id, remote, env, storeId, code, message, ...extra });
    if (!storeId) noteFail(ip);
    if (transport) send({ type: "error", code, message, retryable: false });
    socket.end();
    setTimeout(() => socket.destroy(), 2000).unref();
  };

  function onFrame(msg) {
    stats.frames++;

    // 1번째 메시지: 서버 키(운영·운영 다음·개발·개발 다음)를 차례로 대 본다
    if (!hs) {
      for (const k of loadServerKeys()) {
        const tryHs = new XKHandshake({ initiator: false, s: k.priv, prologue: PROLOGUE });
        try {
          tryHs.readMessage(msg);
          hs = tryHs;
          env = k.env;
          keySlot = k.slot;
          break;
        } catch {
          /* 다음 키 */
        }
      }
      if (!hs) {
        return fail("E_HANDSHAKE", "첫 메시지를 어느 서버 키로도 풀 수 없음(공개키·프롤로그·프로토콜 이름 확인)", {
          preview: firstBytes.subarray(0, PREVIEW_BYTES).toString("hex"),
        });
      }
      socket.write(frame(hs.writeMessage()));
      return;
    }

    // 3번째 메시지: 매장 고정키 + hello
    if (!transport) {
      let hello;
      try {
        const payload = hs.readMessage(msg);
        hello = JSON.parse(payload.toString("utf8"));
      } catch (e) {
        return fail("E_HANDSHAKE", `세 번째 메시지 실패: ${e.message}`);
      }
      transport = hs.split();
      clearTimeout(hsTimer);
      const clientPub = hs.remoteStatic;
      if (!hello || hello.type !== "hello") return fail("E_FORMAT", "세 번째 메시지 payload는 hello JSON이어야 함");

      const a = authenticate(env, hello.storeId, hello.enrollToken, clientPub);
      if (!a.ok) {
        noteFail(ip);
        return fail(a.code, a.message, { claimedStore: String(hello.storeId).slice(0, 64) });
      }
      storeId = hello.storeId;
      storeKey = `${env}/${storeId}`;
      const n = (storeConns.get(storeKey) || 0) + 1;
      storeConns.set(storeKey, n);
      if (n > MAX_CONN_PER_STORE) return fail("E_TOO_MANY", `매장당 동시 연결 ${MAX_CONN_PER_STORE}개까지`);

      logEvent({
        ev: "auth_ok",
        id,
        remote,
        env,
        keySlot,
        storeId,
        newlyBound: a.bound,
        client: hello.client ?? null,
        schemaVersion: hello.schemaVersion ?? null,
      });
      send({ type: "welcome", env, storeId, serverTime: nowIso(), schemaVersion: "1", keySlot });
      return;
    }

    // 전송 단계
    let plain;
    try {
      plain = transport.recv.decryptWithAd(Buffer.alloc(0), msg);
    } catch {
      return fail("E_DECRYPT", "전송 메시지 복호화 실패(연결 끊고 다시 접속)");
    }
    let got;
    try {
      got = assembler.push(plain);
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === "E_FORMAT" && e.body) {
          send({ type: "ack", msgId: null, ok: false, code: e.code, message: e.message, retryable: false });
          logEvent({ ev: "bad_json", id, storeId, env, bytes: e.body.length });
          return;
        }
        return fail(e.code, e.message);
      }
      throw e;
    }
    if (!got) return;
    onApp(got.obj, got.body);
  }

  function onApp(m, body) {
    stats.messages++;
    if (m.type === "ping") return send({ type: "pong", serverTime: nowIso() });
    if (m.type !== "data") {
      return send({ type: "ack", msgId: m.msgId ?? null, ok: false, code: "E_FORMAT", message: `모르는 type: ${m.type}`, retryable: false });
    }
    const msgId = typeof m.msgId === "string" ? m.msgId : null;
    try {
      validateData(m, storeId);
    } catch (e) {
      logEvent({ ev: "reject", id, env, storeId, msgId, code: e.code, message: e.message });
      return send({ type: "ack", msgId, ok: false, code: e.code, message: e.message, retryable: false });
    }

    const dayKey = `${today()}/${storeKey}`;
    const used = (storeBytes.get(dayKey) || 0) + body.length;
    storeBytes.set(dayKey, used);
    if (used > MAX_BYTES_PER_STORE_PER_DAY) {
      logEvent({ ev: "reject", id, env, storeId, msgId, code: "E_QUOTA" });
      return send({ type: "ack", msgId, ok: false, code: "E_QUOTA", message: "매장 하루 용량 초과 — 다음 날 재전송", retryable: true });
    }
    if (!diskHasRoom()) {
      logEvent({ ev: "reject", id, env, storeId, msgId, code: "E_SERVER" , message: "disk"});
      return send({ type: "ack", msgId, ok: false, code: "E_SERVER", message: "서버 저장 공간 부족 — 나중에 재전송", retryable: true });
    }

    try {
      const r = storeData(DIR, env, m, body);
      stats.stored++;
      logEvent({ ev: "data", id, env, storeId, msgId, kind: m.kind, periodStart: m.periodStart, periodEnd: m.periodEnd, revision: r.revision, status: r.status, bytes: body.length });
      send({ type: "ack", msgId, ok: true, status: r.status, revision: r.revision, sha256: r.sha });
    } catch (e) {
      logEvent({ ev: "write_failed", id, env, storeId, msgId, err: e.message });
      send({ type: "ack", msgId, ok: false, code: "E_SERVER", message: "서버 저장 실패 — 나중에 재전송", retryable: true });
    }
  }

  socket.on("data", (buf) => {
    if (firstBytes.length < PREVIEW_BYTES) firstBytes = Buffer.concat([firstBytes, buf.subarray(0, PREVIEW_BYTES)]);
    let frames;
    try {
      frames = reader.push(buf);
    } catch (e) {
      return fail("E_FORMAT", e.message);
    }
    for (const f of frames) {
      if (closed) return;
      try {
        onFrame(f);
      } catch (e) {
        logEvent({ ev: "internal_error", id, err: e.message });
        socket.destroy();
        return;
      }
    }
    if (!transport && reader.pending > 70_000) fail("E_FORMAT", "프레임 길이 이상");
  });

  socket.on("error", (e) => logEvent({ ev: "error", id, remote, err: e.code || e.message }));

  socket.on("close", () => {
    closed = true;
    clearTimeout(hsTimer);
    open--;
    if (storeKey) storeConns.set(storeKey, Math.max(0, (storeConns.get(storeKey) || 1) - 1));
    logEvent({ ev: "close", id, remote, env, storeId, ...stats, open });
  });
}

// 테스트(receiver.test.mjs)에서 불러 쓸 때는 서버를 띄우지 않는다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = loadServerKeys();
  if (!keys.length) console.error("경고: 서버 키 없음 — node keys.mjs init prod 로 만드세요(모든 접속이 거절됨)");

  const server = net.createServer(handleConnection);
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") process.exit(0); // 이미 다른 하나가 받고 있다 — 정상
    console.error("server error:", e);
    process.exit(1);
  });
  server.listen(PORT, "0.0.0.0", () => {
    logEvent({ ev: "start", port: PORT, pid: process.pid, keys: keys.map((k) => `${k.env}/${k.slot}`) });
    console.log(`getto inbox listening on ${PORT}, keys: ${keys.map((k) => `${k.env}/${k.slot}`).join(", ") || "(none)"}, dir ${DIR}`);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      logEvent({ ev: "stop", sig });
      process.exit(0);
    });
  }
}

export { handleConnection };
