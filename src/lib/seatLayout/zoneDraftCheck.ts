// 존 초안 검산 — 채팅이 낸 상자마다 도면 PDF 책상 글씨로 실제 좌석 수를 세어 바로 돌려준다. (2026-10-29)
//
// 호구포TEST 세 번째 초안: AI가 세로 섬 한쪽 줄을 10석으로 잘못 세 FPS로 골랐다(실제 9석). 지시문엔 "10석 줄 먼저" 규칙이
// 있었지만 수를 잘못 세면 소용없다. 사용자 「FPS존은 최소 10개로, 구역은 안 나눠지면서」 → 커넥터가 실제 수를 세어 FPS가
// 10석 미만이면 존을 잘라 맞추지 말고 10석 이상인 한 줄로 다시 고르게 되돌린다(정말 없을 때만 7~9석, 메모에 이유).
// 웹이 넣을 때와 같은 상자 맞추기(snapZonesToDesks — AI 좌석 수만큼 바로 밖 책상 붙이기 포함)로 센다.
import { countDesksByZone, snapZonesToDesks } from "./deskLabels";
import type { DeskLabelSet } from "./types";

export const FPS_MIN_SEATS = 10;

export type ZoneDraftCheck = {
  /** 상자마다 실제 책상 수(도면 글씨). 방 등 책상이 안 든 상자는 0 */
  actual: number[];
  /** AI가 낸 좌석 수와 실제가 다른 상자(1부터) */
  mismatched: number[];
  fpsActual: number;
  /** FPS가 있는데 실제 10석 미만 */
  fpsShort: boolean;
  /** VIP 상자인데 1000mm 책상이 절반이 안 되는 상자(1부터) — 10-29 광주: 910 줄 + 1000mm 1인석을 VIP로 묶음 */
  vipMixed: number[];
};

export function checkZoneDraft(
  rows: { seats: number; x: number; y: number; w: number; h: number; type: string | null }[],
  labels: DeskLabelSet,
): ZoneDraftCheck {
  const snaps = snapZonesToDesks(rows.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, typeKey: r.type, seats: r.seats })), labels);
  const counts = countDesksByZone(labels, snaps.map((s) => s.rect));
  // 폭 정보가 없는 옛 도면이면 countDesksByZone이 모두 null — 상자 안 글씨 수(snap)로 센다.
  const actual = rows.map((_, i) => counts[i]?.seats ?? snaps[i].deskCount ?? 0);
  const mismatched = rows.flatMap((r, i) => (actual[i] !== r.seats ? [i + 1] : []));
  const fpsIdx = rows.flatMap((r, i) => (r.type === "fps" ? [i] : []));
  const fpsActual = fpsIdx.reduce((s, i) => s + actual[i], 0);
  const vipMixed = rows.flatMap((r, i) => {
    if (r.type !== "vip") return [];
    const b = counts[i]?.sizeBreakdown;
    if (!b?.length) return [];
    const total = b.reduce((s, e) => s + e.qty, 0);
    const big = b.find((e) => e.deskSize === "1000mm")?.qty ?? 0;
    return big * 2 < total ? [i + 1] : [];
  });
  return { actual, mismatched, fpsActual, fpsShort: fpsIdx.length > 0 && fpsActual < FPS_MIN_SEATS, vipMixed };
}
