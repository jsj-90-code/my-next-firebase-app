// 하안금당사거리(N004) 입지동선평가 — 선점경쟁 4 -> 3 (2026-09-21 사용자 위임 "너가 점수 수정해라").
//
//   node scripts/writeHaanGeumdangPreemption.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeHaanGeumdangPreemption.mjs --apply
//
// ── 근거 ──────────────────────────────────────────────────────────────────
// 채점 규칙은 "경쟁점 개수가 아니라, 그중 하나가 나보다 명백히 좋은 자리를 먹었나"다
// (2026-09-18 오송점에서 사용자가 세운 규칙, writeOsongPreemptionScore.mjs 참고).
//
// 좌표로 재보니 경쟁점 3곳이 **전부 북서쪽**이고, 후보지 최대 유동 방위도 **북서**다:
//
//   마하pc카페        446m  방위 299° 북서
//   메타피씨방 하안사거리점  407m  방위 319° 북서   PC 107
//   레벨업PC방        504m  방위 329° 북서   PC 100
//   편심도 0.623 — 기존점 38곳 중 최고급(중앙 0.246, 상위20% 0.343)
//
// 즉 유동이 쏠린 쪽(하안사거리 핵심 상업지)을 경쟁점 셋이 통째로 선점하고 있고, 후보지는
// 그 끝 대로변이다. 입지 메모도 같은 말을 한다 — "하안사거리 핵심 상업지에서는 다소 떨어져
// 있음 · 하안사거리 방향의 기존 경쟁점으로 일부 수요가 이탈할 가능성이 있으(ㅁ)".
// **4점(유리)은 근거가 없다.**
//
// 그렇다고 오송점처럼 1~2점까지 내리지는 않는다:
//   · 거리가 407~504m로 멀다(오송점 팀플PC는 342m였다)
//   · 상권성격이 **주거중심**이다(유동500÷주거500 = 2.62배). 주력인 배후 아파트
//     79,190명(1km)은 후보지가 먼저 받는다 — 오송점은 경쟁점이 배후와 자사 **사이**였다.
// 그래서 3점(보통)으로 본다.
//
// ── ⚠️ 등급이 바뀐다 ──────────────────────────────────────────────────────
// `_preemptionWhatIf.test.ts`로 미리 쟀다:
//
//   5점  6,320만  AA      4점  6,019만  AA  <- 지금
//   3점  5,685만  A+      2점  5,287만  A+      1점  4,732만  A
//
// AA 기준선이 5,770만이라 4->3에서 **AA -> A+로 내려간다**(1억 선투자 기준 미달).
// 사용자에게 알리고 쓴다. 되돌리라면 이 스크립트의 NEXT를 4로 바꿔 다시 돌리면 된다.
//
// ── 이 스크립트가 안 하는 것 ──────────────────────────────────────────────
// storeEvalResults(저장된 예상매출 스냅샷)는 **안 건드린다.** 그 문서는 후보지 결과 탭이
// evaluateCandidate를 돌려 저장하는 것이라, 여기서 흉내 내면 화면 경로와 갈라진다.
// 쓰고 나면 /store-eval/candidates/N004 결과 탭을 한 번 열어야 대시보드가 맞춰진다.
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const CODE = "N004";
const FIELD = "preemptionScore";
const EXPECTED_NOW = 4;
const NEXT = 3;
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

console.log(`\n바꿀 것: ${FIELD} ${before[FIELD]} -> ${NEXT}`);
console.log(`⚠️ V62 6,019만 -> 약 5,685만 (-5.6%) · 등급 **AA -> A+** (AA 기준선 5,770만)`);
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
console.log("다음: /store-eval/candidates/N004 결과 탭을 한 번 열어 저장된 결과를 갱신하고,");
console.log("     node scripts/dumpValidationSnapshot.mjs 로 스냅샷을 다시 뜬다.");
