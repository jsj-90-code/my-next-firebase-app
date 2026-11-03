// 관리용 스크립트가 사내 저장소를 읽고 쓰는 도우미(2026-11-03). 웹 쪽 src/lib/pingMonitor/internalStore.ts와 같은 규약
// (요청마다 HMAC 서명 + 본문 AES-256-GCM, 날짜 {"__ts"} ↔ Date).
// 쓰는 법:
//   import { istore } from "./store/client.mjs";   // scripts/pingMonitor/ 아래 스크립트에서
//   const stores = await istore.list("pingMonitorStores");      // [{id, data}]
// 환경변수: PING_STORE_URL(회사 안에선 http://192.168.0.17:19100), PING_STORE_SECRET — .env.local에 넣는다(값은 사내 서버 ~/ping-store/secret).
// 전환(2026-11-04 예정) 뒤엔 Firebase의 pingMonitorStores·pingMonitorDaily가 더 이상 안 바뀐다 — 옛 스크립트가 Firebase를 읽으면 낡은 값.
import { createHmac } from "node:crypto";
import { seal, unseal } from "./server.mjs";

function encode(v) {
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    if (typeof v.__ts === "string" && Object.keys(v).length === 1) return new Date(v.__ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

async function call(path, payload) {
  const base = process.env.PING_STORE_URL;
  const secret = process.env.PING_STORE_SECRET;
  if (!base || !secret) throw new Error("PING_STORE_URL·PING_STORE_SECRET이 없습니다(.env.local)");
  const body = seal(secret, encode(payload));
  const ts = Date.now();
  const sig = createHmac("sha256", secret).update(`${ts}\n${path}\n${body}`).digest("hex");
  const res = await fetch(base.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": "application/json", "x-ts": String(ts), "x-sig": sig }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`사내 저장소 ${path} 실패(${res.status}): ${text.slice(0, 200)}`);
  return decode(unseal(secret, text));
}

export const istore = {
  get: async (c, id) => (await call("/v1/get", { c, id })).doc,
  getMany: async (c, ids) => (await call("/v1/getMany", { c, ids })).docs,
  list: async (c, opts = {}) => (await call("/v1/list", { c, ...opts })).docs,
  add: async (c, data) => (await call("/v1/add", { c, data })).id,
  commit: async (writes) => call("/v1/commit", { writes }),
};
