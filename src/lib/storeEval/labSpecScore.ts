// 사양(하드웨어) — **실험실 전용** 재정의 (2026-09-18).
//
// ⚠️ 운영 V62는 `calc.ts`의 `computeSpecScore` / `scoreFromVga` / `scoreFromCpu`를 그대로 쓴다.
//    이 파일은 실험실(/store-eval/lab)과 측정 하네스만 읽는다. 어젯밤 `labZoneComposition.ts`와
//    같은 자리다.
//
// ── 왜 새로 만드나 ─────────────────────────────────────────────────────────
// 운영 변환표는 **세대 산술**이다 — "RTX 5060이 4점, 세대가 하나 내려갈 때마다 1점",
// "i5 14400F가 4점, 세대당 1점". 조사 자료를 전수로 펴 보니 그 산술이 **실제 서열과 어긋나는
// 자리**가 여러 곳이었다.
//
//   RTX 3060 Ti  2.25점  <  RTX 4060  3.00점        (실제로는 3060 Ti가 빠르다 · 23건)
//   RTX 3070     2.50점  <  RTX 4060  3.00점        (실제로는 3070이 한참 빠르다 · 12건)
//   RTX 4070     3.50점  <  RTX 5060  4.00점        (사용자 지적 · 9건)
//   i3 13100F    3.00점  =  i5 13400F 3.00점        (티어를 아예 안 본다 · 자사 9곳)
//   i9 9900KF    1.00점  =  i5 9400F  1.00점        (티어 + 바닥 포화)
//   울트라5 225F 4.00점  =  i5 14400F 4.00점        (사용자 지적 · 세대는 위다)
//
// 세대 숫자는 **출시 연도**지 성능이 아니다. 같은 세대 안에서 티어(60/70/80 · i3/i5/i7)가
// 만드는 차이가 세대 하나보다 큰 경우가 흔하다. 그래서 여기서는 모델명을 **성능지수**로
// 옮기고, 성능지수를 점수로 바꾼다.
//
// ── 점수 눈금은 기존 뜻을 그대로 잇는다 ────────────────────────────────────
// 사용자가 확정해 둔 사다리가 있다 — *"5060이 지금 4점일텐데, 그럼 4060이 3점, 3060 2점,
// 2060 1점"*. 이 네 칸을 성능지수로 놓으면 한 칸이 대략 **성능 ×0.83**이다.
//
//   RTX 5060 100 · RTX 4060 83 · RTX 3060 72 · RTX 2060 58
//   ln(58/100) / 3칸 = 칸당 -0.182  ->  점수 = 4 + ln(성능지수/100) / 0.182
//
// 이 식에 기존 네 칸을 도로 넣으면 4.00 · 2.97 · 2.19 · 1.00이 나온다. **사용자가 정한
// 사다리를 거의 그대로 재현한다.** 새 눈금이 아니라 같은 눈금을 모델 전체로 넓힌 것이다.
//
// ── ⚠️ 성능지수는 [감각] 계수다 ────────────────────────────────────────────
// 표의 숫자는 **저장소 자료로 검증할 수 없다.** 매장 매출에서 역산한 값이 아니라 공개 벤치마크
// 통념에서 가져온 근사치다([[feedback_item_vs_coefficient]]의 [감각] 라벨). 그래도 쓰는 근거는
// **세대 산술보다 실제 서열에 가깝다**는 것 하나다 — 위 여섯 줄처럼 명백히 뒤집힌 자리를
// 바로잡는다.
//
// 어긋나는 사례가 나오면 표를 고친다. 표에 없는 모델은 운영과 **같은 세대 산술**로 떨어진다
// (지어내지 않고, 최소한 지금과 같은 값을 준다).
//
// ── 재 보고 갈렸다 — GPU는 켜고 CPU는 껐다 (2026-09-18) ────────────────────
// 같은 방식으로 만든 두 표인데 측정이 정반대로 나왔다. 판정은 **r(순서)**이 한다 — MAPE는
// 수준에 끌려다니고, 이 모델의 축척은 독점매장에서만 맞추므로(textbookModel의
// `calibrationTarget`) 경쟁점 점수가 통째로 오르면 그 수준 이동이 MAPE에 그대로 찍힌다.
//
//   GPU 성능지수    r 0.563 -> 0.586   MAPE 22.60% -> 22.62%   대조군 p=0.010 ✅  -> **켠다**
//   CPU 성능지수    r 0.563 -> 0.566   MAPE 22.60% -> 23.02%   수준 되돌려도 22.93%  -> **끈다**
//
// GPU 대조군은 "델타의 크기는 그대로 두고 **어느 모델에 붙는지만** 뒤섞기" 300회다. 뒤섞으면
// r 개선폭이 중앙 -0.003 · 95퍼센타일 0.016인데 실제 표는 0.023이다. 즉 이 표가 좋아진 건
// 점수를 움직였기 때문이 아니라 **맞는 모델에 맞게 움직였기** 때문이다.
//
// CPU는 순서를 못 고쳤다. 경쟁점 CPU 평균을 0.78점 올리는데(자사는 0.28점) 그 수준 이동을
// 빼고 봐도 r이 0.002밖에 안 움직인다.
//
// ── CPU 2차 — 갈라서 다시 봤다 (2026-09-18) ───────────────────────────────
// 1차 표는 **두 가지를 한꺼번에** 했다. 2번이 망친 걸 1번까지 같이 버렸나 싶어 갈라 봤다.
//   1. 티어 구분   i3 13100F가 i5 13400F와 같은 3.00점이던 것을 가른다 (자사 9곳)
//   2. 세대 간격   세대당 1점이던 것이 성능차대로 압축된다 (13400F는 14400F의 97%)
//
// 채택된 GPU 표 위에서 재면(= 바닥 22.59% · r 0.581):
//   티어만 0.2점   MAPE 22.63%  r 0.581   <- r이 **한 톨도** 안 움직인다
//   티어만 0.6점   MAPE 22.70%  r 0.582
//   성능+벌점 0.30 MAPE 22.85%  r 0.585   <- r +0.004인데 MAPE -0.26%p
// GPU 변경이 이미 r을 0.563 -> 0.581로 올려놨고, **CPU를 어떻게 만져도 그 위에 안 얹힌다.**
//
// ── 왜 안 얹히나 — 코호트 교란 + 잔차가 반대 방향 ─────────────────────────
// 자사 i3 9곳의 실매출은 실제로 낮다(PC당 54.69만원 vs i5 66.77만원). 그래서 "티어를 반영하면
// 맞겠네" 싶은데, 자료를 더 보면 **두 가지가 반대로 말한다.**
//
// **(1) i3는 매장 선택이 아니라 시기다.** 사용자 정정(2026-09-18):
//   *"i3라고 요금이낮은건아닌데? 요금은 사양에맞추는게아니라 상권에 맞추는형태임.
//     우리가 당시 기본모델은 i3를 넣은거뿐."*
// 그러니 "i3라서 요금이 낮다"는 읽기는 **인과가 거꾸로다.** 요금은 상권이 정하고, i3는 그 시절
// 표준 구성이었을 뿐이다. 둘은 **개점 시기**에 같이 붙어 있다([[project_cohort_effect_confound]]).
// 같은 13세대 안에서만 견줘도 시기가 갈린다:
//
//   집단        곳수  PC당매출   요금     PC수     개점시기    모델 잔차
//   13세대 i3    9곳  54.69만  1,211원  100.3대  2023.65년   **-9.8%**
//   13세대 i5   13곳  64.67만  1,346원  102.6대  2024.37년   **-2.9%**
//
// **(2) 잔차가 반대 방향이다.** 잔차가 음수면 모델이 실제보다 **낮게** 본다는 뜻이다.
// i3 매장은 이미 9.8% 과소예측되고 있다. 여기서 CPU 점수를 더 낮추면 **더 틀린다.**
// 자료는 오히려 "i3 매장이 산식보다 잘하고 있다"고 말한다.
// ([[feedback_raw_correlation_cannot_judge_structure]])
//
// ⚠️ **티어 구분이 하드웨어 설명으로는 맞다.** 안 쓰는 이유는 "i3가 i5와 같다"가 아니라
//    이 표본에서 **i3가 곧 2023년 코호트**라, 티어를 넣으면 시기 효과를 CPU 이름으로 세게 되기
//    때문이다. 게다가 방향도 반대다. 요금·상권이 다른 i3 매장이 생기면 갈라볼 수 있다.
//
// 참고로 당시 판단 근거도 자료가 지지한다 — 성능지수로 **i3 13100F 82 · i5 12400F 88**이다.
// 7% 차이라 "크게 차이 안 난다"고 본 게 합리적이었다(4코어지만 클럭이 높아 e스포츠에선 근소).
//
// ⚠️ 표와 세대 벌점은 지웠다가 다시 만들지 않으려고 **남겨 둔다.** 표본이 늘면 다시 켜 본다.
//
// ── 사용자 질문 셋에 대한 답 (2026-09-18) ──────────────────────────────────
// 1. *"4070 4080은 성능대비 5060보다 우위일텐데 이런거 어케할지?"*
//    성능지수로 옮겨서 풀었다. RTX 4070은 3.50 -> 5.00, RTX 3080은 3.00 -> 5.00이 된다.
//    ⚠️ 상한 5에 여럿이 같이 붙는다(5070·4070·3080·5080). PC방 체감이 상단에서 포화한다고
//    보면 뜻에 맞지만, 최상급끼리의 순서는 이 눈금에서 안 보인다.
// 2. *"메모리의 1점차이가 의미가 있는지 궁금."*
//    **거의 없다.** 격차를 0.5에서 0으로 지워도 r이 0.586 -> 0.588로 0.002만 움직인다.
//    늘리는 쪽은 확실히 나쁘다 — 1.0에서 22.76% · 2.0에서 23.05%로 단조롭게 나빠진다.
//    그래서 **운영과 같은 0.5를 그대로 둔다**(늘리지 않는다). 0으로 지우면 MAPE는 0.14%p
//    좋아지지만 그건 순서가 아니라 수준 효과이고, 항목을 죽이는 것이라 안 한다.
// 3. *"울트라5 225f가 4점, i5 14400F랑 한세대 차이나는거아닌가?"*
//    세대는 위가 맞다(코어 울트라 200S가 14세대 다음). 다만 **게임 성능은 사실상 같다** —
//    생산성에선 앞서지만 PC방은 게임이 전부다. 성능지수로는 102 대 100이라 4.11점 대 4.00점,
//    즉 지금의 "같은 점수"가 크게 틀린 게 아니다. 게다가 CPU 표 자체를 껐으므로 지금은
//    운영과 같은 4.00을 쓴다. 해당 6건은 전부 경쟁점이고 자사엔 없다.

import { scoreFromVga, scoreFromCpu, scoreFromRam, scoreFromMonitor, combineHardwareTiers } from "@/lib/storeEval/calc";
import type { ModelSettings } from "@/lib/storeEval/types";

/** 앵커 = 블랙라벨 현재 표준(RTX 5060)을 100으로 놓은 상대 성능. 클수록 빠르다. */
export const LAB_GPU_PERF_INDEX: Record<string, number> = {
  // 50 시리즈
  RTX5090: 300, RTX5080: 235, RTX5070TI: 180, RTX5070: 145, RTX5060TI: 118, RTX5060: 100, RTX5050: 72,
  // 40 시리즈
  RTX4090: 265, RTX4080: 200, RTX4070TI: 160, RTX4070: 130, RTX4060TI: 99, RTX4060: 83,
  // 30 시리즈
  RTX3090: 160, RTX3080: 135, RTX3070TI: 112, RTX3070: 104, RTX3060TI: 93, RTX3060: 72, RTX3050: 48,
  // 20 시리즈
  RTX2080TI: 120, RTX2080SUPER: 92, RTX2080: 85, RTX2070SUPER: 82, RTX2070: 72,
  RTX2060SUPER: 68, RTX2060: 58,
  // GTX 10·16 시리즈
  GTX1080TI: 88, GTX1080: 64, GTX1070TI: 62, GTX1070: 55,
  GTX1660TI: 52, GTX1660SUPER: 55, GTX1660: 45, GTX1650: 32,
  GTX1060: 38, GTX1050TI: 22,
};

/**
 * 앵커 = 블랙라벨 현재 표준(i5 14400F)을 100으로 놓은 상대 성능. **게임 기준**이다.
 *
 * ⚠️ 열쇠는 **모델번호만** 쓴다(i3/i5/i7 글자를 안 본다). 인텔 모델번호가 이미 티어를 담고
 *    있기 때문이다 — 13100=i3 · 13400=i5 · 13700=i7 · 13900=i9. 덕분에 조사 오기도 바로
 *    읽힌다: 자료에 "i5 8700"이 2건 있는데 8700은 실물이 i7-8700이다. 글자를 보면 i5로
 *    잘못 읽고, 번호를 보면 맞게 읽는다.
 */
export const LAB_CPU_PERF_INDEX: Record<string, number> = {
  // 코어 울트라 200S (Arrow Lake) — 세대는 14세대 위다. 다만 **게임 성능은 거의 같다**.
  // 생산성에선 크게 앞서지만 PC방은 게임이 전부라, 세대 하나를 그대로 점수로 주지 않는다.
  // ⚠️ 사용자 질문 자리다 — 세대 가산을 줄지는 `_specScore.test.ts`에서 양쪽 다 재 본다.
  "울트라5-225": 102, "울트라5-235": 105, "울트라5-245": 112, "울트라5-250": 114, "울트라5-255": 115,
  "울트라7-265": 128, "울트라9-285": 140,
  // 14세대 (Raptor Lake Refresh)
  "14100": 86, "14400": 100, "14500": 106, "14600": 118, "14700": 140, "14900": 152,
  // 13세대 (Raptor Lake) — 14세대와 사실상 같은 칩이다. 클럭만 조금 낮다.
  "13100": 82, "13400": 97, "13500": 104, "13600": 116, "13700": 136, "13900": 150,
  // 12세대 (Alder Lake)
  "12100": 78, "12400": 88, "12500": 90, "12600": 100, "12700": 110, "12900": 122,
  // 11세대 이하 — 여기서부터는 어차피 바닥(1.00) 근처다. 순서를 살려도 매출이 안 달라진다는
  // 것을 측정으로 확인했다(_specScore.test.ts (10) 바닥만 풀기: 22.60% -> 22.61%).
  "11400": 78, "11600": 84, "11700": 92,
  "10100": 60, "10400": 70, "10600": 78, "10700": 88, "10900": 95,
  "9100": 52, "9400": 62, "9600": 70, "9700": 78, "9900": 85,
  "8100": 48, "8400": 58, "8500": 60, "8700": 72,
  "7100": 40, "7500": 48, "7600": 52, "7700": 62,
};

/** 성능지수 -> 점수. 앵커 100 = 4.00, 칸당 성능 ×0.83(= 사용자 사다리에서 역산). */
export const LAB_PERF_ANCHOR_SCORE = 4;
export const LAB_PERF_LOG_STEP = 0.1816; // ln(58/100)/3 — RTX 5060/4060/3060/2060 = 4/3/2/1

/**
 * **앵커 위쪽 기울기** — 앵커(RTX 5060)보다 빠른 카드에만 쓴다. 클수록 완만하다.
 *
 * ── 왜 위아래를 다르게 두나 (2026-09-18, 사용자 지적) ──────────────────────
 * 사용자: *"GPU 3080 5점 너무과하다."* 맞다. 그리고 원인은 기울기가 아니라 **앵커 4점과
 * 상한 5점 사이가 1점뿐**인 것이었다. 한 칸이 성능 ×0.83인데 RTX 3080은 앵커보다 35% 빨라서
 * 식으로 5.65점이 나오고, 잘려서 5.00이 된다. RTX 5070·4070·5080도 같은 이유로 전부 5.00에
 * 몰렸다 — **최상급끼리의 순서가 아예 안 보인다.**
 *
 * ⚠️ 사용자가 물은 "3060-4060-5060 간격을 늘리는" 쪽은 **반대 효과**다. 간격을 늘린다는 건
 *    기울기를 작게 하는 것이고, 그러면 3080이 상한에 더 세게 박힌다(4+1.65 -> 4+2.5).
 *
 * 뜻으로 보면 위아래가 대칭일 이유가 없다. PC방 손님 기준으로 **앵커 아래는 체감이 확실하고**
 * (RTX 2060이면 게임이 버벅인다) **앵커 위는 포화한다** — 롤·오버워치·배그·발로란트는 RTX
 * 5060이면 다 충분히 돌아가서, 그 위로는 손님이 차이를 잘 모른다. 그래서 아래 기울기는 사용자
 * 사다리에서 역산한 값을 그대로 두고, 위만 완만하게 한다.
 *
 * 값은 **[감각] 계수다.** 자사 GPU는 전부 앵커 이하~바로 위라 이 값이 자사 점수를 거의 안
 * 건드리고, 경쟁점 상위 카드 27건(3080 5 · 4070 6 · 5070 5 · 3070Ti 5 · 5060Ti 4 · 5080 1 등)의
 * 서열에만 작용한다.
 */
export const LAB_PERF_LOG_STEP_UP = 0.45;

/**
 * **세대 벌점** — 앵커 세대(RTX 50)에서 한 세대 멀어질 때마다 깎는 점수.
 *
 * ── 왜 성능만으로는 모자라나 (2026-09-18, 사용자 방향) ────────────────────
 * 사용자: *"성능외에 세대별 차등도 적용이 되는구조가 좋을것같은데"*
 *
 * 성능지수만 쓰면 **"구형이라도 빠르면 장땡"**이 된다. PC방에서는 그렇지 않다 —
 * 같은 성능이라도 구형 카드는 노후·고장률, 신작 게임의 최신 기능 지원, 그리고 손님이
 * 사양표를 보고 받는 인상에서 불리하다. RTX 3080이 RTX 5060보다 35% 빠른 건 맞지만
 * "RTX 3080 PC방"이 "RTX 5060 PC방"보다 좋은 곳이냐는 별개다.
 *
 * 그래서 두 축을 더한다 — **얼마나 빠른가(성능)**와 **얼마나 최신인가(세대)**.
 *
 *   점수 = 4 + ln(성능지수/100) / 기울기 − 세대벌점 × (5 − 그 카드 세대)
 *
 * 값은 **[감각] 계수다.** 훑기는 `_specScore.test.ts` (18)에 있다.
 */
export const LAB_GEN_PENALTY = 0.15;

/** 앵커 세대. RTX 50 시리즈. */
export const LAB_ANCHOR_GENERATION = 5;

/**
 * 표 열쇠 -> 세대. GTX 16 시리즈는 **2세대(튜링)**로 본다 — RTX 20과 같은 세대의 보급형이라
 * 번호(16)를 그대로 읽으면 안 된다.
 */
export function labGpuGeneration(key: string | null): number | null {
  if (!key) return null;
  const m = key.match(/(\d{4})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n >= 5000) return 5;
  if (n >= 4000) return 4;
  if (n >= 3000) return 3;
  if (n >= 2000) return 2;
  if (n >= 1600) return 2; // GTX 16xx = 튜링. RTX 20과 같은 세대다.
  return 1; // GTX 10xx = 파스칼
}

export function labScoreFromPerfIndex(
  index: number | null,
  logStep = LAB_PERF_LOG_STEP,
  logStepUp = LAB_PERF_LOG_STEP_UP,
  generation: number | null = null,
  genPenalty = LAB_GEN_PENALTY,
): number | null {
  if (index == null || !(index > 0)) return null;
  const rel = Math.log(index / 100);
  const aged = generation == null ? 0 : genPenalty * Math.max(0, LAB_ANCHOR_GENERATION - generation);
  const raw = LAB_PERF_ANCHOR_SCORE + rel / (rel > 0 ? logStepUp : logStep) - aged;
  return Math.max(1, Math.min(5, raw));
}

/**
 * GPU 모델 텍스트 -> 표 조회용 열쇠. "RTX 5060Ti" · "RTX 5060 Ti" · "5060" 을 다 같은 칸으로.
 * 한 칸에 여러 모델이 적혀 있으면(예: "RTX 2080 / RTX 3060 / RTX 4060") **첫 번째**를 쓴다 —
 * 운영 `scoreFromVga`와 같은 처리다.
 */
export function labGpuKey(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text.toUpperCase().replace(/[\s\-_]/g, "");
  // 칸 착오 가드 — CPU 모델명이 GPU 칸에 적힌 경우(실제 1건: "i7 12700KF").
  // 운영 scoreFromVga엔 이 가드가 없어서 "12700"을 읽고 5.00점을 준다.
  if (/^(?:I[3579]|울트라|ULTRA|RYZEN|라이젠|R[3579]\d)/.test(cleaned) && !/RTX|GTX|RADEON|RX\d/.test(cleaned)) return null;
  const m = cleaned.match(/(RTX|GTX)?(\d{4})(TI|SUPER)?/);
  if (!m) return null;
  const num = m[2];
  // 접두가 없으면 세대로 미룬다 — 10·16 시리즈는 GTX, 20 이상은 RTX.
  const prefix = m[1] ?? (Number(num) < 2000 ? "GTX" : "RTX");
  // "2080 Super"처럼 SUPER가 뒤에 떨어져 적힌 경우도 잡는다.
  const suffix = m[3] ?? (/SUPER/.test(cleaned) ? "SUPER" : /\d{3,4}TI/.test(cleaned) ? "TI" : "");
  return `${prefix}${num}${suffix}`;
}

/** GPU 텍스트 -> 1~5점. 표에 없으면 운영 세대 산술로 떨어진다. */
export function labScoreFromVga(
  text: string | null,
  table: Record<string, number> = LAB_GPU_PERF_INDEX,
  logStepUp = LAB_PERF_LOG_STEP_UP,
  genPenalty = LAB_GEN_PENALTY,
): number | null {
  const key = labGpuKey(text);
  if (key == null) return null;
  const idx = table[key];
  if (idx != null) return labScoreFromPerfIndex(idx, LAB_PERF_LOG_STEP, logStepUp, labGpuGeneration(key), genPenalty);
  return scoreFromVga(text);
}

/**
 * CPU 모델 텍스트 -> 표 조회용 열쇠.
 *   "i5 14400F" · "i5-14400" · "14400" -> "14400"  (접미사 F/K/KF는 무시 — 게임 차이가 거의 없다)
 *   "울트라5 225F" · "울트라5 시리즈 225" -> "울트라5-225"
 *   "i5 14세대" -> "14400"  (모델번호가 없으면 그 세대의 해당 티어 주력으로 본다)
 */
export function labCpuKey(text: string | null): string | null {
  if (!text) return null;
  // 칸 착오 가드 — GPU 모델명이 CPU 칸에 적힌 경우(실제 3건). 운영과 같은 처리다.
  if (/\b(?:RTX|GTX|라데온|RADEON|RX\s*\d)/i.test(text)) return null;
  const ultra = text.match(/(?:울트라|ultra)\s*([579])\D{0,8}(\d{3})/i);
  if (ultra) return `울트라${ultra[1]}-${ultra[2]}`;
  // 라이젠은 인텔 모델번호와 자릿수가 겹쳐 뜻이 정반대다 — 표를 안 쓰고 운영 환산에 맡긴다.
  if (/(?:ryzen|라이젠|\bR[3579]\b)/i.test(text)) return null;
  const modelM = text.match(/(\d{4,5})/);
  if (modelM) return modelM[1];
  // 모델번호가 없고 "N세대"만 적힌 경우 — 그 세대에서 적힌 티어의 주력 번호로 옮긴다.
  const genLabel = text.match(/(\d{1,2})\s*세대/);
  if (!genLabel) return null;
  const tierM = text.match(/i([3579])/i);
  const tier = tierM ? tierM[1] : "5"; // 티어가 안 적혔으면 주력인 i5로 본다
  const base = tier === "3" ? "100" : tier === "5" ? "400" : tier === "7" ? "700" : "900";
  return `${genLabel[1]}${base}`;
}

/** CPU 텍스트 -> 1~5점. 표에 없으면 운영 세대 산술로 떨어진다. */
export function labScoreFromCpu(
  text: string | null,
  table: Record<string, number> = LAB_CPU_PERF_INDEX,
  genPenalty = LAB_CPU_GEN_PENALTY,
): number | null {
  const key = labCpuKey(text);
  if (key == null) return scoreFromCpu(text);
  const idx = table[key];
  if (idx == null) return scoreFromCpu(text);
  const gen = labCpuGeneration(key);
  const aged = gen == null ? 0 : genPenalty * Math.max(0, LAB_CPU_ANCHOR_GENERATION - gen);
  const raw = LAB_PERF_ANCHOR_SCORE + Math.log(idx / 100) / LAB_PERF_LOG_STEP - aged;
  return Math.max(1, Math.min(5, raw));
}

/** 표 열쇠 -> 세대. 울트라 200S는 14세대 **다음**이라 15로 본다. */
export function labCpuGeneration(key: string | null): number | null {
  if (!key) return null;
  if (key.startsWith("울트라")) return 15;
  const m = key.match(/^(\d{4,5})$/);
  if (!m) return null;
  return m[1].length === 5 ? Number(m[1].slice(0, 2)) : Number(m[1].slice(0, 1));
}

/** CPU 앵커 세대 — i5 14400F. */
export const LAB_CPU_ANCHOR_GENERATION = 14;

/**
 * **CPU 세대 벌점** — GPU의 `LAB_GEN_PENALTY`와 같은 구조다.
 *
 * ── 왜 CPU에도 필요한가 (2026-09-18 2차) ──────────────────────────────────
 * 1차에서 CPU 성능지수표를 켰다가 껐다(r 0.563 -> 0.566뿐). 그런데 그 표는 **두 가지를
 * 한꺼번에** 했다:
 *   1. **티어 구분 추가** — i3 13100F가 i5 13400F와 같은 3.00점이던 것을 갈랐다(자사 9곳)
 *   2. **세대 간격 압축** — 세대당 1점이던 것이 성능차대로 줄었다(13400F는 14400F의 97%라 0.17점)
 * 2번이 망친 것을 1번까지 같이 버렸을 수 있다. 세대 벌점은 **2번만 되돌린다** —
 * 티어 구분은 남기고 세대 간격을 다시 벌린다.
 */
export const LAB_CPU_GEN_PENALTY = 0.3;

/**
 * RAM — 사실상 16GB와 32GB 두 종류다(자사 35 vs 8 · 경쟁점 102 vs 75). 운영은 3.50/4.00으로
 * **0.5점** 차이를 준다.
 *
 * ⚠️ 사용자 질문 자리다 — *"메모리의 1점차이가 의미가 있는지 궁금."* 격차를 바꿔가며
 *    `_specScore.test.ts`에서 잰다. 여기 기본값은 **운영과 같은 0.5**로 둔다.
 * ── 재봤다: 순서 정보가 없다 (2026-09-18) ─────────────────────────────────
 * 사용자 물음: *"RAM은 이대로가면되는겨? 기존대로?"* -> **그대로 둔다.** 다만 이 항목이
 * 일하고 있다고 읽으면 안 된다. `_specScore.test.ts` (20)에서 셋을 물었다.
 *
 *   격차 훑기   0.00 22.44% · 0.50 22.59%(지금) · 1.00 22.73% · 2.00 23.03%  (늘릴수록 나쁘다)
 *   방향 뒤집기 32GB 3.50 · 16GB 4.00으로 뒤집으면 **22.37%로 더 낫다**
 *   대조군      RAM을 켜서 좋아진 폭 **-0.14%p** · 무작위 500회 중앙 -0.07%p · **p=0.814 미달**
 *
 * ⚠️ **"차이가 없다"가 아니라 "자료가 못 본다"이다.** 처음엔 "PC방 게임엔 16GB면 충분하다"고
 * 읽었는데 **사용자가 바로잡았다**: *"16기가 32기가차이로는 일부 게임중에 16기가로 돌리면
 * 버벅이는 증상있는게임이있다. 예를들어 아이온2로 많이얘기해주고, 배그도 16기가로 일부
 * 상황에따라 버벅이는증상있는걸로 인지하였음"* — 물리적 차이는 실재한다.
 *
 * 자료가 못 보는 이유가 둘 다 확인된다.
 *   1. **시기가 안 맞는다.** 평가창(개점 다음 달~12개월)이 끝나는 해가 2024년 12곳 · 2025년
 *      13곳 · 2026년 6곳 · 2027년 7곳이다. **38곳 중 25곳(66%)이 2025년 안에 끝났다** —
 *      아이온2는 그 매출에 아예 없다. 나머지 13곳도 평가창 일부만 걸친다.
 *   2. **격차 훑기의 단조 악화는 신호가 아니라 우리 매장 구성이다.** 자사는 16GB가 88%(35/40)
 *      인데 경쟁점은 63%(103/164)다. 격차를 키우면 **자사 점수가 경쟁점보다 더 많이 떨어지고**,
 *      이미 과소예측인 모델이라 MAPE가 나빠진다. "격차가 0이어야 한다"는 근거가 아니다.
 *      [[feedback_lab_mape_follows_level]]
 *
 * 그래서 0.5를 그대로 둔다 — **뜻은 32GB가 낫다는 쪽이고, 자료는 아직 판정할 힘이 없다.**
 * 늘리지도 줄이지도 않는다. 0으로 지우면 MAPE가 0.15%p 좋아지지만 r이 0.002만 움직이고
 * (= 수준으로 번 것), 뒤집는 건 자료가 그쪽이어도 뜻이 안 된다(0.22%p는 우연으로 본다).
 *
 * 📌 **사업적으로 짚을 것**: 경쟁점은 32GB가 37%인데 자사는 12%다. **RAM은 우리가 밀린다.**
 *    아이온2가 자리잡으면 실제 약점이 될 수 있다. 표본의 평가창이 2026~2027로 넘어가면 다시 잰다.
 */
export const LAB_RAM_GAP = 0.5;
export function labScoreFromRam(text: string | null, gap = LAB_RAM_GAP): number | null {
  const base = scoreFromRam(text);
  if (base == null) return null;
  // 운영 표: 32GB이상 4.00 · 16GB이상 3.50 · 그 미만 1.50. 32GB를 앵커로 두고 격차만 넓힌다.
  if (base >= 4) return 4;
  if (base >= 3.5) return Math.max(1, 4 - gap);
  return Math.max(1, 4 - gap * 3);
}

export type LabSpecInput = {
  vgaBase: string | null; vgaTop: string | null; vgaTop2: string | null;
  cpu: string | null; cpuTop1: string | null; cpuTop2: string | null;
  ram: string | null; ramTop: string | null;
  monitorBase: string | null; monitorTop: string | null;
};

/**
 * **CPU 성능지수표를 쓸지.** 기본 `false` — 순서를 못 고쳐서 껐다(위 "재 보고 갈렸다").
 * 켜면 경쟁점 CPU 평균이 0.78점 오르고 MAPE가 22.62% -> 23.02%가 된다.
 * 표본이 45~50곳으로 늘면 다시 재 볼 것.
 */
export const LAB_USE_CPU_PERF_INDEX = false;

export type LabSpecOptions = {
  /** GPU 성능지수표. 훑기용으로 갈아끼운다. */
  gpuTable?: Record<string, number>;
  /** CPU 성능지수표. ⚠️ `useCpuPerfIndex`가 켜져야 쓰인다. */
  cpuTable?: Record<string, number>;
  /** CPU를 성능지수로 볼지. 기본은 `LAB_USE_CPU_PERF_INDEX`(꺼짐 = 운영 세대 산술). */
  useCpuPerfIndex?: boolean;
  /** 앵커 위쪽 기울기. 훑기용. 기본은 `LAB_PERF_LOG_STEP_UP`. */
  gpuLogStepUp?: number;
  /** 세대 벌점. 훑기용. 기본은 `LAB_GEN_PENALTY`. */
  gpuGenPenalty?: number;
  /** CPU 세대 벌점. 훑기용. 기본은 `LAB_CPU_GEN_PENALTY`. */
  cpuGenPenalty?: number;
  /** RAM 16GB↔32GB 격차. */
  ramGap?: number;
  /** 모니터 특화 칸을 무시하고 기본만 쓸지. 조사 성실도 비대칭(자사 100% vs 경쟁 47%) 대응. */
  monitorBaseOnly?: boolean;
  /** 모니터 항목을 아예 뺄지. ⚠️ 항목을 자르는 것이라 기본은 false다. */
  dropMonitor?: boolean;
};

/**
 * 모니터 특화 결합 — 운영 `scoreFromMonitorSpec`과 같다(65/35 · 기본보다 낮은 특화는 제외).
 * 여기 따로 둔 이유는 `monitorBaseOnly` 스위치를 붙이기 위해서다.
 */
function labScoreFromMonitorSpec(base: string | null, top: string | null, baseOnly: boolean): number | null {
  const b = scoreFromMonitor(base);
  if (baseOnly || !top) return b;
  const qualifying = top.split(",").map((p) => scoreFromMonitor(p.trim()))
    .filter((s): s is number => s != null && (b == null || s > b));
  if (qualifying.length === 0) return b;
  const avg = qualifying.reduce((a, c) => a + c, 0) / qualifying.length;
  return b == null ? avg : b * 0.65 + avg * 0.35;
}

/**
 * 하드웨어 종합점수 — GPU/모니터/CPU/RAM의 가중평균. 값이 있는 항목만 넣고 그 항목들의
 * 가중치로 재정규화한다(운영 `computeSpecScore`와 같은 규칙).
 */
export function labComputeSpecScore(
  input: LabSpecInput,
  settings: Pick<ModelSettings, "specWeights">,
  opts: LabSpecOptions = {},
): number | null {
  const w = settings.specWeights;
  const up = opts.gpuLogStepUp ?? LAB_PERF_LOG_STEP_UP;
  const gp = opts.gpuGenPenalty ?? LAB_GEN_PENALTY;
  const gpu = combineHardwareTiers(
    labScoreFromVga(input.vgaBase, opts.gpuTable, up, gp),
    [labScoreFromVga(input.vgaTop, opts.gpuTable, up, gp), labScoreFromVga(input.vgaTop2, opts.gpuTable, up, gp)],
  );
  // CPU는 기본으로 **운영 세대 산술**을 쓴다 — 성능지수표가 순서를 못 고쳤다(파일 상단 참고).
  const cpuScore = (opts.useCpuPerfIndex ?? LAB_USE_CPU_PERF_INDEX)
    ? (t: string | null) => labScoreFromCpu(t, opts.cpuTable, opts.cpuGenPenalty ?? LAB_CPU_GEN_PENALTY)
    : scoreFromCpu;
  const cpu = combineHardwareTiers(cpuScore(input.cpu), [cpuScore(input.cpuTop1), cpuScore(input.cpuTop2)]);
  const ram = combineHardwareTiers(
    labScoreFromRam(input.ram, opts.ramGap),
    [labScoreFromRam(input.ramTop, opts.ramGap)],
  );
  const monitor = opts.dropMonitor ? null : labScoreFromMonitorSpec(input.monitorBase, input.monitorTop, opts.monitorBaseOnly ?? false);
  const items = [
    { score: gpu, weight: w.vga },
    { score: monitor, weight: w.monitor },
    { score: ram, weight: w.ram },
    { score: cpu, weight: w.cpu },
  ].filter((i): i is { score: number; weight: number } => i.score != null);
  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total === 0) return null;
  return items.reduce((s, i) => s + i.score * i.weight, 0) / total;
}
