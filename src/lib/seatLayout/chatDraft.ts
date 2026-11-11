// 좌석배치도 채팅 인식 초안 — 직원 개인 Claude(커넥터 api/mcp)가 도면을 보고 낸 결과를 담는 문서. (2026-10-27)
//
// 점포평가 입지 초안(storeEvalLocationChatDrafts)과 같은 방식: 채팅은 **초안만** 쓰고 프로젝트를 직접 고치지 않는다.
// 웹 좌석배치도 화면의 [채팅 결과 불러오기]에서 사람이 확인·수정해 적용하고 [저장]을 눌러야 반영된다.
// 프로젝트마다 문서 1개(seatLayoutChatDrafts/{프로젝트 id}), 종류(책상·PC·좌석번호)마다 마지막 결과 1건씩 덮어쓴다.
// 브라우저는 읽기만, 쓰기는 서버만(firestore.rules).
import type { SizeBreakdownEntry } from "./types";

export const SEAT_LAYOUT_CHAT_DRAFTS = "seatLayoutChatDrafts";

type DraftMeta = { createdAt: number; modelName: string | null; userEmail: string | null; note: string | null };

export type DeskCountDraftRow = {
  zoneName: string;
  seats: number;
  sizeBreakdown: SizeBreakdownEntry[];
  // null = 도면에 브라켓 표시가 없거나 구분 못 함 → 웹에서 지금 값을 그대로 둔다(10-27 평택: 표시 없는 도면이라 전부 0이 나와
  // 손으로 넣은 값을 지울 뻔함). 0은 "표시는 그리는 도면인데 이 존엔 없음".
  bagShelfCount: number | null;
};
export type PcCountDraftRow = { zoneName: string; seats: number };
// 존 초안(2026-10-27): 도면 전체를 보고 제안한 구역 상자. 위치는 도면 기준 0~1 비율, type은 확신할 때만.
// bagShelfCount(10-29): 존 초안을 낸 같은 채팅에서 상자마다 잘라 본 브라켓 수. 아직 안 셌으면 없음, 구분 못 하면 null.
export type ZoneDraftRow = {
  seats: number; x: number; y: number; w: number; h: number; type: string | null; bagShelfCount?: number | null;
};
// 존을 고친 뒤 브라켓만 다시 센 결과(10-29). shapeKey = 채팅이 본 저장된 존 모양 — 그 뒤 또 옮겼으면 웹이 계속 "다시 세기"로 둔다.
export type BracketDraftRow = { zoneName: string; bagShelfCount: number | null; shapeKey: string };
// plateRect(10-29): 피난안내도 위에서 그 존 좌석번호들을 감싸는 대략의 상자(0~1) — 웹이 존 전체로 변환을 맞춰 구역을 겹쳐 그린다.
export type SeatNumberDraftRow = { zoneName: string; ranges: string; plateRect?: { x: number; y: number; w: number; h: number } };

export type SeatLayoutChatDraft = {
  projectId: string;
  projectName: string;
  desk?: DraftMeta & { rows: DeskCountDraftRow[] };
  pc?: DraftMeta & { rows: PcCountDraftRow[] };
  // final(11-12): plateBox가 빠져 "다시 내라"를 받은 초안은 false — 웹이 열기 전에 와 있던 좌석번호 초안은 final만 넣는다.
  seatNumbers?: DraftMeta & { rows: SeatNumberDraftRow[]; unsure: string; final?: boolean };
  // final(10-30): 채팅이 더 덮어쓰지 않을 마지막 초안 — 웹은 이것만 자동으로 넣는다(없으면 옛 초안, 버튼으로만).
  zones?: DraftMeta & { rows: ZoneDraftRow[]; final?: boolean };
  brackets?: DraftMeta & { rows: BracketDraftRow[] };
};

export type ChatDraftKindKey = "zones" | "brackets" | "desk" | "pc" | "seatNumbers";

/**
 * 채팅 초안을 버튼 없이 넣을지(웹 SeatLayoutWorkspace onChatDraftArrived).
 * - 프로젝트를 연 뒤에 새로 온 초안(at > watchStartedAt)은 넣는다(10-30). 단 존 초안은 final만.
 * - 열기 전에 와 있던 초안은 넣었다가 버린 것일 수 있어 원래 버튼으로만 — 예외 둘(도면공유방 자동 초안은 사람이 열기 전에 도착):
 *   존이 0개인 프로젝트의 final 존 초안(11-04), 저장된 좌석번호가 하나도 없고 피난안내도가 있는 프로젝트의 final 좌석번호 초안(11-12).
 * - 어느 쪽이든 마지막 [프로젝트 저장] 뒤에 온 초안만(넣고 저장했거나 버리고 저장했으면 다시 안 넣는다).
 */
export function shouldAutoApplyChatDraft(
  kind: ChatDraftKindKey,
  draft: SeatLayoutChatDraft,
  project: { zoneCount: number; seatNumberCount: number; hasPlate: boolean; updatedAt: number | null },
  watchStartedAt: number,
): boolean {
  const at = draft[kind]?.createdAt;
  if (!at) return false;
  if (kind === "zones" && !draft.zones?.final) return false;
  const beforeOpenOk =
    (kind === "zones" && project.zoneCount === 0) ||
    (kind === "seatNumbers" && !!draft.seatNumbers?.final && project.seatNumberCount === 0 && project.hasPlate);
  return (at > watchStartedAt || beforeOpenOk) && at > (project.updatedAt ?? 0);
}
