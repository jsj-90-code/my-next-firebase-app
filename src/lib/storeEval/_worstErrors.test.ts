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

  // ── 인구 적은 동네를 작게 세고 있나 ──────────────────────────────────────
  //
  // 필요 점유율 100% 초과 4곳(문경·양주덕정·강릉교동·인천서창)의 1km 주거인구가
  // 18,786 / 28,495 / 26,158 / 40,500이고 **표본 중앙값은 48,673**이다. 넷 다 하위권이다.
  // 우연인지 체계적인지 전 매장에서 본다.
  //
  // ⚠️ **필요 점유율은 수요로 나눈 값이라 수요와 자동으로 음의 상관이 난다**(나눗셈 함정,
  //    2026-09-18에 밟은 자리). 그래서 "필요 점유율 ↔ 주거인구"를 그냥 보면 안 된다.
  //    볼 것은 **주거인구가 아니라 인구 규모**와의 관계다 — 수요식이 인구에 **비례**하므로,
  //    비례가 맞다면 필요 점유율은 인구와 **무관**해야 한다(스케일이 약분된다).
  //    남는 상관이 있으면 그게 편향이다.
  it("(5) 인구 적은 동네에서 수요를 작게 세나", () => {
    const sc = scoreTextbook(rows, P);
    const full = fittedParams(P, sc);
    type R = { name: string; pop: number; req: number; resid: number; flow: number; rip: number };
    const xs: R[] = [];
    for (const r of rows) {
      const x = sc.rows.find((y) => y.storeCode === r.input.storeCode);
      const b = computeTextbook(r.input, full);
      const pop = r.input.pop1km;
      if (!x || x.requiredShare == null || !pop || b.residentDemandUsers == null || b.floatingDemandUsers == null) continue;
      xs.push({
        name: r.input.storeName ?? r.input.storeCode, pop, req: x.requiredShare,
        resid: b.residentDemandUsers, flow: b.floatingDemandUsers, rip: rivalIp(r),
      });
    }
    const pear = (a: number[], b: number[]) => {
      const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    };
    const lim = 2 / Math.sqrt(xs.length);
    const r1 = pear(xs.map((x) => Math.log(x.pop)), xs.map((x) => Math.log(x.req)));
    console.log(`\n[인구 편향] n=${xs.length} · 유의선 ±${lim.toFixed(2)}`);
    console.log(`  log(주거1km) ↔ log(필요점유율)   r = ${r1.toFixed(3)}  ${Math.abs(r1) > lim ? "**유의**" : "-"}`);
    console.log(`  ⚠️ **이 줄은 증거가 아니다.** 필요 점유율은 수요(∝인구)로 나눈 값이라`);
    console.log(`     인구와 음의 상관이 **자동으로** 난다(2026-09-18 나눗셈 함정).`);
    console.log(`     게다가 경쟁점도 인구 따라 늘어나므로(상권 총IP↔인구 r=0.692), 경쟁을 무시한`);
    console.log(`     필요 점유율이 인구에 반비례하는 건 **모델이 맞다는 쪽**의 징후이기도 하다.`);

    // ── 제대로 된 검정 — **필요 ÷ 예측**이 인구와 상관이 있나 ────────────────
    // 필요 점유율과 예측 점유율은 **둘 다** 수요로 나뉘어 있다. 그 비를 보면 수요가 약분되고
    // "경쟁 항이 맞았나"만 남는다. 비가 인구와 상관이 있으면 그게 진짜 편향이다.
    const withShare = xs
      .map((x) => {
        const row = sc.rows.find((y) => (y.storeName ?? y.storeCode) === x.name);
        return { ...x, share: row?.share ?? null };
      })
      .filter((x): x is R & { share: number } => x.share != null && x.share > 0);
    const rShare = pear(withShare.map((x) => Math.log(x.pop)), withShare.map((x) => Math.log(x.share)));
    const rRatio = pear(withShare.map((x) => Math.log(x.pop)), withShare.map((x) => Math.log(x.req / x.share)));
    console.log(`\n  log(주거1km) ↔ log(예측점유율)   r = ${rShare.toFixed(3)}  ${Math.abs(rShare) > lim ? "**유의**" : "-"}`);
    console.log(`  log(주거1km) ↔ log(필요÷예측)    r = ${rRatio.toFixed(3)}  ${Math.abs(rRatio) > lim ? "**유의**" : "-"}  <- **이게 진짜 검정이다**`);
    console.log(`     0에 가까우면 인구 편향이 없다(모델이 인구를 제대로 쓰고 있다).`);
    console.log(`     음수면 인구 많은 동네를 과소, 양수면 인구 적은 동네를 과소 예측하는 것이다.`);

    // 경쟁을 통제해도 남는가 — 경쟁이 적으면 많이 먹는 건 당연하므로 갈라야 한다.
    const resid = (y: number[], x: number[]) => {
      const n = y.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
      const s = sxx > 0 ? sxy / sxx : 0;
      return y.map((v, i) => v - (my + s * (x[i] - mx)));
    };
    const lr = xs.map((x) => Math.log(Math.max(1, x.rip) + 100)); // 경쟁 규모(로그)
    const rq = resid(xs.map((x) => Math.log(x.req)), lr);
    const rp = resid(xs.map((x) => Math.log(x.pop)), lr);
    const r2 = pear(rp, rq);
    console.log(`  경쟁 규모를 통제한 편상관            r = ${r2.toFixed(3)}  ${Math.abs(r2) > lim ? "**유의**" : "-"}`);

    console.log(`\n  인구 4분위별 (낮은 쪽부터)`);
    const sorted = [...xs].sort((a, b) => a.pop - b.pop);
    const q = Math.ceil(sorted.length / 4);
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      const mr = [...g].map((x) => x.req).sort((a, b) => a - b)[Math.floor(g.length / 2)];
      const mp = [...g].map((x) => x.pop).sort((a, b) => a - b)[Math.floor(g.length / 2)];
      console.log(`    ${i + 1}분위 ${String(g.length).padStart(2)}곳  주거1km 중앙 ${mp.toLocaleString().padStart(7)}` +
        `  필요점유율 중앙 ${(mr * 100).toFixed(0).padStart(4)}%  100%초과 ${g.filter((x) => x.req > 1).length}곳`);
    }
    console.log(`  ⚠️ 아래 분위로 갈수록 필요 점유율이 높아지면 **인구 적은 동네를 작게 세는 편향**이다.`);
    expect(xs.length).toBeGreaterThan(30);
  });

  // ── 빠진 변수를 찾는다 ───────────────────────────────────────────────────
  //
  // (5)에서 **인구 편향은 없다**는 게 확인됐다(필요÷예측 ↔ 인구 r=-0.162, 미달).
  // 그러면 오차는 다른 축에 있다. **필요÷예측**을 과녁으로 놓고 있는 변수를 전부 훑는다.
  //
  //   필요÷예측 = 1   맞음
  //            > 1   우리가 더 먹어야 한다 = 과소예측 (경쟁을 세게 봤거나 뭔가 빠졌다)
  //            < 1   과대예측
  //
  // ⚠️ **이 과녁은 수요가 약분된다** — 필요·예측 둘 다 수요로 나뉘어 있기 때문이다.
  //    그래서 나눗셈 함정에 안 걸리고, 순수하게 "점유율 항이 틀린 정도"만 잰다.
  //
  // ⚠️ **변수를 20개 훑으면 우연히 유의한 게 한둘 나온다.** 여기서 나온 건 후보일 뿐이고,
  //    채택하려면 무작위 대조군과 홀드아웃을 따로 세워야 한다(프로젝트 채택 기준).
  it("(6) 무엇이 '필요÷예측'을 가르나 — 변수 훑기", () => {
    const sc = scoreTextbook(rows, P);
    const full = fittedParams(P, sc);

    // 개점 후 개월 수 — 자리잡는 중인 매장이 다르게 움직이는지 본다.
    const monthsOpen = new Map<string, number>();
    for (const st of (snap.existingStores ?? []) as { storeCode?: string; openedAt?: string | null }[]) {
      if (!st.storeCode || !st.openedAt) continue;
      const t = Date.parse(st.openedAt);
      if (Number.isFinite(t)) monthsOpen.set(st.storeCode, (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44));
    }
    // 경쟁점 중 "간략/외관만" 조사 비율 — 간략이면 기본점수(2.0)·기본대수(70)가 들어간다.
    // 그 기본값이 틀리면 그 매장만 경쟁무게가 어긋난다.
    const briefRatio = new Map<string, number>();
    for (const r of rows) {
      const src = compsByCode.get(r.input.storeCode) ?? [];
      const surveyed = src.filter((c) => c.investigationStatus !== "경쟁점없음");
      if (!surveyed.length) continue;
      briefRatio.set(r.input.storeCode, surveyed.filter((c) => c.surveyLevel !== "상세").length / surveyed.length);
    }

    type Pt = { name: string; y: number; v: Record<string, number | null> };
    const pts: Pt[] = [];
    for (const r of rows) {
      const x = sc.rows.find((y) => y.storeCode === r.input.storeCode);
      if (!x || x.requiredShare == null || x.share == null || !(x.share > 0)) continue;
      const b = computeTextbook(r.input, full);
      const i = r.input;
      const rip = rivalIp(r);
      const nRival = (i.rivals ?? []).filter((z) => z.ip > 0 && (z.distanceM == null || z.distanceM <= P.effectiveRadiusM)).length;
      const dists = (i.rivals ?? []).filter((z) => z.ip > 0 && z.distanceM != null).map((z) => z.distanceM as number);
      const oq = i.ownQualityParts;
      pts.push({
        name: i.storeName ?? i.storeCode,
        y: Math.log(x.requiredShare / x.share),
        v: {
          "자사 PC수": i.pcCount ?? null,
          "자사 요금": i.hourlyRate ?? null,
          "유효경쟁 IP": rip,
          "유효경쟁 점포수": nRival,
          "자사PC ÷ 경쟁IP": rip > 0 ? (i.pcCount ?? 0) / rip : null,
          "최근접 경쟁점 거리": dists.length ? Math.min(...dists) : null,
          "경쟁점 평균 거리": dists.length ? dists.reduce((a, c) => a + c, 0) / dists.length : null,
          "주거 1km": i.pop1km ?? null,
          "주거 500m÷1km": i.pop500m && i.pop1km ? i.pop500m / i.pop1km : null,
          "유동 400m": i.floatingByRadius[400] ?? null,
          "유동÷주거": i.floatingByRadius[400] && i.pop1km ? (i.floatingByRadius[400] as number) / i.pop1km : null,
          "중심도(날값)": i.location?.centrality ?? null,
          "접근성": i.location?.access ?? null,
          "편심도": i.location?.direction ?? null,
          "입지배율": b.locationMultiplier ?? null,
          "자사 사양점수": oq?.spec ?? null,
          "자사 존구성": oq?.zone ?? null,
          "자사 관리(QSC)": oq?.management ?? null,
          "실측 가동률": i.actualUtilization ?? null,
          "예측 점유율": x.share,
          // 2026-09-20 추가 — 앞의 20개가 전부 미달이라 두 축을 더 본다.
          "개점 후 개월": monthsOpen.get(i.storeCode) ?? null,
          "경쟁점 간략조사 비율": briefRatio.get(i.storeCode) ?? null,
        },
      });
    }
    const pear = (a: number[], b: number[]) => {
      const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    };
    const keys = Object.keys(pts[0].v);
    const out: { k: string; r: number; n: number }[] = [];
    for (const k of keys) {
      const pair = pts.filter((p) => p.v[k] != null && Number.isFinite(p.v[k] as number));
      if (pair.length < 10) continue;
      // 규모 변수는 로그로 본다(분포가 오른쪽 꼬리).
      const logish = /PC수|IP|거리|주거|유동|중심도|가동률|점유율|÷/.test(k);
      const xv = pair.map((p) => {
        const v = p.v[k] as number;
        return logish && v > 0 ? Math.log(v) : v;
      });
      out.push({ k, r: pear(xv, pair.map((p) => p.y)), n: pair.length });
    }
    out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    console.log(`\n[빠진 변수 찾기] 과녁 = log(필요÷예측) · 양수면 과소예측 · n=${pts.length}`);
    console.log(`  유의선 ±${(2 / Math.sqrt(pts.length)).toFixed(2)} (n=38) · ⚠️ 20개를 훑으면 우연히 1~2개는 넘는다`);
    for (const o of out) {
      const lim = 2 / Math.sqrt(o.n);
      console.log(`  ${o.k.padEnd(18)} r = ${o.r.toFixed(3).padStart(7)}  n=${String(o.n).padStart(2)}  ${Math.abs(o.r) > lim ? "**유의**" : ""}`);
    }
    // 유형별로도 본다 — 대학가 3곳이 반대편이었다.
    const byType = new Map<string, number[]>();
    for (const r of rows) {
      const p = pts.find((z) => z.name === (r.input.storeName ?? r.input.storeCode));
      if (!p) continue;
      const t = r.input.specialDemandType ?? "없음";
      byType.set(t, [...(byType.get(t) ?? []), p.y]);
    }
    console.log(`\n  특수수요 유형별 평균 log(필요÷예측)  — 0이면 맞음`);
    for (const [t, v] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const m = v.reduce((a, c) => a + c, 0) / v.length;
      console.log(`    ${t.padEnd(9)}${String(v.length).padStart(3)}곳  ${m.toFixed(3).padStart(7)}  (배수로 ${Math.exp(m).toFixed(2)})`);
    }
    expect(pts.length).toBeGreaterThan(30);
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
