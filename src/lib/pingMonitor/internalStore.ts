import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// 측정기 사내 저장소 창구(2026-11-03) — 사내 서버 ~/ping-store(scripts/pingMonitor/store/server.mjs)를 부른다.
// 켜는 법: PING_STORE_BACKEND=internal + PING_STORE_URL(예: http://주소:19100) + PING_STORE_SECRET(서버 ~/ping-store/secret).
// 꺼져 있으면(기본) 측정기는 예전처럼 Firebase를 쓴다 — 전환은 환경변수만 바꿔 배포(docs/ping-monitor.md 2026-11-03 절).
// 값 모양: 날짜는 Date ↔ {"__ts": ISO}. 쓰기에서 {__inc: n}=더하기, {__del: true}=칸 지우기, {__now: true}=서버 시각.

export const usesInternalStore = () => process.env.PING_STORE_BACKEND === "internal";

export type StoreDoc = { id: string; data: Record<string, unknown> };
export type Where = [string, "==" | "in" | ">=" | "<" | "<=" | ">", unknown];
export type StoreWrite =
  | { op: "set" | "merge" | "update"; c: string; id: string; data: Record<string, unknown> }
  | { op: "delete"; c: string; id: string };

/** 보낼 값: Date → {__ts}, {__now} → 지금 시각. */
export function encodeValue(v: unknown, now = new Date()): unknown {
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (Array.isArray(v)) return v.map((x) => encodeValue(x, now));
  if (v && typeof v === "object") {
    if ((v as { __now?: unknown }).__now === true) return { __ts: now.toISOString() };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeValue(x, now)]));
  }
  return v;
}

/** 받은 값: {__ts} → Date. */
export function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === "object") {
    const ts = (v as { __ts?: unknown }).__ts;
    if (typeof ts === "string" && Object.keys(v).length === 1) return new Date(ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x)]));
  }
  return v;
}

async function call<T>(path: string, payload: unknown): Promise<T> {
  // 환경변수를 파이프로 넣으면 끝에 줄바꿈이 붙을 수 있다 — 서버도 열쇠 파일을 trim해서 쓴다(2026-11-03).
  const secret = process.env.PING_STORE_SECRET?.trim();
  const base = process.env.PING_STORE_URL?.trim();
  if (!base || !secret) throw new Error("사내 저장소 설정(PING_STORE_URL·PING_STORE_SECRET)이 없습니다.");
  const body = seal(secret, payload);
  const ts = Date.now();
  const sig = createHmac("sha256", secret).update(`${ts}\n${path}\n${body}`).digest("hex");
  const res = await fetch(base.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ts": String(ts), "x-sig": sig },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const error = (() => { try { return (JSON.parse(text) as { error?: string }).error ?? ""; } catch { return ""; } })();
    throw new Error(`사내 저장소 ${path} 실패(${res.status}): ${error}`);
  }
  return unseal(secret, text) as T;
}

// 본문 암호화 — scripts/pingMonitor/store/server.mjs의 seal/unseal과 같은 방식(AES-256-GCM, 열쇠에서 뽑은 키).
const encKey = (secret: string) => createHash("sha256").update(`ping-store-enc\n${secret}`).digest();
function seal(secret: string, obj: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") });
}
function unseal(secret: string, text: string): unknown {
  const { iv, ct, tag } = JSON.parse(text) as { iv: string; ct: string; tag: string };
  const d = createDecipheriv("aes-256-gcm", encKey(secret), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"));
}

export const istore = {
  async get(c: string, id: string): Promise<Record<string, unknown> | null> {
    const { doc } = await call<{ doc: Record<string, unknown> | null }>("/v1/get", { c, id });
    return doc ? (decodeValue(doc) as Record<string, unknown>) : null;
  },
  async getMany(c: string, ids: string[]): Promise<Record<string, Record<string, unknown> | null>> {
    if (ids.length === 0) return {};
    const { docs } = await call<{ docs: Record<string, Record<string, unknown> | null> }>("/v1/getMany", { c, ids });
    return decodeValue(docs) as Record<string, Record<string, unknown> | null>;
  },
  async list(c: string, opts: { where?: Where[]; idFrom?: string; idTo?: string } = {}): Promise<StoreDoc[]> {
    const { docs } = await call<{ docs: StoreDoc[] }>("/v1/list", { c, ...opts, where: encodeValue(opts.where ?? []) });
    return docs.map((d) => ({ id: d.id, data: decodeValue(d.data) as Record<string, unknown> }));
  },
  async add(c: string, data: Record<string, unknown>): Promise<string> {
    const { id } = await call<{ id: string }>("/v1/add", { c, data: encodeValue(data) });
    return id;
  },
  async commit(writes: StoreWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const now = new Date();
    await call("/v1/commit", { writes: writes.map((w) => ("data" in w ? { ...w, data: encodeValue(w.data, now) } : w)) });
  },
};
