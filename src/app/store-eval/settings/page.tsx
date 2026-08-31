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
  target10pctRatio: "목표 ±10% 이내 비율(정식 도입 핵심 조건)",
  "v61Fallback.intercept": "V61 폴백 - 절편",
  "v61Fallback.hourlyRateCoef": "V61 폴백 - 요금계수",
  "v61Fallback.demandPerPcCoef": "V61 폴백 - 수요PC계수",
  "v61Fallback.competitivenessCoef": "V61 폴백 - 자사점수계수",
  "marketCharacterThreshold.downtown": "상권성격 임계값 - 번화가(8배)",
  "marketCharacterThreshold.mixed": "상권성격 임계값 - 혼합(4배)",
  "marketDemandEffectiveRate.downtown": "상권수요 유효율 - 번화가",
  "marketDemandEffectiveRate.mixed": "상권수요 유효율 - 혼합",
  "marketDemandEffectiveRate.residential": "상권수요 유효율 - 주거중심",
  "marketGradeAbsoluteThresholds.SS": "상권등급 기준(절대) - SS",
  "marketGradeAbsoluteThresholds.S": "상권등급 기준(절대) - S",
  "marketGradeAbsoluteThresholds.A": "상권등급 기준(절대) - A",
  "competitivenessWeights.spec": "경쟁력 가중치 - 사양",
  "competitivenessWeights.seat": "경쟁력 가중치 - 좌석",
  "competitivenessWeights.food": "경쟁력 가중치 - 먹거리",
  "competitivenessWeights.interior": "경쟁력 가중치 - 인테리어",
  "competitivenessWeights.location": "경쟁력 가중치 - 입지",
  "specWeights.vga": "사양 가중치 - VGA",
  "specWeights.monitor": "사양 가중치 - 모니터",
  "foodBrandScores.쉐프앤클릭": "먹거리 브랜드 점수 - 쉐프앤클릭",
  "foodBrandScores.한끼의품격": "먹거리 브랜드 점수 - 한끼의품격",
  "foodBrandScores.XOXO": "먹거리 브랜드 점수 - XOXO",
  "foodBrandScores.PC토랑": "먹거리 브랜드 점수 - PC토랑",
  "foodBrandScores.비바쿡": "먹거리 브랜드 점수 - 비바쿡",
  "foodBrandScores.농심": "먹거리 브랜드 점수 - 농심",
  "foodBrandScores.기타브랜드": "먹거리 브랜드 점수 - 기타브랜드",
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
      <span className="text-[#5c5346] dark:text-[#c9bfae]">{label}</span>
      <input
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : 0}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className={`app-input px-3 py-1.5 text-sm ${readOnly ? "opacity-60" : ""}`}
      />
      {hint && <span className="text-xs text-[#8a8072]">{hint}</span>}
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
      <span className="text-[#5c5346] dark:text-[#c9bfae]">{label}</span>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`app-input px-3 py-1.5 text-sm ${readOnly ? "opacity-60" : ""}`}
      />
      {hint && <span className="text-xs text-[#8a8072]">{hint}</span>}
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
    <section className="app-card rounded-2xl p-5">
      <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">{title}</h2>
      {description && <p className="mt-1 text-xs leading-5 text-[#8a8072]">{description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">{children}</div>
      {warning && <p className="app-badge app-badge-warn mt-3 w-full justify-start py-2 text-xs">⚠ {warning}</p>}
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
  const [reason, setReason] = useState("");

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

  const specWeightSum = form ? form.specWeights.vga + form.specWeights.monitor + form.specWeights.ram + form.specWeights.cpu : 1;
  const facilityWeightSum = form ? form.facilityWeights.zoneComposition + form.facilityWeights.interior + form.facilityWeights.management : 1;
  const competitivenessWeightSum = form
    ? form.competitivenessWeights.spec + form.competitivenessWeights.food + form.competitivenessWeights.interior + form.competitivenessWeights.location
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

  // 2026-08-25 추가 — 저장을 막는 실제 검증(기존엔 가중치 합 경고를 보여주기만 하고 저장은
  // 그냥 됐다). 외부유입 보정률은 "덜 준다(0%)~아예 없다고 보고 크게 깎는다(-100%)" 사이의
  // 할인율이라 0~-1 범위를 벗어나면 실수로 보고 막는다.
  function validationErrors(f: ModelSettings): string[] {
    const errors: string[] = [];
    const specSum = sumWarning(f.specWeights.vga + f.specWeights.monitor + f.specWeights.ram + f.specWeights.cpu, "하드웨어(GPU/모니터/RAM/CPU)");
    const facilitySum = sumWarning(
      f.facilityWeights.zoneComposition + f.facilityWeights.interior + f.facilityWeights.management,
      "시설(존구성/인테리어/관리)",
    );
    const compSum = sumWarning(
      f.competitivenessWeights.spec + f.competitivenessWeights.food + f.competitivenessWeights.interior + f.competitivenessWeights.location,
      "경쟁력",
    );
    const locSum = sumWarning(
      f.locationCompositeWeights.withinMarket +
        f.locationCompositeWeights.flow +
        f.locationCompositeWeights.preemption +
        f.locationCompositeWeights.visibility,
      "입지동선종합점수",
    );
    for (const w of [specSum, facilitySum, compSum, locSum]) if (w) errors.push(w);
    for (const [label, v] of Object.entries(f.inflowAdjustment)) {
      if (v > 0 || v < -1) errors.push(`외부유입 보정률 - ${label}은(는) 0~-100%(-1~0) 범위여야 합니다. 현재: ${(v * 100).toFixed(1)}%`);
    }
    return errors;
  }

  async function handleSave() {
    if (!form) return;
    setSaveMessage(null);
    setSaveError(null);
    if (!reason.trim()) {
      setSaveError("변경 사유를 입력해주세요 — 이후 다른 관리자가 이력을 볼 때 왜 바꿨는지 알 수 있어야 합니다.");
      return;
    }
    const errors = validationErrors(form);
    if (errors.length > 0) {
      setSaveError(errors.join(" / "));
      return;
    }
    setSaving(true);
    try {
      await saveModelSettings(form, user?.email ?? null, reason.trim());
      setSaveMessage("저장되었습니다.");
      setUsingDefault(false);
      setReason("");
      await reloadHistory();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 2026-08-25 추가 — 이전 버전으로 되돌리기. 그 시점의 값을 폼에 다시 채워 넣기만 하고 바로
  // 저장하지는 않는다 — 사용자가 검토하고 사유를 적은 뒤 평소와 같은 "저장" 버튼을 눌러야
  // 실제로 반영된다(롤백도 새 변경이력 한 줄로 남는다, 과거를 지우지 않는다).
  function handleRestore(entry: ModelSettingsHistoryEntry) {
    setForm(entry.after);
    setReason(`롤백: ${formatDateTime(entry.changedAt)} 시점(${entry.changedBy ?? "알수없음"})으로 복원`);
    setSaveError(null);
    setSaveMessage('복원할 값을 불러왔습니다 — 위 항목들을 확인하고 "저장"을 눌러야 실제로 반영됩니다.');
  }

  const readOnly = !isAdmin;

  if (loading || adminLoading) {
    return <div className="py-16 text-center text-sm text-[#8a8072]">불러오는 중...</div>;
  }

  if (loadError) {
    return (
      <div className="app-badge app-badge-danger w-full justify-start rounded-2xl p-6 text-sm">
        설정을 불러오지 못했습니다: {loadError}
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div>
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">7. 운영설정</h1>
        <p className="mt-1 text-sm text-[#8a8072]">
          V61/V62 계산에 쓰이는 계수와 판정 기준을 관리합니다. 값을 바꾸면 이후의 모든 계산에 즉시 반영됩니다.
        </p>
      </div>

      {usingDefault && (
        <p className="app-badge app-badge-warn w-full justify-start py-3 text-sm">
          아직 저장된 설정이 없습니다 - 기본값을 보여줍니다.
        </p>
      )}

      {!isAdmin && (
        <p className="app-badge app-badge-neutral w-full justify-start py-3 text-sm">
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
        <NumberInput
          label="목표 ±10% 이내 비율(정식 도입 핵심 조건)"
          value={form.target10pctRatio}
          onChange={(v) => updateTop("target10pctRatio", v)}
          readOnly={readOnly}
        />
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
          label="상권등급 기준(절대) - SS"
          value={form.marketGradeAbsoluteThresholds.SS}
          onChange={(v) => updateGroup("marketGradeAbsoluteThresholds", "SS", v)}
          readOnly={readOnly}
          hint="상권수요가 이 값 이상이면 SS"
        />
        <NumberInput
          label="상권등급 기준(절대) - S"
          value={form.marketGradeAbsoluteThresholds.S}
          onChange={(v) => updateGroup("marketGradeAbsoluteThresholds", "S", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="상권등급 기준(절대) - A"
          value={form.marketGradeAbsoluteThresholds.A}
          onChange={(v) => updateGroup("marketGradeAbsoluteThresholds", "A", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="경쟁력 가중치 / 하드웨어 가중치"
        description="자사_경쟁력점수(BM) = 하드웨어×spec + 인테리어·좌석·관리×interior + 먹거리×food + 입지×location (2026-08-28 전면개편 — 좌석·존구성은 더 이상 독립 배점이 아니라 인테리어 항목의 세부 비중으로 흡수됨)"
        warning={sumWarning(competitivenessWeightSum, "경쟁력") ?? sumWarning(specWeightSum, "하드웨어(GPU/모니터/RAM/CPU)")}
      >
        <NumberInput
          label="경쟁력 가중치 - 하드웨어"
          value={form.competitivenessWeights.spec}
          onChange={(v) => updateGroup("competitivenessWeights", "spec", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 인테리어·좌석·관리"
          value={form.competitivenessWeights.interior}
          onChange={(v) => updateGroup("competitivenessWeights", "interior", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 먹거리"
          value={form.competitivenessWeights.food}
          onChange={(v) => updateGroup("competitivenessWeights", "food", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="경쟁력 가중치 - 입지"
          value={form.competitivenessWeights.location}
          onChange={(v) => updateGroup("competitivenessWeights", "location", v)}
          readOnly={readOnly}
        />
        <div className="hidden md:block" aria-hidden />
        <div className="hidden md:block" aria-hidden />
        <NumberInput
          label="하드웨어 가중치 - GPU"
          value={form.specWeights.vga}
          onChange={(v) => updateGroup("specWeights", "vga", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="하드웨어 가중치 - 모니터"
          value={form.specWeights.monitor}
          onChange={(v) => updateGroup("specWeights", "monitor", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="하드웨어 가중치 - CPU"
          value={form.specWeights.cpu}
          onChange={(v) => updateGroup("specWeights", "cpu", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="하드웨어 가중치 - RAM"
          value={form.specWeights.ram}
          onChange={(v) => updateGroup("specWeights", "ram", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="시설(인테리어·좌석·관리) 세부 가중치"
        description="시설종합점수 = 존구성×zoneComposition + 인테리어×interior + 관리×management (2026-08-31 산식 개편 — 시트 수식 그대로 이식, 최신성/청결/편의성은 더 이상 반영 안 함)"
        warning={sumWarning(facilityWeightSum, "시설(존구성/인테리어/관리)")}
      >
        <NumberInput
          label="시설 가중치 - 존구성"
          value={form.facilityWeights.zoneComposition}
          onChange={(v) => updateGroup("facilityWeights", "zoneComposition", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="시설 가중치 - 인테리어"
          value={form.facilityWeights.interior}
          onChange={(v) => updateGroup("facilityWeights", "interior", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="시설 가중치 - 관리"
          value={form.facilityWeights.management}
          onChange={(v) => updateGroup("facilityWeights", "management", v)}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="먹거리 브랜드별 점수"
        description="브랜드명만 확인되면 이 기본값을 쓴다(직접입력값이 있으면 그게 우선). 브랜드만으로 4점 이상 주지 않는 게 원칙 - 2026-08-30 경쟁력 평가 기준 최종본 §11."
      >
        <NumberInput
          label="쉐프앤클릭 (블랙라벨 자체, 최신 우수 운영매장 수준)"
          value={form.foodBrandScores.쉐프앤클릭}
          onChange={(v) => updateGroup("foodBrandScores", "쉐프앤클릭", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="한끼의품격"
          value={form.foodBrandScores.한끼의품격}
          onChange={(v) => updateGroup("foodBrandScores", "한끼의품격", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="XOXO"
          value={form.foodBrandScores.XOXO}
          onChange={(v) => updateGroup("foodBrandScores", "XOXO", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="PC토랑"
          value={form.foodBrandScores.PC토랑}
          onChange={(v) => updateGroup("foodBrandScores", "PC토랑", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="비바쿡"
          value={form.foodBrandScores.비바쿡}
          onChange={(v) => updateGroup("foodBrandScores", "비바쿡", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="농심"
          value={form.foodBrandScores.농심}
          onChange={(v) => updateGroup("foodBrandScores", "농심", v)}
          readOnly={readOnly}
        />
        <NumberInput
          label="기타 브랜드"
          value={form.foodBrandScores.기타브랜드}
          onChange={(v) => updateGroup("foodBrandScores", "기타브랜드", v)}
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
        <p className="text-xs text-[#8a8072]">
          마지막 저장: {formatDateTime(form.updatedAt)}
          {form.updatedBy ? ` (${form.updatedBy})` : ""}
        </p>
      )}

      {isAdmin && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[#5c5346] dark:text-[#c9bfae]">변경 사유 (필수)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: ±10% 적중률 재보정을 위해 외부유입 보정률 강함을 -20%→-25%로 조정"
              className="app-input px-3 py-1.5 text-sm"
            />
          </label>
          <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
          {saveMessage && <span className="text-sm text-[var(--sl-ok)]">{saveMessage}</span>}
          {saveError && <span className="text-sm text-[var(--sl-danger)]">{saveError}</span>}
          </div>
        </div>
      )}

      <section className="app-card rounded-2xl p-5">
        <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">변경 이력</h2>
        {historyLoading ? (
          <p className="mt-3 text-sm text-[#8a8072]">불러오는 중...</p>
        ) : historyError ? (
          <p className="mt-3 text-sm text-[var(--sl-danger)]">이력을 불러오지 못했습니다: {historyError}</p>
        ) : history.length === 0 ? (
          <p className="mt-3 text-sm text-[#8a8072]">아직 변경 이력이 없습니다.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {history.map((entry) => {
              const diffs = diffEntries(entry.before, entry.after);
              return (
                <li key={entry.id} className="app-card-sm rounded-xl p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{formatDateTime(entry.changedAt)}</span>
                    <span className="text-[#8a8072]">변경자: {entry.changedBy ?? "알수없음"}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#5c5346] dark:text-[#c9bfae]">사유: {entry.reason ?? "(기록 없음 — 이 필드 도입 이전 변경)"}</p>
                  {diffs.length === 0 ? (
                    <p className="mt-2 text-xs text-[#8a8072]">변경된 값이 없습니다.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1 text-xs text-[#5c5346] dark:text-[#c9bfae]">
                      {diffs.map((d) => (
                        <li key={d.label}>
                          {d.label}: {d.before} → {d.after}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleRestore(entry)}
                      className="app-btn-outline mt-3 rounded-md px-2.5 py-1 text-xs font-medium"
                    >
                      이 시점 값으로 되돌리기
                    </button>
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
