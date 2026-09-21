// 오송점(N016) 담당자 판단매출 3,700만원 (2026-09-21 사용자 확정 "3700으로하자" · "너가 3700에 넣으셈").
//
//   node scripts/writeOsongJudgedRevenue.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeOsongJudgedRevenue.mjs --apply
//
// ── 왜 스크립트로 쓰나 ────────────────────────────────────────────────────
// 원래 자리는 화면이다(/store-eval/candidates/N016 결과 탭 "담당자 판단 매출"). 그 화면이
// `judgedBy`에 **로그인 계정을 그대로 stamp** 하기 때문에 원칙적으로 사람이 넣어야 한다.
// 2026-09-21에 사용자가 명시적으로 지시해서 스크립트로 넣는다. **판단 자체는 사용자 것**이라
// ACTOR도 사용자 계정으로 적는다(대리 입력이라는 사실은 judgedReason 끝에 남긴다).
//
// ── 화면과 같은 모양으로 쓴다 ──────────────────────────────────────────────
// ResultTab.tsx handleSave -> store.ts updateCandidateFields -> saveAuditedInput.
// 그래서 여기서도 **한 트랜잭션에 문서 + 감사로그를 같이** 쓴다. 감사로그를 빼먹으면
// 화면으로 넣은 다른 판단들과 이력이 어긋난다.
//   storeEvalCandidates/N016   judgedRevenue·judgedReason·judgedAt·judgedBy·updatedAt·updatedBy
//   storeEvalAuditLog/(새문서)  entityType candidate · action 수정 · before/after 통째로
//
// ── 판단 근거 (오늘 잰 것) ────────────────────────────────────────────────
//   V62 4,700만   유동 원수요 8,902명을 거의 그대로 쓴다. 상권 편심도를 안 본다
//                 (locationExponents.direction = 0). 입지배율을 x1.280으로 올려준다.
//   실험실 3,520만 유동을 15%만 센다(floatingFactor 0.15) + 주거를 같이 본다.
//   채택 3,700만   둘 사이. 좌석당 일매출 15,417원 · 가동률 22.0% (표본 38곳 중 아래서 5번째).
//
// 오송점 편심도 0.542는 표본 39곳 중 2위다(중앙 0.246). `_osongEccentricity.test.ts`에서
// 그 축을 재봤는데 관문(±0.32)에 못 미쳤다(r=0.301 · 중심도 통제 후 0.298). 그래서
// **산식은 안 고쳤고**, 대신 사람 판단으로 낮춰 적는다 — 그게 이 필드의 용도다.
//
// ── 이 스크립트가 안 하는 것 ──────────────────────────────────────────────
// storeEvalResults(저장된 V62 예상매출 스냅샷)는 **안 건드린다.** judgedRevenue는 산식 입력이
// 아니라 사람 판단 기록이라 예상매출이 바뀌지 않는다(types.ts judgedRevenue 주석).
// 그래서 결과 탭을 다시 열 필요도 없다.
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const CODE = "N016";
const NEXT_REVENUE = 37000000;
const ACTOR = "jsj-90@isens.camp";
const NEXT_REASON = [
  "상권 끝단 입지로 북측 산업단지 방면 수요 기여가 제한적이며, 실질 배후는 남측 아파트 단지에",
  "국한됨(반경 1km 주거 12,643명으로 표본 최저 수준). 유일한 경쟁점 팀플PC(342m·102대)가",
  "배후세대와 후보지 사이 길목을 선점하고 있음. V62 4,210만원(선점경쟁 1점 반영 후)은 유동인구",
  "전량을 수요로 계산하고 상권 편심도를 반영하지 않아 여전히 과대로 판단. 실험실 산식",
  "3,520만원과 V62 사이에서 3,700만원 적용.",
  "(2026-09-21 담당자 판단 · Claude가 지시받아 대리 입력)",
].join(" ");

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
const ref = db.collection("storeEvalCandidates").doc(CODE);
const snap = await ref.get();

if (!snap.exists) {
  console.error(`storeEvalCandidates/${CODE} 문서가 없다.`);
  process.exit(1);
}

const before = snap.data();
const won = (v) => (v == null ? "(비어 있음)" : `${v.toLocaleString()}원`);
console.log(`${CODE} ${before.name ?? ""} — 지금 값`);
console.log(`  judgedRevenue = ${won(before.judgedRevenue)}`);
console.log(`  judgedReason  = ${before.judgedReason ?? "(비어 있음)"}`);
console.log(`  judgedBy      = ${before.judgedBy ?? "-"}  ·  judgedAt ${before.judgedAt ? new Date(before.judgedAt).toISOString() : "-"}`);
console.log(`  최종수정 ${before.updatedAt ? new Date(before.updatedAt).toISOString() : "-"} (${before.updatedBy ?? "-"})`);

// 금액이 이미 맞으면 사유만 본다 — 2026-09-21에 처음 쓴 사유에 V62 값을 낡은 것으로
// (4,700만, 선점경쟁 2점 시절) 적었다. 금액은 그대로 두고 문장만 고치는 길을 열어둔다.
if (before.judgedRevenue === NEXT_REVENUE) {
  if (before.judgedReason === NEXT_REASON) {
    console.log(`\n이미 ${won(NEXT_REVENUE)}이고 사유도 같다. 쓸 것이 없다.`);
    process.exit(0);
  }
  console.log(`\n금액은 이미 ${won(NEXT_REVENUE)}로 맞다. **사유 문장만** 고친다.`);
  console.log(`  지금 -> ${before.judgedReason}`);
  console.log(`  바꿈 -> ${NEXT_REASON}`);
  if (!apply) {
    console.log("\n미리보기다. 실제로 쓰려면 --apply를 붙인다.");
    process.exit(0);
  }
  const t = Date.now();
  const next = { ...before, judgedReason: NEXT_REASON, judgedAt: t, judgedBy: ACTOR, updatedAt: t, updatedBy: ACTOR };
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) throw new Error("문서가 사라졌다.");
    if (fresh.data().judgedRevenue !== NEXT_REVENUE) throw new Error("그 사이 금액이 바뀌었다. 중단한다.");
    tx.set(ref, next);
    tx.set(db.collection("storeEvalAuditLog").doc(), {
      entityType: "candidate", entityId: CODE, action: "수정", before, after: next, actor: ACTOR, at: t,
    });
  });
  console.log(`\n사유를 고쳤다 (${new Date(t).toISOString()}). 금액은 안 건드렸다.`);
  process.exit(0);
}
// 비어 있을 때만 쓴다. 이미 누가 다른 값을 넣었으면 사람이 봐야 한다.
if (before.judgedRevenue != null) {
  console.error(
    `\n중단한다 — judgedRevenue가 비어 있을 줄 알았는데 ${won(before.judgedRevenue)}다.` +
      `\n그 사이 누가 넣었다는 뜻이다. 사람이 확인해야 한다.`,
  );
  process.exit(1);
}

console.log(`\n쓸 것`);
console.log(`  judgedRevenue  (비어 있음) -> ${won(NEXT_REVENUE)}`);
console.log(`  judgedReason   -> ${NEXT_REASON}`);
console.log(`  judgedBy       -> ${ACTOR}`);
console.log(`  + storeEvalAuditLog 에 '수정' 항목 하나 (화면 경로와 같은 모양)`);
console.log(`\n건드리지 않는 것: 그 밖의 후보지 필드 전부 · storeEvalResults(V62 예상매출 스냅샷).`);

if (!apply) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply를 붙인다.");
  process.exit(0);
}

const now = Date.now();
const after = {
  ...before,
  judgedRevenue: NEXT_REVENUE,
  judgedReason: NEXT_REASON,
  judgedAt: now,
  judgedBy: ACTOR,
  updatedAt: now,
  updatedBy: ACTOR,
};

await db.runTransaction(async (tx) => {
  const fresh = await tx.get(ref);
  if (!fresh.exists) throw new Error("문서가 사라졌다.");
  if (fresh.data().judgedRevenue != null) throw new Error("그 사이 judgedRevenue가 채워졌다. 중단한다.");
  tx.set(ref, after);
  tx.set(db.collection("storeEvalAuditLog").doc(), {
    entityType: "candidate",
    entityId: CODE,
    action: "수정",
    before,
    after,
    actor: ACTOR,
    at: now,
  });
});

const saved = (await ref.get()).data();
console.log(`\n썼다 — judgedRevenue ${won(saved.judgedRevenue)} (${new Date(saved.judgedAt).toISOString()}, ${saved.judgedBy})`);
console.log("다음: node scripts/dumpValidationSnapshot.mjs 로 스냅샷을 다시 뜬다.");
console.log("     결과 탭은 다시 열 필요 없다 — judgedRevenue는 산식 입력이 아니다.");
