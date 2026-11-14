"use client";

// 요약 타일·ⓘ 도움말·CSV 받기 — 2026-11-15 아티팩트(claude.ai 측정기 화면)에서 먼저 만든 것을 웹으로 옮김.

import { useEffect, useRef, useState, type ReactNode } from "react";

/** ⓘ 도움말 — PC는 올리면, 휴대폰은 누르면 열림. 바깥을 누르거나 Esc로 닫힘. 꼭 알아야 할 내용은 여기 숨기지 말 것. */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`도움말: ${label ?? "설명"}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="mx-0.5 inline-grid h-[18px] w-[18px] cursor-help place-items-center rounded-full border border-[var(--sl-hairline)] text-[11px] font-semibold leading-none text-[var(--sl-ink-soft)] hover:border-[var(--sl-gold)] hover:text-[var(--sl-gold-ink,#9c4520)]"
      >
        i
      </button>
      {open && (
        <span role="tooltip" className="app-card absolute left-1/2 top-full z-50 mt-1 w-max max-w-[min(300px,80vw)] -translate-x-1/2 whitespace-normal rounded-lg px-3 py-2 text-left text-xs font-normal leading-5 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

/** 작은 추세선(최근 14일 등). 값은 0~1, null은 끊김. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => (v == null ? null : [(i / Math.max(1, values.length - 1)) * 100, 28 - 26 * Math.min(1, v)] as const)).filter((p): p is readonly [number, number] => p != null);
  if (pts.length < 2) return <div className="h-[30px]" />;
  const line = "M" + pts.map((p) => p.join(",")).join("L");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 block h-[30px] w-full" aria-hidden="true">
      <path d={`${line}L${last[0]},30L${pts[0][0]},30Z`} className="fill-[#f3e2d6] dark:fill-[#3a2a21]" />
      <path d={line} className="fill-none stroke-[#c05a2c] dark:stroke-[#e07a4a]" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 요약 타일 — 이름(ⓘ) · 큰 값 · 증감 · 아래 한 줄 · 추세선 */
export function KpiTile({ label, tip, value, unit, note, delta, spark }: { label: string; tip?: string; value: ReactNode; unit?: string; note?: ReactNode; delta?: string | null; spark?: (number | null)[] }) {
  return (
    <div className="app-card flex min-w-0 flex-col gap-0.5 rounded-2xl px-4 py-3">
      <div className="flex items-center text-xs text-[var(--sl-ink-soft)]">
        {label}
        {tip && <InfoTip text={tip} label={label} />}
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5 text-2xl font-semibold tabular-nums tracking-tight text-[#171310] dark:text-[#f2ede2]">
        {value}
        {unit && <small className="text-sm font-medium text-[var(--sl-ink-soft)]">{unit}</small>}
        {delta && <span className="text-sm font-semibold">{delta}</span>}
      </div>
      <div className="min-h-[1.25em] text-xs text-[var(--sl-ink-soft)]">{note}</div>
      {spark && <Sparkline values={spark} />}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** 증감 표기: ↑1.2%p / ↓0.8%p / –0.0%p (값은 0~1 차이) */
export function ppDelta(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${v > 0 ? "↑" : v < 0 ? "↓" : "–"}${Math.abs(v * 100).toFixed(1)}%p`;
}

/** CSV 받기 — 엑셀에서 한글이 깨지지 않게 BOM을 붙인다. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const text = "﻿" + rows.map((r) => r.map((c) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="app-btn-outline rounded-lg px-3 py-1 text-xs" onClick={onClick}>
      CSV로 받기
    </button>
  );
}
