"use client";

// [채팅 결과 불러오기] 확인 화면 — 직원 개인 Claude(커넥터)가 낸 인식 초안을 존별로 지금 값과 나란히 보여주고,
// 고른 존만 화면의 프로젝트에 넣는다. 넣은 뒤에도 [저장]을 눌러야 반영된다(점포평가 입지 초안과 같은 방식, 2026-10-27).
import { useMemo, useState } from "react";
import type { SeatLayoutChatDraft } from "@/lib/seatLayout/chatDraft";
import type { SeatLayoutProject, SizeBreakdownEntry } from "@/lib/seatLayout/types";

export type ChatDraftKind = "desk" | "pc" | "seatNumbers";

type Row = { zoneName: string; current: string; proposed: string | null; differs: boolean };

const sizesText = (b: SizeBreakdownEntry[] | undefined) => (b ?? []).map((r) => `${r.deskSize} ${r.qty}`).join(", ");

function buildRows(kind: ChatDraftKind, project: SeatLayoutProject, draft: SeatLayoutChatDraft): Row[] {
  if (kind === "desk") {
    const rows = draft.desk?.rows ?? [];
    return project.zones.map((z) => {
      const d = rows.find((r) => r.zoneName === z.name);
      const current = `${z.seats}석 (${sizesText(z.sizeBreakdown) || z.deskSize || "-"}) · 브라켓 ${z.bagShelfCount ?? 0}`;
      // 가방 선반을 판단 못 했으면(null) 지금 값을 그대로 쓰므로 비교도 지금 값으로 한다.
      const bag = d?.bagShelfCount ?? z.bagShelfCount ?? 0;
      const proposed = d ? `${d.seats}석 (${sizesText(d.sizeBreakdown)}) · 브라켓 ${bag}${d.bagShelfCount == null ? "(유지)" : ""}` : null;
      const differs = !!d && proposed!.replace("(유지)", "") !== current;
      return { zoneName: z.name, current, proposed, differs };
    });
  }
  if (kind === "pc") {
    const rows = draft.pc?.rows ?? [];
    return project.pcZones.map((z) => {
      const d = rows.find((r) => r.zoneName === z.name);
      const current = `${z.seats}대`;
      const proposed = d ? `${d.seats}대` : null;
      return { zoneName: z.name, current, proposed, differs: proposed !== null && proposed !== current };
    });
  }
  const rows = draft.seatNumbers?.rows ?? [];
  const zones = project.pcZones.length ? project.pcZones : project.zones;
  return zones.map((z) => {
    const d = rows.find((r) => r.zoneName === z.name);
    const current = project.seatNumberRanges.find((r) => r.zoneName === z.name)?.ranges.trim() || "-";
    const proposed = d ? d.ranges : null;
    return { zoneName: z.name, current, proposed, differs: proposed !== null && proposed !== current };
  });
}

/** 고른 존에 초안 값을 넣은 새 프로젝트(화면 상태용 — 저장은 하지 않는다). */
export function applyChatDraft(
  kind: ChatDraftKind,
  project: SeatLayoutProject,
  draft: SeatLayoutChatDraft,
  picked: Set<string>,
): SeatLayoutProject {
  if (kind === "desk") {
    const rows = draft.desk?.rows ?? [];
    return {
      ...project,
      zones: project.zones.map((z) => {
        const d = picked.has(z.name) ? rows.find((r) => r.zoneName === z.name) : undefined;
        if (!d) return z;
        // 웹 존 수정(confirmZone)과 같은 규칙: 좌석 = 사이즈별 합, 대표 사이즈 = 첫 줄, 브라켓 ≤ 좌석.
        const sizeBreakdown = d.sizeBreakdown.filter((r) => r.qty > 0).map((r) => ({ ...r }));
        const seats = sizeBreakdown.reduce((s, r) => s + r.qty, 0);
        return {
          ...z,
          sizeBreakdown,
          deskSize: sizeBreakdown[0]?.deskSize ?? "",
          seats,
          bagShelfCount: Math.max(0, Math.min(d.bagShelfCount ?? z.bagShelfCount ?? 0, seats)),
        };
      }),
    };
  }
  if (kind === "pc") {
    const rows = draft.pc?.rows ?? [];
    return {
      ...project,
      pcZones: project.pcZones.map((z) => {
        const d = picked.has(z.name) ? rows.find((r) => r.zoneName === z.name) : undefined;
        return d ? { ...z, seats: Math.max(0, d.seats) } : z;
      }),
    };
  }
  const additions = (draft.seatNumbers?.rows ?? []).filter((r) => picked.has(r.zoneName));
  return {
    ...project,
    seatNumberRanges: [
      ...project.seatNumberRanges.filter((r) => !additions.some((a) => a.zoneName === r.zoneName)),
      ...additions.map((a) => ({ zoneName: a.zoneName, ranges: a.ranges })),
    ],
  };
}

const KIND_LABEL: Record<ChatDraftKind, string> = { desk: "책상 인식", pc: "PC 대수", seatNumbers: "좌석번호" };

export function ChatDraftImportModal({
  kind,
  project,
  draft,
  onApply,
  onClose,
}: {
  kind: ChatDraftKind;
  project: SeatLayoutProject;
  draft: SeatLayoutChatDraft;
  onApply: (picked: Set<string>) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => buildRows(kind, project, draft), [kind, project, draft]);
  // 기본은 "값이 다른 존"만 체크 — 같은 값은 넣어도 바뀌는 게 없다.
  const [picked, setPicked] = useState(() => new Set(rows.filter((r) => r.differs).map((r) => r.zoneName)));
  const meta = draft[kind];
  const unsure = kind === "seatNumbers" ? draft.seatNumbers?.unsure : "";
  const toggle = (name: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    // 10-27 밤 사용자: 가운데 팝업이 도면을 가려 브라켓 수량을 도면과 대조할 수 없다 → 화면을 어둡게 덮지 않고
    // 오른쪽에 붙는 창으로. 도면(가운데 칸)을 보면서 표를 확인한다. 바깥을 눌러도 닫히지 않는다(도면 확대·스크롤용).
    <div className="pointer-events-none fixed inset-x-2 bottom-2 top-16 z-50 flex justify-end sm:inset-x-4 sm:bottom-4">
      <div className="app-card pointer-events-auto flex h-full w-full max-w-[460px] flex-col overflow-hidden rounded-2xl shadow-2xl ring-2 ring-[var(--sl-gold)]">
        <div className="border-b border-[#171310]/[0.08] bg-[var(--sl-gold)]/[0.12] p-5 dark:border-white/[0.08]">
          <h2 className="font-semibold text-[#171310] dark:text-[#f2ede2]">채팅 결과 불러오기 — {KIND_LABEL[kind]}</h2>
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            {meta?.modelName ?? "채팅 AI"} · {meta?.createdAt ? new Date(meta.createdAt).toLocaleString("ko-KR") : ""}
            {" "}— 체크한 존만 화면에 넣습니다. 넣은 뒤 도면과 비교해 확인하고 [저장]을 눌러야 반영됩니다.
          </p>
          {meta?.note && <p className="app-notice app-badge-warn mt-2 w-full justify-start py-1.5 text-xs">AI 메모: {meta.note}</p>}
          {unsure && <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">어느 존에도 배정 못 한 번호: {unsure}</p>}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[var(--sl-ink-soft)]">
              <tr>
                <th className="w-8 pb-2" />
                <th className="pb-2">존</th>
                <th className="pb-2">지금 값</th>
                <th className="pb-2">채팅 결과</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.zoneName} className="border-t border-[#171310]/[0.08] dark:border-white/[0.08] align-top">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      disabled={r.proposed === null}
                      checked={picked.has(r.zoneName)}
                      onChange={() => toggle(r.zoneName)}
                      aria-label={`${r.zoneName} 적용`}
                    />
                  </td>
                  <td className="py-2 pr-2 text-[#5c5346] dark:text-[#c9bfae]">{r.zoneName}</td>
                  <td className="py-2 pr-2 text-[var(--sl-ink-soft)]">{r.current}</td>
                  <td className={`py-2 ${r.differs ? "font-semibold text-[#171310] dark:text-[#f2ede2]" : "text-[var(--sl-ink-soft)]"}`}>
                    {r.proposed ?? "(결과 없음 — 직접 확인)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#171310]/[0.08] dark:border-white/[0.08] p-4">
          <button type="button" onClick={onClose} className="app-btn-outline rounded-full px-4 py-1.5 text-sm">
            닫기
          </button>
          <button
            type="button"
            disabled={!picked.size}
            onClick={() => onApply(picked)}
            className="app-btn-accent rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
          >
            체크한 {picked.size}개 존에 넣기
          </button>
        </div>
      </div>
    </div>
  );
}
