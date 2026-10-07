"use client";

// PC방 업계 가동률 지수 카드 — 목록 화면 위쪽(2026-10-07 신설). 목록이 이미 읽은 매장 days로 계산한다(추가 읽기 없음).
// 계산은 src/lib/pingMonitor/industryIndex.ts. 설명 문구의 기준일·매장 수는 모두 계산값에서 읽는다.

import { useMemo, useState } from "react";
import { FULL_DAY_MIN_SAMPLES, formatPct, kstDaysAgo, type PingStore } from "@/lib/pingMonitor/summary";
import { INDEX_MIN_MATCHED, dayTypeAverages, industryIndex, type IndexPoint } from "@/lib/pingMonitor/industryIndex";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** 평일·주말 평균을 내는 기간 — 7일이면 주말이 이틀뿐이라 14일. */
const AVG_DAYS = 14;

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dow = (d: string) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
const fmtIndex = (v: number | null) => (v == null ? "-" : v.toFixed(1));
const fmtChange = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[120px]">
      <div className="text-xs text-[var(--sl-ink-soft)]">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-[#171310] dark:text-[#f2ede2]">{value}</div>
      {sub && <div className="text-xs tabular-nums text-[var(--sl-ink-soft)]">{sub}</div>}
    </div>
  );
}

// 작은 선 그래프 — 계열 하나(지수). 평일은 채운 점, 주말은 속 빈 점(색만으로 가르지 않는다). 기준선 100은 점선.
function IndexLine({ points }: { points: IndexPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 120, PX = 8, PT = 10, PB = 10;
  const vals = points.map((p) => p.index).filter((v): v is number => v != null);
  const lo = Math.min(100, ...vals), hi = Math.max(100, ...vals);
  const pad = Math.max((hi - lo) * 0.15, 2);
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => (points.length === 1 ? W / 2 : PX + (i * (W - 2 * PX)) / (points.length - 1));
  const y = (v: number) => PT + ((y1 - v) / (y1 - y0)) * (H - PT - PB);
  // 값이 없는 날(비교 매장 부족)은 선을 끊는다.
  const segments: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.index == null) {
      if (cur) segments.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.index).toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  const h = hover != null ? points[hover] : null;

  return (
    <figure className="flex flex-col gap-1" aria-label="업계 가동률 지수 날짜별 선 그래프">
      <div className="flex h-5 flex-wrap items-center gap-x-3 text-xs text-[var(--sl-ink-soft)]">
        {h ? (
          <span>
            <b className="text-[#171310] dark:text-[#f2ede2]">{md(h.date)}({dow(h.date)})</b> · 지수 {fmtIndex(h.index)} · 전날 대비 {fmtChange(h.change)} · 가동률 {formatPct(h.level)} · 비교 {h.matched}곳
          </span>
        ) : (
          <span>점에 올리면 값이 보입니다</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#c05a2c] dark:bg-[#e07a4a]" />평일</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border-2 border-[#c05a2c] dark:border-[#e07a4a]" />주말</span>
        </span>
      </div>
      {/* 선은 SVG(가로로 늘려도 굵기 그대로), 점·글자는 HTML로 올린다 — 늘린 SVG 안의 점·글자는 찌그러진다. */}
      <div className="relative h-32" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
          <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="currentColor" className="text-[var(--sl-ink-soft)] opacity-40" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {h && <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={H} stroke="currentColor" className="text-[var(--sl-ink-soft)] opacity-30" vectorEffect="non-scaling-stroke" />}
          {segments.map((d) => (
            <path key={d} d={d} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-[#c05a2c] dark:stroke-[#e07a4a]" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span className="absolute right-0 -translate-y-full text-[10px] tabular-nums text-[var(--sl-ink-soft)]" style={{ top: `${(y(100) / H) * 100}%` }}>100</span>
        {points.map((p, i) =>
          p.index == null ? null : (
            <span
              key={p.date}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${hover === i ? "h-3 w-3" : "h-2.5 w-2.5"} ${p.weekend ? "border-[#c05a2c] bg-[#fffdf7] dark:border-[#e07a4a] dark:bg-[#1c1912]" : "border-[#fffdf7] bg-[#c05a2c] dark:border-[#1c1912] dark:bg-[#e07a4a]"}`}
              style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.index) / H) * 100}%` }}
            />
          ),
        )}
        <div className="absolute inset-0 flex">
          {points.map((p, i) => (
            <button
              key={`hit-${p.date}`}
              type="button"
              className="h-full min-w-0 flex-1 focus:outline-none"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${md(p.date)}(${dow(p.date)}) 지수 ${fmtIndex(p.index)}`}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-[var(--sl-ink-soft)]">
        <span>{md(points[0].date)}</span>
        {points.length > 1 && <span>{md(points[points.length - 1].date)}</span>}
      </div>
    </figure>
  );
}

// 한 줄 요약 — 변화율 ±0.5% 안이면 "비슷", 그 밖이면 붐빔/한산(2026-10-07 사용자 "가독성" 지적으로 숫자 대신 문장을 맨 위에).
function headline(p: IndexPoint): string {
  const when = `${md(p.date)}(${dow(p.date)})`;
  if (p.change == null) return `${when}을 기준 100으로 잡았습니다. 다음 날부터 전날과 비교한 값이 나옵니다.`;
  const pct = Math.abs(p.change * 100).toFixed(1);
  if (Math.abs(p.change) < 0.005) return `${when} 업계는 전날과 비슷했습니다`;
  return `${when} 업계는 전날보다 ${pct}% ${p.change > 0 ? "붐볐습니다" : "한산했습니다"}`;
}

export function IndustryIndexCard({ stores }: { stores: PingStore[] }) {
  const r = useMemo(() => industryIndex(stores), [stores]);
  const withIndex = r.points.filter((p) => p.index != null);
  const base = withIndex[0] ?? null;
  const latest = withIndex.at(-1) ?? null;
  const weekAgo = latest ? r.points.find((p) => p.date === shiftDate(latest.date, -7) && p.index != null) : undefined;
  const avg = dayTypeAverages(r.points, kstDaysAgo(AVG_DAYS), kstDaysAgo(1));
  const ex = r.excluded;
  const exText = [
    ex.own && `우리 매장 ${ex.own}곳`,
    ex.ipCheck && `IP 확인 필요 ${ex.ipCheck}곳`,
    ex.noIp && `IP 미등록 ${ex.noIp}곳`,
    ex.neverAlive && `한 번도 대답 없는 곳 ${ex.neverAlive}곳`,
  ].filter(Boolean).join(", ");

  return (
    <section className="app-card rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">PC방 업계 가동률 지수</h2>
        <span className="text-xs text-[var(--sl-ink-soft)]">경쟁점 {latest?.matched ?? r.eligible}곳 기준{base ? ` · ${md(base.date)} = 100` : ""}</span>
      </div>

      {!latest ? (
        <p className="mt-2 text-sm text-[#171310] dark:text-[#f2ede2]">아직 하루를 꽉 채워 잰 날이 없습니다. 하루가 다 차면 그날이 기준(100)이 되고, 그다음 날부터 값이 나옵니다.</p>
      ) : (
        <>
          <p className="mt-2 text-base font-semibold text-[#171310] dark:text-[#f2ede2]">{headline(latest)}</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex flex-wrap gap-x-8 gap-y-3 lg:w-[360px] lg:shrink-0">
              <Stat label="지수 (기준 100)" value={fmtIndex(latest.index)} sub={`가동률 ${formatPct(latest.level)}`} />
              <Stat label="지난주 같은 요일보다" value={weekAgo ? fmtChange(latest.index! / weekAgo.index! - 1) : "-"} sub={weekAgo ? undefined : "아직 1주가 안 됨"} />
              <Stat
                label={`평일 · 주말 평균(${AVG_DAYS}일)`}
                value={`${fmtIndex(avg.weekday)} · ${fmtIndex(avg.weekend)}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <IndexLine points={r.points} />
            </div>
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">우리 매장만 빠졌는지 볼 때 씁니다 — 지수도 같이 빠졌으면 업계 전체 흐름, 지수는 그대로면 우리 매장 사정.</p>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-[var(--sl-ink-soft)]">어떻게 계산하나요 · 표로 보기</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 leading-5 text-[var(--sl-ink-soft)]">
          <li>어제와 오늘 <b>둘 다</b> 하루({FULL_DAY_MIN_SAMPLES}시간 이상)를 잰 경쟁점끼리만 가동률이 몇 % 변했는지 구해, 기준일 100에서부터 이어 붙입니다.</li>
          <li>그래서 새로 등록된 매장은 다음 날부터 들어가고, 들어온 날 지수가 튀지 않습니다. 큰 매장일수록 더 반영됩니다(PC 대수 가중).</li>
          <li>뺀 곳: {exText || "없음"}. 비교할 매장이 {INDEX_MIN_MATCHED}곳보다 적은 날은 건너뜁니다.</li>
          <li>주말은 토·일(그래프의 속 빈 점), 공휴일은 평일로 칩니다.</li>
          {base && latest && <li>{md(base.date)} {base.matched}곳으로 시작, {md(latest.date)}에는 {latest.matched}곳을 비교했습니다.</li>}
        </ul>
        {r.points.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] tabular-nums">
              <thead>
                <tr className="border-b border-[var(--sl-hairline)] text-left text-[var(--sl-ink-soft)]">
                  <th className="px-2 py-1 font-medium">날짜</th>
                  <th className="px-2 py-1 text-right font-medium">지수</th>
                  <th className="px-2 py-1 text-right font-medium">전날 대비</th>
                  <th className="px-2 py-1 text-right font-medium">가동률</th>
                  <th className="px-2 py-1 text-right font-medium">비교 매장</th>
                </tr>
              </thead>
              <tbody>
                {[...r.points].reverse().map((p) => (
                  <tr key={p.date} className="border-b border-[var(--sl-hairline)] last:border-0">
                    <td className="px-2 py-1">{md(p.date)}({dow(p.date)}){p.weekend ? " 주말" : ""}</td>
                    <td className="px-2 py-1 text-right">{p.index == null ? `건너뜀(${INDEX_MIN_MATCHED}곳 미만)` : fmtIndex(p.index)}</td>
                    <td className="px-2 py-1 text-right">{fmtChange(p.change)}</td>
                    <td className="px-2 py-1 text-right">{formatPct(p.level)}</td>
                    <td className="px-2 py-1 text-right">{p.matched}곳</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
