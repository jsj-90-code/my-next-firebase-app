// 새로 수집한 기초자료에서 **쓸 만한 신호**를 훑는다 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16): "기존에 적용하고 있지 않은 항목이더라도 이번 수집을 통해서 최대한
// 적중률 궁극으로 갈 수 있는 표본을 찾아서 적용해야 해."
//
// 그래서 지금 산식이 안 쓰는 것까지 전부 후보로 놓는다:
//   · 주거인구 반경 100~1000m (지금은 500m·1km만)
//   · 유동인구 반경 100~1000m (지금은 500m만)
//   · SGIS 사업체수·종사자수 (직장인구 — 한 번도 안 써봤다)
//   · 주택유형(아파트 비율) · 가구구성(1인가구 비율)
//   · 밀집도(500m/1km 비)
//
// ⚠️ **상관은 후보를 찾는 도구지 채택 근거가 아니다.** 2026-09-15에 밀집도 보정이 r=0.660으로
//    유의했는데 실제로 넣으니 MAPE가 30%→48%로 나빠졌다. 여기서 높게 나온 것은 "다음에
//    검정해 볼 것"이지 "넣을 것"이 아니다. 채택은 무작위 대조군을 둔 검정으로 정한다.
//
// 목표를 셋으로 나눠 본다 — 어느 자를 대느냐에 따라 순위가 완전히 바뀌기 때문이다:
//   (A) 실제 월매출           — 매장 크기(PC대수)가 섞여 들어간다
//   (B) PC 1대당 월매출        — 크기를 지운 "자리의 힘"
//   (C) 교과서식 잔차(예측/실제) — 지금 산식이 아직 설명 못 하는 부분
//
//   npx vitest run src/lib/storeEval/_newSignalsScan.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorIp } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook, type TextbookInput } from "./textbookModel";
import type { Competitor } from "./types";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

const RADII = [100, 200, 300, 400, 500, 1000] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** 피어슨 상관. 표본이 적으므로 유의선을 같이 낸다(양측 5%, r > 2/sqrt(n) 근사). */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("새 기초자료 신호 훑기", () => {
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);

  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  type Row = {
    code: string; name: string | null;
    actual: number; pcCount: number;
    signals: Record<string, number>;
    input: TextbookInput;
  };

  const rows: Row[] = [];
  for (const s of stores as any[]) {
    if (s.excludedFromModel || !s.actualMonthlyRevenueAvg) continue;
    const pc = s.evaluationPcCount ?? s.pcCount;
    if (!pc) continue;
    const key = `existing:${s.storeCode}`;
    const fsite = floSites[key];
    const rsite = resSites[key];
    if (!fsite || !rsite) continue;

    const sig: Record<string, number> = {};
    for (const R of RADII) {
      const fr = fsite.radii?.[String(R)];
      if (fr?.selected?.length) {
        const avg = Math.round(mean(fr.selected.slice(-12)));
        sig[`유동${R}m`] = avg;
        const d = fr.demographics;
        if (d) {
          const recent = fr.selected[fr.selected.length - 1];
          const scale = recent > 0 ? avg / recent : 1;
          // 10~30대만 — PC방 주 이용층
          sig[`유동${R}m_10_30대`] = ((d.age10s ?? 0) + (d.age20s ?? 0) + (d.age30s ?? 0)) * scale;
        }
      }
      const rr = rsite.radii?.[String(R)];
      if (rr?.totalPopulation != null) {
        sig[`주거${R}m`] = Number(rr.totalPopulation);
        const p = rr.pops;
        if (p?.age_2_cnt != null) {
          sig[`주거${R}m_10_30대`] = Number(p.age_2_cnt) + Number(p.age_3_cnt) + Number(p.age_4_cnt);
        }
        if (rr.corp?.employee_cnt != null) sig[`종사자${R}m`] = Number(rr.corp.employee_cnt);
        if (rr.corp?.corp_cnt != null) sig[`사업체${R}m`] = Number(rr.corp.corp_cnt);
        const h = rr.house;
        if (h && Number(h.tot_house_cnt) > 0) sig[`아파트비율${R}m`] = Number(h.house_2_cnt) / Number(h.tot_house_cnt);
        const f = rr.family;
        if (f && Number(f.tot_family_cnt) > 0) sig[`1인가구비율${R}m`] = Number(f.family_1_cnt) / Number(f.tot_family_cnt);
      }
    }
    if (sig["주거500m"] && sig["주거1000m"]) sig["주거밀집도(500/1000)"] = sig["주거500m"] / sig["주거1000m"];
    if (sig["유동100m"] && sig["유동500m"]) sig["유동밀집도(100/500)"] = sig["유동100m"] / sig["유동500m"];
    if (sig["종사자500m"] && sig["주거500m"]) sig["직주비(종사자/주거)500m"] = sig["종사자500m"] / sig["주거500m"];

    const code = existingStoreSourceCode(s);
    const cs = compsByCode.get(code) ?? [];
    rows.push({
      code: s.storeCode, name: s.storeName,
      actual: s.actualMonthlyRevenueAvg, pcCount: pc,
      signals: sig,
      input: {
        storeCode: s.storeCode, storeName: s.storeName,
        pcCount: pc, hourlyRate: s.hourlyRate,
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        pop500m: sig["주거500m"] ?? null, pop1km: sig["주거1000m"] ?? null,
        residentAges: null,
        floatingByRadius: { 500: sig["유동500m"] ?? null },
        floatingAgesByRadius: {},
      },
    });
  }

  it("표본이 잡힌다", () => {
    console.log(`표본 ${rows.length}곳 · 신호 ${Object.keys(rows[0]?.signals ?? {}).length}종`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("신호 × 세 가지 목표 상관", () => {
    // (C) 교과서식 잔차 — 기본 파라미터로 한 번 돌려 예측/실제를 얻는다.
    const sc = scoreTextbook(rows.map((r) => ({ input: r.input, actualRevenue: r.actual })), {
      ...DEFAULT_TEXTBOOK_PARAMS, useResidentAgeWeights: false, useFloatingAgeWeights: false,
    });
    const biasByCode = new Map<string, number>();
    for (const r of sc.rows) {
      if (r.predicted != null && r.actual > 0) biasByCode.set(r.storeCode, r.predicted / r.actual - 1);
    }

    const names = [...new Set(rows.flatMap((r) => Object.keys(r.signals)))].sort();
    const n = rows.length;
    const sigLine = 2 / Math.sqrt(n);

    type Out = { name: string; rA: number | null; rB: number | null; rC: number | null; n: number };
    const out: Out[] = [];
    for (const name of names) {
      const sub = rows.filter((r) => Number.isFinite(r.signals[name]));
      if (sub.length < 10) continue;
      const xs = sub.map((r) => r.signals[name]);
      const rA = pearson(xs, sub.map((r) => r.actual));
      const rB = pearson(xs, sub.map((r) => r.actual / r.pcCount));
      const withBias = sub.filter((r) => biasByCode.has(r.code));
      const rC = withBias.length >= 10
        ? pearson(withBias.map((r) => r.signals[name]), withBias.map((r) => biasByCode.get(r.code) as number))
        : null;
      out.push({ name, rA, rB, rC, n: sub.length });
    }

    const fmt = (v: number | null) => (v == null ? "  -   " : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`);
    const star = (v: number | null) => (v != null && Math.abs(v) > sigLine ? "*" : " ");

    console.log(`\n표본 ${n}곳 · 유의선 |r| > ${sigLine.toFixed(3)} (양측 5% 근사)`);
    console.log(`교과서식 기준선: MAPE ${((sc.mape ?? 0) * 100).toFixed(1)}%`);
    console.log(`\n${"신호".padEnd(26)} ${"(A)실매출".padStart(9)} ${"(B)대당매출".padStart(10)} ${"(C)잔차".padStart(9)}`);

    // (B) 대당매출 상관이 큰 순 — "자리의 힘"을 가장 잘 보는 자다.
    out.sort((a, b) => Math.abs(b.rB ?? 0) - Math.abs(a.rB ?? 0));
    for (const o of out) {
      console.log(`${o.name.padEnd(26)} ${fmt(o.rA)}${star(o.rA)} ${fmt(o.rB)}${star(o.rB)}  ${fmt(o.rC)}${star(o.rC)}`);
    }
    expect(out.length).toBeGreaterThan(0);
  });
});
