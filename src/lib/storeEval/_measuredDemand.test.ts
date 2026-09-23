// 동네 수요를 **실측**한다 — 핑봇 경쟁점 + 우리 매장 (2026-09-23)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 지금까지 수요는 인구로 **추정**만 했고 검증할 방법이 없었다(그래서 "수요 구조는 닫혔다").
// 그런데 경쟁점 문서에 **핑봇 실측 가동률**이 있고(57곳), **전부 대수도 같이 있다.**
// 그러면 경쟁점 한 곳의 월 이용시간을 직접 낼 수 있다:
//
//     경쟁점 이용시간 = 대수 x 720 x 핑봇가동률
//
// 우리 매장 이용시간과 합치면 **그 동네 수요의 실측 하한**이 나온다.
// 산식 수요와 대면, 수요식을 **자료로** 교정할 수 있다.
//
// ── ⚠️ 시점을 맞춘다 ──────────────────────────────────────────────────────
// 핑봇은 대개 2026-08 한 주다. 우리 매장은 **같은 달 월별 가동률**을 쓴다
// (평가창 12달 평균이 아니다 — 시점이 어긋나면 배율이 계절·추세를 잡는다).
//
// ── ⚠️ 이건 하한이다 ──────────────────────────────────────────────────────
// 핑봇이 없는 경쟁점은 못 센다. 그래서 **커버리지**(핑봇이 덮은 대수 몫)를 같이 내고,
// 못 덮은 몫은 "덮인 곳과 같은 가동률"로 밀어 올린 값도 같이 찍는다(가정을 적어 둔다).
//
// ⚠️ 측정만 한다. 계수를 고치지 않는다. 운영 V62는 안 건드린다.
//
// 실행: npx vitest run src/lib/storeEval/_measuredDemand.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore } from "./labInput";
import { residentRingsByCodeFromDocs } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
} from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN;
};
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
const MONTH_HOURS = 720;

describeIf("동네 수요 실측 — 핑봇 + 우리 매장", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  // ⚠️ 2026-09-23부터 기본값이 1km 밖 고리(λ600)를 켠다. 고리 인구를 안 넘기면 조용히 −10%p 과소예측한다.
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings,
    residentRingsByCode: residentRingsByCodeFromDocs(snap.labResidentRings ?? []) });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  // 월별 가동률 — 시점을 맞추는 데 쓴다
  const sales = (snap.sales ?? []) as Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>;
  const panel = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const v = s.utilizationRate;
    if (v == null || !(v > 0)) continue;
    if (!panel.has(s.storeCode)) panel.set(s.storeCode, new Map());
    panel.get(s.storeCode)!.set(s.yearMonth, v);
  }

  /** 핑봇 측정 기간의 대표 달. `pingbotPeriod`가 "2026-08-23~..." 꼴이다. */
  const pingMonth = (c: Competitor): string | null => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (c as any).pingbotPeriod as string | null | undefined;
    const m = p && /(\d{4})[-.]?(\d{2})/.exec(p);
    return m ? `${m[1]}-${m[2]}` : null;
  };
  const rivalPc = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;

  type Site = {
    name: string; code: string; ym: string;
    ourPc: number; ourUtil: number; ourHours: number;
    pingN: number; pingPc: number; pingHours: number; pingUtil: number;
    /** 이 매장이 세는 경쟁점 전체의 (거리무게 먹인) 대수 */
    allRivalPc: number;
    coverage: number;
    measuredLow: number;   // 우리 + 핑봇 경쟁점 (하한)
    measuredUp: number;    // 못 덮은 경쟁점도 같은 가동률이라 치고 밀어 올린 값
    modelDemand: number;
  };
  const sites: Site[] = [];
  for (const r of base) {
    const code = r.input.storeCode;
    const cs = (compsByCode.get(code) ?? []).filter((c) => (ping(c) ?? 0) > 0 && (rivalPc(c) ?? 0) > 0);
    if (cs.length < 2) continue;
    // 시점 — 핑봇 달의 최빈값
    const months = cs.map(pingMonth).filter((x): x is string => !!x);
    const ym = months.length ? med(months.map((m) => Number(m.replace("-", "")))) : null;
    const ymStr = ym ? `${String(ym).slice(0, 4)}-${String(ym).slice(4)}` : null;
    if (!ymStr) continue;
    const ourUtil = panel.get(code)?.get(ymStr);
    if (ourUtil == null || !(ourUtil > 0)) continue;
    const b = computeTextbook(r.input, P);
    const ourPc = r.input.pcCount ?? 0;
    if (b.totalDemandHours == null || !(ourPc > 0)) continue;
    let allRivalPc = 0;
    for (const rv of r.input.rivals ?? []) {
      if (!(rv.ip > 0)) continue;
      const w = rivalDistanceWeight(rv.distanceM, P);
      if (w > 0) allRivalPc += rv.ip * w;
    }
    const pingPc = cs.reduce((a, c) => a + (rivalPc(c) as number), 0);
    const pingHours = cs.reduce((a, c) => a + (rivalPc(c) as number) * MONTH_HOURS * ((ping(c) as number) / 100), 0);
    const ourHours = ourPc * MONTH_HOURS * ourUtil;
    // 커버리지 — 우리 + 핑봇 경쟁점 대수가 (우리 + 전체 경쟁점) 대수에서 차지하는 몫
    const cov = (ourPc + pingPc) / (ourPc + Math.max(allRivalPc, pingPc));
    sites.push({
      name: r.input.storeName ?? code, code, ym: ymStr,
      ourPc, ourUtil, ourHours,
      pingN: cs.length, pingPc, pingHours,
      pingUtil: pingPc > 0 ? pingHours / (pingPc * MONTH_HOURS) : NaN,
      allRivalPc, coverage: cov,
      measuredLow: ourHours + pingHours,
      measuredUp: (ourHours + pingHours) / Math.max(cov, 0.05),
      modelDemand: b.totalDemandHours,
    });
  }

  it("(1) ⭐⭐ 실측 수요 vs 산식 수요 — 매장별", () => {
    console.log(`\n[실측 수요] 핑봇 경쟁점 2곳 이상 + 같은 달 우리 가동률이 있는 매장 **${sites.length}곳**`);
    console.log(`  실측 하한 = 우리 이용시간 + 핑봇 경쟁점 이용시간 (핑봇 없는 경쟁점은 못 셈)`);
    console.log(`  밀어올림  = 하한 ÷ 커버리지 (못 덮은 경쟁점도 같은 가동률이라 가정)`);
    console.log(`\n  매장           달       우리    핑봇n 핑봇가동률 커버리지  실측하한  밀어올림  산식수요  배율(하한/산식)`);
    for (const s of [...sites].sort((a, b) => b.measuredLow / b.modelDemand - a.measuredLow / a.modelDemand)) {
      console.log(`  ${s.name.padEnd(13)}${s.ym}${(s.ourUtil * 100).toFixed(1).padStart(8)}%`
        + `${String(s.pingN).padStart(5)}${(s.pingUtil * 100).toFixed(1).padStart(9)}%`
        + `${(s.coverage * 100).toFixed(0).padStart(8)}%`
        + `${(s.measuredLow / 1000).toFixed(0).padStart(9)}`
        + `${(s.measuredUp / 1000).toFixed(0).padStart(9)}`
        + `${(s.modelDemand / 1000).toFixed(0).padStart(9)}`
        + `${(s.measuredLow / s.modelDemand).toFixed(2).padStart(12)}배`);
    }
    const rLow = sites.map((s) => s.measuredLow / s.modelDemand);
    const rUp = sites.map((s) => s.measuredUp / s.modelDemand);
    console.log(`\n  ⭐ **배율 — 실측 하한 ÷ 산식 수요: 중앙 ${med(rLow).toFixed(2)}배**`
      + ` (범위 ${Math.min(...rLow).toFixed(2)}~${Math.max(...rLow).toFixed(2)})`);
    console.log(`     밀어올림 기준: 중앙 ${med(rUp).toFixed(2)}배`
      + ` (범위 ${Math.min(...rUp).toFixed(2)}~${Math.max(...rUp).toFixed(2)})`);
    console.log(`\n  ⚠️ **하한도 1을 넘으면 산식 수요는 확실히 작다.** 하한은 못 센 경쟁점을 뺀 값이니까.`);
    console.log(`  ⚠️ 경쟁점 대수가 과대하면 배율도 과대해진다 — 핑봇 57곳은 조사된 실사 대수다.`);
    expect(sites.length).toBeGreaterThan(5);
  });

  it("(2) ⭐⭐⭐ 배율이 일정한가, 아니면 무엇에 끌려다니나", () => {
    // 배율이 매장마다 **일정하면** 수요식은 모양이 맞고 **눈금만** 틀린 것이다(상수배로 고침).
    // 무엇인가와 **체계적으로 움직이면** 그 항이 잘못 재고 있는 것이다(그걸 고쳐야 한다).
    if (sites.length < 8) { console.log(`\n[배율 진단] 매장 ${sites.length}곳 — 너무 적다`); return; }
    const ratio = sites.map((s) => Math.log(s.measuredLow / s.modelDemand));
    console.log(`\n[배율 진단] log(실측하한 ÷ 산식수요) 가 무엇과 움직이나 · n=${sites.length}`);
    console.log(`  배율의 퍼짐(log SD) = ${sdOf(ratio).toFixed(3)}`
      + ` — 0에 가까울수록 "눈금만 틀렸다"에 가깝다`);
    const byCode = new Map(base.map((r) => [r.input.storeCode, r.input]));
    // ⚠️ **인위적 상관을 조심한다.** log(실측÷산식)을 log(산식)에 대고 재면, 산식이
    //    양쪽에 반대 부호로 들어가서 **저절로 음수**가 나온다. 그건 신호가 아니다.
    //    대신 **퍼짐을 직접 견준다** — 산식 수요가 실측보다 넓게 벌리나?
    const mLow = sites.map((s) => Math.log(s.measuredLow));
    const mUp = sites.map((s) => Math.log(s.measuredUp));
    const mdl = sites.map((s) => Math.log(s.modelDemand));
    console.log(`\n  [퍼짐 대조] 인위적 상관을 피해 **직접** 견준다`);
    console.log(`    산식 수요 퍼짐(logSD)    ${sdOf(mdl).toFixed(3)}`);
    console.log(`    실측 하한 퍼짐           ${sdOf(mLow).toFixed(3)}`);
    console.log(`    실측 밀어올림 퍼짐        ${sdOf(mUp).toFixed(3)}`);
    console.log(`    **과장 배수** = 산식÷실측하한 ${(sdOf(mdl) / sdOf(mLow)).toFixed(2)}배`
      + ` · 산식÷밀어올림 ${(sdOf(mdl) / sdOf(mUp)).toFixed(2)}배`);
    console.log(`    산식 vs 실측하한 상관 r = ${corr(mdl, mLow).toFixed(3)}`
      + ` · 산식 vs 밀어올림 r = ${corr(mdl, mUp).toFixed(3)}`);
    console.log(`    ⭐ 1보다 크면 **산식이 수요를 과하게 벌린다**. r이 낮으면 순서도 못 맞힌다.`);

    const cands: { name: string; v: (s: Site) => number | null }[] = [
      { name: "log 1km 인구", v: (s) => { const p = byCode.get(s.code)?.pop1km; return p && p > 0 ? Math.log(p) : null; } },
      { name: "log 유동 400m", v: (s) => { const f = byCode.get(s.code)?.floatingByRadius?.[400]; return f && f > 0 ? Math.log(f) : null; } },
      { name: "유동이 수요에서 차지하는 몫", v: (s) => {
        const inp = byCode.get(s.code);
        if (!inp) return null;
        const b = computeTextbook(inp, P);
        const a = b.residentDemandUsers ?? 0, f = b.floatingDemandUsers ?? 0;
        return a + f > 0 ? f / (a + f) : null;
      } },
      { name: "log 경쟁점 대수", v: (s) => (s.allRivalPc > 0 ? Math.log(s.allRivalPc) : null) },
      { name: "커버리지", v: (s) => s.coverage },
      { name: "우리 가동률", v: (s) => s.ourUtil },
    ];
    console.log(`\n  후보                          n    배율과 r`);
    for (const c of cands) {
      const pr = sites.map((s, i) => [c.v(s), ratio[i]] as const)
        .filter((q): q is readonly [number, number] => q[0] != null && Number.isFinite(q[0]));
      if (pr.length < 6) continue;
      const rr = corr(pr.map((q) => q[0]), pr.map((q) => q[1]));
      console.log(`  ${c.name.padEnd(28)}${String(pr.length).padStart(3)}${rr.toFixed(3).padStart(12)}`
        + (Math.abs(rr) >= 0.6 ? "  ⭐ 강하다" : Math.abs(rr) >= 0.45 ? "  ·" : ""));
    }
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 아무것과도 안 움직이면 -> **눈금만 틀렸다.** 수요에 상수배를 하면 된다`);
    console.log(`       (그런데 상수배는 수준만 바꾸므로 분별력은 안 바뀐다 — 그게 (8)번에서 본 것)`);
    console.log(`     · 유동 몫과 강하게 움직이면 -> **유동 항의 눈금(x0.15)이 틀렸다**`);
    console.log(`     · 인구와 움직이면 -> 반경이나 이용률 곡선이 틀렸다`);
    expect(sites.length).toBeGreaterThan(5);
  });

  it("(3) ⭐⭐⭐ 실측 수요에 맞추려면 어느 항을 얼마나 키워야 하나 — 재고 표", () => {
    // (2)가 "어디가 틀렸나"를 가리키면, 여기서 **그 항을 키워 실측과 맞춰 본다.**
    // ⛔ 값을 고르지 않는다. 각 손잡이가 실측 배율을 얼마나 줄이는지만 본다.
    if (sites.length < 8) return;
    const byCode = new Map(base.map((r) => [r.input.storeCode, r.input]));
    const ratioWith = (mod: (p: typeof P) => typeof P) => {
      const P2 = mod(P);
      const rs: number[] = [];
      for (const s of sites) {
        const inp = byCode.get(s.code);
        if (!inp) continue;
        const d = computeTextbook(inp, P2).totalDemandHours;
        if (d == null || !(d > 0)) continue;
        rs.push(s.measuredLow / d);
      }
      return rs;
    };
    const line = (label: string, rs: number[], mark = "") => {
      if (!rs.length) return;
      console.log(`  ${label.padEnd(30)}${med(rs).toFixed(2).padStart(8)}배`
        + `${Math.min(...rs).toFixed(2).padStart(9)}~${Math.max(...rs).toFixed(2)}배`
        + `${sdOf(rs.map(Math.log)).toFixed(3).padStart(10)}${mark}`);
    };
    console.log(`\n[재고 표 — 어느 항을 키우면 실측에 닿나] 목표: 배율 **1.00배** · 퍼짐 작을수록 좋다`);
    console.log(`  손잡이                          배율중앙     범위        퍼짐(logSD)`);
    line("지금 그대로", ratioWith((p) => p), "  ← 지금");
    for (const f of [0.3, 0.5, 0.8]) line(`유동 x${f.toFixed(2)} (지금 0.15)`, ratioWith((p) => ({ ...p, floatingFactor: f })));
    line("주거 반경 500m", ratioWith((p) => ({ ...p, residentRadius: 500 })));
    for (const fr of [300, 500] as const) line(`유동 반경 ${fr}m (지금 400)`, ratioWith((p) => ({ ...p, floatingRadius: fr })));
    for (const a of [0.3, 0.6]) line(`상권 흡인력 a=${a}`, ratioWith((p) => ({ ...p, agglomerationFactor: a })));
    console.log(`\n  ⚠️ 1인당 이용시간(8.20h)은 **원장 실측**이라 여기서 안 건드린다.`);
    console.log(`     수요가 작은 건 "시간이 짧아서"가 아니라 **이용자 수를 적게 세서**다.`);
    console.log(`  ⭐ 배율을 1로 만드는 것만으로는 부족하다 — **퍼짐도 줄어야** 분별력이 생긴다.`);
    console.log(`     배율만 1로 맞추면 수준만 옮긴 것이라 분별력은 그대로다.`);
    expect(sites.length).toBeGreaterThan(5);
  });
});
