// 재정립 1단계 — 수요층(D)의 퍼짐이 실재하는가 (2026-09-21)
//
// ── 사용자 지시 ───────────────────────────────────────────────────────────
// *"가동률 기준으로 산식 재정립하자. 처음부터 다시 검토해보자. 단가층은 제일 마지막."*
// *"1번부터 시작하셈."*
//
// ── ⚠️ 먼저 내가 틀린 것을 바로잡는다 ─────────────────────────────────────
// 직전 보고에서 *"수요층이 통째로 1.6배 과대하다"*고 했는데 **틀렸다.**
// 근거로 든 게 "경쟁 뺀 예측 가동률 중앙 50.5% vs 실측 32.3%"였는데, 비독점점은
// 수요를 나눠 먹으니 **경쟁을 빼면 예측이 실측보다 높은 게 당연하다.** 그건 과대의
// 증거가 아니다. 실제로 필요 점유율 중앙 61.4% vs 산식 점유율 중앙 55.6%로 **수준은
// 대체로 맞는다.** 틀린 건 수준이 아니라 **배치**다.
//
// ── 그래서 1단계의 진짜 물음 ──────────────────────────────────────────────
// D = log(총수요시간 ÷ (자사PC x 720)) 의 분산이 0.1968로 **최종 분산의 229%**다.
// 그런데 실측과의 공분산은 0.0270뿐(k*=0.137). **퍼짐은 제일 많이 만드는데 설명력은 없다.**
//
//   묻기 1  D의 퍼짐은 **어디서** 오나 — 수요 추정인가, 자사 PC수인가?
//   묻기 2  그 퍼짐이 **실재하는가** — 실측 가동률이 정말 그만큼 벌어지나?
//   묻기 3  수요 안에서 **주거와 유동** 중 누가 퍼짐을 만들고 누가 설명하나?
//   묻기 4  축척을 독점 3곳에 거는 구조가 이 퍼짐을 키우나?
//
// ⚠️ 핵심 구분 — **PC수로 나누는 건 자료가 확실하다**(우리 매장 PC수는 안다).
//    수요 추정은 불확실하다. 퍼짐이 PC수에서 오면 그건 실재하는 것이고,
//    수요 추정에서 오면 의심해야 한다. 이 둘을 안 가르면 엉뚱한 데를 고친다.
//
// ⚠️ 닫힌 갈래 주의 — 교과서식 **수요 구조 탐색**은 조합 15,000개를 훑어 닫혔다
//    (`_demandSearch`, 최대 r=0.247). 여기서 그걸 다시 파는 게 아니다.
//    그때 과녁은 매출·필요점유율이었고, 여기 과녁은 **실측 가동률**이다. 그리고
//    새 구조를 찾는 게 아니라 **지금 구조의 퍼짐이 어디서 오는지** 분해만 한다.
//
// ⚠️ 측정만 한다. 본체 무수정.
//
// 실행:
//   npx vitest run src/lib/storeEval/_demandLayerRebuild.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const varOf = (a: number[]) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };
const sdOf = (a: number[]) => Math.sqrt(varOf(a));
const cov = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  return mean(a.map((_, i) => (a[i] - ma) * (b[i] - mb)));
};
const corr = (a: number[], b: number[]) => cov(a, b) / (sdOf(a) * sdOf(b));
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const MONTH_HOURS = 24 * 30;
/** n=38의 단일 유의선. ⚠️ 여러 개를 훑으면 ±0.41까지 우연히 나온다(`_schoolInflow` 4절). */
const SIG = 0.32;

describeIf("재정립 1단계 — 수요층의 퍼짐", () => {
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

  type Rec = {
    n: string; act: number; pc: number;
    hours: number;        // 총수요시간
    resident: number;     // 주거수요(명)
    floating: number;     // 유동수요(명)
    D: number;            // log(hours / (pc*720))
    rivalIp: number;      // 300m 안팎 합(감쇠 적용 전 날 ip 합)
  };
  const R: Rec[] = [];
  for (const r of base) {
    const b = computeTextbook(r.input, full);
    const act = r.input.actualUtilization, pc = r.input.pcCount;
    if (act == null || !(act > 0) || !pc || b.totalDemandHours == null || !(b.totalDemandHours > 0)) continue;
    R.push({
      n: r.input.storeName ?? r.input.storeCode, act, pc,
      hours: b.totalDemandHours,
      resident: b.residentDemandUsers ?? 0,
      floating: b.floatingDemandUsers ?? 0,
      D: Math.log(b.totalDemandHours / (pc * MONTH_HOURS)),
      rivalIp: (r.input.rivals ?? []).reduce((s, v) => s + (v.ip > 0 ? v.ip : 0), 0),
    });
  }
  const A = R.map((x) => Math.log(x.act));

  it("(1) 묻기 1 — D의 퍼짐은 수요 추정에서 오나, PC수에서 오나", () => {
    const H = R.map((x) => Math.log(x.hours));
    const C = R.map((x) => Math.log(x.pc * MONTH_HOURS));
    const D = R.map((x) => x.D);
    console.log(`\n[D 분해] D = log(총수요시간) − log(자사PC x 720)   n=${R.length}`);
    console.log(`  Var(D) = Var(수요) + Var(PC) − 2Cov(수요, PC)`);
    console.log(`  ${varOf(D).toFixed(4)} = ${varOf(H).toFixed(4)} + ${varOf(C).toFixed(4)} − ${(2 * cov(H, C)).toFixed(4)}` +
      `   ${Math.abs(varOf(D) - (varOf(H) + varOf(C) - 2 * cov(H, C))) < 1e-9 ? "**일치**" : "❌"}`);
    console.log(`\n  항              SD(log)   Var    D 분산 대비   실측과 상관 r`);
    for (const [k, v] of [["log 총수요시간", H], ["log 자사PC", C], ["D (둘의 차)", D]] as [string, number[]][]) {
      const rr = corr(v, A);
      console.log(`  ${k.padEnd(16)}${sdOf(v).toFixed(4)}${varOf(v).toFixed(4).padStart(9)}${(varOf(v) / varOf(D) * 100).toFixed(0).padStart(12)}%` +
        `${rr.toFixed(3).padStart(15)}${Math.abs(rr) > SIG ? " *" : ""}`);
    }
    console.log(`  Cov(수요, PC) = ${cov(H, C).toFixed(4)} · 상관 ${corr(H, C).toFixed(3)}` +
      `  → 수요 많은 동네에 ${corr(H, C) > 0 ? "PC를 많이 깐다" : "PC를 적게 깐다"}`);
    console.log(`\n  ⚠️ **자사 PC수는 자료가 확실하다**(우리 매장이다). 수요 추정은 불확실하다.`);
    console.log(`     퍼짐이 PC수에서 오면 실재하는 것이고, 수요 추정에서 오면 의심해야 한다.`);
    expect(R.length).toBeGreaterThan(30);
  });

  it("(2) 묻기 2 — 그 퍼짐이 실재하나 (실측 가동률이 정말 그만큼 벌어지나)", () => {
    const D = R.map((x) => x.D);
    console.log(`\n[퍼짐 대조] D가 벌리는 만큼 실측도 벌어지나`);
    console.log(`  D SD(log)        ${sdOf(D).toFixed(4)}   (±${((Math.exp(sdOf(D)) - 1) * 100).toFixed(0)}%)`);
    console.log(`  실측 가동률 SD(log) ${sdOf(A).toFixed(4)}   (±${((Math.exp(sdOf(A)) - 1) * 100).toFixed(0)}%)`);
    console.log(`  → D가 실측보다 **${(sdOf(D) / sdOf(A)).toFixed(2)}배** 넓다`);
    console.log(`  D와 실측의 상관 r = ${corr(D, A).toFixed(3)}${Math.abs(corr(D, A)) > SIG ? " * (유의)" : " (미달)"}`);
    console.log(`  D의 이론수축 k* = ${(cov(D, A) / varOf(D)).toFixed(3)}`);
    console.log(`\n  [D 사분위별 실측 가동률] D가 크면 실측도 큰가`);
    const sorted = [...R].sort((a, b) => a.D - b.D);
    const q = Math.ceil(sorted.length / 4);
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      console.log(`    ${i + 1}분위  D ${med(g.map((x) => x.D)).toFixed(2)}` +
        ` · 수요시간/PC ${(Math.exp(med(g.map((x) => x.D))) * 100).toFixed(0)}%` +
        ` · 실측 가동률 ${(med(g.map((x) => x.act)) * 100).toFixed(1)}%` +
        ` · 자사PC ${med(g.map((x) => x.pc)).toFixed(0)}대` +
        ` · 경쟁IP ${med(g.map((x) => x.rivalIp)).toFixed(0)}`);
    }
    // ⚠️ 여기서 성급히 읽으면 틀린다 — 표에 경쟁IP를 같이 찍은 이유가 그것이다.
    const sortedQ = [...R].sort((a, b) => a.D - b.D);
    const qn = Math.ceil(sortedQ.length / 4);
    const g1 = sortedQ.slice(0, qn), g4 = sortedQ.slice(3 * qn);
    const dRatio = Math.exp(med(g4.map((x) => x.D))) / Math.exp(med(g1.map((x) => x.D)));
    const cRatio = med(g4.map((x) => x.rivalIp)) / Math.max(1, med(g1.map((x) => x.rivalIp)));
    console.log(`\n  ⚠️ **"수요는 가동률과 무관하다"로 읽으면 틀린다.** 1분위→4분위에서`);
    console.log(`     수요/PC는 ${dRatio.toFixed(1)}배 느는데 **경쟁IP도 ${cRatio.toFixed(1)}배 는다.**`);
    console.log(`     수요가 많은 동네에는 경쟁점도 많다. 그래서 실측 가동률이 평평한 것이지,`);
    console.log(`     수요가 무의미해서가 아니다. 실제로 경쟁을 같이 본 전체 모형은 r=0.52로 오른다.`);
    console.log(`     바르게 읽으면: **수요 단독으로는 못 가른다. 그리고 D의 퍼짐(±56%)은`);
    console.log(`     실측(±21%)보다 2.3배 넓은데, 그 초과분은 경쟁항이 되받아 상쇄해야만 한다.**`);
    console.log(`     두 큰 수를 빼서 작은 잔차를 만드는 구조 — 그게 과장의 뿌리다.`);
    expect(R.length).toBeGreaterThan(30);
  });

  it("(3) 묻기 3 — 주거와 유동, 누가 퍼짐을 만들고 누가 설명하나", () => {
    const res = R.map((x) => Math.log(Math.max(1, x.resident)));
    const flo = R.map((x) => Math.log(Math.max(1, x.floating)));
    const share = R.map((x) => x.floating / Math.max(1, x.resident + x.floating));
    console.log(`\n[주거 vs 유동] 수요층 안쪽`);
    console.log(`  항            SD(log)   실측과 상관 r   PC수와 상관`);
    for (const [k, v] of [["log 주거수요", res], ["log 유동수요", flo]] as [string, number[]][]) {
      const rr = corr(v, A);
      console.log(`  ${k.padEnd(14)}${sdOf(v).toFixed(4)}${rr.toFixed(3).padStart(15)}${Math.abs(rr) > SIG ? " *" : "  "}` +
        `${corr(v, R.map((x) => Math.log(x.pc))).toFixed(3).padStart(13)}`);
    }
    console.log(`  유동 비중: 중앙 ${(med(share) * 100).toFixed(1)}% · 범위 ${(Math.min(...share) * 100).toFixed(1)}~${(Math.max(...share) * 100).toFixed(1)}%`);
    console.log(`  유동비중과 실측 상관 r = ${corr(share, A).toFixed(3)}${Math.abs(corr(share, A)) > SIG ? " *" : ""}`);
    // 수요를 주거만 / 유동만으로 만들면 실측을 더 잘 맞히나 — **퍼짐이 아니라 설명력**을 본다.
    console.log(`\n  [수요를 한쪽만으로 만들면] 실측 가동률과의 상관`);
    const onlyRes = R.map((x) => Math.log(Math.max(1, x.resident) / x.pc));
    const onlyFlo = R.map((x) => Math.log(Math.max(1, x.floating) / x.pc));
    const both = R.map((x) => x.D);
    for (const [k, v] of [["주거만 ÷PC", onlyRes], ["유동만 ÷PC", onlyFlo], ["지금(둘 다) ÷PC", both]] as [string, number[]][]) {
      const rr = corr(v, A);
      console.log(`    ${k.padEnd(18)}r = ${rr.toFixed(3)}${Math.abs(rr) > SIG ? " *" : "  "}   SD(log) ${sdOf(v).toFixed(4)}`);
    }
    console.log(`\n  ⚠️ 유의선 ±${SIG}는 **하나만 볼 때**다. 여기서 여러 개를 훑고 있으므로`);
    console.log(`     ±0.41 정도는 우연히 나온다(\`_schoolInflow\` 4절). 별표를 과신하지 말 것.`);
    expect(R.length).toBeGreaterThan(30);
  });

  it("(4) 묻기 4 — 자사 PC수만으로 가동률을 얼마나 맞히나 (제일 단순한 대조군)", () => {
    // 수요식 전체를 걷어내고 **자사 PC수 하나**만 쓰면? 이게 넘어야 할 진짜 기준선이다.
    // 큰 매장일수록 가동률이 낮다는 건 수요식 없이도 아는 사실이다.
    const lpc = R.map((x) => Math.log(x.pc));
    console.log(`\n[제일 단순한 대조군] 수요식을 통째로 걷어내고 자사 PC수만 본다`);
    console.log(`  log(자사PC)와 실측 가동률 상관 r = ${corr(lpc, A).toFixed(3)}${Math.abs(corr(lpc, A)) > SIG ? " * (유의)" : " (미달)"}`);
    console.log(`  자사 PC수 분포: 중앙 ${med(R.map((x) => x.pc)).toFixed(0)}대 · 범위 ${Math.min(...R.map((x) => x.pc))}~${Math.max(...R.map((x) => x.pc))}대`);
    console.log(`\n  [PC수 사분위별]`);
    const sorted = [...R].sort((a, b) => a.pc - b.pc);
    const q = Math.ceil(sorted.length / 4);
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      console.log(`    ${i + 1}분위  PC ${med(g.map((x) => x.pc)).toFixed(0)}대 · 실측 가동률 ${(med(g.map((x) => x.act)) * 100).toFixed(1)}%`);
    }
    // 회귀 한 줄: log(실측) ~ a + b log(PC). 이것만으로 MAE가 얼마인가 (LOO)
    const looSimple = (xs: number[]) => {
      const errs: number[] = [];
      for (let i = 0; i < R.length; i++) {
        const ix = xs.filter((_, k) => k !== i), iy = A.filter((_, k) => k !== i);
        const b = cov(ix, iy) / varOf(ix), a = mean(iy) - b * mean(ix);
        errs.push(Math.abs(Math.exp(a + b * xs[i]) - R[i].act));
      }
      return mean(errs);
    };
    console.log(`\n  [LOO MAE 견주기] 판정 기준은 가동률이다`);
    console.log(`    전부 훈련평균          ${(mean(R.map((x, i) => Math.abs(x.act - mean(R.filter((_, k) => k !== i).map((y) => y.act))))) * 100).toFixed(2)}%p`);
    console.log(`    log(PC) 회귀 한 줄     ${(looSimple(R.map((x) => Math.log(x.pc))) * 100).toFixed(2)}%p`);
    console.log(`    D 회귀 한 줄           ${(looSimple(R.map((x) => x.D)) * 100).toFixed(2)}%p`);
    console.log(`    교과서식 전체(참고)     6.33%p`);
    console.log(`\n  ⚠️ 한 줄 회귀가 교과서식을 이기면 — **지금 산식의 복잡도가 값을 못 한다**는 뜻이다.`);
    console.log(`     그게 재정립의 출발점이다: 무엇을 지키고 무엇을 버릴지가 여기서 갈린다.`);
    expect(R.length).toBeGreaterThan(30);
  });
});
