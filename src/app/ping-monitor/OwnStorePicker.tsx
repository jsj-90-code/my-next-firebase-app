"use client";

// "우리 매장" 고르기 — 검색되는 칸(2026-10-24 사용자: 신규후보지에 매장 연결할 때 검색이 없어 힘듦).
// 띄어쓰기·피시↔PC 차이를 무시하고 찾고, 등록하는 매장 위치를 알면 가까운 순으로 보여 준다.
// 값은 예전 드롭다운과 같다: "" = 연결 안 함, 직접 입력 표시값, 아니면 매장 코드.

import { useMemo, useState } from "react";
import type { OwnStoreOption } from "@/lib/pingMonitor/clientStore";
import { normalizeName } from "@/lib/pingMonitor/duplicate";
import { distanceM } from "@/lib/pingMonitor/nearby";

type LatLng = { lat: number; lng: number };
const MAX_ROWS = 30;

export function OwnStorePicker({
  options,
  value,
  fallbackName,
  customValues,
  here,
  locOf,
  onChange,
  className,
}: {
  options: OwnStoreOption[] | null;
  value: string;
  /** 목록에 없는 코드(종료된 후보지 등)가 이미 걸려 있을 때 보일 이름. */
  fallbackName?: string | null;
  customValues: { 기존점: string; 후보지: string };
  here: LatLng | null;
  locOf: (o: OwnStoreOption) => LatLng | null;
  onChange: (v: string) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selectedLabel =
    value === "" ? "연결 안 함"
    : value === customValues.기존점 ? "+ 기존점 직접 입력"
    : value === customValues.후보지 ? "+ 신규후보지 직접 입력"
    : options?.find((o) => o.code === value)?.name ?? fallbackName ?? value;

  const rows = useMemo(() => {
    const nq = normalizeName(q);
    const list = (options ?? [])
      .filter((o) => !nq || normalizeName(o.name).includes(nq) || o.code.toLowerCase().includes(nq))
      .map((o) => {
        const at = locOf(o);
        return { o, d: here && at ? distanceM(here, at) : null };
      });
    list.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || (a.o.kind === b.o.kind ? 0 : a.o.kind === "기존점" ? -1 : 1) || a.o.name.localeCompare(b.o.name, "ko"));
    return list;
  }, [options, q, here, locOf]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ("");
  }

  return (
    <div className="relative">
      <input
        className={className}
        value={open ? q : selectedLabel}
        placeholder={options == null ? "불러오는 중..." : "매장 이름으로 찾기 (예: 부평역)"}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && rows[0]) {
            e.preventDefault();
            pick(rows[0].o.code);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul
          className="app-card absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg py-1 text-sm shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {!q && (
            <>
              <li><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[var(--sl-gold-soft)]" onClick={() => pick("")}>연결 안 함</button></li>
              <li><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[var(--sl-gold-soft)]" onClick={() => pick(customValues.기존점)}>+ 기존점 직접 입력 (목록에 없을 때)</button></li>
              <li><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-[var(--sl-gold-soft)]" onClick={() => pick(customValues.후보지)}>+ 신규후보지 직접 입력 (목록에 없을 때)</button></li>
            </>
          )}
          {rows.slice(0, MAX_ROWS).map(({ o, d }) => (
            <li key={o.code}>
              <button type="button" className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--sl-gold-soft)] ${o.code === value ? "font-semibold" : ""}`} onClick={() => pick(o.code)}>
                <span className="app-badge-neutral shrink-0 rounded px-1.5 text-[11px]">{o.kind}{o.custom ? "·직접" : ""}</span>
                <span className="truncate">{o.name}</span>
                {d != null && <span className="ml-auto shrink-0 text-xs tabular-nums text-[var(--sl-ink-soft)]">{d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`}</span>}
              </button>
            </li>
          ))}
          {rows.length > MAX_ROWS && <li className="px-3 py-1.5 text-xs text-[var(--sl-ink-soft)]">{rows.length - MAX_ROWS}곳 더 있음 — 이름을 더 적어 주세요.</li>}
          {q && rows.length === 0 && <li className="px-3 py-1.5 text-xs text-[var(--sl-ink-soft)]">찾는 매장이 없습니다. 지우고 &ldquo;직접 입력&rdquo;을 고르세요.</li>}
          {!here && <li className="px-3 py-1.5 text-[11px] text-[var(--sl-ink-soft)]">주소를 넣거나 &ldquo;내 위치&rdquo;를 누르면 가까운 순으로 보입니다.</li>}
        </ul>
      )}
    </div>
  );
}
