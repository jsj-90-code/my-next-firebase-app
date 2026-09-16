"use client";

// 점포평가 실험실 — 교과서식 산식을 손으로 돌려보는 화면 (2026-09-15 신설)
//
// 사용자 방향: "지금 가맹점 데이터 기준값으로 하는 건 일단 현재 시점에서 두고, 산식을 또
// 만드는 구조로 하는 건데. 이걸 내가 보고 판단하려면 웹에 반영이 되어야 한다. 예를 들어
// 점포평가 test 버전 같은 페이지를 또 하나 만드는 거지."
// "이거 기존 웹에 탭 추가하는 거 아니고 페이지 따로 만드는 거지?" -> 그렇다. 별도 페이지다.
//
// ⚠️ **이 화면은 운영 산식을 건드리지 않는다.** 계산은 전부 textbookModel.ts(신규)로만 하고,
//    기존 calc.ts/usageRevenue.ts는 "지금 산식" 비교값을 얻는 데만 읽기로 쓴다.
//    파라미터는 화면 상태로만 들고 있고 Firestore에 저장하지 않는다 — 실험이기 때문이다.
//
// 왜 이 화면이 필요한가: 지금 산식은 MAPE 9.7%로 숫자는 좋지만 "기존 38곳 평균에서 ±"라는
// 설명밖에 못 한다. 교과서식(수요 -> 점유율 -> 매출)은 설명이 되지만 2026-09-15 실측에서
// MAPE 30~46%다. 어느 쪽으로 갈지는 파라미터를 직접 돌려보고 정해야 한다.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  computeCompetitorIp,
  summarizeValidationRows,
  computeCompetitorInvestigationSummary,
  type ValidationStoreInput,
} from "@/lib/storeEval/calc";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "@/lib/storeEval/existingStoreEvaluation";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  getModelSettings, listAllCompetitors, listAllLocationEvaluations,
  listExistingStores, listEvaluationSales,
} from "@/lib/storeEval/store";
import { computeOverflowPcHours, runUsageCohortValidation } from "@/lib/storeEval/usageRevenue";
import {
  DEFAULT_TEXTBOOK_PARAMS, PC_USE_RATE_MALE, PC_USE_RATE_FEMALE, scoreTextbook,
  type FloatingRadius, type ResidentRadius, type TextbookInput, type TextbookParams, type TextbookScore,
} from "@/lib/storeEval/textbookModel";
import type { Competitor, ExistingStore, ModelSettings } from "@/lib/storeEval/types";

type LabRow = { input: TextbookInput; actualRevenue: number };
type Loaded = {
  rows: LabRow[];
  /** 지금 운영 산식의 성적. 비교 기준선으로만 쓴다. */
  current: { mape: number | null; within10: number | null; within20: number | null; sampleCount: number } | null;
};

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? "-" : `${(v * 100).toFixed(digits)}%`;
const manwon = (v: number | null | undefined) =>
  v == null ? "-" : `${Math.round(v / 10000).toLocaleString()}만`;

async function loadLabData(): Promise<Loaded | null> {
  const [storedStores, settingsDoc, allCompetitors, allLocationEvaluations] = await Promise.all([
    listExistingStores(),
    getModelSettings(),
    listAllCompetitors(),
    listAllLocationEvaluations(),
  ]);
  if (storedStores.length === 0) return null;
  const sales = await listEvaluationSales(storedStores);
  const settings: ModelSettings = settingsDoc ?? { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };
  const stores = prepareExistingStoresForEvaluation(storedStores, allCompetitors, allLocationEvaluations, settings);

  // 매장별 **실측 월평균 가동률** — 수요 축척을 여기에 맞춘다(2026-09-16). 평가창 월매출의
  // utilizationRate 평균이다. 게토에서 받은 값과 대조했을 때 평균차 3.34% · r=1.000으로
  // 사실상 같은 값이라, 파이어스토어에 이미 있는 이 필드를 쓴다(별도 수집 불필요).
  const utilByStore = new Map<string, number>();
  {
    const acc = new Map<string, number[]>();
    for (const s of sales) {
      if (s.utilizationRate == null || !(s.utilizationRate > 0)) continue;
      acc.set(s.storeCode, [...(acc.get(s.storeCode) ?? []), s.utilizationRate]);
    }
    for (const [code, vs] of acc) utilByStore.set(code, vs.reduce((a, b) => a + b, 0) / vs.length);
  }

  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const locByCode = new Map(allLocationEvaluations.map((l) => [l.candidateCode, l]));

  const rows: LabRow[] = [];
  const validationInputs: ValidationStoreInput[] = [];
  for (const s of stores) {
    const code = existingStoreSourceCode(s);
    const cs = compsByCode.get(code) ?? [];
    const loc = locByCode.get(code) ?? null;

    // 지금 산식 비교용 입력 (validation 화면과 같은 형태)
    validationInputs.push({
      storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0, franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand, { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, cs, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg, specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null, hasLocationEvaluation: loc != null,
      floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(cs), sheetV61Predicted: s.v61Predicted,
    });

    if (s.excludedFromModel || !s.actualMonthlyRevenueAvg) continue;
    const sr = s as unknown as Record<string, number | null>;
    rows.push({
      actualRevenue: s.actualMonthlyRevenueAvg,
      input: {
        storeCode: s.storeCode, storeName: s.storeName,
        pcCount: s.evaluationPcCount ?? s.pcCount,
        hourlyRate: s.hourlyRate,
        actualUtilization: utilByStore.get(s.storeCode) ?? null,
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        pop500m: s.pop500m, pop1km: s.pop1km,
        // 연령별 이용률을 지역 성비로 섞는 데 쓴다(2026-09-16). 성별 x 연령 교차 자료는
        // 존재하지 않으므로 "연령대 안 성비 = 지역 전체 성비"로 근사한다.
        residentMaleRatio: s.male1kmRatio ?? null,
        floatingMaleRatioByRadius: {
          100: s.floating100Avg ? (s.floating100Male ?? 0) / s.floating100Avg : null,
          200: s.floating200Avg ? (s.floating200Male ?? 0) / s.floating200Avg : null,
          300: s.floating300Avg ? (s.floating300Male ?? 0) / s.floating300Avg : null,
          400: s.floating400Avg ? (s.floating400Male ?? 0) / s.floating400Avg : null,
          500: s.floating500Avg ? (s.floating500Male ?? 0) / s.floating500Avg : null,
        },
        residentAges: {
          age0s: sr.age1km_0_9 ?? 0, age10s: sr.age1km_10_19 ?? 0, age20s: sr.age1km_20_29 ?? 0,
          age30s: sr.age1km_30_39 ?? 0, age40s: sr.age1km_40_49 ?? 0, age50s: sr.age1km_50_59 ?? 0,
          age60plus: (sr.age1km_60_69 ?? 0) + (sr.age1km_70_79 ?? 0) + (sr.age1km_80plus ?? 0),
        },
        // 2026-09-15 — 100/200/300/400m 수집 경로를 열었다(소상공인365 반경 선택). 아직 안 모은
        // 매장은 null이라 그 반경을 고르면 "자료없음"으로 빠진다.
        floatingByRadius: {
          100: s.floating100Avg ?? null,
          200: s.floating200Avg ?? null,
          300: s.floating300Avg ?? null,
          400: s.floating400Avg ?? null,
          500: s.floating500Avg,
        },
        floatingAgesByRadius: {
          100: s.floating100Avg == null ? null : {
            age10s: s.floating100_10s ?? 0, age20s: s.floating100_20s ?? 0,
            age30s: s.floating100_30s ?? 0, age40s: s.floating100_40s ?? 0,
            age50s: s.floating100_50s ?? 0, age60plus: s.floating100_60plus ?? 0,
          },
          200: s.floating200Avg == null ? null : {
            age10s: s.floating200_10s ?? 0, age20s: s.floating200_20s ?? 0,
            age30s: s.floating200_30s ?? 0, age40s: s.floating200_40s ?? 0,
            age50s: s.floating200_50s ?? 0, age60plus: s.floating200_60plus ?? 0,
          },
          300: s.floating300Avg == null ? null : {
            age10s: s.floating300_10s ?? 0, age20s: s.floating300_20s ?? 0,
            age30s: s.floating300_30s ?? 0, age40s: s.floating300_40s ?? 0,
            age50s: s.floating300_50s ?? 0, age60plus: s.floating300_60plus ?? 0,
          },
          400: s.floating400Avg == null ? null : {
            age10s: s.floating400_10s ?? 0, age20s: s.floating400_20s ?? 0,
            age30s: s.floating400_30s ?? 0, age40s: s.floating400_40s ?? 0,
            age50s: s.floating400_50s ?? 0, age60plus: s.floating400_60plus ?? 0,
          },
          500: {
            age10s: s.floating500_10s ?? 0, age20s: s.floating500_20s ?? 0,
            age30s: s.floating500_30s ?? 0, age40s: s.floating500_40s ?? 0,
            age50s: s.floating500_50s ?? 0, age60plus: s.floating500_60plus ?? 0,
          },
        },
      },
    });
  }

  let current: Loaded["current"] = null;
  try {
    const { rows: vRows } = runUsageCohortValidation(validationInputs, sales, settings);
    const core = vRows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    const sum = summarizeValidationRows(core, {
      mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias,
    });
    current = {
      mape: sum.meanAbsoluteErrorPct, within10: sum.within10PctRatio,
      within20: sum.within20PctRatio, sampleCount: sum.sampleCount,
    };
  } catch {
    current = null; // 비교값이 없어도 실험은 돌아가야 한다
  }
  return { rows, current };
}

export default function LabPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<TextbookParams>({ ...DEFAULT_TEXTBOOK_PARAMS, outsideOptionIp: 500 });

  useEffect(() => {
    let alive = true;
    loadLabData()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : "불러오지 못했습니다."); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // 반경별로 자료가 몇 곳이나 모였는지 — 반경 버튼 아래에 그대로 보여준다.
  const counts = useMemo(() => {
    const rs = data?.rows ?? [];
    const n = (r: FloatingRadius) => rs.filter((x) => x.input.floatingByRadius[r] != null).length;
    return { f100: n(100), f200: n(200), f300: n(300), f400: n(400), f500: n(500), total: rs.length };
  }, [data]);

  const score: TextbookScore | null = useMemo(
    () => (data?.rows.length ? scoreTextbook(data.rows, p) : null),
    [data, p],
  );

  const set = <K extends keyof TextbookParams>(k: K, v: TextbookParams[K]) => setP((old) => ({ ...old, [k]: v }));
  const setAge = (k: keyof TextbookParams["ageWeights"], v: number) =>
    setP((old) => ({ ...old, ageWeights: { ...old.ageWeights, [k]: v } }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#171310] dark:text-[#f2ede2]">점포평가 실험실</h1>
          <p className="mt-1 text-sm text-[var(--sl-ink-soft)]">
            교과서식 산식(수요 → 점유율 → 매출)을 직접 돌려보는 화면입니다.
            <b className="text-[#171310] dark:text-[#f2ede2]"> 운영 산식과 저장값은 전혀 건드리지 않습니다.</b>
          </p>
        </div>
        <Link href="/store-eval" className="app-btn-outline shrink-0 rounded-lg px-4 py-2 text-sm">← 점포평가</Link>
      </div>

      <div className="app-notice mt-4 rounded-xl px-4 py-3 text-xs leading-relaxed">
        지금 운영 산식은 기존 가맹점 실적에 회귀로 맞춥니다. 숫자는 좋지만 &ldquo;왜 이 금액인가&rdquo;를
        설명할 때 <b>&ldquo;기존 가맹점 평균에서 조정했다&rdquo;</b>밖에 말할 수 없습니다.
        여기 교과서식은 <b>&ldquo;이 동네 수요가 얼마고 그중 우리가 몇 %를 가져간다&rdquo;</b>로 설명됩니다.
        대신 정확도가 떨어집니다 — 그 맞바꿈이 할 만한지 직접 보시라고 만든 화면입니다.
      </div>

      {loading && <p className="mt-8 text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>}
      {error && <p className="mt-8 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {score && data && (
        <>
          <ScoreBoard score={score} current={data.current} />
          <HowItWorks p={p} fitted={score.fittedHoursPerUser} productUnitPrice={score.fittedProductUnitPrice}
            scaledOnUtilization={score.scaledOnUtilization} />
          <Controls p={p} set={set} setAge={setAge} counts={counts} />
          <StoreTable score={score} />
        </>
      )}
    </div>
  );
}

function ScoreBoard({ score, current }: { score: TextbookScore; current: Loaded["current"] }) {
  const cells: { label: string; lab: string; now: string; better?: boolean }[] = [
    { label: "MAPE (평균오차)", lab: pct(score.mape), now: pct(current?.mape), better: score.mape != null && current?.mape != null && score.mape < current.mape },
    { label: "±10% 적중", lab: pct(score.within10), now: pct(current?.within10), better: score.within10 != null && current?.within10 != null && score.within10 > current.within10 },
    { label: "±20% 적중", lab: pct(score.within20), now: pct(current?.within20), better: score.within20 != null && current?.within20 != null && score.within20 > current.within20 },
    { label: "최악 오차", lab: pct(score.maxAbsErr), now: "-" },
  ];
  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="app-card rounded-xl p-4">
            <p className="text-xs text-[var(--sl-ink-soft)]">{c.label}</p>
            <p className={`mt-1 text-2xl font-bold ${c.better ? "text-emerald-600 dark:text-emerald-400" : "text-[#171310] dark:text-[#f2ede2]"}`}>{c.lab}</p>
            <p className="mt-0.5 text-[11px] text-[var(--sl-ink-soft)]">지금 산식 {c.now}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
        표본 {score.sampleCount}곳 · 목표 MAPE 10%(마지노선 20%) · 축척 둘은 매번 자동으로 맞춥니다
        (1인당 월이용시간 {score.fittedHoursPerUser.toFixed(2)}시간 ← 독점 실측가동률 ·
        상품몫 {Math.round(score.fittedProductUnitPrice).toLocaleString()}원/PC·시간 ← 독점 실매출).
        {score.utilizationMape != null && (
          <> 가동률 자체의 오차는 {pct(score.utilizationMape)}입니다(실측 있는 {score.utilizationSampleCount}곳)
          — 매출 오차와 따로 봐야 어느 층이 틀렸는지 갈립니다.</>
        )}
      </p>
    </div>
  );
}

/**
 * 계산기준 — 지금 수요를 어떻게 재는지 화면에 적어 둔다 (2026-09-16 사용자 요청:
 * "혹시 내가 까먹을 수도 있음 이후 작업하면서").
 *
 * ⚠️ **숫자를 글자로 박지 않는다.** 전부 `p`(현재 파라미터)와 `fitted`(맞춰진 축척)에서 읽어
 *    그린다 — 위 조절판을 움직이면 이 설명도 같이 바뀐다. 계산만 바꾸고 설명을 두면 화면이
 *    조용히 거짓말을 한다(CLAUDE.md 규칙, docs/backlog.md 2026-09-14 블록).
 */
function HowItWorks({ p, fitted, productUnitPrice, scaledOnUtilization }: {
  p: TextbookParams; fitted: number; productUnitPrice: number; scaledOnUtilization: boolean;
}) {
  // PC몫은 정가에서 나온다 — 기준정가 x (정가/기준정가)^β. 운영 산식 effectiveHourlyRate와 같은 식이다.
  const pcAt = (rate: number) => p.referenceHourlyRate * Math.pow(rate / p.referenceHourlyRate, p.rateElasticity);
  const MONTH_HOURS = 24 * 30;
  // 축척 계수를 사람이 읽을 수 있는 말로 바꾼다: "환산수요 N명당 PC 1대".
  const perPc = fitted > 0 ? Math.round(MONTH_HOURS / fitted / MONTH_HOURS * MONTH_HOURS / fitted) : null;
  const usersPerPc = fitted > 0 ? Math.round(1 / (fitted / MONTH_HOURS)) : null;
  void perPc;
  const male = PC_USE_RATE_MALE;
  const female = PC_USE_RATE_FEMALE;
  const pct = (v: number) => Math.round(v * 1000);
  return (
    <details className="app-card mt-4 rounded-xl px-4 py-3 text-xs leading-relaxed" open>
      <summary className="cursor-pointer text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
        계산기준 — 지금 수요를 어떻게 재고 있나
      </summary>

      <ol className="mt-3 space-y-3 text-[var(--sl-ink-soft)]">
        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">1. 인구를 &ldquo;PC방 이용자&rdquo;로 환산한다</b>
          <div className="mt-1">
            연령대마다 PC방 이용률이 다르고, 남녀는 약 3배 차이 납니다. 그래서 인구를 그대로 쓰지 않고
            이용률을 곱해 환산합니다.
          </div>
          <table className="mt-2 text-[11px]">
            <thead className="text-[var(--sl-ink-soft)]">
              <tr><th className="pr-4 text-left font-normal">1,000명당</th><th className="pr-4 text-right font-normal">남성</th><th className="text-right font-normal">여성</th></tr>
            </thead>
            <tbody>
              {([["10대", "age10s"], ["20대", "age20s"], ["30대", "age30s"], ["40대", "age40s"], ["50대", "age50s"]] as const).map(([label, key]) => (
                <tr key={key}>
                  <td className="pr-4">{label}</td>
                  <td className="pr-4 text-right tabular-nums">{pct(male[key])}명</td>
                  <td className="text-right tabular-nums">{pct(female[key])}명</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1">
            지역 남성비율로 남녀 이용률을 섞습니다. <b>성별×연령 교차 자료는 존재하지 않아서</b>
            (SGIS·소상공인365 둘 다 성별 총수와 연령 총수를 따로 줍니다) &ldquo;연령대 안의 성비 =
            지역 전체 성비&rdquo;로 근사합니다.
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">2. 주거를 기본으로, 유동을 보태 수요를 만든다</b>
          <div className="mt-1 font-mono text-[11px]">
            수요 = 환산(주거 {p.residentRadius === 1000 ? "1km" : `${p.residentRadius}m`})
            {" + "}환산(유동 {p.floatingRadius}m) × {p.floatingFactor}
          </div>
          <div className="mt-1">
            유동 계수 <b>{p.floatingFactor}</b>는 <b>측정값이 아니라 보정상수</b>입니다. 한 숫자가 셋을
            떠맡습니다 — 단위 변환(주거는 &ldquo;명&rdquo;, 유동은 &ldquo;하루 통행량&rdquo;), 중복 제거(거주자 통행이
            양쪽에 두 번 세어짐), 방문객의 낮은 이용 성향. 그래서 <b>&ldquo;유동인구의
            {" "}{Math.round(p.floatingFactor * 100)}%가 수요&rdquo;라고 읽으면 안 됩니다.</b>
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">3. 수요를 경쟁과 나눠 가동률을 낸다</b>
          <div className="mt-1 font-mono text-[11px]">
            가동률 = 수요 × 격차<sup>{p.gapExponent}</sup> ÷ (자사PC × 격차<sup>{p.gapExponent}</sup> + 경쟁IP)
            {p.outsideOptionIp > 0 ? ` + 안가는몫 ${p.outsideOptionIp}` : ""}
          </div>
          <div className="mt-1">
            지수 <b>{p.gapExponent}</b>는 <b>쏠림</b>을 뜻합니다. 1이면 경쟁력만큼 비례해 나눠 갖고,
            클수록 우위 매장으로 몰립니다. 상한은 <b>{Math.round(p.maxUtilization * 100)}%</b>입니다
            (실측 월평균 최대가 46.5%, 월 최대의 최대가 52.0%).
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">4. 가동률을 매출로 바꾼다</b>
          <div className="mt-1 font-mono text-[11px]">
            매출 = 자사PC × 720시간 × 가동률 × <b>PC 1대·1시간당 매출</b>
          </div>
          <div className="mt-1 font-mono text-[11px]">
            PC 1대·1시간당 매출 = <b>PC몫</b> + <b>상품몫</b>
          </div>
          <div className="mt-1 font-mono text-[11px]">
            PC몫   = {p.referenceHourlyRate}원 × (정가 ÷ {p.referenceHourlyRate})<sup>{p.rateElasticity}</sup>
            <br />상품몫 = {Math.round(productUnitPrice).toLocaleString()}원 (정가와 무관)
          </div>
          <div className="mt-1">
            손님 1명이 쓰는 돈(객단가)이 아니라 <b>PC 1대가 1시간 채워졌을 때 들어오는 총액</b>입니다.
            실측 32곳 중앙이 2,778원(PC몫 1,366 + 상품몫 1,456)입니다.
            건별 원장으로도 확인했습니다 — 광주첨단 2,682원 · 발산역 2,984원.
          </div>
          <div className="mt-1">
            <b>정가는 PC몫에만 들어갑니다.</b> 라면 값은 PC요금을 따라가지 않기 때문입니다.
            2026-09-16까지는 총단가 전체에 곱해서, 정가를 80% 올리면 총단가가 38% 오르는 것으로
            계산했습니다(지금 구조에서는 17%).
          </div>
          <div className="mt-1">
            지수 <b>{p.rateElasticity}</b>는 <b>정가를 올려도 그만큼 다 받지는 못한다</b>는 뜻입니다 —
            좌석 추가과금은 더해지지만 정액권 할인이 빼는데, 비싼 요금일수록 할인 비중이 큽니다.
            건별 원장 실측: 정액권 손님은 시간당 296~663원으로 <b>정가의 1/3</b>만 내고, 그 시간
            비중이 매장마다 2.1~9.1%입니다. 이 지수는 그 평균을 한 숫자로 담은 것입니다.
            {" "}정가 1,000원이면 PC몫 {Math.round(pcAt(1000)).toLocaleString()}원,
            1,700원이면 {Math.round(pcAt(1700)).toLocaleString()}원입니다.
            {" "}운영 산식(<code>usageRevenue.ts</code> <code>effectiveHourlyRate</code>)과 <b>같은 식</b>입니다.
          </div>
          <div className="mt-1">
            상품몫은 <b>후보지에서 예측할 방법이 아직 없습니다.</b> PC대수 r=0.251 · 정가 r=−0.015 ·
            가동률 r=0.118로 전부 유의선 0.354 미만입니다. 그래서 전 매장 같은 값(독점 실매출로
            맞춘 상수)을 씁니다. 상품매출 비율은 이제 <b>파라미터가 아니라 결과</b>입니다.
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">축척은 둘이고, 각각 실측값에 맞춥니다</b>
          <div className="mt-1">
            층마다 실측값이 따로 있으니(가동률은 매출DB, 매출도 매출DB) 축척도 따로 맞춥니다.
            하나로 겸하게 하면 매출 환산이 틀린 만큼이 <b>가동률로 되밀려 들어갑니다</b> —
            2026-09-16까지 그랬고, 그래서 독점 3곳 가동률이 −3.2~−5.3% 어긋나 보였습니다.
          </div>
          <div className="mt-1">
            ① 1인당 월이용시간 <b>{fitted.toFixed(3)}시간</b> ← 독점매장 <b>실측 가동률</b>
            {usersPerPc != null && <> (환산수요 <b>{usersPerPc.toLocaleString()}명</b>이 PC 1대를 100% 채우는 셈)</>}
          </div>
          <div className="mt-1">
            ② 상품몫 <b>{Math.round(productUnitPrice).toLocaleString()}원</b> ← 독점매장 <b>실매출</b> (PC몫은 정가에서 바로 나오므로 맞출 게 없습니다)
          </div>
          {!scaledOnUtilization && (
            <div className="mt-1 text-[var(--sl-warn,#b4530a)]">
              ⚠ 실측 가동률이 하나도 없어 ①을 매출로 맞췄습니다. 두 층이 다시 엉킨 상태입니다.
            </div>
          )}
        </li>
      </ol>

      <div className="mt-3 rounded-lg bg-[#171310]/5 px-3 py-2 dark:bg-white/5">
        <b className="text-[#171310] dark:text-[#f2ede2]">판정 기준</b> — 독점매장(경쟁 0곳)은 점유율이
        1이라 <b>수요식만 발가벗겨집니다.</b> 거기서 안 맞으면 수요가 틀린 것이고 경쟁력·입지로 덮을 수도
        없습니다. 다만 독점이 3곳뿐이라(탕정역·광주각화·남악) 오차 1.1%와 1.3%의 차이는 잡음입니다 —
        <b> 5% 이내인지만 통과/탈락으로 보고</b>, 통과한 것들 중에서 전체로 가릅니다.
      </div>
    </details>
  );
}

function Controls({
  p, set, setAge, counts,
}: {
  p: TextbookParams;
  counts: { f100: number; f200: number; f300: number; f400: number; f500: number; total: number };
  set: <K extends keyof TextbookParams>(k: K, v: TextbookParams[K]) => void;
  setAge: (k: keyof TextbookParams["ageWeights"], v: number) => void;
}) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <section className="app-card rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">1단계 · 수요</h2>

        <Choice label="주거 반경" value={String(p.residentRadius)}
          options={[["500", "500m"], ["1000", "1km"]]}
          onChange={(v) => set("residentRadius", Number(v) as ResidentRadius)}
          hint={p.residentRadius === 500 ? "500m는 연령 분해 자료가 없어 총인구만 씁니다" : "1km는 연령·성별 분해까지 있습니다"} />

        <Choice label="유동 반경" value={String(p.floatingRadius)}
          options={[["100", "100m"], ["200", "200m"], ["300", "300m"], ["400", "400m"], ["500", "500m"]]}
          onChange={(v) => set("floatingRadius", Number(v) as FloatingRadius)}
          hint={`수집된 매장 — 100m ${counts.f100} · 200m ${counts.f200} · 300m ${counts.f300} · 400m ${counts.f400} · 500m ${counts.f500}곳 (표본 ${counts.total}곳). 아직 안 모은 반경을 고르면 그 매장은 계산에서 빠집니다. 500m는 출처가 달라 100~400m끼리 비교하는 게 맞습니다.`} />

        <Slider label="유동 계수" value={p.floatingFactor} min={0} max={1} step={0.05}
          onChange={(v) => set("floatingFactor", v)}
          hint="스쳐 가는 사람이 대부분이라 1.0일 수 없습니다. 0이면 주거만 씁니다." />

        <Slider label="상권 흡인력" value={p.agglomerationFactor} min={0} max={1} step={0.05}
          onChange={(v) => set("agglomerationFactor", v)}
          hint="경쟁점이 많다 = 그 자리가 좋다. 수요에 (1 + 계수 × ln(1+경쟁점수))를 곱합니다. 0이면 끕니다." />

        <div className="mt-3 flex gap-4">
          <Toggle label="주거 연령가중" checked={p.useResidentAgeWeights} onChange={(v) => set("useResidentAgeWeights", v)} />
          <Toggle label="유동 연령가중" checked={p.useFloatingAgeWeights} onChange={(v) => set("useFloatingAgeWeights", v)} />
        </div>
      </section>

      <section className="app-card rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">2단계 · 점유율</h2>

        <Slider label="PC방 안 가는 몫" value={p.outsideOptionIp} min={0} max={3000} step={100}
          onChange={(v) => set("outsideOptionIp", v)}
          hint="경쟁IP와 같은 단위로 분모에 더합니다. 0이면 경쟁점 없는 상권의 점유율이 100%가 되어 수요를 통째로 먹습니다." />

        <Slider label="경쟁력격차 지수" value={p.gapExponent} min={0} max={4} step={0.1}
          onChange={(v) => set("gapExponent", v)}
          hint="1이면 기존 구조와 같습니다. 높일수록 경쟁력 차이를 세게 봅니다." />

        <h2 className="mt-5 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">3단계 · 매출</h2>
        <Slider label="정가 탄력도" value={p.rateElasticity} min={0} max={1} step={0.001}
          onChange={(v) => set("rateElasticity", v)}
          hint="정가를 올려도 실제로 받는 돈은 그만큼 다 안 오릅니다(정액권 할인). 0.546은 운영 산식과 같은 값이고, 0이면 정가가 매출을 안 바꿉니다. 0으로 내리면 독점 최대오차가 12.8%→8.5%로 줄지만 요금 조절이 무의미해집니다." />
        {/* 상품매출 비율 조절판은 2026-09-16 저녁(3)에 없앴다 — 이제 파라미터가 아니라 결과다.
            상품몫(원/PC·시간)은 독점 실매출로 자동으로 맞춘다. */}
        <Slider label="가동률 상한" value={p.maxUtilization} min={0.5} max={1} step={0.01}
          onChange={(v) => set("maxUtilization", v)} hint="좌석이 모자라 더는 못 받는 선." />
      </section>

      <section className="app-card rounded-xl p-4 md:col-span-2">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">연령별 PC방 이용률</h2>
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          이 연령 100명 중 몇 명이 PC방을 쓰는가. 절대값보다 <b>연령 간 비율</b>이 중요합니다 —
          전체 크기는 1인당 월이용시간 배율이 자동으로 흡수합니다.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["age0s", "0~9세"], ["age10s", "10대"], ["age20s", "20대"], ["age30s", "30대"],
            ["age40s", "40대"], ["age50s", "50대"], ["age60plus", "60대+"],
          ] as [keyof TextbookParams["ageWeights"], string][]).map(([k, label]) => (
            <Slider key={k} label={label} value={p.ageWeights[k]} min={0} max={1} step={0.01}
              onChange={(v) => setAge(k, v)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function StoreTable({ score }: { score: TextbookScore }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">매장별 (오차 큰 순)</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[#171310]/10 text-xs text-[var(--sl-ink-soft)] dark:border-white/10">
            <tr>
              <th scope="col" className="px-3 py-2">매장</th>
              <th scope="col" className="px-3 py-2 text-right">예상매출</th>
              <th scope="col" className="px-3 py-2 text-right">실제매출</th>
              <th scope="col" className="px-3 py-2 text-right">오차</th>
              <th scope="col" className="px-3 py-2 text-right">예상가동률</th>
              <th scope="col" className="px-3 py-2 text-right">실측가동률</th>
              <th scope="col" className="px-3 py-2 text-right">가동률오차</th>
              <th scope="col" className="px-3 py-2 text-right">점유율</th>
              <th scope="col" className="px-3 py-2">비고</th>
            </tr>
          </thead>
          <tbody>
            {score.rows.map((r) => {
              const bad = (r.absErrPct ?? 0) > 0.2;
              return (
                <tr key={r.storeCode} className="border-b border-[#171310]/[0.06] dark:border-white/[0.06]">
                  <td className="px-3 py-2">{r.storeName ?? r.storeCode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{manwon(r.predicted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{manwon(r.actual)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${bad ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>
                    {pct(r.absErrPct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.utilization)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.actualUtilization)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${(r.utilErrPct ?? 0) > 0.2 ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>
                    {pct(r.utilErrPct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.share)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--sl-ink-soft)]">
                    {r.capped && "가동률 상한 "}
                    {r.missing.length > 0 && `자료없음: ${r.missing.join(", ")}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- 작은 입력 부품들 ----

function Slider({ label, value, min, max, step, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-[#171310] dark:text-[#f2ede2]">{label}</label>
        <span className="text-xs tabular-nums text-[var(--sl-ink-soft)]">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--sl-gold-ink)]" />
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-[var(--sl-ink-soft)]">{hint}</p>}
    </div>
  );
}

function Choice({ label, value, options, onChange, hint, disabled }: {
  label: string; value: string; options: [string, string][];
  onChange: (v: string) => void; hint?: string; disabled?: string[];
}) {
  return (
    <div className="mt-3">
      <label className="text-xs font-medium text-[#171310] dark:text-[#f2ede2]">{label}</label>
      <div className="mt-1 flex gap-2">
        {options.map(([v, text]) => {
          const off = disabled?.includes(v);
          return (
            <button key={v} type="button" disabled={off} onClick={() => onChange(v)}
              className={`rounded-lg px-3 py-1.5 text-xs ${
                value === v ? "app-btn-primary" : off ? "app-btn-outline opacity-40" : "app-btn-outline"
              }`}
              title={off ? "아직 수집된 자료가 없습니다" : undefined}>
              {text}{off && " (자료없음)"}
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-[var(--sl-ink-soft)]">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-[#171310] dark:text-[#f2ede2]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--sl-gold-ink)]" />
      {label}
    </label>
  );
}
