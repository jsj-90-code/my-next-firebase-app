// 경쟁점을 주인공으로 — **본 산식 그대로**(입지배율 포함) 검증 (2026-09-23)
//
// ── 왜 또 만드나 ──────────────────────────────────────────────────────────
// `_rivalAsSubject.test.ts`는 점유율 식을 **손으로 다시 짠 간이판**이었다. 입지배율과
// 눈금보정을 뺐고, 그래서 자사 MAE가 본 산식(5.85%p)보다 크게 나왔다. 사용자 요청으로
// **본 산식(computeTextbook)을 그대로 써서** 다시 검증한다.
//
// ── 어떻게 ────────────────────────────────────────────────────────────────
// 경쟁점 하나를 주인공으로 놓고 `TextbookInput`을 만든다:
//   · pcCount        = 그 경쟁점 대수
//   · ownQualityParts= 그 경쟁점 품질(자사와 **같은 함수**로 매긴 값)
//   · rivals         = [우리 매장 + 나머지 경쟁점], 거리는 **그 경쟁점 기준**으로 다시 잼
//   · location.access= 그 경쟁점의 층·지상여부·엘리베이터로 계산(자사와 같은 함수)
//   · 인구·유동      = **우리 매장 값을 그대로**(경쟁점 자리 자료가 없다)
//   · location.centrality = **우리 매장 값을 그대로**(같은 동네 근사)
//
// ⚠️ 근사 둘을 적어 둔다:
//   (가) 수요(인구·유동)를 우리 매장 값으로 썼다 — 같은 동네지만 수백 m 차이가 있다
//   (나) 중심도를 우리 매장 값으로 썼다 — 접근성만 경쟁점 것을 쓴다
//   그래서 **같은 동네 안 짝 비교**가 제일 깨끗하다(두 근사가 약분된다).
//
// ⚠️ 측정만 한다. 계수를 고치지 않는다. 운영 V62는 안 건드린다.
//
// 실행: npx vitest run src/lib/storeEval/_rivalAsSubjectFull.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, rivalQualityParts } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeLocationScoreFromFacts } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  type TextbookInput, type TextbookParams,
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
const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

describeIf("경쟁점을 주인공으로 — 본 산식", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;
  const pcOf = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;

  /** 한 동네 — 우리 매장의 TextbookInput과, 좌표·대수가 있는 경쟁점들 */
  type Hood = {
    code: string; storeName: string; ourInput: TextbookInput;
    ourLat: number; ourLng: number;
    comps: { c: Competitor; lat: number; lng: number; pc: number }[];
  };
  const hoods: Hood[] = [];
  for (const r of base) {
    const st = storeByCode.get(r.input.storeCode);
    if (!st?.lat || !st?.lng || !(r.input.pcCount ?? 0)) continue;
    const comps: Hood["comps"] = [];
    for (const c of compsByCode.get(r.input.storeCode) ?? []) {
      if (c.investigationStatus === "경쟁점없음") continue;
      const pc = pcOf(c);
      if (c.lat == null || c.lng == null || !(pc && pc > 0)) continue;
      comps.push({ c, lat: c.lat, lng: c.lng, pc });
    }
    if (!comps.length) continue;
    hoods.push({
      code: r.input.storeCode, storeName: r.input.storeName ?? r.input.storeCode,
      ourInput: r.input, ourLat: st.lat, ourLng: st.lng, comps,
    });
  }

  /**
   * 경쟁점 하나를 주인공으로 한 TextbookInput.
   * **우리 매장 입력을 복사해서** 주인공만 갈아끼운다 — 수요 필드가 통째로 따라온다.
   */
  const asSubject = (h: Hood, k: number): TextbookInput => {
    const me = h.comps[k];
    const rivals: NonNullable<TextbookInput["rivals"]> = [
      {
        ip: h.ourInput.pcCount as number,
        distanceM: distM(me.lat, me.lng, h.ourLat, h.ourLng),
        parts: h.ourInput.ownQualityParts,
        name: h.ourInput.storeName,
      },
      ...h.comps.filter((_, j) => j !== k).map((o) => ({
        ip: o.pc,
        distanceM: distM(me.lat, me.lng, o.lat, o.lng),
        parts: rivalQualityParts(o.c, settings),
        name: o.c.name ?? null,
      })),
    ];
    return {
      ...h.ourInput,
      storeCode: `riv:${me.c.id}`,
      storeName: me.c.name ?? "(이름없음)",
      pcCount: me.pc,
      hourlyRate: me.c.hourlyRateConverted ?? h.ourInput.hourlyRate,
      actualUtilization: null,
      ownQualityParts: rivalQualityParts(me.c, settings),
      rivals,
      competitorIp: rivals.reduce((a, x) => a + x.ip, 0),
      competitorCount: rivals.length,
      location: h.ourInput.location
        ? {
          // 중심도는 동네 값을 그대로 쓴다(경쟁점 자리 유동 자료가 없다)
          centrality: h.ourInput.location.centrality,
          // 접근성만 **그 경쟁점 것**을 쓴다 — 자사와 같은 함수다
          access: computeLocationScoreFromFacts(me.c.floor ?? null, me.c.groundLevel ?? null, me.c.hasElevator ?? null),
          direction: null, flowBlock: null, visibility: null,
        }
        : null,
    };
  };
  /** 우리 매장을 주인공으로 — 본 산식 그대로(입력을 안 건드린다) */
  const ourInputOf = (h: Hood) => h.ourInput;

  type Obs = { hood: string; name: string; isOurs: boolean; act: number; pred: number };
  const collect = (p: TextbookParams) => {
    const out: Obs[] = [];
    for (const h of hoods) {
      const a = h.ourInput.actualUtilization;
      if (a != null && a > 0) {
        const u = computeTextbook(ourInputOf(h), p).utilization;
        if (u != null && u > 0) out.push({ hood: h.storeName, name: h.storeName, isOurs: true, act: a, pred: u });
      }
      h.comps.forEach((cm, k) => {
        const pv = ping(cm.c);
        if (pv == null || !(pv > 0)) return;
        const u = computeTextbook(asSubject(h, k), p).utilization;
        if (u != null && u > 0) out.push({ hood: h.storeName, name: cm.c.name ?? "?", isOurs: false, act: pv / 100, pred: u });
      });
    }
    return out;
  };

  it("(1) ⭐⭐ 본 산식으로 — 자사(안쪽) vs 경쟁점(바깥)", () => {
    const obs = collect(P);
    const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
    console.log(`\n[본 산식] 동네 ${hoods.length}곳 · 실측 있는 선수 **${obs.length}명**`
      + ` (자사 ${ours.length} + 경쟁점 ${riv.length})`);
    console.log(`  ⚠️ 간이판과 달리 **입지배율·눈금보정이 다 들어간 computeTextbook**을 그대로 썼다.`);
    const sc = (g: Obs[], label: string) => {
      if (g.length < 3) return;
      const a = g.map((o) => o.act), p = g.map((o) => o.pred);
      const abs = p.map((v, i) => Math.abs(v - a[i]));
      const loo = a.map((_, i) => mean(a.filter((__, j) => j !== i)));
      console.log(`  ${label.padEnd(12)}n=${String(g.length).padStart(3)}`
        + `  MAE ${(mean(abs) * 100).toFixed(2).padStart(5)}%p`
        + `  바닥 ${(mean(loo.map((v, i) => Math.abs(v - a[i]))) * 100).toFixed(2)}%p`
        + `  편향 ${(mean(p.map((v, i) => v - a[i])) * 100).toFixed(1).padStart(5)}%p`
        + `  퍼짐 ${(sdOf(p.map(Math.log)) / sdOf(a.map(Math.log))).toFixed(2)}배`
        + `  분별력 r ${corr(p.map(Math.log), a.map(Math.log)).toFixed(3)}`);
    };
    sc(ours, "자사(안쪽)");
    sc(riv, "경쟁점(바깥)");
    sc(obs, "합쳐서");
    console.log(`\n  실측 중앙 — 자사 ${(med(ours.map((o) => o.act)) * 100).toFixed(1)}%`
      + ` · 경쟁점 ${(med(riv.map((o) => o.act)) * 100).toFixed(1)}%`);
    console.log(`  예측 중앙 — 자사 ${(med(ours.map((o) => o.pred)) * 100).toFixed(1)}%`
      + ` · 경쟁점 ${(med(riv.map((o) => o.pred)) * 100).toFixed(1)}%`);
    expect(obs.length).toBeGreaterThan(40);
  });

  it("(2) ⭐⭐⭐ θ 재고 표 — 본 산식 · 세 잣대", () => {
    const scoreAt = (th: number) => {
      const p2 = { ...P, qualityExponent: th };
      const obs = collect(p2);
      const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
      const byHood = new Map<string, Obs[]>();
      for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
      let pairs = 0, hit = 0;
      const gO: number[] = [], gP: number[] = [];
      const relO: number[] = [], relP: number[] = [];
      for (const g of byHood.values()) {
        for (let x = 0; x < g.length; x++) {
          for (let y = x + 1; y < g.length; y++) {
            pairs += 1;
            const ao = g[x].act / g[y].act, ap = g[x].pred / g[y].pred;
            if (Math.sign(ao - 1) === Math.sign(ap - 1)) hit += 1;
            gO.push(Math.log(ao)); gP.push(Math.log(ap));
          }
        }
        const o = g.find((z) => z.isOurs), rs = g.filter((z) => !z.isOurs);
        if (o && rs.length) {
          relO.push(Math.log(o.act / mean(rs.map((z) => z.act))));
          relP.push(Math.log(o.pred / mean(rs.map((z) => z.pred))));
        }
      }
      const mae = (g: Obs[]) => mean(g.map((x) => Math.abs(x.pred - x.act)));
      const rOf = (g: Obs[]) => corr(g.map((x) => Math.log(x.pred)), g.map((x) => Math.log(x.act)));
      return {
        ourMae: mae(ours), ourR: rOf(ours),
        ourSpread: sdOf(ours.map((x) => Math.log(x.pred))) / sdOf(ours.map((x) => Math.log(x.act))),
        rivMae: mae(riv), rivR: rOf(riv), rivBias: mean(riv.map((x) => x.pred - x.act)),
        pairHit: pairs ? hit / pairs : NaN, pairR: corr(gP, gO),
        pairSpread: sdOf(gO) > 0 ? sdOf(gP) / sdOf(gO) : NaN,
        gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
      };
    };
    console.log(`\n[θ 재고 표 — 본 산식] 자사=안쪽 · 경쟁점=바깥 · 짝=제일 깨끗`);
    console.log(`  θ    자사MAE 자사r 자사퍼짐 | 경쟁MAE 경쟁r 경쟁편향 | 짝적중 짝r 짝과장 | 자사우위 실측/예측`);
    for (const th of [3, 2.5, 2, 1.5, 1, 0.5]) {
      const s = scoreAt(th);
      console.log(`  ${th.toFixed(1).padStart(3)}`
        + `${(s.ourMae * 100).toFixed(2).padStart(8)}%p${s.ourR.toFixed(3).padStart(7)}${s.ourSpread.toFixed(2).padStart(7)}배 |`
        + `${(s.rivMae * 100).toFixed(1).padStart(7)}%p${s.rivR.toFixed(3).padStart(7)}${(s.rivBias * 100).toFixed(1).padStart(7)}%p |`
        + `${(s.pairHit * 100).toFixed(0).padStart(6)}%${s.pairR.toFixed(3).padStart(7)}${s.pairSpread.toFixed(2).padStart(6)}배 |`
        + `${s.gapObs.toFixed(2).padStart(9)}/${s.gapPred.toFixed(2)}배`
        + (th === 3 ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐⭐ 읽는 법`);
    console.log(`     · **짝 과장 1.00 · 자사우위 실측≈예측**이 되는 θ가 바깥 자료가 가리키는 값이다`);
    console.log(`     · 자사 MAE·r만 보면 θ=3이 이긴다 — 그 표본으로 맞춘 값이라 그렇다(과적합)`);
    console.log(`     · 짝 적중률이 θ에 안 변하면 **뼈대는 멀쩡하고 눈금만 문제**라는 뜻이다`);
    console.log(`  ⚠️ 근사 둘: 수요·중심도를 우리 매장 값으로 썼다. 짝 비교에서는 약분된다.`);
    console.log(`  ⛔ 값을 고르지 않는다.`);
    expect(hoods.length).toBeGreaterThan(20);
  });

  it("(4) ⭐⭐⭐ θ가 아니라 **자사 품질**이 후한 건 아닌가", () => {
    // (2)에서 갈라진다:
    //   짝 과장(경쟁점끼리 + 자사-경쟁점 섞임)  1.66배
    //   자사우위 과장(자사-경쟁점만)           3.50 ÷ 1.49 = **2.35배**
    // **자사가 낀 격차가 더 크게 부푼다.** θ라면 둘이 같이 부풀어야 한다 —
    // 그러니 이건 θ가 아니라 **자사 품질 점수가 경쟁점 대비 후하다**는 쪽이다.
    // 사용자가 탕정역에서 *"우리 매장이 경쟁력 제일 떨어짐"*이라 한 것과 맞는다.
    //
    // 자사 품질에 상수 m을 곱해(자사를 낮춰) 어디서 격차가 맞는지 본다.
    // ⛔ 값을 고르지 않는다. 재고 표만.
    const scaleOwn = (q: TextbookInput["ownQualityParts"], m: number) => (q ? {
      spec: q.spec == null ? null : q.spec * m,
      food: q.food == null ? null : q.food * m,
      zone: q.zone == null ? null : q.zone * m,
      interior: q.interior == null ? null : q.interior * m,
      management: q.management == null ? null : q.management * m,
    } : q);
    const runAt = (m: number) => {
      // 자사 품질만 m배 — 주인공일 때도, 경쟁점의 상대로 들어갈 때도 똑같이 적용한다
      const obs: Obs[] = [];
      for (const h of hoods) {
        const ourQ = scaleOwn(h.ourInput.ownQualityParts, m);
        const ourIn = { ...h.ourInput, ownQualityParts: ourQ };
        const a = h.ourInput.actualUtilization;
        if (a != null && a > 0) {
          const u = computeTextbook(ourIn, P).utilization;
          if (u != null && u > 0) obs.push({ hood: h.storeName, name: h.storeName, isOurs: true, act: a, pred: u });
        }
        h.comps.forEach((cm, k) => {
          const pv = ping(cm.c);
          if (pv == null || !(pv > 0)) return;
          const inp = asSubject(h, k);
          const rivals = (inp.rivals ?? []).map((rv) =>
            rv.name === h.ourInput.storeName ? { ...rv, parts: ourQ } : rv);
          const u = computeTextbook({ ...inp, rivals }, P).utilization;
          if (u != null && u > 0) obs.push({ hood: h.storeName, name: cm.c.name ?? "?", isOurs: false, act: pv / 100, pred: u });
        });
      }
      const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
      const byHood = new Map<string, Obs[]>();
      for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
      let pairs = 0, hit = 0;
      const gO: number[] = [], gP: number[] = [], relO: number[] = [], relP: number[] = [];
      for (const g of byHood.values()) {
        for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
          pairs += 1;
          const ao = g[x].act / g[y].act, ap = g[x].pred / g[y].pred;
          if (Math.sign(ao - 1) === Math.sign(ap - 1)) hit += 1;
          gO.push(Math.log(ao)); gP.push(Math.log(ap));
        }
        const o = g.find((z) => z.isOurs), rs = g.filter((z) => !z.isOurs);
        if (o && rs.length) {
          relO.push(Math.log(o.act / mean(rs.map((z) => z.act))));
          relP.push(Math.log(o.pred / mean(rs.map((z) => z.pred))));
        }
      }
      const mae = (g: Obs[]) => mean(g.map((x) => Math.abs(x.pred - x.act)));
      const rOf = (g: Obs[]) => corr(g.map((x) => Math.log(x.pred)), g.map((x) => Math.log(x.act)));
      return {
        ourMae: mae(ours), ourR: rOf(ours), ourBias: mean(ours.map((x) => x.pred - x.act)),
        rivMae: mae(riv), rivR: rOf(riv), rivBias: mean(riv.map((x) => x.pred - x.act)),
        pairHit: hit / pairs, pairR: corr(gP, gO), pairSpread: sdOf(gP) / sdOf(gO),
        gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
      };
    };
    console.log(`\n[자사 품질 배수 m] 자사 점수에 m을 곱한다(m<1이면 자사를 낮춘다)`);
    console.log(`  m     자사MAE 자사r 자사편향 | 경쟁MAE 경쟁r 경쟁편향 | 짝적중 짝r 짝과장 | 자사우위 실측/예측`);
    for (const m of [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
      const s = runAt(m);
      console.log(`  ${m.toFixed(2)}`
        + `${(s.ourMae * 100).toFixed(2).padStart(8)}%p${s.ourR.toFixed(3).padStart(7)}${(s.ourBias * 100).toFixed(1).padStart(7)}%p |`
        + `${(s.rivMae * 100).toFixed(1).padStart(7)}%p${s.rivR.toFixed(3).padStart(7)}${(s.rivBias * 100).toFixed(1).padStart(7)}%p |`
        + `${(s.pairHit * 100).toFixed(0).padStart(6)}%${s.pairR.toFixed(3).padStart(7)}${s.pairSpread.toFixed(2).padStart(6)}배 |`
        + `${s.gapObs.toFixed(2).padStart(9)}/${s.gapPred.toFixed(2)}배`
        + (m === 1 ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐ **자사우위 예측이 1.49에 닿는 m**이 바깥 자료가 가리키는 값이다.`);
    console.log(`     거기서 자사 성적(MAE·r)이 얼마나 상하는지가 치르는 값이다.`);
    console.log(`  ⚠️ m을 곱하는 건 **진단**이다 — 실제로는 어느 항목이 후한지 찾아서 고쳐야 한다.`);
    console.log(`     (사양 3.38/2.72 · 먹거리 4.00/2.53 · **존구성 3.21/1.31** · 인테리어 4.00/2.55 · 관리 4.20/2.59)`);
    console.log(`     비중 23.8%인 **존구성이 2.5배 차이**로 제일 크다 — 거기부터 볼 것.`);
    expect(hoods.length).toBeGreaterThan(20);
  });

  it("(5) ⭐⭐⭐ 둘을 **같이** 고친다 — 수요 배수 x 자사 품질 배수", () => {
    // (4)에서 갈렸다. 두 문제가 **독립**이다:
    //   (가) **수요가 약 2배 작다**(핑봇 실측) -> 경쟁점 예측이 −10.9%p로 과소
    //   (나) **자사 품질이 후하다** -> 자사우위 격차가 2.35배 과장
    // 하나만 고치면 다른 쪽이 무너진다:
    //   · 자사 품질만 낮추면 -> 자사 편향 −12%p (우리를 과소예측)
    //   · 수요만 키우면 -> 자사 편향 +  (우리를 과대예측)
    // **같이 움직이면 상쇄된다.** 그게 맞는 구조라면 두 편향이 동시에 0에 가까워져야 한다.
    //
    // ⚠️ 수요 배수는 `hoursPerUserPerMonth`에 곱해 **진단용**으로 만든다. 실제로는 그 값이
    //    원장 실측(8.20h)이라 못 건드린다 — 고칠 자리는 **이용자 수**(인구·유동·반경)다.
    //    여기서는 "수요를 n배로 하면 어떻게 되나"만 본다.
    // ⛔ 값을 고르지 않는다.
    const scaleOwn = (q: TextbookInput["ownQualityParts"], m: number) => (q ? {
      spec: q.spec == null ? null : q.spec * m,
      food: q.food == null ? null : q.food * m,
      zone: q.zone == null ? null : q.zone * m,
      interior: q.interior == null ? null : q.interior * m,
      management: q.management == null ? null : q.management * m,
    } : q);
    const runAt = (dm: number, m: number) => {
      const p2 = { ...P, hoursPerUserPerMonth: P.hoursPerUserPerMonth * dm };
      const obs: Obs[] = [];
      for (const h of hoods) {
        const ourQ = scaleOwn(h.ourInput.ownQualityParts, m);
        const a = h.ourInput.actualUtilization;
        if (a != null && a > 0) {
          const u = computeTextbook({ ...h.ourInput, ownQualityParts: ourQ }, p2).utilization;
          if (u != null && u > 0) obs.push({ hood: h.storeName, name: h.storeName, isOurs: true, act: a, pred: u });
        }
        h.comps.forEach((cm, k) => {
          const pv = ping(cm.c);
          if (pv == null || !(pv > 0)) return;
          const inp = asSubject(h, k);
          const rivals = (inp.rivals ?? []).map((rv) =>
            rv.name === h.ourInput.storeName ? { ...rv, parts: ourQ } : rv);
          const u = computeTextbook({ ...inp, rivals }, p2).utilization;
          if (u != null && u > 0) obs.push({ hood: h.storeName, name: cm.c.name ?? "?", isOurs: false, act: pv / 100, pred: u });
        });
      }
      const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
      const byHood = new Map<string, Obs[]>();
      for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
      const relO: number[] = [], relP: number[] = [];
      let pairs = 0, hit = 0;
      const gO: number[] = [], gP: number[] = [];
      for (const g of byHood.values()) {
        for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
          pairs += 1;
          const ao = g[x].act / g[y].act, ap = g[x].pred / g[y].pred;
          if (Math.sign(ao - 1) === Math.sign(ap - 1)) hit += 1;
          gO.push(Math.log(ao)); gP.push(Math.log(ap));
        }
        const o = g.find((z) => z.isOurs), rs = g.filter((z) => !z.isOurs);
        if (o && rs.length) {
          relO.push(Math.log(o.act / mean(rs.map((z) => z.act))));
          relP.push(Math.log(o.pred / mean(rs.map((z) => z.pred))));
        }
      }
      return {
        ourBias: mean(ours.map((x) => x.pred - x.act)), ourMae: mean(ours.map((x) => Math.abs(x.pred - x.act))),
        ourR: corr(ours.map((x) => Math.log(x.pred)), ours.map((x) => Math.log(x.act))),
        rivBias: mean(riv.map((x) => x.pred - x.act)), rivMae: mean(riv.map((x) => Math.abs(x.pred - x.act))),
        gapPred: Math.exp(med(relP)), gapObs: Math.exp(med(relO)),
        pairHit: hit / pairs, pairSpread: sdOf(gP) / sdOf(gO),
      };
    };
    console.log(`\n[둘을 같이] 칸 = **자사편향 / 경쟁편향 (%p)** — 둘 다 0에 가까운 칸을 찾는다`);
    const MS = [1.0, 0.9, 0.8, 0.7];
    console.log(`  수요배수 ${MS.map((m) => `자사품질x${m.toFixed(1)}`.padStart(16)).join("")}`);
    for (const dm of [1.0, 1.5, 2.0, 2.5]) {
      let line = `  x${dm.toFixed(1)}   `;
      for (const m of MS) {
        const s = runAt(dm, m);
        line += `${`${(s.ourBias * 100).toFixed(1)}/${(s.rivBias * 100).toFixed(1)}`.padStart(16)}`;
      }
      console.log(line + (dm === 1 ? "   ← 지금 줄(자사품질x1.0이 지금 칸)" : ""));
    }
    console.log(`\n  [편향 둘 다 ±3%p 안인 칸] 자세히`);
    console.log(`  수요 자사품질  자사MAE 자사r | 경쟁MAE | 짝적중 짝과장 | 자사우위 실측/예측`);
    let found = 0;
    for (const dm of [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5]) {
      for (const m of [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
        const s = runAt(dm, m);
        if (Math.abs(s.ourBias) > 0.03 || Math.abs(s.rivBias) > 0.03) continue;
        found += 1;
        console.log(`  x${dm.toFixed(2)}   ${m.toFixed(2)}`
          + `${(s.ourMae * 100).toFixed(2).padStart(9)}%p${s.ourR.toFixed(3).padStart(7)} |`
          + `${(s.rivMae * 100).toFixed(1).padStart(7)}%p |`
          + `${(s.pairHit * 100).toFixed(0).padStart(6)}%${s.pairSpread.toFixed(2).padStart(7)}배 |`
          + `${s.gapObs.toFixed(2).padStart(9)}/${s.gapPred.toFixed(2)}배`);
      }
    }
    if (!found) console.log(`  (그런 칸이 없다 — 두 편향을 동시에 0으로 못 만든다)`);
    const now = runAt(1, 1);
    console.log(`\n  지금 칸: 자사편향 ${(now.ourBias * 100).toFixed(1)}%p · 경쟁편향 ${(now.rivBias * 100).toFixed(1)}%p`
      + ` · 자사MAE ${(now.ourMae * 100).toFixed(2)}%p · 자사우위 ${now.gapObs.toFixed(2)}/${now.gapPred.toFixed(2)}배`);
    console.log(`\n  ⭐⭐ 두 편향이 동시에 0 근처인 칸이 있으면 **구조가 그쪽**이라는 강한 증거다.`);
    console.log(`     지금 칸은 경쟁편향이 −10.9%p라 한쪽 눈을 감고 있는 상태다.`);
    console.log(`  ⚠️ 수요 배수는 진단용이다. 실제로는 **이용자 수**(인구·유동·반경)를 고쳐야 한다.`);
    expect(hoods.length).toBeGreaterThan(20);
  });

  it("(6) ⭐⭐⭐ 품질 **항목별로** 바깥 표본이 검증한다 — 어느 항목이 진짜 일하나", () => {
    // 사용자(2026-09-23): *"매장별 편차가 커서 평균값으로 보기 어렵다. 요즘 팀룸 같은 룸
    //   형태의 시설들이 최근 3년 정도에 많이 확산되었는데 기존 PC방은 없는 거니까 이게
    //   있고 없고의 편차가 큰 상황이나, 최근 매장이 아니면 룸 형태는 많이 없어서."*
    //
    // -> 존구성은 **평균으로 볼 값이 아니라 "룸이 있냐 없냐"의 이분법**에 가깝고,
    //    **개점 시기**와 얽혀 있다. 그러면 두 가지가 갈린다:
    //      (가) 룸이 진짜로 손님을 더 끈다     -> 항목이 맞다. 세기만 보면 된다
    //      (나) 그냥 "최근 매장"의 표시일 뿐이다 -> 경쟁력이 아니라 **코호트**를 재고 있다
    //
    // ⭐ 이건 **바깥 표본으로 직접 가를 수 있다.** 경쟁점 47곳에 핑봇 실측이 있으니,
    //    "존구성이 높은 경쟁점이 실제로 잘 도나"를 재면 된다.
    //    ⚠️ 경쟁점끼리 견주면 자사 편향이 안 낀다 — 이게 이 시험의 값어치다.
    type Row = { name: string; util: number; parts: ReturnType<typeof rivalQualityParts>; pc: number };
    const rs: Row[] = [];
    for (const h of hoods) {
      for (const cm of h.comps) {
        const pv = ping(cm.c);
        if (pv == null || !(pv > 0)) continue;
        rs.push({ name: cm.c.name ?? "?", util: pv / 100, parts: rivalQualityParts(cm.c, settings), pc: cm.pc });
      }
    }
    const KEYS = ["spec", "food", "zone", "interior", "management"] as const;
    const KO: Record<typeof KEYS[number], string> = {
      spec: "사양", food: "먹거리", zone: "존구성", interior: "인테리어", management: "관리",
    };
    console.log(`\n[항목별 — 경쟁점 ${rs.length}곳 · 핑봇 실측으로 검증]`);
    console.log(`  ⚠️ 경쟁점끼리만 견준다 — 자사 편향이 안 낀다`);
    console.log(`\n  항목      비중    있는곳  평균   SD    범위        **핑봇 가동률과 r**`);
    for (const k of KEYS) {
      const vs = rs.map((r) => r.parts[k]).filter((v): v is number => v != null && Number.isFinite(v));
      const pr = rs.map((r) => [r.parts[k], r.util] as const)
        .filter((q): q is readonly [number, number] => q[0] != null && Number.isFinite(q[0]));
      if (pr.length < 8) { console.log(`  ${KO[k].padEnd(9)}(표본 부족 ${pr.length}곳)`); continue; }
      const rr = corr(pr.map((q) => q[0]), pr.map((q) => q[1]));
      const w = P.qualityWeights[k] ?? 0;
      console.log(`  ${KO[k].padEnd(8)}${(w * 100).toFixed(1).padStart(5)}%${String(vs.length).padStart(7)}`
        + `${mean(vs).toFixed(2).padStart(7)}${sdOf(vs).toFixed(2).padStart(6)}`
        + `  ${Math.min(...vs).toFixed(1)}~${Math.max(...vs).toFixed(1)}`.padEnd(13)
        + `${rr.toFixed(3).padStart(12)}`
        + (Math.abs(rr) >= 0.29 ? "  ⭐ 유의" : ""));
    }
    console.log(`  (n=${rs.length}에서 유의선은 대략 ±0.29)`);

    // 존구성의 이분법성 — 사용자 설명대로면 낮은 쪽에 몰려 있어야 한다
    const zs = rs.map((r) => r.parts.zone).filter((v): v is number => v != null).sort((a, b) => a - b);
    if (zs.length) {
      const lo = zs.filter((v) => v <= 1.2).length;
      console.log(`\n  [존구성 분포] 1.2 이하가 ${lo}/${zs.length}곳 (${(lo / zs.length * 100).toFixed(0)}%)`
        + ` — 사용자 설명대로면 "룸 없는 곳"이 여기 몰린다`);
      const hi = rs.filter((r) => (r.parts.zone ?? 0) > 1.2);
      const loR = rs.filter((r) => (r.parts.zone ?? 9) <= 1.2);
      if (hi.length >= 5 && loR.length >= 5) {
        console.log(`  룸 있는 쪽(>1.2) ${hi.length}곳 가동률 평균 ${(mean(hi.map((r) => r.util)) * 100).toFixed(1)}%`
          + ` vs 룸 없는 쪽 ${loR.length}곳 ${(mean(loR.map((r) => r.util)) * 100).toFixed(1)}%`);
        const d = mean(hi.map((r) => r.util)) - mean(loR.map((r) => r.util));
        const se = Math.sqrt(sdOf(hi.map((r) => r.util)) ** 2 / hi.length + sdOf(loR.map((r) => r.util)) ** 2 / loR.length);
        console.log(`  차이 ${(d * 100).toFixed(1)}%p · 2SE ${(2 * se * 100).toFixed(1)}%p`
          + ` -> ${Math.abs(d) > 2 * se ? "✅ **룸이 있으면 실제로 잘 돈다**" : "⚠️ 자료가 차이를 못 본다"}`);
      }
    }

    // 비중을 0으로 만들어 보며 바깥 성적이 어떻게 되나 — 항목을 끄는 시험
    console.log(`\n  [항목을 끄면 바깥(경쟁점) 성적이 어떻게 되나]`);
    console.log(`  끈 항목        경쟁MAE  경쟁r  | 짝적중  짝r  짝과장 | 자사우위 실측/예측`);
    const runWithout = (drop: typeof KEYS[number] | null) => {
      const w = { ...P.qualityWeights };
      if (drop) w[drop] = 0;
      const p2 = { ...P, qualityWeights: w };
      const obs = collect(p2);
      const riv = obs.filter((o) => !o.isOurs);
      const byHood = new Map<string, Obs[]>();
      for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
      let pairs = 0, hit = 0;
      const gO: number[] = [], gP: number[] = [], relO: number[] = [], relP: number[] = [];
      for (const g of byHood.values()) {
        for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
          pairs += 1;
          const ao = g[x].act / g[y].act, ap = g[x].pred / g[y].pred;
          if (Math.sign(ao - 1) === Math.sign(ap - 1)) hit += 1;
          gO.push(Math.log(ao)); gP.push(Math.log(ap));
        }
        const o = g.find((z) => z.isOurs), rr2 = g.filter((z) => !z.isOurs);
        if (o && rr2.length) {
          relO.push(Math.log(o.act / mean(rr2.map((z) => z.act))));
          relP.push(Math.log(o.pred / mean(rr2.map((z) => z.pred))));
        }
      }
      return {
        rivMae: mean(riv.map((x) => Math.abs(x.pred - x.act))),
        rivR: corr(riv.map((x) => Math.log(x.pred)), riv.map((x) => Math.log(x.act))),
        pairHit: hit / pairs, pairR: corr(gP, gO), pairSpread: sdOf(gP) / sdOf(gO),
        gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
      };
    };
    for (const k of [null, ...KEYS] as const) {
      const s = runWithout(k);
      console.log(`  ${(k ? KO[k] : "안 끔(지금)").padEnd(13)}`
        + `${(s.rivMae * 100).toFixed(1).padStart(7)}%p${s.rivR.toFixed(3).padStart(7)} |`
        + `${(s.pairHit * 100).toFixed(0).padStart(6)}%${s.pairR.toFixed(3).padStart(7)}${s.pairSpread.toFixed(2).padStart(7)}배 |`
        + `${s.gapObs.toFixed(2).padStart(9)}/${s.gapPred.toFixed(2)}배`
        + (k === null ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐⭐ 읽는 법`);
    console.log(`     · 껐더니 **짝 r이 오르고 짝 과장이 1에 가까워지면** 그 항목이 잡음이다`);
    console.log(`     · 껐더니 나빠지면 그 항목은 **진짜 일을 하고 있다**`);
    console.log(`     · 존구성이 핑봇과 유의하게 상관이면 -> 룸은 진짜 경쟁력이다(코호트 대리변수가 아니다)`);
    console.log(`  ⚠️ 경쟁점 품질은 조사 시점(가맹점 오픈 당시) 기준이고 핑봇은 2026-08이다.`);
    console.log(`     그 사이 리뉴얼한 경쟁점은 점수가 낡았다 — 상관을 약하게 만드는 쪽이다.`);
    expect(rs.length).toBeGreaterThan(20);
  });

  it("(3) 자사 성적이 본 산식과 맞는지 — 검산", () => {
    // 간이판에서는 자사 MAE가 8.0%p였다(본 산식 5.85%p). 여기서는 본 산식을 그대로 썼으니
    // **자사 성적이 평소 값과 같아야 한다.** 다르면 내가 입력을 잘못 만든 것이다.
    const obs = collect(P).filter((o) => o.isOurs);
    const a = obs.map((o) => o.act), p = obs.map((o) => o.pred);
    const mae = mean(p.map((v, i) => Math.abs(v - a[i])));
    console.log(`\n[검산] 자사 ${obs.length}곳 MAE = **${(mae * 100).toFixed(2)}%p**`);
    console.log(`  평소 실험실 값은 5.85%p(40곳)다. 여기는 좌표·대수 있는 경쟁점이 하나라도`);
    console.log(`  있는 동네만 세므로 매장 수가 조금 적다 — 그 차이만큼만 달라야 한다.`);
    console.log(`  ${Math.abs(mae - 0.0585) < 0.01 ? "✅ 맞는다 — 입력을 제대로 만들었다"
      : "⚠️ 많이 다르다 — 입력 조립을 다시 볼 것"}`);
    expect(obs.length).toBeGreaterThan(20);
  });
});
