// 오송점(N016) 입지동선평가 — 선점경쟁 점수 4 -> 2 (2026-09-18 사용자 확정 "3-2-3 이거").
//
//   node scripts/writeOsongPreemptionScore.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeOsongPreemptionScore.mjs --apply
//
// ── 왜 한 칸만인가 ────────────────────────────────────────────────────────
// 권고는 3·2·3이었는데, 상권위치·동선 3과 접근가시성 3은 2026-09-18 07:54Z에 화면에서
// 이미 반영돼 있었다(updatedBy jsj-90@isens.camp). 남은 것이 선점경쟁 하나다.
//
// ── 근거 (인계 2절) ───────────────────────────────────────────────────────
// 채점 규칙이 "경쟁점 개수가 아니라, 그중 하나가 나보다 명백히 좋은 자리를 먹었나"다.
// 오송생명로(oneway=yes · 제한속도 60 = 중앙분리 간선)를 기준으로 재 보면 아파트 54동 중
// 51동과 학교 3곳 전부가 경쟁점(팀플PC) 편이고, 자사는 산업단지 편에 서 있다.
// 층수(경쟁점 4층 vs 자사 지하 1층)보다 어느 편이냐가 크다는 판단이다.
//
// ── 이 스크립트가 안 하는 것 ──────────────────────────────────────────────
// storeEvalResults(저장된 예상매출 스냅샷)는 **안 건드린다.** 그 문서는 후보지 결과 탭이
// evaluateCandidate를 돌려 저장하는 것이라, 여기서 흉내 내면 화면 경로와 갈라진다.
// 쓰고 나면 /store-eval/candidates/N016 결과 탭을 한 번 열어야 대시보드가 맞춰진다.
// (안 열면 storedAccuracyParity 테스트가 계속 실패한다 — 그게 그 테스트의 일이다.)
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const CODE = "N016";
const FIELD = "preemptionScore";
const EXPECTED_NOW = 4;
const NEXT = 2;
const ACTOR = "jsj-90@isens.camp";

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가 .env.local에 필요합니다.");
  process.exit(1);
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);

const apply = process.argv.includes("--apply");
const ref = db.collection("storeEvalLocationEvaluations").doc(CODE);
const snap = await ref.get();

if (!snap.exists) {
  console.error(`storeEvalLocationEvaluations/${CODE} 문서가 없다.`);
  process.exit(1);
}

const before = snap.data();
console.log(`${CODE} ${before.name ?? ""} 입지동선평가 — 지금 값`);
console.log(`  상권위치·동선 locationScore   = ${before.locationScore}`);
console.log(`  선점경쟁     preemptionScore = ${before.preemptionScore}   <- 이 칸만 바꾼다`);
console.log(`  접근가시성    visibilityScore = ${before.visibilityScore}`);
console.log(`  최종수정 ${before.updatedAt ? new Date(before.updatedAt).toISOString() : "-"} (${before.updatedBy ?? "-"})`);

if (before[FIELD] === NEXT) {
  console.log(`\n이미 ${NEXT}다. 쓸 것이 없다.`);
  process.exit(0);
}
if (before[FIELD] !== EXPECTED_NOW) {
  console.error(
    `\n중단한다 — ${FIELD}가 ${EXPECTED_NOW}일 줄 알았는데 ${before[FIELD]}다.` +
      `\n그 사이 누가 바꿨다는 뜻이다. 사람이 확인해야 한다.`,
  );
  process.exit(1);
}

console.log(`\n바꿀 것: ${FIELD} ${before[FIELD]} -> ${NEXT}  (3·${NEXT}·3)`);
console.log("그 밖의 칸은 건드리지 않는다. storeEvalResults도 안 건드린다.");

if (!apply) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply를 붙인다.");
  process.exit(0);
}

await ref.update({ [FIELD]: NEXT, updatedAt: Date.now(), updatedBy: ACTOR });
const after = (await ref.get()).data();
console.log(
  `\n썼다 — ${after.locationScore}·${after.preemptionScore}·${after.visibilityScore}` +
    ` (${new Date(after.updatedAt).toISOString()})`,
);
console.log("다음: node scripts/dumpValidationSnapshot.mjs 로 스냅샷을 다시 뜨고,");
console.log("     /store-eval/candidates/N016 결과 탭을 한 번 열어 저장된 결과를 갱신한다.");
