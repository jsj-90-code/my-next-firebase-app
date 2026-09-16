// 교과서식 — **세 다리를 다 붙인** 전체 성적 (2026-09-16)
//
// ── 왜 이 하네스가 필요한가 ────────────────────────────────────────────────
// 입지 5항목이 화면에 붙기 전에 만들어진 하네스(`_textbookScore.test.ts`)는 `location`을
// 아예 안 넘겼다. 그래서 거기 찍히던 MAPE 54.6%는 **입지가 빠진 숫자**였고, 입지를 붙인
// 전체 성적은 아무도 잰 적이 없었다(backlog.md 2026-09-16 저녁 3절).
//
// 여기서는 실험실 화면과 **같은 조립 함수**(labInput.ts의 buildLabRows)를 쓴다. 베끼지
// 않으므로 화면에 새 항목이 붙으면 이 하네스도 자동으로 같이 본다 — 같은 사고가 두 번
// 나지 않게 하는 게 이 파일의 절반이다.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────────
// 1) 입지를 통째로 뺀 성적(location: null)
// 2) 지금 계수 그대로 붙인 성적 (중심도 ν=0.25 · 접근성 κ=0.25 · 나머지 0)
// 3) 항목을 하나씩 켜 보며 각 항이 얼마를 하는지
// 4) 유동 방향 ω를 0에서 올려 보며 — **켤지 말지는 사용자 결정**이고 여기선 숫자만 낸다
//
// ⚠️ **측정만 한다. 채택하지 않는다.** MAPE가 내려갔다고 계수를 바꾸지 않는다 — 채택은
//    무작위 대조군을 둔 검정과 기전 설명이 있어야 하고, 그건 _locationRebuild.test.ts의
//    관문이다(backlog.md 산식 실험 판정 기준).
//
// 실행:
//   npx vitest run src/lib/storeEval/_textbookFull.test.ts --reporter=verbose --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, type LabRow } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** 피어슨 상관. 표본이 2곳 미만이거나 한쪽이 상수면 0을 돌려준다(값을 지어내지 않는다). */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

describeIf("교과서식 — 입지까지 붙인 전체 성적", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );

  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }

  // 실측 가동률 — 화면과 같은 방식으로 평가창 월매출에서 평균을 낸다.
  const utilByStore = new Map<string, number>();
  {
    const acc = new Map<string, number[]>();
    for (const s of snap.sales ?? []) {
      if (s.utilizationRate == null || !(s.utilizationRate > 0)) continue;
      acc.set(s.storeCode, [...(acc.get(s.storeCode) ?? []), s.utilizationRate]);
    }
    for (const [code, vs] of acc) utilByStore.set(code, vs.reduce((a, b) => a + b, 0) / vs.length);
  }

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings });

  /** 입지 항목을 골라서 끈 행을 만든다. 원본은 안 건드린다. */
  function withLocation(keep: "none" | "all" | Array<"centrality" | "access" | "direction">): LabRow[] {
    if (keep === "all") return rows;
    return rows.map((r) => ({
      actualRevenue: r.actualRevenue,
      input: {
        ...r.input,
        location: keep === "none" ? null : {
          centrality: keep.includes("centrality") ? r.input.location?.centrality ?? null : null,
          access: keep.includes("access") ? r.input.location?.access ?? null : null,
          direction: keep.includes("direction") ? r.input.location?.direction ?? null : null,
          flowBlock: null,
          visibility: null,
        },
      },
    }));
  }

  const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, outsideOptionIp: 500 };
  const line = (label: string, rs: LabRow[], p: TextbookParams = P) => {
    const sc = scoreTextbook(rs, p);
    const f = (v: number | null | undefined, d = 2) => (v == null ? "-" : (v * 100).toFixed(d));
    console.log(
      `  ${label.padEnd(26)} MAPE ${f(sc.mape).padStart(6)}%  중앙 ${f(sc.medianAbsErr, 1).padStart(5)}%` +
      `  ±20% ${f(sc.within20, 0).padStart(3)}%  최대 ${f(sc.maxAbsErr, 0).padStart(4)}%  n=${sc.sampleCount}`,
    );
    return sc;
  };

  it("표본과 입지 자료가 다 잡힌다", () => {
    const withCentrality = rows.filter((r) => r.input.location?.centrality != null).length;
    const withAccess = rows.filter((r) => r.input.location?.access != null).length;
    const withDirection = rows.filter((r) => r.input.location?.direction != null).length;
    console.log(`\n표본 ${rows.length}곳 · 중심도 ${withCentrality}곳 · 접근성 ${withAccess}곳 · 유동방향 ${withDirection}곳`);
    expect(rows.length).toBeGreaterThan(30);
    // 유동 방향은 2026-09-16에 52곳 전부 채웠다. 하나라도 비면 배선이 끊긴 것이다.
    expect(withDirection).toBe(rows.length);

    // 중심도가 수요 다리와 겹치는지 — 수요식은 유동 400m를 쓰고 중심도는 유동 300m/1km다.
    // 겹치면 "상권 끝"이 아니라 **유동 총량을 한 번 더 곱하는 것**이 된다(이중계산).
    const pairs = rows
      .map((r) => [r.input.location?.centrality ?? null, r.input.floatingByRadius[400] ?? null] as const)
      .filter((x): x is readonly [number, number] => x[0] != null && x[1] != null);
    const r = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
    console.log(`중심도 ↔ 수요식 유동400m 상관 r=${r.toFixed(3)} (n=${pairs.length})`);
  });

  it("입지가 전체 성적에 얼마를 하는가", () => {
    console.log("\n[입지 항목별] 계수는 기본값 — 중심도 ν=0.25 · 접근성 κ=0.25 · 유동방향 ω=0");
    const none = line("입지 없음", withLocation("none"));
    line("중심도만", withLocation(["centrality"]));
    line("접근성만", withLocation(["access"]));
    const all = line("중심도+접근성 (지금)", withLocation("all"));
    console.log(`\n  직전 기록: 입지·새 경쟁항 이전 MAPE 29.42% · 운영 산식(V62) 9.26%`);
    console.log(`  입지를 붙여 ${((none.mape ?? 0) * 100).toFixed(2)}% -> ${((all.mape ?? 0) * 100).toFixed(2)}%`);
    expect(all.sampleCount).toBeGreaterThan(30);
  });

  // ⚠️ 여기가 이 파일의 핵심이다. 중심도 ν와 접근성 κ는 **점유율 잔차**에서 골라진 값이다
  // (_locationRebuild.test.ts, 경쟁상권 29곳). 매출까지 가는 전체 파이프라인에서도 같은
  // 값이 맞는지는 아무도 안 봤다. 두 자리에서 답이 갈리면 그게 문제 제기지 채택 근거가 아니다.
  it("중심도 ν · 접근성 κ를 훑는다 — 점유율에서 고른 값이 매출에서도 맞나", () => {
    console.log("\n[중심도 ν] 접근성 κ=0.25 고정");
    for (const nu of [0, 0.1, 0.25, 0.5]) {
      line(`ν=${nu}`, rows, { ...P, locationExponents: { ...P.locationExponents, centrality: nu } });
    }
    console.log("\n[접근성 κ] 중심도 ν=0.25 고정");
    for (const kappa of [0, 0.1, 0.25, 0.5]) {
      line(`κ=${kappa}`, rows, { ...P, locationExponents: { ...P.locationExponents, access: kappa } });
    }
    console.log("\n[둘 다 끔] 기준");
    line("ν=0 · κ=0", rows, { ...P, locationExponents: { ...P.locationExponents, centrality: 0, access: 0 } });
    expect(rows.length).toBeGreaterThan(30);
  });

  it("유동 방향 ω를 올리면 — 측정만 한다, 켜지 않는다", () => {
    console.log("\n[유동 방향 ω] 지금은 0이다. 대조군을 못 넘어서 값만 채워둔 항목이다.");
    for (const omega of [0, 0.1, 0.25, 0.5, 1]) {
      line(`ω=${omega}`, rows, { ...P, locationExponents: { ...P.locationExponents, direction: omega } });
    }
    console.log("\n  ⚠️ 여기서 MAPE가 내려가도 채택 근거가 아니다 — 무작위 대조군 검정은");
    console.log("     _locationRebuild.test.ts에 있고, 거기서 이미 못 넘었다(중심도가 이 신호를 먹는다).");
    expect(rows.length).toBeGreaterThan(30);
  });
});
