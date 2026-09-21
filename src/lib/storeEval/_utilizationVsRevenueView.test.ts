// 자를 바꾸면 "안 맞는 매장" 목록이 바뀐다 (2026-09-21)
//
// ── 사용자 관찰 ───────────────────────────────────────────────────────────
// *"천천히 산식을 검토했는데, 우선 지금 예상매출로 왈가왈부할 건 전혀 아니었고,
//  무조건 예상가동률을 먼저 맞췄어야 했네. 장산점 예상가동률차 7퍼인데 매출오차 40퍼,
//  지웰시티 예상가동률 10퍼차인데 매출 10퍼차이"*
//
// 맞는 관찰이다. 그리고 그 둘은 우연히 고른 사례가 아니라 **정반대 방향의 본보기**다:
//   장산점    가동률을 덜 틀렸는데(6.9%p) 단가 오차가 **같은 방향**이라 매출이 40% 벌어진다
//   지웰시티  가동률을 더 틀렸는데(10.6%p) 단가 오차가 **반대 방향**이라 매출이 10%로 덮인다
//
// 그래서 매출 자로 보면 **지웰시티가 잘 맞는 매장처럼 보인다.** 아니다. 가려진 것이다.
//
// ── 항등식 (분해가 맞는지 먼저 박는다) ────────────────────────────────────
//   매출 = 가동률 x (자사PC x 시간 x 단가)  이므로
//   (1 + 매출오차) = (1 + 가동률 상대오차) x (1 + 단가오차)
// 이 항등식이 성립하는지부터 확인한다. 안 맞으면 아래 표 전체가 헛것이다.
//
// ⚠️ **%p와 상대%를 헷갈리면 안 된다.** 매출에 곱해지는 건 **상대오차**다.
//    장산 6.9%p는 실측 22.6% 대비 −30.7%이고, 지웰 10.6%p는 실측 43.6% 대비 −24.2%다.
//    **%p로는 지웰이 더 틀렸고, 상대로는 장산이 더 틀렸다.** 둘 다 찍는다.
//
// ── 무엇을 내놓나 ─────────────────────────────────────────────────────────
//   (1) 항등식 확인
//   (2) 전 매장 분해표 — 가동률·단가·매출 오차를 나란히
//   (3) **순위가 바뀐다** — 매출 자 최악 목록 vs 가동률 자 최악 목록
//   (4) **가려진 매장** — 단가 오차가 반대 방향이라 매출로는 멀쩡해 보이는 곳
//
// ⚠️ 측정만 한다. 본체 무수정.
//
// 실행:
//   npx vitest run src/lib/storeEval/_utilizationVsRevenueView.test.ts --disable-console-intercept
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
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const ppt = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%p`;

describeIf("자를 바꾸면 안 맞는 매장 목록이 바뀐다", () => {
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
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;
  const P = DEFAULT_TEXTBOOK_PARAMS;

  /** LOO — 자기를 빼고 축척을 맞춘 뒤 자기를 맞힌다. 매장별 오차는 이 판에서 본다. */
  type Row = {
    n: string; actU: number; predU: number;
    uPP: number;      // 가동률 오차, %p
    uRel: number;     // 가동률 오차, 실측 대비 상대%  <- 매출에 곱해지는 건 이것
    price: number;    // 단가 오차 (가동률을 실측으로 고정했을 때 남는 매출 오차)
    rev: number;      // 매출 오차
  };
  const rows: Row[] = [];
  for (let i = 0; i < base.length; i++) {
    const rest = base.filter((_, k) => k !== i);
    const f = fittedParams(P, scoreTextbook(rest, P));
    const b = computeTextbook(base[i].input, f);
    const actU = base[i].input.actualUtilization;
    const actR = base[i].actualRevenue;
    if (actU == null || !(actU > 0) || b.utilization == null || b.monthlyRevenue == null || !(actR > 0)) continue;
    const revAtActualU = b.monthlyRevenue * (actU / b.utilization); // 가동률만 실측으로 갈아끼운 매출
    rows.push({
      n: nameOf(base[i]), actU, predU: b.utilization,
      uPP: b.utilization - actU,
      uRel: (b.utilization - actU) / actU,
      price: (revAtActualU - actR) / actR,
      rev: (b.monthlyRevenue - actR) / actR,
    });
  }

  it("(1) 항등식 확인 — 분해가 맞나", () => {
    const worstGap = Math.max(...rows.map((r) => Math.abs((1 + r.uRel) * (1 + r.price) - (1 + r.rev))));
    console.log(`\n[항등식] (1+매출오차) = (1+가동률 상대오차) x (1+단가오차)`);
    console.log(`  n=${rows.length} · 최대 어긋남 ${worstGap.toExponential(2)}  ${worstGap < 1e-9 ? "**정확히 성립**" : "❌ 안 맞는다 — 아래 표를 믿지 말 것"}`);
    console.log(`  → 매출 오차는 **두 층의 곱**이다. 같은 방향이면 커지고 반대면 상쇄된다.`);
    expect(worstGap).toBeLessThan(1e-9);
  });

  it("(2) 사용자가 든 두 매장 — 정반대 본보기다", () => {
    console.log(`\n[사용자 관찰 확인]`);
    for (const key of ["장산", "지웰"]) {
      const r = rows.find((x) => x.n.includes(key));
      if (!r) { console.log(`  ${key}: 없음`); continue; }
      console.log(`\n  ${r.n}`);
      console.log(`    실측 가동률 ${(r.actU * 100).toFixed(1)}%  ·  예측 ${(r.predU * 100).toFixed(1)}%`);
      console.log(`    가동률 오차  ${ppt(r.uPP)}  (실측 대비 ${pct(r.uRel)})`);
      console.log(`    단가 오차    ${pct(r.price)}   ${r.uRel * r.price > 0 ? "**같은 방향 — 매출 오차를 키운다**" : "**반대 방향 — 매출 오차를 덮는다**"}`);
      console.log(`    매출 오차    ${pct(r.rev)}   = (1${pct(r.uRel, 3)}) x (1${pct(r.price, 3)})`);
    }
    console.log(`\n  ⚠️ %p와 상대%를 구분해야 한다 — 매출에 곱해지는 건 **상대%**다.`);
    console.log(`     %p로 보면 지웰시티가 더 틀렸고, 상대%로 보면 장산점이 더 틀렸다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(3) ⭐ 순위가 바뀐다 — 매출 자 최악 vs 가동률 자 최악", () => {
    const byRev = [...rows].sort((a, b) => Math.abs(b.rev) - Math.abs(a.rev));
    const byPP = [...rows].sort((a, b) => Math.abs(b.uPP) - Math.abs(a.uPP));
    const rankPP = new Map(byPP.map((r, i) => [r.n, i + 1]));
    const rankRev = new Map(byRev.map((r, i) => [r.n, i + 1]));
    console.log(`\n[매출 자로 본 최악 10곳] — 지금까지 이 목록을 보고 매장을 골라 팠다`);
    console.log(`  순위  매장              매출오차   가동률오차(%p)   단가오차   가동률 자 순위`);
    for (let i = 0; i < 10; i++) {
      const r = byRev[i];
      const mv = rankPP.get(r.n)!;
      console.log(`  ${String(i + 1).padStart(3)}.  ${r.n.padEnd(16)}${pct(r.rev).padStart(9)}${ppt(r.uPP).padStart(14)}${pct(r.price).padStart(11)}` +
        `${String(mv).padStart(10)}위${mv - (i + 1) >= 8 ? "  <- 크게 내려간다" : ""}`);
    }
    console.log(`\n[가동률 자로 본 최악 10곳] — 앞으로 이 목록을 봐야 한다`);
    console.log(`  순위  매장              가동률오차(%p)  실측->예측        매출오차   매출 자 순위`);
    for (let i = 0; i < 10; i++) {
      const r = byPP[i];
      const mv = rankRev.get(r.n)!;
      console.log(`  ${String(i + 1).padStart(3)}.  ${r.n.padEnd(16)}${ppt(r.uPP).padStart(13)}   ${(r.actU * 100).toFixed(1)}% -> ${(r.predU * 100).toFixed(1)}%`.padEnd(70) +
        `${pct(r.rev).padStart(9)}${String(mv).padStart(9)}위${mv - (i + 1) >= 8 ? "  <- 매출 자에선 안 보이던 곳" : ""}`);
    }
    const inBoth = byRev.slice(0, 10).filter((r) => rankPP.get(r.n)! <= 10).length;
    console.log(`\n  두 목록이 겹치는 곳: ${inBoth}/10`);
    console.log(`  ⚠️ 겹침이 적을수록 — **지금까지 엉뚱한 매장을 파고 있었다**는 뜻이다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(4) 가려진 매장 — 단가가 반대로 움직여 매출로는 멀쩡해 보이는 곳", () => {
    // 가동률은 크게 틀렸는데 단가 오차가 반대 방향이라 매출 오차가 작아진 매장들.
    // 이런 곳을 "잘 맞는다"고 읽으면 안 된다. **두 번 틀리고 상쇄된 것**이다.
    // 분류는 **부호만**으로 가른다(반대 방향 = 덮임, 같은 방향 = 증폭). 둘을 합치면 38곳이다.
    // ⚠️ 처음에 "덮임"에 `|가동률오차| > |매출오차|` 조건을 더 걸었다가 4곳이 어디에도 안 들어가
    //    합이 34가 됐다. 부호가 반대여도 단가 쪽이 더 크면 매출이 되레 커질 수 있다.
    const masked = rows
      .filter((r) => r.uRel * r.price < 0)
      .sort((a, b) => (Math.abs(b.uRel) - Math.abs(b.rev)) - (Math.abs(a.uRel) - Math.abs(a.rev)));
    console.log(`\n[가려진 매장] 가동률은 틀렸는데 단가가 반대로 움직여 매출이 덮인 곳 — ${masked.length}곳`);
    console.log(`  매장              가동률오차   단가오차   매출오차    얼마나 덮였나`);
    for (const r of masked.slice(0, 10)) {
      console.log(`  ${r.n.padEnd(16)}${pct(r.uRel).padStart(10)}${pct(r.price).padStart(11)}${pct(r.rev).padStart(10)}` +
        `${((Math.abs(r.uRel) - Math.abs(r.rev)) * 100).toFixed(1).padStart(12)}%p`);
    }
    // 반대쪽 — 두 오차가 같은 방향이라 매출이 부풀려진 곳
    const amplified = rows
      .filter((r) => r.uRel * r.price > 0)
      .sort((a, b) => (Math.abs(b.rev) - Math.abs(b.uRel)) - (Math.abs(a.rev) - Math.abs(a.uRel)));
    console.log(`\n[부풀려진 매장] 두 오차가 같은 방향이라 매출 오차가 더 커 보이는 곳 — ${amplified.length}곳`);
    console.log(`  매장              가동률오차   단가오차   매출오차    얼마나 커졌나`);
    for (const r of amplified.slice(0, 6)) {
      console.log(`  ${r.n.padEnd(16)}${pct(r.uRel).padStart(10)}${pct(r.price).padStart(11)}${pct(r.rev).padStart(10)}` +
        `${((Math.abs(r.rev) - Math.abs(r.uRel)) * 100).toFixed(1).padStart(12)}%p`);
    }
    console.log(`\n  ⚠️ 두 오차의 상관이 0에 가까우므로(r≈−0.06) 이 상쇄·증폭은 **우연**이다.`);
    console.log(`     우연으로 잘 맞은 매장을 "맞았다"고 읽고 산식을 고르면 그게 결과맞추기다.`);
    console.log(`\n  단가 오차 자체의 크기: 평균 ${(mean(rows.map((r) => Math.abs(r.price))) * 100).toFixed(1)}% · 최대 ${(Math.max(...rows.map((r) => Math.abs(r.price))) * 100).toFixed(1)}%`);
    console.log(`  → 가동률을 완벽히 맞혀도 매출은 평균 이만큼 틀린다. **단가층은 따로 고쳐야 한다.**`);
    expect(masked.length + amplified.length).toBe(rows.length);
  });
});
