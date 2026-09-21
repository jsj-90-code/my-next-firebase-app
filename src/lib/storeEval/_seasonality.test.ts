// 계절 — 목표값이 성수기에 걸린 매장은 과소예측처럼 보인다 (2026-09-21)
//
// ── 왜 ─────────────────────────────────────────────────────────────────────
// 사용자: *"근데 PC방 성수기/비성수기 참고하고있는거지? 성수기 12~2월·7~8, 비성수 3~4·9~11?
// 그리고 대학상권이랑 그외상권이랑 성수기 다르고"*  ·  *"매출DB에서 가맹점 매출전체흐름
// 보면 대충알수있음"*
//
// **참고 안 하고 있었다.** 목표값은 평가창 12개월 평균이라 12개월이 찬 매장은 계절이 한 바퀴
// 돌아 씻긴다. 그런데 **어린 매장은 안 찬다** — 꼬리에 있는 6곳이 전부 6~8월 성수기 매출로
// 목표가 잡혀 있다.
//
//   광주첨단점 2026-08 · 진주혁신 2026-07~08 · 문산 2026-07~08 · 야탑 2026-07~08
//   인천서창 2026-06~08 · 평내호평 2026-06~08
//
// ⚠️ **이 파일은 `_youngStoreBias.test.ts`의 결론을 고치러 왔다.** 거기서 "램프 2개월차
//    0.844"를 보고 "개점 초기가 낮으니 어린 매장 가설은 기각"이라고 적었는데, 그 램프 곡선에
//    **계절이 섞여 있다.** 개월차로 모으면 개점월이 다른 매장들이 섞여 희석되긴 하지만,
//    표본이 26곳뿐이라 다 안 씻긴다. 계절을 먼저 빼고 램프를 다시 잰다.
//
// ── 어떻게 재나 ───────────────────────────────────────────────────────────
// 계절 지수를 매출에서 직접 뽑는다. 함정은 **추세**다 — 그냥 달력 월로 모으면 매장이 크는지
// 쇠하는지가 섞인다. 그래서 각 달을 **그 달 중심 13개월 이동평균**(±6개월)으로 나눈다.
// 앞뒤 6개월이 다 있는 달만 쓴다. 그러면 추세가 빠지고 계절만 남는다.
//
// 대학가는 따로 뽑는다(사용자 지적). 9월 개강 효과가 실제로 있는지 본다.
//
// ── 관문 (먼저 박는다) ────────────────────────────────────────────────────
//   관문 1  계절 진폭이 있나 — 최고월 ÷ 최저월이 1.2를 넘어야 얘기할 가치가 있다.
//   관문 2  대학가가 다른가 — 9월 지수가 그 외보다 높아야 사용자 말이 맞다.
//   관문 3  **계절을 빼면 램프가 남나** — `_youngStoreBias`의 2개월차 0.844가
//           계절 보정 후에도 1보다 유의하게 작으면 램프는 진짜고, 1에 붙으면 계절 착시였다.
//   관문 4  어린 6곳 목표를 계절 보정하면 오차가 나머지 32곳 쪽으로 오나.
//
// ⚠️ **측정만 한다.** 목표 정의도 산식도 안 바꾼다. 계절 보정을 채택하려면 홀드아웃이 따로 필요하다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_seasonality.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** 개점 다음 달부터 12개월 — evaluationSalesPeriod.evaluationMonths와 같은 규칙. */
function evalMonths(openedAt: string | null): string[] {
  const m = openedAt?.match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (!m) return [];
  const start = Number(m[1]) * 12 + Number(m[2]) - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const mm = start + i + 1;
    return `${Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, "0")}`;
  });
}
const monthNo = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));
const calMonth = (ym: string) => Number(ym.slice(5, 7));
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const signTest = (hits: number, n: number) => {
  const C = (nn: number, k: number) => { let v = 1; for (let i = 0; i < k; i++) v = (v * (nn - i)) / (i + 1); return v; };
  const t = C(n, hits) * Math.pow(0.5, n);
  let p = 0;
  for (let k = 0; k <= n; k++) { const pk = C(n, k) * Math.pow(0.5, n); if (pk <= t + 1e-12) p += pk; }
  return Math.min(1, p);
};

describeIf("계절 — 목표값에 섞인 성수기", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const sc = scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);

  type Meta = { name: string; opened: string | null; months: number | null; target: number | null; uni: boolean };
  const meta = new Map<string, Meta>();
  for (const s of (snap.existingStores ?? []) as Record<string, unknown>[]) {
    if (s.excludedFromModel === true) continue;
    const code = s.storeCode as string;
    if (!code) continue;
    meta.set(code, {
      name: (s.storeName as string) ?? code,
      opened: (s.openedAt as string) ?? null,
      months: (s.completedMonths as number) ?? null,
      target: (s.actualMonthlyRevenueAvg as number) ?? null,
      uni: s.specialDemandType === "대학가",
    });
  }
  const sales = new Map<string, Map<string, number>>();
  for (const r of (snap.sales ?? []) as Record<string, unknown>[]) {
    const code = r.storeCode as string, ym = r.yearMonth as string;
    if (!code || !ym) continue;
    const rev = ((r.pcSales as number) ?? 0) + ((r.productSales as number) ?? 0);
    if (!(rev > 0)) continue;
    if (!sales.has(code)) sales.set(code, new Map());
    sales.get(code)!.set(ym, rev);
  }

  /** 계절 지수 — 13개월 이동평균으로 추세를 뺀 뒤 달력 월로 모은다. */
  function buildIndex(only?: (m: Meta) => boolean) {
    const bucket = new Map<number, number[]>();
    for (const [code, m] of meta) {
      if (only && !only(m)) continue;
      const sv = sales.get(code);
      if (!sv) continue;
      const ms = [...sv.keys()].sort();
      for (const ym of ms) {
        const c = monthNo(ym);
        const win = ms.filter((o) => Math.abs(monthNo(o) - c) <= 6).map((o) => sv.get(o)!);
        if (win.length < 13) continue; // 앞뒤 6개월이 다 있어야 추세가 제대로 빠진다
        const base = mean(win);
        if (!(base > 0)) continue;
        const k = calMonth(ym);
        bucket.set(k, [...(bucket.get(k) ?? []), sv.get(ym)! / base]);
      }
    }
    const out = new Map<number, number>();
    for (const [k, v] of bucket) if (v.length >= 4) out.set(k, med(v));
    return { index: out, n: [...bucket.values()].reduce((a, b) => a + b.length, 0), counts: bucket };
  }
  const all = buildIndex();
  const uni = buildIndex((m) => m.uni);
  const oth = buildIndex((m) => !m.uni);
  /** 그 매장에 맞는 지수 — 대학가는 대학가 곡선, 나머지는 그 외 곡선. 없으면 전체. */
  const idxFor = (m: Meta, ym: string) =>
    (m.uni ? uni.index.get(calMonth(ym)) : oth.index.get(calMonth(ym))) ?? all.index.get(calMonth(ym)) ?? 1;

  it("(1)(2) 계절 지수 — 진폭과 대학가 차이", () => {
    console.log(`\n[계절 지수] 13개월 이동평균으로 추세 제거 · 표본 ${all.n}개월치`);
    console.log("   월   전체(n)  지수    대학가(n) 지수    그외(n)  지수");
    for (let m = 1; m <= 12; m++) {
      const a = all.counts.get(m) ?? [], u = uni.counts.get(m) ?? [], o = oth.counts.get(m) ?? [];
      if (!a.length) continue;
      const f = (v: number[]) => (v.length >= 4 ? med(v).toFixed(3) : "  -  ");
      console.log(`  ${String(m).padStart(3)}월 ${String(a.length).padStart(5)}  ${f(a)}   ${String(u.length).padStart(5)}  ${f(u)}   ${String(o.length).padStart(5)}  ${f(o)}`);
    }
    const vals = [...all.index.values()];
    const amp = Math.max(...vals) / Math.min(...vals);
    console.log(`\n  관문 1  진폭 ${amp.toFixed(3)} (최고 ${Math.max(...vals).toFixed(3)} ÷ 최저 ${Math.min(...vals).toFixed(3)})  ${amp > 1.2 ? "**얘기할 가치가 있다**" : "작다 — 무시해도 된다"}`);
    const s9u = uni.index.get(9), s9o = oth.index.get(9);
    console.log(`  관문 2  9월  대학가 ${s9u?.toFixed(3) ?? "-"} vs 그외 ${s9o?.toFixed(3) ?? "-"}  ` +
      `${s9u != null && s9o != null && s9u > s9o ? "**대학가가 높다 — 개강 효과가 있다**" : "차이 없음"}`);
    expect(all.n).toBeGreaterThan(100);
  });

  it("(3) 계절을 빼면 램프가 남나 — _youngStoreBias 재검", () => {
    // 완료월 12 이상 매장에서, 개월차별 (계절 보정 매출 ÷ 계절 보정 목표).
    console.log(`\n[램프 재측정] 계절 보정 전 vs 후 · 완료월 12 이상`);
    console.log("  개월차   표본   보정전   보정후");
    const raw2: number[] = [], adj2: number[] = [];
    for (let n = 1; n <= 12; n++) {
      const r: number[] = [], a: number[] = [];
      for (const [code, m] of meta) {
        if (!m.opened || !m.target || !(m.target > 0) || (m.months ?? 0) < 12) continue;
        const sv = sales.get(code);
        if (!sv) continue;
        const win = evalMonths(m.opened);
        const ym = win[n - 1];
        const rev = ym ? sv.get(ym) : undefined;
        if (rev == null) continue;
        // 목표도 같은 방식으로 계절 보정한다 — 분모가 안 바뀌면 비교가 안 된다.
        const wv = win.map((w) => ({ w, v: sv.get(w) })).filter((x) => x.v != null);
        if (wv.length < 6) continue;
        const tgtAdj = mean(wv.map((x) => x.v! / idxFor(m, x.w)));
        r.push(rev / mean(wv.map((x) => x.v!)));
        a.push((rev / idxFor(m, ym)) / tgtAdj);
      }
      if (r.length < 5) continue;
      if (n === 1) { raw2.push(...r); adj2.push(...a); }
      console.log(`  ${String(n + 1).padStart(4)}차  ${String(r.length).padStart(4)}곳  ${med(r).toFixed(3).padStart(7)}  ${med(a).toFixed(3).padStart(7)}`);
    }
    const belowRaw = raw2.filter((v) => v < 1).length, belowAdj = adj2.filter((v) => v < 1).length;
    console.log(`\n  2개월차   보정 전 중앙 ${med(raw2).toFixed(3)} (1 미만 ${belowRaw}/${raw2.length}, p=${signTest(belowRaw, raw2.length).toFixed(4)})`);
    console.log(`            보정 후 중앙 ${med(adj2).toFixed(3)} (1 미만 ${belowAdj}/${adj2.length}, p=${signTest(belowAdj, adj2.length).toFixed(4)})`);
    console.log(`  관문 3  ${signTest(belowAdj, adj2.length) < 0.05 ? "**계절을 빼도 램프가 남는다**" : "계절을 빼니 램프가 사라진다 — 계절 착시였다"}`);
    expect(raw2.length).toBeGreaterThan(10);
  });

  it("(4) 어린 매장 목표를 계절 보정하면", () => {
    const errByName = new Map<string, number>();
    const predByName = new Map<string, number>();
    for (const x of sc.rows) {
      if (x.predicted == null || !(x.actual > 0)) continue;
      errByName.set(x.storeName ?? x.storeCode, x.predicted / x.actual - 1);
      predByName.set(x.storeName ?? x.storeCode, x.predicted);
    }
    type R = { name: string; months: number; err: number; errAdj: number; idx: number; win: string[] };
    const out: R[] = [];
    for (const [code, m] of meta) {
      if (!m.opened || !m.target || !(m.target > 0)) continue;
      const e = errByName.get(m.name), p = predByName.get(m.name);
      if (e == null || p == null) continue;
      const sv = sales.get(code);
      if (!sv) continue;
      // 목표에 실제로 들어간 달 = 평가창 중 매출이 있는 달
      const used = evalMonths(m.opened).filter((w) => sv.get(w) != null);
      if (!used.length) continue;
      // 그 달들의 평균 계절 지수로 목표를 나눈다(= 연평균 수준으로 되돌린다).
      const k = mean(used.map((w) => idxFor(m, w)));
      const tgtAdj = m.target / k;
      out.push({ name: m.name, months: m.months ?? 0, err: e, errAdj: p / tgtAdj - 1, idx: k, win: used });
    }
    const young = out.filter((x) => x.months <= 2), old = out.filter((x) => x.months > 2);
    console.log(`\n[계절 보정] 목표에 들어간 달의 평균 계절 지수로 되돌린다`);
    console.log("  매장              완료월  목표에 든 달        평균지수   오차 전 -> 후");
    for (const x of young.sort((a, b) => a.err - b.err)) {
      console.log(`  ${x.name.padEnd(16)}${String(x.months).padStart(5)}  ${x.win.join(",").padEnd(24)}${x.idx.toFixed(3).padStart(6)}   ${(x.err * 100).toFixed(1).padStart(7)}% -> ${(x.errAdj * 100).toFixed(1).padStart(7)}%`);
    }
    console.log(`\n  어린 ${String(young.length).padStart(2)}곳   평균 ${(mean(young.map((x) => x.err)) * 100).toFixed(1).padStart(6)}%  ->  ${(mean(young.map((x) => x.errAdj)) * 100).toFixed(1).padStart(6)}%`);
    console.log(`  나머지 ${String(old.length).padStart(2)}곳   평균 ${(mean(old.map((x) => x.err)) * 100).toFixed(1).padStart(6)}%  ->  ${(mean(old.map((x) => x.errAdj)) * 100).toFixed(1).padStart(6)}%`);
    const gap0 = mean(young.map((x) => x.err)) - mean(old.map((x) => x.err));
    const gap1 = mean(young.map((x) => x.errAdj)) - mean(old.map((x) => x.errAdj));
    console.log(`  격차 ${(gap0 * 100).toFixed(1)}%p  ->  ${(gap1 * 100).toFixed(1)}%p   (${Math.abs(gap1) < Math.abs(gap0) ? `${((1 - Math.abs(gap1) / Math.abs(gap0)) * 100).toFixed(0)}% 줄었다` : "안 줄었다"})`);
    console.log(`  관문 4  ${Math.abs(gap1) < Math.abs(gap0) * 0.5 ? "**계절이 절반 넘게 설명한다**" : "계절만으로는 설명이 안 된다 — 남는 몫은 산식 얘기다"}`);
    // 전체 성적도 같이 — 계절 보정이 표본 전체를 좋게 하나
    const mape = (a: R[]) => mean(a.map((x) => Math.abs(x.err))), mapeA = (a: R[]) => mean(a.map((x) => Math.abs(x.errAdj)));
    console.log(`\n  표본 전체 MAPE  ${(mape(out) * 100).toFixed(2)}%  ->  ${(mapeA(out) * 100).toFixed(2)}%   (n=${out.length})`);
    console.log(`  ⚠️ 표본 안 숫자다. 채택하려면 홀드아웃이 따로 필요하다.`);
    console.log(`  ⚠️ **이건 계절만 뺀 값이다.** 램프는 반대 방향이라 (5)에서 같이 본다.`);
    expect(out.length).toBeGreaterThan(30);
  });

  // ── 둘은 반대 방향이다 ───────────────────────────────────────────────────
  //
  //   계절(6~8월)  지수 1.14~1.16  -> 목표가 높아진다 -> **과소**예측처럼 보인다
  //   램프(2개월차) 지수 0.874      -> 목표가 낮아진다 -> **과대**예측처럼 보인다
  //
  // 어린 매장 6곳은 **둘 다** 걸려 있다. 하나만 보정하면 그 하나만큼 과보정된다.
  it("(5) 계절과 램프를 같이 보정하면 — 둘이 상쇄하나", () => {
    // (3)에서 나온 계절 보정 후 램프 곡선을 개월차별로 다시 뽑는다.
    const ramp = new Map<number, number>();
    for (let n = 1; n <= 12; n++) {
      const a: number[] = [];
      for (const [code, m] of meta) {
        if (!m.opened || (m.months ?? 0) < 12) continue;
        const sv = sales.get(code);
        if (!sv) continue;
        const win = evalMonths(m.opened);
        const ym = win[n - 1];
        const rev = ym ? sv.get(ym) : undefined;
        if (rev == null) continue;
        const wv = win.map((w) => ({ w, v: sv.get(w) })).filter((x) => x.v != null);
        if (wv.length < 6) continue;
        a.push((rev / idxFor(m, ym)) / mean(wv.map((x) => x.v! / idxFor(m, x.w))));
      }
      if (a.length >= 5) ramp.set(n, med(a));
    }
    const errByName = new Map<string, number>(), predByName = new Map<string, number>();
    for (const x of sc.rows) {
      if (x.predicted == null || !(x.actual > 0)) continue;
      errByName.set(x.storeName ?? x.storeCode, x.predicted / x.actual - 1);
      predByName.set(x.storeName ?? x.storeCode, x.predicted);
    }
    type R = { name: string; months: number; err: number; e1: number; e2: number; ks: number; kr: number };
    const out: R[] = [];
    for (const [code, m] of meta) {
      if (!m.opened || !m.target || !(m.target > 0)) continue;
      const e = errByName.get(m.name), p = predByName.get(m.name);
      if (e == null || p == null) continue;
      const sv = sales.get(code);
      if (!sv) continue;
      const win = evalMonths(m.opened);
      const used = win.map((w, i) => ({ w, i: i + 1, v: sv.get(w) })).filter((x) => x.v != null);
      if (!used.length) continue;
      const ks = mean(used.map((x) => idxFor(m, x.w)));               // 계절
      const kr = mean(used.map((x) => ramp.get(x.i) ?? 1));           // 램프
      out.push({ name: m.name, months: m.months ?? 0, err: e, e1: p / (m.target / ks) - 1, e2: p / (m.target / (ks * kr)) - 1, ks, kr });
    }
    const young = out.filter((x) => x.months <= 2), old = out.filter((x) => x.months > 2);
    console.log(`\n[계절 + 램프 같이] 목표 ÷ (계절지수 x 램프지수)`);
    console.log("  매장              계절   램프   곱     오차 원본 -> 계절만 -> 둘다");
    for (const x of young.sort((a, b) => a.err - b.err)) {
      console.log(`  ${x.name.padEnd(16)}${x.ks.toFixed(3).padStart(6)}${x.kr.toFixed(3).padStart(7)}${(x.ks * x.kr).toFixed(3).padStart(7)}   ` +
        `${(x.err * 100).toFixed(1).padStart(7)}% -> ${(x.e1 * 100).toFixed(1).padStart(7)}% -> ${(x.e2 * 100).toFixed(1).padStart(7)}%`);
    }
    const g = (a: R[], k: keyof R) => mean(a.map((x) => x[k] as number));
    console.log(`\n  어린 ${String(young.length).padStart(2)}곳   ${(g(young, "err") * 100).toFixed(1).padStart(6)}%  ->  ${(g(young, "e1") * 100).toFixed(1).padStart(6)}%  ->  ${(g(young, "e2") * 100).toFixed(1).padStart(6)}%`);
    console.log(`  나머지 ${String(old.length).padStart(2)}곳   ${(g(old, "err") * 100).toFixed(1).padStart(6)}%  ->  ${(g(old, "e1") * 100).toFixed(1).padStart(6)}%  ->  ${(g(old, "e2") * 100).toFixed(1).padStart(6)}%`);
    console.log(`  격차        ${((g(young, "err") - g(old, "err")) * 100).toFixed(1).padStart(6)}%p ->  ${((g(young, "e1") - g(old, "e1")) * 100).toFixed(1).padStart(6)}%p ->  ${((g(young, "e2") - g(old, "e2")) * 100).toFixed(1).padStart(6)}%p`);
    const mape = (a: R[], k: keyof R) => mean(a.map((x) => Math.abs(x[k] as number)));
    console.log(`\n  표본 전체 MAPE  ${(mape(out, "err") * 100).toFixed(2)}%  ->  계절만 ${(mape(out, "e1") * 100).toFixed(2)}%  ->  둘다 ${(mape(out, "e2") * 100).toFixed(2)}%`);
    console.log(`  ⚠️ 어린 매장은 6~8월(계절 ↑)이면서 2~3개월차(램프 ↓)라 **둘이 서로 상쇄한다.**`);
    console.log(`     계절만 보정하면 그만큼 과보정이다. 곱이 1에 가까우면 목표는 사실상 안 치우쳐 있다.`);
    expect(out.length).toBeGreaterThan(30);
  });
});
