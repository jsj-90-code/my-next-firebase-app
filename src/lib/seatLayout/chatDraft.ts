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
export type ZoneDraftRow = { seats: number; x: number; y: number; w: number; h: number; type: string | null };
export type SeatNumberDraftRow = { zoneName: string; ranges: string };

export type SeatLayoutChatDraft = {
  projectId: string;
  projectName: string;
  desk?: DraftMeta & { rows: DeskCountDraftRow[] };
  pc?: DraftMeta & { rows: PcCountDraftRow[] };
  seatNumbers?: DraftMeta & { rows: SeatNumberDraftRow[]; unsure: string };
  zones?: DraftMeta & { rows: ZoneDraftRow[] };
};
