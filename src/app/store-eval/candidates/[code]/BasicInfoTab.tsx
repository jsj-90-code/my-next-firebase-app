"use client";

// 탭1 기본정보 - "2. 신규후보지 입력" 화면 요구사항.
// CandidateInput 타입의 실제 필드 전부를 폼으로 구성한다 (필드를 빼거나 추가하지 않는다).

import { useEffect, useMemo, useState } from "react";
import { computeLocationScoreFromFacts, computeSeatScore, computeSpecScore, computeZoneComposition, GAME_ZONE_BONUS } from "@/lib/storeEval/calc";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getModelSettings, saveCandidate } from "@/lib/storeEval/store";
import type { CandidateInput, GroundLevel, ModelSettings, ReviewStatus } from "@/lib/storeEval/types";
import {
  BooleanSelectField,
  ComputedField,
  DateField,
  NumberField,
  SelectField,
  ScoreSelectField,
  TextField,
  gridClass,
  sectionClass,
  sectionTitleClass,
} from "./formFields";

const REVIEW_STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "진행", label: "진행" },
  { value: "보류", label: "보류" },
  { value: "종료", label: "종료" },
  { value: "완료", label: "완료" },
];

const GROUND_LEVEL_OPTIONS: { value: GroundLevel; label: string }[] = [
  { value: "지상", label: "지상" },
  { value: "지하", label: "지하" },
];

const NUMERIC_FIELDS: { key: keyof CandidateInput; label: string }[] = [
  { key: "expectedPcCount", label: "예상PC대수" },
  { key: "floor", label: "점포층수" },
  { key: "hourlyRate", label: "요금표_시간당원" },
  { key: "demographicsYear", label: "상권데이터기준연도" },
  { key: "plannedOpenMonth", label: "예상오픈월" },
  { key: "pop500m", label: "반경500m 총인구(거주)" },
  { key: "area1kmKm2", label: "반경1km 면적(㎢)" },
  { key: "pop1km", label: "반경1km 총인구" },
  { key: "male1kmRatio", label: "반경1km 남성비율" },
  { key: "age1km_0_9", label: "1km 0~9세" },
  { key: "age1km_10_19", label: "1km 10~19세" },
  { key: "age1km_20_29", label: "1km 20~29세" },
  { key: "age1km_30_39", label: "1km 30~39세" },
  { key: "age1km_40_49", label: "1km 40~49세" },
  { key: "age1km_50_59", label: "1km 50~59세" },
  { key: "age1km_60_69", label: "1km 60~69세" },
  { key: "age1km_70_79", label: "1km 70~79세" },
  { key: "age1km_80plus", label: "1km 80세 이상" },
  { key: "floating500Avg", label: "유동인구 평균(500m)" },
  { key: "floating500Male", label: "유동인구 남(500m)" },
  { key: "floating500Female", label: "유동인구 여(500m)" },
  { key: "floating500_10s", label: "유동 10대(500m)" },
  { key: "floating500_20s", label: "유동 20대(500m)" },
  { key: "floating500_30s", label: "유동 30대(500m)" },
  { key: "floating500_40s", label: "유동 40대(500m)" },
  { key: "floating500_50s", label: "유동 50대(500m)" },
  { key: "floating500_60plus", label: "유동 60대이상(500m)" },
  { key: "licensedPcStores500m", label: "인허가 PC방업소수(500m)" },
  { key: "operatingPcStores500m", label: "실영업 PC방업소수(500m)" },
  { key: "ownGameZoneCount", label: "게임존 수" },
  { key: "ownRoom1", label: "1인룸 수" },
  { key: "ownRoom2", label: "2인룸 수" },
  { key: "ownTeamRoom", label: "팀룸 수" },
  { key: "ownCoupleZone", label: "커플존 수" },
  { key: "ownVipZone", label: "VIP존 수" },
  { key: "ownFriendsZone", label: "프렌즈존 수" },
];

function validate(form: CandidateInput): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("후보지명을 입력해주세요.");
  if (!form.address.trim()) errors.push("주소를 입력해주세요.");
  if (form.expectedPcCount == null) errors.push("예상PC대수를 입력해주세요.");
  if (form.hourlyRate == null) errors.push("시간당요금을 입력해주세요.");
  for (const f of NUMERIC_FIELDS) {
    const v = form[f.key];
    if (typeof v === "number" && v < 0) errors.push(`${f.label}은(는) 음수가 될 수 없습니다.`);
  }
  return errors;
}

export function BasicInfoTab({
  candidate,
  actor,
  onSaved,
}: {
  candidate: CandidateInput;
  actor: string | null;
  onSaved: (c: CandidateInput) => void;
}) {
  const [form, setForm] = useState<CandidateInput>(candidate);
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<ModelSettings>({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });

  useEffect(() => {
    getModelSettings().then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  const computedScores = useMemo(() => {
    const { kinds, rooms } = computeZoneComposition(
      [form.ownRoom1, form.ownRoom2, form.ownTeamRoom, form.ownCoupleZone, form.ownVipZone],
      [form.ownFriendsZone],
    );
    return {
      spec: computeSpecScore(form.ownVgaBase, form.ownVgaTop, (form.ownGameZoneCount ?? 0) * GAME_ZONE_BONUS, form.ownMonitorScore, settings),
      seat: computeSeatScore(kinds, rooms),
      location: computeLocationScoreFromFacts(form.floor, form.groundLevel, form.hasElevator),
    };
  }, [
    form.ownVgaBase,
    form.ownVgaTop,
    form.ownGameZoneCount,
    form.ownMonitorScore,
    form.ownRoom1,
    form.ownRoom2,
    form.ownTeamRoom,
    form.ownCoupleZone,
    form.ownVipZone,
    form.ownFriendsZone,
    form.floor,
    form.groundLevel,
    form.hasElevator,
    settings,
  ]);

  // 후보지코드(=candidate.code)가 바뀔 때만 폼을 리셋한다. 저장 후 부모가 candidate를 갱신해도
  // 사용자가 입력 중인 값을 덮어쓰지 않기 위해 candidate 전체가 아니라 code에만 반응한다.
  useEffect(() => {
    setForm(candidate);
    setMessage(null);
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.code]);

  function set<K extends keyof CandidateInput>(key: K, value: CandidateInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(isDraft: boolean) {
    setMessage(null);
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;

    setSaving(isDraft ? "draft" : "final");
    try {
      const toSave: CandidateInput = { ...form, isDraft };
      await saveCandidate(toSave, actor);
      setForm(toSave);
      onSaved(toSave);
      setMessage(isDraft ? "임시저장했습니다." : "저장했습니다.");
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "저장 중 오류가 발생했습니다."]);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>기본정보</h3>
        <div className={`${gridClass} mt-4`}>
          <FieldReadonly label="후보지코드" value={form.code} />
          <TextField label="후보지명" value={form.name} onChange={(v) => set("name", v)} required />
          <TextField label="주소" value={form.address} onChange={(v) => set("address", v)} required />
          <DateField label="검토일" value={form.reviewDate} onChange={(v) => set("reviewDate", v)} />
          <SelectField
            label="검토상태"
            value={form.reviewStatus}
            onChange={(v) => set("reviewStatus", v ?? "진행")}
            options={REVIEW_STATUS_OPTIONS}
            required
          />
          <NumberField label="예상PC대수" value={form.expectedPcCount} onChange={(v) => set("expectedPcCount", v)} required />
          <NumberField label="점포층수" value={form.floor} onChange={(v) => set("floor", v)} allowNegative />
          <SelectField label="지상/지하" value={form.groundLevel} onChange={(v) => set("groundLevel", v)} options={GROUND_LEVEL_OPTIONS} />
          <BooleanSelectField label="엘리베이터" value={form.hasElevator} onChange={(v) => set("hasElevator", v)} />
          <NumberField label="요금표_시간당원" value={form.hourlyRate} onChange={(v) => set("hourlyRate", v)} required />
          <NumberField label="상권데이터기준연도" value={form.demographicsYear} onChange={(v) => set("demographicsYear", v)} step={1} />
          <NumberField label="예상오픈월 (1~12)" value={form.plannedOpenMonth} onChange={(v) => set("plannedOpenMonth", v)} step={1} hint="AA 기준매출(오픈월부터 10개월 평균) 계산에 사용" />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>상권 인구통계 (반경 500m / 1km)</h3>
        <div className={`${gridClass} mt-4`}>
          <NumberField label="반경500m 총인구(거주)" value={form.pop500m} onChange={(v) => set("pop500m", v)} />
          <NumberField label="반경1km 면적(㎢)" value={form.area1kmKm2} onChange={(v) => set("area1kmKm2", v)} step={0.01} />
          <NumberField label="반경1km 총인구" value={form.pop1km} onChange={(v) => set("pop1km", v)} />
          <NumberField
            label="반경1km 남성비율"
            value={form.male1kmRatio}
            onChange={(v) => set("male1kmRatio", v)}
            step={0.01}
            hint="0~1 사이 비율 (예: 0.52)"
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
          <NumberField label="유동인구 여" value={form.floating500Female} onChange={(v) => set("floating500Female", v)} />
          <NumberField label="유동 10대" value={form.floating500_10s} onChange={(v) => set("floating500_10s", v)} />
          <NumberField label="유동 20대" value={form.floating500_20s} onChange={(v) => set("floating500_20s", v)} />
          <NumberField label="유동 30대" value={form.floating500_30s} onChange={(v) => set("floating500_30s", v)} />
          <NumberField label="유동 40대" value={form.floating500_40s} onChange={(v) => set("floating500_40s", v)} />
          <NumberField label="유동 50대" value={form.floating500_50s} onChange={(v) => set("floating500_50s", v)} />
          <NumberField label="유동 60대 이상" value={form.floating500_60plus} onChange={(v) => set("floating500_60plus", v)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>경쟁 카운트 (반경 500m)</h3>
        <div className={`${gridClass} mt-4`}>
          <NumberField label="인허가 PC방업소수" value={form.licensedPcStores500m} onChange={(v) => set("licensedPcStores500m", v)} />
          <NumberField label="실영업 PC방업소수" value={form.operatingPcStores500m} onChange={(v) => set("operatingPcStores500m", v)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>자사 시설/사양</h3>
        <div className={`${gridClass} mt-4`}>
          <TextField label="VGA 기본사양" value={form.ownVgaBase ?? ""} onChange={(v) => set("ownVgaBase", v || null)} />
          <TextField label="VGA 최고사양" value={form.ownVgaTop ?? ""} onChange={(v) => set("ownVgaTop", v || null)} />
          <NumberField label="게임존 수" value={form.ownGameZoneCount} onChange={(v) => set("ownGameZoneCount", v)} />
          <NumberField label="1인룸 수" value={form.ownRoom1} onChange={(v) => set("ownRoom1", v)} />
          <NumberField label="2인룸 수" value={form.ownRoom2} onChange={(v) => set("ownRoom2", v)} />
          <NumberField label="팀룸 수" value={form.ownTeamRoom} onChange={(v) => set("ownTeamRoom", v)} />
          <NumberField label="커플존 수" value={form.ownCoupleZone} onChange={(v) => set("ownCoupleZone", v)} />
          <NumberField label="VIP존 수" value={form.ownVipZone} onChange={(v) => set("ownVipZone", v)} />
          <NumberField label="프렌즈존 수" value={form.ownFriendsZone} onChange={(v) => set("ownFriendsZone", v)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>경쟁력 점수</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          사양·좌석·입지 점수는 위에 입력한 VGA·존구성·층수+엘리베이터로부터 원본 Apps Script(점포평가.gs)
          그대로 자동 계산됩니다. 먹거리·인테리어·모니터는 원본에서도 평가자가 1~5점을 직접 입력하는
          항목입니다. 종합 경쟁력점수 가중합(사양25%·좌석30%·먹거리20%·인테리어15%·입지10%)은 원본 계수
          그대로 적용됩니다.
        </p>
        <div className={`${gridClass} mt-4`}>
          <ComputedField label="사양 점수 (자동)" value={computedScores.spec} hint="VGA 70%+모니터 30%+게임존 가산" />
          <ComputedField label="좌석 점수 (자동)" value={computedScores.seat} hint="존 다양성 50%+수용력 50%" />
          <ScoreSelectField label="먹거리 점수" value={form.ownFoodScore} onChange={(v) => set("ownFoodScore", v)} />
          <ScoreSelectField label="인테리어 점수" value={form.ownInteriorScore} onChange={(v) => set("ownInteriorScore", v)} />
          <ComputedField label="입지 점수 (자동)" value={computedScores.location} hint="층수+엘리베이터+지상/지하" />
          <ScoreSelectField
            label="모니터 점수"
            value={form.ownMonitorScore}
            onChange={(v) => set("ownMonitorScore", v)}
            hint="사양 점수의 모니터 30% 비중 (07 원본 필드)"
          />
        </div>
      </section>

      {errors.length > 0 && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <ul className="list-inside list-disc">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </p>
      )}

      <div className="flex justify-end gap-3 print:hidden">
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => handleSave(true)}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {saving === "draft" ? "저장 중..." : "임시저장"}
        </button>
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => handleSave(false)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {saving === "final" ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function FieldReadonly({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <input
        type="text"
        value={value}
        readOnly
        className="w-full rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
      />
    </label>
  );
}
