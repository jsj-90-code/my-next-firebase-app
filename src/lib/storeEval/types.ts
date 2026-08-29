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
//   오픈예정           2026-08-27 추가 — 아직 개점 전이라 실측(핑봇·방문착석률)이 원천적으로 존재할
//                      수 없는 경쟁점(예: 네이버지도에 "오픈예정"으로 이미 올라온 매장). 후보지가
//                      실제로 문을 열 시점엔 이미 영업 중일 가능성이 높아 경쟁IP엔 반영한다(알려진
//                      PC대수가 있으면 그대로, 없으면 노후저경쟁력미조사와 동일하게 70대로 채움,
//                      사용자 확인) — 다만 실가동좌석 집계에서는 "값 누락"이 아니라 "아직 측정
//                      불가능"이라는 걸 구분해 남긴다(완결성 경고 대상에서 제외).
export type CompetitorSurveyState = "조사완료" | "경쟁점없음" | "노후저경쟁력미조사" | "오픈예정";
// 요청사항 문구(investigationStatus)에 맞춘 별칭 — 값은 CompetitorSurveyState와 동일하다.
export type CompetitorInvestigationStatus = CompetitorSurveyState;
export type InflowRestriction = "없음" | "보통" | "강함";
export type BrandType = "블랙라벨" | "리그PC방" | "확인필요";
export type SpecialDemandType = "없음" | "대학가" | "군부대" | "산업단지" | "관광유흥" | "기타";

/**
 * 2026-08-27 추가 — 먹거리 점수를 조사자 감이 아니라 실제 사용 브랜드 기준으로 매기기 위한
 * 분류(사용자 확인). 쉐프앤클릭은 블랙라벨 자체 먹거리 브랜드, 비바쿡·PC토랑은 그 외 흔한
 * 외부 먹거리 브랜드다. 브랜드별 점수는 settings.foodBrandScores에서 조정한다.
 */
export type FoodBrand = "쉐프앤클릭" | "비바쿡" | "PC토랑" | "기타브랜드" | "브랜드없음";
export type SpecialDemandIntensity = "없음" | "낮음" | "보통" | "높음";

// ---- 07_신규후보지 : 신규 후보지 입력 ----
export type CandidateInput = {
  code: string; // 후보지코드, N001 형식
  name: string;
  address: string;
  // 2026-08-24 추가 — 카카오 Local API 주소검색 결과(상권자료 자동수집 1단계). address는 여전히
  // 사람이 입력하는 원본 텍스트 그대로 두고, 이 필드들은 그걸 지오코딩한 결과만 담는다(추정 좌표
  // 생성 금지 — 매칭 실패 시 전부 null로 남는다). lat/lng가 모든 반경분석의 기준점이 된다.
  lat: number | null;
  lng: number | null;
  roadAddress: string | null; // 정규화된 도로명주소
  jibunAddress: string | null; // 지번주소
  buildingName: string | null;
  geocodedAt: number | null; // 조회일시 (지도에서 마커를 수동 보정한 경우도 갱신)
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
  floating500_10s: number | null;
  floating500_20s: number | null;
  floating500_30s: number | null;
  floating500_40s: number | null;
  floating500_50s: number | null;
  floating500_60plus: number | null;

  // 2026-08-27 — 인허가 PC방업소수(500m/1km)는 삭제했다(사용자 확인: 계산에도 안 쓰이고
  // 소상공인365 자동추출이라 직접 검증도 안 된 값이라 "실영업"만 남기면 충분함). 실영업(직접
  // 확인해서 입력)은 500m이 경쟁IP 계산의 핵심값이라 그대로 둔다.
  operatingPcStores500m: number | null; // 실영업_PC방업소수_500m

  // 2026-08-24 (2단계) 추가 — 소상공인365 상권분석 원본에서만 채울 수 있는 항목(공식 API 없음,
  // 반자동 업로드-추출 전용, /store-eval/candidates 상권자료 자동화 참고). 위 500m 값은 기존과
  // 동일하게 calc.ts(computeFloatingRawDemand/computeCompetitorIp)가 읽지만, 이 블록의 직장/시설
  // 항목은 전부 참고자료일 뿐이다 — calc.ts 어떤 함수도 이 아래 필드를 읽지 않는다(기존 V62
  // 산식·계수 불변 원칙, 사용자 요청사항).
  commercialDataYearMonth: string | null; // 상권_기준연월
  businessCountAsOfDate: string | null; // 업소수_기준시점
  operatingPcStores1km: number | null;

  employ500Total: number | null; // 직장500_전체
  employ500Male: number | null;
  employ500Female: number | null;
  employ1kmTotal: number | null;
  employ1kmMale: number | null;
  employ1kmFemale: number | null;

  // 2026-08-27 — 유동인구(1km)·세대수·학생수는 삭제했다(사용자 확인): 유동인구1km은 반경이 넓어
  // 실제 상권 밖 유동인구까지 잡혀서 애초에 수요 계산에 못 쓰고, 세대수·학생수는 이미 쓰는
  // 인구수(pop500m/pop1km/age1km_*)와 중복이라 앞으로도 쓸 일이 없다고 판단했다. 면적(area1kmKm2)·
  // 직장인구·지하철승하차는 나중에 산식을 보강할 때 쓸 여지가 있어 남겨둔다.
  facility500SubwayRiders: number | null; // 시설500_지하철승하차
  facility1kmSubwayRiders: number | null;

  // 자사 시설/사양 (경쟁력 점수 입력)
  // 2026-08-27 추가 — 사양점수 산식을 VGA70%+모니터30%에서 CPU/VGA/RAM/모니터 4항목 평균으로
  // 바꾸면서, 경쟁점(cpu/ram 필드 있음)과 같은 기준으로 자사도 평가하려면 필요해졌다.
  // 2026-08-28 (2차) — 한 매장에 여러 사양이 섞여 있을 때(대부분 기본급, 일부 좌석만 상위급)를
  // 반영하기 위해 GPU/CPU는 기본+특화 2단계, RAM은 기본+특화 1단계로 늘렸다(calc.ts
  // combineHardwareTiers: 기본80%+특화들 균등분배20%). 시트 컬럼도 "자사_VGA_기본/특화1/특화2"
  // 식으로 실제 존재한다(cronSync.ts).
  ownCpu: string | null; // CPU 기본
  ownCpuTop1: string | null;
  ownCpuTop2: string | null;
  ownRam: string | null; // RAM 기본
  ownRamTop: string | null;
  ownVgaBase: string | null;
  ownVgaTop: string | null; // VGA 특화1
  ownVgaTop2: string | null;
  // 2026-08-28 (3차) — 그동안 "1인석"(칸막이·듀얼모니터만 있는 개방형 좌석)과 "1인룸"(벽으로
  // 막힌 독립 공간)이 시트에서 구분 안 됐는데, 사용자가 "자사_1인석" 컬럼을 새로 추가하며
  // 분리했다. 좌석·존구성 rubric의 "칸막이만 있으면 독립룸 미인정" 원칙과 일치시켜, 1인석은
  // 참고용으로만 기록하고 좌석점수 자동계산(computeZoneComposition)에는 넣지 않는다(어차피
  // 좌석점수는 이제 수동 rubric 입력이라 참고자료일 뿐).
  ownSingleSeatCount: number | null; // 1인석(개방형, 독립룸 아님)
  ownRoom1: number | null; // 1인룸(벽으로 막힌 독립 공간)
  ownRoom2: number | null; // 2인룸
  ownTeamRoom: number | null;
  ownCoupleZone: number | null;
  ownVipZone: number | null;
  ownFriendsZone: number | null;
  // 2026-08-30 추가 — 팀룸처럼 룸 형태지만 안에 파우더룸이 있고 한 방에 약 10좌석이 들어가는
  // 고급 컨셉존("퍼스트클래스존", 지금은 신규 출점에 안 씀 — 과거 매장 평가용). 자동 산식에는
  // 안 쓴다(좌석·존구성 점수는 이미 rubric 직접입력) — 평가자가 인테리어평가 점수를 매길 때
  // 참고하는 원본 사실 기록용이다(사용자 확인).
  ownFirstClassZone: number | null;
  // 경쟁력점수 4개 구성요소(2026-08-28 전면개편: 하드웨어30%+인테리어·좌석·관리40%+먹거리20%+
  // 입지10%) 중 하드웨어/입지는 원본 Apps Script(점포평가.gs)가 VGA·층수+엘리베이터로부터 자동
  // 계산하는 값이라(CANDIDATE_AUTO) 여기 CandidateInput에는 없다 — calc.ts의
  // computeSpecScore/computeLocationScoreFromFacts로 매번 파생하고 CandidateComputed에 결과를
  // 담는다. 먹거리/인테리어(좌석·관리 포함)는 평가자가 rubric표를 보고 직접 1~5점을 입력하는
  // 항목이라 그대로 둔다.
  ownFoodScore: number | null; // 1~5 - 먹거리 브랜드가 "브랜드없음"이거나 안 정했을 때 쓰는 직접입력값(폴백)
  ownInteriorScore: number | null; // 1~5 - 아래 세부항목(좌석·존구성/최신성/청결관리/편의성)을 하나도
  // 안 채웠을 때 쓰는 종합 직접입력값(폴백)
  // 2026-08-28 (2차) — 모니터도 이제 GPU/CPU처럼 모델텍스트(주사율 Hz)에서 자동채점한다
  // (calc.ts scoreFromMonitor/scoreFromMonitorSpec) — 예전엔 사람이 1~5점을 직접 입력했다.
  ownMonitorBase: string | null;
  ownMonitorTop: string | null;

  // 2026-08-27 추가 — 먹거리 1점 차이로 예상매출이 크게 흔들린다는 지적(사용자 확인)에 따라, "조사자
  // 감으로 1~5점 찍기" 대신 실제로 매장이 쓰는 먹거리 브랜드를 기준으로 점수를 매긴다(최신 PC방은
  // 조리방식이 다 인덕션 등으로 비슷해 조리방식 자체는 변별력이 없다는 판단, 사용자 확인). 브랜드별
  // 점수는 settings.foodBrandScores에서 읽는다(calc.ts computeFoodScore). "브랜드없음"이거나 안
  // 정했으면 위 ownFoodScore 직접입력값(조사자 판단 또는 점포개발자 의견)을 그대로 쓴다.
  ownFoodBrand: FoodBrand | null;
  // 2026-08-28 전면개편 — "인테리어·좌석구성·관리"(경쟁력점수의 40%)를 세부항목 4개의 가중평균으로
  // 정교화한다(좌석·존구성50%+최신성·디자인25%+청결·관리상태15%+냄새·조명·화장실·편의성10%,
  // calc.ts computeInteriorSeatManagementScore). 좌석·존구성은 팀룸/커플존/2인룸 등 존 개수를
  // 세는 자동계산이 아니라, 평가자가 rubric표(칸막이만 있는 좌석은 독립룸 미인정 등)를 보고 직접
  // 판단해 0.5점 단위로 입력한다(먹거리와 같은 이유 — 조사서 표현마다 사람 판단이 필요해 자동화가
  // 어렵다). 하나라도 채우면 가중평균을 쓰고, 넷 다 비어 있으면 위 ownInteriorScore 직접입력값을
  // 그대로 쓴다. 최신성·청결관리는 기존 세부항목(ownInteriorLevelScore/ownInteriorConditionScore)을
  // 그대로 재사용한다.
  ownSeatZoneScore: number | null; // 좌석·존구성(팀룸·커플존·1인룸 등 특화존 종류/완성도, rubric 기반)
  ownInteriorLevelScore: number | null; // 최신성·디자인
  ownInteriorConditionScore: number | null; // 청결·관리상태
  ownComfortScore: number | null; // 냄새·조명·화장실·편의성

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
  ownSpecScore: number | null; // 자사_점수_하드웨어 (GPU40%+모니터25%+CPU20%+RAM15%, computeSpecScore)
  // 2026-08-28 — 좌석은 더 이상 독립 배점이 아니다(인테리어 항목의 세부 50%로 흡수,
  // computeInteriorSeatManagementScore) — 이 타입 자체가 실제로는 안 쓰이는 문서용이라(바로
  // 아래 주석 참고) ownSeatScore 필드는 그냥 제거한다.
  ownLocationScore: number | null; // 자사_점수_입지 (층수+엘리베이터, computeLocationScoreFromFacts)
  ownCompetitivenessScore: number | null; // 자사_경쟁력점수 (BM) = 하드웨어30%+인테리어·좌석·관리40%+먹거리20%+입지10% 가중합
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
  // 2026-08-27 삭제 — 주소는 자동입력(카카오 수집·붙여넣기 파서 둘 다 항상 null)되는 값이 없어
  // 항상 사람이 직접 타이핑해야 했는데 실제로 거의 안 채워졌다(사용자 확인) — distanceM(자동
  // 계산)이 이미 "얼마나 가까운지"를 알려주니 굳이 주소까지 몰라도 됨.
  distanceM: number | null;
  floor: number | null;
  groundLevel: GroundLevel | null;
  totalPcCount: number | null; // 전체대수 (실사값)
  appliedPcCount: number | null; // 적용대수 - 실사값 없으면 대체값(§3.2)을 조사 후 여기 채운다
  hasElevator: boolean | null;
  // 2026-08-28 (2차) — CandidateInput.ownCpu 등과 동일 이유로 기본+특화 다단계로 늘렸다
  // (calc.ts combineHardwareTiers). monitor는 monitorBase로 이름을 바꿨다(다른 항목과 Base/Top
  // 네이밍 통일 — cronSync가 매번 문서를 전체 재구성하므로 마이그레이션 이슈 없음).
  cpu: string | null; // CPU 기본
  cpuTop1: string | null;
  cpuTop2: string | null;
  vgaBase: string | null;
  vgaTop: string | null; // VGA 특화1
  vgaTop2: string | null;
  ram: string | null; // RAM 기본
  ramTop: string | null;
  monitorBase: string | null;
  monitorTop: string | null;
  ratePer1000Won: number | null; // 1000원당분
  hourlyRateConverted: number | null; // 시간당환산요금
  paidDeduction: string | null; // 유료차감
  // 2026-08-30 — 05_경쟁점정보에서 방문일시/방문요일/이용객수/실측착석률 컬럼을 삭제했다(예측
  // 계산에 안 쓰임, 사용자 확인). 필드 자체는 웹에서 수동입력용으로 남기고, cronSync.ts는 이제
  // 이 넷을 시트에서 읽지 않는다(값을 계속 null로 덮어쓰지 않기 위함).
  visitedAt: string | null;
  visitedDow: string | null;
  visitorCount: number | null;
  measuredSeatRate: number | null;
  pingbotUtilization: number | null; // 핑봇_가동률
  pingbotPeriod: string | null;
  renovationYear: number | null;
  // 하드웨어/입지 점수는 CandidateInput과 같은 이유로 자동 계산(계산결과는 저장하지 않고
  // calc.ts의 computeSpecScore/computeLocationScoreFromFacts로 매번 파생한다). 먹거리/인테리어
  // (좌석·관리 포함)는 조사자가 rubric표를 보고 1~5점을 직접 입력한다.
  foodScore: number | null; // 1~5 - 먹거리 브랜드가 "브랜드없음"이거나 안 정했을 때 쓰는 직접입력값(폴백)
  foodBasis: string | null;
  interiorScore: number | null; // 세부항목(좌석·존구성/최신성/청결관리/편의성)을 하나도 안 채웠을 때 쓰는 종합 직접입력값(폴백)
  interiorBasis: string | null;
  monitorBasis: string | null;
  // 2026-08-27 추가 — CandidateInput.ownFoodBrand/ownInteriorLevelScore 등과 같은 이유/규칙(선택
  // 항목). calc.ts computeFoodScore/computeInteriorSeatManagementScore 참고.
  foodBrand: FoodBrand | null;
  interiorLevelScore: number | null; // 최신성·디자인
  interiorConditionScore: number | null; // 청결·관리상태
  // 2026-08-28 전면개편 — CandidateInput.ownSeatZoneScore/ownComfortScore와 동일.
  seatZoneScore: number | null; // 좌석·존구성(rubric 기반 직접입력)
  comfortScore: number | null; // 냄새·조명·화장실·편의성
  // 2026-08-30 추가 — CandidateInput.ownSingleSeatCount와 동일(1인석 vs 1인룸 구분). 05_경쟁점정보에
  // "1인석" 컬럼이 새로 생겨 room1(1인룸, 독립공간)과 분리해서 받는다.
  singleSeatCount: number | null; // 1인석(개방형, 독립룸 아님)
  room1: number | null;
  room2: number | null;
  teamRoom: number | null;
  coupleZone: number | null;
  // 2026-08-24 추가 — 카카오 Local API로 자동수집된 PC방 경쟁점 표시용(선택 필드, 기존 수동입력
  // 경쟁점엔 없음/null). lat/lng은 자동수집분만 채워지며, V62 계산 어디에도 쓰이지 않는다
  // (경쟁력 산식은 여전히 실사값 기반 필드만 읽는다).
  source?: "kakao" | "manual" | null;
  sourcePlaceId?: string | null; // 카카오 장소 id — 재수집 시 중복 방지 키
  lat?: number | null;
  lng?: number | null;
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
  // AA 기준매출 — 08_계산기준!C54:E65 "AA 월별기준"을 그대로 옮긴 표(순수익 2,000만원 대당). month는 1~12.
  aaMonthlyTargets: { month: number; dailyRevenuePerPcTarget: number; daysInMonth: number }[];
  // 2026-08-27 추가 — 사용자가 준 "순수익 1,000만원 대당목표(일)" 표(2,000만원 표와 같은 원본 시트
  // 구조, 실측치). 1,500만원은 별도 원본표가 없어 2,000만원/1,000만원 월별 값의 단순평균으로
  // 계산한다(settings.ts defaultModelSettings 참고, 지어낸 계수 아님 — 사용자가 준 두 실측표의
  // 산술평균).
  aaMonthlyTargets1000: { month: number; dailyRevenuePerPcTarget: number; daysInMonth: number }[];
  aaMonthlyTargets1500: { month: number; dailyRevenuePerPcTarget: number; daysInMonth: number }[];
  aaMaxPcCount: number; // 100 — MIN(예상PC대수,100)
  // 08_계산기준의 상권/경쟁력 계수 (하드코딩 금지 대상)
  marketCharacterThreshold: { downtown: number; mixed: number }; // 8배/4배
  marketDemandEffectiveRate: { downtown: number; mixed: number; residential: number }; // 0.53/0.61/0.78
  // 2026-08-27 (2차) — 상대평가(상위10/30/60% 백분위)에서 절대평가로 바꿨다(사용자 확정, calc.ts
  // computeMarketGrade 주석 참고). 값은 그 상대평가가 쓰던 실제 경계값을 반올림한 고정 금액이다.
  marketGradeAbsoluteThresholds: { SS: number; S: number; A: number };
  // 2026-08-28 전면개편 — 기존 "사양25%+좌석30%+먹거리20%+인테리어15%+입지10%" 5분류를
  // "하드웨어30%+인테리어·좌석·관리40%+먹거리20%+입지10%" 4분류로 재편했다(사용자 확정).
  // 좌석·존구성은 더 이상 독립 배점이 아니라 interiorWeights.seatZone(40%의 세부 50%)으로
  // 흡수됐다. 입지는 "예상수요점유율" 쪽 수요중복도와 중복 반영을 최소화하려고 의도적으로 10%만
  // 유지한다(수요중복도 자체는 아직 범위 밖, 후속 과제).
  competitivenessWeights: { spec: number; food: number; interior: number; location: number };
  // 2026-08-27 추가 — 먹거리 점수를 조사자 감이 아니라 실제 사용 브랜드 기준으로 매기기 위한
  // 브랜드별 점수표(calc.ts computeFoodScore). "브랜드없음"은 표에 없다 — 그 경우 직접입력값을
  // 그대로 쓴다. 기본값은 사용자가 확정한 실측치가 아니라 임의 초안이라 설정 화면에서 조정한다.
  foodBrandScores: Record<Exclude<FoodBrand, "브랜드없음">, number>;
  // 2026-08-28 전면개편 — 하드웨어점수(옛 "사양점수") 내부비중을 GPU40%/모니터25%/CPU20%/RAM15%로
  // 재확정했다(사용자 제공 기준표). scoreFromVga/scoreFromCpu/scoreFromRam의 앵커값도 블랙라벨
  // 현재 표준(RTX5060·울트라5 225F·16GB=각 4점) 기준으로 같이 재보정했다(calc.ts 주석 참고).
  // 주변기기(마우스/키보드/헤드셋)는 이번 기준표에서 하드웨어 배점 대상이 아니다(사용자 확인).
  specWeights: { vga: number; monitor: number; ram: number; cpu: number };
  // 2026-08-28 신규 — "인테리어·좌석·관리"(경쟁력점수의 40%) 내부비중. 좌석·존구성이 가장
  // 중요하다는 사용자 판단(팀룸·2인룸 등 존 구성이 PC방 선택의 1순위)에 따라 50%로 가장 크게
  // 잡는다(calc.ts computeInteriorSeatManagementScore). 나머지는 최신성·디자인25%+청결·관리
  // 상태15%+냄새·조명·화장실·편의성10%.
  interiorWeights: { seatZone: number; freshness: number; cleanliness: number; comfort: number };
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
  // 2026-08-25 추가 — 운영설정 변경은 즉시 전체 예측값에 영향을 주는 민감한 작업이라 "왜 바꿨는지"를
  // 필수로 남긴다. 기존(이 필드 도입 전) 이력 문서는 null로 남는다(과거 기록을 지어내지 않음).
  reason: string | null;
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

// 2026-08-25 추가 — "적용된 산식과 계수 보기"가 학습표본 부족시 쓰는 폴백 회귀식만 설명하고
// 있었는데(2026-08-20부터 실제로는 학습된 모형을 우선 쓰도록 바뀐 뒤에도 그대로 방치됨), 정작
// 지금 대부분의 후보지가 쓰는 학습모형 쪽은 화면에 아무 설명이 없어 사용자가 "예상매출이 어떻게
// 나온건지 이해가 안 된다"고 확인함. 이 값들은 predictEmpiricalRevenue/fitEmpiricalRevenueModel이
// 이미 계산하는 중간값을 그대로 노출한 것뿐이다(calc.ts 참고) — 화면이 실제 산식을 실제 숫자로
// 따라갈 수 있게 한다. v61IsFallback=true(학습표본 부족)일 때는 null.
export type V61TrainedModelExplain = {
  sampleCount: number;
  featureLabels: string[]; // ["시간당요금", "상권수요/PC대수", "경쟁IP/PC대수", "경쟁력점수"] (2026-08-30 개편)
  featureRealValues: number[]; // 사람이 읽는 실제값(요금 원, 수요/PC 명, 경쟁력점수)
  featureModelValues: number[]; // 학습에 실제로 들어간 값(요금·수요/PC는 로그 변환됨) = empiricalFeaturesFor 결과
  featureMeans: number[]; // featureModelValues 기준 학습표본 평균
  featureSds: number[]; // featureModelValues 기준 학습표본 표준편차
  featureZValues: number[]; // 표준화값 = (featureModelValues - featureMeans) / featureSds
  coefficients: number[]; // 학습된 가중치(비음수 릿지회귀라 항상 0 이상)
  yMean: number; // 학습표본의 log(대당월매출) 평균
  logPerPc: number; // yMean + Σ(표준화값 × 가중치)
  ridgeRevenue: number; // exp(logPerPc) × 예상PC대수 = 회귀예측 매출
  perPcMedian: number; // 기준모형 대당월매출(학습표본 중앙값)
  baselineRevenue: number; // perPcMedian × 예상PC대수 = 기준모형 매출
  ridgeWeight: number; // 회귀예측 반영비율
  baselineWeight: number; // 기준모형 반영비율
  pcCount: number; // 예상PC대수 (ridgeRevenue/baselineRevenue 계산에 쓰인 값, 화면 표시용)
};

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
  v61TrainedModelExplain: V61TrainedModelExplain | null; // 학습모형 사용 시(v61IsFallback=false)에만 채워짐
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
  // 2026-08-25 추가 — 다우오피스 평가기록 보고서 초안(§경쟁 섹션)에서 "자사 vs 경쟁점 평균
  // 경쟁력"을 그대로 보여주려면 격차(competitivenessGap)만으로는 부족하다. evaluate.ts는 이미 이
  // 두 값을 계산하고 버렸었는데(CandidateComputed 타입에만 정의되고 실제로는 안 쓰임), 새 값을
  // 만드는 게 아니라 이미 계산된 값을 노출하는 것뿐이라 여기에 추가한다.
  ownCompetitivenessScore: number | null; // 자사_경쟁력점수
  competitorAvgCompetitiveness: number | null; // 경쟁점_평균경쟁력
  // 2026-08-25 추가 — 다우오피스 보고서 종합의견에 "상권수요 X명 중 Y명 확보 예상" 근거 문장을
  // 넣으려면 필요하다. computeExpectedOwnDemand(예측_자사수요)는 V61 학습 특징치(log(자사수요/PC))
  // 계산에 이미 쓰이던 값이라 evaluate.ts가 계산만 하고 버렸었다 - 새 계산이 아니라 노출만 추가.
  expectedOwnDemand: number | null; // 예측_자사수요 (상권수요 × 경쟁력격차 기반 점유율)
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
    notYetOpen: number; // 오픈예정이라 실측이 원천적으로 불가능해 제외된 수(완결성 경고 대상 아님)
  } | null;
  demandCaptureRate: number | null; // 예상 수요확보율 (경쟁력격차 룩업)
  newDemandGrowthRate: number | null; // 신규수요 증가율 (경쟁력격차 룩업)
  expectedOccupiedSeats: number | null; // 예상 평균가동좌석 = 실가동좌석×확보율×(1+증가율)
  expectedUtilization: number | null; // 예상 가동률 = 예상평균가동좌석 ÷ 예상PC대수 (100% 초과 가능 — 수요초과 신호)
  expectedDailyRevenuePerPc: number | null; // 예상 대당 일매출
  measuredForecastMonthlyRevenue: number | null; // 실측기반 예상월매출
  // 2026-08-27 추가 — V62 최종예상월매출을 같은 공식으로 거꾸로 풀어낸 가동률(경쟁점 실측 데이터
  // 품질에 영향받지 않음, computeImpliedUtilizationFromRevenue 참고).
  v62ImpliedUtilization: number | null;
  measuredForecastNeedsReview: boolean; // 예상가동률이 최대검토가동률을 넘어 "데이터 재검토" 대상인지

  // 요청사항 4 — AA 기준매출(오픈월부터 10개월 순수익 2,000만원 대당 일매출목표 평균)
  aaBaselineRevenue: number | null;
  // 2026-08-27 추가 — 1,500만원/1,000만원 기준매출(같은 계산, 다른 월별표). aaBaselineRevenue는
  // 계속 2,000만원 기준을 가리킨다(기존 화면 문구 "AA 기준매출"과의 연결 유지).
  aaBaselineRevenue1500: number | null;
  aaBaselineRevenue1000: number | null;
  // 2026-08-27 — 원래 이 판정은 AA경로(실측기반 예상월매출, 경쟁점 핑봇 실측 기반)를 기준선과
  // 비교했었다. 실사례(하안금당사거리점)에서 V62(정식 계산)는 7,300만원으로 아주 좋은데 AA경로가
  // 경쟁점 핑봇 데이터 부족(3곳 중 2곳 누락)으로 3,000만원까지 낮게 나와 "1,000만원 미달"이라는
  // 잘못된 경고가 떴다 — AA경로 평균오차가 52%(다른 검증에서 확인)라 근거 자체가 부실했다.
  // 그래서 이 판정도 V62 최종예상월매출을 기준으로 바꿨다(사용자 확정) — "데이터 재검토"
  // 상태(AA경로 가동률 초과 감지용)는 더 이상 이 판정에 안 쓰여서 없앴다.
  aaJudgement:
    | "오픈월 입력 필요"
    | "실측자료 부족"
    | "2,000만원 이상"
    | "1,500만원 이상"
    | "1,000만원 이상"
    | "1,000만원 미달"
    | null;
};

// ---- 기존 가맹점 검증 (6.기존 가맹점 검증 화면) ----
export type ExistingStore = {
  storeCode: string; // 가맹점코드
  storeName: string;
  pcCount: number | null; // 현재 실제 운영 대수(오픈 후 좌석 추가 등으로 바뀔 수 있음)
  // 01_점포기본정보!평가기준_PC대수 - 오픈 초기(실제매출 학습표본 산정 시점) 대수. 오픈 후
  // 좌석을 늘린 매장은 pcCount(현재값)로 대당매출을 나누면 실제보다 낮게 계산돼 학습이
  // 왜곡된다(2026-08-22, 사용자 확인). V61 학습·리브원아웃 예측에서는 이 값이 있으면
  // pcCount 대신 이 값을 쓴다. null이면(대부분 매장, 오픈 후 대수 변경 없음) pcCount로 폴백.
  evaluationPcCount: number | null;
  floor: number | null;
  groundLevel: GroundLevel | null;
  openedAt: string | null;
  franchiseStatus: string | null; // 가맹상태
  excludedFromModel: boolean; // 산식학습제외 (01_점포기본정보 CO열)
  excludedReason: string | null; // 학습제외사유 (CP열)
  // 참고용(비교 대상) — 원본 스프레드시트 "V61 기본예측(참고)" 캐시값. 웹은 이 값을 그대로 쓰지
  // 않고 v61Training 특징치로 매번 다시 학습·검증한다(아래 세 필드 + actualMonthlyRevenueAvg).
  v61Predicted: number | null;
  // 04_점포평가요약!X열(상권수요) - 2026-08-27 (2차)까지는 신규후보지 상권등급(SS/S/A/B) 백분위
  // 계산의 비교 모집단으로 썼으나, 절대평가로 바뀌면서(calc.ts computeMarketGrade 주석 참고) 더
  // 이상 계산에 쓰이지 않는다 — 참고용 스냅샷으로만 남겨둔다.
  referenceMarketDemand: number | null;

  // 2026-08-20 추가 — V61 실측 학습모형(비음수 릿지회귀)의 학습 특징치.
  // 01_점포기본정보/04_점포평가요약에서 그대로 가져온다(추정하지 않음). 이 넷이 모두 있고
  // brandType=블랙라벨·franchiseStatus=정상·excludedFromModel=false인 점포만 학습 대상이다.
  brandType: BrandType | null; // 09_입지동선평가!P열(브랜드구분) — 블랙라벨만 학습에 사용
  validationUse: "사용" | "제외" | null; // 04_점포평가요약!검증사용여부 (참고용 - 최종 필터는 위 3조건으로 직접 판정)
  hourlyRate: number | null; // 01_점포기본정보!자사_요금표_시간당
  ownDemand: number | null; // 04_점포평가요약!예측_자사수요 (점유율 적용 후 값 — 표시용, 2026-08-30부터 학습 특징치로는 안 씀)
  // 2026-08-30 추가 — ownDemand(marketDemand÷(자사+경쟁IP) 나눈 값)의 실제매출 상관계수가 거의
  // 0(-0.02)이라 릿지회귀가 계수를 0으로 눌러버려 점유율 산식이 예측에 전혀 기여를 못 했다
  // (사용자와 진단, 릿지 계수 직접 확인으로 발견). "경쟁점이 많으면 나눠서 깎는다"는 가정 자체가
  // 틀렸을 수 있다 — 실측 상관은 오히려 양(+0.25, 경쟁이 많은 곳=상권 자체가 큰 곳). 그래서
  // marketDemand(나누기 전 원수요)와 competitorIp(경쟁강도)를 분리된 별도 특징치로 넣어 회귀가
  // 직접 부호·가중치를 학습하게 한다(calc.ts empiricalFeaturesFor). ownDemand는 화면 표시용으로
  // 그대로 유지.
  marketDemand: number | null; // computeExistingStoreDemandEvaluation 결과 그대로 캐시(점유율 적용 전 원수요)
  competitorIp: number | null; // computeExistingStoreDemandEvaluation 결과 그대로 캐시(경쟁IP)
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
  ownCpu: string | null; // 2026-08-27 추가 - CandidateInput.ownCpu와 동일
  ownCpuTop1: string | null;
  ownCpuTop2: string | null;
  ownRam: string | null;
  ownRamTop: string | null;
  ownVgaBase: string | null;
  ownVgaTop: string | null;
  ownVgaTop2: string | null;
  // 2026-08-28 (3차) — CandidateInput.ownSingleSeatCount와 동일(1인석 vs 1인룸 구분).
  ownSingleSeatCount: number | null;
  ownRoom1: number | null;
  ownRoom2: number | null;
  ownTeamRoom: number | null;
  ownCoupleZone: number | null;
  ownVipZone: number | null;
  ownFriendsZone: number | null;
  // 2026-08-30 추가 — 팀룸처럼 룸 형태지만 안에 파우더룸이 있고 한 방에 약 10좌석이 들어가는
  // 고급 컨셉존("퍼스트클래스존", 지금은 신규 출점에 안 씀 — 과거 매장 평가용). 자동 산식에는
  // 안 쓴다(좌석·존구성 점수는 이미 rubric 직접입력) — 평가자가 인테리어평가 점수를 매길 때
  // 참고하는 원본 사실 기록용이다(사용자 확인).
  ownFirstClassZone: number | null;
  ownFoodScore: number | null;
  ownInteriorScore: number | null;
  // 2026-08-28 (2차) — 모니터도 GPU/CPU처럼 모델텍스트(주사율 Hz) 자동채점으로 전환.
  ownMonitorBase: string | null;
  ownMonitorTop: string | null;
  // 2026-08-27 추가 — CandidateInput과 동일(계산 함수 하나 공유). computeExistingStoreMeasuredForecast에서만
  // 쓰이고, 얼려둔 competitivenessScore/ownDemand 스냅샷 자체는 바뀌지 않는다.
  ownFoodBrand: FoodBrand | null;
  ownInteriorLevelScore: number | null;
  ownInteriorConditionScore: number | null;
  // 2026-08-28 전면개편 — CandidateInput.ownSeatZoneScore/ownComfortScore와 동일.
  ownSeatZoneScore: number | null;
  ownComfortScore: number | null;
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
  floating500_10s: number | null;
  floating500_20s: number | null;
  floating500_30s: number | null;
  floating500_40s: number | null;
  floating500_50s: number | null;
  floating500_60plus: number | null;
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

// ---- 상권자료 자동수집 1단계(2026-08-24) ----
// "행정구역 참고자료" — SGIS 행정동 단위 공식 API로 완전자동 수집되는 값. 원본 요청사항의
// 핵심 경고: 이 값들은 반경(500m/1km) 통계가 아니므로 pop500m/pop1km/age1km_* 같은 V62 계산
// 입력칸에 절대 넣지 않는다. calc.ts의 어떤 함수도 이 컬렉션을 읽지 않는다 — 화면에 참고용으로만
// 표시한다.
export type AdminDongReference = {
  candidateCode: string;
  admCd: string; // 행정구역 코드
  admName: string; // 행정구역명
  totalPopulation: number | null;
  malePopulation: number | null;
  femalePopulation: number | null;
  year: number | null; // 기준연도
  fetchedAt: number; // 조회일시
};

// 경쟁점(PC방)이 아닌 수요거점 — 지하철역/버스정류장/학교/대학/아파트단지/대형상업시설/
// 먹자상권/군부대/산업단지/관광유흥. PC방은 기존 Competitor 스키마(투자상태 워크플로가 이미
// 있음)에 그대로 편입하고, 여기엔 넣지 않는다.
export type DemandPointCategory =
  | "지하철역"
  | "버스정류장"
  | "학교"
  | "대학"
  | "아파트단지"
  | "대형상업시설"
  | "먹자상권"
  | "군부대"
  | "산업단지"
  | "관광유흥";

export type DemandPoint = {
  id: string;
  candidateCode: string;
  name: string;
  category: DemandPointCategory;
  lat: number;
  lng: number;
  distanceM: number; // 확정좌표 기준 직선거리(하버사인) — 도보거리는 이번 단계 범위 밖
  source: "kakao"; // 자동수집 출처 (사실값 자동생성이 아니라 카카오 응답을 그대로 옮긴 것)
  sourcePlaceId: string | null; // 카카오 장소 id — 재수집 시 중복 제거 키
  fetchedAt: number;
  confirmed: boolean; // 사용자가 화면에서 확인했는지
};

// ---- 상권자료 자동수집 2단계(2026-08-24) — SGIS/소상공인365 반자동 업로드-추출 ----
// 공식 API가 없어 사람이 각 사이트에서 직접 조회한 원본(엑셀/CSV/붙여넣기 표)을 업로드하면,
// 클라이언트에서 결정적 라벨매칭으로 값을 추출한다(AI가 숫자를 만들어내지 않는다는 원칙 유지).
// 업로드마다 이 기록을 남겨 "어느 파일에서 언제 뽑은 값인지" 추적한다(요청사항 4장 "SGIS 원본자료마다
// 저장" 항목).
export type MarketDataSourceType = "sgis_life_area" | "sosangongin365";

export type ExtractedFieldRecord = {
  fieldKey: string; // CandidateInput 필드명 (예: "pop500m")
  matchedLabel: string | null; // 원본에서 매칭된 라벨 텍스트 (매칭 실패 시 null)
  rawValue: string | null; // 원본 셀/텍스트 그대로
  parsedValue: number | string | null; // 파싱된 값
  autoExtracted: boolean; // 라벨매칭으로 자동 인식됐는지
  userEdited: boolean; // 사용자가 추출값을 직접 고쳤는지
  applied: boolean; // 실제로 후보지 필드에 반영했는지
};

export type MarketDataUpload = {
  id: string;
  candidateCode: string;
  sourceType: MarketDataSourceType;
  coordAtUpload: { lat: number; lng: number } | null; // 업로드 시점 후보지 확정좌표(기준점 추적용)
  fileName: string | null; // 붙여넣기 표를 썼으면 null
  fileHash: string | null; // 원본파일 SHA-256 (재추출/대조용)
  pastedTable: boolean; // 파일 업로드 대신 표 붙여넣기를 썼는지
  extractedFields: ExtractedFieldRecord[];
  uploadedAt: number;
  uploadedBy: string | null;
};
