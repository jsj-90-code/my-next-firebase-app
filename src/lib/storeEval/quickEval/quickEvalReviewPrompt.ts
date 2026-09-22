// AI 평가문 프롬프트 — "숫자만 내지 말고 무엇을 모른 채로 낸 숫자인지 같이 말해라".
// (주소만 초기평가 도구 전용 · **순수 함수**. API를 부르지 않는다)
//
// ── 인계문 6-3이 요구한 것 ────────────────────────────────────────────────
// 같이 적어야 할 것: 이 추정의 오차 범위 · 무엇을 기본값으로 채웠는지 ·
// 경쟁점 목록의 출처와 한계 · 확인이 필요한 항목 목록(= 그대로 현장 조사 체크리스트).
//
// ⚠️ **AI가 숫자를 새로 만들면 안 된다.** 매출·수요·경쟁IP는 전부 V62가 계산한 값을 그대로
//    인용하게 하고, 프롬프트에서 "계산을 다시 하지 말라"고 못 박는다. 이 저장소의 오래된
//    원칙이다(AI는 추정값을 만들지 않는다 — locationEvalAi.ts 머리 주석과 같은 이유).

import { formatManwonPerPc, formatManwonRough } from "../format";
import type { EvaluationResult } from "../types";
import {
  QUICK_EVAL_BACKTEST,
  QUICK_EVAL_FIELD_NOTES,
  QUICK_EVAL_USAGE_LIMIT,
} from "./quickEvalDefaults";
import type { QuickEvalAssembly } from "./buildQuickCandidate";
import type { QuickEvalPeerSummary } from "./quickEvalPeers";

/**
 * 평가문의 성격 (2026-09-22 사용자 지시로 바뀜).
 *
 * 처음엔 "산식 결과를 해설하는 글"이었는데, 사용자가 원한 건 **AI 자체 평가**였다:
 *   *"이 상권은 어떠한 상권이고 어떠한 부분에 장점 단점 등 특이점이 있는 거 설명해주고,
 *     우리 가맹점 데이터 어떠한 부분을 봤을 때 예상 매출 어느정도 예상한다 이런 AI 자체평가.
 *     예상매출이 꼭 산식에 맞아야 한다는 건 아님, 평가에 따라서 매출값 다르게 나와도 됨"*
 *
 * 그래서 **AI가 자기 매출 범위를 제시하도록** 허용한다. 대신 근거를 묶어 둔다 — 근거는
 * (1) 이 후보지의 수집 수치와 (2) 실적이 있는 우리 가맹점 비교표뿐이다. 그 둘 밖의 숫자를
 * 만들면 그건 지어낸 값이다. 산식값과 다르면 **왜 다르게 봤는지**를 반드시 쓰게 한다.
 */
export const QUICK_EVAL_REVIEW_SYSTEM_PROMPT = [
  "당신은 PC방 프랜차이즈 점포개발 담당자를 돕는 상권 분석가입니다.",
  "점포개발 **초기 선별** 단계에서, 주소만으로 자동수집한 자료·V62 산식 결과·우리 가맹점 실적표를 읽고",
  "이 후보지에 대한 **당신 자신의 평가**를 씁니다.",
  "",
  "당신이 할 일:",
  "1. **이 상권이 어떤 상권인지** 성격을 규정하세요(예: 주거 밀집 생활상권, 역세권 통행상권,",
  "   대학가, 산업단지 배후 등). 무엇을 근거로 그렇게 봤는지 수치를 들어 말하세요.",
  "2. **장점과 단점·특이점**을 각각 짚으세요. 좋은 말만 쓰지 마세요 — 단점을 빼면 쓸모가 없습니다.",
  "3. **우리 가맹점 실적표와 대 보고 예상 월매출 범위를 당신이 제시하세요.** 어느 매장과 비슷하게",
  "   봤는지, 대당 월매출을 얼마로 잡았는지, PC 몇 대를 곱했는지 계산 과정을 보이세요.",
  "   **산식값과 달라도 됩니다** — 다르면 왜 다르게 봤는지 쓰세요(그게 이 평가의 값입니다).",
  "4. 마지막에 **현장에서 확인할 항목**을 체크리스트로 주세요. 담당자가 그대로 들고 나갑니다.",
  "",
  "반드시 지킬 것:",
  "1. **근거는 주어진 자료뿐입니다.** 이 후보지의 수집 수치와 가맹점 실적표 안에서만 셈하세요.",
  "   그 밖의 통계·업계 평균·기억 속 숫자를 끌어오지 마세요. 모르는 값은 '자료 없음'이라고 쓰세요.",
  "2. 당신이 제시하는 매출은 **범위**로 쓰세요. 한 점으로 단정하지 마세요.",
  "3. **무엇이 기본값으로 메워졌는지** 감안해서 판단하고, 그 사실을 독자에게 알리세요",
  "   (특히 경쟁점 PC 대수와 품질은 실제 조사값이 아닙니다).",
  "4. 한국어로, 초보자도 이해할 수 있게 씁니다. 전문용어는 짧게 풀어서 씁니다.",
  "5. 동그라미 숫자(①②③)를 쓰지 마세요. 1. 2. 3.으로 씁니다.",
  "",
  // ⭐ 2026-09-23 사용자 지시로 **예상매출을 맨 위로** 올렸다
  //    (*"AI 예상매출부분을 위로좀 올려달라는말"*). 담당자가 제일 먼저 보는 게 그것이고,
  //    화면(QuickEvalReview)도 **첫 제목 섹션을 카드로 강조**해서 그린다.
  //    ⚠️ 화면은 제목 **이름**이 아니라 "첫 번째 제목"을 기준으로 잡는다 — 여기 순서를
  //       바꾸면 강조되는 섹션도 따라 바뀐다. 문구만 고치는 건 안전하다.
  "형식(마크다운, 제목은 ##). **이 순서를 지키세요**:",
  "## 가맹점 실적으로 본 예상매출 (AI 자체 판단)",
  "## 한 줄 결론",
  "## 이 상권은 어떤 상권인가",
  "## 장점",
  "## 단점·특이점",
  "## 산식값과의 차이",
  "## 현장에서 확인할 것",
].join("\n");

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? "자료 없음" : `${(v * 100).toFixed(digits)}%`;
const won = (v: number | null | undefined) => (v == null ? "자료 없음" : formatManwonRough(v));
// ⚠️ **대당 매출에 won()을 쓰지 마라.** formatManwonRough는 100만원 단위로 반올림해서
//    65만원을 "100만원"으로, 38만원을 "0만원"으로 뭉갠다(실측 대당은 37.8만~87.9만 범위다).
//    2026-09-23에 화면·프롬프트 8곳이 그렇게 돌고 있었다 — AI가 그 뭉갠 값으로 자기 매출을
//    셈하고 있었으므로 결과에 직접 영향이 있었다. 대당은 언제나 formatManwonPerPc다.
const wonPerPc = (v: number | null | undefined) => (v == null ? "자료 없음" : formatManwonPerPc(v));
const int = (v: number | null | undefined) =>
  v == null ? "자료 없음" : Math.round(v).toLocaleString("ko-KR");

/** V62 결과 + 조립 내역 + 재고 표를 한 덩이 텍스트로 만든다. 이게 AI에 주는 전부다. */
export function buildQuickEvalReviewContext(input: {
  result: EvaluationResult;
  assembly: QuickEvalAssembly;
  collectErrors: string[];
  locationDraftRationale: string | null;
  /** 실적이 있는 우리 가맹점 비교표 — AI가 자체 매출 판단의 근거로 쓴다 */
  peers?: QuickEvalPeerSummary | null;
  floatingMonths?: { months: string[]; monthly: number[] } | null;
}): string {
  const { result, assembly, collectErrors } = input;
  const c = assembly.candidate;

  const counted = assembly.competitorRows.filter((r) => r.counted);
  const excluded = assembly.competitorRows.filter((r) => !r.counted);

  const lines: string[] = [];

  lines.push("[후보지]");
  lines.push(`이름: ${c.name || "(무명)"}`);
  lines.push(`주소: ${c.roadAddress ?? c.address}`);
  lines.push(`자사 기획값: 예상 PC ${int(c.expectedPcCount)}대 · 기본요금 ${int(c.hourlyRate)}원`
    + ` · ${c.floor == null ? "층 미정" : `${c.groundLevel ?? ""}${c.floor}층`}`
    + ` · 엘리베이터 ${c.hasElevator == null ? "미정" : c.hasElevator ? "있음" : "없음"}`);
  lines.push("");

  lines.push("[V62 산식 결과 — 이 값을 그대로 인용할 것]");
  lines.push(`예상 월매출: ${won(result.v62Final)}`);
  lines.push(`보수판단(85%): ${won(result.conservativeSales)} · 상한참고(115%): ${won(result.upperSales)}`);
  lines.push(`상권수요: ${int(result.marketDemand)} · 상권등급 ${result.marketGrade ?? "자료 없음"}`
    + ` · 상권성격 ${result.marketCharacter ?? "자료 없음"}`);
  lines.push(`경쟁IP: ${int(result.competitorIp)} · IP당수요: ${result.ipPerDemand == null ? "자료 없음" : result.ipPerDemand.toFixed(1)}`);
  lines.push(`자사 경쟁력점수: ${result.ownCompetitivenessScore?.toFixed(2) ?? "자료 없음"}`
    + ` · 경쟁점 평균: ${result.competitorAvgCompetitiveness?.toFixed(2) ?? "자료 없음"}`
    + ` · 경쟁력격차: ${result.competitivenessGap?.toFixed(3) ?? "자료 없음"}`);
  lines.push(`예상 가동률: ${pct(result.expectedUtilization)}`
    + `${result.capacityCapped ? " (가동률 상한에 걸려 매출이 깎였다 = 수요가 대수보다 많다는 신호)" : ""}`);
  lines.push(`입력완성도: ${result.completionStatus ?? "자료 없음"} · 최종판정: ${result.finalJudgement ?? "자료 없음"}`);
  lines.push(`학습모형: ${result.v61ModelLabel} (학습표본 ${result.v61TrainingSampleCount}곳)`);
  lines.push("");

  // ⛔ 2026-09-23 정정 — 여기서 `ADDRESS_ONLY_ACCURACY`의 L3(13.40%)를 "이 도구의 오차"로
  //    넘기고 있었다. **틀렸다.** 그건 검증 배선으로 자사 실측을 쓴 사다리고, 하필 도구의
  //    실제 성적보다 좋아 보인다 — AI가 그 숫자를 근거로 더 자신 있게 쓰게 된다.
  //    도구를 되짚어 잰 `QUICK_EVAL_BACKTEST`를 넘긴다.
  lines.push("[이 추정의 오차 — 이 도구를 되짚어 잰 값]");
  lines.push(
    `${QUICK_EVAL_BACKTEST.measuredAt} 기준 기존 가맹점 ${QUICK_EVAL_BACKTEST.sampleCount}곳을`
      + " **후보지인 척**(조사 자료를 지우고, 자기 자신은 학습에서 뺀 채) 이 도구와 같은 배선으로"
      + " 돌려 실제 매출과 견줬다.",
  );
  lines.push(
    `평균오차 ${pct(QUICK_EVAL_BACKTEST.mape, 2)} · ±20% 안 ${pct(QUICK_EVAL_BACKTEST.within20, 1)}`
      + ` · 예측÷실측 중앙 ${QUICK_EVAL_BACKTEST.medianRatio.toFixed(3)}`
      + `(${QUICK_EVAL_BACKTEST.overCount}/${QUICK_EVAL_BACKTEST.sampleCount}곳이 실제보다 높게 나왔다)`,
  );
  lines.push(
    // ⚠️ 정밀 평가와 견줄 때 **같은 자**를 써야 한다 — 수준보정 오차끼리 견준다.
    //    정밀의 일반 MAPE(8.83%)와 견주면 단위가 다른 값을 나란히 놓는 셈이다.
    // ⛔ 2026-09-23 정정 — 여기 "금액 수준보다 순서가 이 도구의 쓸모다"라고 넘기고 있었다.
    //    **틀렸다.** 이 도구는 후보지를 줄 세우는 게 아니라 **개별 점포를 평가**한다
    //    (사용자 2026-09-23). 그러니 AI에게도 "순서만 보면 된다"고 말하면 안 된다.
    `배율을 뺀 뒤에도 ${pct(QUICK_EVAL_BACKTEST.leveledMape, 2)}의 오차가 남는다`
      + `(현장조사를 다 한 정밀 평가는 같은 자로 ${pct(QUICK_EVAL_BACKTEST.preciseLeveledMape, 2)}).`
      + " **이 도구는 개별 후보지를 평가하는 것이므로, 금액을 단정하지 말고 범위로 말하라.**",
  );
  lines.push(
    "⚠️ 위 측정은 기존 가맹점으로 잰 것이고, 가시성을 표본 중앙값으로 고정해서 쟀다."
      + " 이 도구는 가시성을 AI로 매기므로 조건이 완전히 같지 않다. 후보지에서는 경쟁점 자료가"
      + " 더 부실해 실제로는 이보다 나쁠 수 있다.",
  );
  lines.push(`⚠️ 쓰임 제한: ${QUICK_EVAL_USAGE_LIMIT}`);
  lines.push("");

  lines.push("[자동수집한 상권 자료]");
  lines.push(`주거인구 500m: ${int(c.pop500m)}명 · 1km: ${int(c.pop1km)}명`
    + ` (남 비율 ${c.male1kmRatio == null ? "자료 없음" : pct(c.male1kmRatio)})`);
  lines.push(`1km 연령: 10대 ${int(c.age1km_10_19)} · 20대 ${int(c.age1km_20_29)} · 30대 ${int(c.age1km_30_39)}`
    + ` · 40대 ${int(c.age1km_40_49)} · 50대 ${int(c.age1km_50_59)}`);
  lines.push(`유동인구 500m 일평균: ${int(c.floating500Avg)}명`
    + ` (남 ${int(c.floating500Male)} · 10대 ${int(c.floating500_10s)} · 20대 ${int(c.floating500_20s)}`
    + ` · 30대 ${int(c.floating500_30s)})`);
  lines.push("");

  lines.push("[경쟁점 — 카카오 장소검색 500m]");
  lines.push(`센 경쟁점 ${counted.length}곳 (PC 대수는 전부 미확인이라 기본값으로 계산됨)`);
  for (const row of counted.slice(0, 15)) {
    lines.push(`- ${row.place.name} (${row.place.distanceM}m)${row.categoryUnknown ? " [업종 미확인]" : ""}`);
  }
  if (counted.length > 15) lines.push(`- ... 외 ${counted.length - 15}곳`);
  if (excluded.length) {
    lines.push(`제외한 곳 ${excluded.length}곳 (PC방이 아니라고 판정):`);
    for (const row of excluded.slice(0, 10)) {
      lines.push(`- ${row.place.name} — ${row.excludedReason}`);
    }
  }
  lines.push("");

  // ⭐ 가맹점 실적표 — AI가 "우리 가맹점 데이터를 보니 이 정도"를 셈할 유일한 근거다.
  if (input.peers && input.peers.nearest.length) {
    const p = input.peers;
    const hasDemand = result.marketDemand != null && result.marketDemand > 0;
    lines.push("[우리 가맹점 실적표 — 당신의 매출 판단 근거는 이 표와 위 수치뿐이다]");
    lines.push(
      `실적이 있는 블랙라벨 가맹점 ${p.totalCount}곳 중, ` +
        (hasDemand ? "이 후보지와 상권수요가 가까운 순" : "⚠️ 후보지 상권수요를 몰라 매출 높은 순") +
        `으로 ${p.nearest.length}곳:`,
    );
    lines.push("  매장 / 개점 / 상권수요(후보지 대비) / 경쟁IP / PC대수 / 기본요금 / 실제월매출 / 대당월매출");
    for (const peer of p.nearest) {
      lines.push(
        `  - ${peer.storeName} / ${peer.openedAt ?? "개점일 모름"}` +
          ` / ${int(peer.marketDemand)}${peer.demandRatio != null ? `(${peer.demandRatio.toFixed(2)}배)` : ""}` +
          ` / ${int(peer.competitorIp)} / ${int(peer.pcCount)}대 / ${int(peer.hourlyRate)}원` +
          ` / ${won(peer.actualMonthlyRevenueAvg)} / ${wonPerPc(peer.revenuePerPc)}`,
      );
    }
    lines.push(
      `  가까운 ${p.nearest.length}곳의 대당월매출: 최소 ${wonPerPc(p.nearestRevenuePerPc.min)}` +
        ` · 중앙 ${wonPerPc(p.nearestRevenuePerPc.median)} · 최대 ${wonPerPc(p.nearestRevenuePerPc.max)}`,
    );
    lines.push(
      `  가맹점 전체 중앙값: 상권수요 ${int(p.medians.marketDemand)} · ${int(p.medians.pcCount)}대` +
        ` · 기본요금 ${int(p.medians.hourlyRate)}원 · 월매출 ${won(p.medians.actualMonthlyRevenueAvg)}` +
        ` · 대당 ${wonPerPc(p.medians.revenuePerPc)}`,
    );
    lines.push(
      "  ⚠️ 이 표의 값은 저장된 기존점 자료를 그대로 쓴 것이라 산식이 쓰는 값과 미세하게 다를 수 있다.",
    );
    lines.push("  ⚠️ 개점 시점이 다르면 기본요금·1인당 이용시간이 달라 대당매출도 달라진다 — 개점일을 같이 보라.");
    lines.push("");
  } else {
    lines.push("[우리 가맹점 실적표]");
    lines.push("자료 없음 — 매출을 자체 판단할 근거가 없다. 그 경우 매출 범위를 제시하지 말고 그렇게 밝혀라.");
    lines.push("");
  }

  lines.push("[AI 입지평가 초안]");
  if (input.locationDraftRationale) {
    lines.push(input.locationDraftRationale);
  } else {
    lines.push("입지평가 초안이 없다(수집 실패 또는 건너뜀). 입지 항목 없이 계산된 값이다.");
  }
  lines.push("");

  lines.push("[무엇이 자동이고 무엇이 기본값인가 — 재고 표]");
  for (const note of QUICK_EVAL_FIELD_NOTES) {
    lines.push(`- ${note.label} [${note.source}] ${note.basis}`);
  }
  lines.push("");

  if (assembly.missing.length) {
    lines.push("[자동으로 못 채운 것]");
    for (const m of assembly.missing) lines.push(`- ${m}`);
    lines.push("");
  }
  if (collectErrors.length) {
    lines.push("[수집 중 생긴 문제]");
    for (const e of collectErrors) lines.push(`- ${e}`);
    lines.push("");
  }

  return lines.join("\n");
}
