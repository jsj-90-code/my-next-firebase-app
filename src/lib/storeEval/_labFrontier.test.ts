// 실험실 산식의 **한계선** — 극한까지 올리면 얼마인가 (2026-09-20 밤)
//
// 사용자: *"난 일단 실험실 산식 정확도를 극한까지, 가능한 최대의 값까지 올리고 싶다.
//   실제로 이 식을 쓸 수 있을 정도까지만이라도. V62도 오차 사실 높은데 지금 쓰고 있잖아.
//   근데 산식 근거가 없으니까 신빙성이 너무 낮아. 다만 실험실 산식은 똑같이 쓸 수 있을
//   정도이면 그래도 예상값의 근거는 명확하니까."*
//
// 맞는 목표다. 그래서 **"지금 구조에서 손잡이를 다 맞추면 어디까지 가나"**를 잰다.
//
// ── ⚠️ 표본 안 성적으로 답하면 거짓말이 된다 ──────────────────────────────
// 손잡이가 아홉이고 매장이 38곳이다. 표본 안에서 다 맞추면 당연히 좋아지는데
// 그건 **새 후보지에서 재현되지 않는다.** 그래서 두 가지를 갈라 찍는다:
//
//   (가) 표본 안 최선   — 손잡이를 38곳 전부로 고른 성적. **허수**다
//   (나) **중첩 교차검증** — 한 곳을 빼고 **그 37곳만으로 손잡이를 고른 뒤**
//                          안 본 그 한 곳을 맞힌다. **이게 진짜 쓸 수 있는 숫자다**
//
// 둘의 벌어짐이 곧 "손잡이를 맞추다 표본을 외운 정도"다.
//
// ⚠️ 축척(hoursPerUserPerMonth · productUnitPrice)도 **훈련겹에서만** 맞춘다.
//    2026-09-20에 이걸 안 지켜서 LOO가 표본 안을 다시 센 적이 있다(`_textbookFull` 버그).
//
// ⚠️ **측정만 한다.** 여기서 제일 좋게 나온 조합도 **채택하지 않는다.**
//
// 실행:
//   npx vitest run src/lib/storeEval/_labFrontier.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 2) => (v == null ? "     -" : `${(v * 100).toFixed(d)}%`.padStart(7));

describeIf("실험실 한계선", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const comps: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, comps, snap.locationEvaluations, settings);
  const byCode = new Map<string, Competitor[]>();
  for (const c of comps) byCode.set(c.candidateCode, [...(byCode.get(c.candidateCode) ?? []), c]);
  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const d of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = d.storeCode ?? d.id;
    if (code) qscSites.set(code, d);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const s = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(s)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscBy = new Map<string, number>();
  for (const [c, s] of qscSites) {
    const a = qscInWindowAverage(s.records ?? [], s.openedAt ?? null);
    if (a != null) qscBy.set(c, a);
  }
  const rows: LabRow[] = buildLabRows({
    stores, compsByCode: byCode, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores),
    settings, qscByStoreCode: qscBy,
  });
  const P = DEFAULT_TEXTBOOK_PARAMS;

  /** 표본 안 성적 — 손잡이·축척 모두 주어진 rows로. */
  const inSample = (p: TextbookParams, rs = rows) => {
    const s = scoreTextbook(rs, p);
    return { mape: s.mape ?? 1, med: s.medianAbsErr ?? 1, w20: s.within20 ?? 0 };
  };
  /** 정직한 LOO — 손잡이는 고정, **축척만** 훈련겹에서. 손잡이 하나씩 훑을 때 쓴다. */
  const loo = (p: TextbookParams) => {
    const errs: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const train = rows.filter((_, k) => k !== i);
      const fp = fittedParams(p, scoreTextbook(train, p));
      const b = computeTextbook(rows[i].input, fp);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) errs.push(Math.abs(b.monthlyRevenue - a) / a);
    }
    const s = [...errs].sort((x, y) => x - y);
    return {
      mape: errs.reduce((x, y) => x + y, 0) / errs.length,
      med: s[Math.floor(s.length / 2)],
      w20: errs.filter((e) => e <= 0.2).length / errs.length,
      n: errs.length,
    };
  };

  /** 훑을 손잡이 — 전부 **물리적 뜻이 있는 것**만. 뜻 없는 칸은 안 만든다. */
  type Knob = { name: string; values: number[]; apply: (p: TextbookParams, v: number) => TextbookParams; cur: number };
  const KNOBS: Knob[] = [
    { name: "유동 반영률", cur: P.floatingFactor, values: [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5],
      apply: (p, v) => ({ ...p, floatingFactor: v }) },
    { name: "유효 경쟁거리 m", cur: P.effectiveRadiusM, values: [150, 200, 300, 400, 500, 700, 1000],
      apply: (p, v) => ({ ...p, effectiveRadiusM: v }) },
    { name: "품질 지수 θ", cur: P.qualityExponent, values: [0, 1, 2, 3, 4, 6, 8],
      apply: (p, v) => ({ ...p, qualityExponent: v }) },
    { name: "바깥선택지 IP", cur: P.outsideOptionIp, values: [0, 25, 50, 100, 200, 400, 800],
      apply: (p, v) => ({ ...p, outsideOptionIp: v }) },
    { name: "대학가 배수", cur: P.specialDemandMultipliers["대학가"], values: [1.0, 1.1, 1.2, 1.3, 1.45, 1.6],
      apply: (p, v) => ({ ...p, specialDemandMultipliers: { ...p.specialDemandMultipliers, "대학가": v } }) },
    { name: "군부대 배수", cur: P.specialDemandMultipliers["군부대"], values: [1.0, 1.5, 2.0, 2.25, 2.5, 3.0],
      apply: (p, v) => ({ ...p, specialDemandMultipliers: { ...p.specialDemandMultipliers, "군부대": v } }) },
    { name: "중심도 ν", cur: P.locationExponents.centrality, values: [0, 0.25, 0.5, 0.75, 1.0, 1.5],
      apply: (p, v) => ({ ...p, locationExponents: { ...p.locationExponents, centrality: v } }) },
    { name: "접근성 κ", cur: P.locationExponents.access, values: [0, 0.25, 0.5, 0.75, 1.0],
      apply: (p, v) => ({ ...p, locationExponents: { ...p.locationExponents, access: v } }) },
    { name: "상권 흡인력", cur: P.agglomerationFactor, values: [0, 0.05, 0.1, 0.2, 0.3],
      apply: (p, v) => ({ ...p, agglomerationFactor: v }) },
    { name: "밀집도 보정", cur: P.densityCorrection, values: [0, 0.1, 0.2, 0.3, 0.5],
      apply: (p, v) => ({ ...p, densityCorrection: v }) },
    { name: "가동률 상한", cur: P.maxUtilization, values: [0.5, 0.55, 0.6, 0.7, 0.85, 1.0],
      apply: (p, v) => ({ ...p, maxUtilization: v }) },
    { name: "요금 탄력 ε", cur: P.rateElasticity, values: [0, 0.25, 0.546, 0.8, 1.2],
      apply: (p, v) => ({ ...p, rateElasticity: v }) },
  ];

  it("(1) 손잡이 하나씩 — 지금 값이 최선인가", () => {
    const base = loo(P);
    console.log(`\n══ 지금 설정 ══  표본안 ${pct(inSample(P).mape)} · LOO ${pct(base.mape)} · LOO중앙 ${pct(base.med, 1)} · ±20% ${pct(base.w20, 0)}`);
    console.log(`\n  손잡이              지금값      LOO 최선값    LOO MAPE      지금 대비`);
    for (const k of KNOBS) {
      let best = { v: k.cur, mape: base.mape };
      for (const v of k.values) {
        const m = loo(k.apply(P, v)).mape;
        if (m < best.mape - 1e-9) best = { v, mape: m };
      }
      const gain = base.mape - best.mape;
      console.log(
        `  ${k.name.padEnd(18)}${String(k.cur).padStart(8)}${String(best.v).padStart(13)}` +
        `${pct(best.mape).padStart(13)}${gain > 1e-9 ? `   −${(gain * 100).toFixed(2)}%p` : "        (지금이 최선)"}`,
      );
    }
    console.log(`\n  ⚠️ 한 칸씩 본 값이다. 여러 개를 같이 움직이면 서로 먹어서 합이 안 된다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(2) ⭐ 다 같이 맞추면 — 표본 안 최선 vs 중첩 교차검증", () => {
    /** 좌표 하강 — 손잡이를 하나씩 돌아가며 그 겹의 표본 안 MAPE를 최소화한다. */
    const fit = (train: LabRow[], passes = 2) => {
      let p = P;
      let cur = inSample(p, train).mape;
      for (let pass = 0; pass < passes; pass++) {
        for (const k of KNOBS) {
          for (const v of k.values) {
            const cand = k.apply(p, v);
            const m = inSample(cand, train).mape;
            if (m < cur - 1e-9) { cur = m; p = cand; }
          }
        }
      }
      return p;
    };

    // (가) 표본 안 최선 — 38곳 전부로 손잡이를 고른다
    const pBest = fit(rows);
    const inB = inSample(pBest);
    const looB = loo(pBest);
    console.log(`\n══ (가) 표본 안 최선 (손잡이를 38곳 전부로 골랐다) ══`);
    console.log(`  표본 안 MAPE ${pct(inB.mape)} · 중앙 ${pct(inB.med, 1)} · ±20% ${pct(inB.w20, 0)}`);
    console.log(`  같은 손잡이로 LOO ${pct(looB.mape)}  <- 손잡이 고른 자리가 이미 38곳을 봤으므로 **이것도 허수다**`);
    const changed = KNOBS.filter((k) => {
      const a = JSON.stringify(k.apply(P, k.cur)), b = JSON.stringify(k.apply(pBest, k.cur));
      return a !== b;
    });
    console.log(`  바뀐 손잡이: ${changed.length ? changed.map((k) => k.name).join(", ") : "(없음)"}`);

    // (나) 중첩 교차검증 — 한 곳을 빼고 37곳만으로 손잡이를 고른 뒤 그 한 곳을 맞힌다
    const errs: number[] = [];
    const picks = new Map<string, Map<number, number>>();
    for (let i = 0; i < rows.length; i++) {
      const train = rows.filter((_, k) => k !== i);
      const p = fit(train);
      const fp = fittedParams(p, scoreTextbook(train, p));
      const b = computeTextbook(rows[i].input, fp);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) errs.push(Math.abs(b.monthlyRevenue - a) / a);
      for (const k of KNOBS) {
        // 그 겹이 고른 값을 세어 둔다 — 겹마다 널뛰면 그 손잡이는 못 믿는다
        const v = k.values.find((x) => JSON.stringify(k.apply(p, x)) === JSON.stringify(p));
        if (v != null) {
          const m = picks.get(k.name) ?? new Map<number, number>();
          m.set(v, (m.get(v) ?? 0) + 1);
          picks.set(k.name, m);
        }
      }
    }
    const s = [...errs].sort((x, y) => x - y);
    const nested = {
      mape: errs.reduce((x, y) => x + y, 0) / errs.length,
      med: s[Math.floor(s.length / 2)],
      w20: errs.filter((e) => e <= 0.2).length / errs.length,
    };
    const base = loo(P);
    console.log(`\n══ (나) ⭐ 중첩 교차검증 — **새 후보지에서 기대되는 성적** ══`);
    console.log(`  MAPE ${pct(nested.mape)} · 중앙 ${pct(nested.med, 1)} · ±20% ${pct(nested.w20, 0)}`);
    console.log(`\n  견줌:  지금 설정 LOO      ${pct(base.mape)} · 중앙 ${pct(base.med, 1)} · ±20% ${pct(base.w20, 0)}`);
    console.log(`        표본 안 최선        ${pct(inB.mape)}  <- 허수`);
    console.log(`        **중첩 교차검증**    ${pct(nested.mape)}  <- 진짜`);
    console.log(`\n  외운 정도(표본안 최선 → 중첩): ${((nested.mape - inB.mape) * 100).toFixed(2)}%p`);
    console.log(`\n  [겹마다 고른 값] 널뛰는 손잡이는 못 믿는다`);
    for (const k of KNOBS) {
      const m = picks.get(k.name);
      if (!m) continue;
      const list = [...m.entries()].sort((a, b) => b[1] - a[1]);
      const stable = list.length === 1;
      console.log(`    ${k.name.padEnd(18)}${list.map(([v, c]) => `${v}(${c}회)`).join(" · ")}${stable ? "   <- 한 값으로 모인다" : ""}`);
    }
    expect(errs.length).toBeGreaterThan(30);
  }, 600_000);

  it("(3) 그래서 쓸 수 있나 — V62·바닥과 나란히", () => {
    const base = loo(P);
    console.log(`\n══ 나란히 놓기 ══`);
    console.log(`  목표값 잡음 바닥(추정)      약 5.6%      <- 완벽한 모형도 이 아래로는 못 간다`);
    console.log(`  운영 V62 (회귀)            8.832%      <- 근거는 약하지만 성적은 좋다`);
    console.log(`  실험실 지금 (LOO)         ${pct(base.mape)}`);
    console.log(`\n  ⚠️ V62의 8.832%는 **표본 안 적중률**이다(38곳 학습·38곳 채점).`);
    console.log(`     실험실의 LOO/중첩은 **안 본 매장** 성적이다. 그대로 견주면 V62에 유리하다.`);
    console.log(`     공정하게 견주려면 V62도 같은 방식으로 홀드아웃을 걸어야 한다`);
    console.log(`     (\`_liveCheck.test.ts\`의 무작위 대조군 틀이 그 자리다).`);
  });
});
