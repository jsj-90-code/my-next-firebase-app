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
  computeCompetitorInvestigationSummary, summarizeValidationRows, type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { buildLabRows, qscInWindowAverage, utilizationByStore, type QscRecord } from "./labInput";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
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
});
