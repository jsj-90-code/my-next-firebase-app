// fcdaum QSC 점검 점수 -> `storeEvalQscScores`(운영) + `storeEvalLabQscScores`(실험실).
//
//   node scripts/writeQscScoresToFirestore.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeQscScoresToFirestore.mjs --apply
//
// ── 무엇을 쓰나 ────────────────────────────────────────────────────────────
// 매장마다 **평가창(개점 다음 달~12개월) 안 점검의 평균** 하나다. 이 값이 실험실에서
// 관리 점수로 환산된다(labInput.ts qscToManagementScore: 100점->5점 · 80점->1점).
//
// 걸러내는 기록 둘 (2026-09-17 사용자 확인: "0점·오픈점검 둘 다 제외"):
//   - 0점: 송도점은 개점 0개월(오픈 2주 차), 창원남양점은 다른 점검이 전부 90점대다.
//          미실시나 입력오류지 "관리가 0점"이 아니다.
//   - `블랙라벨PC존 오픈 매장 점검`: 오픈 직후 체크리스트라 **재는 것이 다르다.**
//     ⚠️ 2026-09-20에 **근거를 바꿨다.** 옛 근거("송도가 부당하게 낮아진다")는 사용자가
//     뒤집었다 — *"낮은 매장은 진짜 문제 있는 거고, 높은 매장은 원래 높게 나오는 느낌."*
//     빼는 결론은 그대로지만 근거는 **천장 효과**다: 6건 중 4건이 만점 100이라 변별이 0이고,
//     낮은 쪽은 송도 50점 하나뿐이라 그걸로 규칙을 세울 수 없다. 자세한 건 labInput.ts의
//     `usableQscRecord` 주석에 있다.
// ⚠️ 이 셋을 안 빼면 관문이 미달이다(대조군 p=0.070/0.052 -> 걸러낸 뒤 0.040/0.050).
//
// ── 왜 전용 컬렉션인가 ─────────────────────────────────────────────────────
// 매장 문서에 필드로 붙이면 syncLabCollections.mjs가 운영 문서로 덮을 때 날아간다.
// 로드뷰 판정(storeEvalLabRoadviewJudgments)과 같은 이유·같은 방식이다.
//
// ⚠️ **2026-09-19부터 운영 V62도 QSC를 읽는다**(storeEvalQscScores). 이 스크립트를 --apply로
//    돌리면 **예상매출이 움직인다.** 그전까지는 실험실 전용이라 "운영에 영향 없다"고 적혀
//    있었는데, 이제 아니다.
//    2026-09-20에 자리가 바뀌었다 — 학습 피처가 아니라 **자사 관리 점수**가 된다
//    (calc.ts `QSC_MANAGEMENT_FLOOR`: 70점=1점, 100점=5점). 점수를 고치면 그 매장의 경쟁력
//    점수가 움직이고, **가맹점 평균이 바뀌면 QSC 없는 매장과 후보지 전부가 같이 움직인다.**
//
// 원자료: `.local-tools/qsc-scores.json` (gitignore — 매장별 전체 점검 이력이라 매출은 없지만
// 재수집에 로그인이 필요하다. 만드는 법은 인계 문서 6절).
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

// .env.local의 키는 한 줄에 "\n" 이스케이프로 들어 있다. 정규식 대신 split/join을 쓴다 —
// 셸 heredoc으로 이 파일을 쓰면 백슬래시가 먹혀 조용히 깨진다(2026-09-15에 실제로 겪음).
const BS = String.fromCharCode(92);
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가 .env.local에 필요합니다.");
  process.exit(1);
}
if (projectId !== "my-next-firebase-app-541f4") {
  console.error(`예상치 못한 프로젝트: ${projectId}`);
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const SRC = ".local-tools/qsc-scores.json";
let raw;
try {
  raw = JSON.parse(readFileSync(SRC, "utf8"));
} catch {
  console.error(`${SRC}가 없다. 인계 문서 6절의 재수집 방법을 볼 것.`);
  process.exit(1);
}

// ⚠️ **평균을 여기서 내지 않는다.** 원본 기록을 그대로 저장하고, 창 길이·제외 규칙·평균은
//    화면과 하네스가 `labInput.ts`의 qscInWindowAverage로 계산한다. 쓰는 쪽과 읽는 쪽이
//    각자 계산하면 창을 바꿀 때 한쪽만 바뀌어 조용히 갈라진다 — 2026-09-17에 창을 12개월에서
//    전체기간으로 바꾸다 그럴 뻔했다. 이 스크립트는 **자료를 옮기기만 한다.**
//
// 2026-09-19 — **두 컬렉션에 같은 것을 쓴다.** 운영 V62가 관리 수준(QSC)을 학습 피처로 쓰기
// 시작해서 운영 쪽 원본(`storeEvalQscScores`)이 생겼다. QSC는 실험실이 고치는 값이 아니라
// 본사가 매긴 사실이라 월매출과 같은 취급이고, 두 벌이 갈라지면 실험실과 운영의 관리 점수가
// 말없이 달라진다. 그래서 한 번에 둘 다 채운다.
const COLLECTIONS = ["storeEvalQscScores", "storeEvalLabQscScores"];
const rows = [];
for (const [key, site] of Object.entries(raw.sites ?? {})) {
  const storeCode = key.startsWith("existing:") ? key.slice("existing:".length) : key;
  const records = site.records ?? [];
  if (!records.length || !site.openedAt) continue;
  rows.push({
    storeCode,
    storeName: site.name ?? null,
    openedAt: site.openedAt,
    // 원본 그대로. 0점·오픈점검도 지우지 않고 넘긴다 — 무엇을 뺄지는 읽는 쪽 규칙이고,
    // 여기서 미리 지우면 규칙이 바뀔 때 자료를 다시 받아야 한다.
    records: records.map((r) => ({ date: String(r.date), score: Number(r.score), form: String(r.form ?? "") })),
    source: raw.source ?? "fcdaum.com",
    collectedAt: raw.collectedAt ?? null,
  });
}

const before = new Map();
for (const name of COLLECTIONS) {
  const existing = await db.collection(name).get();
  before.set(name, new Map(existing.docs.map((d) => [d.id, d.data()])));
}
rows.sort((a, b) => a.storeCode.localeCompare(b.storeCode));

// 미리보기용 참고 계산. **이 값이 저장되는 게 아니다** — 화면은 저장된 records에서 다시 낸다.
// 여기 숫자는 "무엇이 들어갈지" 사람이 눈으로 보라고 찍는 것이고, labInput.ts와 같은 규칙을
// 손으로 따라 적은 것이라 **틀릴 수 있다.** 진짜 값은 화면과 _textbookFull.test.ts에서 확인한다.
const usable = (r) => r.score > 0 && !String(r.form ?? "").includes("오픈 매장 점검");
const mgmt = (q) => Math.max(1, Math.min(5, 1 + (q - 60) * (4 / 40)));
const avgOf = (r) => {
  const v = r.records.filter(usable).map((x) => x.score);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
console.log(`원자료 ${Object.keys(raw.sites ?? {}).length}곳 -> 점검 기록이 있는 ${rows.length}곳`);
console.log(`${"매장".padEnd(14)}${"QSC평균".padStart(8)}${"관리점수".padStart(9)}${"쓰는건수".padStart(9)}${"버린건수".padStart(9)}`);
for (const r of rows) {
  const a = avgOf(r);
  const kept = r.records.filter(usable).length;
  console.log(`${String(r.storeName ?? r.storeCode).slice(0, 13).padEnd(14)}${(a == null ? "-" : a.toFixed(2)).padStart(8)}` +
    `${(a == null ? "-" : mgmt(a).toFixed(2)).padStart(9)}${String(kept).padStart(9)}${String(r.records.length - kept || "").padStart(9)}`);
}
const ms = rows.map(avgOf).filter((a) => a != null).map(mgmt);
console.log(`\n관리 점수 평균 ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2)} · 범위 ${Math.min(...ms).toFixed(2)}~${Math.max(...ms).toFixed(2)} · ${ms.length}곳`);
console.log(`(QSC 없는 매장과 후보지에는 이 평균이 들어간다 — 두 자가 섞이지 않게)`);
for (const name of COLLECTIONS) {
  console.log(`\n${name}: 기존 ${before.get(name).size}건 -> 쓸 것 ${rows.length}건 (원본 기록 그대로)`);
}
// 두 컬렉션이 이미 갈라져 있는지 눈에 보이게 찍는다 — 갈라지면 실험실과 운영의 관리 점수가
// 말없이 달라진다. 이 스크립트를 인자 없이 돌리는 것만으로 대조가 된다.
const [opBefore, labBefore] = COLLECTIONS.map((n) => before.get(n));
const drift = [...new Set([...opBefore.keys(), ...labBefore.keys()])]
  .filter((id) => JSON.stringify(opBefore.get(id)?.records ?? null) !== JSON.stringify(labBefore.get(id)?.records ?? null));
if (drift.length) console.log(`⚠️ 두 컬렉션이 ${drift.length}곳에서 다르다: ${drift.slice(0, 8).join(", ")}${drift.length > 8 ? " ..." : ""}`);

if (!process.argv.includes("--apply")) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다.");
  process.exit(0);
}

const keep = new Set(rows.map((r) => r.storeCode));
for (const name of COLLECTIONS) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    for (const r of rows.slice(i, i + 400)) {
      batch.set(db.doc(`${name}/${r.storeCode}`), r);
      written++;
    }
    await batch.commit();
  }
  // 원자료에서 사라진 매장은 지운다 — 남겨두면 없는 점검이 계속 점수를 만든다.
  const stale = [...before.get(name).keys()].filter((id) => !keep.has(id));
  for (const id of stale) await db.doc(`${name}/${id}`).delete();
  console.log(`${name}: ${written}건 썼다${stale.length ? ` · 낡은 ${stale.length}건 지웠다` : ""}.`);
}
console.log("\n⚠️ **운영 V62가 storeEvalQscScores를 읽는다** — 예상매출이 움직인다.");
console.log("   2026-09-20부터 이 점수는 자사 **관리 점수**가 된다(70점=1점, 100점=5점).");
console.log("   가맹점 평균이 바뀌면 QSC 없는 매장과 후보지도 같이 움직인다.");
console.log("   검증 화면을 열어 적중률을 다시 확인할 것.");
