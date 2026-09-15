// 수집한 기초자료를 꼼꼼히 검사한다 (2026-09-16 신설, 읽기 전용).
//
// 사용자 방향(2026-09-16): "교과서식 산식은 기초 탄탄히 준비해서 궁극의 적중률을 달성할 수
// 있도록 할 거야. 돌아가더라도 디테일하게 꼼꼼히 하는 게 중요해. 기초데이터 수집부터."
//
// 자동 수집은 사람 손보다 일관되지만 **조용히 틀릴 수 있다.** 좌표계를 섞으면 에러가 아니라
// 엉뚱한 값이 오고, 좌표가 틀리면 그럴듯한 다른 동네 값이 온다. 그래서 값 자체가 아니라
// **값들 사이에 반드시 성립해야 하는 관계**를 검사한다:
//
//   1) 단조성 — 반경이 커지면 인구·유동·사업체는 줄 수 없다. 줄면 좌표나 응답이 틀린 것이다.
//   2) 합 일치 — 연령 9구간 합 = 총인구, 주택유형 합 = 총주택, 가구 합 = 총가구.
//   3) 결측 — 어느 지점의 어느 반경이 비었는지. 비면 산식이 그 지점을 수요 0으로 본다.
//   4) 두 출처 교차검증 — 유동(소상공인365)과 주거(SGIS)는 좌표계가 다르다(5181/5179).
//      한쪽만 이상하면 그 출처의 문제고, 둘 다 이상하면 좌표가 틀린 것이다.
//   5) 이상치 — 반경 대비 밀도가 터무니없는 지점.
//
//   node scripts/auditCollectedBaseData.mjs
//
// 운영 DB를 건드리지 않는다. .local-tools의 수집 JSON만 읽는다.

import { existsSync, readFileSync } from "node:fs";

const FLOAT = ".local-tools/sbiz-floating-population.json";
const RESI = ".local-tools/sgis-resident-population.json";
const GEO = ".local-tools/geocoded-sites.json";
const TABS = ".local-tools/sbiz-report-tabs.json";

const RADII = [100, 200, 300, 400, 500, 1000];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const num = (v) => (v == null || v === "" ? null : Number(v));

for (const f of [FLOAT, RESI]) {
  if (!existsSync(f)) {
    console.error(`${f}이 없다. 수집을 먼저 돌려라.`);
    process.exit(1);
  }
}

const floating = JSON.parse(readFileSync(FLOAT, "utf8"));
const resident = JSON.parse(readFileSync(RESI, "utf8"));
const floSites = floating.sites ?? floating;
const resSites = resident.sites ?? resident;
const geo = existsSync(GEO) ? JSON.parse(readFileSync(GEO, "utf8")) : null;
const tabs = existsSync(TABS) ? JSON.parse(readFileSync(TABS, "utf8")) : null;
const tabSites = tabs ? (tabs.sites ?? tabs) : {};

const problems = [];
const add = (site, kind, msg) => problems.push({ site, kind, msg });

// ── 1) 결측 ────────────────────────────────────────────────────────────────
const allKeys = new Set([...Object.keys(floSites), ...Object.keys(resSites)]);
console.log(`지점 ${allKeys.size}곳 (유동 ${Object.keys(floSites).length} · 주거 ${Object.keys(resSites).length} · 리포트탭 ${Object.keys(tabSites).length})\n`);

const floatingAvg = new Map(); // key -> {radius: avg}
const residentTot = new Map();

for (const key of allKeys) {
  const fs = floSites[key];
  const rs = resSites[key];
  const name = fs?.name ?? rs?.name ?? key;
  if (!fs) add(name, "결측", "유동인구 자료가 통째로 없다");
  if (!rs) add(name, "결측", "주거인구 자료가 통째로 없다");

  const fAvg = {};
  const rTot = {};
  for (const R of RADII) {
    const fr = fs?.radii?.[String(R)];
    if (!fr || !fr.selected || fr.selected.length === 0) {
      if (fs) add(name, "결측", `유동 ${R}m 없음`);
    } else {
      const last12 = fr.selected.slice(-12);
      if (last12.length < 12) add(name, "자료길이", `유동 ${R}m가 ${last12.length}개월뿐이다(12개월 평균이 안 된다)`);
      fAvg[R] = Math.round(mean(last12));
      if (fAvg[R] <= 0) add(name, "값이상", `유동 ${R}m 평균이 ${fAvg[R]}이다`);
    }

    const rr = rs?.radii?.[String(R)];
    if (!rr || rr.totalPopulation == null) {
      if (rs) add(name, "결측", `주거 ${R}m 없음`);
    } else {
      rTot[R] = Number(rr.totalPopulation);
      if (!(rTot[R] > 0)) add(name, "값이상", `주거 ${R}m 총인구가 ${rTot[R]}이다`);

      // ── 2) 합 일치 ────────────────────────────────────────────────────
      const p = rr.pops;
      if (p && p.age_1_cnt != null) {
        let s = 0;
        for (let i = 1; i <= 9; i++) s += num(p[`age_${i}_cnt`]) ?? 0;
        const t = num(p.tot_ppltn_cnt) ?? rTot[R];
        if (t > 0 && Math.abs(s - t) / t > 0.01) {
          add(name, "합불일치", `주거 ${R}m 연령합 ${s} vs 총인구 ${t} (${(((s - t) / t) * 100).toFixed(1)}%)`);
        }
      } else if (rr.totalPopulation != null) {
        add(name, "결측", `주거 ${R}m 연령 분해 없음`);
      }

      const h = rr.house;
      if (h && h.tot_house_cnt != null) {
        let s = 0;
        for (let i = 1; i <= 6; i++) s += num(h[`house_${i}_cnt`]) ?? 0;
        const t = num(h.tot_house_cnt);
        if (t > 0 && Math.abs(s - t) / t > 0.01) add(name, "합불일치", `주택유형합 ${s} vs 총주택 ${t} (${R}m)`);
      }

      const fam = rr.family;
      if (fam && fam.tot_family_cnt != null) {
        let s = 0;
        for (let i = 1; i <= 3; i++) s += num(fam[`family_${i}_cnt`]) ?? 0;
        const t = num(fam.tot_family_cnt);
        if (t > 0 && Math.abs(s - t) / t > 0.01) add(name, "합불일치", `가구구분합 ${s} vs 총가구 ${t} (${R}m)`);
      }
    }
  }
  floatingAvg.set(key, fAvg);
  residentTot.set(key, rTot);
}

// ── 3) 단조성 ─────────────────────────────────────────────────────────────
// 반경이 커지면 원이 이전 원을 포함하므로 값이 줄 수 없다. 줄면 좌표/응답이 틀린 것이다.
function checkMonotonic(map, label) {
  for (const [key, vals] of map) {
    const name = floSites[key]?.name ?? resSites[key]?.name ?? key;
    const present = RADII.filter((R) => vals[R] != null);
    for (let i = 1; i < present.length; i++) {
      const prev = present[i - 1];
      const cur = present[i];
      if (vals[cur] < vals[prev]) {
        const drop = ((vals[prev] - vals[cur]) / vals[prev]) * 100;
        add(name, "단조성위반", `${label} ${prev}m ${vals[prev].toLocaleString()} → ${cur}m ${vals[cur].toLocaleString()} (${drop.toFixed(1)}% 감소)`);
      }
    }
  }
}
checkMonotonic(floatingAvg, "유동");
checkMonotonic(residentTot, "주거");

// ── 4) 두 출처 교차검증 ────────────────────────────────────────────────────
// 같은 좌표로 두 출처를 조회했다. 좌표가 틀렸다면 둘 다 이상해야 한다.
// 밀도(인구/면적)가 전 지점 중앙값에서 크게 벗어나는 곳을 후보로 뽑고, 두 출처 모두
// 벗어났는지(→ 좌표 의심) 한쪽만인지(→ 그 출처 의심)를 가른다.
function densities(map, R) {
  const area = Math.PI * R * R; // m^2
  const out = [];
  for (const [key, vals] of map) {
    if (vals[R] == null) continue;
    out.push({ key, d: vals[R] / area });
  }
  return out;
}
function medianOf(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
const suspects = new Map();
for (const [map, label] of [[floatingAvg, "유동"], [residentTot, "주거"]]) {
  const ds = densities(map, 500);
  const med = medianOf(ds.map((x) => x.d));
  for (const { key, d } of ds) {
    const ratio = d / med;
    if (ratio > 4 || ratio < 0.25) {
      const cur = suspects.get(key) ?? [];
      cur.push(`${label} 밀도가 중앙값의 ${ratio.toFixed(2)}배`);
      suspects.set(key, cur);
    }
  }
}

// ── 5) 좌표 품질 ──────────────────────────────────────────────────────────
let looseCoords = [];
if (geo) {
  const sites = geo.sites ?? geo;
  for (const [key, v] of Object.entries(sites)) {
    if (v && v.method === "쉼표앞") looseCoords.push(v.name ?? key);
  }
}

// ── 보고 ──────────────────────────────────────────────────────────────────
const byKind = new Map();
for (const p of problems) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);

console.log("=== 문제 요약 ===");
if (problems.length === 0) console.log("  없음");
for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${kind}: ${list.length}건`);
}

for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n--- ${kind} (${list.length}건) ---`);
  for (const p of list.slice(0, 25)) console.log(`  ${p.site}: ${p.msg}`);
  if (list.length > 25) console.log(`  … 외 ${list.length - 25}건`);
}

console.log(`\n=== 밀도 이상치 (두 출처 교차검증) ===`);
if (suspects.size === 0) console.log("  없음");
for (const [key, reasons] of suspects) {
  const name = floSites[key]?.name ?? resSites[key]?.name ?? key;
  const verdict = reasons.length >= 2 ? "⚠️ 두 출처 모두 이상 — 좌표를 의심한다" : "한쪽만 이상 — 그 출처를 의심한다";
  console.log(`  ${name}: ${reasons.join(" · ")} → ${verdict}`);
}

console.log(`\n=== 좌표 정밀도 ===`);
console.log(`  건물주소로 잡은 지점(복수 호실): ${looseCoords.length}곳`);
if (looseCoords.length) console.log(`  ${looseCoords.join(", ")}`);
console.log("  ※ 500m 이상에선 무시할 오차지만 100m 원에서는 결과가 갈린다.");

console.log(`\n=== 리포트 탭 ===`);
console.log(`  수집 완료 ${Object.keys(tabSites).length} / ${allKeys.size}곳`);
