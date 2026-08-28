"use client";

// 기존 가맹점 상세화면 "기본정보" 탭 — 2026-08-28 신규.
// 지금까지 하드웨어(CPU/RAM/VGA/모니터/존구성)·수요(인구통계·유동인구)·경쟁력점수 입력값이
// 기존 가맹점(ExistingStore)에 대해서는 구글시트 자동동기화로만 채워지고 웹에서 편집할 방법이
// 없었다(사용자 요청으로 신설). candidates/[code]/BasicInfoTab.tsx의 같은 섹션들을 ExistingStore
// 필드명 그대로(CandidateInput과 필드명이 이미 1:1 동일하게 설계돼 있음) 옮겨왔다 — 카카오맵·
// SGIS/소상공인365 업로드패널처럼 "후보지 획득" 전용 UI는 이미 오픈한 매장에는 불필요해 제외했다.
// 경쟁력 점수 계산은 신규후보지용 5점 기본값이 아니라 기존 가맹점 원본 규칙(EXISTING_STORE_
// FACILITY_DEFAULTS, 4점)을 쓴다 — computeExistingStoreMeasuredForecast와 같은 이유(과거 실적에
// 새 기준을 소급 적용하지 않는다).

import { useEffect, useMemo, useState } from "react";
import {
  applyStandardOwnFacilityDefaults,
  computeFoodScore,
  computeInteriorSeatManagementScore,
  computeLocationScoreFromFacts,
  computeSpecScore,
  EXISTING_STORE_FACILITY_DEFAULTS,
  GAME_ZONE_BONUS,
} from "@/lib/storeEval/calc";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getModelSettings, upsertExistingStore } from "@/lib/storeEval/store";
import type { ExistingStore, FoodBrand, GroundLevel, ModelSettings } from "@/lib/storeEval/types";
import {
  ComputedField,
  FoodScoringGuide,
  InteriorScoringGuide,
  NumberField,
  ScoreSelectField,
  SelectField,
  TextField,
  gridClass,
  sectionClass,
  sectionTitleClass,
} from "../../candidates/[code]/formFields";

const FOOD_BRAND_OPTIONS: { value: FoodBrand; label: string }[] = [
  { value: "쉐프앤클릭", label: "쉐프앤클릭 (블랙라벨 자체)" },
  { value: "비바쿡", label: "비바쿡" },
  { value: "PC토랑", label: "PC토랑" },
  { value: "기타브랜드", label: "기타 브랜드" },
  { value: "브랜드없음", label: "브랜드없음 (직접입력)" },
];

const GROUND_LEVEL_OPTIONS: { value: GroundLevel; label: string }[] = [
  { value: "지상", label: "지상" },
  { value: "지하", label: "지하" },
];

export function ExistingStoreProfileTab({
  store,
  actor,
  onSaved,
}: {
  store: ExistingStore;
  actor: string | null;
  onSaved: (updated: ExistingStore) => void;
}) {
  const [form, setForm] = useState<ExistingStore>(store);
  const [settings, setSettings] = useState<ModelSettings>({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getModelSettings().then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  // 상세화면에서 다른 가맹점으로 이동할 때만 폼을 리셋한다(BasicInfoTab과 동일 원칙 — 저장 후
  // 부모가 store를 갱신해도 입력 중인 값을 덮어쓰지 않는다).
  useEffect(() => {
    setForm(store);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.storeCode]);

  function set<K extends keyof ExistingStore>(key: K, value: ExistingStore[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const computedScores = useMemo(() => {
    const facility = applyStandardOwnFacilityDefaults(form, EXISTING_STORE_FACILITY_DEFAULTS);
    return {
      spec: computeSpecScore(
        {
          vgaBase: form.ownVgaBase,
          vgaTop: form.ownVgaTop,
          vgaTop2: form.ownVgaTop2,
          cpu: form.ownCpu,
          cpuTop1: form.ownCpuTop1,
          cpuTop2: form.ownCpuTop2,
          ram: form.ownRam,
          ramTop: form.ownRamTop,
          monitorBase: form.ownMonitorBase,
          monitorTop: form.ownMonitorTop,
          bonus: facility.ownGameZoneCount * GAME_ZONE_BONUS,
        },
        settings,
      ),
      location: computeLocationScoreFromFacts(form.floor, form.groundLevel, form.hasElevator),
      food: computeFoodScore({ brand: form.ownFoodBrand, legacyScore: facility.ownFoodScore }, settings),
      interior: computeInteriorSeatManagementScore(
        {
          seatZoneScore: form.ownSeatZoneScore,
          freshnessScore: form.ownInteriorLevelScore,
          cleanlinessScore: form.ownInteriorConditionScore,
          comfortScore: form.ownComfortScore,
          legacyScore: facility.ownInteriorScore,
        },
        settings,
      ),
    };
  }, [
    form.ownCpu,
    form.ownCpuTop1,
    form.ownCpuTop2,
    form.ownRam,
    form.ownRamTop,
    form.ownVgaBase,
    form.ownVgaTop,
    form.ownVgaTop2,
    form.ownMonitorBase,
    form.ownMonitorTop,
    form.ownGameZoneCount,
    form.floor,
    form.groundLevel,
    form.hasElevator,
    form.ownFoodBrand,
    form.ownFoodScore,
    form.ownSeatZoneScore,
    form.ownInteriorLevelScore,
    form.ownInteriorConditionScore,
    form.ownComfortScore,
    form.ownInteriorScore,
    settings,
  ]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const updated: ExistingStore = { ...form, updatedAt: Date.now(), updatedBy: actor };
      await upsertExistingStore(updated);
      setMessage("저장했습니다.");
      onSaved(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>수요</h3>
        <div className={`${gridClass} mt-4`}>
          <NumberField label="요금표_시간당원" value={form.hourlyRate} onChange={(v) => set("hourlyRate", v)} />
          <NumberField
            label="자사수요"
            value={form.ownDemand}
            onChange={(v) => set("ownDemand", v)}
            hint="04_점포평가요약!예측_자사수요 (PC대수로 나눠 특징치로 쓰임)"
          />
          <NumberField label="참고상권수요" value={form.referenceMarketDemand} onChange={(v) => set("referenceMarketDemand", v)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>상권 인구통계 (반경 500m / 1km)</h3>
        <div className={`${gridClass} mt-4`}>
          <NumberField label="반경500m 총인구(거주)" value={form.pop500m} onChange={(v) => set("pop500m", v)} />
          <NumberField label="반경1km 면적(㎢)" value={form.area1kmKm2} onChange={(v) => set("area1kmKm2", v)} step={0.01} />
          <NumberField label="반경1km 총인구" value={form.pop1km} onChange={(v) => set("pop1km", v)} />
          <NumberField
            label="반경1km 남성비율(%)"
            value={form.male1kmRatio == null ? null : Math.round(form.male1kmRatio * 1000) / 10}
            onChange={(v) => set("male1kmRatio", v == null ? null : v / 100)}
            step={0.1}
            hint="0~100% 사이 값 (예: 52.0) — 저장은 내부적으로 0~1 소수로 변환됩니다"
          />
          <NumberField label="1km 0~9세" value={form.age1km_0_9} onChange={(v) => set("age1km_0_9", v)} />
          <NumberField label="1km 10~19세" value={form.age1km_10_19} onChange={(v) => set("age1km_10_19", v)} />
          <NumberField label="1km 20~29세" value={form.age1km_20_29} onChange={(v) => set("age1km_20_29", v)} />
          <NumberField label="1km 30~39세" value={form.age1km_30_39} onChange={(v) => set("age1km_30_39", v)} />
          <NumberField label="1km 40~49세" value={form.age1km_40_49} onChange={(v) => set("age1km_40_49", v)} />
          <NumberField label="1km 50~59세" value={form.age1km_50_59} onChange={(v) => set("age1km_50_59", v)} />
          <NumberField label="1km 60~69세" value={form.age1km_60_69} onChange={(v) => set("age1km_60_69", v)} />
          <NumberField label="1km 70~79세" value={form.age1km_70_79} onChange={(v) => set("age1km_70_79", v)} />
          <NumberField label="1km 80세 이상" value={form.age1km_80plus} onChange={(v) => set("age1km_80plus", v)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>유동인구 (반경 500m)</h3>
        <div className={`${gridClass} mt-4`}>
          <NumberField label="유동인구 평균" value={form.floating500Avg} onChange={(v) => set("floating500Avg", v)} />
          <NumberField label="유동인구 남" value={form.floating500Male} onChange={(v) => set("floating500Male", v)} />
          <NumberField label="유동 10대" value={form.floating500_10s} onChange={(v) => set("floating500_10s", v)} />
          <NumberField label="유동 20대" value={form.floating500_20s} onChange={(v) => set("floating500_20s", v)} />
          <NumberField label="유동 30대" value={form.floating500_30s} onChange={(v) => set("floating500_30s", v)} />
          <NumberField label="유동 40대" value={form.floating500_40s} onChange={(v) => set("floating500_40s", v)} />
          <NumberField label="유동 50대" value={form.floating500_50s} onChange={(v) => set("floating500_50s", v)} />
          <NumberField label="유동 60대 이상" value={form.floating500_60plus} onChange={(v) => set("floating500_60plus", v)} />
          <NumberField
            label="실영업 PC방업소수(500m)"
            value={form.operatingPcStores500m}
            onChange={(v) => set("operatingPcStores500m", v)}
            hint="네이버 로드뷰 등으로 실제 영업 중인지 직접 확인해서 입력 — 경쟁IP 계산의 핵심값"
          />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>자사 시설/사양</h3>
        <p className="mt-1 text-xs text-[#8a8072]">
          GPU/CPU/RAM/모니터 모두 "기본"(대부분 좌석의 대표사양)과 "특화"(일부 좌석만 업그레이드된
          사양) 텍스트를 각각 입력합니다. 일부 좌석만 업그레이드됐다면 매장 전체를 그 사양으로 보지
          않고 기본80%+특화(균등분배)20%로 계산합니다.
        </p>
        <div className={`${gridClass} mt-4`}>
          <TextField label="VGA 기본" value={form.ownVgaBase ?? ""} onChange={(v) => set("ownVgaBase", v || null)} />
          <TextField label="VGA 특화1" value={form.ownVgaTop ?? ""} onChange={(v) => set("ownVgaTop", v || null)} hint="일부 좌석만 업그레이드된 사양 · 없으면 비움" />
          <TextField label="VGA 특화2" value={form.ownVgaTop2 ?? ""} onChange={(v) => set("ownVgaTop2", v || null)} hint="없으면 비움" />
          <TextField
            label="CPU 기본"
            value={form.ownCpu ?? ""}
            onChange={(v) => set("ownCpu", v || null)}
            hint="예: 14400F, 울트라5 225F — 하드웨어점수 20%에 자동 반영"
          />
          <TextField label="CPU 특화1" value={form.ownCpuTop1 ?? ""} onChange={(v) => set("ownCpuTop1", v || null)} hint="없으면 비움" />
          <TextField label="CPU 특화2" value={form.ownCpuTop2 ?? ""} onChange={(v) => set("ownCpuTop2", v || null)} hint="없으면 비움" />
          <TextField label="RAM 기본" value={form.ownRam ?? ""} onChange={(v) => set("ownRam", v || null)} hint="예: 16G, 32G — 하드웨어점수 15%에 자동 반영" />
          <TextField label="RAM 특화" value={form.ownRamTop ?? ""} onChange={(v) => set("ownRamTop", v || null)} hint="없으면 비움" />
          <NumberField label="게임존 수" value={form.ownGameZoneCount} onChange={(v) => set("ownGameZoneCount", v)} hint="비우면 표준 3종 적용" />
          <NumberField
            label="1인석 수"
            value={form.ownSingleSeatCount}
            onChange={(v) => set("ownSingleSeatCount", v)}
            hint="칸막이·듀얼모니터만 있는 개방형 좌석(독립룸 아님) · 참고용, 좌석점수 자동계산엔 안 들어감"
          />
          <NumberField label="1인룸 수" value={form.ownRoom1} onChange={(v) => set("ownRoom1", v)} hint="벽으로 막힌 독립 공간" />
          <NumberField label="2인룸 수" value={form.ownRoom2} onChange={(v) => set("ownRoom2", v)} />
          <NumberField label="팀룸 수" value={form.ownTeamRoom} onChange={(v) => set("ownTeamRoom", v)} hint="비우면 표준 2개 적용" />
          <NumberField label="커플존 수" value={form.ownCoupleZone} onChange={(v) => set("ownCoupleZone", v)} hint="비우면 표준 3개 적용" />
          <NumberField label="VIP존 수" value={form.ownVipZone} onChange={(v) => set("ownVipZone", v)} hint="비우면 표준 5개 적용" />
          <NumberField label="프렌즈존 수" value={form.ownFriendsZone} onChange={(v) => set("ownFriendsZone", v)} hint="비우면 표준 15개 적용" />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>경쟁력 점수</h3>
        <p className="mt-1 text-xs text-[#8a8072]">
          하드웨어·입지 점수는 위에 입력한 VGA/CPU/RAM·층수+엘리베이터로부터 자동 계산됩니다. 기존
          가맹점 백테스트는 신규후보지용 표준값(5점)이 아니라 원본 시트 규칙(빈칸이면 4점)을 씁니다.
        </p>
        <div className={`${gridClass} mt-4`}>
          <ComputedField label="하드웨어 점수 (자동)" value={computedScores.spec} hint="GPU40%+모니터25%+CPU20%+RAM15%(+게임존 가산)" />
          <ComputedField label="입지 점수 (자동)" value={computedScores.location} hint="층수+엘리베이터+지상/지하" />
          <SelectField label="지상/지하" value={form.groundLevel} onChange={(v) => set("groundLevel", v)} options={GROUND_LEVEL_OPTIONS} />
          <NumberField label="점포층수" value={form.floor} onChange={(v) => set("floor", v)} allowNegative />
        </div>

        <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">하드웨어 - 모니터</h4>
        <div className={`${gridClass} mt-3`}>
          <TextField
            label="모니터 기본"
            value={form.ownMonitorBase ?? ""}
            onChange={(v) => set("ownMonitorBase", v || null)}
            hint="예: 240Hz, BenQ XL2540X 280Hz — 주사율(Hz)에서 자동채점(240Hz=4점 앵커)"
          />
          <TextField label="모니터 특화" value={form.ownMonitorTop ?? ""} onChange={(v) => set("ownMonitorTop", v || null)} hint="없으면 비움" />
        </div>

        <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">먹거리</h4>
        <div className={`${gridClass} mt-3`}>
          <SelectField label="먹거리 브랜드" value={form.ownFoodBrand} onChange={(v) => set("ownFoodBrand", v)} options={FOOD_BRAND_OPTIONS} />
          {(form.ownFoodBrand == null || form.ownFoodBrand === "브랜드없음") && (
            <ScoreSelectField
              label="먹거리 점수 (직접입력)"
              value={form.ownFoodScore}
              onChange={(v) => set("ownFoodScore", v)}
              hint="브랜드없음/미정일 때 직접 평가 · 비우면 표준값 4 적용"
            />
          )}
          <ComputedField label="먹거리 점수 (최종)" value={computedScores.food} />
        </div>
        {(form.ownFoodBrand == null || form.ownFoodBrand === "브랜드없음") && <FoodScoringGuide />}

        <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">인테리어·좌석·관리</h4>
        <InteriorScoringGuide />
        <div className={`${gridClass} mt-3`}>
          <ScoreSelectField
            label="좌석·존구성"
            value={form.ownSeatZoneScore}
            onChange={(v) => set("ownSeatZoneScore", v)}
            step={0.5}
            hint="4.0=팀룸·2인룸·커플존·1인룸·프렌즈/VIP존 등 블랙라벨과 동급 · 위 기준표 참고"
          />
          <ScoreSelectField label="최신성·디자인" value={form.ownInteriorLevelScore} onChange={(v) => set("ownInteriorLevelScore", v)} step={0.5} hint="마감·컨셉 퀄리티" />
          <ScoreSelectField label="청결·관리상태" value={form.ownInteriorConditionScore} onChange={(v) => set("ownInteriorConditionScore", v)} step={0.5} hint="청결도·노후도" />
          <ScoreSelectField label="편의성" value={form.ownComfortScore} onChange={(v) => set("ownComfortScore", v)} step={0.5} hint="냄새·조명·화장실·편의시설" />
          {form.ownSeatZoneScore == null && form.ownInteriorLevelScore == null && form.ownInteriorConditionScore == null && form.ownComfortScore == null && (
            <ScoreSelectField
              label="인테리어·좌석·관리 점수 (직접입력)"
              value={form.ownInteriorScore}
              onChange={(v) => set("ownInteriorScore", v)}
              hint="위 세부항목을 넷 다 안 채웠을 때 직접 평가 · 비우면 표준값 4 적용"
            />
          )}
          <ComputedField label="인테리어·좌석·관리 점수 (최종)" value={computedScores.interior} />
        </div>
      </section>

      {message && <p className="text-sm text-[#8a8072]">{message}</p>}
      <div className="flex justify-end">
        <button type="button" disabled={saving} onClick={handleSave} className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
