// 되돌리기용(2026-11-03) — 전환 뒤 문제가 생겨 Firebase로 돌아갈 때, 사내 저장소에 쌓인 기록을 Firebase에 다시 써 넣는다.
// 전환 시각 이후 바뀐 문서만 쓰면 되지만, 문서마다 바뀐 시각을 모르므로 매장·일별 문서 중 since(YYYY-MM-DD) 이후 날짜가 든 것만 쓴다.
// 실행(회사 PC, .env.local에 PING_STORE_URL·PING_STORE_SECRET 필요):
//   node scripts/pingMonitor/store/backToFirestore.mjs 2026-11-04          → 미리보기(쓰지 않음)
//   node scripts/pingMonitor/store/backToFirestore.mjs 2026-11-04 --write  → Firebase에 씀(매장 문서는 통째로 덮음)
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.loadEnvFile(new URL("../../../.env.local", import.meta.url));
const { istore } = await import("./client.mjs");
const since = process.argv[2];
const write = process.argv.includes("--write");
if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) throw new Error("날짜(YYYY-MM-DD)를 주세요");

initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();

const stores = await istore.list("pingMonitorStores");
const touchedStores = stores.filter((d) => Object.keys(d.data.days ?? {}).some((day) => day >= since) || (d.data.updatedAt instanceof Date && d.data.updatedAt.toISOString().slice(0, 10) >= since));
const dailies = (await istore.list("pingMonitorDaily")).filter((d) => String(d.data.date ?? "") >= since);
console.log(`매장 ${touchedStores.length}/${stores.length} · 일별 ${dailies.length} (${since} 이후)`);
if (!write) process.exit(0);

const all = [...touchedStores.map((d) => ["pingMonitorStores", d]), ...dailies.map((d) => ["pingMonitorDaily", d])];
for (let i = 0; i < all.length; i += 400) {
  const batch = db.batch();
  for (const [c, d] of all.slice(i, i + 400)) batch.set(db.collection(c).doc(d.id), d.data);
  await batch.commit();
}
console.log("Firebase에 씀:", all.length);
