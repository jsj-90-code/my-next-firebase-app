// 존구성 — **실험실 전용** 재정의 (2026-09-17 밤).
//
// ⚠️ 운영 V62는 `calc.ts`의 `computeOwnZoneComposition` / `computeCompetitorZoneComposition`을
//    그대로 쓴다. 이 파일은 실험실(/store-eval/lab)과 측정 하네스만 읽는다.
//
// ── 왜 새로 만드나 ─────────────────────────────────────────────────────────
// 기존 존구성은 **8개 존 이름 중 몇 가지를 갖고 있나**로 다양성을 셌다. 그런데 그 이름표가
// 자사·경쟁점 사이에 비대칭이다.
//
//   VIP존 · 프렌즈존 · 퍼스트클래스존 -> 자사 29/19/19곳, **경쟁점 228건 전부 0건**
//
// 조사표에 칸은 있는데 경쟁점엔 한 건도 없다. 우리 브랜드 용어라서, 조사자가 경쟁점의 같은
// 실체(파티션 1인석·유리파티션 다인석)를 보고도 그 칸에 안 넣기 때문이다. 게다가 자사엔
// "일반 2인석" 칸이 아예 없어서 우리 2인석은 전부 커플존으로 계상된다.
// 결과적으로 **종류를 세면 자사가 항상 이긴다**(지금 잣대로 자사 41/41곳).
//
// 사용자 진단(2026-09-17): *"VIP존은 ... 사실상 파티션 처져있는 1인석이란말이지"* ·
// *"커플존의 차별성은 2인용 의자가 있다는거거든 ... 그렇다면 우리만 이득보는거잖아"*
//
// ── 그래서 이름표를 안 센다 ────────────────────────────────────────────────
// 사용자 결정: *"2인석 3인석이런거 다뺴고 팀룸 차이만 적용할까. 팀룸 1인룸 2인룸 이런거"*
//
//   다양성 = **룸 종류 수만** (1인룸 · 2인룸 · 팀룸)
//   수용력 = **특화좌석 전부** (이름과 무관하게 실재하는 좌석은 다 센다)
//   비중   = 다양성 0.3 · 수용력 0.7
//
// 룸은 정의가 명확하다 — 벽과 문이 있나 없나다. 파티션 높이·재질 판단(유리냐 목재냐)이
// 안 들어가고, 자사·경쟁점 양쪽 다 조사돼 있다(room1 · room2 · teamRoom).
// 반대로 **개방석은 모든 PC방에 있으므로** 칸으로 세면 상수라 다양성에 기여를 못 한다.
// 그래서 개방형 이름표(1인석·VIP존·커플존·프렌즈존·일반2인석)는 **좌석으로만** 들어간다.
//
// ── 왜 비중을 7:3에서 3:7로 뒤집었나 ───────────────────────────────────────
// 룸만 세면 다양성 칸이 0~3으로 좁아지고 실제로는 거의 "팀룸 있나 없나"의 이진이 된다.
// 거의 이진인 값에 무게를 싣는 건 뜻이 안 맞고, "특화좌석이 얼마나 되냐"가 더 많은 정보를
// 담는다. 측정도 같은 방향이다(다양성 0.7 -> MAPE 25.13% · 0.3 -> 22.79%).
//
// ⚠️ **이 숫자로 비중을 고른 게 아니다.** 존구성에는 매장별 순서 정보가 없다는 게
//    `_zoneComposition.test.ts`의 결론이라(무작위 대조군 MAPE p=0.455 · r p=0.066),
//    여기서 MAPE가 낮다고 채택 근거가 되지 않는다. 뜻으로 고르고 숫자로 확인만 했다.
//
// ── 퍼스트클래스존 ─────────────────────────────────────────────────────────
// 사용자 설명: *"퍼스트클래스존이 룸인데 많은고객이 이용할수있는 거야, 안에한 10좌석인가
// 12좌석인가 ... 내부를 고급지게해놔서 비싼요금받을려고 만든건데 뭐이제안들어감.
// 망했으니까 안들어가겠지 수요없으니"*
//
// 룸이고 다인이므로 **팀룸과 같은 칸**이다. 고급 인테리어와 비싼 요금은 인테리어 항목과
// 단가가 이미 보는 것이라 존구성에서 또 세면 이중계산이고, **수요가 없어 접은 존에
// 다양성 가점을 주는 것**도 현실과 반대다. 좌석은 실재하므로 11석으로 센다
// (사용자: 10~12석, 매장마다 다름 — 중간값).
//
// 근거와 측정값: `docs/releases/2026-09-17-zone-composition.md`

/** 존 개수 원자료. 자사·경쟁점 공용 — 경쟁점에만 있는 칸은 null로 두면 된다. */
export type LabZoneCounts = {
  /** 1인석(개방형, 목재 파티션으로 옆자리와 구획한 것). 유리칸막이는 여기 안 든다. */
  singleSeatCount: number | null;
  /** 1인룸(벽으로 막힌 독립 공간) */
  room1: number | null;
  /** 2인룸 — 개수. 좌석은 개수 x 2. */
  room2: number | null;
  /** 팀룸 — 개수. 실좌석(teamRoomTotalSeats)이 있으면 그걸 우선한다. */
  teamRoom: number | null;
  /** 커플존 — 개수(2인 자리). 좌석은 개수 x 2. */
  coupleZone: number | null;
  /** VIP존 — 좌석 수(반차폐 1인석) */
  vipZone: number | null;
  /** 프렌즈존 — **좌석 수**(구획 수가 아니다. 2026-09-17 사용자 확인) */
  friendsZone: number | null;
  /** 퍼스트클래스존 — 룸 개수. 룸 하나에 10~12석. */
  firstClassZone: number | null;
  /** 일반 2인석 — 좌석 수. 경쟁점 조사표에만 있는 칸이다(자사는 커플존으로 들어간다). */
  regularCoupleSeatCount: number | null;
};

/** 퍼스트클래스존 룸 하나의 좌석 수. 사용자: 10~12석, 매장마다 다름. */
export const FIRST_CLASS_ZONE_SEATS = 11;

/** 다양성 대 수용력 비중. 합이 1이다. */
export const LAB_ZONE_WEIGHTS = { diversity: 0.3, capacity: 0.7 } as const;

/**
 * **조사하지 않은 경쟁점**의 존구성 점수. `calc.ts`의 `UNSURVEYED_COMPETITOR_ZONE_SCORE`와
 * 같은 값이고 같은 이유다 — 조사자가 생략했다는 사실 자체가 "약하다"는 판단이다.
 * 자사에는 쓰지 않는다(자사의 미기재는 입력 누락이라 null로 두고 사람이 채운다).
 */
export const LAB_UNSURVEYED_ZONE_SCORE = 1.0;

const ROOM_KEYS = ["room1", "room2", "teamRoom", "firstClassZone"] as const;
const ALL_KEYS = [
  "singleSeatCount", "room1", "room2", "teamRoom",
  "coupleZone", "vipZone", "friendsZone", "firstClassZone",
] as const;

/** 존구성을 **아예 조사하지 않았는가** — 8항목이 하나도 안 적혔으면 참. */
function isUnsurveyed(c: LabZoneCounts): boolean {
  return ALL_KEYS.every((k) => c[k] == null);
}

/**
 * 룸 종류 수 — 1인룸 · 2인룸 · (팀룸 + 퍼스트클래스존). 최대 3이다.
 *
 * 퍼스트클래스존은 팀룸과 **한 칸**이다(둘 다 5인 이상이 들어가는 룸).
 */
export function labRoomTypeCount(c: LabZoneCounts): number {
  const bigRoom = (c.teamRoom ?? 0) + (c.firstClassZone ?? 0);
  return [c.room1 ?? 0, c.room2 ?? 0, bigRoom].filter((v) => v > 0).length;
}

/**
 * 특화좌석 수 — 이름과 무관하게 실재하는 좌석을 전부 센다.
 *
 * 단위가 항목마다 다르다는 데 주의한다. 개수로 적힌 칸(2인룸·커플존·팀룸·퍼스트클래스존)은
 * 좌석으로 환산하고, 좌석 수로 적힌 칸(1인석·VIP존·프렌즈존·일반2인석)은 그대로 쓴다.
 */
export function labSpecialtySeats(c: LabZoneCounts, teamRoomTotalSeats: number | null): number {
  return (
    (c.singleSeatCount ?? 0) +
    (c.vipZone ?? 0) +
    (c.friendsZone ?? 0) +
    (c.regularCoupleSeatCount ?? 0) +
    (c.room1 ?? 0) +
    (c.room2 ?? 0) * 2 +
    (c.coupleZone ?? 0) * 2 +
    (teamRoomTotalSeats ?? (c.teamRoom ?? 0) * 5) +
    (c.firstClassZone ?? 0) * FIRST_CLASS_ZONE_SEATS
  );
}

/** 룸 종류 수 -> 1~5점. 운영과 같은 사다리를 쓴다(종류가 0이면 1점). */
export function labDiversityScore(roomTypes: number): number {
  if (roomTypes <= 0) return 1;
  return Math.min(5, 1 + (1 + roomTypes) * 0.5);
}

/** 특화좌석비율 -> 1~5점. 운영과 같은 계단이다. */
export function labCapacityScore(ratio: number | null): number | null {
  if (ratio == null) return null;
  if (ratio < 0.1) return 1;
  if (ratio < 0.2) return 2;
  if (ratio < 0.3) return 3;
  if (ratio < 0.5) return 4;
  return 5;
}

export type LabZoneResult = {
  roomTypes: number | null;
  diversity: number | null;
  seats: number | null;
  ratio: number | null;
  capacity: number | null;
  composition: number | null;
};

/**
 * 실험실 존구성 점수.
 *
 * @param own 자사면 true. 조사가 아예 안 된 경우의 처리가 갈린다 —
 *            자사는 null(사람이 채울 입력 누락), 경쟁점은 1.0(약하다는 판단).
 */
export function computeLabZoneComposition(input: {
  counts: LabZoneCounts;
  teamRoomTotalSeats: number | null;
  totalPcCount: number | null;
  own: boolean;
}): LabZoneResult {
  const empty: LabZoneResult = { roomTypes: null, diversity: null, seats: null, ratio: null, capacity: null, composition: null };
  if (isUnsurveyed(input.counts)) {
    return input.own ? empty : { ...empty, composition: LAB_UNSURVEYED_ZONE_SCORE };
  }
  const roomTypes = labRoomTypeCount(input.counts);
  const diversity = labDiversityScore(roomTypes);
  const seats = labSpecialtySeats(input.counts, input.teamRoomTotalSeats);
  const ratio = input.totalPcCount != null && input.totalPcCount > 0 ? seats / input.totalPcCount : null;
  const capacity = labCapacityScore(ratio);
  const composition = capacity == null
    ? null
    : diversity * LAB_ZONE_WEIGHTS.diversity + capacity * LAB_ZONE_WEIGHTS.capacity;
  return { roomTypes, diversity, seats, ratio, capacity, composition };
}
