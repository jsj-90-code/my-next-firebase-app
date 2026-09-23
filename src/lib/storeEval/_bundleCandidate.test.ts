// 묶음 후보 재고 표 — 존구성 뺌 × θ × 1km 밖 고리 λ (2026-09-23, 배선된 파라미터로)
//
// ── 무엇을 재나 ───────────────────────────────────────────────────────────
// 어제 두 파일이 갈라놓은 구조: "격차는 품질 눈금(θ), 수준은 수요(고리)". 하나만 고치면 무너진다.
// 이 파일은 그 **묶음**을 배선된 파라미터(`residentRingDecayM`)로 격자 전체에서 재고, 미리 못 박은
// 기준으로 순위를 매긴다. 채택은 사용자 몫이다 — 여기서는 **추천 + 근거 + 대안**을 표로 남긴다.
//
// ── ⚠️ 사전 등록 — 자료를 보기 전에 정한 판정 기준. 고치지 말 것 ────────────
//   (1) 자사 편향·경쟁점 편향이 **둘 다 ±3%p 안** (수준이 맞는가)
//   (2) 그중 자사우위 예측이 **1년차 목표 1.74배**에 가장 가까운 칸 (격차가 맞는가)
//       · 1.74 = 오픈 1년 안 자사 9곳의 같은 달 실측 우위(`_demandPathOutside` (5)). n=9라 흔들린다.
//       · 참고로 전체 같은 달 1.32 · 평가창 기준 1.48도 같이 적는다
//   (3) 동률이면 자사 r이 큰 쪽
//   (4) 지금 배선(θ3·존구성·λ0) 대비 자사 MAE 악화 폭을 2SE와 같이 적는다 — 치르는 값을 숨기지 않는다
//
// ── 잣대 ──────────────────────────────────────────────────────────────────
//   세 잣대(자사 37 · 경쟁점 핑봇 47 · 동네 안 짝) + 실측 수요(14동네, λ에만 반응)
//
// ⛔ 계수를 여기서 고치지 않는다. 운영 V62는 안 건드린다.
// 실행: npx vitest run src/lib/storeEval/_bundleCandidate.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, rivalQualityParts } from "./labInput";
import { residentRingsByCodeFromSgis, type SgisFile } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeLocationScoreFromFacts } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight, residentRingWeight,
  type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const SGIS_FILE = ".local-tools/sgis-resident-population.json";
const describeIf = hasValidationSnapshot() && existsSync(SGIS_FILE) ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN;
};
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const MONTH_HOURS = 720;
const TARGET_GAP_YOUNG = 1.74;   // 1년 안 자사 9곳 같은 달 실측 우위
const TARGET_GAP_ALL = 1.32;     // 26곳 같은 달
const TARGET_GAP_EVAL = 1.48;    // 26곳 평가창 기준(어제까지 쓰던 잣대)

describeIf("묶음 후보 — 존구성 뺌 × θ × 고리 λ", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const residentRingsByCode = residentRingsByCodeFromSgis(JSON.parse(readFileSync(SGIS_FILE, "utf8")) as SgisFile);
  // ⭐ 배선된 경로 — 고리 인구를 입력에 실어 넣는다. λ=0이면 산식이 그 입력을 안 읽는다.
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, residentRingsByCode });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;
  const pcOf = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;

  // ── 주인공 (자사 + 경쟁점) — `_zoneAsDemand`와 같은 조립 ─────────────────
  type Subject = { hood: string; code: string; isOurs: boolean; act: number; input: TextbookInput };
  const subjects: Subject[] = [];
  for (const r of base) {
    const st = storeByCode.get(r.input.storeCode);
    if (!st?.lat || !st?.lng || !(r.input.pcCount ?? 0)) continue;
    const comps: { c: Competitor; lat: number; lng: number; pc: number }[] = [];
    for (const c of compsByCode.get(r.input.storeCode) ?? []) {
      if (c.investigationStatus === "경쟁점없음") continue;
      const pc = pcOf(c);
      if (c.lat == null || c.lng == null || !(pc && pc > 0)) continue;
      comps.push({ c, lat: c.lat, lng: c.lng, pc });
    }
    if (!comps.length) continue;
    const hood = r.input.storeName ?? r.input.storeCode, code = r.input.storeCode;
    const a = r.input.actualUtilization;
    if (a != null && a > 0) subjects.push({ hood, code, isOurs: true, act: a, input: r.input });
    comps.forEach((me, k) => {
      const pv = ping(me.c);
      if (pv == null || !(pv > 0)) return;
      const rivals: NonNullable<TextbookInput["rivals"]> = [
        { ip: r.input.pcCount as number, distanceM: distM(me.lat, me.lng, st.lat!, st.lng!), parts: r.input.ownQualityParts, name: r.input.storeName },
        ...comps.filter((_, j) => j !== k).map((o) => ({ ip: o.pc, distanceM: distM(me.lat, me.lng, o.lat, o.lng), parts: rivalQualityParts(o.c, settings), name: o.c.name ?? null })),
      ];
      subjects.push({
        hood, code, isOurs: false, act: pv / 100,
        input: {
          ...r.input, storeCode: `riv:${me.c.id}`, storeName: me.c.name ?? "(이름없음)", pcCount: me.pc,
          hourlyRate: me.c.hourlyRateConverted ?? r.input.hourlyRate, actualUtilization: null,
          ownQualityParts: rivalQualityParts(me.c, settings), rivals,
          competitorIp: rivals.reduce((s, x) => s + x.ip, 0), competitorCount: rivals.length,
          location: r.input.location ? {
            centrality: r.input.location.centrality,
            access: computeLocationScoreFromFacts(me.c.floor ?? null, me.c.groundLevel ?? null, me.c.hasElevator ?? null),
            direction: null, flowBlock: null, visibility: null,
          } : null,
        },
      });
    });
  }

  // ── 실측 수요 동네 — `_measuredDemand`와 같은 조립 ────────────────────────
  const sales = (snap.sales ?? []) as Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>;
  const panel = new Map<string, Map<string, number>>();
  for (const s of sales) {
    if (s.utilizationRate == null || !(s.utilizationRate > 0)) continue;
    if (!panel.has(s.storeCode)) panel.set(s.storeCode, new Map());
    panel.get(s.storeCode)!.set(s.yearMonth, s.utilizationRate);
  }
  const pingMonth = (c: Competitor): string | null => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (c as any).pingbotPeriod as string | null | undefined;
    const m = p && /(\d{4})[-.]?(\d{2})/.exec(p);
    return m ? `${m[1]}-${m[2]}` : null;
  };
  type Site = { input: TextbookInput; measuredLow: number; measuredUp: number };
  const sites: Site[] = [];
  for (const r of base) {
    const code = r.input.storeCode;
    const cs = (compsByCode.get(code) ?? []).filter((c) => (ping(c) ?? 0) > 0 && (pcOf(c) ?? 0) > 0);
    if (cs.length < 2) continue;
    const months = cs.map(pingMonth).filter((x): x is string => !!x);
    const ym = months.length ? med(months.map((m) => Number(m.replace("-", "")))) : null;
    const ymStr = ym ? `${String(ym).slice(0, 4)}-${String(ym).slice(4)}` : null;
    const ourUtil = ymStr ? panel.get(code)?.get(ymStr) : undefined;
    const ourPc = r.input.pcCount ?? 0;
    if (!ymStr || ourUtil == null || !(ourUtil > 0) || !(ourPc > 0)) continue;
    let allRivalPc = 0;
    for (const rv of r.input.rivals ?? []) { if (rv.ip > 0) { const w = rivalDistanceWeight(rv.distanceM, P); if (w > 0) allRivalPc += rv.ip * w; } }
    const pingPc = cs.reduce((a, c) => a + (pcOf(c) as number), 0);
    const pingHours = cs.reduce((a, c) => a + (pcOf(c) as number) * MONTH_HOURS * ((ping(c) as number) / 100), 0);
    const ourHours = ourPc * MONTH_HOURS * ourUtil;
    const cov = (ourPc + pingPc) / (ourPc + Math.max(allRivalPc, pingPc));
    sites.push({ input: r.input, measuredLow: ourHours + pingHours, measuredUp: (ourHours + pingHours) / Math.max(cov, 0.05) });
  }

  // ── 격자 칸 ──────────────────────────────────────────────────────────────
  type Cell = { zoneIn: boolean; theta: number; lambda: number };
  const paramsOf = (c: Cell): TextbookParams => ({
    ...P, qualityExponent: c.theta, residentRingDecayM: c.lambda,
    qualityWeights: { ...P.qualityWeights, zone: c.zoneIn ? P.qualityWeights.zone : 0 },
  });
  const label = (c: Cell) => `${c.zoneIn ? "존있음" : "존뺌  "} θ${c.theta.toFixed(2)} λ${String(c.lambda).padStart(4)}`;
  type Obs = Subject & { pred: number };
  const run = (c: Cell): Obs[] => {
    const p2 = paramsOf(c);
    const out: Obs[] = [];
    for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); }
    return out;
  };
  const score = (obs: Obs[]) => {
    const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
    const mae = (g: Obs[]) => mean(g.map((x) => Math.abs(x.pred - x.act)));
    const bias = (g: Obs[]) => mean(g.map((x) => x.pred - x.act));
    const rOf = (g: Obs[]) => corr(g.map((x) => Math.log(x.pred)), g.map((x) => Math.log(x.act)));
    const byHood = new Map<string, Obs[]>();
    for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
    const gO: number[] = [], gP: number[] = [], relO: number[] = [], relP: number[] = [];
    let pairs = 0, hit = 0;
    for (const g of byHood.values()) {
      for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
        pairs += 1; const ao = g[x].act / g[y].act, ap = g[x].pred / g[y].pred;
        if (Math.sign(ao - 1) === Math.sign(ap - 1)) hit += 1;
        gO.push(Math.log(ao)); gP.push(Math.log(ap));
      }
      const o = g.find((z) => z.isOurs), rs = g.filter((z) => !z.isOurs);
      if (o && rs.length) { relO.push(Math.log(o.act / mean(rs.map((z) => z.act)))); relP.push(Math.log(o.pred / mean(rs.map((z) => z.pred)))); }
    }
    return {
      ours, riv, ourMae: mae(ours), ourBias: bias(ours), ourR: rOf(ours),
      ourSpread: sdOf(ours.map((x) => Math.log(x.pred))) / sdOf(ours.map((x) => Math.log(x.act))),
      rivMae: mae(riv), rivBias: bias(riv), rivR: rOf(riv),
      pairHit: hit / pairs, pairR: corr(gP, gO), pairSpread: sdOf(gP) / sdOf(gO),
      gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
    };
  };
  type Score = ReturnType<typeof score>;
  /** 지금 배선 대비 자사 MAE 변화의 2SE(짝지은 차이) */
  const twoSe = (a: Obs[], b: Obs[]) => {
    const bm = new Map(b.map((o) => [o.input.storeCode, o]));
    const d: number[] = [];
    for (const o of a) { const q = bm.get(o.input.storeCode); if (q) d.push(Math.abs(q.pred - q.act) - Math.abs(o.pred - o.act)); }
    return d.length > 1 ? 2 * sdOf(d) / Math.sqrt(d.length) : NaN;
  };
  const NOW: Cell = { zoneIn: true, theta: 3, lambda: 0 };
  // 1차(2026-09-23 오전) 격자 λ {0,500,1000,2000}에서는 기준 (1)을 통과한 칸이 없었다 — 존뺌·θ2·λ500이
  // 자사 −0.4 / 경쟁 −3.3%p로 0.3%p 차이로 놓쳤고, λ1000(주거 ×2.13)은 너무 컸다. 그래서 500~1000을 촘촘히.
  const THETAS = [3, 2.5, 2, 1.75];
  const LAMBDAS = [0, 500, 600, 700, 800, 1000];
  const header = () => console.log(
    `  칸                     자사MAE 자사편향 자사r 퍼짐 | 경쟁MAE 경쟁편향 경쟁r | 짝적중 짝r 짝과장 | 자사우위 예측(목표 1.74)`);
  const line = (c: Cell, s: Score, mark = "") => console.log(
    `  ${label(c)}`
    + `${(s.ourMae * 100).toFixed(2).padStart(7)}%p${(s.ourBias * 100).toFixed(1).padStart(6)}%p${s.ourR.toFixed(3).padStart(6)}${s.ourSpread.toFixed(2).padStart(5)}배 |`
    + `${(s.rivMae * 100).toFixed(1).padStart(6)}%p${(s.rivBias * 100).toFixed(1).padStart(6)}%p${s.rivR.toFixed(3).padStart(6)} |`
    + `${(s.pairHit * 100).toFixed(0).padStart(5)}%${s.pairR.toFixed(3).padStart(6)}${s.pairSpread.toFixed(2).padStart(5)}배 |`
    + `${s.gapPred.toFixed(2).padStart(8)}배${mark}`);

  it("(0) 검산 — λ=0이면 어제와 같아야 한다 · 고리가 수요를 얼마나 키우나", () => {
    const now = score(run(NOW));
    console.log(`\n[검산] 지금 배선(λ=0): 자사 ${now.ours.length}곳 MAE ${(now.ourMae * 100).toFixed(2)}%p (어제 5.84%p) · 경쟁점 ${now.riv.length}곳 편향 ${(now.rivBias * 100).toFixed(1)}%p (어제 −10.9%p)`);
    console.log(`  ${Math.abs(now.ourMae - 0.0584) < 0.002 ? "✅ 같다 — 배선이 λ=0에서 아무것도 안 바꿨다" : "⚠️ 다르다 — 배선을 다시 볼 것"}`);
    const withRings = base.filter((r) => r.input.residentAgesByRadius).length;
    console.log(`  고리 인구가 실린 매장 ${withRings}/${base.length}`);
    console.log(`\n  λ별 고리 무게 (1.25km / 1.75km / 3.5km) 와 주거 이용자 배율(1km 대비, 중앙)`);
    for (const lam of LAMBDAS.filter((l) => l > 0)) {
      const ratios: number[] = [];
      for (const r of base) {
        const b0 = computeTextbook(r.input, { ...P, residentRingDecayM: 0 }), b1 = computeTextbook(r.input, { ...P, residentRingDecayM: lam });
        if (b0.residentDemandUsers && b1.residentDemandUsers) ratios.push(b1.residentDemandUsers / b0.residentDemandUsers);
      }
      console.log(`  λ=${String(lam).padStart(4)}  무게 ${residentRingWeight(1250, lam).toFixed(2)} / ${residentRingWeight(1750, lam).toFixed(2)} / ${residentRingWeight(3500, lam).toFixed(2)}`
        + `   주거 이용자 ×${med(ratios).toFixed(2)} (범위 ${Math.min(...ratios).toFixed(2)}~${Math.max(...ratios).toFixed(2)})`);
    }
    expect(Math.abs(now.ourMae - 0.0584)).toBeLessThan(0.002);
    expect(withRings).toBeGreaterThan(30);
  });

  it("(1) ⭐ 실측 수요 잣대 — λ에만 반응한다", () => {
    console.log(`\n[실측 수요 · n=${sites.length}] 배율 = 실측하한 ÷ 산식수요 (하한이라 1을 조금 넘어도 됨)`);
    console.log(`  λ      배율중앙  퍼짐(logSD)  r(산식,실측보정)  산식퍼짐/실측퍼짐`);
    for (const lam of LAMBDAS) {
      const p2 = { ...P, residentRingDecayM: lam };
      const ratios: number[] = [], lm: number[] = [], lu: number[] = [];
      for (const s of sites) { const d = computeTextbook(s.input, p2).totalDemandHours; if (d && d > 0) { ratios.push(s.measuredLow / d); lm.push(Math.log(d)); lu.push(Math.log(s.measuredUp)); } }
      console.log(`  ${String(lam).padStart(4)}${med(ratios).toFixed(2).padStart(10)}배${sdOf(ratios.map(Math.log)).toFixed(3).padStart(11)}${corr(lm, lu).toFixed(3).padStart(15)}${(sdOf(lm) / sdOf(lu)).toFixed(2).padStart(15)}배${lam === 0 ? "  ← 지금" : ""}`);
    }
    expect(sites.length).toBeGreaterThan(5);
  });

  it("(2) ⭐⭐⭐ 격자 — 존구성 × θ × λ · 세 잣대", () => {
    const now = score(run(NOW));
    console.log(`\n[격자] 목표 격차: 1년차 ${TARGET_GAP_YOUNG}배 (전체 같은 달 ${TARGET_GAP_ALL} · 평가창 기준 ${TARGET_GAP_EVAL})`);
    console.log(`  전부 평균 바닥 — 자사 ${(mean(now.ours.map((o, i, a) => Math.abs(mean(a.filter((_, j) => j !== i).map((x) => x.act)) - o.act))) * 100).toFixed(2)}%p`);
    header();
    const cells: Cell[] = [];
    for (const zoneIn of [true, false]) for (const theta of THETAS) for (const lambda of LAMBDAS) cells.push({ zoneIn, theta, lambda });
    const scored = cells.map((c) => ({ c, obs: run(c) })).map((x) => ({ ...x, s: score(x.obs) }));
    let lastZone: boolean | null = null;
    for (const { c, s } of scored) {
      if (lastZone !== c.zoneIn) { console.log(`  ── ${c.zoneIn ? "존구성 점유율에 있음" : "존구성 뺌"} ──`); lastZone = c.zoneIn; }
      const pass = Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03;
      line(c, s, (c.zoneIn && c.theta === 3 && c.lambda === 0 ? "  ← 지금" : "") + (pass ? "  *" : ""));
    }
    console.log(`  (* = 사전 등록 기준 (1) 통과: 두 편향 다 ±3%p 안)`);

    // 사전 등록 순위
    const passing = scored.filter(({ s }) => Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03)
      .sort((a, b) => Math.abs(a.s.gapPred - TARGET_GAP_YOUNG) - Math.abs(b.s.gapPred - TARGET_GAP_YOUNG) || b.s.ourR - a.s.ourR);
    console.log(`\n[사전 등록 기준 순위] (1) 두 편향 ±3%p → (2) 자사우위 예측이 ${TARGET_GAP_YOUNG}에 가까운 순 → (3) 자사 r`);
    console.log(`  순위  칸                    자사우위예측  |목표차|  자사r   자사MAE(지금 대비, 2SE)   짝r`);
    const nowObs = run(NOW);
    passing.slice(0, 6).forEach(({ c, s, obs }, i) => {
      const d = s.ourMae - now.ourMae, se2 = twoSe(nowObs, obs);
      console.log(`  ${String(i + 1).padStart(3)}   ${label(c)}${s.gapPred.toFixed(2).padStart(10)}배${Math.abs(s.gapPred - TARGET_GAP_YOUNG).toFixed(2).padStart(9)}`
        + `${s.ourR.toFixed(3).padStart(8)}${(s.ourMae * 100).toFixed(2).padStart(9)}%p (${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)}, 2SE ${(se2 * 100).toFixed(2)})`
        + `${s.pairR.toFixed(3).padStart(8)}`);
    });
    if (!passing.length) console.log(`  (기준 (1)을 통과한 칸이 없다)`);
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 1위 칸이 "추천"이다. 다만 |목표차|가 2·3위와 0.1 안이면 **못 가른 것**이다(목표 1.74 자체가 n=9).`);
    console.log(`     · 자사 MAE 악화가 2SE를 넘으면 안쪽에서 확실히 치르는 값이다. 바깥이 좋아지는 값과 같이 보고한다.`);
    console.log(`     · λ 열끼리 비교: 짝 r·자사우위는 λ에 안 움직여야 한다(수요는 비를 안 바꾼다). 움직이면 상한(0.55)에 걸린 매장.`);
    console.log(`  ⛔ 계수를 고르지 않는다. 표를 사용자에게 올린다.`);
    expect(scored.length).toBe(2 * THETAS.length * LAMBDAS.length);
  });

  it("(3) 추천 칸에서 매장별로 — 누가 좋아지고 누가 나빠지나", () => {
    // 추천은 (2)의 사전 등록 순위 1위다. 여기서는 그 칸과 지금을 매장별로 나란히 놓아 사용자가 현장 감각으로 검토할 수 있게 한다.
    const cells: Cell[] = [];
    for (const zoneIn of [true, false]) for (const theta of THETAS) for (const lambda of LAMBDAS) cells.push({ zoneIn, theta, lambda });
    const scored = cells.map((c) => ({ c, obs: run(c), s: score(run(c)) }));
    const passing = scored.filter(({ s }) => Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03)
      .sort((a, b) => Math.abs(a.s.gapPred - TARGET_GAP_YOUNG) - Math.abs(b.s.gapPred - TARGET_GAP_YOUNG) || b.s.ourR - a.s.ourR);
    if (!passing.length) { console.log(`\n[매장별] 기준 통과 칸이 없어 생략`); return; }
    const best = passing[0];
    const nowObs = run(NOW);
    const nowBy = new Map(nowObs.map((o) => [o.input.storeCode, o]));
    console.log(`\n[매장별 — 지금 vs 추천 ${label(best.c)}] 자사 ${best.s.ours.length}곳 · 오차 = 예측 − 실측`);
    console.log(`  매장            실측    지금예측(오차)     추천예측(오차)    변화`);
    const rows = best.s.ours.map((o) => ({ o, n: nowBy.get(o.input.storeCode) })).filter((x) => x.n)
      .sort((a, b) => (Math.abs(a.o.pred - a.o.act) - Math.abs(a.n!.pred - a.n!.act)) - (Math.abs(b.o.pred - b.o.act) - Math.abs(b.n!.pred - b.n!.act)));
    for (const { o, n } of rows) {
      const e0 = n!.pred - n!.act, e1 = o.pred - o.act;
      console.log(`  ${(o.hood).padEnd(14)}${(o.act * 100).toFixed(1).padStart(6)}%${(n!.pred * 100).toFixed(1).padStart(9)}% (${(e0 * 100).toFixed(1).padStart(5)})${(o.pred * 100).toFixed(1).padStart(10)}% (${(e1 * 100).toFixed(1).padStart(5)})`
        + `  ${Math.abs(e1) < Math.abs(e0) - 0.005 ? "좋아짐" : Math.abs(e1) > Math.abs(e0) + 0.005 ? "나빠짐" : "비슷"}`);
    }
    const better = rows.filter(({ o, n }) => Math.abs(o.pred - o.act) < Math.abs(n!.pred - n!.act) - 0.005).length;
    const worse = rows.filter(({ o, n }) => Math.abs(o.pred - o.act) > Math.abs(n!.pred - n!.act) + 0.005).length;
    console.log(`  좋아짐 ${better} · 나빠짐 ${worse} · 비슷 ${rows.length - better - worse}`);
    console.log(`  ⚠️ 안쪽(자사)은 지금 배선이 맞춘 표본이라 나빠지는 곳이 더 많은 게 정상이다. 크게 나빠진 매장은 현장 사정을 물어볼 것.`);
    expect(rows.length).toBeGreaterThan(20);
  });

  it("(4) ⭐⭐ 수요 반경을 넓혔으면 경쟁 반경도 — 경쟁점 거리감쇠를 같이 넓히면", () => {
    // (3)에서 발산역 +18%p · 수원망포 +16%p · 화명대로 −14%p처럼 크게 요동했다. 밀집 도심은 1~2km 고리
    // 인구가 크게 더해지는데, 그 고리 안 경쟁점은 지금 감쇠(평지 200m·λ200m)로 1km에서 무게 0.02다.
    // **수요는 2km까지 세면서 경쟁은 500m까지만 세는 비대칭**이다. 그 고리 사람들 곁엔 그들의 PC방이 있다.
    // 기전상 둘은 같이 움직여야 한다. 여기서는 경쟁 감쇠 scale을 넓혀 본다.
    // ⚠️ weightFactor 0.9593은 (200,200)에서 잰 총량 정규화 상수라 다른 scale에서는 1로 둔다(비교용).
    // ⚠️ 2km 밖 경쟁점 자료는 없다(rival2km는 2km까지). 5km 고리는 λ≤700에서 무게 0.03 이하라 거의 안 든다.
    type Cell4 = { theta: number; lambda: number; rivalScale: number; zoneIn: boolean };
    const paramsOf4 = (c: Cell4): TextbookParams => ({
      ...P, qualityExponent: c.theta, residentRingDecayM: c.lambda,
      qualityWeights: { ...P.qualityWeights, zone: c.zoneIn ? P.qualityWeights.zone : 0 },
      rivalDistanceDecay: c.rivalScale === 200
        ? P.rivalDistanceDecay
        : { plateauM: 200, scaleM: c.rivalScale, weightFactor: 1 },
    });
    const run4 = (c: Cell4): Obs[] => {
      const p2 = paramsOf4(c);
      const out: Obs[] = [];
      for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); }
      return out;
    };
    const lbl = (c: Cell4) => `${c.zoneIn ? "존있음" : "존뺌  "} θ${c.theta.toFixed(2)} λ${String(c.lambda).padStart(4)} 경쟁λ${String(c.rivalScale).padStart(4)}`;
    const show = (c: Cell4, mark = "") => {
      const obs = run4(c), s = score(obs);
      const pass = Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03;
      const worst = [...s.ours].sort((a, b) => Math.abs(b.pred - b.act) - Math.abs(a.pred - a.act)).slice(0, 2)
        .map((o) => `${o.hood} ${((o.pred - o.act) * 100).toFixed(0)}`).join("·");
      console.log(`  ${lbl(c)}`
        + `${(s.ourMae * 100).toFixed(2).padStart(7)}%p${(s.ourBias * 100).toFixed(1).padStart(6)}%p${s.ourR.toFixed(3).padStart(6)} |`
        + `${(s.rivMae * 100).toFixed(1).padStart(6)}%p${(s.rivBias * 100).toFixed(1).padStart(6)}%p${s.rivR.toFixed(3).padStart(6)} |`
        + `${s.pairR.toFixed(3).padStart(6)} |${s.gapPred.toFixed(2).padStart(6)}배 | 최악 ${worst}${mark}${pass ? "  *" : ""}`);
      return s;
    };
    console.log(`\n[경쟁 감쇠 같이 넓히기] 경쟁λ = 평지 200m 밖 exp 감쇠의 scale(m). 200이 지금.`);
    console.log(`  칸                                  자사MAE 자사편향 자사r | 경쟁MAE 경쟁편향 경쟁r | 짝r  | 자사우위 | 자사 최악 2곳(%p)`);
    console.log(`  ── 대조: 지금 배선에서 경쟁 감쇠만 넓히면 ──`);
    for (const rs of [200, 500, 1000]) show({ theta: 3, lambda: 0, rivalScale: rs, zoneIn: true }, rs === 200 ? "  ← 지금" : "");
    console.log(`  ── 묶음: 존뺌 · 고리 · 경쟁 감쇠 ──`);
    for (const theta of [2, 1.75]) for (const lambda of [500, 700]) for (const rs of [200, 500, 1000]) {
      show({ theta, lambda, rivalScale: rs, zoneIn: false });
    }
    console.log(`  (* = 두 편향 다 ±3%p 안)`);
    console.log(`\n  ⛔ 결과(2026-09-23) — **기각.** 경쟁λ500만 돼도 자사 r 0.34→0.14 · 짝 r 0.51→0.36으로 무너지고 최악 매장이 −29%p로 바뀐다.`);
    console.log(`     500m 밖 경쟁점은 대수가 미조사 기본값이라 감쇠를 풀면 분모를 휩쓴다. 지금 감쇠(200·200)가 점유율에는 맞다.`);
    console.log(`     비대칭(수요 2km · 경쟁 500m)은 남는다. 해법은 감쇠 확대가 아니라 **고리 수요를 거리로 배분하는 구조**(중력형)여야 한다 — 다음 갈래.`);
    console.log(`  ⚠️ 2km 밖 경쟁점 자료가 없어 경쟁λ1000은 2km에서 잘린다. 고리도 2km까지로 읽는 게 맞다.`);
    expect(subjects.length).toBeGreaterThan(40);
  });
});
