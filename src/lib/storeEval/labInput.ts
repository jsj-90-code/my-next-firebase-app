// 교과서식 모델에 넣을 **입력 한 벌**을 만드는 곳. 실험실 화면(/store-eval/lab)과 측정
// 하네스가 **똑같은 이 코드**를 쓴다.
//
// ── 왜 따로 뺐나 (2026-09-16) ──────────────────────────────────────────────
// 하네스가 화면의 조립 코드를 베껴 쓰고 있었다. 그러다 입지 5항목이 **화면에만** 추가되면서
// 하네스는 `location`을 아예 안 넘기게 됐고, 그 상태로 잰 MAPE 54.6%가 한동안 "교과서식
// 성적"으로 돌아다녔다 — 입지가 빠진 숫자였다. 조립을 한 곳에 두면 이 종류의 사고가
// 구조적으로 안 난다. **새 항목을 화면에 붙이면 하네스도 자동으로 같이 본다.**
//
// ⚠️ 여기는 교과서식(실험실) 전용이다. 운영 산식(calc.ts / usageRevenue.ts)은 이 파일을
//    읽지 않는다 — 교과서식은 운영 산식을 덮지 않는다(2026-09-16 사용자 확정).

import {
  computeCompetitorIp,
  computeLocationScoreFromFacts,
} from "@/lib/storeEval/calc";
import { computeLabZoneComposition } from "@/lib/storeEval/labZoneComposition";
import { labComputeSpecScore } from "@/lib/storeEval/labSpecScore";
import { evaluationMonths } from "@/lib/storeEval/evaluationSalesPeriod";
import { existingStoreSourceCode } from "@/lib/storeEval/existingStoreEvaluation";
import type { QualityParts, TextbookInput } from "@/lib/storeEval/textbookModel";
import type { Competitor, ExistingStore, ModelSettings } from "@/lib/storeEval/types";

export type LabRow = { input: TextbookInput; actualRevenue: number };

/**
 * 매장별 **실측 월평균 가동률**(0~1). 수요 축척을 여기에 맞춘다(2026-09-16).
 *
 * 게토에서 받은 값과 대조했을 때 평균차 3.34% · r=1.000으로 사실상 같은 값이라,
 * 파이어스토어에 이미 있는 `utilizationRate` 필드를 쓴다(별도 수집 불필요).
 *
 * ⚠️ **평가창(개점 다음 달부터 12개월) 안에서만 평균 낸다.** 조립을 한 곳에 두는 이 파일의
 *    취지대로 여기에 넣었다 — 이것만 화면과 하네스에 따로 베껴져 있어서 2026-09-17에 사고가
 *    났다. 화면은 `listEvaluationSales`가 그 12개월 문서만 읽어와 저절로 맞았지만, 하네스는
 *    스냅샷 덤프(컬렉션 통째)를 넘겨 **전 기간**을 평균 내고 있었다. 41곳 중 37곳이 섞였고,
 *    개점 초기 가동률이 높아 전 기간 평균이 한 방향으로 낮게 쏠린 계통편향이었다
 *    (시흥정왕점 -6.6%p · 전대상대점 -4.3%p).
 *
 *    여기서 한 번 더 거르므로 **이미 걸러진 입력이 와도, 통째로 와도 같은 값**이 나온다.
 */
export function utilizationByStore(
  sales: Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>,
  stores: Array<Pick<ExistingStore, "storeCode" | "openedAt">>,
): Map<string, number> {
  const windowByCode = new Map(stores.map((s) => [s.storeCode, new Set(evaluationMonths(s.openedAt))]));
  const acc = new Map<string, number[]>();
  for (const s of sales) {
    const rate = s.utilizationRate;
    if (rate == null || !(rate > 0)) continue;
    if (!windowByCode.get(s.storeCode)?.has(s.yearMonth)) continue;
    acc.set(s.storeCode, [...(acc.get(s.storeCode) ?? []), rate]);
  }
  const out = new Map<string, number>();
  for (const [code, vs] of acc) out.set(code, vs.reduce((a, b) => a + b, 0) / vs.length);
  return out;
}

// ── 경쟁력 항목별 점수 뽑기 (2026-09-17) ──────────────────────────────────
//
// ⚠️ 사양·존구성은 **저장 필드가 아니라 파생값**이다. 스냅샷에 `ownSpecScore`가 없다고
//    "자료 없음"으로 읽어 2026-09-16에 한 번 틀렸다. 원자료는 멀쩡히 있고, 운영 산식과
//    **같은 함수**로 계산해야 자사·경쟁점이 같은 자에 놓인다.
//
// ⚠️ 입지는 여기 없다. 경쟁력점수 안에 섞으면 효과가 없었고(r 0.554 -> 0.562, 잭나이프
//    하한이 유의선 아래), 밖에서 곱해야 살아났다. buildLabRows의 `location`을 볼 것.
export function ownQualityParts(s: ExistingStore, pc: number | null, settings: ModelSettings): QualityParts {
  // 2026-09-17 — 존구성은 실험실 전용 잣대를 쓴다(labZoneComposition.ts). 운영의
  // computeOwnZoneComposition은 존 **이름** 종류를 세는데, 그 이름표가 자사에만 있어서
  // 종류를 세면 자사가 항상 이겼다. 여기서는 룸 종류만 세고 좌석은 전부 센다.
  const zone = computeLabZoneComposition({
    counts: {
      singleSeatCount: s.ownSingleSeatCount ?? null, room1: s.ownRoom1 ?? null, room2: s.ownRoom2 ?? null,
      teamRoom: s.ownTeamRoom ?? null, coupleZone: s.ownCoupleZone ?? null, vipZone: s.ownVipZone ?? null,
      friendsZone: s.ownFriendsZone ?? null, firstClassZone: s.ownFirstClassZone ?? null,
      // 자사 입력에는 "일반 2인석" 칸이 없다 — 우리 2인석은 커플존으로 들어간다.
      regularCoupleSeatCount: null,
    },
    teamRoomTotalSeats: s.ownTeamRoomTotalSeats ?? null, totalPcCount: pc, own: true,
  });
  return {
    // 2026-09-18 — 사양도 실험실 전용 잣대를 쓴다(labSpecScore.ts). 운영은 세대 산술이라
    // RTX 3060 Ti(2.25)가 RTX 4060(3.00)보다 낮게 깔리는 등 실제 서열과 어긋난 자리가 있었다.
    spec: labComputeSpecScore({
      vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
      cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
      ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
      monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
    }, settings),
    food: s.ownFoodScore ?? null,
    zone: zone.composition,
    interior: s.ownInteriorScore ?? null,
    management: s.ownManagementScore ?? null,
  };
}

/**
 * 경쟁점까지의 거리(m). **좌표가 양쪽에 다 있으면 좌표로 잰 값을 쓰고**, 없으면 현장조사가
 * 적어둔 `distanceM`으로 떨어진다.
 *
 * ── 왜 좌표를 먼저 쓰나 (2026-09-17) ────────────────────────────────────────
 * 사용자 확인: *"조사 거리 내가 잘못 작성한 듯. 초기 데이터."* 경쟁점 좌표를 225곳 전부
 * 손으로 찍고 나서 조사 거리와 대조했더니 14곳이 크게 어긋났는데, **틀린 건 좌표가 아니라
 * 조사 거리**였다(수원인계 EFC 205m로 적혔지만 실제 481m 등).
 *
 * 이 거리는 품질 모드에서 **유효거리(300m) 안쪽 경쟁점만 세는 데** 쓰인다. 거리가 틀리면
 * 경쟁점이 통째로 빠지거나 없던 게 들어온다 — 225곳 중 4곳이 그랬다.
 *
 * ⚠️ 조사 거리 기록(`distanceM`)은 **고치지 않는다.** 현장에서 적은 값은 그대로 두고 여기서
 *    파생값으로만 갈아끼운다. 나중에 어느 쪽이 맞았는지 되짚을 수 있어야 한다.
 * ⚠️ 운영 산식(calc.ts / usageRevenue.ts / evaluate.ts)은 distanceM을 아예 안 읽는다.
 *    이 변경은 실험실 전용이다([[project_textbook_is_lab_only]]).
 */
export function rivalDistanceM(
  store: Pick<ExistingStore, "lat" | "lng">,
  rival: Pick<Competitor, "lat" | "lng" | "distanceM">,
): number | null {
  const { lat: sLat, lng: sLng } = store;
  const { lat: rLat, lng: rLng } = rival;
  if (sLat != null && sLng != null && rLat != null && rLng != null) {
    const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(rLat - sLat), dLng = rad(rLng - sLng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(sLat)) * Math.cos(rad(rLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  return rival.distanceM == null ? null : Number(rival.distanceM);
}

export function rivalQualityParts(c: Competitor, settings: ModelSettings): QualityParts {
  // 자사와 **같은 함수**를 쓴다. 잣대가 둘이면 비대칭이 또 생긴다.
  const zone = computeLabZoneComposition({
    counts: {
      singleSeatCount: c.singleSeatCount ?? null, room1: c.room1 ?? null, room2: c.room2 ?? null,
      teamRoom: c.teamRoom ?? null, coupleZone: c.coupleZone ?? null, vipZone: c.vipZone ?? null,
      friendsZone: c.friendsZone ?? null, firstClassZone: c.firstClassZone ?? null,
      regularCoupleSeatCount: c.regularCoupleSeatCount ?? null,
    },
    teamRoomTotalSeats: c.teamRoomTotalSeats ?? null,
    totalPcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
    own: false,
  });
  return {
    spec: labComputeSpecScore({
      vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
      cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
      ram: c.ram ?? null, ramTop: c.ramTop ?? null,
      monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
    }, settings),
    food: c.foodScore ?? null,
    zone: zone.composition,
    interior: c.interiorScore ?? null,
    management: c.managementScore ?? null,
  };
}

/**
 * 로드뷰 판정에서 나온 입지 4·5번 값. 클수록 좋다.
 *
 * 문항은 전부 "예 = 나쁨"이라 예 개수를 뒤집어 만든다(writeRoadviewJudgmentsToFirestore.mjs):
 * 동선 방해 = 5 − 예 개수(0~4), 가시성 = 4 − 예 개수(0~3).
 *
 * ⚠️ 사람이 표본을 직접 보고 대조하기 전이다. 그리고 계수가 0이라 아직 계산에 안 들어간다.
 */
export type RoadviewJudgment = { flowBlock: number | null; visibility: number | null };

// ── QSC(본사 점검 점수) -> 관리 점수 (2026-09-17) ─────────────────────────
//
// **실험실 전용이다.** 운영 V62의 관리 점수는 계속 4.00 고정이다.
//
// ── 왜 관리 점수 안에 넣나 (배율로 곱하지 않고) ───────────────────────────
// 자료만 보면 점유율에 `(QSC/기준)^2.5`를 곱하는 쪽이 낫다(MAPE 20.61% vs 22.09%).
// 그런데 사용자가 뜻으로 정했다:
//
//   *"나는 관리점수에 QSC가 반영되었으면한데, 배율적용하면 약간 보정값이잖아"*
//
// 이 저장소 규칙이 그쪽이다 — **항목은 뜻으로 정하고 계수만 자료로 정한다.** 검정은
// "이 항목이 중요한가"가 아니라 "자료에서 주워온 숫자를 믿어도 되나"를 묻는 것이다.
// 관리 점수는 원래 "그 매장이 관리를 얼마나 잘하나"를 재는 칸이고, QSC가 바로 그걸 잰다.
// 배율은 같은 것을 산식 밖에 덧붙이는 보정값이 된다.
//
// ── 환산자 — 100점이 5점, 60점이 1점 ─────────────────────────────────────
// 앵커를 절대값으로 잡는다. "우리 표본에서 제일 낮은 곳이 몇 점"이 아니라 **"몇 점이면
// 최하인가"**를 정한 것이라, 표본이 늘어도 점수의 뜻이 안 흔들린다.
//
//   관리 = 1 + (QSC - 60) x (4/40),  1~5로 자름
//
// ⚠️ **바닥은 `[감각]` 계수다.** 자료가 방향은 지지하지만 값을 확정해주지 못한다(아래).
//
// ── 바닥 60을 고른 근거 ───────────────────────────────────────────────────
// 두 자리에서 재봤고 **답이 갈렸다.** 갈린 이유까지 확인했다.
//
//   바닥   관리 평균   점유율 MAPE(23곳)   매출 MAPE(38곳)   중앙    최대
//   안 씀    4.00        23.72%            23.15%         14.4%   83%
//  **60     4.25        22.73%          **22.28%**       15.0%   87%**  <- 채택
//    70     4.00        22.47%            22.56%         17.1%   81%
//    80     3.51      **22.09%**          23.38%         18.6%   71%
//    85     3.08        22.20%            24.35%         20.7%   65%
//
// **점유율 기준은 바닥 80을, 매출 기준은 바닥 60을 고른다.** 독점 매장 15곳 때문이다 —
// 경쟁점이 없으면 나눌 상대가 없어 관리를 내려도 점유율이 안 변하는데, 경쟁 상권 매장만
// 내려가니 편향이 생기고 그게 매출 단계에서 드러난다. 모델은 이미 과소예측(-9.2%)이라
// 관리를 더 내리면 나빠진다. **매출이 최종 성적이므로 매출 기준을 쓴다.**
//
// 관문(매출 38곳): LOO 벌어짐 **0.24%p** · 훈련겹이 바닥 60을 35/38회 고름 — 과적합이 아니다.
// ❌ **대조군은 어떤 바닥에서도 못 넘는다**: 60 p=0.075 · 70 p=0.144 · 80 p=0.259.
//    (점유율 단계에서는 넘는다 — 바닥 80에서 p=0.040. 매출까지 오면 수요식·단가·상품몫
//     오차가 겹겹이 쌓여 관리 효과가 묻힌다.)
//    그래서 **계수를 자료로 확정하지 않고 뜻으로 정했다.** 바닥 80은 매출 기준 효과가
//    **마이너스(-0.22%p)**라 버렸다.
//
// 바닥 60이면 부수적으로 이런 성질이 있다:
//   - 점검 **1건짜리 매장이 4곳**인데(구미산동·화명대로·진주혁신·하남덕풍) 기울기가 얕아
//     그 1건이 점수를 덜 흔든다. QSC 1점 = 관리 0.1점(바닥 80은 0.2점).
//   - 자사 30곳이 전부 3.22~5.00으로 **경쟁점 평균 2.67 위**에 남는다. 자사는 본사 QSC,
//     경쟁점은 현장조사 주관 평가라 **자가 다르다** — 다른 자로 잰 값을 뒤집을 근거가 없다.
//
// ⚠️ 이상치 3건을 안 빼면 점유율 관문도 미달이었다(p=0.070 -> 0.040). usableQscRecord 참고.
const QSC_TOP = 100, QSC_FLOOR = 60;

/** QSC 점수(0~100)를 관리 점수(1~5)로 환산한다. 값이 없으면 null — 지어내지 않는다. */
export function qscToManagementScore(qsc: number | null | undefined): number | null {
  if (qsc == null || !Number.isFinite(qsc) || qsc <= 0) return null;
  const raw = 1 + (qsc - QSC_FLOOR) * (4 / (QSC_TOP - QSC_FLOOR));
  return Math.max(1, Math.min(5, raw));
}

/**
 * QSC가 없는 매장에 쓸 값 — **가맹점 평균**이다. 상수로 박지 않고 그때그때 계산한다
 * (박아두면 자료가 늘 때 조용히 낡는다).
 *
 * ⚠️ 왜 4.00으로 두지 않나: 30곳은 QSC 자(평균 3.5)로, 11곳은 옛 자(4.00)로 재면 **두 자가
 *    섞인다.** 그러면 QSC 없는 매장이 "관리를 잘하는 곳"으로 둔갑한다. 모르는 곳엔 평균을
 *    준다 — 후보지에 주는 값과 같다.
 */
export function franchiseAverageManagement(mapped: (number | null)[]): number | null {
  const vs = mapped.filter((v): v is number => v != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

export type QscRecord = { date: string; score: number; form?: string };

/**
 * 관리 점수를 만들 때 쓰는 점검 창의 끝(개점 후 개월). **`Infinity` = 개점 이후 전부.**
 *
 * ── 왜 평가창(12개월)이 아닌가 (2026-09-17) ───────────────────────────────
 * 처음엔 매출 평가창과 같은 12개월로 잘랐다. 시점을 맞춰야 짝이 맞는다는 이유였고 원칙도
 * 그쪽이다. 그런데 **QSC 점검이 연 1~2회라 12개월 창에 안 걸리는 매장이 많다.**
 * 사용자 지적으로 드러났다 — *"청주터미널 QSC체크리스트있는데"* (있다. 제일 이른 게
 * 개점 13개월째라 한 달 차이로 빠졌다). 같은 처지가 7곳이고 4곳은 13~14개월이었다.
 *
 * 창을 넓혀 재보니 **12개월만 유독 나빴다**(바닥 60 고정 · 매출 38곳):
 *   창        실측 매장   관리 평균   MAPE     중앙    최대
 *   12개월     29/38      4.25     22.28%   15.0%   87%
 *   15개월     34/38      4.26     21.94%   13.9%   84%
 *   24개월     34/38      4.28     21.78%   13.2%   80%
 *   **전체기간  35/38      4.20     22.02%   13.7%   80%**
 * 15개월 위로는 전부 0.24%p 안이라 노이즈다. 전체기간을 고른 이유는 성적이 아니라 둘이다:
 *   1. **표본이 제일 많다**(35/38) — 6곳이 새로 들어온다.
 *   2. **점검 1건으로 판정하는 매장이 8곳에서 4곳으로 준다.** 구미산동점은 1건(82.2)으로
 *      3.22점을 받던 것이 7건 평균(73.9)으로 2.39점이 된다 — 1건짜리 판정보다 낫다.
 * 사용자 방향: *"다른매장 개월수늘려서 별차이없으면 평균값으로 조지자고"*
 *
 * ⚠️ 시점 통일을 포기한 것이므로 대가가 있다 — 2026년 점검으로 2024년 매출을 설명하게 된다.
 *    그래도 쓰는 근거는 **코호트 교란이 거의 없다는 측정**이다(QSC ↔ 개점시점 r=0.158).
 *    여기 값을 바꾸면 `_textbookFull.test.ts`의 창 훑기를 다시 돌리고 화면 설명도 고칠 것.
 */
export const QSC_WINDOW_MONTHS = Infinity;

/**
 * 평균에 넣어도 되는 점검 기록인가 (2026-09-17 사용자 확인: *"0점·오픈점검 둘 다 제외"*).
 *
 * - **0점** — 송도점은 개점 0개월(오픈 2주 차)이고 창원남양점은 같은 매장의 다른 점검이
 *   전부 90점대다. 미실시나 입력오류지 "관리가 0점"이 아니다.
 * - **오픈 매장 점검** — 오픈 직후 체크리스트라 일반 QSC와 **재는 것이 다르다.** 같은 자에
 *   놓으면 그 매장이 부당하게 낮아진다(송도점 50점이 여기서 나왔다).
 *
 * 나머지 서식 넷은 섞어 쓴다 — 평균이 87.3~92.4로 큰 차이가 없어 교란이 아니다.
 */
export function usableQscRecord(r: QscRecord): boolean {
  return r.score > 0 && !(r.form ?? "").includes("오픈 매장 점검");
}

/**
 * 평가창(개점 다음 달~12개월) 안 점검의 평균. 없으면 null.
 *
 * ⚠️ **전체 기간 평균으로 메우지 않는다.** 매출 목표값이 평가창 12개월 평균이라 점검 점수도
 *    같은 창에서 재야 짝이 맞는다 — 자사 시설 점수를 평가 시점으로 통일해 둔 것과 같은 이유다.
 *    평가창 밖 점검은 그 매출을 만들어낸 운영 상태가 아니다.
 */
export function qscInWindowAverage(
  records: QscRecord[],
  openedAt: string | null,
  /**
   * 창의 끝(개점 후 개월). 기본 12 = 매출 평가창과 같다. `Infinity`면 개점 이후 전부.
   * ⚠️ 이걸 늘리는 건 **시점 통일을 포기하고 표본을 사는 거래**다 — 값을 고르기 전에
   *    `_textbookFull.test.ts`의 창 훑기를 보고 정할 것.
   */
  maxMonths = QSC_WINDOW_MONTHS,
): number | null {
  if (!records.length || !openedAt) return null;
  const open = new Date(openedAt);
  if (Number.isNaN(open.getTime())) return null;
  const vals = records.filter(usableQscRecord).filter((r) => {
    const d = new Date(r.date.replace(/\./g, "-"));
    if (Number.isNaN(d.getTime())) return false;
    const m = (d.getFullYear() - open.getFullYear()) * 12 + (d.getMonth() - open.getMonth());
    return m >= 1 && m <= maxMonths;
  }).map((r) => r.score);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export type BuildLabRowsArgs = {
  /** prepareExistingStoresForEvaluation을 이미 통과한 기존점. */
  stores: ExistingStore[];
  /** 후보지코드 -> 경쟁점 목록. */
  compsByCode: Map<string, Competitor[]>;
  /** 매장코드 -> 실측 월평균 가동률(0~1). 수요 축척을 여기 맞춘다. */
  utilByStore: Map<string, number>;
  settings: ModelSettings;
  /**
   * `existing:<매장코드>` -> 로드뷰 판정. 없으면 그 매장의 4·5번은 null로 남는다 —
   * 판정 못 한 곳에 값을 지어내지 않는다.
   */
  roadviewByKey?: Map<string, RoadviewJudgment>;
  /**
   * 매장코드 -> QSC 평균. 주면 자사 **관리 점수를 이 값으로 갈아끼운다**
   * (qscToManagementScore). 안 주면 저장된 `ownManagementScore`(전부 4.00)를 그대로 쓴다.
   * QSC가 없는 매장에는 있는 곳들의 평균을 넣는다 — 두 자가 섞이지 않게.
   */
  qscByStoreCode?: Map<string, number>;
};

/**
 * 학습·검증에 쓸 행을 만든다. 제외매장과 실매출 없는 곳은 빠진다.
 *
 * 값을 지어내지 않는다 — 자료가 없는 항목은 null로 넘기고, 모델이 그 항을 중립(1배)으로
 * 빼도록 둔다. 빠진 자리를 평균이나 0으로 메우면 "모른다"가 "나쁘다"로 둔갑한다.
 */
export function buildLabRows({ stores, compsByCode, utilByStore, settings, roadviewByKey, qscByStoreCode }: BuildLabRowsArgs): LabRow[] {
  // QSC를 쓸 때만 계산한다. 가맹점 평균은 **환산한 뒤**의 평균이다 — 점수를 먼저 평균 내고
  // 환산하면 다른 값이 나온다(환산이 1~5로 잘리는 구간이 있어서).
  const qscAvg = qscByStoreCode?.size
    ? franchiseAverageManagement(stores.map((s) => qscToManagementScore(qscByStoreCode.get(s.storeCode))))
    : null;
  const rows: LabRow[] = [];
  for (const s of stores) {
    if (s.excludedFromModel || !s.actualMonthlyRevenueAvg) continue;
    const code = existingStoreSourceCode(s);
    const cs = compsByCode.get(code) ?? [];
    const rv = roadviewByKey?.get(`existing:${s.storeCode}`) ?? null;
    const sr = s as unknown as Record<string, number | null>;
    rows.push({
      actualRevenue: s.actualMonthlyRevenueAvg,
      input: {
        storeCode: s.storeCode, storeName: s.storeName,
        pcCount: s.evaluationPcCount ?? s.pcCount,
        hourlyRate: s.hourlyRate,
        actualUtilization: utilByStore.get(s.storeCode) ?? null,
        // 특수수요는 이제 **수요 산식 안에서** 배수로 쓴다(2026-09-16). 입지 보정이 아니다.
        specialDemandType: s.specialDemandType ?? null,
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        // 품질 모드용 — 거리로 걸러야 하므로 합계가 아니라 낱개로 넘긴다.
        ownQualityParts: (() => {
          const parts = ownQualityParts(s, s.evaluationPcCount ?? s.pcCount, settings);
          if (!qscByStoreCode?.size) return parts;
          // 관리 점수를 QSC 환산값으로 갈아끼운다. 그 매장에 QSC가 없으면 가맹점 평균.
          return { ...parts, management: qscToManagementScore(qscByStoreCode.get(s.storeCode)) ?? qscAvg ?? parts.management };
        })(),
        rivals: cs
          .filter((c) => c.investigationStatus !== "경쟁점없음")
          .map((c) => ({
            // 경쟁점 pcCount는 전 문서가 0이다 — appliedPcCount/totalPcCount를 써야 한다.
            ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0),
            distanceM: rivalDistanceM(s, c),
            parts: rivalQualityParts(c, settings),
          }))
          .filter((r) => r.ip > 0),
        // 입지 5항목 (2026-09-17). 기존 주관 3항목(상권위치·동선/선점경쟁/접근가시성)은 안 쓴다 —
        // 1~5점인데 실제로 3~4개 값만 쓰였고 셋 다 유의선 미달이었다.
        location: {
          // 상권 중심도 — 유동 300m/1km. 1보다 크면 우리 문 앞이 상권 평균보다 빽빽하다.
          centrality: s.floating300Avg != null && s.floating1000Avg != null && s.floating1000Avg > 0
            ? (s.floating300Avg / s.floating1000Avg) * (1000 / 300) ** 2
            : null,
          // 접근성 — 경쟁점과 **같은 함수**로 매긴다. 자사만 다른 자를 쓰면 뜻이 없어진다.
          access: computeLocationScoreFromFacts(s.floor ?? null, s.groundLevel ?? null, s.hasElevator ?? null),
          // 유동 방향 — 편심도 0~1. 0이면 사방이 고르고(상권 한가운데), 1에 가까울수록
          // 한쪽에만 몰렸다(상권 끝). 2026-09-16에 52곳 전부 채웠다.
          // ⚠️ 계수 ω는 0이라 지금은 계산에 안 들어간다 — 중심도가 이미 이 신호를 먹어
          // 대조군을 못 넘었다. 값을 보여주고 스위치로 켤 수 있게만 해 둔다.
          direction: s.flowEccentricity ?? null,
          // 동선 방해·가시성 — 로드뷰를 자동으로 찍어 예/아니오 사실만 판정한 값이다
          // (2026-09-16, 52곳 중 49곳). 점수를 매긴 게 아니라 감점 문항의 예 개수를 뒤집은
          // 값이다. 판정 못 한 곳은 null로 남긴다 — 지어내지 않는다.
          // ⚠️ 계수가 0이라 아직 계산에 안 들어간다. 사람 표본 대조도 남아 있다.
          flowBlock: rv?.flowBlock ?? null,
          visibility: rv?.visibility ?? null,
        },
        pop500m: s.pop500m, pop1km: s.pop1km,
        // 연령별 이용률을 지역 성비로 섞는 데 쓴다(2026-09-16). 성별 x 연령 교차 자료는
        // 존재하지 않으므로 "연령대 안 성비 = 지역 전체 성비"로 근사한다.
        residentMaleRatio: s.male1kmRatio ?? null,
        floatingMaleRatioByRadius: {
          100: s.floating100Avg ? (s.floating100Male ?? 0) / s.floating100Avg : null,
          200: s.floating200Avg ? (s.floating200Male ?? 0) / s.floating200Avg : null,
          300: s.floating300Avg ? (s.floating300Male ?? 0) / s.floating300Avg : null,
          400: s.floating400Avg ? (s.floating400Male ?? 0) / s.floating400Avg : null,
          500: s.floating500Avg ? (s.floating500Male ?? 0) / s.floating500Avg : null,
        },
        residentAges: {
          age0s: sr.age1km_0_9 ?? 0, age10s: sr.age1km_10_19 ?? 0, age20s: sr.age1km_20_29 ?? 0,
          age30s: sr.age1km_30_39 ?? 0, age40s: sr.age1km_40_49 ?? 0, age50s: sr.age1km_50_59 ?? 0,
          age60plus: (sr.age1km_60_69 ?? 0) + (sr.age1km_70_79 ?? 0) + (sr.age1km_80plus ?? 0),
        },
        // 2026-09-15 — 100/200/300/400m 수집 경로를 열었다(소상공인365 반경 선택). 아직 안 모은
        // 매장은 null이라 그 반경을 고르면 "자료없음"으로 빠진다.
        floatingByRadius: {
          100: s.floating100Avg ?? null,
          200: s.floating200Avg ?? null,
          300: s.floating300Avg ?? null,
          400: s.floating400Avg ?? null,
          500: s.floating500Avg,
        },
        floatingAgesByRadius: {
          100: s.floating100Avg == null ? null : {
            age10s: s.floating100_10s ?? 0, age20s: s.floating100_20s ?? 0,
            age30s: s.floating100_30s ?? 0, age40s: s.floating100_40s ?? 0,
            age50s: s.floating100_50s ?? 0, age60plus: s.floating100_60plus ?? 0,
          },
          200: s.floating200Avg == null ? null : {
            age10s: s.floating200_10s ?? 0, age20s: s.floating200_20s ?? 0,
            age30s: s.floating200_30s ?? 0, age40s: s.floating200_40s ?? 0,
            age50s: s.floating200_50s ?? 0, age60plus: s.floating200_60plus ?? 0,
          },
          300: s.floating300Avg == null ? null : {
            age10s: s.floating300_10s ?? 0, age20s: s.floating300_20s ?? 0,
            age30s: s.floating300_30s ?? 0, age40s: s.floating300_40s ?? 0,
            age50s: s.floating300_50s ?? 0, age60plus: s.floating300_60plus ?? 0,
          },
          400: s.floating400Avg == null ? null : {
            age10s: s.floating400_10s ?? 0, age20s: s.floating400_20s ?? 0,
            age30s: s.floating400_30s ?? 0, age40s: s.floating400_40s ?? 0,
            age50s: s.floating400_50s ?? 0, age60plus: s.floating400_60plus ?? 0,
          },
          500: {
            age10s: s.floating500_10s ?? 0, age20s: s.floating500_20s ?? 0,
            age30s: s.floating500_30s ?? 0, age40s: s.floating500_40s ?? 0,
            age50s: s.floating500_50s ?? 0, age60plus: s.floating500_60plus ?? 0,
          },
        },
      },
    });
  }
  return rows;
}
