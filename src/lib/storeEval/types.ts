// 점포평가 시스템 (V61/V62) - 공용 타입 정의
// 원본: 구글시트 "PC가맹_PC_가맹점전수조사_데이터_VF_260428"의 07/05/09/12/13 시트를 그대로 이식.
// 필드/열 순서/한글 라벨은 docs/model-spec.md 근거. 임의로 필드를 더하거나 빼지 않는다.

export type ReviewStatus = "진행" | "보류" | "종료" | "완료";
export type GroundLevel = "지상" | "지하";
export type SurveyLevel = "상세" | "간략" | "외관만";
// 원본 시트에는 없는 워크플로 상태값. 05_경쟁점정보에 "경쟁점 없음"과 "노후·저경쟁력 미조사"를
// 구분하는 필드가 없어(docs/data-issues.md #3), 사용자 승인 하에 웹에서만 신규로 추가한다.
//
// 2026-08-20 갱신: 이 상태값을 UI 라벨로만 두지 않고 계산 로직(경쟁점 적용대수·실가동좌석·
// 경쟁력점수)이 실제로 분기하도록 반영했다.
//   조사완료           실사값을 그대로 쓴다. 값이 비어 있으면 "미조사"가 아니라 "값 누락"이므로
//                      기본값으로 치환하지 않고 집계에서 제외 + 완결성 경고로 남긴다.
//   경쟁점없음         이 위치에 경쟁점이 실제로 없다는 뜻. 0으로 계산하고 집계에서 완전히 제외한다.
//   노후저경쟁력미조사  경쟁점은 존재하지만 "노후·저경쟁력이라 조사할 필요가 없다"는 업무 판단.
//                      존재 자체는 반영해야 하므로 간략_기본대수(70대)·간략_기본점수(1.5, 외관만과
//                      동일 취급) 로 채우되, "실측이 아니라 판단으로 채운 값"이라는 걸 화면에 남긴다.
export type CompetitorSurveyState = "조사완료" | "경쟁점없음" | "노후저경쟁력미조사";
// 요청사항 문구(investigationStatus)에 맞춘 별칭 — 값은 CompetitorSurveyState와 동일하다.
export type CompetitorInvestigationStatus = CompetitorSurveyState;
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
  plannedOpenMonth: number | null; // 예상오픈월 (1~12) — AA 기준매출(오픈월부터 10개월 평균) 계산 입력

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
  // 경쟁력점수 5개 구성요소 중 사양/좌석/입지는 원본 Apps Script(점포평가.gs)가 VGA·존구성·
  // 층수+엘리베이터로부터 자동 계산하는 값이라(CANDIDATE_AUTO) 여기 CandidateInput에는 없다 —
  // calc.ts의 computeSpecScore/computeSeatScore/computeLocationScoreFromFacts로 매번 파생하고
  // CandidateComputed에 결과를 담는다. 먹거리/인테리어/모니터평가는 원본에서도 평가자가 1~5점을
  // 직접 입력하는 항목이라 그대로 둔다.
  ownFoodScore: number | null; // 1~5
  ownInteriorScore: number | null; // 1~5
  ownMonitorScore: number | null; // 1~5 (사양 산식의 모니터 30% 비중 — 07 원본 필드)

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
  ownZoneTypeCount: number | null; // 자사_존종류수 (일반석1 + 개수>0인 존 종류 수)
  ownPrivateRoomCount: number | null; // 자사_독립룸수 (1인룸+2인룸+팀룸+커플존+VIP존 개수의 단순 합계 — 프렌즈존 제외)
  ownSpecScore: number | null; // 자사_점수_사양 (VGA 70%+모니터 30%+게임존 가산, computeSpecScore)
  ownSeatScore: number | null; // 자사_점수_좌석 (다양성50%+수용력50%, computeSeatScore)
  ownLocationScore: number | null; // 자사_점수_입지 (층수+엘리베이터, computeLocationScoreFromFacts)
  ownCompetitivenessScore: number | null; // 자사_경쟁력점수 (BM) = 5개 점수 가중합
  competitorAvgCompetitiveness: number | null; // 경쟁점_평균경쟁력
  competitivenessGap: number | null; // 경쟁력격차 (BO)
};

// ---- 05_경쟁점정보 : 후보지 하나에 딸린 경쟁점 (1:N) ----
export type Competitor = {
  id: string;
  candidateCode: string; // 가맹점코드 (07/13과 연결되는 키)
  name: string;
  surveyLevel: SurveyLevel | null;
  // 2026-08-20: 필드명을 surveyState → investigationStatus로 바꿨다(요청사항 문구 그대로).
  // 기존 문서에 남아 있는 surveyState 값은 store.ts의 migrateCompetitorInvestigationStatus로
  // 읽어올 때 investigationStatus로 옮겨 담는다(마이그레이션, 기존 데이터 손실 없음).
  investigationStatus: CompetitorInvestigationStatus;
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
  // 사양/좌석/입지 점수는 CandidateInput과 같은 이유로 자동 계산(계산결과는 저장하지 않고
  // calc.ts의 computeSpecScore/computeSeatScore/computeLocationScoreFromFacts로 매번 파생한다).
  // 먹거리/인테리어/모니터는 원본에서도 조사자가 1~5점을 직접 입력한다.
  foodScore: number | null; // 1~5
  foodBasis: string | null;
  interiorScore: number | null;
  interiorBasis: string | null;
  monitorScore: number | null;
  monitorBasis: string | null;
  room1: number | null;
  room2: number | null;
  teamRoom: number | null;
  coupleZone: number | null;
  premiumZone: number | null; // 프리미엄존 개수(원본은 유/무이나 웹은 개수 입력 - 0보다 크면 "유"로 취급)
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
  // 2026-08-20 (5차) 추가 — ±10% 이내 적중률 목표. 12_운영판정 원본에는 없던 항목으로,
  // 정식 도입의 핵심 조건으로 쓰기 위해 추가했다(사용자 요청사항).
  target10pctRatio: number; // 0.8
  // ⚠️ 2026-08-20: 실제 V61은 아래 v61Training(비음수 릿지회귀)이다. v61Fallback은
  // 학습표본이 v61Training.minSampleCount 미만일 때만 쓰는 임시값이며, 화면에도
  // "임시 근사치·검증 전"으로 표시해야 한다(v61Fallback을 최종 결과처럼 보여주지 않는다).
  v61Fallback: {
    intercept: number;
    hourlyRateCoef: number;
    demandPerPcCoef: number;
    competitivenessCoef: number;
  };
  // V61 "실측 학습모형" — 08_계산기준 "신규점 실측예측"/12_운영판정 VALIDATION 설정 그대로.
  // 학습 표본은 ExistingStore(브랜드=블랙라벨·정상영업·산식학습제외 아님) + 실제 매출로 매번
  // calc.ts의 fitEmpiricalRevenueModel이 다시 학습한다 — 계수를 여기 하드코딩하지 않는다.
  v61Training: {
    ridgeLambda: number; // 1
    ridgeWeight: number; // 0.60 — 릿지회귀 예측 가중치
    baselineWeight: number; // 0.40 — 대당월매출 중앙값 가중치
    minSampleCount: number; // 12 — 미달이면 v61Fallback을 쓴다
  };
  // 13_신규후보지판정 "경쟁력격차 → 예상수요확보율/신규수요증가율" 룩업표 (08_계산기준!B44:D49).
  // gapLowerBound는 오름차순이며, 실제 격차가 그 값 이상인 것 중 가장 큰 하한을 적용한다(LOOKUP과 동일).
  demandCaptureTable: { gapLowerBound: number; captureRate: number; growthRate: number }[];
  // "신규점 실측예측" 공통계수 (08_계산기준!C50/C51)
  measuredForecastProductRatio: number; // 0.5 — 기본 상품매출비율(이 파이프라인 전용, 다른 상품비율과 별개)
  measuredForecastMaxReviewUtilization: number; // 0.5 — 초과 시 "데이터 재검토"
  // AA 기준매출 — 08_계산기준!C54:E65 "AA 월별기준"을 그대로 옮긴 표. month는 1~12.
  aaMonthlyTargets: { month: number; dailyRevenuePerPcTarget: number; daysInMonth: number }[];
  aaMaxPcCount: number; // 100 — MIN(예상PC대수,100)
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
  v61IsFallback: boolean; // true면 학습표본 부족으로 폴백 회귀식 사용(화면에 "임시 근사치·검증 전"으로 표시)
  v61ModelLabel: "V61 실측 학습모형" | "임시 근사치·검증 전"; // 화면 표시용 (요청사항 8)
  v61TrainingSampleCount: number; // 학습에 실제로 쓰인 기존 가맹점 수
  v61ValidationMeanAbsError: number | null; // 학습모형의 leave-one-out 평균절대오차 (검증 전이면 null)
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

  // 요청사항 3 — "실측기반 예상월매출" 파이프라인 (13_신규후보지판정 V~AB열 그대로).
  // 경쟁점 실가동좌석 → 경쟁력격차 룩업(수요확보율/신규수요증가율) → 예상 평균가동좌석
  // → 예상 가동률 → 실측기반 예상월매출 순서로 이어진다. V61(인구·이용률 기반)과는 별개의
  // 두 번째 예측 경로이며, 화면에는 두 값을 나란히 보여주고 어느 쪽도 감추지 않는다.
  competitorOccupiedSeats: number | null; // 경쟁점 실가동좌석
  competitorOccupiedSeatsCoverage: {
    measured: number; // 핑봇_가동률(기간평균)로 실측된 경쟁점 수 — 좌석수 합산에 포함
    // 2026-08-21: 방문 시점 실시간 착석률(measuredSeatRate)뿐이고 핑봇 기간평균이 없는 경쟁점 수.
    // 방문 시각에 따라 값이 크게 흔들려 평균가동률로 못 써서 좌석수 합산에서는 뺀다(참고만 표시).
    realtimeSnapshotOnly: number;
    assumedLowThreat: number; // 노후저경쟁력미조사로 간주해 채운 경쟁점 수
    missingData: number; // 조사완료인데 값이 없어 집계에서 제외된 경쟁점 수(완결성 경고 대상)
    excludedNoCompetitor: number; // 경쟁점없음으로 처음부터 제외된 수
  } | null;
  demandCaptureRate: number | null; // 예상 수요확보율 (경쟁력격차 룩업)
  newDemandGrowthRate: number | null; // 신규수요 증가율 (경쟁력격차 룩업)
  expectedOccupiedSeats: number | null; // 예상 평균가동좌석 = 실가동좌석×확보율×(1+증가율)
  expectedUtilization: number | null; // 예상 가동률 = 예상평균가동좌석 ÷ 예상PC대수 (100% 초과 가능 — 수요초과 신호)
  expectedDailyRevenuePerPc: number | null; // 예상 대당 일매출
  measuredForecastMonthlyRevenue: number | null; // 실측기반 예상월매출
  measuredForecastNeedsReview: boolean; // 예상가동률이 최대검토가동률을 넘어 "데이터 재검토" 대상인지

  // 요청사항 4 — AA 기준매출(오픈월부터 10개월 순수익 2,000만원 대당 일매출목표 평균)
  aaBaselineRevenue: number | null;
  aaJudgement: "오픈월 입력 필요" | "실측자료 부족" | "데이터 재검토" | "AA" | "AA 미달" | null;
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
  // 참고용(비교 대상) — 원본 스프레드시트 "V61 기본예측(참고)" 캐시값. 웹은 이 값을 그대로 쓰지
  // 않고 v61Training 특징치로 매번 다시 학습·검증한다(아래 세 필드 + actualMonthlyRevenueAvg).
  v61Predicted: number | null;
  // 04_점포평가요약!X열(상권수요) - 신규후보지 상권등급(SS/S/A/B) 백분위 계산의 비교 모집단으로 쓴다
  // (calc.ts computeMarketGrade의 existingMarketDemands 인자).
  referenceMarketDemand: number | null;

  // 2026-08-20 추가 — V61 실측 학습모형(비음수 릿지회귀)의 학습 특징치.
  // 01_점포기본정보/04_점포평가요약에서 그대로 가져온다(추정하지 않음). 이 넷이 모두 있고
  // brandType=블랙라벨·franchiseStatus=정상·excludedFromModel=false인 점포만 학습 대상이다.
  brandType: BrandType | null; // 09_입지동선평가!P열(브랜드구분) — 블랙라벨만 학습에 사용
  validationUse: "사용" | "제외" | null; // 04_점포평가요약!검증사용여부 (참고용 - 최종 필터는 위 3조건으로 직접 판정)
  hourlyRate: number | null; // 01_점포기본정보!자사_요금표_시간당
  ownDemand: number | null; // 04_점포평가요약!예측_자사수요 (PC대수로 나눠 특징치로 쓴다)
  competitivenessScore: number | null; // 04_점포평가요약!자사_경쟁력점수 (=01_점포기본정보와 동일)
  actualMonthlyRevenueAvg: number | null; // 04_점포평가요약!누적평균매출 — 학습 타깃(실제매출), 오픈 2개월차~최신 완료월 평균

  // 2026-08-20 추가 — 12개월 미완료 매장까지 포함한 코호트 검증(요청사항, calc.ts runCohortValidation) 입력.
  completedMonths: number | null; // 매출 실측이 확정된 완료월 수 (진행 중인 이번 달은 제외) — storeEvalExistingStoreSales에서 재계산

  // 2026-08-20 (4차) 추가 — 09_입지동선평가!특수수요유형/강도. 10_오차원인분석에서 대학가·군부대·
  // 산업단지 상권이 계통적으로 과소예측되는 게 확인돼 V61 학습 4번째 피처로 추가했다
  // (calc.ts computeSpecialDemandScore/EmpiricalRevenueSample). LocationEvaluation과 값이
  // 같지만, 학습 피처 조립 함수(calc.ts)가 순수함수로 남도록 ExistingStore에도 복제해 둔다.
  specialDemandType: SpecialDemandType | null;
  specialDemandIntensity: SpecialDemandIntensity | null;

  // 2026-08-20 (3차) 추가 — 01_점포기본정보 나머지 원본 입력값. 시트 탭을 정리해도 데이터가
  // 남도록 전부 옮겨 담는다. CandidateInput의 동명 필드와 의미가 완전히 같다(같은 이름을 그대로 씀).
  address: string | null;
  hasElevator: boolean | null;
  demographicsYear: number | null;
  renovationYear: number | null; // 자사_리뉴얼연도 (후보지 단계에는 없고 기존점에만 있음)
  ownVgaBase: string | null;
  ownVgaTop: string | null;
  ownGameZoneCount: number | null;
  ownRoom1: number | null;
  ownRoom2: number | null;
  ownTeamRoom: number | null;
  ownCoupleZone: number | null;
  ownVipZone: number | null;
  ownFriendsZone: number | null;
  ownFoodScore: number | null;
  ownInteriorScore: number | null;
  ownMonitorScore: number | null;
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
  licensedPcStores500m: number | null;
  operatingPcStores500m: number | null;

  // 2026-08-21 추가 — "후보지평가 → 오픈 → 실제매출로 검증" 흐름을 실제로 잇기 위한 필드.
  // 이 매장이 어느 후보지평가에서 나왔는지, 그때 화면에 보였던 예측값이 뭐였는지를 기록한다.
  // convertCandidateToExistingStore(전환 시)나 linkExistingStoreToCandidate(수동 연결 시)로만
  // 채워진다 — 자동 이름/주소 매칭으로 추론하지 않는다(오매칭 위험).
  originCandidateCode: string | null;
  // 후보지평가 당시의 예측값 스냅샷. storeEvalResults는 Result 탭을 열 때마다 최신 모델로
  // 다시 계산해서 덮어써지므로(evaluate.ts), 여기 스냅샷은 연결 시점 이후 절대 재계산하지
  // 않는다 — "그때 이 숫자를 보고 출점을 결정했다"는 기록 그 자체를 보존하는 목적.
  predictedAtConversion: {
    candidateCode: string;
    v61Baseline: number | null;
    v61ModelLabel: string;
    v61TrainingSampleCount: number;
    v62Rate: number | null;
    v62Final: number | null;
    conservativeSales: number | null;
    upperSales: number | null;
    expectedPcCount: number | null;
    hourlyRate: number | null;
    calculatedAt: number; // 후보지평가 당시 evaluateCandidate 계산 시각
    linkedAt: number; // 이 스냅샷을 기존 가맹점에 연결한 시각(전환 또는 수동연결 시점)
  } | null;

  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
};

// ---- 05_경쟁점정보(기존 가맹점용) : Competitor와 완전히 같은 타입, candidateCode 자리에
// 가맹점코드를 그대로 쓴다. 신규후보지든 기존 가맹점이든 "경쟁점 목록"이라는 의미가 같아서
// storeEvalCompetitors 컬렉션을 그대로 공유한다 (중복 타입/컬렉션을 만들지 않음).

// ---- 03_회원정보입력 : 기준일별 스냅샷 누적. calc.ts 계산에는 쓰지 않고(참고 데이터,
// docs/data-issues.md #4) 12개월 미만 매장 위주로 계속 갱신한다.
export type ExistingStoreMemberSnapshot = {
  storeCode: string;
  snapshotDate: string; // 회원자료기준일, "yyyy-MM-dd"
  totalMembersReported: number | null; // 총회원수_집계
  age7under_male: number | null;
  age7under_female: number | null;
  age8to13_male: number | null;
  age8to13_female: number | null;
  age14to19_male: number | null;
  age14to19_female: number | null;
  age20to30_male: number | null;
  age20to30_female: number | null;
  age31to45_male: number | null;
  age31to45_female: number | null;
  age46plus_male: number | null;
  age46plus_female: number | null;
  enteredBy: string | null;
  memo: string | null;
  updatedAt: number;
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
