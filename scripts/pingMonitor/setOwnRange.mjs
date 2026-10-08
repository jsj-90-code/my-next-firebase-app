// 우리 매장 측정 범위를 회신 범위 그대로 고친다(문서 그대로, 범위·대수만) — 2026-10-08 reRangeOwn(앞 10개 빼기)을 잘못 적용한 걸 되돌릴 때.
// 비엠비·현주 회신은 손님 PC 대역이었다(10-07 단톡 속도제한 대역과 같고 25곳 중 23곳이 PC 대수와 ±1). 앞 10개 빼기는 회선 전체 대역(.1·.129 시작)에만.
//   node scripts/pingMonitor/setOwnRange.mjs --file=.local-tools/xxx.json [--apply]   파일 모양은 reRangeOwn과 같다.
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
if (!FILE) throw new Error("--file= 이 필요합니다");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/g, "\n") }) });
const db = getFirestore();
const { vendor, rows } = JSON.parse(readFileSync(FILE, "utf8"));
const own = (await db.collection("pingMonitorStores").where("isOwnStore", "==", true).get()).docs.filter((d) => d.get("active") !== false);
for (const [prefix, reply] of rows) {
  const m = String(reply).match(/^(\d+\.\d+\.\d+)\.(\d+)\s*[-~]\s*(\d+)$/);
  const hits = own.filter((d) => String(d.get("ownName")).startsWith(prefix));
  if (!m || hits.length !== 1) throw new Error(`${prefix}: 형식 또는 문서 ${hits.length}개`);
  const range = `${m[1]}.${m[2]}~${m[3]}`, count = Number(m[3]) - Number(m[2]) + 1;
  console.log(`${hits[0].get("ownName")} | ${hits[0].get("ipRanges")} → ${range}(${count}대)`);
  if (APPLY && hits[0].get("ipRanges") !== range)
    await hits[0].ref.update({ ipRanges: range, ipCount: count, pcCount: count, memo: `우리 매장 · 노하드(${vendor}) 회신 2026-10-08 ${reply} = 손님 PC 대역 그대로`, updatedAt: FieldValue.serverTimestamp(), updatedBy: "script:setOwnRange" });
}
console.log(APPLY ? "고쳤다." : "(미리보기 — --apply로 쓴다)");
process.exit(0);
