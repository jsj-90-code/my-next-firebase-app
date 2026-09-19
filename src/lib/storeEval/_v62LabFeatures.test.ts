// 실험실에서 나온 변수를 **운영 V62**에 하나씩 태워 본다 (2026-09-19)
//
// 사용자(2026-09-19): *"v62에 실험실데이터 조합 잠시 찾아보고, 적용해보자. (...) 실험실데이터
// 무조건 mape로 가는 게 아니라 실험실에서 나온 내용 중 적절한 요소가 아닌 것들, 그니까 우리가
// 이 내용은 아니다라고 정정한 것들도 함께 적용해보자."*
//
// ══════════════════════════════════════════════════════════════════════════
// 이 설계가 왜 좋은가 — **기각된 항목이 위약군이 된다**
// ══════════════════════════════════════════════════════════════════════════
// 실험실이 "이건 아니다"라고 정정한 것들을 **똑같이** V62에 태운다. 그러면:
//
//   채택군만 좋아지고 기각군은 안 좋아진다  -> 진짜 신호다
//   기각군도 똑같이 좋아진다              -> **V62가 아무 칸이나 하나 더 주면 좋아지는 것**
//                                        = 과적합. 채택군의 개선도 믿을 수 없다
//
// 위약군 없이 채택군만 태우면 "좋아졌다"를 반드시 얻게 된다(자유도가 하나 늘어나니까).
// 그래서 **기각군을 같이 태우는 게 판정의 핵심**이다.
//
// 여기에 **순수 잡음 대조군**(난수 피처 N회)까지 붙여 p값을 낸다.
//
// ── V62에 칸을 어떻게 더하나 ────────────────────────────────────────────────
// `ValidationStoreInput.competitorDistanceRatio`가 **2026-09-11에 만든 실험용 피처 슬롯**이다
// (경쟁점 평균거리 실험의 잔재). 값이 있으면 `empiricalFeaturesFor`가 피처를 한 칸 더 붙이고
// `buildMinCoefficients`도 하한선 0으로 같이 늘어난다. **운영 코드를 한 줄도 안 고치고**
// 아무 변수나 태워 볼 수 있다.
//   ⚠️ 전 매장에 넣거나 전 매장에서 빼야 한다(섞이면 길이 불일치로 학습이 null이 된다).
//
// ── 판정 ──────────────────────────────────────────────────────────────────
//   V62의 목표 4개 중 **±10%만 미달**이다(2026-09-10 진단). 그래서 ±10%를 먼저 본다.
//   그리고 MAPE·중앙·±20%를 같이 본다(2026-09-18 함정 1).
//   `runUsageCohortValidation`은 **리브원아웃**이다 — 채점 대상은 학습에서 빠진다.
//   ⚠️ 계수 고착 검사: 하한선에 붙은 계수가 늘면, 좋아져도 기각이다(2026-09-10 확립).
//
// ⚠️ 누출 금지 — 실측 가동률·실매출이 들어간 값(필요 점유율 등)은 절대 피처로 쓰지 않는다.
// ⚠️ 후보지 가용성 — 후보지에 없는 값은 채택해도 후보지 예측이 안 바뀐다(QSC가 그 경우다).
//
// 실행:
//   npx vitest run src/lib/storeEval/_v62LabFeatures.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  computeCompetitorAppliedPcCount, computeCompetitorInvestigationSummary, computeCompetitorScores,
  computeCompetitorZoneComposition, computeOwnZoneComposition, computeSpecScore, empiricalFeaturesFor,
  getV62Rate, resolveZoneCompositionScore, summarizeValidationRows, toV61TrainingStore,
  type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, predictUsageRevenue, runUsageCohortValidation } from "./usageRevenue";
import { buildLabRows, qscInWindowAverage, rivalQualityParts, utilizationByStore, type QscRecord } from "./labInput";
import { labComputeSpecScore } from "./labSpecScore";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import { computeLabZoneComposition } from "./labZoneComposition";
import type { Competitor, ExistingStore, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const NBR_FILE = ".local-tools/kakao-neighborhood.json";
const SGIS_FILE = ".local-tools/sgis-resident-population.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 2) => (v == null ? "     -" : `${(v * 100).toFixed(d)}%`);

describeIf("실험실 변수를 V62에 태워 본다", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) =>
    wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`)) as never[];

  const competitorsByLookup = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    competitorsByLookup.set(c.candidateCode, [...(competitorsByLookup.get(c.candidateCode) ?? []), c]);
  }
  const locByLookup = new Map(locationEvaluations.map((l) => [l.candidateCode, l]));

  // ── V62 입력 (화면·검증이 쓰는 경로 그대로 — _baseDataSwap과 동일) ──────────
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores as ExistingStore[], allCompetitors, locationEvaluations, settings);
  const baseInputs: ValidationStoreInput[] = stores.map((s) => {
    const lookupCode = existingStoreSourceCode(s);
    const loc = (locByLookup.get(lookupCode) ?? null) as never;
    const competitors = competitorsByLookup.get(lookupCode) ?? [];
    return {
      storeCode: s.storeCode, storeName: s.storeName,
      brand: s.brandType ?? (loc as { brandType?: string } | null)?.brandType ?? null,
      openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0,
      franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand,
        { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore },
        competitors, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType, specialDemandIntensity: s.specialDemandIntensity,
      inflowRestriction: (loc as { inflowRestriction?: number } | null)?.inflowRestriction ?? null,
      visibilityScore: (loc as { visibilityScore?: number } | null)?.visibilityScore ?? null,
      preemptionScore: (loc as { preemptionScore?: number } | null)?.preemptionScore ?? null,
      hasLocationEvaluation: loc != null,
      floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(competitors),
      sheetV61Predicted: s.v61Predicted,
    } as ValidationStoreInput;
  });

  const measure = (extra: Map<string, number> | null) => {
    const inputs = extra
      ? baseInputs.map((i) => ({ ...i, competitorDistanceRatio: extra.get(i.storeCode) ?? 0 }))
      : baseInputs;
    const { rows, fullModel: model } = runUsageCohortValidation(inputs, sales, settings) as never as {
      rows: { brand: string | null; includedInCoreAccuracy: boolean }[];
      fullModel: { usage: { coefficients: number[] }; product: { coefficients: number[] } } | null;
    };
    const coreRows = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    const s = summarizeValidationRows(coreRows as never, {
      mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio,
      maxBias: settings.maxAvgBias,
    });
    return { s, model };
  };

  // ── 실험실 쪽 값들 ────────────────────────────────────────────────────────
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id; if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const labRows = buildLabRows({ stores, compsByCode: competitorsByLookup, utilByStore, settings, qscByStoreCode });
  const labScore = scoreTextbook(labRows, DEFAULT_TEXTBOOK_PARAMS);
  const labFull = fittedParams(DEFAULT_TEXTBOOK_PARAMS, labScore);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawByCode = new Map<string, any>();
  for (const s of snap.existingStores ?? []) rawByCode.set(s.storeCode, s);

  type NbrSite = { code?: string; pcRooms?: { docs?: { category?: string; distanceM?: number | null }[] } };
  const nbrByCode = new Map<string, NbrSite>();
  if (existsSync(NBR_FILE)) {
    const n = JSON.parse(readFileSync(NBR_FILE, "utf8")) as { sites: Record<string, NbrSite> };
    for (const v of Object.values(n.sites)) if (v.code) nbrByCode.set(String(v.code), v);
  }
  const popByCode = new Map<string, Record<string, number | null>>();
  if (existsSync(SGIS_FILE)) {
    const g = JSON.parse(readFileSync(SGIS_FILE, "utf8")) as {
      sites: Record<string, { code?: string; radii?: Record<string, { totalPopulation?: number | null }> }>;
    };
    for (const v of Object.values(g.sites)) {
      if (!v.code) continue;
      const m: Record<string, number | null> = {};
      for (const [r, x] of Object.entries(v.radii ?? {})) m[r] = x?.totalPopulation ?? null;
      popByCode.set(String(v.code), m);
    }
  }

  /**
   * 값 지도를 만든다. **비는 매장은 표본 평균으로 채운다.**
   *
   * 왜 평균인가: 피처는 전 매장에 있거나 전 매장에 없어야 한다(섞이면 길이 불일치로 학습이
   * null). 그런데 QSC는 29곳, 실험실 행은 38곳뿐이라 결측이 생긴다. 평균은 표준화 후 0이
   * 되어 **"모른다 = 중립"**이 된다 — 없는 값을 지어내지 않는 이 저장소의 관행과 같다.
   *
   * ⚠️ 대치가 많을수록 그 후보는 **불리하게** 측정된다(변별력이 희석된다). 그래서 대치 건수를
   *    같이 찍는다. 대치가 많은데도 좋아지면 그건 진짜 신호일 가능성이 오히려 높다.
   */
  const build = (f: (code: string) => number | null) => {
    const raw = new Map<string, number | null>();
    for (const i of baseInputs) {
      const v = f(i.storeCode);
      raw.set(i.storeCode, v != null && Number.isFinite(v) ? v : null);
    }
    const have = [...raw.values()].filter((v): v is number => v != null);
    if (have.length < 10) return null;
    const avg = have.reduce((a, b) => a + b, 0) / have.length;
    const m = new Map<string, number>();
    for (const [k, v] of raw) m.set(k, v ?? avg);
    return { map: m, imputed: raw.size - have.length, total: raw.size };
  };

  const labByCode = new Map(labRows.map((r) => [r.input.storeCode, r]));
  const textbookUtil = (code: string) => {
    const r = labByCode.get(code); if (!r) return null;
    return computeTextbook(r.input, labFull).utilization ?? null;
  };
  const centrality = (code: string) => labByCode.get(code)?.input.location?.centrality ?? null;
  const direction = (code: string) => labByCode.get(code)?.input.location?.direction ?? null;
  const sdMul = (code: string) => {
    const t = labByCode.get(code)?.input.specialDemandType ?? "없음";
    return Math.log(DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers[t] ?? 1);
  };
  const outsideCount = (code: string) => {
    const nb = nbrByCode.get(code); if (!nb) return null;
    const pcs = (nb.pcRooms?.docs ?? []).filter((d) => (d.category ?? "").includes("PC방"));
    return pcs.filter((d) => (d.distanceM ?? 9e9) > 500 && (d.distanceM ?? 9e9) > 30).length;
  };
  const pop2over1 = (code: string) => {
    const p = popByCode.get(code);
    const a = p?.["1000"], b = p?.["2000"];
    return a && b ? b / a : null;
  };

  // ══════════════════════════════════════════════════════════════════════════
  const CANDIDATES: { group: "채택" | "기각"; label: string; avail: string; f: (c: string) => number | null }[] = [
    // ── 실험실이 채택했거나 관문을 통과한 것들 ──
    { group: "채택", label: "QSC 관리지수 log(q/92.6)", avail: "후보지 없음 ⚠️",
      f: (c) => { const q = qscByStoreCode.get(c); return q ? Math.log(q / 92.6) : null; } },
    { group: "채택", label: "상권 중심도 ν", avail: "후보지 있음", f: centrality },
    { group: "채택", label: "교과서식 예측 가동률", avail: "후보지 있음", f: textbookUtil },
    { group: "채택", label: "특수수요 배수 log(m)", avail: "후보지 있음", f: sdMul },
    // ── 실험실이 "이건 아니다"라고 정정한 것들 = **위약군** ──
    { group: "기각", label: "편심도 ω (09-18 기각)", avail: "-", f: direction },
    { group: "기각", label: "2km 대체 PC방 수 (09-19 기각)", avail: "-", f: outsideCount },
    { group: "기각", label: "주거 2km/1km 비 (09-19 기각)", avail: "-", f: pop2over1 },
    { group: "기각", label: "log(주거 1km) (09-18 인구^b 기각)", avail: "-",
      f: (c) => { const p = rawByCode.get(c)?.pop1km; return p ? Math.log(p) : null; } },
    { group: "기각", label: "유동 400m/100m 비 (안 쓰는 값)", avail: "-",
      f: (c) => { const r = rawByCode.get(c); return r?.floating100Avg ? r.floating400Avg / r.floating100Avg : null; } },
  ];

  const floorsAt = (model: { usage: { coefficients: number[] }; product: { coefficients: number[] } } | null) => {
    if (!model) return null;
    const near = (v: number, f: number) => Math.abs(v - f) < 1e-6;
    const FLOORS = [0.03, 0.05, 0.06, 0];
    const count = (cs: number[]) => cs.filter((v) => FLOORS.some((f) => near(v, f))).length;
    return count(model.usage.coefficients) + count(model.product.coefficients);
  };

  it("(1) 기준선 — 지금 V62", () => {
    const { s, model } = measure(null);
    console.log(`\n══ (1) V62 기준선 (리브원아웃 · 정식검증군) ══`);
    console.log(`  MAPE ${pct(s.meanAbsoluteErrorPct)} · 중앙 ${pct(s.medianAbsoluteErrorPct)}` +
      ` · ±10% ${pct(s.within10PctRatio, 0)} · ±20% ${pct(s.within20PctRatio, 0)} · n=${s.sampleCount}`);
    console.log(`  하한선에 붙은 계수 ${floorsAt(model)}개`);
    console.log(`  (V62 목표 4개 중 ±10%만 미달 — 2026-09-10 진단. 그래서 ±10%를 먼저 본다)`);
    expect(s.sampleCount).toBeGreaterThan(20);
  });

  it("(2) 실험실 변수를 하나씩 태운다 — 채택군과 **기각군(위약)**", () => {
    const base = measure(null);
    const b = base.s;
    console.log(`\n══ (2) 피처 한 칸 추가 ══`);
    console.log(`  ${"".padEnd(34)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}` +
      `${"하한선".padStart(7)}${"대치".padStart(9)}   후보지`);
    console.log(`  ${"기준선 (칸 없음)".padEnd(34)}${pct(b.meanAbsoluteErrorPct).padStart(9)}` +
      `${pct(b.medianAbsoluteErrorPct).padStart(9)}${pct(b.within10PctRatio, 0).padStart(8)}` +
      `${pct(b.within20PctRatio, 0).padStart(8)}${String(floorsAt(base.model)).padStart(7)}`);
    for (const grp of ["채택", "기각"] as const) {
      console.log(`  ── ${grp === "채택" ? "실험실 채택군" : "실험실 **기각**군 = 위약"} ──`);
      for (const c of CANDIDATES.filter((x) => x.group === grp)) {
        const built = build(c.f);
        if (!built) { console.log(`  ${c.label.padEnd(34)}  값이 있는 매장이 10곳 미만 — 건너뜀`); continue; }
        const { s, model } = measure(built.map);
        const d10 = (s.within10PctRatio ?? 0) - (b.within10PctRatio ?? 0);
        console.log(`  ${c.label.padEnd(34)}${pct(s.meanAbsoluteErrorPct).padStart(9)}` +
          `${pct(s.medianAbsoluteErrorPct).padStart(9)}${pct(s.within10PctRatio, 0).padStart(8)}` +
          `${pct(s.within20PctRatio, 0).padStart(8)}${String(floorsAt(model)).padStart(7)}` +
          `${(built.imputed ? `${built.imputed}곳대치` : "").padStart(9)}   ${c.avail}` +
          `${d10 > 0.001 ? "  ↑" : d10 < -0.001 ? "  ↓" : ""}`);
      }
    }
    console.log(`\n  ⚠️ **기각군이 채택군만큼 좋아지면 둘 다 잡음이다.** 칸을 하나 더 주면`);
    console.log(`     자유도가 늘어 표본 안에서는 늘 좋아진다 — 리브원아웃이라도 완전히 못 막는다.`);
    console.log(`  ⚠️ 하한선에 붙은 계수가 **늘면 기각**이다(2026-09-10 확립).`);
    expect(b.sampleCount).toBeGreaterThan(20);
  });

  it("(3) 순수 잡음 대조군 — 난수 칸을 넣으면 얼마나 좋아지나", { timeout: 300000 }, () => {
    const TRIALS = 40;
    let seed = 20260919;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const mapes: number[] = [], w10s: number[] = [], meds: number[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const m = new Map<string, number>();
      for (const i of baseInputs) m.set(i.storeCode, rnd());
      const { s } = measure(m);
      if (s.meanAbsoluteErrorPct != null) mapes.push(s.meanAbsoluteErrorPct);
      if (s.within10PctRatio != null) w10s.push(s.within10PctRatio);
      if (s.medianAbsoluteErrorPct != null) meds.push(s.medianAbsoluteErrorPct);
    }
    const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
    const base = measure(null).s;
    console.log(`\n══ (3) 난수 칸 ${TRIALS}회 — "아무 값이나 하나 더 주면" 어디까지 가나 ══`);
    console.log(`  ${"".padEnd(10)}${"기준선".padStart(9)}${"난수 5%".padStart(10)}${"난수 중앙".padStart(10)}${"난수 95%".padStart(10)}`);
    console.log(`  ${"MAPE".padEnd(10)}${pct(base.meanAbsoluteErrorPct).padStart(9)}${pct(q(mapes, 0.05)).padStart(10)}` +
      `${pct(q(mapes, 0.5)).padStart(10)}${pct(q(mapes, 0.95)).padStart(10)}`);
    console.log(`  ${"중앙".padEnd(10)}${pct(base.medianAbsoluteErrorPct).padStart(9)}${pct(q(meds, 0.05)).padStart(10)}` +
      `${pct(q(meds, 0.5)).padStart(10)}${pct(q(meds, 0.95)).padStart(10)}`);
    console.log(`  ${"±10%".padEnd(10)}${pct(base.within10PctRatio, 0).padStart(9)}${pct(q(w10s, 0.05), 0).padStart(10)}` +
      `${pct(q(w10s, 0.5), 0).padStart(10)}${pct(q(w10s, 0.95), 0).padStart(10)}`);
    console.log(`\n  읽는 법: (2)의 어떤 후보가 **난수 95% 안쪽**이면 그건 신호가 아니다.`);
    console.log(`  난수 중앙이 기준선보다 좋으면 — V62는 **아무 칸이나 하나 더 주면 좋아지는 상태**다.`);
    expect(mapes.length).toBe(TRIALS);
  });

  it("(4) 통과한 건 QSC 하나 — 어느 매장이 움직였나, 그리고 후보지는", () => {
    const built = build((c) => { const q = qscByStoreCode.get(c); return q ? Math.log(q / 92.6) : null; });
    if (!built) { console.log("  QSC 자료 부족"); return; }
    const rowsOf = (extra: Map<string, number> | null) => {
      const inputs = extra
        ? baseInputs.map((i) => ({ ...i, competitorDistanceRatio: extra.get(i.storeCode) ?? 0 }))
        : baseInputs;
      const { rows } = runUsageCohortValidation(inputs, sales, settings) as never as {
        rows: { storeCode: string; storeName: string; brand: string | null;
          includedInCoreAccuracy: boolean; absoluteErrorPct: number | null }[];
      };
      return new Map(rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy)
        .map((r) => [r.storeCode, r]));
    };
    const a = rowsOf(null), b = rowsOf(built.map);
    const diffs: { name: string; before: number; after: number; qsc: number | null }[] = [];
    for (const [code, ra] of a) {
      const rb = b.get(code);
      if (!rb || ra.absoluteErrorPct == null || rb.absoluteErrorPct == null) continue;
      diffs.push({ name: ra.storeName, before: ra.absoluteErrorPct, after: rb.absoluteErrorPct,
        qsc: qscByStoreCode.get(code) ?? null });
    }
    diffs.sort((x, y) => (x.after - x.before) - (y.after - y.before));
    console.log(`\n══ (4) QSC 칸을 넣었을 때 매장별 오차 변화 ══`);
    console.log(`  ${"매장".padEnd(14)}${"QSC".padStart(6)}${"전".padStart(9)}${"후".padStart(9)}${"변화".padStart(9)}`);
    const show = (d: (typeof diffs)[number]) => console.log(
      `  ${d.name.padEnd(14)}${(d.qsc == null ? "없음" : d.qsc.toFixed(1)).padStart(6)}` +
      `${pct(d.before, 1).padStart(9)}${pct(d.after, 1).padStart(9)}` +
      `${`${d.after > d.before ? "+" : ""}${((d.after - d.before) * 100).toFixed(1)}%p`.padStart(9)}`);
    console.log(`  ── 좋아진 5곳 ──`);
    for (const d of diffs.slice(0, 5)) show(d);
    console.log(`  ── 나빠진 5곳 ──`);
    for (const d of diffs.slice(-5)) show(d);
    const worse20 = diffs.filter((d) => d.before <= 0.2 && d.after > 0.2);
    console.log(`\n  ±20%를 벗어난 매장 ${worse20.length}곳: ${worse20.map((d) => `${d.name}(${pct(d.before, 0)}->${pct(d.after, 0)})`).join(" · ") || "없음"}`);
    console.log(`  QSC 없는 매장 ${built.imputed}곳은 평균으로 채웠다(표준화 후 0 = 중립).`);

    console.log(`\n  ⚠️⚠️ **후보지 예측은 한 톨도 안 바뀐다.**`);
    console.log(`     QSC는 개점 뒤 매장을 돌아보고 매기는 점수라 **후보지에는 존재하지 않는다.**`);
    console.log(`     없으면 평균(=표준화 0)이 들어가 기여가 0이다. 즉 이 개선은 **기존점 사후`);
    console.log(`     설명력**이지 후보지 예측력이 아니다. 2026-09-15·09-17에 같은 이유로`);
    console.log(`     실험실에서 보류된 항목이고(docs/backlog.md "결정 대기"), V62에서도 같다.`);
    expect(diffs.length).toBeGreaterThan(20);
  });

  it("(5) 정말 후보지가 안 바뀌나 — 계수는 다시 학습된다", () => {
    // ⚠️ (4)에서 "후보지 예측은 한 톨도 안 바뀐다"고 적었는데, 그건 **QSC 항의 기여만** 0이라는
    //    뜻이다. 칸을 하나 더하면 **나머지 계수도 같이 다시 학습된다.** 그러면 후보지 예측이
    //    QSC를 거치지 않고도 움직인다. 이걸 안 보고 넘어가면 결정 근거가 틀린다.
    const built = build((c) => { const q = qscByStoreCode.get(c); return q ? Math.log(q / 92.6) : null; });
    if (!built) { console.log("  QSC 자료 부족"); return; }
    const a = measure(null).model, b = measure(built.map).model;
    if (!a || !b) { console.log("  학습 실패"); return; }
    const NAMES = ["시간당 요금", "공급 대비 수요", "자사 경쟁력", "경쟁력 우위", "배후수요 더미", "**새 칸(QSC)**"];
    console.log(`\n══ (5) 칸을 더하면 기존 계수가 얼마나 움직이나 ══`);
    for (const [kind, ma, mb] of [["이용시간", a.usage, b.usage], ["먹거리", a.product, b.product]] as const) {
      console.log(`  [${kind}]`);
      for (let i = 0; i < Math.max(ma.coefficients.length, mb.coefficients.length); i++) {
        const x = ma.coefficients[i], y = mb.coefficients[i];
        const name = NAMES[i] ?? `피처${i}`;
        if (x == null) { console.log(`    ${name.padEnd(14)}${"(없음)".padStart(10)} -> ${y.toFixed(4).padStart(9)}   <- 새 칸`); continue; }
        const d = y - x;
        console.log(`    ${name.padEnd(14)}${x.toFixed(4).padStart(10)} -> ${y.toFixed(4).padStart(9)}` +
          `   ${`${d >= 0 ? "+" : ""}${(x !== 0 ? (d / Math.abs(x)) * 100 : 0).toFixed(1)}%`.padStart(9)}`);
      }
    }
    console.log(`\n  => 기존 계수가 움직이면 **후보지 예측도 움직인다**(QSC 항을 안 거치고도).`);
    console.log(`     "후보지는 한 톨도 안 바뀐다"는 말은 QSC **항의 기여**에 대해서만 맞다.`);
    console.log(`     움직임이 작으면 실질적으로는 같다고 볼 수 있고, 크면 **후보지 예측이`);
    console.log(`     검증 없이 바뀌는** 것이라 오히려 위험하다 — 후보지엔 맞출 실측이 없다.`);
    expect(a.usage.coefficients.length).toBeGreaterThan(3);
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("(6) 칸을 더하지 말고 **값을 고치면** — 사양 점수를 실험실 판으로", () => {
    // 사용자(2026-09-19): *"그거 말고도 사양 먹거리 시설 관리 등 이런 쪽도 데이터는
    // 실험실 데이터가 좀 더 맞는 거 아닌가?"*
    //
    // ⭐ **이게 QSC보다 나은 종류의 변경이다.** 둘은 성격이 다르다:
    //
    //   QSC        = 피처를 **한 칸 더한다**   -> 자유도 +1 · 후보지엔 값이 없음
    //   사양 교체   = 기존 칸의 **값을 고친다** -> 자유도 그대로 · 후보지에도 그대로 적용됨
    //
    // 그리고 실험실은 운영 사양표가 **틀렸다는 근거**를 갖고 있다(labSpecScore.ts):
    //   RTX 3060 Ti 2.25 < RTX 4060 3.00   (실제로는 3060 Ti가 빠르다 · 23건)
    //   RTX 4070    3.50 < RTX 5060 4.00   (사용자 지적 · 9건)
    //   i3 13100F   3.00 = i5 13400F 3.00  (티어를 아예 안 본다 · 자사 9곳)
    // 운영은 "세대 산술"이고 세대 숫자는 출시 연도지 성능이 아니다.
    //
    // ── 어떻게 갈아끼우나 ────────────────────────────────────────────────────
    // 경쟁력점수는 **선형 가중합**이다(computeCompetitivenessScore · computeFacilityScore ·
    // computeCompetitorAvgCompetitiveness 전부). 그래서 사양만 바뀌면 차이가 그대로 전파된다:
    //
    //   Δ자사점수   = (실험실사양 − 운영사양) × w.spec
    //   Δ경쟁평균   = PC수 가중평균( (실험실사양ᵢ − 운영사양ᵢ) × w.spec )
    //   격차_new   = (자사 + Δ자사) / (경쟁평균 + Δ경쟁평균)
    //
    // 정확한 계산이다(근사가 아니다).
    const wSpec = settings.competitivenessWeights.spec;
    const labSpecOwn = new Map<string, number>();
    for (const r of labRows) {
      const v = r.input.ownQualityParts?.spec;
      if (v != null) labSpecOwn.set(r.input.storeCode, v);
    }

    let movedOwn = 0, movedRival = 0, rivalTotal = 0;
    const swapped: ValidationStoreInput[] = [];
    const specDiffs: { name: string; op: number; lab: number }[] = [];
    for (let i = 0; i < baseInputs.length; i++) {
      const inp = baseInputs[i];
      const store = stores[i];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const st = store as any;
      const opOwn = computeSpecScore({
        vgaBase: st.ownVgaBase, vgaTop: st.ownVgaTop, vgaTop2: st.ownVgaTop2,
        cpu: st.ownCpu, cpuTop1: st.ownCpuTop1, cpuTop2: st.ownCpuTop2,
        ram: st.ownRam, ramTop: st.ownRamTop,
        monitorBase: st.ownMonitorBase, monitorTop: st.ownMonitorTop,
      }, settings);
      const labOwn = labSpecOwn.get(inp.storeCode) ?? null;
      let dOwn = 0;
      if (opOwn != null && labOwn != null) {
        dOwn = (labOwn - opOwn) * wSpec;
        if (Math.abs(labOwn - opOwn) > 1e-9) {
          movedOwn++;
          specDiffs.push({ name: inp.storeName, op: opOwn, lab: labOwn });
        }
      }
      // 경쟁점 — PC수 가중평균의 차이
      const comps = competitorsByLookup.get(existingStoreSourceCode(store)) ?? [];
      let wsum = 0, dsum = 0;
      for (const c of comps) {
        const w = computeCompetitorAppliedPcCount(c) ?? 0;
        if (!(w > 0)) continue;
        const op = computeCompetitorScores(c, settings).spec;
        const lab = rivalQualityParts(c, settings).spec;
        rivalTotal++;
        if (op == null || lab == null) continue;
        if (Math.abs(lab - op) > 1e-9) movedRival++;
        wsum += w; dsum += w * (lab - op) * wSpec;
      }
      const dAvg = wsum > 0 ? dsum / wsum : 0;
      const own0 = inp.competitivenessScore ?? null;
      const gap0 = inp.competitivenessGap ?? null;
      // 격차에서 경쟁평균을 역산한다 — gap = own / avg 이므로 avg = own / gap
      const avg0 = own0 != null && gap0 != null && gap0 > 0 ? own0 / gap0 : null;
      const own1 = own0 != null ? own0 + dOwn : null;
      const avg1 = avg0 != null ? avg0 + dAvg : null;
      swapped.push({
        ...inp,
        competitivenessScore: own1 ?? inp.competitivenessScore,
        competitivenessGap: own1 != null && avg1 != null && avg1 > 0 ? own1 / avg1 : inp.competitivenessGap,
      });
    }

    const base = measure(null).s;
    const { rows } = runUsageCohortValidation(swapped, sales, settings) as never as {
      rows: { brand: string | null; includedInCoreAccuracy: boolean }[];
    };
    const s = summarizeValidationRows(
      rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy) as never,
      { mape: settings.targetMAE, medianAe: settings.targetMedianAE,
        within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias });

    console.log(`\n══ (6) 사양 점수를 실험실 판으로 갈아끼움 (칸 수 그대로 · 자유도 그대로) ══`);
    console.log(`  점수가 움직인 매장 ${movedOwn}/${baseInputs.length}곳 · 경쟁점 ${movedRival}/${rivalTotal}건` +
      `  (경쟁력점수에서 사양 비중 ${(wSpec * 100).toFixed(0)}%)`);
    console.log(`\n  ${"".padEnd(22)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
    console.log(`  ${"지금 (운영 사양표)".padEnd(22)}${pct(base.meanAbsoluteErrorPct).padStart(9)}` +
      `${pct(base.medianAbsoluteErrorPct).padStart(9)}${pct(base.within10PctRatio, 0).padStart(8)}${pct(base.within20PctRatio, 0).padStart(8)}`);
    console.log(`  ${"실험실 사양표".padEnd(22)}${pct(s.meanAbsoluteErrorPct).padStart(9)}` +
      `${pct(s.medianAbsoluteErrorPct).padStart(9)}${pct(s.within10PctRatio, 0).padStart(8)}${pct(s.within20PctRatio, 0).padStart(8)}`);
    if (specDiffs.length) {
      console.log(`\n  자사 사양 점수가 바뀐 곳 (운영 -> 실험실)`);
      for (const d of specDiffs.slice(0, 12)) {
        console.log(`    ${d.name.padEnd(14)}${d.op.toFixed(2).padStart(6)} -> ${d.lab.toFixed(2).padStart(6)}` +
          `  ${(d.lab > d.op ? "+" : "") + (d.lab - d.op).toFixed(2)}`);
      }
      if (specDiffs.length > 12) console.log(`    … 외 ${specDiffs.length - 12}곳`);
    }
    console.log(`\n  ⚠️ 이건 **자유도를 안 늘린다.** 좋아지면 "칸을 더 줘서"가 아니라 값이 더 맞아서다.`);
    console.log(`     그리고 사양은 **후보지 조사에도 있는 값**이라 후보지 예측이 실제로 바뀐다.`);
    expect(baseInputs.length).toBeGreaterThan(20);
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("(7) ⭐ QSC를 넣으면 **후보지** 예측이 얼마나 움직이나", () => {
    // (4)에서 "후보지는 한 톨도 안 바뀐다"고 적었는데 (5)가 그걸 뒤집었다 —
    // 칸을 더하면 **공급 대비 수요 계수가 −29.6% 움직인다.** QSC 항을 안 거치고도
    // 후보지 예측이 바뀐다는 뜻이다. 얼마나 바뀌는지 재야 결정을 할 수 있다.
    //
    // ── 후보지를 어떻게 흉내내나 ────────────────────────────────────────────
    // 후보지 = "QSC가 없는 곳" = 평균이 들어가 QSC 항 기여가 0인 곳.
    // 그래서 **전 매장 QSC를 평균으로 고정**하고 예측을 낸 뒤 기준선과 견준다.
    // 남는 차이는 전부 **다시 학습된 나머지 계수** 때문이다 — 그게 곧 후보지가 겪을 변화다.
    const built = build((c) => { const q = qscByStoreCode.get(c); return q ? Math.log(q / 92.6) : null; });
    if (!built) { console.log("  QSC 자료 부족"); return; }
    // ⚠️ 전 매장에 **같은 값**을 넣으면 안 된다 — 분산이 0이라 표준화에서 전부 0이 되고
    //    학습 자체가 기준선과 같아진다(2026-09-19에 그렇게 짜서 변화 0.00%가 나왔다).
    //    올바른 흉내는 **실제 QSC로 학습**한 뒤 **QSC를 평균으로 두고 예측**하는 것이다.
    const mdlBase = measure(null).model;
    const mdlQsc = measure(built.map).model;
    if (!mdlBase || !mdlQsc) { console.log("  학습 실패"); return; }
    const vals = [...built.map.values()];
    const meanQsc = vals.reduce((x, y) => x + y, 0) / vals.length;

    const inflow = (i: ValidationStoreInput) => 1 + (getV62Rate(i.inflowRestriction ?? null, settings) ?? 0);
    const diffs: { name: string; d: number }[] = [];
    for (const i of baseInputs) {
      const pc = i.evaluationPcCount ?? i.pcCount;
      if (!pc || i.hourlyRate == null) continue;
      const fBase = empiricalFeaturesFor(toV61TrainingStore(i, settings));
      // 후보지 = QSC가 없어 평균이 들어가는 곳
      const fQsc = empiricalFeaturesFor(toV61TrainingStore({ ...i, competitorDistanceRatio: meanQsc }, settings));
      const pA = predictUsageRevenue(mdlBase, fBase, pc, i.hourlyRate, settings, inflow(i), i.extraPcHours ?? 0);
      const pB = predictUsageRevenue(mdlQsc, fQsc, pc, i.hourlyRate, settings, inflow(i), i.extraPcHours ?? 0);
      const a0 = pA?.monthlyRevenue ?? null, b0 = pB?.monthlyRevenue ?? null;
      if (a0 == null || b0 == null || a0 <= 0) continue;
      diffs.push({ name: i.storeName, d: (b0 - a0) / a0 });
    }
    diffs.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const abs = diffs.map((x) => Math.abs(x.d)).sort((x, y) => x - y);
    const mean = abs.reduce((x, y) => x + y, 0) / abs.length;
    console.log(`\n══ (7) QSC 칸을 넣되 QSC 값은 평균(=후보지 상황) — 예측이 얼마나 움직이나 ══`);
    console.log(`  n=${diffs.length}  ·  평균 |변화| ${pct(mean)}  ·  중앙 ${pct(abs[Math.floor(abs.length / 2)])}` +
      `  ·  최대 ${pct(abs[abs.length - 1])}`);
    console.log(`  많이 움직인 5곳: ${diffs.slice(0, 5).map((x) => `${x.name} ${x.d >= 0 ? "+" : ""}${(x.d * 100).toFixed(1)}%`).join(" · ")}`);
    console.log(`\n  이 변화는 **검증할 방법이 없다** — 후보지엔 맞출 실측이 없기 때문이다.`);
    console.log(`  기존점 MAPE가 좋아지는 것과 별개로, 후보지 예측이 조용히 이만큼 움직인다.`);
    console.log(`  움직임이 작으면 "실질적으로 후보지는 그대로"라고 말할 수 있고,`);
    console.log(`  크면 **검증 안 된 변경이 후보지에 그대로 나간다**는 뜻이라 신중해야 한다.`);
    expect(diffs.length).toBeGreaterThan(20);
  });

  // ══════════════════════════════════════════════════════════════════════════
  it("(8) 사양 + 존구성을 실험실 판으로 — **MAPE는 판정 기준이 아니라 대가다**", () => {
    // 사용자(2026-09-19): *"v62라고 mape 위주로 진행하는 게 아니라, 근거가 명확한, 이런 값이라면
    // 적중률이 떨어져도 적용해야지."*
    //
    // ⭐ 이 한 줄이 판정 기준을 바꾼다. 실험실에서 하루 종일 지킨 규율("MAPE로 값을 고르지
    //    않는다")을 운영에도 그대로 적용하는 것이다. 그래서 아래 표의 MAPE는 **채택 근거가
    //    아니라 치르는 대가**로 읽는다.
    //
    // ── 근거의 종류로 나누면 ────────────────────────────────────────────────
    //   [사실 문제]  사양표 — RTX 3060 Ti(2.25) < RTX 4060(3.00)은 **사실과 어긋난다**
    //                존구성 — VIP존·프렌즈존·퍼스트클래스존이 경쟁점 228건 전부 0건.
    //                         우리 브랜드 용어라 조사자가 경쟁점의 같은 실체를 그 칸에 안 넣는다.
    //                         종류를 세면 **자사가 항상 이긴다**(41/41곳)
    //   [통계 근거]  QSC — 탄력도 0.84 · 대조군 통과. 사실 문제는 아니다
    //   [근거 약함]  중심도 · 교과서식 예측 · 특수수요 배수 — 실험실 안에서만 뜻이 있다
    //
    // 비중: 경쟁력점수에서 사양 25% · 존구성 0.5 × 0.55 = **27.5%**
    const wSpec = settings.competitivenessWeights.spec;
    const wZone = settings.facilityWeights.zoneComposition * settings.competitivenessWeights.interior;
    const labParts = new Map(labRows.map((r) => [r.input.storeCode, r.input.ownQualityParts]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownZoneOp = (st: any) => resolveZoneCompositionScore(
      computeOwnZoneComposition({
        counts: {
          singleSeatCount: st.ownSingleSeatCount ?? null, room1: st.ownRoom1 ?? null,
          room2: st.ownRoom2 ?? null, teamRoom: st.ownTeamRoom ?? null,
          coupleZone: st.ownCoupleZone ?? null, vipZone: st.ownVipZone ?? null,
          friendsZone: st.ownFriendsZone ?? null, firstClassZone: st.ownFirstClassZone ?? null,
        },
        teamRoomTotalSeats: st.ownTeamRoomTotalSeats ?? null,
        totalPcCount: st.evaluationPcCount ?? st.pcCount ?? null,
      }).composition, st.ownSeatZoneScore ?? null);
    const rivalZoneOp = (c: Competitor) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = c as any;
      return computeCompetitorZoneComposition({
        counts: {
          singleSeatCount: x.singleSeatCount ?? null, room1: x.room1 ?? null, room2: x.room2 ?? null,
          teamRoom: x.teamRoom ?? null, coupleZone: x.coupleZone ?? null, vipZone: x.vipZone ?? null,
          friendsZone: x.friendsZone ?? null, firstClassZone: x.firstClassZone ?? null,
        },
        regularCoupleSeatCount: x.regularCoupleSeatCount ?? null,
        teamRoomTotalSeats: x.teamRoomTotalSeats ?? null,
        totalPcCount: computeCompetitorAppliedPcCount(c) ?? null,
      }).composition;
    };

    const buildSwap = (useSpec: boolean, useZone: boolean) => {
      let movedOwnS = 0, movedOwnZ = 0;
      const out: ValidationStoreInput[] = [];
      for (let i = 0; i < baseInputs.length; i++) {
        const inp = baseInputs[i];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const st = stores[i] as any;
        const parts = labParts.get(inp.storeCode);
        let dOwn = 0;
        if (useSpec) {
          const op = computeSpecScore({
            vgaBase: st.ownVgaBase, vgaTop: st.ownVgaTop, vgaTop2: st.ownVgaTop2,
            cpu: st.ownCpu, cpuTop1: st.ownCpuTop1, cpuTop2: st.ownCpuTop2,
            ram: st.ownRam, ramTop: st.ownRamTop,
            monitorBase: st.ownMonitorBase, monitorTop: st.ownMonitorTop,
          }, settings);
          const lab = parts?.spec ?? null;
          if (op != null && lab != null) { dOwn += (lab - op) * wSpec; if (Math.abs(lab - op) > 1e-9) movedOwnS++; }
        }
        if (useZone) {
          const op = ownZoneOp(st), lab = parts?.zone ?? null;
          if (op != null && lab != null) { dOwn += (lab - op) * wZone; if (Math.abs(lab - op) > 1e-9) movedOwnZ++; }
        }
        let wsum = 0, dsum = 0;
        for (const c of competitorsByLookup.get(existingStoreSourceCode(stores[i])) ?? []) {
          const w = computeCompetitorAppliedPcCount(c) ?? 0;
          if (!(w > 0)) continue;
          let d = 0;
          if (useSpec) {
            const op = computeCompetitorScores(c, settings).spec, lab = rivalQualityParts(c, settings).spec;
            if (op != null && lab != null) d += (lab - op) * wSpec;
          }
          if (useZone) {
            const op = rivalZoneOp(c), lab = rivalQualityParts(c, settings).zone;
            if (op != null && lab != null) d += (lab - op) * wZone;
          }
          wsum += w; dsum += w * d;
        }
        const dAvg = wsum > 0 ? dsum / wsum : 0;
        const own0 = inp.competitivenessScore ?? null, gap0 = inp.competitivenessGap ?? null;
        const avg0 = own0 != null && gap0 != null && gap0 > 0 ? own0 / gap0 : null;
        const own1 = own0 != null ? own0 + dOwn : null;
        const avg1 = avg0 != null ? avg0 + dAvg : null;
        out.push({ ...inp,
          competitivenessScore: own1 ?? inp.competitivenessScore,
          competitivenessGap: own1 != null && avg1 != null && avg1 > 0 ? own1 / avg1 : inp.competitivenessGap });
      }
      return { out, movedOwnS, movedOwnZ };
    };

    const scoreOf = (inputs: ValidationStoreInput[]) => {
      const { rows } = runUsageCohortValidation(inputs, sales, settings) as never as {
        rows: { brand: string | null; includedInCoreAccuracy: boolean }[];
      };
      return summarizeValidationRows(
        rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy) as never,
        { mape: settings.targetMAE, medianAe: settings.targetMedianAE,
          within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias });
    };

    console.log(`\n══ (8) 사실 교정을 적용하면 — 대가가 얼마인가 ══`);
    console.log(`  경쟁력점수 비중: 사양 ${(wSpec * 100).toFixed(0)}% · 존구성 ${(wZone * 100).toFixed(1)}%\n`);
    console.log(`  ${"".padEnd(26)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
    const base = measure(null).s;
    const line = (label: string, s: ReturnType<typeof scoreOf>) => console.log(
      `  ${label.padEnd(26)}${pct(s.meanAbsoluteErrorPct).padStart(9)}${pct(s.medianAbsoluteErrorPct).padStart(9)}` +
      `${pct(s.within10PctRatio, 0).padStart(8)}${pct(s.within20PctRatio, 0).padStart(8)}`);
    line("지금 (운영 잣대)", base);
    const onlySpec = buildSwap(true, false);
    const onlyZone = buildSwap(false, true);
    const both = buildSwap(true, true);
    line("사양만 실험실 판", scoreOf(onlySpec.out));
    line("존구성만 실험실 판", scoreOf(onlyZone.out));
    line("둘 다 실험실 판", scoreOf(both.out));
    console.log(`\n  움직인 매장: 사양 ${onlySpec.movedOwnS}곳 · 존구성 ${onlyZone.movedOwnZ}곳 (자사 ${baseInputs.length}곳 중)`);
    console.log(`\n  ⚠️ 이 표는 **채택 근거가 아니라 대가**다. 사용자 원칙:`);
    console.log(`     *"v62라고 mape 위주로 진행하는 게 아니라, 근거가 명확한, 이런 값이라면`);
    console.log(`       적중률이 떨어져도 적용해야지."*`);
    console.log(`     사양표의 RTX 서열과 존구성의 자사 전용 이름표는 **사실 문제**다.`);
    console.log(`     MAPE가 얼마든 틀린 값을 그대로 두는 게 더 나쁘다.`);

    // ── 근거가 정말 '사실 문제'인지 여기서 확인한다 ──────────────────────────
    // 존구성 대가가 크다(±10% 66% -> 47%). 그러니 **비대칭이 지금도 실재하는지**를 보고
    // 결정해야 한다. V62는 2026-09-17에 이미 한 번 고쳤다(미조사 경쟁점이 최저점 받던 것).
    const ownOp: number[] = [], ownLab: number[] = [];
    for (let i = 0; i < baseInputs.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = ownZoneOp(stores[i] as any);
      const l = labParts.get(baseInputs[i].storeCode)?.zone ?? null;
      if (v != null) ownOp.push(v);
      if (l != null) ownLab.push(l);
    }
    const rivOp: number[] = [], rivLab: number[] = [];
    for (const c of allCompetitors) {
      const v = rivalZoneOp(c), l = rivalQualityParts(c, settings).zone;
      if (v != null) rivOp.push(v);
      if (l != null) rivLab.push(l);
    }
    const med2 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const winRate = (own: number[], riv: number[]) => {
      const rm = med2(riv); if (rm == null) return null;
      return own.filter((v) => v > rm).length / own.length;
    };
    console.log(`\n  ── 존구성 비대칭이 지금도 있나 (판단 근거) ──`);
    console.log(`    ${"잣대".padEnd(10)}${"자사 중앙".padStart(10)}${"경쟁점 중앙".padStart(12)}${"자사가 경쟁 중앙보다 높은 비율".padStart(28)}`);
    console.log(`    ${"운영".padEnd(10)}${(med2(ownOp) ?? 0).toFixed(2).padStart(10)}${(med2(rivOp) ?? 0).toFixed(2).padStart(12)}` +
      `${pct(winRate(ownOp, rivOp), 0).padStart(28)}   (자사 ${ownOp.length}곳 · 경쟁 ${rivOp.length}곳)`);
    console.log(`    ${"실험실".padEnd(10)}${(med2(ownLab) ?? 0).toFixed(2).padStart(10)}${(med2(rivLab) ?? 0).toFixed(2).padStart(12)}` +
      `${pct(winRate(ownLab, rivLab), 0).padStart(28)}   (자사 ${ownLab.length}곳 · 경쟁 ${rivLab.length}곳)`);
    // ⚠️ 위 표는 **불공정하다** — 경쟁점 232곳에 존 자료가 아예 없는 곳이 섞여 있어
    //    중앙이 기본값에 눌린다. 사용자 지적: *"실험실은 프렌즈존이 2인석·3인석으로
    //    변환되었잖아."* 맞다. 실험실 판은 이름표를 좌석으로 바꾸는 **물리 재정의**다.
    //    그게 비대칭을 고치는지 보려면 **조사된 경쟁점만** 놓고 견줘야 한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const surveyed = allCompetitors.filter((c: any) =>
      [c.singleSeatCount, c.room1, c.room2, c.teamRoom, c.coupleZone, c.vipZone,
        c.friendsZone, c.firstClassZone, c.regularCoupleSeatCount].some((v) => v != null));
    const sOp: number[] = [], sLab: number[] = [];
    for (const c of surveyed) {
      const v = rivalZoneOp(c), l = rivalQualityParts(c, settings).zone;
      if (v != null) sOp.push(v);
      if (l != null) sLab.push(l);
    }
    console.log(`\n  ── ⭐ 조사된 경쟁점 ${surveyed.length}곳만 놓고 다시 (위 표는 미조사가 섞여 불공정) ──`);
    console.log(`    ${"잣대".padEnd(10)}${"자사 중앙".padStart(10)}${"경쟁점 중앙".padStart(12)}${"자사 승률".padStart(10)}${"자사−경쟁 중앙차".padStart(18)}`);
    const gapOf = (own: number[], riv: number[]) => (med2(own) ?? 0) - (med2(riv) ?? 0);
    console.log(`    ${"운영".padEnd(10)}${(med2(ownOp) ?? 0).toFixed(2).padStart(10)}${(med2(sOp) ?? 0).toFixed(2).padStart(12)}` +
      `${pct(winRate(ownOp, sOp), 0).padStart(10)}${gapOf(ownOp, sOp).toFixed(2).padStart(18)}`);
    console.log(`    ${"실험실".padEnd(10)}${(med2(ownLab) ?? 0).toFixed(2).padStart(10)}${(med2(sLab) ?? 0).toFixed(2).padStart(12)}` +
      `${pct(winRate(ownLab, sLab), 0).padStart(10)}${gapOf(ownLab, sLab).toFixed(2).padStart(18)}`);
    console.log(`\n    (미조사 경쟁점 ${allCompetitors.length - surveyed.length}곳은 어느 잣대에서도 기본값을 받는다 —`);
    console.log(`     그건 잣대로 못 고치고 **조사로만** 고친다)`);

    // ── ⭐ 물어야 할 건 승률이 아니라 **우위의 출처**다 ──────────────────────
    // 사용자(2026-09-19): *"경쟁점은 VIP존 프렌즈존이 없는데 자사는 있다. 그래서 자사의
    // VIP존은 1인석으로 바꼈고 프렌즈존은 2인석·3인석으로 변환했잖아."*
    //
    // 그러면 판정 기준이 "자사 승률이 내려가나"가 **아니다.** 자사가 실제로 특화좌석이
    // 많으면 이기는 게 맞다. 물어야 할 건:
    //
    //   **자사 우위가 [이름표 종류 수] 때문인가, [실재하는 좌석] 때문인가**
    //
    // 운영 잣대의 다양성 = 8개 존 **이름** 종류 수  <- 자사에만 있는 이름표가 그대로 점수
    // 실험실 잣대의 다양성 = 룸 종류 수만(1인룸·2인룸·팀룸) <- 양쪽 다 조사되는 물리 사실
    //                수용력 = 특화좌석 전부(이름 무관) <- VIP존은 1인석, 프렌즈존은 좌석으로
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownParts = (st: any) => computeOwnZoneComposition({
      counts: {
        singleSeatCount: st.ownSingleSeatCount ?? null, room1: st.ownRoom1 ?? null,
        room2: st.ownRoom2 ?? null, teamRoom: st.ownTeamRoom ?? null,
        coupleZone: st.ownCoupleZone ?? null, vipZone: st.ownVipZone ?? null,
        friendsZone: st.ownFriendsZone ?? null, firstClassZone: st.ownFirstClassZone ?? null,
      },
      teamRoomTotalSeats: st.ownTeamRoomTotalSeats ?? null,
      totalPcCount: st.evaluationPcCount ?? st.pcCount ?? null,
    });
    const rivalParts = (c: Competitor) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = c as any;
      return computeCompetitorZoneComposition({
        counts: {
          singleSeatCount: x.singleSeatCount ?? null, room1: x.room1 ?? null, room2: x.room2 ?? null,
          teamRoom: x.teamRoom ?? null, coupleZone: x.coupleZone ?? null, vipZone: x.vipZone ?? null,
          friendsZone: x.friendsZone ?? null, firstClassZone: x.firstClassZone ?? null,
        },
        regularCoupleSeatCount: x.regularCoupleSeatCount ?? null,
        teamRoomTotalSeats: x.teamRoomTotalSeats ?? null,
        totalPcCount: computeCompetitorAppliedPcCount(c) ?? null,
      });
    };
    const ownLabParts = (i: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const st = stores[i] as any;
      return computeLabZoneComposition({
        counts: {
          singleSeatCount: st.ownSingleSeatCount ?? null, room1: st.ownRoom1 ?? null,
          room2: st.ownRoom2 ?? null, teamRoom: st.ownTeamRoom ?? null,
          coupleZone: st.ownCoupleZone ?? null, vipZone: st.ownVipZone ?? null,
          friendsZone: st.ownFriendsZone ?? null, firstClassZone: st.ownFirstClassZone ?? null,
          regularCoupleSeatCount: null,
        },
        teamRoomTotalSeats: st.ownTeamRoomTotalSeats ?? null,
        totalPcCount: st.evaluationPcCount ?? st.pcCount ?? null, own: true,
      });
    };
    const ownD: number[] = [], ownC: number[] = [], ownLD: number[] = [], ownLC: number[] = [];
    for (let i = 0; i < stores.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = ownParts(stores[i] as any), l = ownLabParts(i);
      if (p.diversity != null) ownD.push(p.diversity);
      if (p.capacity != null) ownC.push(p.capacity);
      if (l.diversity != null) ownLD.push(l.diversity);
      if (l.capacity != null) ownLC.push(l.capacity);
    }
    const rivD: number[] = [], rivC: number[] = [], rivLD: number[] = [], rivLC: number[] = [];
    for (const c of surveyed) {
      const p = rivalParts(c), l = rivalQualityParts(c, settings);
      if (p.diversity != null) rivD.push(p.diversity);
      if (p.capacity != null) rivC.push(p.capacity);
      void l;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = c as any;
      const lz = computeLabZoneComposition({
        counts: {
          singleSeatCount: x.singleSeatCount ?? null, room1: x.room1 ?? null, room2: x.room2 ?? null,
          teamRoom: x.teamRoom ?? null, coupleZone: x.coupleZone ?? null, vipZone: x.vipZone ?? null,
          friendsZone: x.friendsZone ?? null, firstClassZone: x.firstClassZone ?? null,
          regularCoupleSeatCount: x.regularCoupleSeatCount ?? null,
        },
        teamRoomTotalSeats: x.teamRoomTotalSeats ?? null,
        totalPcCount: computeCompetitorAppliedPcCount(c) ?? null, own: false,
      });
      if (lz.diversity != null) rivLD.push(lz.diversity);
      if (lz.capacity != null) rivLC.push(lz.capacity);
    }
    console.log(`\n  ── ⭐⭐ 자사 우위가 '이름표' 때문인가 '실재 좌석' 때문인가 ──`);
    console.log(`    ${"".padEnd(24)}${"자사 중앙".padStart(10)}${"경쟁 중앙".padStart(10)}${"차이".padStart(9)}`);
    const row = (label: string, o: number[], r: number[]) => console.log(
      `    ${label.padEnd(24)}${(med2(o) ?? 0).toFixed(2).padStart(10)}${(med2(r) ?? 0).toFixed(2).padStart(10)}` +
      `${((med2(o) ?? 0) - (med2(r) ?? 0)).toFixed(2).padStart(9)}`);
    console.log(`    [운영 — 다양성 = 존 **이름** 종류 수]`);
    row("  다양성", ownD, rivD);
    row("  수용력", ownC, rivC);
    console.log(`    [실험실 — 다양성 = **룸** 종류 수 · 수용력 = 좌석 전부]`);
    row("  다양성", ownLD, rivLD);
    row("  수용력", ownLC, rivLC);
    console.log(`\n    읽는 법: 운영에서 **다양성 차이가 크고** 실험실에서 그게 줄면,`);
    console.log(`    자사 우위의 상당 부분이 **이름표였다**는 뜻이다 — 사실 교정 대상이 맞다.`);
    console.log(`    수용력 차이는 남아도 된다. 좌석은 실재하니까.`);

    // ── ⚠️ 사양에서 **사실 교정**과 **판단**을 갈라야 한다 ────────────────────
    // 실험실 사양은 변환표뿐 아니라 **비중도** 바꾼다(VGA 0.40->0.50 · 모니터 0.25->0.15).
    // 그런데 `labSpecScore.ts`가 스스로 적어 둔다:
    //   *"0.50은 **뜻으로 고른 값**이고, 자료는 반대하지 않는 정도다"*
    //   *"이 값을 자료로 다시 고르려 하지 말 것"*
    // 즉 비중은 **판단**이지 RTX 서열 같은 검증 가능한 사실이 아니다.
    // 사실 교정 명목으로 판단을 끼워 넣으면 안 되므로, **변환표만 바꾸고 비중은 운영 값**을
    // 유지한 변형을 따로 잰다. 이게 실제로 적용할 것이다.
    const buildSpecTablesOnly = () => {
      const out: ValidationStoreInput[] = [];
      for (let i = 0; i < baseInputs.length; i++) {
        const inp = baseInputs[i];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const st = stores[i] as any;
        const opts = { specWeights: settings.specWeights }; // ← 비중은 운영 값 유지
        const op = computeSpecScore({
          vgaBase: st.ownVgaBase, vgaTop: st.ownVgaTop, vgaTop2: st.ownVgaTop2,
          cpu: st.ownCpu, cpuTop1: st.ownCpuTop1, cpuTop2: st.ownCpuTop2,
          ram: st.ownRam, ramTop: st.ownRamTop,
          monitorBase: st.ownMonitorBase, monitorTop: st.ownMonitorTop,
        }, settings);
        const lab = labComputeSpecScore({
          vgaBase: st.ownVgaBase ?? null, vgaTop: st.ownVgaTop ?? null, vgaTop2: st.ownVgaTop2 ?? null,
          cpu: st.ownCpu ?? null, cpuTop1: st.ownCpuTop1 ?? null, cpuTop2: st.ownCpuTop2 ?? null,
          ram: st.ownRam ?? null, ramTop: st.ownRamTop ?? null,
          monitorBase: st.ownMonitorBase ?? null, monitorTop: st.ownMonitorTop ?? null,
        }, settings, opts);
        const dOwn = op != null && lab != null ? (lab - op) * wSpec : 0;
        let wsum = 0, dsum = 0;
        for (const c of competitorsByLookup.get(existingStoreSourceCode(stores[i])) ?? []) {
          const w = computeCompetitorAppliedPcCount(c) ?? 0;
          if (!(w > 0)) continue;
          const o = computeCompetitorScores(c, settings).spec;
          const l = labComputeSpecScore({
            vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
            cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
            ram: c.ram ?? null, ramTop: c.ramTop ?? null,
            monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
          }, settings, opts);
          wsum += w; dsum += w * (o != null && l != null ? (l - o) * wSpec : 0);
        }
        const dAvg = wsum > 0 ? dsum / wsum : 0;
        const own0 = inp.competitivenessScore ?? null, gap0 = inp.competitivenessGap ?? null;
        const avg0 = own0 != null && gap0 != null && gap0 > 0 ? own0 / gap0 : null;
        const own1 = own0 != null ? own0 + dOwn : null;
        const avg1 = avg0 != null ? avg0 + dAvg : null;
        out.push({ ...inp,
          competitivenessScore: own1 ?? inp.competitivenessScore,
          competitivenessGap: own1 != null && avg1 != null && avg1 > 0 ? own1 / avg1 : inp.competitivenessGap });
      }
      return out;
    };
    console.log(`\n  ── ⚠️ 사양: 변환표만 vs 변환표+비중 (비중은 '판단'이라 갈라야 한다) ──`);
    console.log(`    ${"".padEnd(30)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);
    line("  지금 (운영)", base);
    line("  변환표만 실험실 (비중 운영 유지)", scoreOf(buildSpecTablesOnly()));
    line("  변환표+비중 둘 다 실험실", scoreOf(onlySpec.out));
    console.log(`\n    GPU 성능지수(RTX 3060 Ti > RTX 4060) · CPU 성능지수(i3 ≠ i5)는 **사실 교정**이다.`);
    console.log(`    비중 0.40/0.25 -> 0.50/0.15는 실험실 자신이 "뜻으로 고른 값"이라고 적었다 —`);
    console.log(`    **판단**이므로 사실 교정과 같이 묶어 넘기면 안 된다.`);
    console.log(`\n  ── 먹거리·인테리어는? ──`);
    console.log(`    실험실이 **그대로 통과**시킨다(ownQualityParts·rivalQualityParts 모두).`);
    console.log(`    갈아끼울 잣대가 없다. 2026-09-18에 자사 기준값도 4.0 유지로 확정했다.`);
    console.log(`    남은 건 잣대가 아니라 **자료**다 — 미확인이라 2점 받은 경쟁점 73곳.`);
    expect(both.out.length).toBe(baseInputs.length);
  });
});
