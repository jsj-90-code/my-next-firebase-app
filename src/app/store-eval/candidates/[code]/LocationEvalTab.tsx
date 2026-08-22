"use client";

// 탭3 입지동선평가 - "4. 입지동선 평가" 화면 요구사항.
// LocationEvaluation 타입 필드 전부 + 종합점수 실시간 미리보기(calc.ts, 저장하지 않음).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { computeLocationCompositeScore } from "@/lib/storeEval/calc";
import { formatScore } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getLocationEvaluation, getModelSettings, saveLocationEvaluation } from "@/lib/storeEval/store";
import type {
  BrandType,
  InflowRestriction,
  LocationEvaluation,
  ModelSettings,
  SpecialDemandIntensity,
  SpecialDemandType,
} from "@/lib/storeEval/types";
import { ScoreSelectField, SelectField, TextAreaField, gridClass, sectionClass, sectionTitleClass } from "./formFields";

const SPECIAL_DEMAND_TYPE_OPTIONS: { value: SpecialDemandType; label: string }[] = [
  { value: "없음", label: "없음" },
  { value: "대학가", label: "대학가" },
  { value: "군부대", label: "군부대" },
  { value: "산업단지", label: "산업단지" },
  { value: "관광유흥", label: "관광·유흥" },
  { value: "기타", label: "기타" },
];

const SPECIAL_DEMAND_INTENSITY_OPTIONS: { value: SpecialDemandIntensity; label: string }[] = [
  { value: "없음", label: "없음" },
  { value: "낮음", label: "낮음" },
  { value: "보통", label: "보통" },
  { value: "높음", label: "높음" },
];

const INFLOW_RESTRICTION_OPTIONS: { value: InflowRestriction; label: string }[] = [
  { value: "없음", label: "없음" },
  { value: "보통", label: "보통" },
  { value: "강함", label: "강함" },
];

const BRAND_TYPE_OPTIONS: { value: BrandType; label: string }[] = [
  { value: "블랙라벨", label: "블랙라벨" },
  { value: "리그PC방", label: "리그PC방" },
  { value: "확인필요", label: "확인필요" },
];

function blankLocationEvaluation(candidateCode: string, name: string, address: string): LocationEvaluation {
  return {
    candidateCode,
    name,
    address,
    locationScore: null,
    flowScore: null,
    preemptionScore: null,
    visibilityScore: null,
    mapMemo: null,
    attractionScore: null,
    specialDemandType: null,
    specialDemandIntensity: null,
    inflowRestriction: null,
    demandLeakageRisk: null,
    marketStructureMemo: null,
    brandType: null,
    updatedAt: Date.now(),
    updatedBy: null,
  };
}

export function LocationEvalTab({
  candidateCode,
  candidateName,
  candidateAddress,
}: {
  candidateCode: string;
  candidateName: string;
  candidateAddress: string;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<LocationEvaluation | null>(null);
  const [settings, setSettings] = useState<Pick<ModelSettings, "locationCompositeWeights"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [existing, modelSettings] = await Promise.all([getLocationEvaluation(candidateCode), getModelSettings()]);
      setForm(existing ?? blankLocationEvaluation(candidateCode, candidateName, candidateAddress));
      setSettings(modelSettings ?? defaultModelSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : "입지동선평가를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateCode]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof LocationEvaluation>(key: K, value: LocationEvaluation[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const compositePreview = useMemo(() => {
    if (!form || !settings) return null;
    return computeLocationCompositeScore(
      {
        withinMarket: form.locationScore,
        flow: form.flowScore,
        preemption: form.preemptionScore,
        visibility: form.visibilityScore,
      },
      settings,
    );
  }, [form, settings]);

  async function handleSave() {
    if (!form) return;
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const toSave: LocationEvaluation = { ...form, candidateCode, name: candidateName, address: candidateAddress };
      await saveLocationEvaluation(toSave, user?.email ?? null);
      setForm(toSave);
      setMessage("저장했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 요청사항(2026-08-22) — 공식 기준표가 없는 이 5개 점수는 원래도 "사람이 GPT에게 물어보고
  // 손으로 옮겨 적던" 방식이었다(위 참고사례 배지 참고). 그 과정을 앱 안으로 옮겨온 것뿐이며,
  // AI 결과는 절대 자동저장하지 않고 폼에만 채워 넣어 사람이 검토·수정 후 직접 저장하게 한다.
  async function handleAiFill() {
    if (!candidateAddress.trim()) {
      setAiError("주소가 없으면 AI가 조사할 수 없습니다. 기본정보 탭에서 주소를 먼저 입력해주세요.");
      return;
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/store-eval/ai-location-eval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ address: candidateAddress, name: candidateName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI 초안 생성에 실패했습니다.");
      setForm((prev) =>
        prev
          ? {
              ...prev,
              locationScore: data.locationScore,
              flowScore: data.flowScore,
              preemptionScore: data.preemptionScore,
              visibilityScore: data.visibilityScore,
              attractionScore: data.attractionScore,
              mapMemo: `AI 초안: ${data.rationale}`,
            }
          : prev,
      );
      setMessage(null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 초안 생성 중 오류가 발생했습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-500 dark:text-zinc-400">불러오는 중...</p>;
  if (!form) return <p className="text-sm text-zinc-500 dark:text-zinc-400">데이터를 불러오지 못했습니다.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <strong>공식 기준표 없음</strong> — 아래 4개 점수(상권내위치/주요동선/선점경쟁/접근가시성)의 1~5점 판단
        기준은 원본 스프레드시트 어디에도 문서화되어 있지 않습니다(docs/data-issues.md #2). 아래 참고자료는 원본
        시트에 실제로 기재됐던 사례 2건일 뿐 &ldquo;공식 기준&rdquo;이 아니므로 참고용으로만 사용하세요.
      </div>

      <details className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">참고용 실사례 보기 (model-spec.md §7.1)</summary>
        <ul className="mt-3 list-inside list-disc space-y-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          <li>
            &ldquo;AI 재평가: 아파트 배후 내부 입지, 역·먹자상권 경쟁점은 영향 제한&rdquo; — 상권내위치4 / 주요동선4 /
            선점경쟁3 / 접근가시성4 → 종합 3.75
          </li>
          <li>&ldquo;AI 지도판단: 청주대 인접 상권·경쟁점 다수&rdquo; — 지도판단메모는 점수 산정 근거를 자유서술로 남기는 용도로 쓰였습니다.</li>
        </ul>
      </details>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className={sectionTitleClass}>입지동선 점수 (1~5)</h3>
          <button
            type="button"
            disabled={aiLoading}
            onClick={handleAiFill}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300"
          >
            {aiLoading ? "AI가 조사 중..." : "AI로 초안 채우기"}
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          주소를 웹 검색으로 조사해서 아래 5개 점수와 근거(지도판단메모)를 자동으로 채웁니다. 저장 전까지는 그대로 반영 안 되니, 결과를 검토하고 필요하면 수정한 뒤 아래 &ldquo;저장&rdquo;을 눌러주세요.
        </p>
        {aiError && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{aiError}</p>
        )}
        <div className={`${gridClass} mt-4`}>
          <ScoreSelectField label="상권내위치점수" value={form.locationScore} onChange={(v) => set("locationScore", v as LocationEvaluation["locationScore"])} />
          <ScoreSelectField label="주요동선점수" value={form.flowScore} onChange={(v) => set("flowScore", v as LocationEvaluation["flowScore"])} />
          <ScoreSelectField label="선점경쟁점수" value={form.preemptionScore} onChange={(v) => set("preemptionScore", v as LocationEvaluation["preemptionScore"])} />
          <ScoreSelectField label="접근가시성점수" value={form.visibilityScore} onChange={(v) => set("visibilityScore", v as LocationEvaluation["visibilityScore"])} />
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">입지동선종합점수 실시간 미리보기 (저장하지 않음, 4개 점수 입력 시 계산)</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {compositePreview != null ? formatScore(compositePreview) : "- (4개 점수를 모두 입력하세요)"}
          </p>
        </div>

        <div className="mt-4">
          <TextAreaField label="지도판단메모" value={form.mapMemo ?? ""} onChange={(v) => set("mapMemo", v || null)} hint="점수 산정 근거를 자유서술로 남깁니다." />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>상권흡인력 / 특수수요</h3>
        <div className={`${gridClass} mt-4`}>
          <ScoreSelectField label="상권흡인력점수" value={form.attractionScore} onChange={(v) => set("attractionScore", v as LocationEvaluation["attractionScore"])} />
          <SelectField label="특수수요유형" value={form.specialDemandType} onChange={(v) => set("specialDemandType", v)} options={SPECIAL_DEMAND_TYPE_OPTIONS} />
          <SelectField label="특수수요강도" value={form.specialDemandIntensity} onChange={(v) => set("specialDemandIntensity", v)} options={SPECIAL_DEMAND_INTENSITY_OPTIONS} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>외부유입 / 브랜드</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">외부유입제한은 V62 보정률에 직결되는 핵심 항목입니다.</p>
        <div className={`${gridClass} mt-4`}>
          <SelectField label="외부유입제한" value={form.inflowRestriction} onChange={(v) => set("inflowRestriction", v)} options={INFLOW_RESTRICTION_OPTIONS} />
          <SelectField label="수요이탈위험" value={form.demandLeakageRisk} onChange={(v) => set("demandLeakageRisk", v)} options={INFLOW_RESTRICTION_OPTIONS} />
          <SelectField label="브랜드구분" value={form.brandType} onChange={(v) => set("brandType", v)} options={BRAND_TYPE_OPTIONS} />
        </div>
        <div className="mt-4">
          <TextAreaField label="상권구조메모" value={form.marketStructureMemo ?? ""} onChange={(v) => set("marketStructureMemo", v || null)} />
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
      )}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </p>
      )}

      <div className="flex justify-end print:hidden">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
