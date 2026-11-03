// Firebase의 측정기 기록을 사내 저장소로 옮기려고 한 파일(NDJSON)로 뜬다(2026-11-03). 읽기만 한다.
// 실행(회사 PC): node scripts/pingMonitor/store/exportFirestore.mjs → .local-tools/ping-store-export.ndjson
// 날짜(Timestamp)는 {"__ts": ISO}로 바꾼다 — 사내 저장소가 같은 모양으로 담는다.
// 전환 직전에 한 번 더 떠서 다시 들여온다(그 사이 Firebase에 쌓인 회차까지).
import { createWriteStream, mkdirSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

process.loadEnvFile(new URL("../../../.env.local", import.meta.url));
initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/g, "\n") }) });
const db = getFirestore();

const plain = (v) => {
  if (v instanceof Timestamp) return { __ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};

mkdirSync(".local-tools", { recursive: true });
const out = createWriteStream(".local-tools/ping-store-export.ndjson");
const counts = {};
for (const c of ["pingMonitorStores", "pingMonitorDaily", "pingMonitorDeleted"]) {
  const snap = await db.collection(c).get();
  for (const d of snap.docs) out.write(JSON.stringify({ c, id: d.id, data: plain(d.data()) }) + "\n");
  counts[c] = snap.size;
}
const status = await db.collection("storeEvalSystemStatus").doc("pingMonitor").get();
if (status.exists) {
  out.write(JSON.stringify({ c: "storeEvalSystemStatus", id: "pingMonitor", data: plain(status.data()) }) + "\n");
  counts.status = 1;
}
await new Promise((r) => out.end(r));
console.log(JSON.stringify(counts));
