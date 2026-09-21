// 송도점·동탄북광장점의 `excludedFromModel`을 맞춘다 (2026-09-21).
//
//   node scripts/writeSampleInclusion.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeSampleInclusion.mjs --apply
//
// ── ⚠️ 이 스크립트가 남은 이유 (읽고 쓸 것) ───────────────────────────────
// 2026-09-21에 사용자 지시로 이 둘을 `false`(=표본에 포함)로 **썼다가 되돌렸다.**
// 이유: `excludedFromModel`은 실험실만의 스위치가 아니라 **운영 V62의 학습 표본**도 같이
// 가른다(`calc.ts`의 `isEligibleForV61Training`). 실제 영향이 이랬다:
//
//   V62 표본 38 -> 40 · MAPE 8.83% -> 9.79% · 후보지 예상매출 −0.5 ~ −3.9% (결재 숫자다)
//
// 사용자 결정: *"실험실에만 넣자."* 그래서 **Firestore는 true로 되돌렸고**, 실험실 포함은
// `labInput.ts`의 `LAB_ONLY_INCLUDED_STORE_CODES` 목록이 맡는다.
// 아래 DESIRED가 지금 그 되돌린 상태(true)다. 운영 표본에 정말 넣기로 하면 false로 바꿔 돌린다.
//
// ── 무엇을 바꾸나 ─────────────────────────────────────────────────────────
// `storeEvalExistingStores`의 `excludedFromModel: true -> false` 둘뿐이다.
// 다른 필드는 손대지 않는다. `excludedReason`은 **남긴다** — 왜 뺐었는지가 기록이고,
// 화면은 제외된 매장에서만 그 값을 읽으므로 거짓말이 되지 않는다.
//
//   20250124421 동탄북광장점  "오픈 후 운영관리 문제"
//   20260515431 송도점        "오픈 후 경쟁점 500원 가격전쟁"
//
// ── 크론이 되돌리지 않는다 ────────────────────────────────────────────────
// `cronSync`의 자동등록은 `if (storeCodes.has(code)) continue`로 **신규 매장만** 만든다.
// 이미 있는 매장의 `excludedFromModel`은 건드리지 않는다(2026-09-21 확인).
//
// ── 미리 잰 영향 (`_sampleChange.test.ts`) ────────────────────────────────
//   기존 38곳 MAE는 **하나도 안 움직인다**(6.517%p 그대로). 축척이 원장 실측으로 못 박혀
//   있고 상품몫도 고정이라, 표본이 늘어도 계수가 다시 맞춰지지 않기 때문이다.
//   새로 들어오는 둘: 동탄북광장 예측 25.1% vs 실측 17.8%(+7.3%p) · 송도 21.4% vs 23.5%(−2.1%p)
//
// ⚠️ **송도점은 평가창 12달 중 2달치뿐이다**(2026-07 22% · 08 25%, 아직 오르는 중).
//    사용자가 사정을 알고 "그래도 지금 넣어라"고 했다. 자료가 차면 실측값이 움직이므로
//    성적도 같이 움직인다 — 성적이 흔들려 보이면 이걸 먼저 의심할 것.
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/** 이 값으로 맞춘다. true = 운영 V62 표본에서 뺀 상태(지금 의도한 상태). */
const DESIRED = true;
const TARGETS = [
  { code: "20250124421", name: "동탄북광장점" },
  { code: "20260515431", name: "송도점" },
];
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

let changed = 0;
for (const t of TARGETS) {
  const ref = db.collection("storeEvalExistingStores").doc(t.code);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`  ✗ storeEvalExistingStores/${t.code} (${t.name}) 문서가 없다.`);
    process.exitCode = 1;
    continue;
  }
  const cur = snap.data();
  if (cur.storeName !== t.name) {
    console.error(`  ✗ ${t.code} 이름이 다르다: 기대 ${t.name}, 실제 ${cur.storeName}. 멈춘다.`);
    process.exitCode = 1;
    continue;
  }
  if (cur.excludedFromModel === DESIRED) {
    console.log(`  · ${t.name} 이미 excludedFromModel=${DESIRED}다. 건너뛴다.`);
    continue;
  }
  console.log(`  ${apply ? "→ 씀" : "(미리보기)"} ${t.name} excludedFromModel: ${cur.excludedFromModel} -> ${DESIRED}  [사유는 그대로: "${cur.excludedReason ?? ""}"]`);
  if (apply) {
    await ref.update({ excludedFromModel: DESIRED, updatedAt: Date.now(), updatedBy: ACTOR });
    changed += 1;
  }
}

console.log(apply ? `\n완료 — ${changed}건 갱신. 스냅샷을 다시 뜨면(node scripts/dumpValidationSnapshot.mjs) 표본이 40곳이 된다.`
  : `\n미리보기만 했다. 실제로 쓰려면 --apply를 붙인다.`);
