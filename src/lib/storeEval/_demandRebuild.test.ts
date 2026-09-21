// 수요식을 다시 세운다 — 축척 표본을 넓히고 유동 반경·비중을 찾는다 (2026-09-21)
//
// ── 사용자 설계 (그대로 옮긴다) ───────────────────────────────────────────
// *"일단 실험식산식 만드는게 중심업무가되야할거같고, 일단 수요부분이 문제잖아지금.
//  내가생각한거는 전체가맹점의 수요를 아우를수있는 수요값을 구해야할것같아. 수요방식은
//  주거인구+유동인구 일케하는형태고, 유효반경이랑 비중은 너가 측정해야겠지. 내가 일단
//  생각하는건 주거인구는 100%로 적용되야한다고 생각함.
//
//  해서 이 수요를어케측정하냐면 상권수요100% 측량가능한 독점상권이 들어가야겠고, 추가로
//  들어가야하는곳은 전체수요의 100%를 훨씬초과해야만 실제매출에 도달하는매장 또는 경쟁매장이
//  있으나 100%의 수요를 먹는매장 이런매장들을 수요산식을통해서 해결해나가야하지않을까싶다."*
//
// 지금은 축척(hoursPerUserPerMonth)을 **독점 3곳**(탕정역·광주각화·남악)에서만 맞춘다
// (`calibrationTarget`). 그런데 **필요 점유율이 100%를 넘는 매장**은 "경쟁이 있어도 사실상
// 다 먹는다 + 그래도 모자란다"는 뜻이라 독점과 같은 정보를 준다. 그걸 버리고 있었다.
//
//   필요 점유율 = 실측 가동률 ÷ 경쟁을 아예 없다고 본 예측 가동률
//               = "우리 수요식이 맞다면 이 매장이 실제로 먹은 몫"
//   > 1 이면 **점유율을 어떻게 손봐도 못 고친다.** 수요식이 틀린 것이다.
//
// ── 판정 지표 (여기가 설계의 핵심) ────────────────────────────────────────
// ⚠️ **축척을 키우면 필요 점유율은 무조건 내려간다.** "100% 초과가 줄었다"만 보면 속는다.
//    그래서 **축척에 안 끌려다니는 지표**를 같이 쓴다.
//
//   [축척 의존]  ① 100% 초과 매장 수 · ② 초과폭 합 · ③ LOO MAPE
//   [축척 불변]  ④ 독점 3곳 log(필요점유율) 퍼짐 — 독점은 점유율이 1이라 **수요식만 남는다.**
//                  세 곳이 서로 안 맞으면 반경·비중이 틀린 것이다. 축척은 셋을 같이 밀어서
//                  퍼짐을 못 바꾼다.
//                ⑤ r(log 필요점유율, log 예측점유율) — 축척은 앞쪽에 상수를 더할 뿐이라 r 불변.
//
//   ④가 **수요식 전용 지표**다. 반경·비중은 ④로 고르고, 축척은 그 다음에 정한다.
//
// ── 축척을 맞추는 세 방식 ─────────────────────────────────────────────────
//   (a) 독점 3곳 기하평균                       <- 지금
//   (b) 독점 + 필요점유율 상위 무리 (사용자 제안)
//   (c) **최댓값** — 100% 초과 매장이 0곳이 되는 최소 축척
//       = 사용자가 말한 "100%를 훨씬 초과해야 실매출에 도달하는 매장"까지 다 담는 값
//
// ⚠️ (b)는 순환이 있다 — 집합을 고르는 데 쓰는 필요점유율이 축척에 의존한다. 그래서
//    **지금 축척으로 한 번 정하고 고정**한다. 그 사실을 표에 같이 적는다.
//
// ⚠️ 주거 비중은 1.0으로 **고정**한다(사용자 지시). 유동 반경·비중만 찾는다.
// ⚠️ 주거 반경은 1km만 쓸 수 있다 — 500m는 연령 분해 자료가 없어서 평균 이용률밖에 못 쓴다.
//
// ⚠️ **측정만 한다.** 본체 기본값은 이 파일이 안 고친다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_demandRebuild.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fitProductUnitPrice, type TextbookParams, type FloatingRadius,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const geoMean = (a: number[]) => Math.exp(mean(a.map(Math.log)));
const pear = (a: number[], b: number[]) => {
  const n = a.length, ma = mean(a), mb = mean(b);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
};

describeIf("수요식 다시 세우기", () => {
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
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;
  const isMono = (r: LabRow) => !(r.input.competitorIp ?? 0);
  const withUtil = rows.filter((r) => (r.input.actualUtilization ?? 0) > 0);

  /**
   * 축척=1일 때의 "무경쟁 예측 가동률". 필요 점유율 = 실측 ÷ (이 값 x 축척).
   * 상한(maxUtilization)을 풀어야 한다 — 안 풀면 0.55에 걸려 역산이 망가진다.
   */
  const baseNoShare = (r: LabRow, p: TextbookParams) => {
    const b = computeTextbook(r.input, {
      ...p, hoursPerUserPerMonth: 1, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY,
    });
    return b.utilization ?? null;
  };
  /** 축척=1일 때의 예측 점유율(경쟁 항 포함). 축척과 무관하다. */
  const shareOf = (r: LabRow, p: TextbookParams) => {
    const b = computeTextbook(r.input, { ...p, hoursPerUserPerMonth: 1, maxUtilization: Number.POSITIVE_INFINITY });
    return b.share ?? null;
  };

  type Fit = { scale: number; label: string; note: string };
  /** 세 가지 축척 방식. calSet은 (b)에서 쓰는 '지금 축척 기준으로 한 번 정한' 집합이다. */
  const fits = (p: TextbookParams, calSet: Set<string>): Fit[] => {
    const need = (r: LabRow) => {
      const u0 = baseNoShare(r, p), a = r.input.actualUtilization;
      return u0 != null && u0 > 0 && a != null && a > 0 ? a / u0 : null;
    };
    const mono = withUtil.filter(isMono).map(need).filter((x): x is number => x != null);
    const wide = withUtil.filter((r) => isMono(r) || calSet.has(nameOf(r))).map(need).filter((x): x is number => x != null);
    const all = withUtil.map(need).filter((x): x is number => x != null);
    return [
      { scale: mono.length ? geoMean(mono) : 1, label: "(a) 독점 3곳", note: "지금 방식" },
      { scale: wide.length ? geoMean(wide) : 1, label: "(b) 독점+상위", note: `${wide.length}곳` },
      { scale: all.length ? Math.max(...all) : 1, label: "(c) 최댓값", note: "100% 초과 0곳" },
    ];
  };

  /** 한 설정에서의 지표 묶음. */
  const measure = (p: TextbookParams, scale: number) => {
    const P: TextbookParams = { ...p, hoursPerUserPerMonth: scale };
    const req: { name: string; r: number; share: number | null; mono: boolean }[] = [];
    for (const r of withUtil) {
      const u0 = baseNoShare(r, p), a = r.input.actualUtilization!;
      if (u0 == null || !(u0 > 0)) continue;
      req.push({ name: nameOf(r), r: a / (u0 * scale), share: shareOf(r, p), mono: isMono(r) });
    }
    const over = req.filter((x) => x.r > 1);
    const monoReq = req.filter((x) => x.mono).map((x) => x.r);
    const pairs = req.filter((x) => x.share != null && x.share > 0 && x.r > 0);
    // 상품몫까지 맞춘 뒤 매출 오차
    const full = { ...P, productUnitPrice: fitProductUnitPrice(rows, P) };
    const errs: number[] = [];
    for (const r of rows) {
      const b = computeTextbook(r.input, full);
      if (b.monthlyRevenue != null && r.actualRevenue > 0) errs.push(Math.abs(b.monthlyRevenue / r.actualRevenue - 1));
    }
    return {
      overN: over.length,
      overSum: over.reduce((s, x) => s + (x.r - 1), 0),
      maxReq: Math.max(...req.map((x) => x.r)),
      monoSd: monoReq.length > 1 ? sd(monoReq.map(Math.log)) : NaN,
      rShare: pairs.length > 2 ? pear(pairs.map((x) => Math.log(x.r)), pairs.map((x) => Math.log(x.share!))) : NaN,
      mape: errs.length ? mean(errs) : NaN,
      req,
    };
  };

  const P0 = DEFAULT_TEXTBOOK_PARAMS;
  // (b)용 집합 — **지금 설정·지금 축척**으로 한 번만 정하고 고정한다(순환을 끊는다).
  const m0 = measure(P0, geoMean(withUtil.filter(isMono).map((r) => {
    const u0 = baseNoShare(r, P0), a = r.input.actualUtilization!;
    return u0 && u0 > 0 ? a / u0 : 1;
  })));
  const CAL_SET = new Set(m0.req.filter((x) => !x.mono && x.r >= 0.9).map((x) => x.name));

  it("(0) 현황 — 필요 점유율이 지금 어떻게 생겼나", () => {
    const f = fits(P0, CAL_SET);
    console.log(`\n[현황] 지금 설정 (주거 ${P0.residentRadius}m · 유동 ${P0.floatingRadius}m x ${P0.floatingFactor}) · n=${withUtil.length}`);
    console.log(`  축척 (a) 독점 3곳 = ${f[0].scale.toFixed(3)}  ·  (b) 독점+상위 ${f[1].note} = ${f[1].scale.toFixed(3)}  ·  (c) 최댓값 = ${f[2].scale.toFixed(3)}`);
    const m = measure(P0, f[0].scale);
    console.log(`\n  필요 점유율 — 높은 순 (1을 넘으면 점유율로는 절대 못 고친다)`);
    console.log("  매장              필요점유율  예측점유율  독점");
    for (const x of [...m.req].sort((a, b) => b.r - a.r).slice(0, 12)) {
      console.log(`  ${x.name.padEnd(16)}${(x.r * 100).toFixed(0).padStart(8)}%  ${x.share == null ? "     -" : (x.share * 100).toFixed(0).padStart(8) + "%"}  ${x.mono ? "  ●" : ""}`);
    }
    console.log(`\n  100% 초과 ${m.overN}곳 · 초과폭 합 ${m.overSum.toFixed(2)} · 최대 ${(m.maxReq * 100).toFixed(0)}%`);
    console.log(`  독점 3곳 퍼짐 SD(log) ${m.monoSd.toFixed(4)}  <- **수요식 전용 지표**. 축척이 못 바꾼다`);
    console.log(`  r(필요, 예측) ${m.rShare.toFixed(3)}  ·  매출 MAPE ${(m.mape * 100).toFixed(2)}%`);
    console.log(`\n  (b) 축척 표본에 넣은 비독점 매장 ${CAL_SET.size}곳: ${[...CAL_SET].join(" · ") || "없음"}`);
    expect(withUtil.length).toBeGreaterThan(30);
  });

  it("(1) 유동 반경 x 비중 훑기 — 수요식 전용 지표로 고른다", () => {
    const RADII: FloatingRadius[] = [100, 200, 300, 400, 500];
    const FACTORS = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1.0];
    console.log(`\n[유동 반경 x 비중] 주거는 1km·비중 1.0 고정(사용자 지시) · 축척은 (a) 독점 3곳으로 매번 재적합`);
    console.log(`  판정은 **독점 퍼짐**(작을수록 좋다). 나머지는 참고.`);
    console.log("   반경  비중 │ 독점퍼짐  r(필요,예측)  100%초과  초과폭합    최대    MAPE");
    const best: { key: string; sd: number }[] = [];
    for (const rad of RADII) {
      for (const f of FACTORS) {
        const p: TextbookParams = { ...P0, floatingRadius: rad, floatingFactor: f };
        const mono = withUtil.filter(isMono).map((r) => {
          const u0 = baseNoShare(r, p), a = r.input.actualUtilization!;
          return u0 && u0 > 0 ? a / u0 : null;
        }).filter((x): x is number => x != null);
        if (!mono.length) continue;
        const m = measure(p, geoMean(mono));
        best.push({ key: `${rad}m x ${f}`, sd: m.monoSd });
        if (f === 0 && rad !== RADII[0]) continue; // 비중 0은 반경과 무관 — 한 번만 찍는다
        console.log(`  ${String(rad).padStart(5)}m ${f.toFixed(2)} │ ${m.monoSd.toFixed(4).padStart(8)}  ${m.rShare.toFixed(3).padStart(11)}  ` +
          `${String(m.overN).padStart(8)}  ${m.overSum.toFixed(2).padStart(8)}  ${(m.maxReq * 100).toFixed(0).padStart(6)}%  ${(m.mape * 100).toFixed(2).padStart(6)}%` +
          `${rad === P0.floatingRadius && f === P0.floatingFactor ? "  <- 지금" : ""}`);
      }
    }
    best.sort((a, b) => a.sd - b.sd);
    console.log(`\n  독점 퍼짐이 작은 순 상위 6: ${best.slice(0, 6).map((b) => `${b.key}(${b.sd.toFixed(4)})`).join(" · ")}`);
    console.log(`  ⚠️ 독점이 3곳뿐이라 이 지표도 흔들린다. **고르는 근거가 아니라 방향 표시**로 읽을 것.`);
    expect(best.length).toBeGreaterThan(10);
  });

  it("(2) 축척 세 방식 — 100% 초과를 정말 없앨 수 있나", () => {
    const f = fits(P0, CAL_SET);
    console.log(`\n[축척 세 방식] 지금 설정 그대로 · 축척만 바꾼다`);
    console.log("   방식              축척    100%초과  초과폭합    최대   r(필요,예측)   MAPE");
    for (const x of f) {
      const m = measure(P0, x.scale);
      console.log(`  ${x.label.padEnd(14)}${x.scale.toFixed(3).padStart(8)}  ${String(m.overN).padStart(8)}  ${m.overSum.toFixed(2).padStart(8)}  ` +
        `${(m.maxReq * 100).toFixed(0).padStart(5)}%  ${m.rShare.toFixed(3).padStart(11)}  ${(m.mape * 100).toFixed(2).padStart(6)}%   ${x.note}`);
    }
    console.log(`\n  ⚠️ 축척을 키우면 100% 초과는 **반드시** 0이 된다((c)가 그 최소값이다).`);
    console.log(`     그게 좋은 건지는 r과 MAPE가 말한다 — 수요를 키운 만큼 경쟁 항이 더 깎아야 하기 때문이다.`);
    console.log(`     (c)에서 MAPE가 크게 나빠지면 "수요만 키우면 안 된다"는 뜻이고, 점유율식을 같이 봐야 한다.`);
    expect(f.length).toBe(3);
  });

  // ── 구조는 어느 방향으로 틀렸나 ─────────────────────────────────────────
  //
  //   log(필요 점유율) = a + b x log(예측 점유율)
  //
  //   b = 1  점유율식이 벌리는 정도가 딱 맞다. 남은 건 수준(a)뿐이고 축척이 고친다.
  //   b < 1  **산식이 너무 벌린다.** 예측이 낮은 매장(경쟁 센 곳)에서 실제로는 그만큼
  //          안 깎인다는 뜻 — 경쟁 항이 과하다.
  //   b > 1  덜 벌린다. 경쟁 항이 약하다.
  //
  // ⚠️ 축척은 a만 움직이고 b는 못 바꾼다. 그래서 **b가 진짜 구조 지표**다.
  it("(3) 기울기 — 산식이 너무 벌리나 덜 벌리나", () => {
    const f = fits(P0, CAL_SET);
    const m = measure(P0, f[0].scale);
    const pairs = m.req.filter((x) => x.share != null && x.share > 0 && x.r > 0);
    const X = pairs.map((x) => Math.log(x.share!)), Y = pairs.map((x) => Math.log(x.r));
    const mx = mean(X), my = mean(Y);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; }
    const b = sxx > 0 ? sxy / sxx : NaN;
    console.log(`\n[기울기] log(필요 점유율) = a + b x log(예측 점유율) · n=${pairs.length}`);
    console.log(`  b = ${b.toFixed(3)}   r = ${m.rShare.toFixed(3)}`);
    console.log(`  ${b < 0.9 ? "**b < 1 — 산식이 너무 벌린다. 경쟁 항이 과하다.**"
      : b > 1.1 ? "**b > 1 — 덜 벌린다. 경쟁 항이 약하다.**" : "b ≈ 1 — 벌리는 정도는 맞다. 남은 건 수준뿐."}`);
    // 예측 점유율 4분위별로 필요÷예측을 본다 — 기울기가 어디서 어긋나는지 보인다.
    const sorted = [...pairs].sort((a, c) => a.share! - c.share!);
    const q = Math.ceil(sorted.length / 4);
    console.log(`\n  예측 점유율 4분위 (낮은 쪽 = 경쟁이 센 곳)`);
    console.log("   분위  곳수  예측점유율중앙  필요÷예측 중앙");
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      const ms = [...g].map((x) => x.share!).sort((a, c) => a - c)[Math.floor(g.length / 2)];
      const mr = [...g].map((x) => x.r / x.share!).sort((a, c) => a - c)[Math.floor(g.length / 2)];
      console.log(`  ${i + 1}분위 ${String(g.length).padStart(4)}  ${(ms * 100).toFixed(0).padStart(12)}%  ${mr.toFixed(2).padStart(14)}`);
    }
    console.log(`  ⚠️ 1분위(경쟁 센 곳)에서 '필요÷예측'이 1보다 크면 그 구간을 과소예측하는 것이다.`);
    expect(pairs.length).toBeGreaterThan(20);
  });
});
