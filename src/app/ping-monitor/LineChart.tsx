"use client";

// 가동률 선 그래프(계열 여러 개) — 매장별 비교 화면의 날짜별·시간대별(2026-10-07).
// 계열은 최대 3개(우리 매장·경쟁점 합산·고른 경쟁점)라 범례 + 끝점 이름으로 색 말고도 구별된다.
// 선 2px, 점 8px, 눈금은 옅게. 올리면 세로선과 위 줄에 그 지점의 값이 뜬다. 값이 없는 지점은 선을 끊는다.

import { useState } from "react";
import { formatPct } from "@/lib/pingMonitor/summary";

export type LineSeries = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
};

const W = 640;
const H = 180;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 4;

export function LineChart({
  series,
  xLabels,
  ariaLabel,
  tickEvery = 1,
}: {
  series: LineSeries[];
  xLabels: string[];
  ariaLabel: string;
  tickEvery?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;
  const all = series.flatMap((s) =>
    s.values.filter((v): v is number => v != null),
  );
  // 위 눈금은 10%p 단위로 올림 — 가동률은 대개 10~40%라 0~100%로 그리면 선이 바닥에 붙는다.
  const top = Math.max(0.1, Math.ceil(Math.max(...all, 0) * 10) / 10);
  const x = (i: number) =>
    n <= 1 ? W / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
  const y = (v: number) => PAD_T + (1 - v / top) * (H - PAD_T - PAD_B);
  const showDots = n <= 31;

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

  return (
    <figure className="flex flex-col gap-1" aria-label={ariaLabel}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--sl-ink-soft)]">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="min-h-5 text-xs text-[var(--sl-ink-soft)]">
        {hover != null ? (
          <>
            <b className="text-[#171310] dark:text-[#f2ede2]">
              {xLabels[hover]}
            </b>
            {series.map((s) => (
              <span key={s.key} className="ml-3 inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}{" "}
                <b className="tabular-nums text-[#171310] dark:text-[#f2ede2]">
                  {formatPct(s.values[hover])}
                </b>
              </span>
            ))}
          </>
        ) : (
          "그래프에 올리면 값이 보입니다"
        )}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-44 w-full overflow-visible"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
        >
          <line
            x1={0}
            x2={W}
            y1={y(top)}
            y2={y(top)}
            stroke="var(--sl-hairline)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={W}
            y1={y(top / 2)}
            y2={y(top / 2)}
            stroke="var(--sl-hairline)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={W}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--sl-hairline)"
            vectorEffect="non-scaling-stroke"
          />
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="var(--sl-ink-soft)"
              strokeOpacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {series.map((s, si) => (
            <path
              key={s.key}
              d={paths[si]}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* 올렸을 때 잡히는 칸 — 점보다 넓게 */}
          {xLabels.map((label, i) => (
            <rect
              key={label + i}
              x={n <= 1 ? 0 : x(i) - (W - PAD_L - PAD_R) / (n - 1) / 2}
              width={n <= 1 ? W : (W - PAD_L - PAD_R) / (n - 1)}
              y={0}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        {/* 점은 SVG 밖 HTML로 — preserveAspectRatio="none"이라 SVG 원은 찌그러진다. */}
        <div className="pointer-events-none absolute inset-0">
          {series.map((s) =>
            s.values.map((v, i) =>
              v != null && (showDots || hover === i) ? (
                <span
                  key={`${s.key}-${i}`}
                  className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--sl-surface,#fff)] dark:ring-[#14120d]"
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
      </div>
      <div className="relative h-4 text-[10px] tabular-nums text-[var(--sl-ink-soft)]">
        {xLabels.map((l, i) =>
          i % tickEvery === 0 ? (
            <span
              key={l + i}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(x(i) / W) * 100}%` }}
            >
              {l}
            </span>
          ) : null,
        )}
      </div>
      <div className="text-right text-[10px] tabular-nums text-[var(--sl-ink-soft)]">
        세로 눈금 위 끝 {formatPct(top, 0)}
      </div>
    </figure>
  );
}
