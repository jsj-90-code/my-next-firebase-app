// 왜 가동률 차이가 생각보다 작은가 — 시간대 구조로 설명되나 (2026-09-21)
//
// ── 사용자 제약 ───────────────────────────────────────────────────────────
// *"산식 건드려도 돼. (...) **다만 변경되는 산식이 실무에 맞는 형태여야지.
//  값에 맞춘다는 느낌 말고.**"*
//
// 맞는 말이다. 앞서 낸 `가동률 ∝ (수요÷총공급)^0.37`은 성적은 좋지만 **"왜 0.37인가"를
// 실무 말로 설명할 수 없다.** 그건 값에 맞춘 것이다. 그래서 안 넣기로 하고,
// **압축이 일어나는 기전**을 실측으로 찾는다.
//
// ── 가설 — 시간대 구조가 월평균을 뭉갠다 ──────────────────────────────────
// 월평균 가동률은 **24시간 평균**이다. 새벽 4~8시는 어느 매장이나 거의 빈다.
// 저녁 18~22시는 어느 매장이나 찬다(만석이면 수요가 더 있어도 못 받는다).
// 그러면 매장 간 차이는 **중간 시간대에서만** 나고, 월평균으로 뭉개면 작아진다.
//
// 이게 사실이면 실무에 맞는 형태가 저절로 나온다:
//   **수요÷공급은 "피크 가동률"을 가르고, 월평균은 그 일부만 반영한다.**
// 지수 0.37 같은 임의의 수가 아니라 **시간대 구조**라는 설명이 붙는다.
//
// ── 관문 (먼저 박는다) ────────────────────────────────────────────────────
//   관문 1  시간대별로 매장 간 퍼짐이 다른가. 새벽이 좁고 중간이 넓은가?
//   관문 2  **피크에 만석이 걸리는가.** 걸리면 "수요가 더 있어도 못 받는다"가 실측된다.
//           이게 압축의 직접 증거다.
//   관문 3  수요÷공급이 **월평균보다 피크 가동률을 더 잘 맞히는가.**
//           그래야 "수요는 피크를 가른다"는 말이 선다.
//   관문 4  ⚠️ 관문 3이 미달이면 이 설명은 **틀린 것**이다. 억지로 붙이지 않는다.
//
// ⚠️ 자료 주의 — 게토 시간대 자료는 32곳이고 평가창이 매장마다 다르다.
//    월매출 쪽 실측 가동률(38곳)과 **표본이 다르다.** 겹치는 곳만 쓴다.
//
// ⚠️ 측정만 한다. 본체 무수정.
//
// 실행:
//   npx vitest run src/lib/storeEval/_hourlyShapeMechanism.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const GETO = ".local-tools/geto-utilization.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
const hasGeto = existsSync(GETO);
const describeIf = hasValidationSnapshot() && hasGeto ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const varOf = (a: number[]) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };
const sdOf = (a: number[]) => Math.sqrt(varOf(a));
const cov = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  return mean(a.map((_, i) => (a[i] - ma) * (b[i] - mb)));
};
const corr = (a: number[], b: number[]) => {
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? cov(a, b) / s : NaN;
};
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
/** n≈30의 단일 유의선. 여러 개를 훑으면 더 높게 봐야 한다. */
const SIG = 0.36;

type GetoRow = { yearMonth: string; monthlyRate: number; hourly: Record<string, number> };
type GetoSite = { storeName: string; buckets: string[]; rows: GetoRow[] };

describeIf("시간대 구조가 월평균 가동률을 뭉개나", () => {
  const geto = JSON.parse(readFileSync(GETO, "utf8")) as Record<string, GetoSite>;
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
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const full = fittedParams(P, scoreTextbook(base, P));
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));

  const BUCKETS = ["0~2", "2~4", "4~6", "6~8", "8~10", "10~12", "12~14", "14~16", "16~18", "18~20", "20~22", "22~24"];

  /** 평가창 안 월만 골라 시간대별 평균을 낸다 — 월매출 쪽 실측 가동률과 같은 창을 쓴다. */
  type Rec = { n: string; hourly: number[]; monthly: number; peak: number; x: number };
  const R: Rec[] = [];
  for (const r of base) {
    const s = storeByCode.get(r.input.storeCode);
    const site = geto[r.input.storeName ?? ""];
    const b = computeTextbook(r.input, full);
    if (!s || !site || b.utilization == null || !(b.utilization > 0)) continue;
    const win = new Set(evaluationMonths(s.openedAt));
    const rows = site.rows.filter((x) => win.has(x.yearMonth));
    if (rows.length < 3) continue;
    const hourly = BUCKETS.map((k) => mean(rows.map((x) => x.hourly[k] ?? 0)));
    R.push({
      n: r.input.storeName ?? r.input.storeCode,
      hourly,
      monthly: mean(rows.map((x) => x.monthlyRate)),
      peak: Math.max(...hourly),
      // 산식이 내놓는 예측 가동률 = 수요÷공급 구조의 출력. 이걸 설명변수로 쓴다.
      x: b.utilization,
    });
  }

  it("(1) 관문 1 — 시간대별로 매장 간 퍼짐이 다른가", () => {
    console.log(`\n[시간대별 분포] n=${R.length}곳 · 평가창 안 월만 평균`);
    console.log(`  시간대    중앙 가동률   매장간 SD   SD(log)   최소~최대`);
    for (let i = 0; i < BUCKETS.length; i++) {
      const v = R.map((x) => x.hourly[i]).filter((x) => x > 0);
      if (v.length < 10) { console.log(`  ${BUCKETS[i].padEnd(8)}자료 부족(${v.length}곳)`); continue; }
      console.log(`  ${BUCKETS[i].padEnd(8)}${pct(med(v)).padStart(10)}${pct(sdOf(v)).padStart(12)}` +
        `${sdOf(v.map(Math.log)).toFixed(3).padStart(10)}   ${pct(Math.min(...v))}~${pct(Math.max(...v))}`);
    }
    const monthlySd = sdOf(R.map((x) => Math.log(x.monthly)));
    console.log(`\n  월평균    ${pct(med(R.map((x) => x.monthly))).padStart(10)}${pct(sdOf(R.map((x) => x.monthly))).padStart(12)}${monthlySd.toFixed(3).padStart(10)}`);
    console.log(`\n  ⚠️ 새벽이 좁고 중간이 넓으면 — 월평균이 **뭉개진 값**이라는 뜻이다.`);
    expect(R.length).toBeGreaterThan(20);
  });

  it("(2) ⭐ 관문 2 — 피크에 만석이 걸리나 (압축의 직접 증거)", () => {
    const peaks = R.map((x) => x.peak);
    console.log(`\n[피크 가동률] 하루 중 제일 찬 시간대의 값`);
    console.log(`  중앙 ${pct(med(peaks))} · 범위 ${pct(Math.min(...peaks))}~${pct(Math.max(...peaks))} · SD(log) ${sdOf(peaks.map(Math.log)).toFixed(3)}`);
    for (const t of [0.7, 0.8, 0.9, 0.95]) {
      console.log(`  피크가 ${(t * 100).toFixed(0)}% 넘는 곳: ${R.filter((x) => x.peak >= t).length}곳 / ${R.length}`);
    }
    console.log(`\n  [피크 시간대가 어디인가]`);
    const cnt = new Map<string, number>();
    for (const x of R) {
      const k = BUCKETS[x.hourly.indexOf(x.peak)];
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
    }
    for (const [k, v] of [...cnt].sort((a, b) => b[1] - a[1])) console.log(`    ${k}시  ${v}곳`);
    console.log(`\n  ⚠️ 피크가 90%를 넘는 곳이 많으면 — **그 시간엔 수요가 더 있어도 못 받는다.**`);
    console.log(`     그게 "수요 2배라고 가동률 2배가 안 되는" 물리적 이유다. 실무로 설명되는 기전이다.`);
    console.log(`     거의 없으면 이 설명은 못 쓴다 — 억지로 붙이지 않는다.`);
    expect(R.length).toBeGreaterThan(20);
  });

  it("(3) 관문 3 — 수요÷공급이 월평균보다 피크를 더 잘 맞히나", () => {
    const x = R.map((v) => Math.log(v.x));
    console.log(`\n[설명력 견주기] 설명변수 = 산식의 예측 가동률(수요÷공급 구조의 출력)`);
    console.log(`  과녁              n    상관 r    기울기(log-log)   과녁 SD(log)`);
    const targets: [string, number[]][] = [
      ["월평균 가동률", R.map((v) => Math.log(v.monthly))],
      ["피크 가동률", R.map((v) => Math.log(v.peak))],
      ["18~20시", R.map((v) => Math.log(Math.max(1e-4, v.hourly[9])))],
      ["20~22시", R.map((v) => Math.log(Math.max(1e-4, v.hourly[10])))],
      ["14~16시", R.map((v) => Math.log(Math.max(1e-4, v.hourly[7])))],
      ["10~12시", R.map((v) => Math.log(Math.max(1e-4, v.hourly[5])))],
      ["4~6시(새벽)", R.map((v) => Math.log(Math.max(1e-4, v.hourly[2])))],
    ];
    for (const [k, y] of targets) {
      const r = corr(x, y);
      console.log(`  ${k.padEnd(16)}${String(R.length).padStart(4)}${r.toFixed(3).padStart(10)}${Math.abs(r) > SIG ? " *" : "  "}` +
        `${(cov(x, y) / varOf(x)).toFixed(3).padStart(14)}${sdOf(y).toFixed(3).padStart(15)}`);
    }
    console.log(`\n  ⚠️ **기울기가 1에 가까운 과녁**이 있으면, 산식은 그 과녁을 맞히도록 만들어진 것이다.`);
    console.log(`     월평균 기울기가 1보다 한참 작은데 피크 기울기가 1에 가까우면 —`);
    console.log(`     "산식은 피크를 맞히는데 우리가 월평균으로 채점하고 있었다"가 된다. 그게 실무 설명이다.`);
    expect(R.length).toBeGreaterThan(20);
  });

  it("(4) 관문 4 — 월평균과 피크의 관계는 매장마다 일정한가", () => {
    // 월평균 = 피크 x (시간대 구조 계수). 그 계수가 매장마다 비슷하면 **구조가 공통**이고,
    // 그러면 "피크를 맞히고 공통 계수로 환산한다"는 산식이 실무적으로 선다.
    const ratio = R.map((x) => x.monthly / x.peak);
    console.log(`\n[월평균 ÷ 피크] 시간대 구조 계수`);
    console.log(`  중앙 ${ratio.length ? (med(ratio) * 100).toFixed(1) : "-"}% · 범위 ${(Math.min(...ratio) * 100).toFixed(1)}~${(Math.max(...ratio) * 100).toFixed(1)}%` +
      ` · SD ${(sdOf(ratio) * 100).toFixed(1)}%p · 변동계수 ${(sdOf(ratio) / mean(ratio) * 100).toFixed(1)}%`);
    console.log(`\n  이 계수가 큰 곳/작은 곳`);
    const sorted = [...R].sort((a, b) => (a.monthly / a.peak) - (b.monthly / b.peak));
    for (const v of [...sorted.slice(0, 3), ...sorted.slice(-3)]) {
      console.log(`    ${v.n.padEnd(14)}월평균 ${pct(v.monthly)} ÷ 피크 ${pct(v.peak)} = ${pct(v.monthly / v.peak)}`);
    }
    console.log(`\n  ⚠️ 변동계수가 작으면 — 시간대 구조가 **매장마다 거의 같다**는 뜻이고,`);
    console.log(`     "공통 환산계수"를 쓰는 산식이 실무적으로 정당해진다.`);
    console.log(`     크면 매장마다 구조가 달라서 공통 계수를 못 쓴다.`);
    expect(R.length).toBeGreaterThan(20);
  });
});
