"use client";

// 탭3 입지동선평가 - "4. 입지동선 평가" 화면 요구사항.
// LocationEvaluation 타입 필드 전부 + 종합점수 실시간 미리보기(calc.ts, 저장하지 않음).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { LocationEvalAiReviewPanel, type LocationEvalAiDraft, type LocationEvalAiFields } from "@/components/storeEval/LocationEvalAiReviewPanel";
import { computeLocationCompositeScore } from "@/lib/storeEval/calc";
import { formatScore } from "@/lib/storeEval/format";
import { captureKakaoStaticMapUrl } from "@/lib/storeEval/kakaoStaticMapCapture";
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
  candidateLat,
  candidateLng,
  existingStoreCode,
}: {
  candidateCode: string;
  candidateName: string;
  candidateAddress: string;
  candidateLat: number | null;
  candidateLng: number | null;
  // 2026-08-27 추가 — 기존 가맹점 화면에서 이 탭을 재사용할 때만 넘긴다. candidateCode는 여기서도
  // LocationEvaluation을 읽고 쓰는 키(originCandidateCode ?? storeCode)로 그대로 쓰이지만, AI
  // 초안 생성은 storeEvalCandidates 문서가 있어야 하는 /api/store-eval/ai-location-eval 대신
  // 이 매장 코드로 /api/store-eval/ai-location-eval-existing-store를 호출해야 한다(순수 레거시
  // 매장은 candidateCode 문서 자체가 없다).
  existingStoreCode?: string;
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
  const [aiDraft, setAiDraft] = useState<LocationEvalAiDraft | null>(null);

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

  // 요청사항(2026-08-22, 2026-08-25 확장) — 공식 기준표가 없는 판단 필드들은 원래도 "사람이
  // GPT/AI에게 물어보고 손으로 옮겨 적던" 방식이었다(위 참고사례 배지 참고). 그 과정을 앱 안으로
  // 옮겨온 것뿐이며, AI 결과는 절대 자동저장하지 않는다 — 아래 승인화면에서 검토·수정 후 "선택
  // 항목 적용"을 눌러야 폼에 반영되고, 그 뒤에도 최종 "저장"을 별도로 눌러야 한다.
  async function handleAiFill() {
    if (!candidateAddress.trim()) {
      setAiError("주소가 없으면 AI가 조사할 수 없습니다. 기본정보 탭에서 주소를 먼저 입력해주세요.");
      return;
    }
    setAiError(null);
    setAiDraft(null);
    setAiLoading(true);
    try {
      // 지도 이미지는 있으면 좋은 부가 컨텍스트일 뿐이라 실패해도 흐름을 막지 않는다(캡처 유틸이
      // 이미 내부에서 예외를 삼키고 null을 반환함).
      const mapImageUrl =
        candidateLat != null && candidateLng != null ? await captureKakaoStaticMapUrl(candidateLat, candidateLng) : null;

      const token = await user?.getIdToken();
      const response = await fetch(
        existingStoreCode ? "/api/store-eval/ai-location-eval-existing-store" : "/api/store-eval/ai-location-eval",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(
            existingStoreCode
              ? { storeCode: existingStoreCode, mapImageUrl: mapImageUrl ?? undefined }
              : { candidateCode, mapImageUrl: mapImageUrl ?? undefined },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI 초안 생성에 실패했습니다.");
      setAiDraft({ fields: data.fields, confidence: data.confidence, rationale: data.rationale, warnings: data.warnings ?? [] });
      setMessage(null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 초안 생성 중 오류가 발생했습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  function handleApplyAiPatch(patch: Partial<LocationEvalAiFields>, rationale: string) {
    setForm((prev) => {
      if (!prev) return prev;
      // 기존에 사람이 적어둔 메모를 지우지 않고 AI 초안을 뒤에 덧붙인다(2026-08-24, 덮어쓰기 버그 수정).
      const existingMemo = prev.mapMemo?.trim();
      const aiNote = `AI 초안: ${rationale}`;
      return {
        ...prev,
        ...patch,
        mapMemo: existingMemo ? `${existingMemo}\n\n${aiNote}` : aiNote,
      };
    });
    setAiDraft(null);
  }

  if (loading) return <p className="text-sm text-[#8a8072]">불러오는 중...</p>;
  if (!form) return <p className="text-sm text-[#8a8072]">데이터를 불러오지 못했습니다.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="app-card-sm rounded-lg px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
        <strong>공식 기준표 없음</strong> — 아래 판단 필드(점수·특수수요·외부유입제한·수요이탈위험 등)의
        기준은 원본 스프레드시트 어디에도 문서화되어 있지 않습니다(docs/data-issues.md #2). 아래 참고자료는 원본
        시트에 실제로 기재됐던 사례 2건일 뿐 &ldquo;공식 기준&rdquo;이 아니므로 참고용으로만 사용하세요.
      </div>

      <details className="app-card rounded-2xl p-4 text-sm">
        <summary className="cursor-pointer font-medium text-[#5c5346] dark:text-[#c9bfae]">참고용 실사례 보기 (model-spec.md §7.1)</summary>
        <ul className="mt-3 list-inside list-disc space-y-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
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
            className="rounded-lg border border-[var(--sl-info)]/30 bg-[var(--sl-info-soft)] px-3 py-1.5 text-xs font-medium text-[var(--sl-info)] hover:brightness-95 disabled:opacity-50"
          >
            {aiLoading ? "AI가 조사 중..." : "AI로 초안 채우기"}
          </button>
        </div>
        <p className="mt-1 text-xs text-[#8a8072]">
          이미 수집된 경쟁점·수요거점·행정동통계·지도 이미지를 참고자료로 주고, 부족한 부분만 웹검색으로
          보완해서 5개 점수뿐 아니라 특수수요/외부유입제한/수요이탈위험/상권구조메모까지 초안을 제안합니다.
          자동저장되지 않으니 아래 승인화면에서 검토·수정 후 적용하고, 최종적으로 &ldquo;저장&rdquo;을 눌러주세요.
        </p>
        {aiError && (
          <p className="app-badge app-badge-danger mt-2 w-full justify-start px-3 py-2 text-xs">{aiError}</p>
        )}
        {aiDraft && (
          <LocationEvalAiReviewPanel
            draft={aiDraft}
            currentValues={{
              locationScore: form.locationScore,
              flowScore: form.flowScore,
              preemptionScore: form.preemptionScore,
              visibilityScore: form.visibilityScore,
              attractionScore: form.attractionScore,
              specialDemandType: form.specialDemandType,
              specialDemandIntensity: form.specialDemandIntensity,
              inflowRestriction: form.inflowRestriction,
              demandLeakageRisk: form.demandLeakageRisk,
              marketStructureMemo: form.marketStructureMemo,
            }}
            onApply={handleApplyAiPatch}
          />
        )}
        <div className={`${gridClass} mt-4`}>
          <ScoreSelectField
            label="상권내위치점수"
            value={form.locationScore}
            onChange={(v) => set("locationScore", v as LocationEvaluation["locationScore"])}
            hint="유동인구가 몰리는 상권(역세권/먹자골목 등)의 중심부에 가까울수록 높은 점수."
          />
          <ScoreSelectField
            label="주요동선점수"
            value={form.flowScore}
            onChange={(v) => set("flowScore", v as LocationEvaluation["flowScore"])}
            hint="사람들이 실제로 많이 지나다니는 이동경로(역 출구, 큰 도로, 버스정류장 앞 등)에 있을수록 높은 점수."
          />
          <ScoreSelectField
            label="선점경쟁점수"
            value={form.preemptionScore}
            onChange={(v) => set("preemptionScore", v as LocationEvaluation["preemptionScore"])}
            hint="주변 경쟁 PC방이 이미 더 좋은 자리를 선점하고 있어서 이 후보지가 불리할수록 낮은 점수."
          />
          <ScoreSelectField
            label="접근가시성점수"
            value={form.visibilityScore}
            onChange={(v) => set("visibilityScore", v as LocationEvaluation["visibilityScore"])}
            hint="도로에서 간판/입구가 잘 보이고 들어가기 쉬울수록 높은 점수(층수, 계단·엘리베이터 여부 포함)."
          />
        </div>

        <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
          <p className="text-xs text-[#8a8072]">입지동선종합점수 실시간 미리보기 (저장하지 않음, 4개 점수 입력 시 계산)</p>
          <p className="mt-1 text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">
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
          <ScoreSelectField
            label="상권흡인력점수"
            value={form.attractionScore}
            onChange={(v) => set("attractionScore", v as LocationEvaluation["attractionScore"])}
            hint="이 상권 자체가 사람을 끌어모으는 힘(전체적인 상권 규모·활력)이 클수록 높은 점수."
          />
          <SelectField
            label="특수수요유형"
            value={form.specialDemandType}
            onChange={(v) => set("specialDemandType", v)}
            options={SPECIAL_DEMAND_TYPE_OPTIONS}
            hint="대학가/군부대/산업단지/관광유흥처럼 일반 상권과 다른 특수한 수요원이 있는지."
          />
          <SelectField
            label="특수수요강도"
            value={form.specialDemandIntensity}
            onChange={(v) => set("specialDemandIntensity", v)}
            options={SPECIAL_DEMAND_INTENSITY_OPTIONS}
            hint="위 특수수요가 매출에 실제로 얼마나 영향을 줄 정도인지."
          />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>외부유입 / 브랜드</h3>
        <p className="mt-1 text-xs text-[#8a8072]">외부유입제한은 V62 보정률에 직결되는 핵심 항목입니다(강함 -20% / 보통 -3% / 없음 0%).</p>
        <div className={`${gridClass} mt-4`}>
          <SelectField
            label="외부유입제한"
            value={form.inflowRestriction}
            onChange={(v) => set("inflowRestriction", v)}
            options={INFLOW_RESTRICTION_OPTIONS}
            hint="이 상권이 주변 동네에서 손님을 끌어오기 얼마나 어려운지 — 강할수록(이 동네 주민 수요에만 의존할수록) 예상매출을 더 낮춰서 계산합니다."
          />
          <SelectField
            label="수요이탈위험"
            value={form.demandLeakageRisk}
            onChange={(v) => set("demandLeakageRisk", v)}
            options={INFLOW_RESTRICTION_OPTIONS}
            hint="온라인 게임방 앱, 스터디카페 등 다른 여가수단으로 수요 자체가 빠질 위험. 현재는 참고 기록용이며 V62 계산에는 반영되지 않습니다."
          />
          <SelectField
            label="브랜드구분"
            value={form.brandType}
            onChange={(v) => set("brandType", v)}
            options={BRAND_TYPE_OPTIONS}
            hint="V61 학습표본은 '블랙라벨'만 사용합니다 — 여기 값이 다르면 검증 대상에서 자동 제외됩니다."
          />
        </div>
        <div className="mt-4">
          <TextAreaField
            label="상권구조메모"
            value={form.marketStructureMemo ?? ""}
            onChange={(v) => set("marketStructureMemo", v || null)}
            hint="위 선택형 항목들로 다 담기지 않는 상권 특징을 자유롭게 남깁니다."
          />
        </div>
      </section>

      {error && (
        <p className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
      )}
      {message && (
        <p className="app-badge app-badge-ok w-full justify-start px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <div className="flex justify-end print:hidden">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
