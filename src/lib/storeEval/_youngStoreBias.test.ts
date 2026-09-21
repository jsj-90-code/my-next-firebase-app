// 개점 얼마 안 된 매장을 계통적으로 과소예측하나 (2026-09-21)
//
// ── 어디서 나왔나 ─────────────────────────────────────────────────────────
// `_gwangjuChumdan.test.ts` 관문 2가 열렸다:
//   완료월 ≤2  6곳   부호평균 -25.5%   (광주첨단 -54.6 · 진주혁신 -52.9 · 문산 -31.9
//                                      · 야탑 -17.0 · 인천서창 -4.2 · 평내호평 +7.9)
//   완료월 >2 32곳   부호평균  -5.1%
// 꼬리 6곳 중 **셋**이 그 무리다. 인계문의 다음 일감인 진주혁신도시본점도 완료월 2다.
// 그래서 진주혁신을 개별로 파기 전에 이 축부터 가른다 — 안 그러면 "이 매장 사정"으로
// 설명하려다 헛수고한다.
//
// ── 왜 상관으로 판정하면 안 되나 ──────────────────────────────────────────
// ⚠️ **완료월은 목표값 정의에 들어간 재료다.** `actualMonthlyRevenueAvg`는 "오픈 2개월차
//    ~최신 완료월 평균"이라, 어린 매장은 **한두 달짜리 평균**이고 오래된 매장은 3년 평균이다.
//    예측 쪽에는 완료월이 안 들어간다. 그러니 "완료월 ↔ 오차" 상관은 산식이 틀렸다는 증거가
//    아니라 **목표를 서로 다르게 재고 있다**는 것일 수도 있다. 둘은 전혀 다른 얘기다.
//
// ⚠️ n=6은 그 자체로 검정력이 없다. 부호 5:1은 양측 부호검정 p=0.219다. 미달이다.
//    **그래서 6곳을 보지 않는다.** 대신 오래된 32곳에서 **목표를 다시 만들어** 본다.
//
// ── 결정적 검정 (여기가 이 파일의 핵심) ───────────────────────────────────
// 오래된 매장도 개점월부터 매출이 다 있다(확인함). 그러면 **같은 매장을 어리게 잘라볼 수**
// 있다 — 개점 2개월차 한 달만 떼어 목표로 삼는 것이다.
//
//   배율 = (그 매장의 개점 2개월차 한 달)  ÷  (그 매장의 지금 목표 = 2개월차~최신 평균)
//
//   배율 중앙 > 1   개점 초기가 실제로 높다(오픈발). 어린 매장이 과소예측되는 건
//                   **산식 탓이 아니라 목표를 개점 초기 한 점으로 재서**다.
//   배율 중앙 < 1   개점 초기가 오히려 낮다(자리잡는 중). 그러면 어린 매장은 **과대**
//                   예측돼야 하는데 관측은 반대다 -> 이 축으로는 설명이 안 된다.
//
// 이 검정에는 산식이 안 들어간다. 매출 원장만 쓴다. 순환이 없다.
//
// ── 관문 (먼저 박는다. 결과를 보고 고치지 않는다) ─────────────────────────
//   관문 1  오래된 매장에서 배율 중앙이 1에서 **유의하게** 떨어져 있나 (부호검정 p<0.05).
//   관문 2  방향이 맞나 — 배율 > 1 이어야 "어린 매장 과소예측"을 설명한다.
//   관문 3  크기가 맞나 — 관측된 격차는 -25.5% vs -5.1% = 20.4%p다. 이걸 설명하려면
//           배율이 약 1.27은 되어야 한다(1 ÷ 0.795). 배율이 그보다 한참 작으면
//           **일부만** 설명하는 것이고, 나머지는 여전히 산식 쪽 얘기다.
//   관문 4  어린 6곳을 배율로 보정하면 나머지 32곳 수준으로 붙나.
//
// ⚠️ **측정만 한다.** 목표 정의도 산식도 이 파일이 안 바꾼다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_youngStoreBias.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** "개점월 + n개월"의 yyyy-MM. n=1이면 개점 2개월차다. */
function monthAfter(openedAt: string, n: number): string | null {
  const t = new Date(openedAt);
  if (!Number.isFinite(t.getTime())) return null;
  const y = t.getFullYear(), m = t.getMonth() + n;
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

describeIf("어린 매장 편향 — 목표를 다시 만들어 본다", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
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
  fittedParams(DEFAULT_TEXTBOOK_PARAMS, sc); // 축척은 안 바꾼다. 오차만 읽는다.

  // ── 매출 원장 ─────────────────────────────────────────────────────────
  type Meta = { name: string; opened: string | null; months: number | null; target: number | null };
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
    });
  }
  const salesByStore = new Map<string, Map<string, number>>();
  for (const r of (snap.sales ?? []) as Record<string, unknown>[]) {
    const code = r.storeCode as string, ym = r.yearMonth as string;
    if (!code || !ym) continue;
    const rev = ((r.pcSales as number) ?? 0) + ((r.productSales as number) ?? 0);
    if (!(rev > 0)) continue;
    if (!salesByStore.has(code)) salesByStore.set(code, new Map());
    salesByStore.get(code)!.set(ym, rev);
  }
  const errByName = new Map<string, number>();
  for (const x of sc.rows) {
    if (x.predicted == null || !(x.actual > 0)) continue;
    errByName.set(x.storeName ?? x.storeCode, x.predicted / x.actual - 1);
  }

  const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
  const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
  /** 양측 이항검정(p=0.5) 정확검정. */
  const signTest = (hits: number, n: number) => {
    const C = (nn: number, k: number) => { let v = 1; for (let i = 0; i < k; i++) v = (v * (nn - i)) / (i + 1); return v; };
    const target = C(n, hits) * Math.pow(0.5, n);
    let p = 0;
    for (let k = 0; k <= n; k++) { const pk = C(n, k) * Math.pow(0.5, n); if (pk <= target + 1e-12) p += pk; }
    return Math.min(1, p);
  };

  it("(0) 개점 초기 매출이 그 매장 평균보다 높나 — 램프 곡선", () => {
    // 개월차별로 "그 달 매출 ÷ 그 매장 지금 목표"를 모아 중앙을 본다.
    // 매장 안에서 나눈 값이라 매장 크기가 약분된다.
    console.log(`\n[램프 곡선] 개월차별 (그 달 매출 ÷ 그 매장 목표) 중앙  ·  1보다 크면 그 시기가 높다`);
    console.log("  개월차   표본   중앙배율   평균배율");
    for (let n = 1; n <= 12; n++) {
      const v: number[] = [];
      for (const [code, m] of meta) {
        if (!m.opened || !m.target || !(m.target > 0)) continue;
        if ((m.months ?? 0) < 12) continue; // 12개월 다 찬 매장만 — 어린 매장은 분모가 그 달 자신이다
        const ym = monthAfter(m.opened, n);
        const rev = ym ? salesByStore.get(code)?.get(ym) : undefined;
        if (rev == null) continue;
        v.push(rev / m.target);
      }
      if (v.length < 5) continue;
      console.log(`  ${String(n + 1).padStart(4)}차  ${String(v.length).padStart(4)}곳   ${med(v).toFixed(3).padStart(7)}   ${mean(v).toFixed(3).padStart(7)}`);
    }
    console.log(`  ⚠️ 2차(개점 다음 달)가 1보다 크면 오픈발, 작으면 자리잡는 중이다.`);
    expect(meta.size).toBeGreaterThan(30);
  });

  it("(1)(2)(3) 결정적 검정 — 오래된 매장을 '어리게' 잘라본다", () => {
    type R = { name: string; ratio: number; m2: number; target: number };
    const xs: R[] = [];
    for (const [code, m] of meta) {
      if (!m.opened || !m.target || !(m.target > 0)) continue;
      if ((m.months ?? 0) < 12) continue;
      const ym = monthAfter(m.opened, 1);
      const m2 = ym ? salesByStore.get(code)?.get(ym) : undefined;
      if (m2 == null || !(m2 > 0)) continue;
      xs.push({ name: m.name, ratio: m2 / m.target, m2, target: m.target });
    }
    xs.sort((a, b) => a.ratio - b.ratio);
    console.log(`\n[오래된 매장을 어리게 자르기] 완료월 12 이상 ${xs.length}곳`);
    console.log("  매장              개점2개월차     지금목표    배율");
    for (const x of xs) {
      console.log(`  ${x.name.padEnd(16)}${Math.round(x.m2).toLocaleString().padStart(11)}` +
        `${Math.round(x.target).toLocaleString().padStart(12)}  ${x.ratio.toFixed(3).padStart(6)}`);
    }
    const ratios = xs.map((x) => x.ratio);
    const above = ratios.filter((r) => r > 1).length;
    const p = signTest(above, ratios.length);
    console.log(`\n  배율 중앙 ${med(ratios).toFixed(3)} · 평균 ${mean(ratios).toFixed(3)}` +
      ` · 1보다 큰 곳 ${above}/${ratios.length}`);
    console.log(`  관문 1  부호검정 p = ${p.toFixed(4)}  ${p < 0.05 ? "**유의**" : "미달"}`);
    console.log(`  관문 2  방향     중앙 ${med(ratios) > 1 ? "> 1  개점 초기가 높다 -> 가설과 **맞다**" : "< 1  개점 초기가 낮다 -> 가설과 **반대다**"}`);
    console.log(`  관문 3  크기     -25.5% vs -5.1% 격차(20.4%p)를 설명하려면 배율 약 1.27 필요.` +
      `  실제 ${med(ratios).toFixed(3)} -> ${med(ratios) >= 1.27 ? "**충분**" : `설명 가능한 몫은 ${((med(ratios) - 1) * 100).toFixed(1)}%p 쪽`}`);
    expect(xs.length).toBeGreaterThan(20);
  });

  it("(4) 어린 6곳을 보정하면 나머지에 붙나", () => {
    const young = [...meta.entries()].filter(([, m]) => (m.months ?? 99) <= 2);
    const old = [...meta.entries()].filter(([, m]) => (m.months ?? 0) > 2);
    // (1)에서 나온 배율 중앙 — 어린 매장 목표가 그만큼 부풀어 있다고 보고 되돌린다.
    const cal: number[] = [];
    for (const [code, m] of meta) {
      if (!m.opened || !m.target || !(m.target > 0) || (m.months ?? 0) < 12) continue;
      const ym = monthAfter(m.opened, 1);
      const v = ym ? salesByStore.get(code)?.get(ym) : undefined;
      if (v != null && v > 0) cal.push(v / m.target);
    }
    const k = cal.length ? med(cal) : 1;
    const errOf = (e: [string, Meta]) => errByName.get(e[1].name);
    const ye = young.map(errOf).filter((v): v is number => v != null);
    const oe = old.map(errOf).filter((v): v is number => v != null);
    // 목표를 k로 나누면(= 정상화하면) 예측/목표 비는 k배가 된다.
    const yAdj = ye.map((e) => (1 + e) * k - 1);
    console.log(`\n[보정] 배율 ${k.toFixed(3)}로 어린 매장 목표를 되돌렸을 때`);
    console.log(`  어린 ${String(ye.length).padStart(2)}곳   보정 전 ${(mean(ye) * 100).toFixed(1).padStart(6)}%  ->  보정 후 ${(mean(yAdj) * 100).toFixed(1).padStart(6)}%`);
    console.log(`  나머지 ${String(oe.length).padStart(2)}곳                              ${(mean(oe) * 100).toFixed(1).padStart(6)}%`);
    console.log(`  남는 격차 ${((mean(yAdj) - mean(oe)) * 100).toFixed(1)}%p  (보정 전 ${((mean(ye) - mean(oe)) * 100).toFixed(1)}%p)`);
    console.log("\n  낱개 — 어린 매장");
    for (const [, m] of young.sort((a, b) => (errByName.get(a[1].name) ?? 0) - (errByName.get(b[1].name) ?? 0))) {
      const e = errByName.get(m.name);
      if (e == null) continue;
      console.log(`    ${m.name.padEnd(16)}완료월 ${String(m.months).padStart(2)}   ${(e * 100).toFixed(1).padStart(7)}%  ->  ${(((1 + e) * k - 1) * 100).toFixed(1).padStart(7)}%`);
    }
    console.log(`\n  ⚠️ 관문 4 — 남는 격차가 0 근처면 "어린 매장이라서"로 설명된다.`);
    console.log(`     여전히 크게 남으면 그 몫은 **산식 얘기**이고, 개별 조사가 필요하다.`);
    expect(ye.length).toBeGreaterThan(3);
  });
});
