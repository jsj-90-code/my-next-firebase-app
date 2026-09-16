// 모아둔 유동 방향(편심도)을 운영 Firestore의 매장/후보지 문서에 넣는다.
// 실험실(/store-eval/lab)이 Firestore를 읽으므로, 여기 써야 화면에서 입지 3번 항목이 살아난다.
//
//   node scripts/writeDirectionalToFirestore.mjs            # 미리보기(쓰지 않는다)
//   node scripts/writeDirectionalToFirestore.mjs --apply    # 실제로 쓴다
//
// 입력: .local-tools/kakao-directional.json (collectKakaoDirectional.mjs 산출물)
//
// ── 무엇을 쓰나 ────────────────────────────────────────────────────────────
// `flowEccentricity` (0~1) — 상권이 우리 기준 한쪽으로 얼마나 쏠렸나. 0이면 사방이 고르고
// (상권 한가운데), 1에 가까울수록 한쪽에만 몰렸다(상권 끝). 파생값은 만들지 않는다 —
// 실험실 산식이 `room = 1 - 편심도`를 직접 계산한다(textbookModel.ts).
// `flowBusiestDir` — 제일 붐비는 방위. 계산엔 안 쓰고 사람이 읽으라고 같이 넣는다.
//
// ⚠️ 계수 ω는 0이다. **값만 채우는 것이고 지금은 예측에 영향을 주지 않는다** — 대조군을
// 못 넘었다(중심도가 이미 이 신호를 먹는다). 켜는 건 사용자 결정 사항이다.
//
// ⚠️ 운영 산식(calc.ts / usageRevenue.ts)은 이 필드를 읽지 않는다. 교과서식 실험실 전용이다.

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const DATA = ".local-tools/kakao-directional.json";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
const APPLY = process.argv.includes("--apply");

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

for (const f of [DATA, SNAPSHOT]) {
  if (!existsSync(f)) {
    console.error(`${f}이 없다.`);
    process.exit(1);
  }
}

const collected = JSON.parse(readFileSync(DATA, "utf8"));
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

// 수집 파일은 storeCode/후보지코드로 키를 잡았다. Firestore 문서 id로 되돌린다.
const existingDocId = new Map();
for (const e of snap.existingStores ?? []) existingDocId.set(String(e.storeCode ?? e.id), e.id);
const candidateDocId = new Map();
for (const c of snap.candidates ?? []) candidateDocId.set(String(c.code ?? c.id), c.id);

if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const existingMap = await loadCollectionMap(db, "storeEvalExistingStores");
const candidateMap = await loadCollectionMap(db, "storeEvalCandidates");

const plan = [];
const skipped = [];

for (const [key, site] of Object.entries(collected.sites ?? {})) {
  // 수집 파일의 키가 "existing:<코드>" / "candidate:<코드>" 형태다.
  const [kind, code] = key.split(":");
  const isCandidate = kind === "candidate";
  const docId = isCandidate ? candidateDocId.get(String(code)) : existingDocId.get(String(code));
  if (!docId) {
    skipped.push(`${key} ${site.name} — 문서를 못 찾음`);
    continue;
  }
  const ecc = Number(site.eccentricity);
  if (!Number.isFinite(ecc)) {
    skipped.push(`${key} ${site.name} — 편심도 없음`);
    continue;
  }
  // 값을 지어내지 않는다: 8방위가 전부 0이면(주변에 아무것도 없음) 편심도는 뜻이 없다.
  if (!(Number(site.sum) > 0)) {
    skipped.push(`${key} ${site.name} — 주변 업소 0곳이라 방향을 잴 수 없다`);
    continue;
  }

  const patch = { flowEccentricity: ecc, flowBusiestDir: site.busiestDir ?? null };
  const current = (isCandidate ? candidateMap : existingMap).get(docId);
  const changed = needsWrite(current, patch, { merge: true });
  plan.push({
    key,
    name: site.name,
    collection: isCandidate ? "storeEvalCandidates" : "storeEvalExistingStores",
    docId,
    patch,
    changed,
  });
}

const toWrite = plan.filter((p) => p.changed);

console.log(`\n대상 ${plan.length}곳 · 실제로 값이 달라진 곳 ${toWrite.length}곳 · 건너뜀 ${skipped.length}곳`);
console.log(`측정 조건: ${collected.stepM}m 밀어내고 반경 ${collected.radiusM}m · 업종 ${(collected.categories ?? []).join("/")}`);
for (const s of skipped) console.log(`  · 건너뜀 ${s}`);

const eccs = plan.map((p) => p.patch.flowEccentricity).sort((a, b) => a - b);
if (eccs.length) {
  const q = (f) => eccs[Math.min(eccs.length - 1, Math.floor(f * (eccs.length - 1)))];
  console.log(`편심도 분포: 최소 ${eccs[0].toFixed(3)} · 중앙 ${q(0.5).toFixed(3)} · 최대 ${eccs[eccs.length - 1].toFixed(3)}`);
}

console.log("\n예시 3곳:");
for (const p of toWrite.slice(0, 3)) {
  console.log(`  ${p.name}: 편심도 ${p.patch.flowEccentricity.toFixed(3)} · 붐비는 쪽 ${p.patch.flowBusiestDir ?? "-"}`);
}

if (!APPLY) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다.");
  process.exit(0);
}

let written = 0;
for (const p of toWrite) {
  await db.collection(p.collection).doc(p.docId).set({ ...p.patch, updatedAt: Date.now() }, { merge: true });
  written++;
}
console.log(`\n${written}곳에 썼다.`);
console.log("실험실을 새로고침하면 입지 3번(유동 방향)에 값이 찬다. 계수 ω는 0이라 예측은 안 바뀐다.");
process.exit(0);
