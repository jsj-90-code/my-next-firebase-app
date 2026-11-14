// D28 새 직무 3 「후보지 심사 결과 되짚기」 — 계산 스크립트(읽기만, 쓰기·알림 없음).
//
// 심사 때 본 값(등급·점포팀 최종 예상 매출·V62) vs 개점 뒤 실매출(매출DB 사본 storeEvalExistingStoreSales).
//   - 심사 값: 기존점 문서의 predictedAtConversion(후보지→기존점 전환 때 얼린 값 = "그때 본 값").
//   - 옛 매장(웹 이전 개점) 등급은 DB에 없다 → --grades <csv> 로 덧붙인다
//       (열: storeCode,grade,storeTeamRevenue,developerRevenue · 만원 아닌 원 단위). 회사 PC .playwright-mcp/daou 원자료에서 뽑는다.
//   - 실매출 = PC + 상품, 개점 다음 달부터 "다 찬 달"만(개점 달·이번 달 제외).
//   - 계절: 측정 달 지수로 나눈 값도 같이 낸다(위키 「경쟁점 가동률 측정기」 9절, 매출DB 25곳 2025-10~2026-09).
//
// 쓰는 법: node scripts/d28/screeningReview.mjs [--grades file.csv] [--json out.json] [--grade MAA]
//   --grade 를 주면 그 등급의 "심사 DM 한 줄"을 찍는다(새 후보지 심사 글에 붙일 문안).
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "./env.mjs";

const SEASON = { 1: 1.12, 2: 1.17, 3: 0.97, 4: 0.84, 5: 0.96, 6: 0.93, 7: 1.02, 8: 1.02, 9: 0.88, 10: 1.05, 11: 0.98, 12: 1.07 };
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const won = (v) => (v == null ? "-" : `${Math.round(v / 10000).toLocaleString()}만`);
const pct = (v) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);

const d = db();
const [exSnap, salesSnap] = await Promise.all([
  d.collection("storeEvalExistingStores").get(),
  d.collection("storeEvalExistingStoreSales").get(),
]);
const stores = exSnap.docs.map((x) => ({ id: x.id, ...x.data() }));
const salesBy = new Map();
for (const doc of salesSnap.docs) {
  const s = doc.data();
  if (!salesBy.has(s.storeCode)) salesBy.set(s.storeCode, []);
  salesBy.get(s.storeCode).push(s);
}

// 덧붙일 옛 등급(선택)
const extra = new Map();
const gradesFile = arg("--grades");
if (gradesFile) {
  const lines = readFileSync(gradesFile, "utf8").split(/\r?\n/).filter(Boolean);
  for (const l of lines.slice(1)) {
    const [code, grade, team, dev] = l.split(",").map((x) => x.trim());
    extra.set(code, { grade: grade || null, storeTeamRevenue: Number(team) || null, developerRevenue: Number(dev) || null });
  }
}

const now = new Date(Date.now() + 9 * 3600e3);
const thisYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

const rows = [];
for (const s of stores) {
  const p = s.predictedAtConversion;
  const e = extra.get(s.id);
  const grade = p?.storeTeamGrade ?? e?.grade ?? null;
  if (!grade && !p) continue;
  const openYm = (s.openedAt || "").slice(0, 7);
  const months = (salesBy.get(s.id) || [])
    .filter((m) => m.yearMonth > openYm && m.yearMonth < thisYm)
    .map((m) => {
      const total = (m.pcSales ?? 0) + (m.productSales ?? 0);
      const mo = Number(m.yearMonth.slice(5));
      return { ym: m.yearMonth, total, pc: m.pcSales, util: m.utilizationRate, seasonAdj: total / SEASON[mo] };
    })
    .sort((a, b) => a.ym.localeCompare(b.ym));
  const avg = (k) => (months.length ? months.reduce((a, m) => a + m[k], 0) / months.length : null);
  const actual = avg("total");
  const actualSA = avg("seasonAdj");
  const team = p?.storeTeamRevenue ?? e?.storeTeamRevenue ?? null;
  const v62 = typeof p?.v62Final === "number" ? p.v62Final : null;
  const dev = e?.developerRevenue ?? null;
  rows.push({
    code: s.id, name: s.storeName, openedAt: s.openedAt, candidate: p?.candidateCode ?? null, grade,
    storeTeamRevenue: team, v62, developerRevenue: dev,
    fullMonths: months.length, months: months.map((m) => `${m.ym} ${won(m.total)}`).join(" · "),
    actual, actualSeasonAdj: actualSA,
    ratioTeam: actual && team ? actual / team : null,
    ratioV62: actual && v62 ? actual / v62 : null,
    ratioTeamSA: actualSA && team ? actualSA / team : null,
  });
}

rows.sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""));
console.log(`기준 ${now.toISOString().slice(0, 10)} · 심사 값이 있는 기존점 ${rows.length}곳${gradesFile ? " (옛 등급 파일 포함)" : ""}`);
console.log("| 매장 | 개점 | 등급 | 점포팀 예상 | V62 | 다 찬 달 | 실매출(월평균) | 실/점포팀 | 실/V62 | 계절보정 실/점포팀 |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.name} | ${r.openedAt} | ${r.grade ?? "-"} | ${won(r.storeTeamRevenue)} | ${won(r.v62)} | ${r.fullMonths} | ${won(r.actual)} | ${pct(r.ratioTeam && r.ratioTeam - 1)} | ${pct(r.ratioV62 && r.ratioV62 - 1)} | ${pct(r.ratioTeamSA && r.ratioTeamSA - 1)} |`);
  if (r.months) console.log(`|  ↳ ${r.months} |`);
}

// 등급별 묶음
const byGrade = new Map();
for (const r of rows.filter((r) => r.ratioTeam != null)) {
  if (!byGrade.has(r.grade)) byGrade.set(r.grade, []);
  byGrade.get(r.grade).push(r);
}
console.log("\n등급별(실매출 ÷ 점포팀 예상, 다 찬 달 1개 이상인 곳만)");
for (const [g, list] of [...byGrade].sort()) {
  const med = list.map((r) => r.ratioTeam).sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)];
  console.log(`  ${g}: ${list.length}곳 · 중앙 ${pct(med - 1)} · ${list.map((r) => r.name).join(", ")}`);
}

// 심사 DM 한 줄
export function dmLine(grade, rowsAll, n = 5) {
  const same = rowsAll.filter((r) => r.grade === grade && r.ratioTeam != null).slice(0, n);
  if (same.length === 0) return `같은 등급(${grade}) 개점 매장 실매출 기록 아직 없음`;
  const ratios = same.map((r) => r.ratioTeam);
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const lo = Math.min(...ratios), hi = Math.max(...ratios);
  const few = same.length < 3 ? " ※3곳 미만 — 참고만" : "";
  const range = same.length > 1 ? ` (${Math.round(lo * 100)}~${Math.round(hi * 100)}%)` : "";
  return `같은 등급(${grade}) 최근 개점 ${same.length}곳: 실매출이 점포팀 예상의 평균 ${Math.round(avg * 100)}%${range} — ${same.map((r) => `${r.name.replace(/점$/, "")} ${won(r.actual)}/${won(r.storeTeamRevenue)}`).join(", ")}${few}`;
}
const g = arg("--grade");
const grades = g ? [g] : [...new Set(rows.map((r) => r.grade).filter(Boolean))];
console.log("\n심사 DM 한 줄(예시)");
for (const x of grades) console.log("  " + dmLine(x, rows));

const out = arg("--json");
if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
