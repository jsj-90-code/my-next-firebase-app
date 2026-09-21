// 재정립 4단계 — 그래서 후보지 예상 가동률을 얼마나 믿을 수 있나 (2026-09-21)
//
// ── 1~3단계 결론 ─────────────────────────────────────────────────────────
//   1. 퍼짐의 95%가 수요 추정에서 온다(자사 PC수는 76~130대로 거의 안 변한다)
//   2. 산식이 강제하는 지수 1이 틀렸다 — 자료는 b=0.30·c=0.135를 원한다(38겹 전부 1을 거부)
//   3. 잔차를 설명하는 변수가 없다 — 시급조차 아무 일도 안 한다
//   ⇒ 지수를 바로잡으면 지금 산식은 유의하게 이기지만, **'전부 평균'은 유의하게 못 이긴다**
//
// ── 그래서 실무에서 무슨 뜻인가 ───────────────────────────────────────────
// 기존점 38곳의 **실측** 가동률은 좁다. 그런데 산식이 **후보지**에 대해 내놓는 예측은
// 그보다 넓을 수 있다. 넓은 만큼이 **검증된 적 없는 외삽**이다.
//
// ⚠️ 여기서 조심할 것 — "산식이 쓸모없다"로 읽으면 안 된다. 표본 38곳은 **우리가 골라서 연
//    자리들**이다. 나쁜 자리는 애초에 안 열었으므로 가동률이 좁게 모여 있는 게 당연하다
//    (`project_competitive_inferiority_never` — 열위 표본은 영원히 안 나온다).
//    그러니 바른 결론은 "산식이 틀렸다"가 아니라 **"우리가 연 매장들 사이에서는 변별력이
//    검증 안 된다"**이고, 그 범위 **밖**에 대해서는 판단할 자료가 아예 없다는 것이다.
//
// ── 이 파일이 내놓는 것 ───────────────────────────────────────────────────
//   (1) 기존점 실측 vs 기존점 예측 vs 후보지 예측의 **분포 견주기**
//   (2) 후보지별로 예측이 기존점 실측 범위 **밖**인지 표시 — 그게 외삽 경고다
//   (3) 지수를 바로잡으면(b=0.30·c=0.135) 후보지 예측이 어디로 가나
//
// ⚠️ 측정만 한다. 본체 무수정.
//
// 실행:
//   npx vitest run src/lib/storeEval/_candidateUtilTrust.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  utilizationByStore, qscInWindowAverage, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

describeIf("재정립 4단계 — 후보지 예상 가동률의 신뢰 범위", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const locByCode = new Map(locationEvaluations.map((l) => [l.candidateCode, l]));
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, locationEvaluations, settings);
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
  const franchiseManagement = franchiseManagementFromRows(base, qscByStoreCode);
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement });

  const actual = base.map((r) => r.input.actualUtilization).filter((x): x is number => x != null && x > 0);
  const predExisting: number[] = [];
  for (const r of base) {
    const b = computeTextbook(r.input, full);
    if (b.utilization != null && b.utilization > 0) predExisting.push(b.utilization);
  }
  type C = { n: string; u: number; uFix: number; X: number; L: number };
  const C: C[] = [];
  // 지수 교정판을 만들려면 기존점에서 a,b,c를 적합해야 한다 — 후보지로 적합하면 안 된다.
  const B0 = 0.3, C0 = 0.15;
  const trX: number[] = [], trL: number[] = [], trA: number[] = [];
  for (const r of base) {
    const b = computeTextbook(r.input, full);
    const act = r.input.actualUtilization;
    if (act == null || !(act > 0) || b.utilization == null || !(b.utilization > 0) || b.locationMultiplier == null) continue;
    trX.push(Math.log(b.utilization) - Math.log(b.locationMultiplier));
    trL.push(Math.log(b.locationMultiplier));
    trA.push(Math.log(act));
  }
  const a0 = mean(trA.map((v, i) => v - B0 * trX[i] - C0 * trL[i]));
  for (const r of candRows) {
    const b = computeTextbook(r.input, full);
    if (b.utilization == null || !(b.utilization > 0) || b.locationMultiplier == null) continue;
    const X = Math.log(b.utilization) - Math.log(b.locationMultiplier);
    const L = Math.log(b.locationMultiplier);
    C.push({
      n: candidates.find((x) => x.code === r.input.storeCode)?.name?.trim() ?? r.input.storeCode,
      u: b.utilization, uFix: Math.exp(a0 + B0 * X + C0 * L), X, L,
    });
  }

  it("(1) 분포 견주기 — 후보지 예측이 실측보다 넓은가", () => {
    const show = (k: string, v: number[]) =>
      console.log(`  ${k.padEnd(20)}n=${String(v.length).padStart(3)}  중앙 ${pct(med(v))}  범위 ${pct(Math.min(...v))}~${pct(Math.max(...v))}` +
        `  SD ${(sdOf(v) * 100).toFixed(1)}%p  (최대÷최소 ${(Math.max(...v) / Math.min(...v)).toFixed(1)}배)`);
    console.log(`\n[분포 견주기]`);
    show("기존점 **실측**", actual);
    show("기존점 예측(지금 산식)", predExisting);
    show("후보지 예측(지금 산식)", C.map((x) => x.u));
    show("후보지 예측(지수 교정)", C.map((x) => x.uFix));
    console.log(`\n  ⚠️ 후보지 예측이 **기존점 실측보다 넓으면** 그 초과분은 검증된 적이 없다.`);
    console.log(`     기존점에서도 예측이 실측보다 넓은 게 이미 확인됐다(1.55배). 후보지는 더 심할 수 있다.`);
    expect(C.length).toBeGreaterThan(5);
  });

  it("(2) 후보지별 외삽 경고", () => {
    const lo = Math.min(...actual), hi = Math.max(...actual);
    console.log(`\n[후보지 예상 가동률] 기존점 실측 범위 ${pct(lo)}~${pct(hi)} 밖이면 외삽이다`);
    console.log(`  후보지            지금 산식   지수 교정   차이      판정`);
    for (const x of [...C].sort((a, b) => a.u - b.u)) {
      const out = x.u < lo || x.u > hi;
      const tag = out ? (x.u < lo ? "🔴 실측 최저보다 낮다" : "🔴 실측 최고보다 높다") : "⚪ 범위 안";
      console.log(`  ${x.n.padEnd(16)}${pct(x.u).padStart(10)}${pct(x.uFix).padStart(11)}` +
        `${((x.uFix - x.u) * 100).toFixed(1).padStart(9)}%p   ${tag}`);
    }
    const outs = C.filter((x) => x.u < lo || x.u > hi);
    console.log(`\n  외삽 ${outs.length}곳 / ${C.length}곳`);
    console.log(`  ⚠️ 지수를 교정하면 예측이 **가운데로 몰린다**. 그게 자료가 지지하는 폭이다.`);
    console.log(`     지금 산식의 넓은 폭은 "그만큼 다르다"가 아니라 **"산식이 그만큼 벌린다"**이다.`);
    expect(C.length).toBeGreaterThan(5);
  });

  it("(3) 실무 해석 — 이 표를 어떻게 읽어야 하나", () => {
    const lo = Math.min(...actual), hi = Math.max(...actual);
    const spread = (v: number[]) => sdOf(v.map(Math.log));
    console.log(`\n[해석]`);
    console.log(`  1. 기존점 실측 퍼짐 SD(log) ${spread(actual).toFixed(3)} · 후보지 예측 퍼짐 ${spread(C.map((x) => x.u)).toFixed(3)}` +
      ` → 후보지 예측이 **${(spread(C.map((x) => x.u)) / spread(actual)).toFixed(2)}배** 넓다`);
    console.log(`  2. 지수 교정판 퍼짐 ${spread(C.map((x) => x.uFix)).toFixed(3)} → ${(spread(C.map((x) => x.uFix)) / spread(actual)).toFixed(2)}배`);
    console.log(`\n  ⚠️ **"산식이 쓸모없다"로 읽으면 안 된다.** 표본 38곳은 우리가 **골라서 연** 자리들이다.`);
    console.log(`     나쁜 자리는 애초에 안 열었으니 가동률이 좁게 모인 게 당연하다.`);
    console.log(`     바른 결론: **우리가 연 매장들 사이에서는 산식의 변별력이 검증되지 않는다.**`);
    console.log(`     그 범위 밖(정말 나쁜 자리)에 대해서는 **판단할 자료가 아예 없다.**`);
    console.log(`\n  그래서 실무에서 쓸 수 있는 말은 이 정도다:`);
    console.log(`     · 후보지 예상 가동률은 **${pct(lo)}~${pct(hi)} 안**이면 "기존점과 비슷한 자리"다`);
    console.log(`     · 그 밖으로 나가면 **근거 없는 외삽**이므로 숫자를 그대로 믿지 말 것`);
    console.log(`     · 후보지 사이의 **순위**는 참고는 되지만(r≈0.5) 폭은 과장돼 있다`);
    expect(actual.length).toBeGreaterThan(30);
  });
});
