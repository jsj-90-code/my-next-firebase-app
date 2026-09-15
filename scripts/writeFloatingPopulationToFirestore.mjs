// 모아둔 반경별 유동인구를 운영 Firestore의 매장/후보지 문서에 넣는다.
// 실험실(/store-eval/lab)이 Firestore를 읽으므로, 여기 써야 화면에서 반경을 고를 수 있다.
//
//   node scripts/writeFloatingPopulationToFirestore.mjs            # 미리보기(쓰지 않는다)
//   node scripts/writeFloatingPopulationToFirestore.mjs --apply    # 실제로 쓴다
//
// 입력: .local-tools/sbiz-floating-population.json (collectSbizFloatingPopulation.mjs 산출물)
//
// ── 어떤 값을 쓰나 (2026-09-15 사용자 확정: "A") ─────────────────────────────
// 받은 자료는 13개월치 월별 일평균이다. `floating{R}Avg`에는 **최근 12개월 평균**을 넣는다.
// 한 달 값은 계절·이벤트로 흔들리므로 평균이 낫다는 판단이다.
//
// ⚠️ 연령·성별은 사이트가 **최근월 기준 한 벌만** 준다(월별 분해가 없다). 그런데 실험실은
// 연령별 절대값을 그대로 곱해 쓰므로(textbookModel.ts weightedAges), 총수만 12개월 평균이고
// 연령은 최근월이면 "연령가중 켜기/끄기"가 서로 다른 축척을 비교하게 된다 — 토글이 거짓말을 한다.
// 그래서 연령·성별에 **같은 배율(12개월평균 ÷ 최근월)을 곱해** 축척을 맞춘다.
// 이건 "연령 구성비가 열두 달 동안 대체로 같다"는 가정이다. 구성비를 지어낸 게 아니라
// 사이트가 준 구성비를 그대로 두고 크기만 맞춘 것이며, 배율은 아래 출력에 그대로 찍는다.
//
// 기존 `floating500Avg`는 건드리지 않는다 — 출처가 다른 값이라 섞으면 안 된다.

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const DATA = ".local-tools/sbiz-floating-population.json";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
// 기본은 100~400m만 쓴다. 500m는 기존 손입력값이 있어서 **비교가 끝나기 전에는 덮지 않는다**
// (출처가 섞이면 "반경 때문인지 출처 때문인지"를 영영 못 가른다).
//
// 2026-09-15에 비교를 끝냈다 — `_baseDataSwap.test.ts`로 재보니 500m를 새 값으로 바꾸면
// MAPE 9.37% -> 9.26%, ±10% 63.16% -> 65.79%로 **개선**됐다. 기존 값은 출처·시점이 불명이고
// N003은 실제의 1/3이었다. 그래서 사용자 판단으로 500m도 교체한다: `--include-500`.
//
// 1000m는 대응하는 기존 필드가 없어 아직 쓰지 않는다.
const RADII = process.argv.includes("--include-500") ? [100, 200, 300, 400, 500] : [100, 200, 300, 400];
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

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

/** 한 지점의 반경별 값을 Firestore 필드로 편다. 자료가 없는 반경은 아예 넣지 않는다. */
function buildPatch(site, report) {
  const patch = {};
  for (const radius of RADII) {
    const r = site.radii?.[radius];
    if (!r?.selected?.length || !r.demographics) continue;

    const months = r.selected;
    const last12 = months.slice(-12);
    const avg = Math.round(mean(last12));
    const recent = months.at(-1);
    // 배율: 연령·성별(최근월 기준)을 12개월 평균 축척으로 옮긴다.
    const scale = recent > 0 ? avg / recent : 1;
    report.scales.push(scale);

    const d = r.demographics;
    const s = (v) => (v == null ? null : Math.round(v * scale));
    patch[`floating${radius}Avg`] = avg;
    patch[`floating${radius}Male`] = s(d.male);
    patch[`floating${radius}_10s`] = s(d.age10s);
    patch[`floating${radius}_20s`] = s(d.age20s);
    patch[`floating${radius}_30s`] = s(d.age30s);
    patch[`floating${radius}_40s`] = s(d.age40s);
    patch[`floating${radius}_50s`] = s(d.age50s);
    patch[`floating${radius}_60plus`] = s(d.age60plus);
  }
  return patch;
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);

const existingMap = await loadCollectionMap(db, "storeEvalExistingStores");
const candidateMap = await loadCollectionMap(db, "storeEvalCandidates");

const report = { scales: [] };
const plan = [];
const skipped = [];

for (const [key, site] of Object.entries(collected.sites ?? {})) {
  const isCandidate = site.kind === "candidate";
  const docId = isCandidate ? candidateDocId.get(String(site.code)) : existingDocId.get(String(site.code));
  if (!docId) {
    skipped.push(`${key} ${site.name} — 문서를 못 찾음`);
    continue;
  }
  const patch = buildPatch(site, report);
  if (Object.keys(patch).length === 0) {
    skipped.push(`${key} ${site.name} — 완성된 반경 자료 없음`);
    continue;
  }
  const current = (isCandidate ? candidateMap : existingMap).get(docId);
  const changed = needsWrite(current, patch, { merge: true });
  plan.push({ key, name: site.name, collection: isCandidate ? "storeEvalCandidates" : "storeEvalExistingStores", docId, patch, changed });
}

const toWrite = plan.filter((p) => p.changed);

console.log(`\n대상 ${plan.length}곳 · 실제로 값이 달라진 곳 ${toWrite.length}곳 · 건너뜀 ${skipped.length}곳`);
if (report.scales.length) {
  const lo = Math.min(...report.scales);
  const hi = Math.max(...report.scales);
  console.log(`연령·성별 보정 배율(12개월평균 ÷ 최근월): ${lo.toFixed(3)} ~ ${hi.toFixed(3)}`);
}
for (const s of skipped) console.log(`  · 건너뜀 ${s}`);

console.log("\n예시 3곳:");
for (const p of toWrite.slice(0, 3)) {
  const v = RADII.map((r) => `${r}m ${p.patch[`floating${r}Avg`] ?? "-"}`).join(" / ");
  console.log(`  ${p.name}: ${v}`);
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
console.log("실험실을 새로고침하면 반경 100~400m를 고를 수 있다.");
process.exit(0);
