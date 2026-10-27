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
  bagShelfCount: number;
};
export type PcCountDraftRow = { zoneName: string; seats: number };
export type SeatNumberDraftRow = { zoneName: string; ranges: string };

export type SeatLayoutChatDraft = {
  projectId: string;
  projectName: string;
  desk?: DraftMeta & { rows: DeskCountDraftRow[] };
  pc?: DraftMeta & { rows: PcCountDraftRow[] };
  seatNumbers?: DraftMeta & { rows: SeatNumberDraftRow[]; unsure: string };
};
