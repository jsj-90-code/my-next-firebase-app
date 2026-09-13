import type { CandidateInput, Competitor } from "./types";
const CANDIDATE_NUMERIC_FIELDS: { key: keyof CandidateInput; label: string }[] = [
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
  { key: "ownSingleSeatCount", label: "1인석 수" },
  { key: "ownRoom1", label: "1인룸 수" },
  { key: "ownRoom2", label: "2인룸 수" },
  { key: "ownTeamRoom", label: "팀룸 수" },
  { key: "ownCoupleZone", label: "커플존 수" },
  { key: "ownVipZone", label: "VIP존 수" },
  { key: "ownFriendsZone", label: "프렌즈존 수" },
  { key: "ownFirstClassZone", label: "퍼스트클래스존 수" },
];

export function validateCandidateInput(form: CandidateInput): string[] {
  const errors: string[] = [];
  if (Object.values(form).some((v) => typeof v === "number" && !Number.isFinite(v))) errors.push("유효하지 않은 숫자가 있습니다. 입력값을 확인해주세요.");
  if (!form.name.trim()) errors.push("후보지명을 입력해주세요.");
  if (!form.address.trim()) errors.push("주소를 입력해주세요.");
  if (form.expectedPcCount == null) errors.push("예상PC대수를 입력해주세요.");
  if (form.hourlyRate == null) errors.push("시간당요금을 입력해주세요.");
  for (const f of CANDIDATE_NUMERIC_FIELDS) {
    const v = form[f.key];
    if (f.key !== "floor" && typeof v === "number" && v < 0) errors.push(`${f.label}은(는) 음수가 될 수 없습니다.`);
  }
  // 2026-08-25 추가 — 위 "음수 불가" 일괄 검사만으로는 못 잡는 범위 검증(0은 통과하지만 실제로는
  // 말이 안 되는 값, 또는 상한이 있는 값).
  if (form.expectedPcCount != null && form.expectedPcCount < 1) errors.push("예상PC대수는 1대 이상이어야 합니다.");
  if (form.hourlyRate != null && form.hourlyRate <= 0) errors.push("요금표_시간당원은 0보다 커야 합니다.");
  if (form.plannedOpenMonth != null && (form.plannedOpenMonth < 1 || form.plannedOpenMonth > 12)) {
    errors.push("예상오픈월은 1~12 사이여야 합니다.");
  }
  if (form.male1kmRatio != null && form.male1kmRatio > 1) errors.push("반경1km 남성비율은 100%를 넘을 수 없습니다.");
  for (const key of ["expectedPcCount", "floor", "plannedOpenMonth", "demographicsYear"] as const) {
    if (form[key] != null && !Number.isInteger(form[key])) {
      errors.push(`${CANDIDATE_NUMERIC_FIELDS.find((field) => field.key === key)!.label}: 정수로 입력해주세요.`);
    }
  }
  if (form.ownTeamRoomTotalSeats != null && form.ownTeamRoomTotalSeats < 0) errors.push("팀룸 총좌석수는 음수가 될 수 없습니다.");
  return errors;
}

const COMPETITOR_NUMERIC_FIELDS: { key: keyof Competitor; label: string }[] = [
  { key: "distanceM", label: "거리(m)" },
  { key: "floor", label: "층수" },
  { key: "totalPcCount", label: "전체대수" },
  { key: "appliedPcCount", label: "적용대수" },
  { key: "ratePer1000Won", label: "1000원당분" },
  { key: "hourlyRateConverted", label: "시간당환산요금" },
  { key: "visitorCount", label: "이용객수" },
  { key: "measuredSeatRate", label: "실측착석률" },
  { key: "pingbotUtilization", label: "핑봇_가동률" },
  { key: "renovationYear", label: "리뉴얼연도" },
  { key: "singleSeatCount", label: "1인석 수" },
  { key: "room1", label: "1인룸 수" },
  { key: "room2", label: "2인룸 수" },
  { key: "teamRoom", label: "팀룸 수" },
  { key: "coupleZone", label: "커플존 좌석수" },
  { key: "vipZone", label: "VIP존 수" },
  { key: "friendsZone", label: "프렌즈존 수" },
  { key: "firstClassZone", label: "퍼스트클래스존 수" },
];

export function validateCompetitorInput(form: Competitor): string[] {
  const errors: string[] = [];
  if (Object.values(form).some((v) => typeof v === "number" && !Number.isFinite(v))) errors.push("유효하지 않은 숫자가 있습니다. 입력값을 확인해주세요.");
  if (!form.name.trim()) errors.push("경쟁점명을 입력해주세요.");
  for (const f of COMPETITOR_NUMERIC_FIELDS) {
    const v = form[f.key];
    if (f.key !== "floor" && typeof v === "number" && v < 0) errors.push(`${f.label}은(는) 음수가 될 수 없습니다.`);
  }
  // 2026-08-25 추가 — 두 필드는 calc.ts normalizePercentLike가 0~1(비율)과 1~100(퍼센트 숫자)
  // 두 표기를 모두 허용하는 레거시 데이터 호환 방식이라, 상한도 그에 맞춰 100으로 잡는다
  // (0~1로 단정해서 UI를 바꾸면 기존에 퍼센트 숫자로 넣힌 정상 데이터를 틀렸다고 오판하게 됨).
  if (form.measuredSeatRate != null && form.measuredSeatRate > 100) errors.push("실측착석률은 100을 넘을 수 없습니다.");
  if (form.pingbotUtilization != null && form.pingbotUtilization > 100) errors.push("핑봇_가동률은 100을 넘을 수 없습니다.");
  for (const key of ["totalPcCount", "floor", "renovationYear"] as const) {
    if (form[key] != null && !Number.isInteger(form[key])) {
      errors.push(`${COMPETITOR_NUMERIC_FIELDS.find((field) => field.key === key)!.label}: 정수로 입력해주세요.`);
    }
  }
  for (const key of ["teamRoomTotalSeats", "regularCoupleSeatCount"] as const) {
    if (form[key] != null && form[key] < 0) errors.push("좌석수는 음수가 될 수 없습니다.");
  }
  return errors;
}
