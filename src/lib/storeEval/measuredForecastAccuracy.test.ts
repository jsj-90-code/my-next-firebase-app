// "실측기반 예상월매출"(= 원본 시트 AA경로, 경쟁점 실가동좌석 기반)의 정확도를 고정한다
// (2026-09-14 신설).
//
// 왜 테스트로 두나 — 이 경로의 백테스트는 검증 화면에 2026-08-21부터 있었는데, **그 결과가
// 어느 문서에도 기록된 적이 없어서** 화면을 직접 열어보지 않으면 아무도 몰랐다. 그 사이 후보지
// 결과 화면은 "검증된 적이 없는 별도 계산"이라는(이제는 틀린) 문구를 달고 금액을 계속 보여줬다.
// 숫자를 코드에 박아두지 않고 **매번 스냅샷에서 다시 재서 로그로 남긴다.**
//
// 2026-09-14 측정값: 계산가능 28/38곳 · MAPE 46.45% · 중앙 41.55% · ±10% 10.7% · 계통편향 -19.8%.
// 같은 스냅샷에서 V62 정식 경로는 MAPE 9.88% · ±10% 52.63%다.
// 그래서 금액 카드 2개(예상 대당 일매출·실측기반 예상월매출)를 결과 화면에서 뺐다.
// 좌석·가동률은 실측 자료라 남겼다(V62 가동률이 과한지 가늠하는 데 쓴다).
//
// 스냅샷이 없는 PC에서는 통째로 건너뛴다(validationSnapshot.ts 주석 참고).

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorCoverageRatio, computeExistingStoreMeasuredForecast } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { existingStoreSourceCode } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import type { Competitor, ExistingStore, LocationEvaluation } from "./types";

type Snap = {
  existingStores: ExistingStore[];
  competitors: Record<string, unknown>[];
  locationEvaluations: LocationEvaluation[];
  settings: Record<string, unknown> | null;
};

/** 이 경로가 이 정도보다 나빠지면 화면에서 뺀 판단이 여전히 맞다는 뜻. 좋아지면 알려야 한다. */
const KNOWN_BAD_MAPE = 0.25;

(hasValidationSnapshot() ? describe : describe.skip)("실측기반 예상월매출(AA경로) 정확도", () => {
  const snap = loadValidationSnapshot<Snap>();
  const settings = mergeModelSettings(snap.settings as never);
  const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const byCode = new Map<string, Competitor[]>();
  for (const c of competitors) byCode.set(c.candidateCode, [...(byCode.get(c.candidateCode) ?? []), c]);
  const locByCode = new Map(snap.locationEvaluations.map((l) => [l.candidateCode, l]));

  const cohort = snap.existingStores.filter(
    (s) =>
      s.brandType === "블랙라벨" &&
      !s.excludedFromModel &&
      (s.completedMonths ?? 0) >= 1 &&
      (s.actualMonthlyRevenueAvg ?? 0) > 0,
  );

  const scored = cohort
    .map((store) => {
      const lookup = existingStoreSourceCode(store);
      const forecast = computeExistingStoreMeasuredForecast(
        store,
        byCode.get(lookup) ?? [],
        locByCode.get(lookup) ?? null,
        settings,
      );
      if (forecast.measuredForecastMonthlyRevenue == null) return null;
      const actual = store.actualMonthlyRevenueAvg as number;
      return {
        storeCode: store.storeCode,
        signed: forecast.measuredForecastMonthlyRevenue / actual - 1,
        coverage: forecast.competitorOccupiedSeatsCoverage
          ? computeCompetitorCoverageRatio(forecast.competitorOccupiedSeatsCoverage)
          : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  const mape = scored.length ? scored.reduce((a, r) => a + Math.abs(r.signed), 0) / scored.length : null;

  it("측정 결과를 로그로 남긴다", () => {
    const pct = (v: number) => (v * 100).toFixed(2) + "%";
    const within = (band: number) => pct(scored.filter((r) => Math.abs(r.signed) <= band).length / scored.length);
    const bias = scored.reduce((a, r) => a + r.signed, 0) / scored.length;
    const good = scored.filter((r) => (r.coverage ?? 0) >= 0.5);
    console.log(
      [
        `검증군 ${cohort.length}곳 중 계산가능 ${scored.length}곳`,
        `MAPE ${pct(mape as number)} · ±10% ${within(0.1)} · ±20% ${within(0.2)} · 계통편향 ${pct(bias)}`,
        `핑봇실측 50% 이상인 ${good.length}곳만: MAPE ${good.length ? pct(good.reduce((a, r) => a + Math.abs(r.signed), 0) / good.length) : "-"}`,
      ].join("\n"),
    );
    expect(scored.length).toBeGreaterThan(0);
  });

  it("정식 경로(V62 · MAPE 약 10%)와 비교할 수준이 아니다", () => {
    // 이 단언이 깨지면 = 이 경로가 쓸 만해졌다는 뜻이다. 그때는 화면에서 뺀 판단을 다시 본다.
    expect(mape).not.toBeNull();
    expect(mape as number).toBeGreaterThan(KNOWN_BAD_MAPE);
  });

  it("계산 자체가 안 되는 매장이 있다 — 경쟁점 핑봇 실측이 없으면 산출 불가다", () => {
    // 이 경로는 경쟁점 실측에 의존해서, 자료가 없으면 값이 아예 안 나온다.
    // V62는 같은 매장에서도 값이 나온다 — 두 경로의 성격 차이를 고정해둔다.
    expect(scored.length).toBeLessThan(cohort.length);
  });
});
