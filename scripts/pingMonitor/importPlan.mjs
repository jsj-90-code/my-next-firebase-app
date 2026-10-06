// 경쟁점 가동률 측정기 일괄 등록(2026-10-06). sheetPlan.mjs가 만든 .local-tools/ping-sheet-plan.json의 register를
// pingMonitorStores에 넣는다. 같은 IP대역이 이미 있으면 건너뛴다(화면에서 먼저 넣은 것과 겹치지 않게).
//   node scripts/pingMonitor/importPlan.mjs            ← 미리보기
//   node scripts/pingMonitor/importPlan.mjs --apply    ← 쓰기
// 다른 계획 파일: --file=.local-tools/xxx.json (다우오피스 보충 때)
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? ".local-tools/ping-sheet-plan.json";

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!clientEmail || !privateKey || !projectId) { console.error(".env.local에 Firebase 관리자 값이 필요하다."); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const ipCount = (range) => range.split(/[,\n]/).reduce((s, r) => {
  const [a, b] = r.trim().split("~");
  return s + (b ? Number(b) - Number(a.split(".").at(-1)) + 1 : 1);
}, 0);
const key = (s) => String(s).replace(/\s/g, "");

const { register } = JSON.parse(readFileSync(FILE, "utf8"));
const existing = await db.collection("pingMonitorStores").get();
const have = new Set(existing.docs.map((d) => key(d.get("ipRanges"))));

const todo = register.filter((r) => !have.has(key(r.ipRanges)));
console.log(`계획 ${register.length} · 이미 있음 ${register.length - todo.length} · 새로 ${todo.length}`);
for (const r of todo.slice(0, 8)) console.log(`  ${r.ownName} · ${r.name} · ${r.ipRanges} · ${r.pcCount ?? "-"}대 · ${r.distanceM ?? "-"}m`);
if (!APPLY) { console.log("(미리보기 — --apply로 쓴다)"); process.exit(0); }

let batch = db.batch();
let n = 0;
for (const r of todo) {
  batch.set(db.collection("pingMonitorStores").doc(), {
    name: r.name,
    address: r.address ?? "",
    ipRanges: r.ipRanges,
    ipCount: ipCount(r.ipRanges),
    pcCount: r.pcCount ?? null,
    memo: r.memo ?? "",
    active: true,
    ownCode: r.ownCode,
    ownName: r.ownName,
    competitorId: r.competitorId ?? null,
    distanceM: r.distanceM ?? null,
    ...(r.isOwnStore ? { isOwnStore: true } : {}), // 우리 매장 자체(2026-10-06)
    createdAt: FieldValue.serverTimestamp(),
    createdBy: "import:" + FILE.split("/").at(-1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: null,
  });
  if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
}
await batch.commit();
console.log(`${n}곳 썼다.`);
