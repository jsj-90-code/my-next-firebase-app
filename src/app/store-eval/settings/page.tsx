"use client";

// 7. 운영설정 화면 - 12_운영판정 계수를 관리자만 편집할 수 있게 보여준다.
// 계산 로직은 이미 calc.ts 등에 있고, 이 화면은 ModelSettings 문서를 읽고/쓰는 것과
// 변경 이력을 보여주는 것만 담당한다. 진짜 권한 강제는 firestore.rules에서 하고,
// 여기서는 관리자가 아니면 입력을 readOnly로 만들고 저장 버튼을 숨기는 UX만 처리한다.

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getModelSettings, listModelSettingsHistory, saveModelSettings } from "@/lib/storeEval/store";
import type { ModelSettings, ModelSettingsHistoryEntry } from "@/lib/storeEval/types";
import { useIsStoreEvalAdmin } from "@/lib/storeEval/useIsAdmin";

function makeDefaultSettings(): ModelSettings {
  return { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };
}

// 변경이력에서 "무엇이 바뀌었는지"를 보여줄 때 쓰는 필드 라벨. 새 계수를 추가하면 여기도 같이 추가한다.
const FIELD_LABELS: Record<string, string> = {
  "inflowAdjustment.없음": "외부유입 보정률 - 없음",
  "inflowAdjustment.보통": "외부유입 보정률 - 보통",
  "inflowAdjustment.강함": "외부유입 보정률 - 강함",
  lowerBoundFactor: "하한 계수(85%)",
  upperBoundFactor: "상한 계수(115%)",
  minTotalSample: "최소 전체표본수",
  minStrongInflowSample: "최소 강함표본수",
  targetMAE: "목표 평균절대오차(MAE)",
  targetMedianAE: "목표 중앙절대오차",
  target20pctRatio: "목표 ±20% 이내 비율",
  maxAvgBias: "허용 평균편향",
  "v61Fallback.intercept": "V61 폴백 - 절편",
  "v61Fallback.hourlyRateCoef": "V61 폴백 - 요금계수",
  "v61Fallback.demandPerPcCoef": "V61 폴백 - 수요PC계수",
  "v61Fallback.competitivenessCoef": "V61 폴백 - 자사점수계수",
  "marketCharacterThreshold.downtown": "상권성격 임계값 - 번화가(8배)",
  "marketCharacterThreshold.mixed": "상권성격 임계값 - 혼합(4배)",
  "marketDemandEffectiveRate.downtown": "상권수요 유효율 - 번화가",
  "marketDemandEffectiveRate.mixed": "상권수요 유효율 - 혼합",
  "marketDemandEffectiveRate.residential": "상권수요 유효율 - 주거중심",
  "marketGradePercentile.SS": "상권등급 백분위 - SS",
  "marketGradePercentile.S": "상권등급 백분위 - S",
  "marketGradePercentile.A": "상권등급 백분위 - A",
  "competitivenessWeights.spec": "경쟁력 가중치 - 사양",
  "competitivenessWeights.seat": "경쟁력 가중치 - 좌석",
  "competitivenessWeights.food": "경쟁력 가중치 - 먹거리",
  "competitivenessWeights.interior": "경쟁력 가중치 - 인테리어",
  "competitivenessWeights.location": "경쟁력 가중치 - 입지",
  "specWeights.vga": "사양 가중치 - VGA",
  "specWeights.monitor": "사양 가중치 - 모니터",
  "locationCompositeWeights.withinMarket": "입지동선 가중치 - 상권내위치",
  "locationCompositeWeights.flow": "입지동선 가중치 - 주요동선",
  "locationCompositeWeights.preemption": "입지동선 가중치 - 선점경쟁",
  "locationCompositeWeights.visibility": "입지동선 가중치 - 접근가시성",
  brandFilter: "브랜드 필터",
  saturationThreshold: "포화 기준(IP당수요)",
  modelVersion: "모델버전",
};

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function formatDiffValue(v: unknown): string {
  if (v == null) return "-";
  return String(v);
}

function diffEntries(before: ModelSettings, after: ModelSettings): { label: string; before: string; after: string }[] {
  const entries: { label: string; before: string; after: string }[] = [];
  for (const [path, label] of Object.entries(FIELD_LABELS)) {
    const b = getPath(before, path);
    const a = getPath(after, path);
    if (b !== a) entries.push({ label, before: formatDiffValue(b), after: formatDiffValue(a) });
  }
  return entries;
}

function NumberInput({
  label,
  value,
  onChange,
  readOnly,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  readOnly: boolean;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : 0}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className={`rounded-lg border px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-50 ${
          readOnly
            ? "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
        }`}
      />
      {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  readOnly,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-50 ${
          readOnly
            ? "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
        }`}
      />
      {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

function Section({
  title,
  description,
  children,
  warning,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  warning?: string | null;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {description && <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">{children}</div>
      {warning && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ⚠ {warning}
        </p>
      )}
    </section>
  );
}

export default function StoreEvalSettingsPage() {
  const { user } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsStoreEvalAdmin();

  const [form, setForm] = useState<ModelSettings | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [history, setHistory] = useState<ModelSettingsHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const s = await getModelSettings();
        if (cancelled) return;
        if (s) {
          setForm(s);
          setUsingDefault(false);
        } else {
          setForm(makeDefaultSettings());
          setUsingDefault(true);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "설정을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const h = await listModelSettingsHistory();
      setHistory(h);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "변경 이력을 불러오지 못했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    reloadHistory();
  }, []);

  function updateTop<K extends keyof ModelSettings>(field: K, value: ModelSettings[K]) {
    setForm((f) => (f ? { ...f, [field]: value } : f));
  }

  function updateGroup<K extends keyof ModelSettings>(group: K, field: string, value: number) {
    setForm((f) => {
      if (!f) return f;
      const current = f[group] as unknown as Record<string, number>;
      return { ...f, [group]: { ...current, [field]: value } };
    });
  }

  const specWeightSum = form ? form.specWeights.vga + form.specWeights.monitor : 1;
  const competitivenessWeightSum = form
    ? form.competitivenessWeights.spec +
      form.competitivenessWeights.seat +
      form.competitivenessWeights.food +
      form.competitivenessWeights.interior +
      form.competitivenessWeights.location
    : 1;
  const locationWeightSum = form
    ? form.locationCompositeWeights.withinMarket +
      form.locationCompositeWeights.flow +
      form.locationCompositeWeights.preemption +
      form.locationCompositeWeights.visibility
    : 1;

  function sumWarning(sum: number, label: string): string | null {
    if (Math.abs(sum - 1) < 0.001) return null;
    return `${label} 가중치 합이 100%(1.0)가 아닙니다. 현재 합: ${(sum * 100).toFixed(1)}%`;
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await saveModelSettings(form, user?.email ?? null);
      setSaveMessage("저장되었습니다.");
      setUsingDefault(false);
      await reloadHistory();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const readOnly = !isAdmin;

  if (loading || adminLoading) {
    return <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">불러오는 중...</div>;
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        설정을 불러오지 못했습니다: {loadError}
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">7. 운영설정</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          V61/V62 계산에 쓰이는 계수와 판정 기준을 관리합니다. 값을 바꾸면 이후의 모든 계산에 즉시 반영됩니다.
        </p>
      </div>

      {usingDefault && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          아직 저장된 설정이 없습니다 - 기본값을 보여줍니다.
        </p>
      )}

      {!isAdmin && (
        <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          운영설정 변경 권한이 없어 조회만 가능합니다. 값 변경이 필요하면 관리자에게 문의하세요.
        </p>
      )}

      <Section title="외부유입 보정률 / 상하한 계수" description="09_입지동선평가의 외부유입제한 값에 따라 V62 보정률이 정해집니다.">
        <NumberInput
          label="보정률 - 없음"
          value={form.inflowAdjustment.없음}
          onChange={(v) => updateGroup("inflowAdjustment", "없음", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="보정률 - 보통"
          value={form.inflowAdjustment.보통}
          onChange={(v) => updateGroup("inflowAdjustment", "보통", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="보정률 - 강함"
          value={form.inflowAdjustment.강함}
          onChange={(v) => updateGroup("inflowAdjustment", "강함", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="하한 계수 (85%)"
          value={form.lowerBoundFactor}
          onChange={(v) => updateTop("lowerBoundFactor", v)}
          readOnly={readOnly}
          hint="보수판단매출 = V62 × 이 값"
        />
        <NumberInput
          label="상한 계수 (115%)"
          value={form.upperBoundFactor}
          onChange={(v) => updateTop("upperBoundFactor", v)}
          readOnly={readOnly}
          hint="상한참고매출 = V62 × 이 값"
        />
      </Section>

      <Section title="검증 통과기준" description="6.기존 가맹점 검증 화면의 요약지표가 이 기준과 비교되어 통과/재보정/추가필요를 판정합니다.">
        <NumberInput label="최소 전체표본수" value={form.minTotalSample} onChange={(v) => updateTop("minTotalSample", v)} readOnly={readOnly} />
        <NumberInput
          label="최소 강함표본수"
          value={form.minStrongInflowSample}
          onChange={(v) => updateTop("minStrongInflowSample", v)}
          readOnly={readOnly}
        />
        <NumberInput label="목표 MAE" value={form.targetMAE} onChange={(v) => updateTop("targetMAE", v)} readOnly={readOnly} />
        <NumberInput
          label="목표 중앙오차"
          value={form.targetMedianAE}
          onChange={(v) => updateTop("targetMedianAE", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="목표 20% 이내 비율"
          value={form.target20pctRatio}
          onChange={(v) => updateTop("target20pctRatio", v)}
          readOnly={readOnly}
        />
        <NumberInput label="허용 평균편향" value={form.maxAvgBias} onChange={(v) => updateTop("maxAvgBias", v)} readOnly={readOnly} />
      </Section>

      <Section
        title="V61 폴백 회귀계수"
        description="13_신규후보지판정 G열 폴백식에서만 쓰이는 근사 계수입니다. 07 시트에 Apps Script가 채운 예측_월매출 값이 있으면 이 계수는 쓰이지 않습니다."
      >
        <NumberInput
          label="절편"
          value={form.v61Fallback.intercept}
          onChange={(v) => updateGroup("v61Fallback", "intercept", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="요금계수"
          value={form.v61Fallback.hourlyRateCoef}
          onChange={(v) => updateGroup("v61Fallback", "hourlyRateCoef", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="수요PC계수"
          value={form.v61Fallback.demandPerPcCoef}
          onChange={(v) => updateGroup("v61Fallback", "demandPerPcCoef", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="자사점수계수"
          value={form.v61Fallback.competitivenessCoef}
          onChange={(v) => updateGroup("v61Fallback", "competitivenessCoef", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section title="상권성격 임계값 / 상권수요 유효율 / 상권등급 백분위">
        <NumberInput
          label="상권성격 임계값 - 번화가(8배)"
          value={form.marketCharacterThreshold.downtown}
          onChange={(v) => updateGroup("marketCharacterThreshold", "downtown", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="상권성격 임계값 - 혼합(4배)"
          value={form.marketCharacterThreshold.mixed}
          onChange={(v) => updateGroup("marketCharacterThreshold", "mixed", v)}
          readOnly={readOnly}
        />
        <div className="hidden md:block" aria-hidden />
        <NumberInput
          label="상권수요 유효율 - 번화가"
          value={form.marketDemandEffectiveRate.downtown}
          onChange={(v) => updateGroup("marketDemandEffectiveRate", "downtown", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="상권수요 유효율 - 혼합"
          value={form.marketDemandEffectiveRate.mixed}
          onChange={(v) => updateGroup("marketDemandEffectiveRate", "mixed", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="상권수요 유효율 - 주거중심"
          value={form.marketDemandEffectiveRate.residential}
          onChange={(v) => updateGroup("marketDemandEffectiveRate", "residential", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="상권등급 백분위 - SS"
          value={form.marketGradePercentile.SS}
          onChange={(v) => updateGroup("marketGradePercentile", "SS", v)}
          readOnly={readOnly}
          hint="상위 이 비율 이내면 SS"
        />
        <NumberInput
          label="상권등급 백분위 - S"
          value={form.marketGradePercentile.S}
          onChange={(v) => updateGroup("marketGradePercentile", "S", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="상권등급 백분위 - A"
          value={form.marketGradePercentile.A}
          onChange={(v) => updateGroup("marketGradePercentile", "A", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="경쟁력 가중치 / 사양 가중치"
        description="자사_경쟁력점수(BM) = 사양×spec + 좌석×seat + 먹거리×food + 인테리어×interior + 입지×location"
        warning={sumWarning(competitivenessWeightSum, "경쟁력") ?? sumWarning(specWeightSum, "사양(VGA/모니터)")}
      >
        <NumberInput
          label="경쟁력 가중치 - 사양"
          value={form.competitivenessWeights.spec}
          onChange={(v) => updateGroup("competitivenessWeights", "spec", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 좌석"
          value={form.competitivenessWeights.seat}
          onChange={(v) => updateGroup("competitivenessWeights", "seat", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 먹거리"
          value={form.competitivenessWeights.food}
          onChange={(v) => updateGroup("competitivenessWeights", "food", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 인테리어"
          value={form.competitivenessWeights.interior}
          onChange={(v) => updateGroup("competitivenessWeights", "interior", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 입지"
          value={form.competitivenessWeights.location}
          onChange={(v) => updateGroup("competitivenessWeights", "location", v)}
          readOnly={readOnly}
        />
        <div className="hidden md:block" aria-hidden />
        <NumberInput
          label="사양 가중치 - VGA"
          value={form.specWeights.vga}
          onChange={(v) => updateGroup("specWeights", "vga", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="사양 가중치 - 모니터"
          value={form.specWeights.monitor}
          onChange={(v) => updateGroup("specWeights", "monitor", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="입지동선종합점수 가중치"
        description="09_입지동선평가!H열 = 상권내위치×withinMarket + 주요동선×flow + 선점경쟁×preemption + 접근가시성×visibility"
        warning={sumWarning(locationWeightSum, "입지동선종합점수")}
      >
        <NumberInput
          label="상권내위치"
          value={form.locationCompositeWeights.withinMarket}
          onChange={(v) => updateGroup("locationCompositeWeights", "withinMarket", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="주요동선"
          value={form.locationCompositeWeights.flow}
          onChange={(v) => updateGroup("locationCompositeWeights", "flow", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="선점경쟁"
          value={form.locationCompositeWeights.preemption}
          onChange={(v) => updateGroup("locationCompositeWeights", "preemption", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="접근가시성"
          value={form.locationCompositeWeights.visibility}
          onChange={(v) => updateGroup("locationCompositeWeights", "visibility", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section title="브랜드 필터 / 포화 기준 / 모델버전">
        <TextInput label="브랜드 필터" value={form.brandFilter} onChange={(v) => updateTop("brandFilter", v)} readOnly={readOnly} />
        <NumberInput
          label="포화 기준 (IP당수요)"
          value={form.saturationThreshold}
          onChange={(v) => updateTop("saturationThreshold", v)}
          readOnly={readOnly}
          hint="이 값보다 작으면 '포화 주의'"
        />
        <TextInput label="모델버전" value={form.modelVersion} onChange={(v) => updateTop("modelVersion", v)} readOnly={readOnly} />
      </Section>

      {form.updatedAt > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          마지막 저장: {formatDateTime(form.updatedAt)}
          {form.updatedBy ? ` (${form.updatedBy})` : ""}
        </p>
      )}

      {isAdmin && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
          {saveMessage && <span className="text-sm text-green-600 dark:text-green-400">{saveMessage}</span>}
          {saveError && <span className="text-sm text-red-600 dark:text-red-400">{saveError}</span>}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">변경 이력</h2>
        {historyLoading ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">불러오는 중...</p>
        ) : historyError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">이력을 불러오지 못했습니다: {historyError}</p>
        ) : history.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 변경 이력이 없습니다.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {history.map((entry) => {
              const diffs = diffEntries(entry.before, entry.after);
              return (
                <li key={entry.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{formatDateTime(entry.changedAt)}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">변경자: {entry.changedBy ?? "알수없음"}</span>
                  </div>
                  {diffs.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">변경된 값이 없습니다.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {diffs.map((d) => (
                        <li key={d.label}>
                          {d.label}: {d.before} → {d.after}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
