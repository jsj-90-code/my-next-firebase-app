// 후보지 N003(호구포역점)의 유동인구 500m 한 벌을 바로잡는다.
//
// ── 무엇이 틀렸나 (2026-09-15 확인) ─────────────────────────────────────────
// 저장돼 있던 `floating500Avg = 35,105`는 실제(103,474)의 약 1/3이었다. 연령 6구간과 남성 수까지
// 전부 35,105에 맞춰 일관되게 들어가 있었으므로 오타가 아니라 **다른 자료 한 벌**이다.
// 연령 구성비도 달랐다(기존 60대+ 33%, 실제 27%) — 단순히 3으로 나눈 것도 아니다.
//
// 이 후보지만 `lat/lng`·`roadAddress`·`geocodedAt`·`commercialDataYearMonth`가 전부 비어 있다
// (11곳 중 유일). 정식 수집 경로를 거치지 않고 값이 들어온 것으로 보인다.
//
// ── 왜 고쳐야 하나 ─────────────────────────────────────────────────────────
// 상권성격은 `유동500m ÷ 주거500m`로 정한다(8배↑ 번화가 / 4~8배 혼합 / 4배↓ 주거중심).
//   35,105 / 11,602 = 3.03 -> 주거중심
//  103,474 / 11,602 = 8.92 -> 번화가
// **판정이 뒤집힌다.** 수요 산식 경로가 달라지므로 예상매출도 달라진다.
//
// ── 근거 ───────────────────────────────────────────────────────────────────
// 같은 방법으로 받은 500m 값이 다른 50곳에서는 기존값과 10% 이내로 일치했다. 즉 방법이 아니라
// 이 지점의 값이 틀린 것이다. 사용자도 소상공인365에서 직접 조회해 "10만명 정도"를 확인했다.
//
// 범위: **N003 한 곳만** 고친다. 나머지 50곳은 오차 범위 안이라 건드리지 않는다.
//
//   node scripts/fixCandidateFloatingN003.mjs          # 미리보기
//   node scripts/fixCandidateFloatingN003.mjs --apply  # 실제로 쓴다

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DATA = ".local-tools/sbiz-floating-population.json";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
const CODE = "N003";
const RADIUS = 500;
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

const site = collected.sites[`candidate:${CODE}`];
const entry = site?.radii?.[RADIUS];
if (!entry?.selected?.length || !entry.demographics) {
  console.error(`${CODE}의 ${RADIUS}m 자료가 수집 파일에 없다.`);
  process.exit(1);
}

const candidate = snap.candidates.find((c) => (c.code ?? c.id) === CODE);
if (!candidate) {
  console.error(`${CODE} 후보지를 스냅샷에서 못 찾았다.`);
  process.exit(1);
}

// 다른 반경과 같은 기준으로 만든다 — 최근 12개월 평균, 연령·성별은 같은 배율로 맞춤.
const months = entry.selected;
const last12 = months.slice(-12);
const avg = Math.round(last12.reduce((a, b) => a + b, 0) / last12.length);
const recent = months.at(-1);
const scale = recent > 0 ? avg / recent : 1;
const d = entry.demographics;
const s = (v) => (v == null ? null : Math.round(v * scale));

const patch = {
  floating500Avg: avg,
  floating500Male: s(d.male),
  floating500_10s: s(d.age10s),
  floating500_20s: s(d.age20s),
  floating500_30s: s(d.age30s),
  floating500_40s: s(d.age40s),
  floating500_50s: s(d.age50s),
  floating500_60plus: s(d.age60plus),
};

const before = {
  floating500Avg: candidate.floating500Avg,
  floating500Male: candidate.floating500Male,
  floating500_10s: candidate.floating500_10s,
  floating500_20s: candidate.floating500_20s,
  floating500_30s: candidate.floating500_30s,
  floating500_40s: candidate.floating500_40s,
  floating500_50s: candidate.floating500_50s,
  floating500_60plus: candidate.floating500_60plus,
};

console.log(`${CODE} ${candidate.name} — 유동 ${RADIUS}m 교정\n`);
for (const k of Object.keys(patch)) {
  console.log(`  ${k.padEnd(20)} ${String(before[k]).padStart(8)} -> ${String(patch[k]).padStart(8)}`);
}
const pop500 = candidate.pop500m;
if (pop500) {
  console.log(`\n유동/주거 비율: ${(before.floating500Avg / pop500).toFixed(2)} -> ${(patch.floating500Avg / pop500).toFixed(2)}`);
  console.log("  (8배 이상 번화가 / 4~8배 혼합 / 4배 미만 주거중심)");
}

if (!APPLY) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다.");
  process.exit(0);
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
await db.collection("storeEvalCandidates").doc(candidate.id).set({ ...patch, updatedAt: Date.now() }, { merge: true });

console.log("\n썼다. 후보지 결과 화면을 열면 재계산된다.");
console.log("⚠️ 저장된 평가결과(storeEvalResults)는 아직 옛 입력 기준이다 — 화면을 한 번 열어 갱신할 것.");
process.exit(0);
