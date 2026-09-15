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
  DEFAULT_TEXTBOOK_PARAMS, scoreTextbook,
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
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        pop500m: s.pop500m, pop1km: s.pop1km,
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
        표본 {score.sampleCount}곳 · 목표 MAPE 10%(마지노선 20%) ·
        1인당 월이용시간 배율은 매번 자동으로 맞춥니다(현재 {score.fittedHoursPerUser.toFixed(2)}).
      </p>
    </div>
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
        <Slider label="상품매출 비율" value={p.productRatio} min={0} max={0.8} step={0.01}
          onChange={(v) => set("productRatio", v)} hint="회사 기준 50%. 실측 38곳 중앙값 52%." />
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
              <th scope="col" className="px-3 py-2 text-right">교과서식</th>
              <th scope="col" className="px-3 py-2 text-right">실제</th>
              <th scope="col" className="px-3 py-2 text-right">오차</th>
              <th scope="col" className="px-3 py-2 text-right">가동률</th>
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
