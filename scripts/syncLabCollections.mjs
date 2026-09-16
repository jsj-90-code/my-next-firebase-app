// 운영 컬렉션 -> 실험실 전용 복제본. **명시적으로 부를 때만 돈다. 자동 동기화가 아니다.**
//
//   node scripts/syncLabCollections.mjs           # 미리보기(쓰지 않는다)
//   node scripts/syncLabCollections.mjs --apply   # 실제로 복사한다
//   node scripts/syncLabCollections.mjs --apply --only=existingStores,competitors
//
// ── 왜 복제하나 (2026-09-16 사용자 방향) ───────────────────────────────────
// 교과서식 실험실이 운영 V62와 **같은 문서를 읽고 있었다.** 그래서 실험용으로 기초자료를
// 고치면 운영 예측이 조용히 따라 움직였다 — 2026-09-15 유동·주거인구 교체로 V62 MAPE가
// 9.37% -> 9.26%로 같이 변한 게 그 예다. 개선이라 다행이었지 의도한 게 아니었다.
// 시설·사양까지 실험실에서 고칠 참이라 여기서 갈라놓는다.
//
// ⚠️ **덮어쓰기 방향은 운영 -> 실험실 한 방향뿐이다.** 반대는 없다. 실험실에서 고친 값이
//    운영으로 새는 경로를 아예 만들지 않는다.
//
// ⚠️ 이걸 돌리면 **실험실에서 고쳐둔 값이 날아간다.** 그래서 기본이 미리보기이고,
//    실험실 쪽에 이미 문서가 있으면 몇 건이 덮이는지 먼저 센다.
//
// ⚠️ 월매출은 복제하지 않는다. 실측 사실이라 실험실에서 고칠 일이 없고, 두 벌로 두면
//    "어느 쪽 실적이 맞나"라는 없던 문제가 생긴다. 실험실도 운영 월매출을 그대로 읽는다.

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const PAIRS = [
  { key: "existingStores", from: "storeEvalExistingStores", to: "storeEvalLabExistingStores" },
  { key: "candidates", from: "storeEvalCandidates", to: "storeEvalLabCandidates" },
  { key: "competitors", from: "storeEvalCompetitors", to: "storeEvalLabCompetitors" },
  { key: "locationEvaluations", from: "storeEvalLocationEvaluations", to: "storeEvalLabLocationEvaluations" },
  { key: "settings", from: "storeEvalSettings", to: "storeEvalLabSettings" },
];

const APPLY = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean) : null;

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = v;
  }
}
loadEnvLocal();

const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_* 환경변수가 .env.local에 필요하다.");
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const targets = only ? PAIRS.filter((p) => only.includes(p.key)) : PAIRS;
if (only && targets.length !== only.length) {
  console.error(`--only에 모르는 이름이 있다. 쓸 수 있는 값: ${PAIRS.map((p) => p.key).join(", ")}`);
  process.exit(1);
}

let totalWrite = 0;
let totalOverwrite = 0;
const plans = [];

for (const pair of targets) {
  const src = await loadCollectionMap(db, pair.from);
  const dst = await loadCollectionMap(db, pair.to);
  const writes = [];
  let overwrite = 0;
  for (const [id, data] of src) {
    const before = dst.get(id);
    if (before) overwrite++;
    // 값이 그대로면 쓰지 않는다 — 재실행 비용을 0에 가깝게 유지한다(diffWrite 관행).
    if (!needsWrite(before, data, { merge: false })) continue;
    writes.push({ id, data });
  }
  const orphan = [...dst.keys()].filter((id) => !src.has(id));
  plans.push({ ...pair, srcCount: src.size, dstCount: dst.size, writes, overwrite, orphan });
  totalWrite += writes.length;
  totalOverwrite += overwrite;
  console.log(
    `${pair.key.padEnd(20)} 운영 ${String(src.size).padStart(4)}건 -> 실험실 ${String(dst.size).padStart(4)}건 · ` +
    `쓸 것 ${String(writes.length).padStart(4)}건 (그중 덮어쓰기 ${overwrite}건)` +
    (orphan.length ? ` · 운영에 없는 실험실 문서 ${orphan.length}건(그대로 둔다)` : ""),
  );
}

console.log(`\n합계 ${totalWrite}건 쓴다. 실험실 쪽 기존 문서 ${totalOverwrite}건이 복사 대상이다.`);
if (totalOverwrite > 0) {
  console.log("⚠️ 실험실에서 고쳐둔 값이 있었다면 이 실행으로 운영값에 덮인다. 한 방향(운영->실험실)뿐이다.");
}

if (!APPLY) {
  console.log("\n미리보기다. 실제로 복사하려면 --apply 를 붙인다.");
  process.exit(0);
}

let written = 0;
for (const p of plans) {
  for (const w of p.writes) {
    await db.collection(p.to).doc(w.id).set(w.data);
    written++;
  }
}
console.log(`\n${written}건 복사했다. 실험실 화면이 이제 이 복제본을 읽는다.`);
console.log("운영 V62는 기존 컬렉션 그대로라 아무 영향이 없다.");
process.exit(0);
