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
import { RIVAL_PC_COUNT_WHEN_UNSURVEYED, RIVAL_TYPICAL_WHEN_UNSURVEYED } from "./buildQuickCandidate";
import type { FoodBrand } from "../types";

/**
 * 자사 먹거리 브랜드 — **고정값**이다. 자사 브랜드라 후보지마다 다를 일이 없어서 입력칸을
 * 없앴다(사용자 확인 2026-09-22: "먹거리 브랜드는 자사니까 어차피 쉐프앤클릭이거든").
 * 점수는 이 값으로 `settings.foodBrandScores`에서 읽는다 — 여기에 점수를 박지 않는다.
 */
export const OWN_FOOD_BRAND: FoodBrand = "쉐프앤클릭";

/** 이 도구가 쓰는 반경. 500m는 V62 산식이 읽는 반경이고(경쟁IP·유동인구), 1km는 주거인구다. */
/**
 * ⭐ 자사 기획값을 **비웠을 때** 쓰는 기본값 (사용자 지시 2026-09-23: "PC대수 안넣으면 기본
 * 100대로 적용되게해주고, 기본요금은 1200원으로"). 입력칸에 옅은 글씨로 "(기본값)"과 함께 보인다.
 * ⚠️ 화면·AI 평가문은 이 상수를 읽어 그린다 — 숫자를 다른 곳에 글자로 박지 마라.
 */
// 2026-09-23 추가 — 층수도 같은 방식으로 비우면 2층(사용자 지시: "층수도 2층 기본값으로").
export const QUICK_EVAL_PLAN_DEFAULTS = { expectedPcCount: 100, hourlyRate: 1200, floor: 2 } as const;

/**
 * ⭐ 입점 가능여부 기준 — 월 예상매출(V62)이 이 값을 **넘으면** "입점 가능" (사용자 지시
 * 2026-09-23: "5500만원 넘으면 가능한 기준임"). 화면 최상단 핵심 카드가 이 값을 읽는다.
 */
export const QUICK_EVAL_ENTRY_THRESHOLD_WON = 55_000_000;

export const QUICK_EVAL_RADII = { competitor: 500, floating: 500, resident1km: 1000, resident500: 500 } as const;

/** SGIS 주거인구 기준연도. 운영 자료(52곳)를 다시 받을 때 쓴 것과 같은 해로 맞춘다. */
export const SGIS_BASE_YEAR = "2024";

/**
 * ⭐ 입력 칸별 **민감도 측정값** (2026-09-22, `_quickEvalSensitivity.test.ts`).
 *
 * 사용자: *"엘베랑 층수 입력하는 게 기대값 딱히 없음"* — 맞는 관찰이었다. 재 보니
 * `computeOwnLocationScore`는 **입지평가가 있으면 층수를 아예 안 본다**(없을 때만 폴백).
 * 도구는 AI 입지평가를 항상 돌리므로 **층·엘리베이터는 V62 계산에 도달하지 못한다.**
 *
 * 그래도 입력은 **남긴다**(사용자 결정 2026-09-22: *"층수 남기고 AI에만 넘기는 쪽으로 해줘"*) —
 * 층수가 닿는 유일한 경로가 **AI의 접근가시성 판정**이고, 가시성은 결과를 크게 움직인다.
 * 대신 화면에 "V62 계산엔 직접 안 들어간다"를 적어 준다. 안 적으면 넣어도 값이 안 바뀌는 걸
 * 보고 "고장났나?" 하게 된다.
 */
export const QUICK_EVAL_INPUT_SENSITIVITY = {
  measuredAt: "2026-09-22",
  testFile: "src/lib/storeEval/_quickEvalSensitivity.test.ts",
  /** 층·지상지하·엘리베이터를 아무리 바꿔도 V62 예상매출이 움직이는 폭 */
  floorDirectEffect: 0,
  /** 가시성 1점 -> 5점일 때의 예상매출 변화 폭 */
  visibilityEffect: { low: -0.165, high: 0.094 },
  /** PC대수 80 -> 130대 */
  pcCountEffect: { low: -0.157, high: 0.294 },
  /** 시급 1000 -> 1800원 */
  hourlyRateEffect: { low: -0.063, high: 0.091 },
} as const;

/**
 * 아래 재고표 문장에 측정값을 **읽어서** 끼우기 위한 것. 숫자를 글자로 박으면 계수가
 * 바뀔 때 설명만 낡는다(CLAUDE.md 규칙 · `project_stale_explanation_pattern`).
 */
const pct = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(digits)}%`;

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
      // 2026-09-23 저녁 정정 — 여기 "90대로 되돌렸다"고 적혀 있었는데 실제 도구는 129대를 쓰고 있었다.
      //    이제 상수를 읽는다.
      `전부 미조사라 1곳당 ${RIVAL_PC_COUNT_WHEN_UNSURVEYED}대로 넣는다(운영 V62 장치 기본값 ${DEFAULT_UNSURVEYED_PC_COUNT}대가 아니다). ` +
      "실측 경쟁점 평균은 129대지만, 카카오 목록엔 소형·노후 매장이 섞여 있다고 보고 낮춰 잡았다(2026-09-23). " +
      "⚠️ 오차는 경쟁점 10곳 이하 상권에서만 재 봤다. " +
      "면적→대수 회귀는 소형 구간이 외삽이라(R²=0.679, 표본 61~243대) 아직 못 쓴다",
    needsFieldCheck: true,
  },
  {
    label: "경쟁점 품질(사양·먹거리·인테리어·존구성)",
    source: "기본값",
    basis:
      `실측 대표 사양(${RIVAL_TYPICAL_WHEN_UNSURVEYED.cpu} · ${RIVAL_TYPICAL_WHEN_UNSURVEYED.vgaBase})에 ` +
      `먹거리·인테리어·관리 ${RIVAL_TYPICAL_WHEN_UNSURVEYED.foodScore}점으로 채운다(2026-09-23 저녁 3 -> 2.5). ` +
      "⚠️ 빈칸으로 두면 동급이 아니라 경쟁점을 **약하게** 매긴다(점수 2.448 대비 1.921) — 그래서 비우지 않는다. " +
      "⚠️ 대수만 채우고 품질을 비우면 오히려 더 틀린다(측정: 12.57% vs 10.82%) — 조사가 들어오면 둘을 같이 채워라",
    needsFieldCheck: true,
  },
  {
    label: "입지평가(가시성·선점경쟁·상권위치·특수수요·유입제약)",
    source: "AI 판정",
    basis:
      "기존 입지동선평가 AI 초안(Gemini + 웹검색)을 그대로 부른다. **입력한 층·엘리베이터를 사실로 함께 넘겨** " +
      "접근가시성에 반영시킨다(2026-09-22 — 그전엔 AI가 층수를 모른 채 매겼다). " +
      "⚠️ 아래 오차표는 가시성을 표본 중앙값으로 고정해서 잰 값이라 **AI 채점의 오차는 안 들어 있다.** " +
      "⛔ 그걸 재는 건 **하지 않기로 했다**(사용자 결정 2026-09-23: *\"AI채점오차있다하더라도 다른 " +
      "선택지없어서 그냥 측정안하는걸로하자\"* · *\"모델을 바꾸긴어려워서 지금 무료쓰는중\"*) — " +
      "주소만으로 입지평가를 얻는 길이 이 AI뿐이라 오차를 알아도 **바꿀 선택지가 없다.** " +
      "다시 제안하지 마라",
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
    label: "자사 하드웨어 사양(CPU·VGA·RAM·모니터)",
    source: "기본값",
    basis:
      "회사 **표준 기획값**(블랙라벨 현재 표준 구매 사양)을 쓴다. ⛔ 2026-09-23에 기존점 최빈 사양으로 " +
      "낮췄다가 **되돌렸다** — 표본 밖 외삽이라는 근거는 맞지만, 되짚기가 실제 후보지를 대표하지 " +
      "못해 예상매출이 과하게 깎였다. 사양 문자열은 화면·AI 평가문에 안 나오고 경쟁력점수 계산에만 쓰인다",
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
    label: "자사 PC대수·기본요금",
    source: "사람이 입력",
    basis:
      "조사값이 아니라 **기획값**이다. 재 보니 결과를 제일 크게 움직인다 — PC 80→130대에서 " +
      `${pct(QUICK_EVAL_INPUT_SENSITIVITY.pcCountEffect.low)}~${pct(QUICK_EVAL_INPUT_SENSITIVITY.pcCountEffect.high)}, ` +
      `기본요금 1,000→1,800원에서 ${pct(QUICK_EVAL_INPUT_SENSITIVITY.hourlyRateEffect.low)}~` +
      `${pct(QUICK_EVAL_INPUT_SENSITIVITY.hourlyRateEffect.high)}. 비우면 기본값 ` +
      `${QUICK_EVAL_PLAN_DEFAULTS.expectedPcCount}대·${QUICK_EVAL_PLAN_DEFAULTS.hourlyRate.toLocaleString("ko-KR")}원이 들어간다`,
    needsFieldCheck: false,
  },
  {
    label: "자사 층·지상지하·엘리베이터",
    source: "사람이 입력",
    basis:
      `⚠️ **V62 계산에는 직접 안 들어간다**(측정: 아무리 바꿔도 ${(QUICK_EVAL_INPUT_SENSITIVITY.floorDirectEffect * 100).toFixed(1)}%)` +
      " — 입지평가가 있으면 산식이 층수를 안 보기 때문이다. 대신 **AI 접근가시성 판정에 사실로 넘어가고**, " +
      `가시성은 결과를 크게 움직인다(1점 ${pct(QUICK_EVAL_INPUT_SENSITIVITY.visibilityEffect.low)} ~ ` +
      `5점 ${pct(QUICK_EVAL_INPUT_SENSITIVITY.visibilityEffect.high)}). ` +
      "⚠️ 엘리베이터는 **'있음'이 기본값**이다(2026-09-23 사용자 지시 — 후보 건물은 대개 있다). " +
      "없는 건물이면 직접 '없음'으로 바꿔야 한다. '미정'을 고르면 AI가 '모름'으로 보수적으로 매긴다. " +
      `층수는 비우면 ${QUICK_EVAL_PLAN_DEFAULTS.floor}층(기본값)으로 넘어간다`,
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
    { name: "L3 + 입지평가도 없음", mape: 0.134, median: 0.1158, within10: 0.4737, within20: 0.8684 },
  ],
  /**
   * ⛔ **이 사다리의 어느 칸도 "이 도구"가 아니다** (2026-09-23 정정).
   *
   * 예전엔 L3에 "← 주소만 / 이 화면" 딱지를 달아 뒀는데 **틀렸다.** 이 표는 **검증 배선**
   * (storedAccuracyParity)으로 재고 **자사는 각 매장 실측값**을 쓴다. 도구는 후보지 배선
   * (evaluateCandidate)이고 자사를 표본 최빈 사양으로, 경쟁점을 실측 대표값·129대로 채운다.
   *
   * ⚠️ 하필 L3(13.40%)가 도구의 실제 성적(`QUICK_EVAL_BACKTEST.mape`)보다 **좋아 보인다.**
   *    그래서 이 딱지를 두면 화면이 도구를 실제보다 잘 맞히는 것처럼 보여준다.
   *    ⛔ 다시 달지 마라. 도구 성적은 언제나 `QUICK_EVAL_BACKTEST`를 써라.
   *
   * 이 표를 남겨 두는 이유는 하나다 — **L1이 L2보다 나쁘다**(12.57% vs 10.82%)는 것,
   * 즉 "반만 채우면 더 틀린다"를 보여주는 자리다.
   */
  ladderIsNotTheTool: true,
} as const;

/**
 * ⭐ **이 도구 자체를 되짚어 잰 값** (2026-09-22 밤, `_quickEvalBias.test.ts`).
 *
 * 위 `ADDRESS_ONLY_ACCURACY`는 검증 배선으로 잰 것이라 **도구의 성적이 아니다.** 도구는
 * 후보지 배선(evaluateCandidate)을 쓰고 자사를 기본값으로 두므로 조건이 다르다. 그래서
 * 기존매장 38곳을 **후보지인 척**(조사 자료를 지우고, 자기 자신은 학습에서 뺀 채) 도구와 같은
 * 배선으로 돌려 실제 매출과 견줬다.
 *
 * ── 2026-09-22 밤(2차) — 과대예측을 값으로 줄였다 ──────────────────────────────
 * 과대예측의 큰 몫은 **자사를 표준 기획값으로 두는 것**이었다. 예전 주석은 이걸 "새로 지으면
 * 사양이 진짜 좋으니 정상"이라고 적어 뒀는데, 재 보니 그 사양은 **학습 표본에 아예 없는 구간**
 * 이었다(기존점은 전부 i5 14400F · RTX 4060 세대). 검증할 수 없는 외삽이므로 표본 안쪽
 * 사양으로 내렸다 — `buildQuickCandidate.QUICK_EVAL_OWN_HARDWARE` 주석에 근거가 다 있다.
 *
 * ⚠️ 그래도 배율은 여전히 1보다 크다. 남은 몫은 **값으로는 못 줄인다**(기본대수·품질 다 재
 *    봤고, 곱셈 보정과 수학적으로 같다는 것까지 확인했다 — `leveledMape` 참고). 그러니 화면에
 *    "높게 나오는 경향"을 계속 알려야 한다. 안 그러면 그 숫자를 그대로 믿는다.
 */
// ⭐⭐ 2026-09-23 갱신 — **지금 배선 그대로** 다시 쟀다(자사 표준 기획값 · 학습 경쟁점 비움 ·
// 후보지 경쟁점 RIVAL_PC_COUNT_WHEN_UNSURVEYED대 + 대표품질). 테스트: "지금 배선 그대로".
// 저녁에 경쟁점을 100대·항목 2.5점으로 내리고 다시 쟀다(before100Pc가 그전 값).
// 그전 화면 값(27.79% · 21% 높게)은 **다른 조합**(후보지도 비움)에서 잰 것이었는데 그대로
// 떠 있었다 — 인계문 0절에서 "인용하지 마라"고 적어 둔 바로 그 숫자다.
// ⚠️ 이 되짚기는 기존점의 **조사 경쟁점**(중앙 rivalCountMedian곳 · 최대 rivalCountMax곳)으로
//    돈다. 카카오 500m가 10~20곳인 실제 후보지를 대표하지 못한다 — 화면에 같이 적는다.
export const QUICK_EVAL_BACKTEST = {
  measuredAt: "2026-09-23",
  sampleCount: 38,
  testFile: "src/lib/storeEval/_quickEvalBias.test.ts",
  /** 지금 배선(학습 비움 · 후보지 100대+품질 2.5점 · 표준 사양) — 2026-09-23 저녁 */
  mape: 0.1868,
  within20: 0.7632,
  /** 예측 ÷ 실제매출의 중앙값. 1보다 크면 높게 나온다는 뜻 */
  medianRatio: 1.058,
  overCount: 25,
  /** 같은 날 낮 — 129대 + 품질 3점일 때 */
  before100Pc: { mape: 0.1697, within20: 0.7105, medianRatio: 1.05, overCount: 21, leveledMape: 0.1582 },
  /** 되짚기에 쓰인 기존점 조사 경쟁점 수 — 이 범위를 넘는 후보지는 잰 적이 없다 */
  rivalCountMedian: 4,
  rivalCountMax: 10,
  /** 2026-09-22 화면에 떠 있던 값(후보지도 비우던 조합) — 지금 배선이 아니다 */
  before20260923: { mape: 0.2779, within20: 0.4211, medianRatio: 1.211, overCount: 30, leveledMape: 0.1704 },
  /** 4차 직전 — 품질만 채우고 대수는 90대 기본값이던 때 */
  beforeRivalPcCount: { mape: 0.2023, within20: 0.7105, medianRatio: 1.105, overCount: 26 },
  /** 3차 직전 — 학습·후보지 양쪽을 비우던 배선 */
  beforeRivalFill: { mape: 0.2314, within20: 0.4737, medianRatio: 1.14, overCount: 29 },
  /** 2차 직전 — 자사 사양이 표준 기획값이던 때 */
  beforeOwnSpecFix: { mape: 0.2779, within20: 0.4211, medianRatio: 1.211, overCount: 30 },
  /** 그보다 더 전 — 학습만 실측이고 후보지는 빈칸이던 비대칭 배선 */
  before: { mape: 0.4635, within20: 0.2632, medianRatio: 1.461, overCount: 35 },
  /**
   * ⭐ **수준을 1에 맞춘 뒤 남는 오차 = 매장끼리 구별하는 실력.** 값 조정이 이걸 못 내리면
   * 그 조정은 곱셈 보정과 수학적으로 같은 것이다. 자사 사양 조정은 실제로 못 내렸는데
   * (17.04 -> 16.94%), **경쟁점을 채우는 건 내렸다**(-> 15.81%) — 버렸던 정보를 되살린
   * 것이라 성질이 다르다. 정밀 평가는 10.10%이고 그 격차는 경쟁점 실측 자료가 있어야 메워진다.
   */
  leveledMape: 0.1648,
  leveledMapeBefore: 0.1694,
  preciseLeveledMape: 0.101,
  /**
   * ⭐ 경쟁력점수 — "왜 높게 나오나"의 답이 여기 있다(사용자 질문 2026-09-22 밤).
   * 비워 두면 자사가 높아지는 게 아니라 **경쟁점이 낮게** 매겨진다.
   */
  competitiveness: {
    precise: { own: 3.7, rival: 2.448, rivalSd: 0.329, gap: 1.455 },
    blankRivals: { own: 3.735, rival: 1.921, rivalSd: 0.123, gap: 1.904 },
    /** 2026-09-22 129대·품질 3점 배선 */
    now: { own: 3.735, rival: 2.7, rivalSd: 0.123, gap: 1.374 },
    /** 2026-09-23 저녁 100대·품질 2.5점 배선(되짚기 중앙값) */
    after100Pc: { rival: 2.537, gap: 1.507 },
  },
} as const;


/** 초기 모드 숫자를 결재에 쓰지 못하게 화면에 박는 문구(인계문 6-2). */
export const QUICK_EVAL_USAGE_LIMIT =
  "점포개발 **초기 평가** 전용입니다. 결재에는 쓰지 마세요 — 결재 숫자는 [신규후보지]의 정밀 평가로 냅니다.";
