"use client";

// 존 초안을 넣은 뒤 오른쪽에 붙는 확인 창 — 존마다 책상 수량·사이즈·브라켓만. (2026-10-29)
//
// 사용자 「존초안받고나서 우측사이드에 … 책상수량/사이즈/브라켓만 표기되면 될 것 같은데? 나머지는 AI가 아니라 그냥 입력값」.
// 세 값은 도면 PDF로 센 것(deskLabels.ts·bracketLines.ts)이라 사람이 도면과 대조할 자리가 필요하다. 사양(책상·쿨러 등)은
// 유형 기본값이라 뺐다. 지금 프로젝트 값을 그대로 보여 주므로 존을 고치면 표도 바로 바뀐다. 줄을 누르면 그 존을 도면에서 고른다.
// 채팅 결과 확인 창(ChatDraftImportModal)과 같은 자리·모양 — 화면을 덮지 않아 도면을 보면서 확인한다.
import type { DeskZone } from "@/lib/seatLayout/types";

export function DeskCountPanel({
  zones,
  uncovered,
  staleNames,
  selectedIndex,
  busy,
  onSelect,
  onPublish,
  onClose,
}: {
  zones: DeskZone[];
  /** 어느 존에도 안 든 도면 책상 수 */
  uncovered: number;
  /** 브라켓을 아직 안 센 존(주황 선을 못 읽은 도면에서 존을 고친 경우) */
  staleNames: string[];
  selectedIndex: number | null;
  busy: boolean;
  onSelect: (index: number) => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const seats = zones.reduce((s, z) => s + z.seats, 0);
  const brackets = zones.reduce((s, z) => s + (z.bagShelfCount ?? 0), 0);
  const bySize = new Map<string, number>();
  zones.forEach((z) => z.sizeBreakdown.forEach((b) => bySize.set(b.deskSize, (bySize.get(b.deskSize) ?? 0) + b.qty)));
  const sizeText = (z: DeskZone) =>
    z.sizeBreakdown.length
      ? z.sizeBreakdown.map((b) => `${b.deskSize.replace("mm", "")}×${b.qty}`).join(" · ")
      : z.deskSize || "—";
  const blocked = !zones.length || uncovered > 0 || staleNames.length > 0;

  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-2 top-16 z-50 flex justify-end sm:inset-x-4 sm:bottom-4">
      <div className="app-card pointer-events-auto flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-2xl shadow-2xl ring-2 ring-[var(--sl-gold)]">
        <div className="border-b border-[#171310]/[0.08] bg-[var(--sl-gold)]/[0.12] p-5 dark:border-white/[0.08]">
          <h2 className="font-semibold text-[#171310] dark:text-[#f2ede2]">책상 수량 확인</h2>
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            도면 PDF로 센 값입니다. 도면과 맞는지 보고, 존을 고치면 바로 다시 셉니다. 줄을 누르면 그 존을 고릅니다.
          </p>
          {uncovered > 0 && (
            <p className="app-notice app-badge-warn mt-2 w-full justify-start py-1.5 text-xs">
              도면 책상 {uncovered}개가 어느 존에도 없습니다 — 존을 늘리거나 새로 그리세요.
            </p>
          )}
          {staleNames.length > 0 && (
            <p className="app-notice app-badge-warn mt-2 w-full justify-start py-1.5 text-xs">
              브라켓을 다시 세야 하는 존: {staleNames.join(", ")} (작업 순서 참고)
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--sl-ink-soft)]">
              <tr>
                <th className="pb-2">존</th>
                <th className="pb-2 text-right">책상</th>
                <th className="pb-2 pl-3">사이즈</th>
                <th className="pb-2 text-right">브라켓</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z, i) => (
                <tr
                  key={`${z.name}-${i}`}
                  onClick={() => onSelect(i)}
                  className={`cursor-pointer border-t border-[#171310]/[0.08] align-top transition hover:bg-[var(--sl-gold)]/[0.08] dark:border-white/[0.08] ${
                    selectedIndex === i ? "bg-[var(--sl-gold)]/[0.16]" : ""
                  }`}
                >
                  <td className="py-2 pr-2 text-[#5c5346] dark:text-[#c9bfae]">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: z.color }} />
                    {z.name}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums text-[#171310] dark:text-[#f2ede2]">{z.seats}</td>
                  <td className="py-2 pl-3 text-xs tabular-nums text-[var(--sl-ink-soft)]">{sizeText(z)}</td>
                  <td className="py-2 text-right tabular-nums text-[#171310] dark:text-[#f2ede2]">{z.bagShelfCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#171310]/[0.2] font-semibold dark:border-white/[0.2]">
                <td className="py-2 text-[#171310] dark:text-[#f2ede2]">합계 ({zones.length}개 존)</td>
                <td className="py-2 text-right tabular-nums text-[#171310] dark:text-[#f2ede2]">{seats}</td>
                <td className="py-2 pl-3 text-xs font-normal tabular-nums text-[var(--sl-ink-soft)]">
                  {[...bySize].map(([s, q]) => `${s.replace("mm", "")}×${q}`).join(" · ")}
                </td>
                <td className="py-2 text-right tabular-nums text-[#171310] dark:text-[#f2ede2]">{brackets}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#171310]/[0.08] p-4 dark:border-white/[0.08]">
          <button type="button" onClick={onClose} className="app-btn-outline rounded-full px-4 py-1.5 text-sm">
            닫기
          </button>
          <button
            type="button"
            disabled={busy || blocked}
            onClick={onPublish}
            className="app-btn-accent rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
          >
            확인하고 통합발주서 등록
          </button>
        </div>
      </div>
    </div>
  );
}
