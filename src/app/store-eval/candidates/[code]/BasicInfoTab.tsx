"use client";

// 탭1 기본정보 - "2. 신규후보지 입력" 화면 요구사항.
// CandidateInput 타입의 실제 필드 전부를 폼으로 구성한다 (필드를 빼거나 추가하지 않는다).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  applyStandardOwnFacilityDefaults,
  computeFoodScore,
  computeInteriorScore,
  computeLocationScoreFromFacts,
  computeSeatScore,
  computeSpecScore,
  computeZoneComposition,
  GAME_ZONE_BONUS,
  scoreFromCpu,
  scoreFromRam,
} from "@/lib/storeEval/calc";
import { CandidateMap, type MapPoint } from "@/components/storeEval/CandidateMap";
import { MarketDataUploadPanel } from "@/components/storeEval/MarketDataUploadPanel";
import { SGIS_FIELD_SPECS, SOSANGONGIN365_TABLE_VARIANTS } from "@/lib/storeEval/marketDataExtract";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  generateNextCandidateCode,
  getAdminDongReference,
  getCandidate,
  getModelSettings,
  listCompetitors,
  listDemandPoints,
  listMarketDataUploads,
  saveCandidate,
  saveMarketDataUpload,
} from "@/lib/storeEval/store";
import type {
  AdminDongReference,
  CandidateInput,
  Competitor,
  DemandPoint,
  FoodBrand,
  GroundLevel,
  MarketDataUpload,
  ModelSettings,
  ReviewStatus,
} from "@/lib/storeEval/types";
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

// 2026-08-27 추가 — 먹거리 브랜드 선택지(사용자 확인). "브랜드없음"이면 직접 1~5점을 입력한다.
const FOOD_BRAND_OPTIONS: { value: FoodBrand; label: string }[] = [
  { value: "쉐프앤클릭", label: "쉐프앤클릭 (블랙라벨 자체)" },
  { value: "비바쿡", label: "비바쿡" },
  { value: "PC토랑", label: "PC토랑" },
  { value: "기타브랜드", label: "기타 브랜드" },
  { value: "브랜드없음", label: "브랜드없음 (직접입력)" },
];

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
  { key: "floating500_10s", label: "유동 10대(500m)" },
  { key: "floating500_20s", label: "유동 20대(500m)" },
  { key: "floating500_30s", label: "유동 30대(500m)" },
  { key: "floating500_40s", label: "유동 40대(500m)" },
  { key: "floating500_50s", label: "유동 50대(500m)" },
  { key: "floating500_60plus", label: "유동 60대이상(500m)" },
  { key: "operatingPcStores500m", label: "실영업 PC방업소수(500m)" },
  { key: "operatingPcStores1km", label: "실영업 PC방업소수(1km)" },
  { key: "employ500Total", label: "직장인구 전체(500m)" },
  { key: "employ500Male", label: "직장인구 남(500m)" },
  { key: "employ500Female", label: "직장인구 여(500m)" },
  { key: "employ1kmTotal", label: "직장인구 전체(1km)" },
  { key: "employ1kmMale", label: "직장인구 남(1km)" },
  { key: "employ1kmFemale", label: "직장인구 여(1km)" },
  { key: "facility500SubwayRiders", label: "지하철 승하차(500m)" },
  { key: "facility1kmSubwayRiders", label: "지하철 승하차(1km)" },
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
  // 2026-08-25 추가 — 위 "음수 불가" 일괄 검사만으로는 못 잡는 범위 검증(0은 통과하지만 실제로는
  // 말이 안 되는 값, 또는 상한이 있는 값).
  if (form.expectedPcCount != null && form.expectedPcCount < 1) errors.push("예상PC대수는 1대 이상이어야 합니다.");
  if (form.hourlyRate != null && form.hourlyRate <= 0) errors.push("요금표_시간당원은 0보다 커야 합니다.");
  if (form.plannedOpenMonth != null && (form.plannedOpenMonth < 1 || form.plannedOpenMonth > 12)) {
    errors.push("예상오픈월은 1~12 사이여야 합니다.");
  }
  if (form.male1kmRatio != null && form.male1kmRatio > 1) errors.push("반경1km 남성비율은 100%를 넘을 수 없습니다.");
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
  const { user, loading: authLoading } = useAuth();
  const [form, setForm] = useState<CandidateInput>(candidate);
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<ModelSettings>({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });

  // 상권자료 자동수집 1단계(2026-08-24) — 주소→좌표, 행정구역 참고자료, 경쟁점/수요거점 자동수집.
  const [collecting, setCollecting] = useState(false);
  const [collectMessage, setCollectMessage] = useState<string | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [nearbyWarnings, setNearbyWarnings] = useState<{ code: string; name: string }[]>([]);
  const [adminDongRef, setAdminDongRef] = useState<AdminDongReference | null>(null);
  const [demandPoints, setDemandPoints] = useState<DemandPoint[]>([]);
  const [autoCompetitors, setAutoCompetitors] = useState<Competitor[]>([]);
  // 2단계(2026-08-24) — SGIS/소상공인365 반자동 업로드 이력.
  const [marketDataUploads, setMarketDataUploads] = useState<MarketDataUpload[]>([]);

  const loadMarketData = useCallback(async (code: string) => {
    const [adminDong, points, comps, uploads] = await Promise.all([
      getAdminDongReference(code),
      listDemandPoints(code),
      listCompetitors(code),
      listMarketDataUploads(code),
    ]);
    setAdminDongRef(adminDong);
    setDemandPoints(points);
    setAutoCompetitors(comps.filter((c) => c.source === "kakao"));
    setMarketDataUploads(uploads);
  }, []);

  useEffect(() => {
    getModelSettings().then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  useEffect(() => {
    // Firebase Auth 세션 복원(onAuthStateChanged)이 끝나기 전에 Firestore를 읽으면 request.auth가
    // 아직 없어 "Missing or insufficient permissions"가 뜬다(핫리로드 직후 재현되는 레이스
    // 컨디션, 2026-08-24 확인) — authLoading이 끝나고 로그인된 사용자가 있을 때만 조회한다.
    if (candidate.code !== "new" && !authLoading && user) loadMarketData(candidate.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.code, authLoading, user]);

  async function handleCollectMarketData() {
    if (form.code === "new") {
      setCollectError("먼저 저장한 뒤 이용할 수 있습니다.");
      return;
    }
    if (!form.address.trim()) {
      setCollectError("주소를 먼저 입력해주세요.");
      return;
    }
    setCollecting(true);
    setCollectError(null);
    setCollectMessage(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/store-eval/collect-market-data", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ candidateCode: form.code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "상권자료 수집에 실패했습니다.");
      if (data.error) {
        setCollectError(data.error);
        return;
      }
      const fresh = await getCandidate(form.code);
      if (fresh) {
        setForm(fresh);
        onSaved(fresh);
      }
      await loadMarketData(form.code);
      setNearbyWarnings(data.nearbyDuplicateWarnings ?? []);
      const parts = [`좌표 확인 완료`, `경쟁점(PC방) ${data.competitorsAdded}건`, `수요거점 ${data.demandPointsAdded}건 자동수집`];
      if (data.adminDongReferenceStatus === "자동수집 완료") parts.push("행정구역 참고자료 수집 완료");
      else if (data.adminDongReferenceError) parts.push(`행정구역 참고자료 실패: ${data.adminDongReferenceError}`);
      setCollectMessage(parts.join(" · "));
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : "상권자료 수집 중 오류가 발생했습니다.");
    } finally {
      setCollecting(false);
    }
  }

  async function handleConfirmMapPosition(lat: number, lng: number) {
    const updated = { ...form, lat, lng, geocodedAt: Date.now() };
    setForm(updated);
    await saveCandidate(updated, actor);
    onSaved(updated);
    setCollectMessage("지도에서 수정한 위치로 좌표를 확정했습니다.");
  }

  // SGIS/소상공인365 업로드 패널에서 추출값을 "폼에 적용"했을 때 — AI 초안과 동일하게 폼 상태만
  // 바꾸고, 사용자가 확인 후 "저장"을 눌러야 실제로 저장된다(자동확정 금지 원칙). 업로드 이력
  // 자체는 불변 로그라 여기서 바로 저장한다(값을 실제로 반영했는지와 무관하게 "이 파일에서 이걸
  // 뽑았다"는 사실 자체는 남겨야 하므로).
  async function handleApplyMarketDataUpload(patch: Record<string, number | string>, upload: MarketDataUpload) {
    setForm((prev) => ({ ...prev, ...patch }) as CandidateInput);
    await saveMarketDataUpload(upload);
    setMarketDataUploads((prev) => [upload, ...prev]);
  }

  const mapPoints: MapPoint[] = useMemo(
    () => [
      ...demandPoints.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category })),
      ...autoCompetitors
        .filter((c): c is Competitor & { lat: number; lng: number } => c.lat != null && c.lng != null)
        .map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, category: "PC방(경쟁점)" as const })),
    ],
    [demandPoints, autoCompetitors],
  );

  const computedScores = useMemo(() => {
    // 비어있는 자사 시설 입력값은 회사 표준 존 구성으로 계산한다(evaluate.ts와 동일 규칙 —
    // 결과 탭에서 최종 계산할 때와 이 미리보기가 다르게 보이지 않도록 맞춘다).
    const facility = applyStandardOwnFacilityDefaults(form);
    const { kinds, rooms } = computeZoneComposition(
      [form.ownRoom1, form.ownRoom2, facility.ownTeamRoom, facility.ownCoupleZone, facility.ownVipZone],
      [facility.ownFriendsZone],
    );
    return {
      spec: computeSpecScore(
        {
          cpu: form.ownCpu,
          vgaBase: form.ownVgaBase,
          vgaTop: form.ownVgaTop,
          ram: form.ownRam,
          monitorScore: facility.ownMonitorScore,
          bonus: facility.ownGameZoneCount * GAME_ZONE_BONUS,
        },
        settings,
      ),
      seat: computeSeatScore(kinds, rooms),
      location: computeLocationScoreFromFacts(form.floor, form.groundLevel, form.hasElevator),
      food: computeFoodScore({ brand: form.ownFoodBrand, legacyScore: facility.ownFoodScore }, settings),
      interior: computeInteriorScore({
        levelScore: form.ownInteriorLevelScore,
        conditionScore: form.ownInteriorConditionScore,
        legacyScore: facility.ownInteriorScore,
      }),
      // 참고용 제안값 — 사양점수 자동계산엔 안 들어가고, 종합사양(모니터) 점수를 사람이 매길 때
      // 참고하라고 화면에만 보여준다(2026-08-27, CPU/RAM 자동가중치 원복 이후).
      cpuSuggestion: scoreFromCpu(form.ownCpu),
      ramSuggestion: scoreFromRam(form.ownRam),
    };
  }, [
    form.ownCpu,
    form.ownRam,
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
    form.ownFoodBrand,
    form.ownFoodScore,
    form.ownInteriorLevelScore,
    form.ownInteriorConditionScore,
    form.ownInteriorScore,
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
      // 후보지코드는 첫 저장 시점에만 발급한다(요청사항) — "new" draft 상태에서 코드를 미리
      // 뽑아두면 등록 버튼만 누르고 저장 안 하는 경우 번호가 영구히 건너뛴다.
      const code = form.code === "new" ? await generateNextCandidateCode() : form.code;
      const toSave: CandidateInput = { ...form, code, isDraft };
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
          <FieldReadonly label="후보지코드" value={form.code === "new" ? "저장 시 자동 발급" : form.code} />
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

        <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
          <button
            type="button"
            disabled={collecting || form.code === "new" || authLoading}
            onClick={handleCollectMarketData}
            title={form.code === "new" ? "먼저 저장한 뒤 이용할 수 있습니다" : authLoading ? "로그인 확인 중입니다" : undefined}
            className="app-btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {collecting ? "수집 중..." : "상권자료 수집"}
          </button>
          <span className="text-xs text-[#8a8072]">
            주소로 좌표 확인 + 행정구역 참고자료 + 주변 경쟁점(PC방)·수요거점을 자동으로 모읍니다.
          </span>
        </div>
        {collectError && (
          <p className="app-badge app-badge-danger mt-2 w-full justify-start px-3 py-2 text-sm">{collectError}</p>
        )}
        {collectMessage && (
          <p className="app-badge app-badge-ok mt-2 w-full justify-start px-3 py-2 text-sm">
            {collectMessage}
          </p>
        )}
        {nearbyWarnings.length > 0 && (
          <div className="app-badge app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs">
            중복 후보지 가능성: {nearbyWarnings.map((w) => `${w.name || w.code}(${w.code})`).join(", ")}
          </div>
        )}
      </section>

      {form.lat != null && form.lng != null && (
        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>좌표 · 지도 (상권자료 자동수집)</h3>
          <div className={`${gridClass} mt-4`}>
            <FieldReadonly label="도로명주소" value={form.roadAddress ?? "-"} />
            <FieldReadonly label="지번주소" value={form.jibunAddress ?? "-"} />
            <FieldReadonly label="건물명" value={form.buildingName ?? "-"} />
            <FieldReadonly label="좌표" value={`${form.lat.toFixed(6)}, ${form.lng.toFixed(6)}`} />
          </div>
          <p className="mt-3 text-xs text-[#8a8072]">
            마커가 실제 출입구와 다르면 지도에서 드래그해 보정한 뒤 확정하세요 — 확정한 좌표가 모든 반경분석의 기준점이 됩니다.
          </p>
          <div className="mt-3">
            <CandidateMap lat={form.lat} lng={form.lng} points={mapPoints} onConfirmPosition={handleConfirmMapPosition} />
          </div>
          {adminDongRef && (
            <div className="app-card-sm mt-4 rounded-lg px-3 py-2 text-xs text-[#5c5346] dark:text-[#c9bfae]">
              <strong>행정구역 참고자료</strong>({adminDongRef.admName}, {adminDongRef.year ?? "-"}년 기준) — 총인구{" "}
              {adminDongRef.totalPopulation?.toLocaleString() ?? "-"}명. 이 값은 행정동 단위이며, 아래 &ldquo;반경
              500m/1km&rdquo; 계산 입력값과는 다른 자료이므로 그대로 옮겨 쓰지 않습니다.
            </div>
          )}
          {(demandPoints.length > 0 || autoCompetitors.length > 0) && (
            <p className="mt-2 text-xs text-[#8a8072]">
              자동수집: 경쟁점(PC방) {autoCompetitors.length}건 · 수요거점 {demandPoints.length}건 — 경쟁점 탭에서 상세 확인/실사 상태 갱신이
              필요합니다. 군부대·산업단지·관광유흥·먹자상권은 이번 단계에서 자동수집 대상이 아닙니다.
            </p>
          )}
        </section>
      )}

      {form.lat != null && form.lng != null && (
        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>SGIS·소상공인365 업로드 자동추출 (반경 500m/1km 통계)</h3>
          <p className="mt-1 text-xs leading-5 text-[#8a8072]">
            SGIS·소상공인365 모두 반경(500m/1km) 통계를 조회하는 공식 API가 없어(2026-08-24 확인) 직접 조회해야 합니다.
            SGIS는 PDF 보고서만 제공해 표를 복사해 붙여넣는 방식만 됩니다(엑셀 없음). 라벨을 찾아 자동으로 채워두지만,
            값이 다르면 자동확정하지 않고 표에서 직접 확인·수정한 뒤 &ldquo;폼에 적용&rdquo;을 눌러주세요 — 그 뒤에도 이
            탭의 &ldquo;저장&rdquo;을 눌러야 최종 반영됩니다.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MarketDataUploadPanel
              title="SGIS 생활권역 통계 (인구·연령)"
              openUrl="https://sgis.kostat.go.kr/view/catchmentArea/main"
              openLabel="SGIS 생활권역 열기"
              instructions={`좌표(${form.lat.toFixed(6)}, ${form.lng.toFixed(6)}) 부근을 검색해 지점 선택 → 세부설정에서 반경 0.5km·1km 선택 → 통계정보 보기 → 보고서(PDF) 열기. PDF의 "인구(나이)"/"인구(성별)"/"면적" 표를 반경 섹션(예: "반경 기준 0.5km")까지 포함해 그대로 복사해 붙여넣으세요.`}
              specs={SGIS_FIELD_SPECS}
              sourceType="sgis_life_area"
              candidateCode={form.code}
              coord={{ lat: form.lat, lng: form.lng }}
              actorEmail={actor}
              onApply={handleApplyMarketDataUpload}
              defaultMode="paste"
              pasteParser="sectioned"
              showFileUpload={false}
            />
            <MarketDataUploadPanel
              title="소상공인365 상권분석 (유동인구·직장인구·세대수·업소수)"
              openUrl="https://bigdata.sbiz.or.kr/"
              openLabel="소상공인365 열기"
              instructions='빅데이터 상권분석 → 상세분석 → 업종 "PC방", 반경은 아래에서 고른 값(500m/1km)과 같게 설정 후 분석하기 → 리포트 페이지 전체를 Ctrl+A로 선택해 그대로 복사해 붙여넣으세요(표를 따로 고를 필요 없습니다). 500m·1km는 사이트에서 각각 다시 분석해야 하니, 반경을 바꿔가며 두 번 반복하면 됩니다(한 리포트에 같이 안 나옴).'
              tableVariants={SOSANGONGIN365_TABLE_VARIANTS}
              sourceType="sosangongin365"
              candidateCode={form.code}
              coord={{ lat: form.lat, lng: form.lng }}
              actorEmail={actor}
              onApply={handleApplyMarketDataUpload}
              defaultMode="paste"
              showFileUpload={false}
            />
          </div>
          {marketDataUploads.length > 0 && (
            <div className="mt-4 text-xs text-[#8a8072]">
              <strong>업로드 이력</strong>
              <ul className="mt-1 list-inside list-disc">
                {marketDataUploads.slice(0, 5).map((u) => (
                  <li key={u.id}>
                    {u.sourceType === "sgis_life_area" ? "SGIS 생활권역" : "소상공인365"} —{" "}
                    {new Date(u.uploadedAt).toLocaleString("ko-KR")} · {u.fileName ?? "표 붙여넣기"} ·{" "}
                    {u.extractedFields.filter((f) => f.applied).length}개 항목 반영
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>상권 인구통계 (반경 500m / 1km)</h3>
        <div className={`${gridClass} mt-4`}>
          <NumberField label="반경500m 총인구(거주)" value={form.pop500m} onChange={(v) => set("pop500m", v)} />
          <NumberField label="반경1km 면적(㎢)" value={form.area1kmKm2} onChange={(v) => set("area1kmKm2", v)} step={0.01} />
          <NumberField label="반경1km 총인구" value={form.pop1km} onChange={(v) => set("pop1km", v)} />
          {/* 2026-08-25 수정 — 내부 저장값은 그대로 0~1 소수(기존 데이터 호환)지만, 화면에는
              "0.5086999999999999" 같은 부동소수점 오차가 그대로 보이던 문제 + 0~1/0~100 단위
              혼동을 막기 위해 입력창 자체를 퍼센트(0~100)로 보여주고 저장 시에만 0~1로 환산한다. */}
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
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>경쟁 카운트 (반경 500m)</h3>
        <div className={`${gridClass} mt-4`}>
          <TextField
            label="상권_기준연월"
            value={form.commercialDataYearMonth ?? ""}
            onChange={(v) => set("commercialDataYearMonth", v || null)}
            hint="예: 2026-07 — 아래 인허가/실영업 업소수를 확인한 시점 메모(개수 아님)"
            manualOnly
          />
          <TextField label="업소수_기준시점" value={form.businessCountAsOfDate ?? ""} onChange={(v) => set("businessCountAsOfDate", v || null)} manualOnly />
          <NumberField
            label="실영업 PC방업소수"
            value={form.operatingPcStores500m}
            onChange={(v) => set("operatingPcStores500m", v)}
            hint="네이버 로드뷰 등으로 실제 영업 중인지 직접 확인해서 입력 — 경쟁IP 계산의 핵심값"
            manualOnly
          />
          {/* 2026-08-25 추가, 2026-08-27 — 인허가 PC방업소수(자동추출, 계산엔 안 씀) 삭제하면서
              기준을 실영업(계산 입력값)으로 바꿨다. */}
          <ComputedField
            label="후보점 포함 예상 총 PC방 수(500m)"
            value={form.operatingPcStores500m == null ? null : form.operatingPcStores500m + 1}
            hint="참고용 — 실영업 PC방업소수 + 1(이 후보점 자신). 산식 입력값 아님."
          />
        </div>
      </section>

      {/* 2026-08-24 (5차) — 소상공인365 참고자료(직장인구/시설정보) 카드를 하나로 합침(사용자
          요청: "반경 하나에 전체 복붙 한 번이면 되는데 따로 있을 필요 없음").
          calc.ts 어떤 함수도 이 값들을 읽지 않는다(기존 V62 산식·계수 불변 원칙) — 그래서 카드
          자체는 합쳐도 되지만, 핵심 계산에 쓰이는 위 "유동인구(반경 500m)"/"경쟁 카운트" 섹션과
          헷갈리지 않도록 이 통합 카드 전체에 "참고자료" 배지를 유지한다.
          2026-08-27 — 유동인구(1km)·세대수·학생수 필드는 삭제했다(수요 계산에 못 쓰거나 이미
          쓰는 값과 중복이라 사용자 확인). */}
      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>소상공인365 참고자료 (직장인구 · 시설정보)</h3>
        <p className="mt-1 text-xs text-[#8a8072]">소상공인365 원본 전용 — V62 계산에는 쓰이지 않습니다.</p>

        <p className="mt-4 text-xs font-medium text-[#8a8072]">PC방업소수 (1km)</p>
        <div className={`${gridClass} mt-2`}>
          <NumberField
            label="실영업 PC방업소수(1km)"
            value={form.operatingPcStores1km}
            onChange={(v) => set("operatingPcStores1km", v)}
            hint="네이버 로드뷰 등으로 직접 확인해서 입력(자동추출 안 함)"
            manualOnly
          />
        </div>

        <p className="mt-6 text-xs font-medium text-[#8a8072]">직장인구 (500m / 1km)</p>
        <div className={`${gridClass} mt-2`}>
          <NumberField label="직장인구 전체(500m)" value={form.employ500Total} onChange={(v) => set("employ500Total", v)} />
          <NumberField label="직장인구 남(500m)" value={form.employ500Male} onChange={(v) => set("employ500Male", v)} />
          <NumberField label="직장인구 여(500m)" value={form.employ500Female} onChange={(v) => set("employ500Female", v)} />
          <NumberField label="직장인구 전체(1km)" value={form.employ1kmTotal} onChange={(v) => set("employ1kmTotal", v)} />
          <NumberField label="직장인구 남(1km)" value={form.employ1kmMale} onChange={(v) => set("employ1kmMale", v)} />
          <NumberField label="직장인구 여(1km)" value={form.employ1kmFemale} onChange={(v) => set("employ1kmFemale", v)} />
        </div>

        <p className="mt-6 text-xs font-medium text-[#8a8072]">시설정보 (500m / 1km)</p>
        <div className={`${gridClass} mt-2`}>
          <NumberField
            label="지하철 승하차(500m)"
            value={form.facility500SubwayRiders}
            onChange={(v) => set("facility500SubwayRiders", v)}
            hint="소상공인365 '지하철 이용 현황' 자동추출(반경 내 역이 여러 개면 합산) — 역 없는 지역은 공란"
          />
          <NumberField
            label="지하철 승하차(1km)"
            value={form.facility1kmSubwayRiders}
            onChange={(v) => set("facility1kmSubwayRiders", v)}
            hint="소상공인365 '지하철 이용 현황' 자동추출(반경 내 역이 여러 개면 합산) — 역 없는 지역은 공란"
          />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>자사 시설/사양</h3>
        <div className={`${gridClass} mt-4`}>
          <TextField
            label="CPU"
            value={form.ownCpu ?? ""}
            onChange={(v) => set("ownCpu", v || null)}
            hint="예: 14400F, i5 14세대 — 참고용 기록(사양점수엔 자동 반영 안 됨, 아래 종합사양 점수에 참고)"
          />
          <TextField
            label="RAM"
            value={form.ownRam ?? ""}
            onChange={(v) => set("ownRam", v || null)}
            hint="예: 16G, 32G — 참고용 기록(사양점수엔 자동 반영 안 됨)"
          />
          <TextField label="VGA 기본사양" value={form.ownVgaBase ?? ""} onChange={(v) => set("ownVgaBase", v || null)} />
          <TextField label="VGA 최고사양" value={form.ownVgaTop ?? ""} onChange={(v) => set("ownVgaTop", v || null)} hint="없으면 비움 (표준값 없음)" />
          <NumberField label="게임존 수" value={form.ownGameZoneCount} onChange={(v) => set("ownGameZoneCount", v)} hint="비우면 표준 3종 적용" />
          <NumberField label="1인룸 수" value={form.ownRoom1} onChange={(v) => set("ownRoom1", v)} />
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
          사양·좌석·입지 점수는 위에 입력한 VGA·존구성·층수+엘리베이터로부터 원본 Apps Script(점포평가.gs)
          그대로 자동 계산됩니다. 종합 경쟁력점수 가중합(사양25%·좌석30%·먹거리20%·인테리어15%·입지10%)은
          원본 계수 그대로 적용됩니다.
        </p>
        <div className={`${gridClass} mt-4`}>
          <ComputedField label="사양 점수 (자동)" value={computedScores.spec} hint="VGA(+게임존 가산) 70% + 종합사양(모니터) 30%" />
          <ComputedField label="좌석 점수 (자동)" value={computedScores.seat} hint="존 다양성 50%+수용력 50%" />
          <ComputedField label="입지 점수 (자동)" value={computedScores.location} hint="층수+엘리베이터+지상/지하" />
          <ScoreSelectField
            label="종합사양 점수 (모니터·CPU·메모리·주변기기)"
            value={form.ownMonitorScore}
            onChange={(v) => set("ownMonitorScore", v)}
            hint={
              `모니터 화질·CPU·메모리·주변기기(키보드/마우스/헤드셋)를 종합해서 직접 1~5점 평가 · 비우면 표준값 4 적용` +
              (computedScores.cpuSuggestion != null || computedScores.ramSuggestion != null
                ? ` · 참고: CPU${computedScores.cpuSuggestion ?? "-"}점/RAM${computedScores.ramSuggestion ?? "-"}점(자동제안, 참고만)`
                : "")
            }
          />
        </div>

        <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">먹거리</h4>
        <p className="mt-1 text-xs text-[#8a8072]">
          조리방식은 최신 PC방이 대부분 인덕션이라 변별력이 없어, 실제 사용 브랜드를 기준으로 점수를
          매깁니다(브랜드별 점수는 설정 화면에서 조정). 브랜드없음이면 직접입력값을 씁니다.
        </p>
        <div className={`${gridClass} mt-3`}>
          <SelectField label="먹거리 브랜드" value={form.ownFoodBrand} onChange={(v) => set("ownFoodBrand", v)} options={FOOD_BRAND_OPTIONS} />
          <ScoreSelectField
            label="먹거리 점수 (직접입력)"
            value={form.ownFoodScore}
            onChange={(v) => set("ownFoodScore", v)}
            hint="브랜드없음/미입력일 때만 사용 · 비우면 표준값 5(상) 적용"
          />
          <ComputedField label="먹거리 점수 (최종)" value={computedScores.food} hint="브랜드 점수 또는 직접입력값" />
        </div>

        <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">인테리어</h4>
        <div className={`${gridClass} mt-3`}>
          <ScoreSelectField label="인테리어 수준" value={form.ownInteriorLevelScore} onChange={(v) => set("ownInteriorLevelScore", v)} step={0.5} hint="마감·컨셉 퀄리티" />
          <ScoreSelectField label="매장관리상태" value={form.ownInteriorConditionScore} onChange={(v) => set("ownInteriorConditionScore", v)} step={0.5} hint="청결도·노후도" />
          <ComputedField label="인테리어 점수 (최종)" value={computedScores.interior} hint="위 두 항목의 평균, 둘 다 비었으면 아래 직접입력값" />
          <ScoreSelectField
            label="인테리어 점수 (직접입력)"
            value={form.ownInteriorScore}
            onChange={(v) => set("ownInteriorScore", v)}
            hint="위 세부항목을 하나도 안 채웠을 때만 사용 · 비우면 표준값 5(상) 적용"
          />
        </div>
      </section>

      {errors.length > 0 && (
        <div className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">
          <ul className="list-inside list-disc">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {message && (
        <p className="app-badge app-badge-ok w-full justify-start px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <div className="flex justify-end gap-3 print:hidden">
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => handleSave(true)}
          className="app-btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving === "draft" ? "저장 중..." : "임시저장"}
        </button>
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => handleSave(false)}
          className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
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
      <span className="text-xs font-medium text-[#8a8072]">{label}</span>
      <input
        type="text"
        value={value}
        readOnly
        className="app-card-sm w-full rounded-md px-2.5 py-1.5 text-sm text-[#8a8072]"
      />
    </label>
  );
}
