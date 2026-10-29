"use client";

// 좌석번호 확인·입력 창 — 오른쪽에 붙는다. (2026-10-29)
//
// 사용자 「체크한 N개 존에 넣기 말고 바로 좌석번호표 발주 등록 버튼」 「왼쪽 맨 아래 표는 필요 없을 듯」:
// 채팅 결과는 불러오는 순간 모든 존에 넣고(체크 단계 없음), 이 창에서 틀린 번호만 고친 뒤 바로 발주 등록한다.
// 칸은 프로젝트 값에 바로 묶여 있어(고치면 곧 반영) 따로 [넣기]가 없다. 왼쪽에 있던 존별 입력 표를 이 창이 대신한다.
// 채팅 결과 확인 창(ChatDraftImportModal)과 같은 자리·모양 — 가운데 도면·피난안내도를 가리지 않는다.
export function SeatNumberPanel({
  zoneNames,
  ranges,
  fromChat,
  unsure,
  meta,
  busy,
  onChange,
  onPublish,
  onClose,
}: {
  zoneNames: string[];
  ranges: Record<string, string>;
  /** 이번에 채팅 결과로 채운 존 — 표시만 */
  fromChat: Set<string>;
  /** 어느 존에도 배정 못 한 번호(채팅) */
  unsure: string;
  meta: string | null;
  busy: boolean;
  onChange: (zoneName: string, value: string) => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const filled = zoneNames.filter((n) => (ranges[n] ?? "").trim()).length;
  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-2 top-16 z-50 flex justify-end sm:inset-x-4 sm:bottom-4">
      <div className="app-card pointer-events-auto flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-2xl shadow-2xl ring-2 ring-[var(--sl-gold)]">
        <div className="border-b border-[#171310]/[0.08] bg-[var(--sl-gold)]/[0.12] p-5 dark:border-white/[0.08]">
          <h2 className="font-semibold text-[#171310] dark:text-[#f2ede2]">존별 좌석번호</h2>
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            {meta ? `${meta} — ` : ""}가운데 도면·피난안내도와 비교해 틀린 번호만 고치세요(예: 1~10, 25~30). 고치면 바로 반영됩니다.
          </p>
          {unsure && <p className="app-notice app-badge-warn mt-2 w-full justify-start py-1.5 text-xs">어느 존에도 배정 못 한 번호: {unsure}</p>}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-5">
          {zoneNames.map((name) => (
            <label key={name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-xs text-[#5c5346] dark:text-[#c9bfae]" title={name}>
                {name}
                {fromChat.has(name) && <span className="ml-1 text-[10px] text-[var(--sl-gold-ink)]">채팅</span>}
              </span>
              <input
                value={ranges[name] ?? ""}
                onChange={(e) => onChange(name, e.target.value)}
                placeholder="예: 1~10, 25~30"
                className={`app-input flex-1 px-2 py-1 text-sm ${(ranges[name] ?? "").trim() ? "" : "ring-1 ring-[var(--sl-warn)]/50"}`}
              />
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[#171310]/[0.08] p-4 dark:border-white/[0.08]">
          <span className="text-xs text-[var(--sl-ink-soft)]">
            {filled}/{zoneNames.length}개 존 입력됨
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="app-btn-outline rounded-full px-4 py-1.5 text-sm">
              닫기
            </button>
            <button
              type="button"
              disabled={busy || filled === 0}
              onClick={onPublish}
              className="app-btn-accent rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
            >
              좌석번호표 발주 등록
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
