// 수요를 키우는 **정당한 경로** 찾기 — 실측 수요(14동네) + 세 잣대(자사 37·경쟁점 47·짝) (2026-09-23)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// `_zoneAsDemand` (5) 격자: 존구성 뺌·θ 2~2.5·**수요 ×1.5** 칸에서 자사·경쟁점 편향이 동시에
// ±3%p 안. "격차는 품질 눈금, 수준은 수요"로 갈라졌다. 수요 ×1.5는 진단용이었다 —
// hoursPerUser 8.20h는 원장 실측이라 못 건드리므로 **이용자 수**를 그만큼 키우는 경로가 필요하다.
// 사용자(2026-09-23): *"수요경로는 너가 알아서 해바"* — 단 채택은 재고 표로 올려 확인받는다.
//
// ── 후보 (기전이 있는 것만) ───────────────────────────────────────────────
//   (가) **1km 밖 고리** — PC방은 3시간·월 3.7회 오는 목적지형이다. 1km 밖에서도 온다.
//        SGIS 파일(.local-tools/sgis-resident-population.json)에 1.5km·2km·5km **연령 분해**가 있다.
//        주거이용자 = 연령가중(1km) + w1·연령가중(1~1.5km 고리) + w2·연령가중(1.5~2km 고리)
//        w는 거리감쇠(가까울수록 1에 가깝다). 2026-09-19~20에 "문경·양주덕정 살리기"로는
//        기각됐지만, 그건 **매출·순위** 잣대였다. 잣대가 바뀌었으니 다시 연다
//        ([[feedback_reopen_closed_branches]]).
//   (나) **경쟁점은 성숙 매장** — 1인당 시간은 개점 경과와 함께 는다(1년 안 8.20h · 1년 초과 11.58h,
//        원장 실측). 핑봇 경쟁점은 대부분 오픈 1년을 넘은 매장이라 8.20h로 재면 **잣대가 낮다.**
//        후보지 예측은 8.20h 그대로 — 이건 바깥 잣대의 시점 정합이다.
//   (다) 유동 ×0.30 — 보정상수라 기전이 없다. **대조용**으로만 찍는다.
//
// ── 잣대 ──────────────────────────────────────────────────────────────────
//   A. 실측 수요(`_measuredDemand`와 같은 조립, n≈14) — 배율 중앙(목표 1) · 퍼짐(logSD, 작을수록) · r
//   B. 세 잣대 — 지금 배선(θ3·존구성 있음)과 후보 배선(θ2·존구성 뺌) 둘에서
//
// ⛔ 측정만 한다. 계수를 고르지 않는다. 운영 V62는 안 건드린다.
// 실행: npx vitest run src/lib/storeEval/_demandPathOutside.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, rivalQualityParts } from "./labInput";
import { residentRingsByCodeFromDocs } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeLocationScoreFromFacts } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
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
/** 원장 실측 — 오픈 1년 초과 4곳 평균([[project_per_user_hours_grow_with_age]]) */
const HOURS_PER_USER_MATURE = 11.58;

type Ages = NonNullable<TextbookInput["residentAges"]>;
type SgisPops = Record<string, number | string | null | undefined>;
type SgisSite = { kind?: string; code?: string | number; name?: string; radii?: Record<string, { pops?: SgisPops; totalPopulation?: number | null }> };

/** SGIS age_1~9 -> 우리 7구간 (writeResidentPopulationToFirestore.mjs와 같은 대응) */
const agesOf = (pops: SgisPops | undefined): Ages | null => {
  if (!pops || pops.age_2_cnt == null) return null;
  const n = (k: string) => Number(pops[k] ?? 0);
  return {
    age0s: n("age_1_cnt"), age10s: n("age_2_cnt"), age20s: n("age_3_cnt"), age30s: n("age_4_cnt"),
    age40s: n("age_5_cnt"), age50s: n("age_6_cnt"), age60plus: n("age_7_cnt") + n("age_8_cnt") + n("age_9_cnt"),
  };
};
const addAges = (a: Ages, b: Ages, w: number): Ages => ({
  age0s: a.age0s + w * b.age0s, age10s: a.age10s + w * b.age10s, age20s: a.age20s + w * b.age20s,
  age30s: a.age30s + w * b.age30s, age40s: a.age40s + w * b.age40s, age50s: a.age50s + w * b.age50s,
  age60plus: a.age60plus + w * b.age60plus,
});
const subAges = (a: Ages, b: Ages): Ages => addAges(a, b, -1);

describeIf("수요 경로 — 실측 수요 + 세 잣대", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  // ⚠️ 2026-09-23부터 기본값이 1km 밖 고리(λ600)를 켠다. 고리 인구를 안 넘기면 조용히 −10%p 과소예측한다.
  //    이 파일의 "지금 그대로" 줄은 그래서 이제 **새 기본값(고리 포함)**이다. 옛 배선은 `_bundleCandidate` (0).
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings,
    residentRingsByCode: residentRingsByCodeFromDocs(snap.labResidentRings ?? []),
    // 항아리 판정(2026-09-23 밤 채택) — 안 넘기면 useRingEnclosure가 켜져도 안 깎인다
    ringBlockedByCode: new Map(((snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null }[])
      .filter((j) => j.code && typeof j.ringCutCount === "number").map((j) => [String(j.code), j.ringCutCount as number])) });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));

  // SGIS — 매장코드별 반경 연령
  const sg = JSON.parse(readFileSync(SGIS_FILE, "utf8")) as { sites: Record<string, SgisSite> };
  const sgisByCode = new Map<string, Record<string, Ages>>();
  for (const s of Object.values(sg.sites ?? {})) {
    if (s.kind !== "existing" || s.code == null) continue;
    const rec: Record<string, Ages> = {};
    for (const [r, v] of Object.entries(s.radii ?? {})) { const a = agesOf(v.pops); if (a) rec[r] = a; }
    sgisByCode.set(String(s.code), rec);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;
  const pcOf = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;

  // ── 수요 변형 = 입력 변환 + 파라미터 변환 ─────────────────────────────────
  type Variant = {
    label: string;
    /** 그 매장(동네) 입력을 바꾼다. code는 우리 매장 코드다. */
    input?: (code: string, inp: TextbookInput) => TextbookInput;
    params?: (p: TextbookParams) => TextbookParams;
    /** 경쟁점이 주인공일 때만 hoursPerUser를 이 값으로 (나) */
    rivalHours?: number;
    note?: string;
  };
  /** 1km 연령가중 + Σ w·고리 — 고리는 SGIS로 계산(1km도 SGIS로 맞춘다. 스냅샷 1km와 중앙 1.000배) */
  const ring = (label: string, ws: { to: string; from: string; w: number }[], note?: string): Variant => ({
    label, note,
    input: (code, inp) => {
      const rec = sgisByCode.get(code);
      if (!rec || !rec["1000"]) return inp;
      let a = rec["1000"];
      for (const { to, from, w } of ws) {
        if (!rec[to] || !rec[from]) return inp;
        a = addAges(a, subAges(rec[to], rec[from]), w);
      }
      return { ...inp, residentAges: a };
    },
  });
  const NOW: Variant = { label: "지금 그대로" };
  const VARIANTS: Variant[] = [
    NOW,
    ring("SGIS 1km만(검산)", []),
    ring("+1.5km고리 w.5", [{ to: "1500", from: "1000", w: 0.5 }]),
    ring("+1.5km고리 w1", [{ to: "1500", from: "1000", w: 1 }]),
    ring("+2km고리 w.25", [{ to: "2000", from: "1000", w: 0.25 }]),
    ring("+2km고리 w.5", [{ to: "2000", from: "1000", w: 0.5 }]),
    ring("감쇠 1/.5/.25 (2km)", [{ to: "1500", from: "1000", w: 0.5 }, { to: "2000", from: "1500", w: 0.25 }], "거리감쇠 모양"),
    ring("감쇠 1/.5/.25/.05 (5km)", [{ to: "1500", from: "1000", w: 0.5 }, { to: "2000", from: "1500", w: 0.25 }, { to: "5000", from: "2000", w: 0.05 }]),
    { label: "유동 x0.30 (대조·기전없음)", params: (p) => ({ ...p, floatingFactor: 0.30 }) },
    { label: "수요 x1.5 (진단용 기준선)", params: (p) => ({ ...p, hoursPerUserPerMonth: p.hoursPerUserPerMonth * 1.5 }) },
  ];

  // ── 잣대 A: 실측 수요 (조립은 `_measuredDemand`와 같다) ─────────────────
  const sales = (snap.sales ?? []) as Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>;
  const panel = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const v = s.utilizationRate;
    if (v == null || !(v > 0)) continue;
    if (!panel.has(s.storeCode)) panel.set(s.storeCode, new Map());
    panel.get(s.storeCode)!.set(s.yearMonth, v);
  }
  const pingMonth = (c: Competitor): string | null => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (c as any).pingbotPeriod as string | null | undefined;
    const m = p && /(\d{4})[-.]?(\d{2})/.exec(p);
    return m ? `${m[1]}-${m[2]}` : null;
  };
  type Site = { code: string; input: TextbookInput; measuredLow: number; measuredUp: number };
  const sites: Site[] = [];
  for (const r of base) {
    const code = r.input.storeCode;
    const cs = (compsByCode.get(code) ?? []).filter((c) => (ping(c) ?? 0) > 0 && (pcOf(c) ?? 0) > 0);
    if (cs.length < 2) continue;
    const months = cs.map(pingMonth).filter((x): x is string => !!x);
    const ym = months.length ? med(months.map((m) => Number(m.replace("-", "")))) : null;
    const ymStr = ym ? `${String(ym).slice(0, 4)}-${String(ym).slice(4)}` : null;
    if (!ymStr) continue;
    const ourUtil = panel.get(code)?.get(ymStr);
    const ourPc = r.input.pcCount ?? 0;
    if (ourUtil == null || !(ourUtil > 0) || !(ourPc > 0)) continue;
    let allRivalPc = 0;
    for (const rv of r.input.rivals ?? []) {
      if (!(rv.ip > 0)) continue;
      const w = rivalDistanceWeight(rv.distanceM, P);
      if (w > 0) allRivalPc += rv.ip * w;
    }
    const pingPc = cs.reduce((a, c) => a + (pcOf(c) as number), 0);
    const pingHours = cs.reduce((a, c) => a + (pcOf(c) as number) * MONTH_HOURS * ((ping(c) as number) / 100), 0);
    const ourHours = ourPc * MONTH_HOURS * ourUtil;
    const cov = (ourPc + pingPc) / (ourPc + Math.max(allRivalPc, pingPc));
    sites.push({ code, input: r.input, measuredLow: ourHours + pingHours, measuredUp: (ourHours + pingHours) / Math.max(cov, 0.05) });
  }
  const demandScore = (v: Variant) => {
    const p2 = v.params ? v.params(P) : P;
    const ratios: number[] = [], lm: number[] = [], lu: number[] = [];
    for (const s of sites) {
      const inp = v.input ? v.input(s.code, s.input) : s.input;
      const d = computeTextbook(inp, p2).totalDemandHours;
      if (d == null || !(d > 0)) continue;
      ratios.push(s.measuredLow / d); lm.push(Math.log(d)); lu.push(Math.log(s.measuredUp));
    }
    return { n: ratios.length, medLow: med(ratios), spread: sdOf(ratios.map(Math.log)), r: corr(lm, lu), modelSpread: sdOf(lm), measSpread: sdOf(lu) };
  };

  // ── 잣대 B: 세 잣대 (조립은 `_zoneAsDemand`와 같다) ────────────────────────
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
  type Obs = Subject & { pred: number };
  const wiring = {
    now: (p: TextbookParams) => p,
    cand: (p: TextbookParams) => ({ ...p, qualityExponent: 2, qualityWeights: { ...p.qualityWeights, zone: 0 } }),
  };
  const run = (v: Variant, wire: (p: TextbookParams) => TextbookParams): Obs[] => {
    const p1 = wire(v.params ? v.params(P) : P);
    const out: Obs[] = [];
    for (const s of subjects) {
      const inp = v.input ? v.input(s.code, s.input) : s.input;
      const p2 = !s.isOurs && v.rivalHours ? { ...p1, hoursPerUserPerMonth: v.rivalHours * (p1.hoursPerUserPerMonth / P.hoursPerUserPerMonth) } : p1;
      const u = computeTextbook(inp, p2).utilization;
      if (u != null && u > 0) out.push({ ...s, pred: u });
    }
    return out;
  };
  const score = (obs: Obs[]) => {
    const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
    const mae = (g: Obs[]) => mean(g.map((x) => Math.abs(x.pred - x.act)));
    const bias = (g: Obs[]) => mean(g.map((x) => x.pred - x.act));
    const rOf = (g: Obs[]) => corr(g.map((x) => Math.log(x.pred)), g.map((x) => Math.log(x.act)));
    const spread = (g: Obs[]) => sdOf(g.map((x) => Math.log(x.pred))) / sdOf(g.map((x) => Math.log(x.act)));
    const byHood = new Map<string, Obs[]>();
    for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
    const gO: number[] = [], gP: number[] = [], relO: number[] = [], relP: number[] = [];
    for (const g of byHood.values()) {
      for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
        gO.push(Math.log(g[x].act / g[y].act)); gP.push(Math.log(g[x].pred / g[y].pred));
      }
      const o = g.find((z) => z.isOurs), rs = g.filter((z) => !z.isOurs);
      if (o && rs.length) { relO.push(Math.log(o.act / mean(rs.map((z) => z.act)))); relP.push(Math.log(o.pred / mean(rs.map((z) => z.pred)))); }
    }
    return {
      ourMae: mae(ours), ourBias: bias(ours), ourR: rOf(ours), ourSpread: spread(ours),
      rivMae: mae(riv), rivBias: bias(riv), rivR: rOf(riv),
      pairR: corr(gP, gO), pairSpread: sdOf(gP) / sdOf(gO), gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
    };
  };
  type Score = ReturnType<typeof score>;
  const header = () => console.log(
    `  변형                       자사MAE 자사편향 자사r 퍼짐 | 경쟁MAE 경쟁편향 경쟁r | 짝r  짝과장 | 자사우위 실측/예측`);
  const line = (label: string, s: Score, mark = "") => console.log(
    `  ${label.padEnd(26)}`
    + `${(s.ourMae * 100).toFixed(2).padStart(6)}%p${(s.ourBias * 100).toFixed(1).padStart(6)}%p${s.ourR.toFixed(3).padStart(6)}${s.ourSpread.toFixed(2).padStart(5)}배 |`
    + `${(s.rivMae * 100).toFixed(1).padStart(6)}%p${(s.rivBias * 100).toFixed(1).padStart(6)}%p${s.rivR.toFixed(3).padStart(6)} |`
    + `${s.pairR.toFixed(3).padStart(6)}${s.pairSpread.toFixed(2).padStart(5)}배 |`
    + `${s.gapObs.toFixed(2).padStart(7)}/${s.gapPred.toFixed(2)}배${mark}`);

  it("(0) 표본 — SGIS 매칭·실측 수요 동네·주인공 수", () => {
    const matched = base.filter((r) => sgisByCode.get(r.input.storeCode)?.["2000"]).length;
    console.log(`\n[표본] 실험실 행 ${base.length} · SGIS 2km 연령 있는 매장 ${matched} · 실측수요 동네 ${sites.length}`
      + ` · 주인공 ${subjects.length}(자사 ${subjects.filter((s) => s.isOurs).length})`);
    // 고리 크기 — 1km 대비 몇 배인가
    const rs: number[] = [], r15: number[] = [], r5: number[] = [];
    for (const rec of sgisByCode.values()) {
      const t = (a: Ages) => a.age10s + a.age20s + a.age30s + a.age40s + a.age50s;
      if (rec["1000"] && rec["2000"]) rs.push(t(rec["2000"]) / t(rec["1000"]));
      if (rec["1000"] && rec["1500"]) r15.push(t(rec["1500"]) / t(rec["1000"]));
      if (rec["1000"] && rec["5000"]) r5.push(t(rec["5000"]) / t(rec["1000"]));
    }
    console.log(`  10~50대 인구 배율(1km 대비) — 1.5km 중앙 ${med(r15).toFixed(2)}배 · 2km ${med(rs).toFixed(2)}배 · 5km ${med(r5).toFixed(2)}배`);
    console.log(`  (원 넓이는 1.5km 2.25배 · 2km 4배 · 5km 25배 — 그보다 작으면 인구가 매장 쪽에 몰려 있다는 뜻)`);
    expect(matched).toBeGreaterThan(30);
  });

  it("(1) ⭐⭐⭐ 잣대 A — 실측 수요에 대고", () => {
    console.log(`\n[실측 수요 잣대] n=${sites.length} 동네 · 배율 = 실측하한 ÷ 산식수요 (목표 1.00, 하한이라 1을 조금 넘어도 됨)`);
    console.log(`  변형                         n  배율중앙  퍼짐(logSD)  r(산식,실측보정)  산식퍼짐/실측퍼짐`);
    for (const v of VARIANTS) {
      const s = demandScore(v);
      console.log(`  ${v.label.padEnd(28)}${String(s.n).padStart(2)}${s.medLow.toFixed(2).padStart(9)}배${s.spread.toFixed(3).padStart(11)}`
        + `${s.r.toFixed(3).padStart(15)}${(s.modelSpread / s.measSpread).toFixed(2).padStart(15)}배`
        + (v === NOW ? "  ← 지금" : v.note ? `  ${v.note}` : ""));
    }
    console.log(`\n  ⭐ 읽는 법 — 배율이 1로 가면서 **퍼짐이 줄고 r이 오르는** 경로가 "모양도 맞는" 경로다.`);
    console.log(`     "수요 x1.5"는 퍼짐·r이 지금과 같아야 한다(상수배). 그게 기준선이다.`);
    console.log(`  ⚠️ 경쟁점 대수가 과대하면 배율도 과대해진다. n=14라 r 구간이 넓다.`);
    expect(sites.length).toBeGreaterThan(5);
  });

  it("(2) ⭐⭐⭐ 잣대 B — 세 잣대 · 지금 배선(θ3·존구성 있음)", () => {
    console.log(`\n[세 잣대 · 지금 배선 θ=3 존구성 있음]`);
    header();
    for (const v of VARIANTS) line(v.label, score(run(v, wiring.now)), v === NOW ? "  ← 지금" : "");
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(3) ⭐⭐⭐ 잣대 B — 세 잣대 · 후보 배선(θ2·존구성 뺌)", () => {
    console.log(`\n[세 잣대 · 후보 배선 θ=2 존구성 뺌] — 격자에서 두 편향이 같이 0으로 가던 줄`);
    header();
    for (const v of VARIANTS) line(v.label, score(run(v, wiring.cand)), v === NOW ? "  ← 존구성 뺌·θ2" : "");
    console.log(`\n  ⭐ 읽는 법 — 자사편향·경쟁편향이 **같이** 0에 가고 자사 r이 안 떨어지는 경로. 자사우위 예측은 1.49 근처.`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(4) ⛔ (나) 경쟁점은 성숙 매장 — 1인당 11.58h로 재면? → **기각** (5)번이 이유", () => {
    // 처음 생각: 핑봇 경쟁점은 오픈 1년을 넘은 매장이라 8.20h로 재면 잣대가 낮다 → 11.58h로.
    // ⛔ (5)번이 뒤집었다: 자사 가동률은 평가창→26개월 뒤로 **×0.93**(안 는다). 1인당 시간이
    //    1.41배 늘었는데 총시간이 안 늘었으면 **이용자 수가 그만큼 줄었다**는 뜻이다(단골 축적 =
    //    소수가 오래 쓴다). 그러니 11.58h는 수요 눈금이 아니고, 이걸 곱하면 성숙 매장의 총시간을
    //    1.41배 부풀린다. [[project_per_user_hours_grow_with_age]]의 함정을 다시 밟은 것.
    // 표는 남긴다 — "이렇게 하면 이렇게 보인다"를 기록해 두는 용도. 읽을 때 기각된 줄로 볼 것.
    console.log(`\n[(나) 경쟁점 주인공만 1인당 ${HOURS_PER_USER_MATURE}h · 자사는 8.20h 그대로] ⛔ 기각된 갈래 — (5)번 참고`);
    const withMature = (v: Variant): Variant => ({ ...v, label: `${v.label} +경쟁성숙`, rivalHours: HOURS_PER_USER_MATURE });
    for (const [wl, wire] of [["지금 배선 θ3", wiring.now], ["후보 배선 θ2·존뺌", wiring.cand]] as const) {
      console.log(`\n  ── ${wl} ──`);
      header();
      line(NOW.label, score(run(NOW, wire)), "  ← 기준");
      line(withMature(NOW).label, score(run(withMature(NOW), wire)));
      for (const v of VARIANTS.slice(2, 8)) line(withMature(v).label, score(run(withMature(v), wire)));
    }
    console.log(`\n  ⛔ 기각 — 성숙 매장은 1인당 시간이 늘어도 총시간이 안 는다((5) 자사 ×0.93). 11.58h는 수요 눈금이 아니다.`);
    console.log(`     경쟁편향이 걷혀 보이는 건 경쟁점 총시간을 1.41배 부풀린 결과다. 채택 후보가 아니다.`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(5) ⭐⭐⭐ 실측 자사우위 1.49배도 시점이 어긋나 있다 — 자사 **같은 달** 가동률로 다시", () => {
    // 지금까지 "자사우위 실측 1.49배" = 자사 **평가창(1년차) 평균** ÷ 경쟁점 **2026-08 핑봇**.
    // 시점이 다르다. 자사도 핑봇 달의 월별 가동률로 바꾸면 같은 시점 격차가 나온다.
    // 이게 1.49보다 크면, 산식의 "자사우위 과장"은 지금까지 생각한 것보다 작다.
    type Row = { hood: string; evalUtil: number; sameMonthUtil: number; ym: string; monthsOpen: number | null; rivMean: number; n: number };
    const rows: Row[] = [];
    const byHood = new Map<string, Subject[]>();
    for (const s of subjects) byHood.set(s.code, [...(byHood.get(s.code) ?? []), s]);
    for (const [code, g] of byHood) {
      const o = g.find((s) => s.isOurs), rs = g.filter((s) => !s.isOurs);
      if (!o || !rs.length) continue;
      const cs = (compsByCode.get(code) ?? []).filter((c) => (ping(c) ?? 0) > 0);
      const months = cs.map(pingMonth).filter((x): x is string => !!x);
      const ym = months.length ? med(months.map((m) => Number(m.replace("-", "")))) : null;
      const ymStr = ym ? `${String(ym).slice(0, 4)}-${String(ym).slice(4)}` : null;
      const same = ymStr ? panel.get(code)?.get(ymStr) : undefined;
      if (!ymStr || same == null || !(same > 0)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opened = (storeByCode.get(code) as any)?.openedAt as string | null | undefined;
      const monthsOpen = opened ? Math.round((new Date(`${ymStr}-15`).getTime() - new Date(opened).getTime()) / (30.44 * 86400e3)) : null;
      rows.push({ hood: o.hood, evalUtil: o.act, sameMonthUtil: same, ym: ymStr, monthsOpen, rivMean: mean(rs.map((s) => s.act)), n: rs.length });
    }
    console.log(`\n[자사우위 실측 — 시점을 맞춰서] 동네 ${rows.length}곳 (핑봇 달에 자사 월별 가동률이 있는 곳)`);
    console.log(`  동네            핑봇달   개월차  자사평가창  자사같은달  경쟁점평균(n)  우위(평가창)  우위(같은달)`);
    for (const r of [...rows].sort((a, b) => (a.monthsOpen ?? 0) - (b.monthsOpen ?? 0))) {
      console.log(`  ${r.hood.padEnd(14)}${r.ym}${String(r.monthsOpen ?? "?").padStart(7)}`
        + `${(r.evalUtil * 100).toFixed(1).padStart(10)}%${(r.sameMonthUtil * 100).toFixed(1).padStart(10)}%`
        + `${(r.rivMean * 100).toFixed(1).padStart(10)}%(${r.n})`
        + `${(r.evalUtil / r.rivMean).toFixed(2).padStart(11)}배${(r.sameMonthUtil / r.rivMean).toFixed(2).padStart(11)}배`);
    }
    const gapEval = Math.exp(med(rows.map((r) => Math.log(r.evalUtil / r.rivMean))));
    const gapSame = Math.exp(med(rows.map((r) => Math.log(r.sameMonthUtil / r.rivMean))));
    const drift = Math.exp(med(rows.map((r) => Math.log(r.sameMonthUtil / r.evalUtil))));
    console.log(`\n  ⭐ 자사우위 실측 중앙 — 평가창 기준 **${gapEval.toFixed(2)}배** · 같은 달 기준 **${gapSame.toFixed(2)}배**`);
    console.log(`     자사 가동률 자체가 평가창→같은 달로 중앙 ${drift.toFixed(2)}배 움직였다 (개월차 중앙 ${med(rows.map((r) => r.monthsOpen ?? 0))}개월)`);
    const young = rows.filter((r) => (r.monthsOpen ?? 99) <= 12), old = rows.filter((r) => (r.monthsOpen ?? 0) > 12);
    if (young.length >= 3 && old.length >= 3) {
      const g = (rs: Row[]) => Math.exp(med(rs.map((r) => Math.log(r.sameMonthUtil / r.rivMean))));
      console.log(`     개월차 12 이하 ${young.length}곳 같은달 우위 ${g(young).toFixed(2)}배 · 12 초과 ${old.length}곳 ${g(old).toFixed(2)}배`);
    }
    console.log(`\n  ⭐ 읽는 법 — 같은 달 우위가 1.49보다 크면 "자사 품질 2.35배 과장"은 **시점 착시가 섞인 값**이다.`);
    console.log(`     산식 쪽도 경쟁점을 11.58h로 재야 짝이 맞는다((4)번). 실측·산식 둘 다 같은 시점으로 놓고 다시 견줄 것.`);
    console.log(`  ⚠️ 같은 달은 한 달치라 계절·잡음이 크다. 평가창 12달 평균보다 흔들린다.`);
    expect(rows.length).toBeGreaterThan(8);
  });
});
