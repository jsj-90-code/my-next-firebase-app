// "최근 24시간" 칸(pingMonitorStores.recent) 채우기 — 2026-10-07 recent를 새로 쓰기 시작하면서, 그 전 기록을
// 시간대별 기록(pingMonitorDaily 어제·오늘)에서 옮겨 둔다. 이미 더 새 값이 있는 칸은 건드리지 않는다.
//   node scripts/pingMonitor/backfillRecent.mjs            ← 미리보기
//   node scripts/pingMonitor/backfillRecent.mjs --apply    ← 쓰기
// 읽기: 매장 수 + 매장당 날짜 문서 2개.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();

const now = new Date();
const kstDate = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const today = kstDate(now);
const yesterday = kstDate(new Date(now.getTime() - 86400e3));
// 그 시 측정 시각 — 회차는 정시 무렵에 돈다. 한국 시각 날짜·시 → 실제 시각.
const slotTime = (date, hour) => new Date(`${date}T${hour}:00:00+09:00`);

const stores = (await db.collection("pingMonitorStores").where("active", "==", true).get()).docs;
let touched = 0;
for (const s of stores) {
  const have = s.get("recent") ?? {};
  const best = {};
  for (const date of [yesterday, today]) {
    const d = await db.collection("pingMonitorDaily").doc(`${s.id}_${date}`).get();
    for (const [hour, v] of Object.entries(d.get("hours") ?? {})) {
      const at = slotTime(date, hour);
      if (now - at > 24 * 3600e3 || !(v.t > 0)) continue;
      if (!best[hour] || best[hour].at < at) best[hour] = { a: v.a, t: v.t, at };
    }
  }
  const update = {};
  for (const [hour, v] of Object.entries(best)) {
    const cur = have[hour]?.at?.toDate?.();
    if (cur && cur >= v.at) continue;
    update[`recent.${hour}`] = { a: v.a, t: v.t, at: Timestamp.fromDate(v.at) };
  }
  if (!Object.keys(update).length) continue;
  touched++;
  if (APPLY) await s.ref.update(update);
}
console.log(`매장 ${stores.length}곳 중 ${touched}곳 ${APPLY ? "채움" : "채울 예정(미리보기)"}`);
