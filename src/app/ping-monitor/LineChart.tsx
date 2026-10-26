"use client";

// 가동률 선 그래프(계열 여러 개) — 매장별 비교 화면의 날짜별·시간대별(2026-10-07).
// 계열은 우리 매장 + 측정 중인 경쟁점 전부(8번째부터 점선) — 범례·올렸을 때 값·표로 색 말고도 구별된다.
// 가독성 개선(2026-10-26 사용자 "비교 그래프 가시성/가독성 올려 줘"):
// 높이 260px · 왼쪽 세로 눈금(%) · 우리 매장 선은 굵게 맨 위 · 범례/표 줄에 올리면 그 선만 진하게(나머지 흐리게) ·
// 올렸을 때 값은 커서 옆 상자에 높은 순으로 · 터치로도 값이 뜬다. 값이 없는 지점은 선을 끊는다.

import { useRef, useState } from "react";
import { formatPct } from "@/lib/pingMonitor/summary";

export type LineSeries = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** 합계처럼 다른 선들의 바탕이 되는 계열 — 점선으로 그려 색 말고 모양으로도 구별된다. */
  dashed?: boolean;
};

const W = 640;
const H = 260;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 4;
/** 우리 매장 계열 키 — 굵게, 맨 위에 그린다. */
const OWN_KEY = "own";

/** 세로 눈금 간격 — 보조선이 3~6개가 되게(가동률은 대개 10~40%). */
function tickStep(top: number): number {
  if (top <= 0.2) return 0.05;
  if (top <= 0.6) return 0.1;
  return 0.2;
}

export function LineChart({
  series,
  xLabels,
  ariaLabel,
  tickEvery = 1,
  highlightKey = null,
}: {
  series: LineSeries[];
  xLabels: string[];
  ariaLabel: string;
  tickEvery?: number;
  /** 바깥(표 줄)에서 강조할 계열 키 — 범례에 올린 것이 먼저다. */
  highlightKey?: string | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const focus = legendHover ?? highlightKey;
  const n = xLabels.length;
  const all = series.flatMap((s) =>
    s.values.filter((v): v is number => v != null),
  );
  // 위 눈금은 눈금 간격 단위로 올림 — 가동률은 대개 10~40%라 0~100%로 그리면 선이 바닥에 붙는다.
  const rawTop = Math.max(0.1, Math.max(...all, 0));
  const step = tickStep(rawTop);
  const top = Math.ceil(rawTop / step - 1e-9) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const x = (i: number) =>
    n <= 1 ? W / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
  const y = (v: number) => PAD_T + (1 - v / top) * (H - PAD_T - PAD_B);
  // 점은 계열이 적고 날짜가 짧을 때만 늘 찍는다 — 선이 9개면 점이 화면을 덮는다. 앞뒤가 빈 외톨이 값은 선이 없으니 늘 찍는다.
  const showDots = n <= 31 && series.length <= 3;
  const isolated = (vals: (number | null)[], i: number) => vals[i] != null && vals[i - 1] == null && vals[i + 1] == null;
  const dim = (key: string) => focus != null && focus !== key;

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });
  // 그리는 순서: 흐린 선 → 보통 선 → 우리 매장 → 강조한 선(맨 위).
  const rank = (s: LineSeries) => (s.key === focus ? 3 : s.key === OWN_KEY ? 2 : dim(s.key) ? 0 : 1);
  const drawOrder = series.map((s, si) => ({ s, si })).sort((a, b) => rank(a.s) - rank(b.s));

  // 마우스·터치 모두 — 가로 위치로 가장 가까운 지점을 고른다.
  const pick = (clientX: number) => {
    const el = plotRef.current;
    if (!el || n === 0) return;
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    const i = n <= 1 ? 0 : Math.round(((vx - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const tipRows =
    hover == null
      ? []
      : series
          .map((s) => ({ s, v: s.values[hover] }))
          .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  const tipLeft = hover != null && x(hover) / W > 0.55;

  return (
    <figure className="flex flex-col gap-2" aria-label={ariaLabel}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {series.map((s) => (
          <span
            key={s.key}
            className={`inline-flex cursor-default items-center gap-1.5 rounded px-1 py-0.5 transition-opacity ${dim(s.key) ? "opacity-35" : ""} ${s.key === OWN_KEY ? "font-semibold text-[#171310] dark:text-[#f2ede2]" : "text-[var(--sl-ink-soft)]"}`}
            onMouseEnter={() => setLegendHover(s.key)}
            onMouseLeave={() => setLegendHover(null)}
          >
            <span
              className={`inline-block w-5 ${s.key === OWN_KEY ? "border-t-[3px]" : "border-t-2"} ${s.dashed ? "border-dashed" : ""}`}
              style={{ borderColor: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="flex">
        {/* 세로 눈금 — SVG가 가로로 늘어나도 글자가 안 찌그러지게 HTML로 */}
        <div className="relative w-9 shrink-0 text-[11px] tabular-nums text-[var(--sl-ink-soft)]" style={{ height: H }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1.5 -translate-y-1/2"
              style={{ top: `${(y(t) / H) * 100}%` }}
            >
              {formatPct(t, 0)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            ref={plotRef}
            className="relative touch-pan-y"
            style={{ height: H }}
            onPointerMove={(e) => pick(e.clientX)}
            onPointerDown={(e) => pick(e.clientX)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-full w-full overflow-visible"
              preserveAspectRatio="none"
            >
              {ticks.map((t) => (
                <line
                  key={t}
                  x1={0}
                  x2={W}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--sl-hairline)"
                  strokeDasharray={t === 0 ? undefined : "3 3"}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {hover != null && (
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="var(--sl-ink-soft)"
                  strokeOpacity={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {drawOrder.map(({ s, si }) => (
                <path
                  key={s.key}
                  d={paths[si]}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.key === focus ? 3.5 : s.key === OWN_KEY ? 3.5 : 2}
                  strokeOpacity={dim(s.key) ? 0.15 : 1}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {/* 점은 SVG 밖 HTML로 — preserveAspectRatio="none"이라 SVG 원은 찌그러진다. */}
            <div className="pointer-events-none absolute inset-0">
              {series.map((s) =>
                s.values.map((v, i) =>
                  v != null && (showDots || hover === i || isolated(s.values, i)) ? (
                    <span
                      key={`${s.key}-${i}`}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--sl-surface,#fff)] dark:ring-[#14120d] ${hover === i ? "h-2.5 w-2.5" : "h-2 w-2"} ${dim(s.key) ? "opacity-20" : ""}`}
                      style={{
                        left: `${(x(i) / W) * 100}%`,
                        top: `${(y(v) / H) * 100}%`,
                        background: s.color,
                      }}
                    />
                  ) : null,
                ),
              )}
            </div>
            {hover != null && (
              <div
                className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-[var(--sl-hairline)] bg-white/95 px-2.5 py-2 text-xs shadow-md dark:bg-[#1d1a14]/95"
                style={
                  tipLeft
                    ? { right: `calc(${100 - (x(hover) / W) * 100}% + 10px)` }
                    : { left: `calc(${(x(hover) / W) * 100}% + 10px)` }
                }
              >
                <div className="mb-1 font-semibold text-[#171310] dark:text-[#f2ede2]">
                  {xLabels[hover]}
                </div>
                {tipRows.map(({ s, v }) => (
                  <div
                    key={s.key}
                    className={`flex items-center gap-1.5 whitespace-nowrap ${s.key === OWN_KEY || s.key === focus ? "font-semibold text-[#171310] dark:text-[#f2ede2]" : "text-[var(--sl-ink-soft)]"} ${dim(s.key) ? "opacity-50" : ""}`}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="max-w-40 truncate">{s.label}</span>
                    <b className="ml-auto pl-3 tabular-nums text-[#171310] dark:text-[#f2ede2]">
                      {formatPct(v)}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="relative mt-1 h-4 text-[11px] tabular-nums text-[var(--sl-ink-soft)]">
            {xLabels.map((l, i) =>
              i % tickEvery === 0 ? (
                <span
                  key={l + i}
                  className={`absolute -translate-x-1/2 whitespace-nowrap ${(i / tickEvery) % 2 === 1 ? "max-sm:hidden" : ""}`}
                  style={{ left: `${(x(i) / W) * 100}%` }}
                >
                  {l}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-[var(--sl-ink-soft)]">
        그래프에 올리거나 누르면 그 지점 값이 높은 순으로 뜹니다. 범례·표의 매장 줄에 올리면 그 선만 진하게 보입니다.
      </p>
    </figure>
  );
}
