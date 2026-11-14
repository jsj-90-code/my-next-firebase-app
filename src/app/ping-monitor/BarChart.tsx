"use client";

// 가동률 막대그래프(계열 하나) — 날짜별·시간대별에 같이 쓴다. 막대에 올리면 위 줄에 값이 뜬다.
// 막대 위에 가동률(정수 %)을 늘 적는다 — 올려야만 보이면 한눈에 비교가 안 된다(2026-10-12 사용자). 막대가 많으면(기간이 길면) 겹쳐서 뺀다.
// 막대 색은 브랜드 색 하나, 글자는 글자 색(막대 색을 글자에 쓰지 않는다). 표 보기는 상세 화면 아래 표가 맡는다.

import { useState } from "react";
import { formatPct } from "@/lib/pingMonitor/summary";

/** 막대가 이보다 많으면 막대 위 숫자를 안 적는다(좁아서 겹친다). 시간대 24개·한 달 31일은 들어간다. */
const VALUE_LABEL_MAX_BARS = 40;

// 2026-11-15 아티팩트에서 옮김: prev(지난 기간 같은 자리 값 — 점선 테두리), faint(덜 찬 날 — 옅게), highlight(지금 시각 — 진하게), onPick(막대 누르기).
export type Bar = { key: string; label: string; value: number | null; detail?: string; prev?: number | null; faint?: boolean; highlight?: boolean };

export function BarChart({ bars, ariaLabel, tickEvery = 1, onPick }: { bars: Bar[]; ariaLabel: string; tickEvery?: number; onPick?: (bar: Bar) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const values = bars.flatMap((b) => [b.value ?? 0, b.prev ?? 0]);
  // 눈금 위쪽은 10%p 단위로 올림 — 가동률은 대개 10~40%라 0~100%로 그리면 막대가 바닥에 붙는다.
  const top = Math.max(0.1, Math.ceil(Math.max(...values, 0) * 10) / 10);
  const hovered = bars.find((b) => b.key === hover);
  const showValues = bars.length <= VALUE_LABEL_MAX_BARS;

  return (
    <figure className="flex flex-col gap-1" aria-label={ariaLabel}>
      <div className="h-5 text-xs text-[var(--sl-ink-soft)]">
        {hovered ? (
          <>
            <b className="text-[#171310] dark:text-[#f2ede2]">{hovered.label}</b> · {formatPct(hovered.value)}
            {hovered.detail ? ` · ${hovered.detail}` : ""}
            {hovered.prev != null ? ` · 지난 기간 ${formatPct(hovered.prev)}` : ""}
          </>
        ) : (
          showValues ? "막대 위 숫자 = 가동률(%) · 막대에 올리면 자세히" : "막대에 올리면 값이 보입니다"
        )}
      </div>
      {/* pt-4: 맨 높은 막대 위 숫자가 들어갈 자리 */}
      <div className="h-44 pt-4">
      <div className="relative h-full">
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-[var(--sl-hairline)]">
          <span className="absolute -top-2 right-0 bg-[var(--sl-surface,transparent)] text-[10px] tabular-nums text-[var(--sl-ink-soft)]">{formatPct(top, 0)}</span>
        </div>
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--sl-hairline)] opacity-60" />
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-[var(--sl-hairline)]" onMouseLeave={() => setHover(null)}>
          {bars.map((b) => (
            <button
              key={b.key}
              type="button"
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center focus:outline-none"
              onMouseEnter={() => setHover(b.key)}
              onFocus={() => setHover(b.key)}
              onClick={onPick ? () => onPick(b) : undefined}
              style={onPick ? { cursor: "pointer" } : undefined}
              aria-label={`${b.label} ${formatPct(b.value)}`}
            >
              {showValues && b.value != null && (
                <span
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap pb-0.5 text-[9px] leading-none tabular-nums text-[#171310] dark:text-[#f2ede2]"
                  style={{ bottom: `${Math.max((b.value / top) * 100, b.value > 0 ? 1.5 : 0)}%` }}
                >
                  {Math.round(b.value * 100)}
                </span>
              )}
              {b.prev != null && (
                <span
                  className="pointer-events-none absolute bottom-0 left-1/2 block w-full max-w-[22px] -translate-x-1/2 rounded-t-[4px] border border-b-0 border-dashed border-[var(--sl-ink-soft)]"
                  style={{ height: `${Math.max((b.prev / top) * 100, b.prev > 0 ? 1.5 : 0)}%` }}
                  aria-hidden="true"
                />
              )}
              <span
                className={`block w-full max-w-[22px] rounded-t-[4px] ${b.value == null ? "bg-transparent" : b.highlight ? "bg-[#7a3315] dark:bg-[#ffc2a3]" : b.faint ? "bg-[#e6b49a] group-hover:bg-[#da9270] dark:bg-[#7d3f26] dark:group-hover:bg-[#a0522f]" : "bg-[#c05a2c] group-hover:bg-[#9c4520] dark:bg-[#e07a4a] dark:group-hover:bg-[#f29a6e]"}`}
                style={{ height: b.value == null ? 0 : `${Math.max((b.value / top) * 100, b.value > 0 ? 1.5 : 0)}%` }}
              />
            </button>
          ))}
        </div>
      </div>
      </div>
      <div className="flex gap-[2px] text-[10px] tabular-nums text-[var(--sl-ink-soft)]">
        {bars.map((b, i) => (
          <span key={b.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
            {i % tickEvery === 0 ? b.label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}
