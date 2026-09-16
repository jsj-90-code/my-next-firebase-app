// 로드뷰 판정(입지 4번 동선 방해 · 5번 가시성)을 실험실 전용 컬렉션에 넣는다.
//
//   node scripts/writeRoadviewJudgmentsToFirestore.mjs            # 미리보기
//   node scripts/writeRoadviewJudgmentsToFirestore.mjs --apply    # 실제로 쓴다
//
// 입력: .local-tools/roadview-judgments.json (scripts/roadview/ 하네스 + AI 판독 결과)
//
// ── 어디에 쓰나 ────────────────────────────────────────────────────────────
// **`storeEvalLabRoadviewJudgments` 전용 컬렉션**에 쓴다. 매장 문서에 필드로 붙이지 않는다 —
// `syncLabCollections.mjs`가 운영 문서로 실험실 문서를 통째로 덮어쓰기 때문에, 매장 문서에
// 넣으면 다음 동기화 때 **판정이 날아간다.** 별도 컬렉션은 동기화가 손대지 않는다.
//
// ⚠️ 운영 컬렉션에는 쓰지 않는다. 이건 교과서식 실험용 자료다.
//
// ── 값을 어떻게 만드나 ─────────────────────────────────────────────────────
// 문항은 전부 "예 = 나쁨"이다. 모델의 입지 항은 `(값/기준)^지수` 꼴이라 **클수록 좋은 값**이
// 필요하므로, 예 개수를 뒤집는다:
//
//   flowBlock  = 5 − (block 문항 중 예 개수, 0~4)   ->  1~5
//   visibility = 4 − (vis   문항 중 예 개수, 0~3)   ->  1~4
//
// 0이 안 나오게 1부터 시작한다 — 거듭제곱에서 0은 다루기 곤란하다.
//
// ⚠️ **계수가 0이라 지금은 계산에 안 들어간다.** 값만 채워두는 것이고, 켜는 건 검정을
//    거친 뒤 사용자 결정이다(backlog 산식 실험 판정 기준).
//
// ⚠️ lowConfidence로 표시된 지점과 미판정 지점은 **넣지 않는다.** 값을 지어내지 않는다.

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const DATA = ".local-tools/roadview-judgments.json";
const COLLECTION = "storeEvalLabRoadviewJudgments";
const APPLY = process.argv.includes("--apply");
const INCLUDE_LOW = process.argv.includes("--include-low-confidence");

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
if (!existsSync(DATA)) { console.error(`${DATA}이 없다.`); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const data = JSON.parse(readFileSync(DATA, "utf8"));
const current = await loadCollectionMap(db, COLLECTION);

const BLOCK = ["block1", "block2", "block3", "block4"];
const VIS = ["vis1", "vis2", "vis3"];

const plan = [];
const skipped = [];

for (const s of data.sites ?? []) {
  if (s.unjudged) { skipped.push(`${s.name} — 미판정 (${s.reason ?? ""})`); continue; }
  if (s.lowConfidence && !INCLUDE_LOW) { skipped.push(`${s.name} — 판정 신뢰도 낮음 (--include-low-confidence로 포함)`); continue; }

  const blockYes = BLOCK.filter((k) => s[k] === true).length;
  const visYes = VIS.filter((k) => s[k] === true).length;
  const answers = {};
  for (const k of [...BLOCK, ...VIS]) answers[k] = s[k] ?? null;

  const doc = {
    key: s.key,
    name: s.name,
    // 원본 답(예/아니오)을 그대로 남긴다 — 점수만 남기면 나중에 문항을 고칠 때 되돌릴 수 없다.
    answers,
    blockYesCount: blockYes,
    visYesCount: visYes,
    // 모델이 쓰는 값. 클수록 좋다.
    flowBlock: 5 - blockYes,
    visibility: 4 - visYes,
    memo: s.memo ?? null,
    judgedAt: data.judgedAt ?? null,
    method: "로드뷰 자동 캡처 + AI 예/아니오 사실 판정 (사람 표본 대조 전)",
  };
  const changed = needsWrite(current.get(s.key), doc, { merge: false });
  plan.push({ id: s.key, doc, changed });
}

const toWrite = plan.filter((p) => p.changed);
console.log(`\n대상 ${plan.length}곳 · 값이 달라진 곳 ${toWrite.length}곳 · 건너뜀 ${skipped.length}곳`);
for (const s of skipped) console.log(`  · ${s}`);

const fb = plan.map((p) => p.doc.flowBlock).sort((a, b) => a - b);
const vi = plan.map((p) => p.doc.visibility).sort((a, b) => a - b);
if (fb.length) {
  console.log(`\n동선 방해 점수 ${fb[0]}~${fb[fb.length - 1]} (중앙 ${fb[Math.floor(fb.length / 2)]}) · 5가 문제 없음`);
  console.log(`가시성   점수 ${vi[0]}~${vi[vi.length - 1]} (중앙 ${vi[Math.floor(vi.length / 2)]}) · 4가 문제 없음`);
}
console.log("\n예시 3곳:");
for (const p of toWrite.slice(0, 3)) console.log(`  ${p.doc.name}: 동선 ${p.doc.flowBlock} · 가시성 ${p.doc.visibility}`);

if (!APPLY) { console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다."); process.exit(0); }

let written = 0;
for (const p of toWrite) { await db.collection(COLLECTION).doc(p.id).set(p.doc); written++; }
console.log(`\n${written}곳에 썼다 -> ${COLLECTION}`);
console.log("계수가 0이라 예측은 안 바뀐다. 실험실 화면의 입지 표에 값만 찬다.");
process.exit(0);
