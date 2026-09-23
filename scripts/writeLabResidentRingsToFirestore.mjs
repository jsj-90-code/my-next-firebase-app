// SGIS 반경 집계에서 **1km 밖 고리 인구**(1.5km·2km·5km 누적 원, 연령 분해)를 실험실 전용
// 컬렉션 `storeEvalLabResidentRings`에 넣는다. (2026-09-23. 사용자 승인: "하셈")
//
// ── 왜 실험실 전용인가 ────────────────────────────────────────────────────
// 이 값은 실험실 산식의 `residentRingDecayM`(1km 밖 고리 감쇠)만 읽는다. 운영 V62는 모른다.
// 운영 기존점 문서에 넣으면 나중에 운영이 조용히 읽게 될 수 있어 따로 둔다
// (로드뷰 판정·QSC와 같은 결정 — `storeEvalLab*` 컬렉션).
//
// ── 문서 모양 ─────────────────────────────────────────────────────────────
//   id  = "existing:<매장코드>" | "candidate:<후보지코드>"
//   { key, kind, code, name, baseYear, collectedAt,
//     rings: { "1500": {age0s..age60plus}, "2000": {...}, "5000": {...} },   ← **누적 원** 인구(고리가 아니다)
//     totals: { "1500": n, "2000": n, "5000": n }, updatedAt }
//   연령 7구간 변환은 src/lib/storeEval/labResidentRings.ts 와 같은 대응(age_1~9 -> 0대·10대·…·60+).
//   여기서 다시 적는 이유: 스크립트는 .ts를 import 못 한다. **두 벌이니 바뀌면 같이 고칠 것.**
//
//   node scripts/writeLabResidentRingsToFirestore.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeLabResidentRingsToFirestore.mjs --apply   # 실제로 쓴다(달라진 문서만)

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const DATA = ".local-tools/sgis-resident-population.json";
const COLLECTION = "storeEvalLabResidentRings";
const RADII = ["1500", "2000", "5000"];
const APPLY = process.argv.includes("--apply");

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return; }
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
if (!clientEmail || !privateKey || !projectId) { console.error("FIREBASE_* 환경변수가 필요하다."); process.exit(1); }
if (!existsSync(DATA)) { console.error(`${DATA}이 없다.`); process.exit(1); }

const file = JSON.parse(readFileSync(DATA, "utf8"));

/** SGIS age_1~9 -> 7구간. age_2가 없으면 연령 분해가 없는 반경(null). */
function agesOf(pops) {
  if (!pops || pops.age_2_cnt == null) return null;
  const n = (k) => Number(pops[k] ?? 0);
  return {
    age0s: n("age_1_cnt"), age10s: n("age_2_cnt"), age20s: n("age_3_cnt"), age30s: n("age_4_cnt"),
    age40s: n("age_5_cnt"), age50s: n("age_6_cnt"), age60plus: n("age_7_cnt") + n("age_8_cnt") + n("age_9_cnt"),
  };
}

const plan = [];
const skipped = [];
for (const [key, site] of Object.entries(file.sites ?? {})) {
  if (site.kind !== "existing" && site.kind !== "candidate") { skipped.push(`${key} — kind ${site.kind}`); continue; }
  const rings = {}, totals = {};
  for (const r of RADII) {
    const rad = site.radii?.[r];
    const a = agesOf(rad?.pops);
    if (!a) continue;
    // 연령합이 총인구와 어긋나면 매핑이 바뀐 것이다 — 조용히 넣지 않는다.
    const sum = Object.values(a).reduce((p, q) => p + q, 0);
    if (rad.totalPopulation && Math.abs(sum - rad.totalPopulation) / rad.totalPopulation > 0.01) {
      skipped.push(`${key} ${site.name} ${r}m — 연령합 ${sum} vs 총인구 ${rad.totalPopulation}`);
      continue;
    }
    rings[r] = a; totals[r] = rad.totalPopulation ?? sum;
  }
  if (!Object.keys(rings).length) { skipped.push(`${key} ${site.name} — 고리 자료 없음`); continue; }
  const id = `${site.kind}:${site.code}`;
  plan.push({
    id,
    doc: { key: id, kind: site.kind, code: String(site.code), name: site.name ?? null, baseYear: file.baseYear ?? null,
      collectedAt: file.collectedAt ?? null, rings, totals },
  });
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
const current = await loadCollectionMap(db, COLLECTION);
// rings는 중첩 객체라 needsWrite의 얕은 비교로는 항상 "다르다"가 나온다 — 문자열로 펴서 비교한다.
const flat = (d) => ({ key: d.key, kind: d.kind, code: d.code, name: d.name, baseYear: d.baseYear, collectedAt: d.collectedAt,
  rings: JSON.stringify(d.rings), totals: JSON.stringify(d.totals) });
for (const p of plan) { const c = current.get(p.id); p.changed = needsWrite(c ? flat(c) : undefined, flat(p.doc), { merge: false }); }
const toWrite = plan.filter((p) => p.changed);

console.log(`\n대상 ${plan.length}곳 (기존점 ${plan.filter((p) => p.doc.kind === "existing").length} · 후보지 ${plan.filter((p) => p.doc.kind === "candidate").length})`
  + ` · 값이 달라진 곳 ${toWrite.length}곳 · 건너뜀 ${skipped.length}건 · 컬렉션에 이미 ${current.size}건`);
for (const s of skipped) console.log(`  · ${s}`);
const ratio = plan.map((p) => p.doc.totals["2000"] && p.doc.totals["1500"] ? p.doc.totals["2000"] / p.doc.totals["1500"] : null).filter(Boolean).sort((a, b) => a - b);
if (ratio.length) console.log(`\n2km÷1.5km 총인구 배율 — 중앙 ${ratio[Math.floor(ratio.length / 2)].toFixed(2)} (범위 ${ratio[0].toFixed(2)}~${ratio[ratio.length - 1].toFixed(2)}) · 원 넓이 비 1.78`);
console.log("\n예시 2곳:");
for (const p of plan.slice(0, 2)) console.log(`  ${p.id} ${p.doc.name}: 10~20대 1.5km ${p.doc.rings["1500"]?.age10s + p.doc.rings["1500"]?.age20s} · 2km ${p.doc.rings["2000"]?.age10s + p.doc.rings["2000"]?.age20s} · 5km ${p.doc.rings["5000"]?.age10s + p.doc.rings["5000"]?.age20s}`);

if (!APPLY) { console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다."); process.exit(0); }

let written = 0;
for (const p of toWrite) { await db.collection(COLLECTION).doc(p.id).set({ ...p.doc, updatedAt: Date.now() }); written++; }
console.log(`\n${written}곳에 썼다 -> ${COLLECTION}`);
console.log("residentRingDecayM이 0(꺼짐)이라 예측은 안 바뀐다. 실험실 화면이 고리 인구를 읽을 수 있게 된 것뿐이다.");
process.exit(0);
