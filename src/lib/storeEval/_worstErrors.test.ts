// 오차 큰 매장은 **무엇 때문에** 큰가 — 수요인가 경쟁인가 (2026-09-20)
//
// 사용자: *"오차폭 줄여야함. 지금 오차폭 60프로 40프로 이런애들 말도안되"*
//
// ── 가르는 법 ──────────────────────────────────────────────────────────────
// 매출은 세 층의 곱이다:  매출 = 수요 x 점유율 x 단가
//
//   **필요 점유율** = 실측 가동률 ÷ (경쟁을 아예 없다고 본 예측 가동률)
//                  = "우리 수요식이 맞다면, 이 매장이 실제로 먹은 몫"
//   **예측 점유율** = 산식이 준 몫
//
//   오차(예측/실제 - 1) = 예측점유율 ÷ 필요점유율 - 1     <- 단가층이 맞다면
//
// 그래서 두 숫자를 나란히 놓으면 원인이 갈린다:
//
//   필요 > 100%              수요를 확실히 작게 셌다. **점유율로는 절대 못 메운다.**
//   필요 < 100% · 예측 < 필요  수요는 됐는데 **경쟁을 너무 세게** 봤다 (과소예측)
//   필요 < 100% · 예측 > 필요  경쟁을 너무 **약하게** 봤다 (과대예측)
//
// ⚠️ 단가층이 틀리면 이 분해가 흐려진다. 그래서 **단가 오차도 같이 찍는다** —
//    실측 가동률이 있는 매장은 "가동률만 맞혔을 때의 매출 오차"를 따로 볼 수 있다.
//
// ⚠️ **측정만 한다.** 계수를 고르지 않는다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_worstErrors.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("오차 큰 매장 — 수요인가 경쟁인가", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
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
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const isMono = (r: LabRow) => !(r.input.competitorIp ?? 0);
  /** 점유율 분모에 실제로 들어가는 경쟁 규모 — `competitorIp`가 아니다(유효거리로 걸러진다). */
  const rivalIp = (r: LabRow) => (r.input.rivals ?? [])
    .filter((x) => x.ip > 0 && (x.distanceM == null || x.distanceM <= P.effectiveRadiusM))
    .reduce((s, x) => s + x.ip, 0);

  type Diag = {
    name: string; err: number; req: number | null; share: number | null;
    resid: number | null; flow: number | null; rip: number; mono: boolean;
    utilErr: number | null; kind: string;
  };

  const diagnose = (p: TextbookParams): Diag[] => {
    const sc = scoreTextbook(rows, p);
    const full = fittedParams(p, sc);
    const out: Diag[] = [];
    for (const r of rows) {
      const x = sc.rows.find((y) => y.storeCode === r.input.storeCode);
      if (!x || x.predicted == null || !(x.actual > 0)) continue;
      const b = computeTextbook(r.input, full);
      const err = x.predicted / x.actual - 1;
      const req = x.requiredShare ?? null;
      const share = x.share ?? null;
      // 원인 라벨 — 위 주석의 규칙 그대로.
      let kind = "-";
      if (req != null && req > 1) kind = "수요부족";
      else if (req != null && share != null) kind = share < req ? "경쟁 과대" : "경쟁 과소";
      out.push({
        name: r.input.storeName ?? r.input.storeCode,
        err, req, share,
        resid: b.residentDemandUsers ?? null,
        flow: b.floatingDemandUsers ?? null,
        rip: rivalIp(r), mono: isMono(r),
        utilErr: x.utilErrPct ?? null, kind,
      });
    }
    return out.sort((a, b) => Math.abs(b.err) - Math.abs(a.err));
  };

  it("(1) 오차 큰 순 — 원인까지", () => {
    const ds = diagnose(P);
    console.log(`\n[오차 큰 순] 지금 설정 · ${ds.length}곳`);
    console.log("  매장              매출오차   필요점유율  예측점유율   원인        주거몫   유동몫  유효경쟁IP");
    for (const d of ds) {
      if (Math.abs(d.err) < 0.2) continue; // 20% 넘는 것만
      console.log(
        `  ${d.name.padEnd(15)}${(d.err * 100).toFixed(1).padStart(7)}%  ` +
        `${d.req == null ? "     -" : (d.req * 100).toFixed(0).padStart(6) + "%"}  ` +
        `${d.share == null ? "     -" : (d.share * 100).toFixed(0).padStart(6) + "%"}  ` +
        `${d.kind.padEnd(9)}${Math.round(d.resid ?? 0).toLocaleString().padStart(8)}` +
        `${Math.round(d.flow ?? 0).toLocaleString().padStart(8)}  ${String(d.rip).padStart(8)}`,
      );
    }
    const big = ds.filter((d) => Math.abs(d.err) >= 0.2);
    const by = (k: string) => big.filter((d) => d.kind === k).length;
    console.log(`\n  20% 넘는 곳 ${big.length}곳 — 수요부족 ${by("수요부족")}곳 · 경쟁 과대 ${by("경쟁 과대")}곳 · 경쟁 과소 ${by("경쟁 과소")}곳`);
    console.log(`  ⚠️ '수요부족'은 점유율을 어떻게 손봐도 **못 고친다**(필요 점유율이 100%를 넘는다).`);
    expect(ds.length).toBeGreaterThan(30);
  });

  it("(2) 어느 층이 틀렸나 — 가동률층 vs 단가층", () => {
    // 매출 = 가동률 x 단가층. 가동률 오차와 매출 오차를 나란히 놓으면 어느 층인지 갈린다.
    const ds = diagnose(P).filter((d) => d.utilErr != null);
    console.log(`\n[층 가르기] 실측 가동률이 있는 ${ds.length}곳 — 매출오차 큰 순`);
    console.log("  매장              매출오차   가동률오차   차이(=단가층 몫)");
    for (const d of ds.slice(0, 12)) {
      const gap = Math.abs(d.err) - (d.utilErr ?? 0);
      console.log(`  ${d.name.padEnd(15)}${(d.err * 100).toFixed(1).padStart(7)}%  ` +
        `${((d.utilErr ?? 0) * 100).toFixed(1).padStart(8)}%  ${(gap * 100).toFixed(1).padStart(12)}%p`);
    }
    const avgAbs = ds.reduce((s, d) => s + Math.abs(d.err), 0) / ds.length;
    const avgUtil = ds.reduce((s, d) => s + (d.utilErr ?? 0), 0) / ds.length;
    console.log(`\n  평균  매출오차 ${(avgAbs * 100).toFixed(2)}%  ·  가동률오차 ${(avgUtil * 100).toFixed(2)}%`);
    console.log(`  ⚠️ 둘이 비슷하면 오차는 **가동률층(수요·점유율)**에서 온다 — 단가층은 죄가 없다.`);
    expect(ds.length).toBeGreaterThan(20);
  });

  // ── 점유율식을 열어본다 ──────────────────────────────────────────────────
  //
  // (1)에서 '경쟁 과대' 8곳의 **예측÷필요 비가 0.50~0.72로 매우 일관**됐다. 들쭉날쭉이면
  // 잡음인데 일관되면 **체계적 편향**이고, 원인이 하나 있다는 뜻이다. 식을 열어 본다.
  //
  //   점유율 = [자사무게 ÷ (자사무게 + 경쟁무게 + 바깥선택지)] x 입지배율
  //   자사무게 = 자사PC수          경쟁무게 = Σ 경쟁PC x (경쟁품질÷자사품질)^θ
  //
  // 마지막 칸이 핵심이다 — **필요 점유율을 맞추려면 경쟁무게가 얼마여야 하나**를 역산한다.
  // 지금 경쟁무게와의 비가 "경쟁점을 실제의 몇 %로 세야 맞나"다.
  it("(4) 점유율식을 열어본다 — 경쟁점을 몇 %로 세야 맞나", () => {
    const sc = scoreTextbook(rows, P);
    const full = fittedParams(P, sc);
    type R = { name: string; pc: number; rw: number; loc: number; share: number; req: number; need: number; err: number };
    const xs: R[] = [];
    for (const r of rows) {
      const x = sc.rows.find((y) => y.storeCode === r.input.storeCode);
      if (!x || x.predicted == null || !(x.actual > 0) || x.requiredShare == null) continue;
      const b = computeTextbook(r.input, full);
      const pc = r.input.pcCount ?? 0;
      const loc = b.locationMultiplier ?? 1;
      const share = b.share ?? 0;
      if (!(pc > 0) || !(share > 0) || !(loc > 0)) continue;
      // rawShare = share ÷ 입지배율 = pc ÷ (pc + 경쟁무게 + OO)  ->  경쟁무게를 역산
      const raw = share / loc;
      const rw = raw > 0 ? pc / raw - pc - P.outsideOptionIp : 0;
      // 필요 점유율을 맞추려면: req = [pc ÷ (pc + need + OO)] x loc
      const rawNeed = x.requiredShare / loc;
      const need = rawNeed > 0 && rawNeed < 1 ? pc / rawNeed - pc - P.outsideOptionIp : NaN;
      xs.push({ name: r.input.storeName ?? r.input.storeCode, pc, rw, loc, share, req: x.requiredShare, need, err: x.predicted / x.actual - 1 });
    }
    const big = xs.filter((d) => d.err < -0.2 && d.req <= 1).sort((a, b) => a.err - b.err);
    console.log(`\n[점유율식 열기] 과소예측 20% 초과 · 필요점유율 100% 이하 (= '경쟁 과대') ${big.length}곳`);
    console.log("  매장             자사PC   지금 경쟁무게   맞으려면   비율   입지배율  예측몫  필요몫");
    for (const d of big) {
      console.log(`  ${d.name.padEnd(15)}${String(d.pc).padStart(6)}  ${Math.round(d.rw).toLocaleString().padStart(11)}  ` +
        `${Number.isFinite(d.need) ? Math.round(d.need).toLocaleString().padStart(8) : "       -"}  ` +
        `${Number.isFinite(d.need) ? (d.need / d.rw).toFixed(2).padStart(5) : "    -"}  ` +
        `${d.loc.toFixed(2).padStart(8)}  ${(d.share * 100).toFixed(0).padStart(5)}%  ${(d.req * 100).toFixed(0).padStart(5)}%`);
    }
    const ratios = big.map((d) => d.need / d.rw).filter(Number.isFinite);
    if (ratios.length) {
      const s = [...ratios].sort((a, b) => a - b);
      console.log(`\n  '맞으려면 ÷ 지금' 비율:  중앙 ${s[Math.floor(s.length / 2)].toFixed(2)}` +
        ` · 최소 ${s[0].toFixed(2)} · 최대 ${s[s.length - 1].toFixed(2)}`);
      console.log(`  ⚠️ 이 비율이 한 값 근처로 모이면 **경쟁무게가 통째로 배수만큼 크다**는 뜻이다`);
      console.log(`     (예: 0.5면 경쟁점을 실제의 절반으로 세야 맞는다). 흩어져 있으면 배수가 아니라`);
      console.log(`     매장마다 다른 사정이라 손잡이 하나로는 못 고친다.`);
    }
    // 같은 비율을 **과대예측 쪽**에도 찍어 본다 — 한쪽만 보면 눈금 옮기기와 구분이 안 된다.
    const over = xs.filter((d) => d.err > 0.15 && d.req <= 1).sort((a, b) => b.err - a.err);
    if (over.length) {
      console.log(`\n  (반대편) 과대예측 15% 초과 ${over.length}곳 — 여기서는 비율이 1보다 커야 한다`);
      for (const d of over) {
        console.log(`  ${d.name.padEnd(15)}${(d.err * 100).toFixed(1).padStart(7)}%  지금 ${Math.round(d.rw).toLocaleString().padStart(6)}` +
          ` -> 맞으려면 ${Number.isFinite(d.need) ? Math.round(d.need).toLocaleString().padStart(6) : "  -"}` +
          `  비율 ${Number.isFinite(d.need) ? (d.need / d.rw).toFixed(2) : "-"}`);
      }
    }
    expect(xs.length).toBeGreaterThan(30);
  });

  it("(3) 수요 자체를 다시 본다 — 무엇으로 수요를 세고 있나", () => {
    // 지금 수요 = 주거 1km + 유동 400m x 0.15. 두 몫의 비중이 매장마다 얼마나 다른지 본다.
    const sc = scoreTextbook(rows, P);
    const full = fittedParams(P, sc);
    type R = { name: string; resid: number; flow: number; share: number; req: number; err: number };
    const xs: R[] = [];
    for (const r of rows) {
      const x = sc.rows.find((y) => y.storeCode === r.input.storeCode);
      const b = computeTextbook(r.input, full);
      if (!x || x.predicted == null || !(x.actual > 0) || b.residentDemandUsers == null || b.floatingDemandUsers == null) continue;
      const tot = b.residentDemandUsers + b.floatingDemandUsers;
      if (!(tot > 0)) continue;
      xs.push({
        name: r.input.storeName ?? r.input.storeCode,
        resid: b.residentDemandUsers, flow: b.floatingDemandUsers,
        share: b.floatingDemandUsers / tot,
        req: x.requiredShare ?? NaN, err: x.predicted / x.actual - 1,
      });
    }
    const sorted = [...xs].sort((a, b) => b.share - a.share);
    console.log(`\n[수요의 구성] 유동몫 비중 큰 순 · 지금은 주거1km + 유동400m x ${P.floatingFactor}`);
    console.log("  매장              유동몫비중   주거수요   유동수요   필요점유율  매출오차");
    for (const d of [...sorted.slice(0, 5), ...sorted.slice(-5)]) {
      console.log(`  ${d.name.padEnd(15)}${(d.share * 100).toFixed(0).padStart(8)}%  ` +
        `${Math.round(d.resid).toLocaleString().padStart(8)}${Math.round(d.flow).toLocaleString().padStart(9)}  ` +
        `${(d.req * 100).toFixed(0).padStart(8)}%  ${(d.err * 100).toFixed(1).padStart(7)}%`);
    }
    const pearson = (a: number[], b: number[]) => {
      const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    };
    const ok = xs.filter((x) => Number.isFinite(x.req));
    console.log(`\n  유동몫 비중 ↔ 필요 점유율  r = ${pearson(ok.map((x) => x.share), ok.map((x) => x.req)).toFixed(3)}  (유의선 ±0.32, n=${ok.length})`);
    console.log(`  ⚠️ 음의 상관 = 유동 비중이 큰 매장에서 수요를 **크게** 세고 있다(필요 점유율이 낮다).`);
    console.log(`     그러면 유동 반영률 ${P.floatingFactor}가 너무 높다는 뜻이고, 양수면 반대다.`);
    expect(xs.length).toBeGreaterThan(30);
  });
});
