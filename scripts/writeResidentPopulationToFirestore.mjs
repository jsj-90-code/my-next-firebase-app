// SGIS에서 모은 반경별 주거인구를 운영 Firestore에 넣는다.
//
// ── 배경 (2026-09-15) ──────────────────────────────────────────────────────
// `pop500m`/`pop1km`/`age1km_*`는 지금까지 사람이 SGIS 생활권역 통계지도 화면을 보고 손으로
// 넣은 값이었다. 자동 수집 경로를 뚫어 52곳을 같은 기준(2024년)으로 다시 받아 대조한 결과
// **중앙 차이 0.0%, 51곳 중 34곳이 1% 이내** — 손입력은 대체로 정확했다.
//
// 3% 넘게 어긋난 다섯 곳(문산·발산역·광주각화·전대상대·금촌역)이 있었고, 처음에는 "사람이
// 지도에서 찍은 점이 더 정확할 수도 있다"고 보아 보류했다. 그런데 확인해 보니 반대였다:
//
//   · 같은 다섯 곳의 **유동인구는 전부 6% 이내로 맞았다.** 우리 좌표가 틀렸다면 유동도 같이
//     어긋났어야 한다(유동·주거는 사람이 각각 따로 지도를 찍어 넣은 값이다).
//   · **금촌역점은 1km가 6.3% 틀리고 500m는 맞다.** 좌표가 어긋나면 작은 원이 더 크게
//     흔들려야 하는데 정반대다 — 좌표로는 설명이 안 된다.
//
// 그래서 사용자 판단대로 덮어쓴다: "손으로 한 거라 오히려 틀릴 수 있다고 봄."
// 적중률 영향은 0.00%p로 측정됐다(`_baseDataSwap.test.ts`) — 정확도가 아니라 **일관성**이
// 목적이다. 52곳이 같은 연도·같은 방법으로 측정된 상태가 된다.
//
// ── 연령 매핑 ─────────────────────────────────────────────────────────────
// SGIS `age_1_cnt`~`age_9_cnt`가 우리 `age1km_0_9`~`age1km_80plus` 9구간과 1:1로 대응하고
// 합이 `tot_ppltn_cnt`와 정확히 일치한다(N001로 대조 확인). 1km 응답에서 가져온다.
//
//   node scripts/writeResidentPopulationToFirestore.mjs          # 미리보기
//   node scripts/writeResidentPopulationToFirestore.mjs --apply  # 실제로 쓴다

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const DATA = ".local-tools/sgis-resident-population.json";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
const APPLY = process.argv.includes("--apply");

// SGIS 9구간 -> 우리 필드. 순서가 곧 대응이다.
const AGE_FIELDS = [
  ["age_1_cnt", "age1km_0_9"],
  ["age_2_cnt", "age1km_10_19"],
  ["age_3_cnt", "age1km_20_29"],
  ["age_4_cnt", "age1km_30_39"],
  ["age_5_cnt", "age1km_40_49"],
  ["age_6_cnt", "age1km_50_59"],
  ["age_7_cnt", "age1km_60_69"],
  ["age_8_cnt", "age1km_70_79"],
  ["age_9_cnt", "age1km_80plus"],
];

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
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();

const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_* 환경변수가 필요하다.");
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

const existingDocId = new Map();
for (const e of snap.existingStores ?? []) existingDocId.set(String(e.storeCode ?? e.id), e.id);
const candidateDocId = new Map();
for (const c of snap.candidates ?? []) candidateDocId.set(String(c.code ?? c.id), c.id);

function buildPatch(site) {
  const r500 = site.radii?.["500"];
  const r1k = site.radii?.["1000"];
  const patch = {};
  if (r500?.totalPopulation != null) patch.pop500m = r500.totalPopulation;
  if (r1k?.totalPopulation != null) patch.pop1km = r1k.totalPopulation;

  const pops = r1k?.pops;
  if (pops) {
    let sum = 0;
    const ages = {};
    for (const [src, dst] of AGE_FIELDS) {
      const v = Number(pops[src]);
      if (!Number.isFinite(v)) return patch; // 한 구간이라도 없으면 연령은 손대지 않는다
      ages[dst] = v;
      sum += v;
    }
    // 합이 총인구와 어긋나면 매핑이 바뀐 것이다 — 조용히 넣지 않는다.
    const total = r1k.totalPopulation;
    if (total && Math.abs(sum - total) / total > 0.01) {
      console.warn(`  ⚠️ ${site.name}: 연령합 ${sum} vs 총인구 ${total} — 연령은 건너뛴다`);
      return patch;
    }
    Object.assign(patch, ages);
  }
  return patch;
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
const existingMap = await loadCollectionMap(db, "storeEvalExistingStores");
const candidateMap = await loadCollectionMap(db, "storeEvalCandidates");

const plan = [];
const skipped = [];
for (const [key, site] of Object.entries(collected.sites ?? {})) {
  const isCandidate = site.kind === "candidate";
  const docId = isCandidate ? candidateDocId.get(String(site.code)) : existingDocId.get(String(site.code));
  if (!docId) {
    skipped.push(`${key} ${site.name} — 문서를 못 찾음`);
    continue;
  }
  const patch = buildPatch(site);
  if (!patch.pop500m && !patch.pop1km) {
    skipped.push(`${key} ${site.name} — 자료 없음`);
    continue;
  }
  const collection = isCandidate ? "storeEvalCandidates" : "storeEvalExistingStores";
  const current = (isCandidate ? candidateMap : existingMap).get(docId);
  plan.push({
    name: site.name,
    collection,
    docId,
    patch,
    before: { pop500m: current?.pop500m ?? null, pop1km: current?.pop1km ?? null },
    changed: needsWrite(current, patch, { merge: true }),
  });
}

const toWrite = plan.filter((p) => p.changed);
console.log(`\n대상 ${plan.length}곳 · 값이 달라진 곳 ${toWrite.length}곳 · 건너뜀 ${skipped.length}곳`);
for (const s of skipped) console.log(`  · ${s}`);

const diffs = toWrite
  .filter((p) => p.before.pop500m)
  .map((p) => ({ name: p.name, d: ((p.patch.pop500m - p.before.pop500m) / p.before.pop500m) * 100 }))
  .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log("\n500m 변화가 큰 5곳:");
for (const d of diffs.slice(0, 5)) console.log(`  ${d.name.padEnd(15)} ${d.d >= 0 ? "+" : ""}${d.d.toFixed(1)}%`);

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
console.log("⚠️ 기존점 수요 캐시(ownDemand/marketDemand)는 내일 06시 크론이 다시 쓴다.");
console.log("⚠️ 검증 화면을 한 번 열어야 저장된 적중률이 갱신된다.");
process.exit(0);
