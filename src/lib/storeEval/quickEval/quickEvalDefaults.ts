// ⭐ 주소만 초기평가 도구의 **재고 표** — 무엇을 자동으로 채우고 무엇을 기본값으로 메웠나.
//
// ── 이 파일이 존재하는 이유 ───────────────────────────────────────────────
// 자동화하면 자료의 함정이 **그대로 결재 숫자로 들어간다**(인계문 4절). 지금은 사람이
// 중간에 있어서 걸러지는데, 도구가 숫자만 내놓으면 그게 사라진다. 그래서 값마다
// "어디서 왔나 / 못 구하면 무엇으로 메웠나"를 **한 곳에** 두고, 화면과 AI 평가문이
// 여기서 읽어 그린다.
//
// ⚠️ CLAUDE.md 규칙: **설명하는 자리에 숫자를 글자로 박지 않는다.** 화면에 "90대"라고
//    타이핑하지 말고 이 표를 읽어라. 계수가 바뀌면 화면이 조용히 거짓말을 하게 된다.
// ⚠️ 여기 적힌 기본값은 **새로 고른 게 아니다.** 운영 V62가 이미 쓰고 있는 값을 가리키기만
//    한다(`DEFAULT_UNSURVEYED_PC_COUNT` 등 실제 상수를 import해서 쓴다).

import { DEFAULT_UNSURVEYED_PC_COUNT } from "../calc";
import type { FoodBrand } from "../types";

/**
 * 자사 먹거리 브랜드 — **고정값**이다. 자사 브랜드라 후보지마다 다를 일이 없어서 입력칸을
 * 없앴다(사용자 확인 2026-09-22: "먹거리 브랜드는 자사니까 어차피 쉐프앤클릭이거든").
 * 점수는 이 값으로 `settings.foodBrandScores`에서 읽는다 — 여기에 점수를 박지 않는다.
 */
export const OWN_FOOD_BRAND: FoodBrand = "쉐프앤클릭";

/** 이 도구가 쓰는 반경. 500m는 V62 산식이 읽는 반경이고(경쟁IP·유동인구), 1km는 주거인구다. */
export const QUICK_EVAL_RADII = { competitor: 500, floating: 500, resident1km: 1000, resident500: 500 } as const;

/** SGIS 주거인구 기준연도. 운영 자료(52곳)를 다시 받을 때 쓴 것과 같은 해로 맞춘다. */
export const SGIS_BASE_YEAR = "2024";

export type DefaultSource = "자동수집" | "기본값" | "사람이 입력" | "AI 판정";

export type QuickEvalFieldNote = {
  /** 화면에 보일 항목명 */
  label: string;
  source: DefaultSource;
  /** 어디서 오나 / 무엇으로 메우나 — 한 줄로 */
  basis: string;
  /** 현장 조사 체크리스트에 올릴 항목인가 */
  needsFieldCheck: boolean;
};

/**
 * ⭐ 도구가 다루는 모든 입력의 출처. 순서가 곧 화면 표의 순서다.
 *
 * 기본값 넷(경쟁점 대수·품질·자사 시설·관리점수)은 **운영 V62 코드에 이미 있는 장치**다.
 * 새로 만든 게 아니라 그 경로로 태우는 것뿐이다(인계문 2절).
 */
export const QUICK_EVAL_FIELD_NOTES: QuickEvalFieldNote[] = [
  {
    label: "좌표(위·경도)",
    source: "자동수집",
    basis: "카카오 주소검색. 못 찾으면 좌표를 지어내지 않고 여기서 멈춘다",
    needsFieldCheck: false,
  },
  {
    label: "주거인구 500m·1km (연령 9구간·남녀)",
    source: "자동수집",
    basis: `SGIS 생활권역 반경조회 ${SGIS_BASE_YEAR}년 기준. 운영 52곳을 대조해 중앙 차이 0.0%였던 그 경로다`,
    needsFieldCheck: false,
  },
  {
    label: "유동인구 500m (일평균·성별·연령)",
    source: "자동수집",
    basis:
      "소상공인365 상권분석 리포트. 최근 12개월 평균이고 성별·연령은 최근월을 그 평균 축척으로 환산한다. " +
      "운영 54곳과 대조해 중앙 비율 1.000(최악 0.98)로 같은 값임을 확인했다(2026-09-22). " +
      "⚠️ 남의 사이트 스크래핑이라 깨질 수 있다 — 실패하면 지어내지 않고 '수집 실패'로 남긴다",
    needsFieldCheck: false,
  },
  {
    label: "경쟁점 목록·거리",
    source: "자동수집",
    basis:
      "카카오 장소검색(PC방) 반경 500m. 격자로 쪼개 부르므로 40건 상한에 안 걸린다. " +
      "오락실·성인업태는 상호 규칙으로 뺀다(제외 이유를 목록에 같이 보여준다)",
    needsFieldCheck: true,
  },
  {
    label: "경쟁점 PC 대수",
    source: "기본값",
    basis:
      `전부 미조사로 두고 운영 V62의 간략_기본대수 ${DEFAULT_UNSURVEYED_PC_COUNT}대를 쓴다. ` +
      "면적→대수 회귀는 소형 구간이 외삽이라(R²=0.679, 표본 61~243대) 아직 못 쓴다",
    needsFieldCheck: true,
  },
  {
    label: "경쟁점 품질(사양·먹거리·인테리어·존구성)",
    source: "기본값",
    basis:
      "전부 빈칸 → 운영 V62가 결측으로 처리해 동급(비율 1)으로 본다. " +
      "⚠️ 대수만 채우고 품질을 비우면 오히려 더 틀린다(측정: 12.57% vs 10.82%) — 조사가 들어오면 둘을 같이 채워라",
    needsFieldCheck: true,
  },
  {
    label: "입지평가(가시성·선점경쟁·상권위치·특수수요·유입제약)",
    source: "AI 판정",
    basis:
      "기존 입지동선평가 AI 초안(Gemini + 웹검색 + 지도)을 그대로 부른다. " +
      "⚠️ 아래 오차표는 가시성을 표본 중앙값으로 고정해서 잰 값이다 — AI 판정의 오차는 아직 안 쟀다",
    needsFieldCheck: true,
  },
  {
    label: "자사 먹거리 브랜드",
    source: "기본값",
    basis:
      `${OWN_FOOD_BRAND} 고정. 자사 브랜드라 후보지마다 다를 일이 없다(사용자 확인 2026-09-22) — ` +
      "입력칸을 없애고 여기서 정한다. 다른 브랜드를 쓸 일이 생기면 정밀 평가에서 고른다",
    needsFieldCheck: false,
  },
  {
    label: "자사 시설 구성(존·좌석)",
    source: "기본값",
    basis: "회사 표준 존 구성(applyStandardOwnFacilityDefaults). 운영 후보지도 비우면 같은 값이 들어간다",
    needsFieldCheck: false,
  },
  {
    label: "자사 관리 점수",
    source: "기본값",
    basis: "가맹점 평균(resolveManagementScores). 후보지는 개점 전이라 QSC 점검 기록이 있을 수 없다",
    needsFieldCheck: false,
  },
  {
    label: "자사 PC대수·시급·층·엘리베이터",
    source: "사람이 입력",
    basis: "조사값이 아니라 **기획값**이다. 점포개발 초기에도 사람이 정한다 — 비우면 재는 대상이 달라진다",
    needsFieldCheck: false,
  },
  {
    label: "예상 오픈월",
    source: "기본값",
    basis:
      "입력칸을 없앴다(사용자 확인 2026-09-22). 비우면 운영 V62가 '평가한 달의 다음 달'로 잡는다" +
      "(resolveBaselineOpenMonth) — 기준매출 계산에만 쓰이고 초기 선별에서는 그 차이가 작다",
    needsFieldCheck: false,
  },
];

/**
 * ⭐ 측정된 오차 — `src/lib/storeEval/_addressOnlyMode.test.ts` (2026-09-22, 정식검증군 38곳).
 * 운영 V62를 그대로 쓰고 **입력 자료만 비워서** 잰 값이다.
 *
 * ⚠️ 이 숫자는 **기존점 38곳**으로 잰 것이다. 후보지에서는 경쟁점 자료가 더 부실해 실제로는
 *    이보다 나쁠 수 있다.
 * ⚠️ 이 도구는 가시성을 AI로 매기므로 L3와 조건이 완전히 같지 않다. 그래서 화면에 "이만큼
 *    틀린다"가 아니라 "이 조건에서 이만큼 틀렸다"로 적는다.
 */
export const ADDRESS_ONLY_ACCURACY = {
  measuredAt: "2026-09-22",
  sampleCount: 38,
  sampleLabel: "기존 가맹점 정식검증군 38곳",
  testFile: "src/lib/storeEval/_addressOnlyMode.test.ts",
  levels: [
    { name: "L0 지금 — 전부 조사됨(정밀 모드)", mape: 0.0883, median: 0.0767, within10: 0.6053, within20: 0.9211 },
    { name: "L1 경쟁점 품질만 기본값", mape: 0.1257, median: 0.125, within10: 0.4211, within20: 0.7895 },
    { name: "L2 + 경쟁점 대수도 기본값", mape: 0.1082, median: 0.0821, within10: 0.6316, within20: 0.8947 },
    { name: "L3 + 입지평가도 없음 ← 주소만", mape: 0.134, median: 0.1158, within10: 0.4737, within20: 0.8684 },
  ],
  /** 화면 머리에 띄울 한 줄 — 이 도구가 서 있는 단계 */
  headlineLevelIndex: 3,
} as const;

/** 초기 모드 숫자를 결재에 쓰지 못하게 화면에 박는 문구(인계문 6-2). */
export const QUICK_EVAL_USAGE_LIMIT =
  "후보 선별·줄 세우기 전용입니다. 결재에는 쓰지 마세요 — 결재 숫자는 [신규후보지]의 정밀 평가로 냅니다.";
