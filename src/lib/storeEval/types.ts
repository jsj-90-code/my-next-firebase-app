// 점포평가 시스템 (V61/V62) - 공용 타입 정의
// 원본: 구글시트 "PC가맹_PC_가맹점전수조사_데이터_VF_260428"의 07/05/09/12/13 시트를 그대로 이식.
// 필드/열 순서/한글 라벨은 docs/model-spec.md 근거. 임의로 필드를 더하거나 빼지 않는다.

export type ReviewStatus = "진행" | "보류" | "종료" | "완료";
export type GroundLevel = "지상" | "지하";
export type SurveyLevel = "상세" | "간략" | "외관만";
// 원본 시트에는 없는 워크플로 상태값. 05_경쟁점정보에 "경쟁점 없음"과 "노후·저경쟁력 미조사"를
// 구분하는 필드가 없어(docs/data-issues.md #3), 사용자 승인 하에 웹에서만 신규로 추가한다.
export type CompetitorSurveyState = "조사완료" | "경쟁점없음" | "노후저경쟁력미조사";
export type InflowRestriction = "없음" | "보통" | "강함";
export type BrandType = "블랙라벨" | "리그PC방" | "확인필요";
export type SpecialDemandType = "없음" | "대학가" | "군부대" | "산업단지" | "관광유흥" | "기타";
export type SpecialDemandIntensity = "없음" | "낮음" | "보통" | "높음";

// ---- 07_신규후보지 : 신규 후보지 입력 ----
export type CandidateInput = {
  code: string; // 후보지코드, N001 형식
  name: string;
  address: string;
  reviewDate: string | null; // ISO date
  reviewStatus: ReviewStatus;
  expectedPcCount: number | null;
  floor: number | null;
  groundLevel: GroundLevel | null;
  hasElevator: boolean | null;
  hourlyRate: number | null; // 요금표_시간당원
  demographicsYear: number | null; // 상권데이터기준연도

  // 반경 500m/1km 인구통계 (08_계산기준 상권분석 원수요 계산 입력)
  pop500m: number | null;
  area1kmKm2: number | null;
  pop1km: number | null;
  male1kmRatio: number | null;
  age1km_0_9: number | null;
  age1km_10_19: number | null;
  age1km_20_29: number | null;
  age1km_30_39: number | null;
  age1km_40_49: number | null;
  age1km_50_59: number | null;
  age1km_60_69: number | null;
  age1km_70_79: number | null;
  age1km_80plus: number | null;

  floating500Avg: number | null;
  floating500Male: number | null;
  floating500Female: number | null;
  floating500_10s: number | null;
  floating500_20s: number | null;
  floating500_30s: number | null;
  floating500_40s: number | null;
  floating500_50s: number | null;
  floating500_60plus: number | null;

  licensedPcStores500m: number | null; // 인허가_PC방업소수_500m
  operatingPcStores500m: number | null; // 실영업_PC방업소수_500m

  // 자사 시설/사양 (경쟁력 점수 입력)
  ownVgaBase: string | null;
  ownVgaTop: string | null;
  ownGameZoneCount: number | null;
  ownRoom1: number | null; // 1인룸
  ownRoom2: number | null; // 2인룸
  ownTeamRoom: number | null;
  ownCoupleZone: number | null;
  ownVipZone: number | null;
  ownFriendsZone: number | null;
  // 경쟁력점수 5개 구성요소(사양/좌석/먹거리/인테리어/입지)는 1~5점으로 평가자가 직접 입력한다.
  // 원본은 사양·좌석·입지 점수를 Apps Script가 자동 계산하지만(VGA/존구성/층수→점수 변환표),
  // 그 정확한 변환식을 확보하지 못했다(docs/data-issues.md). 새 가중치를 지어내는 대신,
  // 원본에서도 사람이 직접 매기는 먹거리/인테리어평가와 동일한 방식(1~5 직접 입력)으로 통일한다.
  // 종합 경쟁력점수(가중합)만은 08_계산기준에 명시된 가중치(25/30/20/15/10%)를 그대로 쓴다.
  ownSpecScore: number | null; // 1~5 (사양)
  ownSeatScore: number | null; // 1~5 (좌석)
  ownFoodScore: number | null; // 1~5
  ownInteriorScore: number | null; // 1~5
  ownLocationScore: number | null; // 1~5
  ownMonitorScore: number | null; // 1~5 (사양 산식 중 모니터 보조 참고용, 07 원본 필드 그대로 보존)

  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
  isDraft: boolean; // 임시저장 여부
};

// 07 시트의 AV~BZ열. 원본은 Apps Script(점포평가.gs)가 값으로 채우는 계산열이라 셀 수식이 없다
// (docs/model-spec.md §2). 웹에서는 이 값들을 calc.ts의 함수로 매번 재계산해서 채운다 — 저장은
// "평가 시점 스냅샷"으로 evaluationResults 쪽에 남기고, candidate 문서 자체에는 입력값만 둔다.
export type CandidateComputed = {
  rawDemand: number | null; // 원수요 (유동 또는 주거 중 선택된 원천)
  demandSource: "유동" | "주거" | null;
  marketDemand: number | null; // 상권수요
  marketGrade: "SS" | "S" | "A" | "B" | null; // 상권등급
  marketCharacter: "번화가" | "혼합" | "주거중심" | null; // 상권성격
  competitorScore: number | null;
  competitorIp: number | null; // 경쟁IP
  totalIp: number | null; // 총IP (자사+경쟁)
  ipPerDemand: number | null; // IP당수요
  marketJudgement: string | null; // 상권판정
  competitorIpBasis: string | null; // 경쟁IP_근거
  ownZoneTypeCount: number | null; // 자사_존종류수 (개수 집계 - 순수 파생값)
  ownPrivateRoomCount: number | null; // 자사_독립룸수 (팀룸×2+커플존×3+VIP존×5, 순수 파생값)
  ownCompetitivenessScore: number | null; // 자사_경쟁력점수 (BM) = 5개 입력점수 가중합
  competitorAvgCompetitiveness: number | null; // 경쟁점_평균경쟁력
  competitivenessGap: number | null; // 경쟁력격차 (BO)
};

// ---- 05_경쟁점정보 : 후보지 하나에 딸린 경쟁점 (1:N) ----
export type Competitor = {
  id: string;
  candidateCode: string; // 가맹점코드 (07/13과 연결되는 키)
  name: string;
  surveyLevel: SurveyLevel | null;
  surveyState: CompetitorSurveyState; // 신규 추가 필드
  address: string | null;
  distanceM: number | null;
  floor: number | null;
  groundLevel: GroundLevel | null;
  totalPcCount: number | null; // 전체대수 (실사값)
  appliedPcCount: number | null; // 적용대수 - 실사값 없으면 대체값(§3.2)을 조사 후 여기 채운다
  hasElevator: boolean | null;
  cpu: string | null;
  vgaBase: string | null;
  vgaTop: string | null;
  ram: string | null;
  monitor: string | null;
  ratePer1000Won: number | null; // 1000원당분
  hourlyRateConverted: number | null; // 시간당환산요금
  paidDeduction: string | null; // 유료차감
  visitedAt: string | null;
  visitedDow: string | null;
  visitorCount: number | null;
  measuredSeatRate: number | null;
  pingbotUtilization: number | null; // 핑봇_가동률
  pingbotPeriod: string | null;
  renovationYear: number | null;
  // CandidateInput의 동일 항목과 같은 이유로(docs/data-issues.md), 사양/좌석/입지 점수도
  // 조사자가 1~5점 직접 입력한다.
  specScore: number | null; // 1~5
  seatScore: number | null; // 1~5
  foodScore: number | null; // 1~5
  foodBasis: string | null;
  interiorScore: number | null;
  interiorBasis: string | null;
  monitorScore: number | null;
  monitorBasis: string | null;
  locationScore: number | null; // 점수_입지
  room1: number | null;
  room2: number | null;
  teamRoom: number | null;
  coupleZone: number | null;
  premiumZone: number | null;
  premiumSpec: boolean | null;
  createdAt: number;
  updatedAt: number;
};

// ---- 09_입지동선평가 ----
export type LocationEvaluation = {
  candidateCode: string;
  name: string;
  address: string;
  locationScore: 1 | 2 | 3 | 4 | 5 | null; // 상권내위치점수
  flowScore: 1 | 2 | 3 | 4 | 5 | null; // 주요동선점수
  preemptionScore: 1 | 2 | 3 | 4 | 5 | null; // 선점경쟁점수
  visibilityScore: 1 | 2 | 3 | 4 | 5 | null; // 접근가시성점수
  // 입지동선종합점수는 자동계산이라 저장하지 않고 calc.ts에서 매번 파생한다.
  mapMemo: string | null; // 지도판단메모
  attractionScore: 1 | 2 | 3 | 4 | 5 | null; // 상권흡인력점수
  specialDemandType: SpecialDemandType | null;
  specialDemandIntensity: SpecialDemandIntensity | null;
  inflowRestriction: InflowRestriction | null; // 외부유입제한 - V62 보정률 직결
  demandLeakageRisk: InflowRestriction | null; // 수요이탈위험
  marketStructureMemo: string | null;
  brandType: BrandType | null;
  updatedAt: number;
  updatedBy: string | null;
};

// ---- 12_운영판정 : 모델 계수/판정기준 (관리자 전용, 변경이력 보존) ----
export type ModelSettings = {
  id: string; // "current" 등
  modelVersion: string; // "V62"
  inflowAdjustment: { 없음: number; 보통: number; 강함: number };
  lowerBoundFactor: number; // 0.85
  upperBoundFactor: number; // 1.15
  minTotalSample: number; // 30
  minStrongInflowSample: number; // 5
  targetMAE: number; // 0.15
  targetMedianAE: number; // 0.10
  target20pctRatio: number; // 0.75
  maxAvgBias: number; // 0.05
  v61Fallback: {
    intercept: number;
    hourlyRateCoef: number;
    demandPerPcCoef: number;
    competitivenessCoef: number;
  };
  // 08_계산기준의 상권/경쟁력 계수 (하드코딩 금지 대상)
  marketCharacterThreshold: { downtown: number; mixed: number }; // 8배/4배
  marketDemandEffectiveRate: { downtown: number; mixed: number; residential: number }; // 0.53/0.61/0.78
  marketGradePercentile: { SS: number; S: number; A: number }; // 상위10/30/60%
  competitivenessWeights: { spec: number; seat: number; food: number; interior: number; location: number }; // 25/30/20/15/10%
  specWeights: { vga: number; monitor: number }; // 70/30
  // 09_입지동선평가!H열(입지동선종합점수) = 상권내위치×0.3 + 주요동선×0.3 + 선점경쟁×0.25 + 접근가시성×0.15
  locationCompositeWeights: { withinMarket: number; flow: number; preemption: number; visibility: number };
  brandFilter: string; // "블랙라벨"
  saturationThreshold: number; // IP당수요 < 7 => 포화 주의
  updatedAt: number;
  updatedBy: string | null;
};

export type ModelSettingsHistoryEntry = {
  id: string;
  changedAt: number;
  changedBy: string | null;
  before: ModelSettings;
  after: ModelSettings;
};

// ---- 13_신규후보지판정 : 최종 결과 스냅샷 ----
// 원본 시트 실제 문자열을 그대로 채택한다 (요청서 표현이 아니라 원본 셀 수식 문자열 — model-spec §12).
export type CompletionStatus =
  | "07 분석 필요"
  | "09 입지평가 필요"
  | "외부유입 확인 필요"
  | "브랜드 확인 필요"
  | "완료";

export type FinalJudgement =
  | "07 분석 필요"
  | "09 입지평가 필요"
  | "외부유입 확인 필요"
  | "브랜드 확인 필요"
  | "V62 계산 확인 필요"
  | "포화 주의"
  | "입지 재검토"
  | "평가 완료";

export type EvaluationResult = {
  candidateCode: string;
  candidateName: string;
  address: string;
  reviewStatus: ReviewStatus | null;
  expectedPcCount: number | null;
  hourlyRate: number | null;
  v61Baseline: number | null; // V61 기본예측(참고)
  v61IsFallback: boolean; // true면 07 Apps Script 값이 아니라 폴백 회귀식 사용
  locationScore: number | null; // 입지동선종합점수
  inflowRestriction: InflowRestriction | null;
  v62Rate: number | null; // V62 보정률
  v62Final: number | null; // V62 최종예상월매출
  conservativeSales: number | null; // 보수판단매출 85%
  upperSales: number | null; // 상한참고매출 115%
  marketDemand: number | null;
  marketGrade: string | null;
  marketCharacter: string | null;
  competitorIp: number | null;
  ipPerDemand: number | null;
  competitivenessGap: number | null;
  completionStatus: CompletionStatus | null; // 입력완성도
  finalJudgement: FinalJudgement | null; // 최종운영판정
  modelVersion: string; // 계산 시점 모델 버전
  settingsSnapshotId: string; // 계산에 쓰인 ModelSettings 문서 id (추적용)
  calculatedAt: number;
};

// ---- 기존 가맹점 검증 (6.기존 가맹점 검증 화면) ----
export type ExistingStore = {
  storeCode: string; // 가맹점코드
  storeName: string;
  pcCount: number | null;
  floor: number | null;
  groundLevel: GroundLevel | null;
  openedAt: string | null;
  franchiseStatus: string | null; // 가맹상태
  excludedFromModel: boolean; // 산식학습제외 (01_점포기본정보 CO열)
  excludedReason: string | null; // 학습제외사유 (CP열)
  // ⚠️ 07 계산열과 같은 이유로(docs/data-issues.md #1) V61은 Apps Script 회귀식 결과라
  // 웹에서 재계산할 수 없다. 04_점포평가요약!AV열(예측_월매출)에서 그대로 옮겨와 저장해야 한다.
  v61Predicted: number | null;
  // 04_점포평가요약!X열(상권수요) - 신규후보지 상권등급(SS/S/A/B) 백분위 계산의 비교 모집단으로 쓴다
  // (calc.ts computeMarketGrade의 existingMarketDemands 인자).
  referenceMarketDemand: number | null;
};

// 매출DB 시트에서 동기화되는 월별 실측 데이터 (외부 구글시트 연동, 사용자가 관리)
export type ExistingStoreMonthlySales = {
  storeCode: string;
  yearMonth: string; // "2026-07"
  pcSales: number | null;
  productSales: number | null;
  productRatio: number | null;
  utilizationRate: number | null;
  salesPerPcPerDay: number | null;
};

// 12_운영판정!A36:N200 검증 대시보드 한 행의 계산 결과 타입은 calc.ts의 ValidationInputRow /
// ValidationComputedRow / ValidationSummaryResult를 그 자리에서 그대로 쓴다(중복 정의하지 않음).
