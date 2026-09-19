// 존구성 — **잣대는 `calc.ts`에 있다.** 이 파일은 실험실 쪽 이름과 편의 함수만 남긴 껍데기다.
//
// ── 어쩌다 이렇게 됐나 ─────────────────────────────────────────────────────
// 2026-09-17에 이 파일이 존구성을 새로 정의했다. 운영(`calc.ts`)이 존 **이름** 종류 수로
// 다양성을 세는데 그 이름표(VIP존·프렌즈존·퍼스트클래스존)가 자사에만 있어서, 종류를 세면
// 자사가 항상 이기는 문제가 있었다. 실험실에서 먼저 물리 좌석으로 환산하는 잣대를 세우고
// 검증한 뒤, **2026-09-19에 그 잣대를 운영 V62로 옮겼다.**
//
// 그래서 이제 정의는 한 벌뿐이고 `calc.ts`에 있다. 여기 남은 건 실험실 코드·하네스가 쓰던
// 이름(`computeLabZoneComposition` 등)과, 자사·경쟁점을 `own` 한 칸으로 가르는 편의 뿐이다.
// ⚠️ **여기에 잣대를 다시 적지 말 것.** 두 벌이 되면 실험실과 운영이 조용히 갈라진다
//    (2026-09-18~19에 `labSpecScore.ts`에서 실제로 그렇게 됐다).
//
// 왜 이 잣대인지, 비중을 왜 3:7로 뒤집었는지, 퍼스트클래스존을 왜 팀룸과 한 칸으로 보는지는
// 전부 `calc.ts`의 존구성 주석에 적어 뒀다. 근거와 측정값:
// `docs/releases/2026-09-17-zone-composition.md` · `docs/releases/2026-09-19-v62-port.md`

import {
  FIRST_CLASS_ZONE_SEATS,
  UNSURVEYED_COMPETITOR_ZONE_SCORE,
  ZONE_COMPOSITION_WEIGHTS,
  computeCompetitorZoneComposition,
  computeConvertedZoneSeats,
  computeOwnZoneComposition,
  computeZoneCapacityScore,
  computeZoneCompositionScore,
  computeZoneDiversityScore,
  countRoomTypes,
  type ZoneCompositionResult,
} from "@/lib/storeEval/calc";

export { FIRST_CLASS_ZONE_SEATS };

/** @deprecated `ZONE_COMPOSITION_WEIGHTS`(calc.ts)와 같은 값이다. 새 코드는 그쪽을 쓴다. */
export const LAB_ZONE_WEIGHTS = ZONE_COMPOSITION_WEIGHTS;

/**
 * @deprecated `UNSURVEYED_COMPETITOR_ZONE_SCORE`(calc.ts)와 같은 값이다.
 *
 * 2026-09-17에 이 파일이 따로 정의했는데, 처음부터 같은 값·같은 이유였다(조사자가 생략했다는
 * 사실 자체가 "약하다"는 판단). 2026-09-19에 하나로 합쳤다 — 두 상수가 갈리면 실험실과 운영의
 * 미조사 경쟁점 점수가 말없이 달라진다.
 */
export const LAB_UNSURVEYED_ZONE_SCORE = UNSURVEYED_COMPETITOR_ZONE_SCORE;

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

export type LabZoneResult = ZoneCompositionResult;

/** 룸 종류 수 — 1인룸 · 2인룸 · (팀룸 + 퍼스트클래스존). 최대 3이다. */
export function labRoomTypeCount(c: LabZoneCounts): number {
  return countRoomTypes(c);
}

/** 특화좌석 수 — 이름과 무관하게 실재하는 좌석을 전부 센다. */
export function labSpecialtySeats(c: LabZoneCounts, teamRoomTotalSeats: number | null): number {
  return computeConvertedZoneSeats(c, teamRoomTotalSeats, c.regularCoupleSeatCount);
}

/** 룸 종류 수 -> 1~5점. */
export function labDiversityScore(roomTypes: number): number {
  return computeZoneDiversityScore(roomTypes);
}

/** 특화좌석비율 -> 1~5점. */
export function labCapacityScore(ratio: number | null): number | null {
  return computeZoneCapacityScore(ratio);
}

/** 다양성·수용력 -> 존구성 점수. */
export function labZoneCompositionScore(diversity: number | null, capacity: number | null): number | null {
  return computeZoneCompositionScore(diversity, capacity);
}

/**
 * 존구성 점수. `calc.ts`의 자사·경쟁점 함수를 `own` 한 칸으로 갈라 부르는 얇은 껍데기다.
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
  if (input.own) {
    // 자사엔 "일반 2인석" 칸이 없다 — 우리 2인석은 커플존으로 들어간다.
    return computeOwnZoneComposition({
      counts: input.counts,
      teamRoomTotalSeats: input.teamRoomTotalSeats,
      totalPcCount: input.totalPcCount,
    });
  }
  return computeCompetitorZoneComposition({
    counts: input.counts,
    regularCoupleSeatCount: input.counts.regularCoupleSeatCount,
    teamRoomTotalSeats: input.teamRoomTotalSeats,
    totalPcCount: input.totalPcCount,
  });
}
