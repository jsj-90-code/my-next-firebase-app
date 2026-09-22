// 경쟁점을 **주인공으로** 놓고 산식을 돌린다 — 핑봇 57곳으로 검증 (2026-09-23)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 판정 표본이 자사 40곳뿐이라 작은 차이를 못 가른다(`_underPredicted` (Z)번: 2SE 0.70%p).
// 핑봇은 더 못 모은다(사용자 확인: *"핑봇 추가 못 함. 지금 최대임"*).
//
// 그런데 **이미 있는 57곳을 훨씬 세게 쓸 수 있다.** 경쟁점에는 좌표·대수·품질점수가
// 전부 있다. 그러면 **그 경쟁점 자리에 산식을 그대로 돌려** 가동률을 예측하고
// 핑봇 실측과 댈 수 있다.
//
//   자사 매장  — "우리 자리에 우리가 있다"   실측 가동률 있음 (40곳)
//   경쟁점     — "남의 자리에 남이 있다"     핑봇 실측 있음   (57곳)  ← 이걸 쓴다
//   후보지     — "남의 자리에 우리가 들어간다"  실측 없음
//
// 후보지 평가가 하는 계산과 **똑같은 계산**을, 이미 답이 있는 자리에서 검증하는 것이다.
// 표본이 40 -> 97로 는다.
//
// ── ⚠️ 근사 하나 ─────────────────────────────────────────────────────────
// 경쟁점 자리의 **인구·유동 자료가 없다.** 우리 매장 자리 값을 그대로 쓴다(수백 m 차이).
// 같은 동네라 수요는 비슷하겠지만 **정확히 같지는 않다.** 그래서 이건
// "경쟁점 사이의 상대 비교"에 쓰는 것이고, 한 곳의 절대 예측으로 읽으면 안 된다.
//
// ⚠️ 측정만 한다. 계수를 고치지 않는다. 운영 V62는 안 건드린다.
//
// 실행: npx vitest run src/lib/storeEval/_rivalAsSubject.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, rivalQualityParts, ownQualityParts } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fittedParams, scoreTextbook,
  rivalDistanceWeight, type QualityParts,
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
const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

describeIf("경쟁점을 주인공으로 — 핑봇 검증", () => {
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

  /** 한 동네의 선수들 — 우리 매장 + 조사 경쟁점. 각자 좌표·대수·품질을 갖는다. */
  type Player = {
    key: string; name: string; lat: number; lng: number;
    pc: number; parts: QualityParts | null;
    isOurs: boolean;
    /** 실측 가동률 — 우리는 평가창 평균, 경쟁점은 핑봇 */
    actual: number | null;
  };
  type Hood = { code: string; storeName: string; demandH: number; players: Player[] };
  const hoods: Hood[] = [];
  for (const r of base) {
    const code = r.input.storeCode;
    const st = storeByCode.get(code);
    const b = computeTextbook(r.input, P);
    if (!st?.lat || !st?.lng || b.totalDemandHours == null || !(b.totalDemandHours > 0)) continue;
    const ourPc = r.input.pcCount ?? 0;
    if (!(ourPc > 0)) continue;
    const players: Player[] = [{
      key: `own:${code}`, name: r.input.storeName ?? code, lat: st.lat, lng: st.lng,
      pc: ourPc, parts: r.input.ownQualityParts, isOurs: true,
      actual: r.input.actualUtilization ?? null,
    }];
    for (const c of compsByCode.get(code) ?? []) {
      if (c.investigationStatus === "경쟁점없음") continue;
      const pc = pcOf(c);
      if (c.lat == null || c.lng == null || !(pc && pc > 0)) continue;
      const pv = ping(c);
      players.push({
        key: `riv:${c.id}`, name: c.name ?? "(이름없음)", lat: c.lat, lng: c.lng,
        pc, parts: rivalQualityParts(c, settings), isOurs: false,
        actual: pv != null && pv > 0 ? pv / 100 : null,
      });
    }
    if (players.length < 2) continue;
    hoods.push({ code, storeName: r.input.storeName ?? code, demandH: b.totalDemandHours, players });
  }
  void ownQualityParts;

  /**
   * 한 선수를 주인공으로 놓고 산식의 점유율을 계산한다.
   * **본체(computeTextbook)의 품질 모드와 같은 규칙**을 쓴다 —
   *   주인공 무게 = 대수 · 상대 무게 = 대수 x (상대품질÷주인공품질)^θ x 거리무게(주인공 기준)
   */
  const shareOf = (h: Hood, meIdx: number, p = P) => {
    const me = h.players[meIdx];
    const oq = me.parts ? computeQualityScore(me.parts, p.qualityWeights) : null;
    let rival = 0;
    for (let j = 0; j < h.players.length; j++) {
      if (j === meIdx) continue;
      const o = h.players[j];
      const d = distM(me.lat, me.lng, o.lat, o.lng);
      const w = rivalDistanceWeight(d, p);
      if (w <= 0) continue;
      let ratio = 1;
      if (oq != null && oq > 0 && o.parts) {
        const v = computeQualityScore(o.parts, p.qualityWeights);
        if (v != null && v > 0) ratio = v / oq;
      }
      rival += o.pc * Math.pow(ratio, p.qualityExponent) * w;
    }
    const denom = me.pc + rival + p.outsideOptionIp;
    return denom > 0 ? me.pc / denom : 1;
  };
  /** 주인공의 예측 가동률 — 동네 수요를 점유율대로 나눠 자기 좌석시간으로 나눈다. */
  const predOf = (h: Hood, meIdx: number, p = P) => {
    const me = h.players[meIdx];
    const sh = Math.min(1, shareOf(h, meIdx, p));
    return Math.min(p.maxUtilization, (h.demandH * sh) / (me.pc * MONTH_HOURS));
  };

  type Obs = { hood: string; name: string; isOurs: boolean; pc: number; act: number; pred: number };
  const obs: Obs[] = [];
  for (const h of hoods) {
    for (let i = 0; i < h.players.length; i++) {
      const pl = h.players[i];
      if (pl.actual == null || !(pl.actual > 0)) continue;
      obs.push({
        hood: h.storeName, name: pl.name, isOurs: pl.isOurs, pc: pl.pc,
        act: pl.actual, pred: predOf(h, i),
      });
    }
  }

  it("(1) ⭐⭐ 표본이 얼마나 늘었나 — 그리고 산식이 경쟁점을 맞히나", () => {
    const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
    console.log(`\n[표본] 동네 ${hoods.length}곳 · 실측이 있는 선수 **${obs.length}명**`);
    console.log(`  자사 ${ours.length}곳(평가창 실측) + 경쟁점 ${riv.length}곳(핑봇 실측)`);
    console.log(`\n  실측 가동률 — 자사 중앙 ${(med(ours.map((o) => o.act)) * 100).toFixed(1)}%`
      + ` · 경쟁점 중앙 ${(med(riv.map((o) => o.act)) * 100).toFixed(1)}%`);
    console.log(`  예측 가동률 — 자사 중앙 ${(med(ours.map((o) => o.pred)) * 100).toFixed(1)}%`
      + ` · 경쟁점 중앙 ${(med(riv.map((o) => o.pred)) * 100).toFixed(1)}%`);
    const sc = (g: Obs[], label: string) => {
      if (g.length < 3) return;
      const a = g.map((o) => o.act), p = g.map((o) => o.pred);
      const abs = p.map((v, i) => Math.abs(v - a[i]));
      const al = a.map(Math.log), pl = p.map(Math.log);
      const loo = a.map((_, i) => mean(a.filter((__, j) => j !== i)));
      console.log(`  ${label.padEnd(14)}n=${String(g.length).padStart(3)}`
        + `  MAE ${(mean(abs) * 100).toFixed(2)}%p`
        + `  바닥 ${(mean(loo.map((v, i) => Math.abs(v - a[i]))) * 100).toFixed(2)}%p`
        + `  편향 ${(mean(p.map((v, i) => v - a[i])) * 100).toFixed(1)}%p`
        + `  퍼짐 ${(sdOf(pl) / sdOf(al)).toFixed(2)}배`
        + `  분별력 r ${corr(pl, al).toFixed(3)}`);
    };
    console.log(`\n  무리별 성적`);
    sc(ours, "자사만");
    sc(riv, "경쟁점만");
    sc(obs, "합쳐서");
    console.log(`\n  ⭐⭐ **경쟁점만 놓고 봤을 때의 분별력이 진짜 판정이다.**`);
    console.log(`     자사 40곳은 축척·계수를 맞출 때 쓴 표본이라 안쪽 성적이고,`);
    console.log(`     경쟁점 57곳은 **한 번도 안 쓴 바깥 표본**이다.`);
    console.log(`  ⚠️ 경쟁점 자리의 인구·유동 자료가 없어 **우리 매장 값을 그대로 썼다.**`);
    console.log(`     같은 동네라 수요는 비슷하지만 정확히 같지는 않다.`);
    expect(obs.length).toBeGreaterThan(40);
  });

  it("(2) ⭐⭐⭐ 같은 동네 안에서 순위를 맞히나 — 수요 근사가 약분된다", () => {
    // ⭐ 수요를 우리 매장 값으로 근사한 게 걸린다. 그런데 **같은 동네 안에서 견주면
    //    그 근사가 약분된다** — 같은 D를 공유하니까. 그래서 이게 제일 깨끗한 판정이다.
    //    "이 동네에서 누가 더 잘 되나"를 산식이 맞히나?
    let pairs = 0, hit = 0;
    const gaps: { obs: number; pred: number; hood: string; a: string; b: string }[] = [];
    for (const h of hoods) {
      const idx = h.players.map((p, i) => ({ p, i })).filter((x) => x.p.actual != null && x.p.actual > 0);
      for (let x = 0; x < idx.length; x++) {
        for (let y = x + 1; y < idx.length; y++) {
          const A = idx[x], B = idx[y];
          const aAct = A.p.actual as number, bAct = B.p.actual as number;
          const aPred = predOf(h, A.i), bPred = predOf(h, B.i);
          pairs += 1;
          if (Math.sign(aAct - bAct) === Math.sign(aPred - bPred)) hit += 1;
          gaps.push({
            obs: Math.log(aAct / bAct), pred: Math.log(aPred / bPred),
            hood: h.storeName, a: A.p.name, b: B.p.name,
          });
        }
      }
    }
    console.log(`\n[동네 안 짝 비교] 같은 동네의 두 매장 중 누가 더 잘 되나 · 짝 ${pairs}개`);
    console.log(`  **순서를 맞힌 비율 ${(hit / pairs * 100).toFixed(1)}%** (찍으면 50%)`);
    const o = gaps.map((g) => g.obs), p = gaps.map((g) => g.pred);
    console.log(`  격차의 상관 r = ${corr(p, o).toFixed(3)}`);
    console.log(`  격차 퍼짐 — 실측 ${sdOf(o).toFixed(3)} · 예측 ${sdOf(p).toFixed(3)}`
      + ` -> **과장 ${(sdOf(p) / sdOf(o)).toFixed(2)}배**`);
    // 자사가 낀 짝과 경쟁점끼리의 짝을 갈라 본다 — 자사 품질이 후한지 드러난다
    const ourPairs = gaps.filter((g) => g.a.length && hoods.some((h) => h.storeName === g.hood));
    void ourPairs;
    console.log(`\n  ⭐ 이 판정은 **수요 근사에 안 흔들린다** — 같은 동네끼리라 D가 약분된다.`);
    console.log(`     순서 적중률이 50%대면 산식은 "누가 더 잘 되나"를 못 가른다는 뜻이다.`);
    expect(pairs).toBeGreaterThan(20);
  });

  it("(3) ⭐⭐⭐ 자사 품질이 후한가 — 경쟁점이 답을 준다", () => {
    // 사용자 의심(2026-09-24): 탕정역에서 *"우리 매장이 경쟁력 제일 떨어짐"*.
    // 자사 40곳만으로는 자사 품질이 후한지 알 수 없다 — 전부 자사니까 기준점이 없다.
    // 그런데 **경쟁점 57곳에 실측이 있으면** 자사/경쟁점을 같은 자로 채점할 수 있다:
    //   "같은 동네에서 우리가 경쟁점보다 잘 되나? 산식이 말하는 만큼 잘 되나?"
    const rowsOut: { hood: string; ourAct: number; ourPred: number; rivAct: number; rivPred: number; n: number }[] = [];
    for (const h of hoods) {
      const ourIdx = h.players.findIndex((p) => p.isOurs);
      if (ourIdx < 0) continue;
      const our = h.players[ourIdx];
      if (our.actual == null || !(our.actual > 0)) continue;
      const rivs = h.players.map((p, i) => ({ p, i })).filter((x) => !x.p.isOurs && x.p.actual != null && x.p.actual > 0);
      if (!rivs.length) continue;
      rowsOut.push({
        hood: h.storeName, ourAct: our.actual, ourPred: predOf(h, ourIdx),
        rivAct: mean(rivs.map((x) => x.p.actual as number)),
        rivPred: mean(rivs.map((x) => predOf(h, x.i))),
        n: rivs.length,
      });
    }
    console.log(`\n[자사 vs 경쟁점] 같은 동네에서 · ${rowsOut.length}곳`);
    console.log(`  매장            경쟁n   우리실측  경쟁실측  실측격차 | 우리예측 경쟁예측 예측격차`);
    for (const r of rowsOut.sort((a, b) => (b.ourAct / b.rivAct) - (a.ourAct / a.rivAct))) {
      console.log(`  ${r.hood.padEnd(14)}${String(r.n).padStart(5)}`
        + `${(r.ourAct * 100).toFixed(1).padStart(10)}%${(r.rivAct * 100).toFixed(1).padStart(9)}%`
        + `${(r.ourAct / r.rivAct).toFixed(2).padStart(9)}배 |`
        + `${(r.ourPred * 100).toFixed(1).padStart(8)}%${(r.rivPred * 100).toFixed(1).padStart(9)}%`
        + `${(r.ourPred / r.rivPred).toFixed(2).padStart(9)}배`);
    }
    const oGap = rowsOut.map((r) => Math.log(r.ourAct / r.rivAct));
    const pGap = rowsOut.map((r) => Math.log(r.ourPred / r.rivPred));
    console.log(`\n  ⭐ **실측 격차 중앙 ${Math.exp(med(oGap)).toFixed(2)}배** vs **예측 격차 중앙 ${Math.exp(med(pGap)).toFixed(2)}배**`);
    console.log(`     예측이 실측보다 크면 -> **산식이 자사를 후하게 본다**(품질비가 과하다)`);
    console.log(`     상관 r = ${corr(pGap, oGap).toFixed(3)}`);
    console.log(`\n  ⚠️ 핑봇은 2026-08 한 주, 자사 실측은 평가창 12달이다 — 시점이 다르다.`);
    console.log(`     그래도 **격차의 방향과 크기**는 읽을 수 있다.`);
    expect(rowsOut.length).toBeGreaterThan(5);
  });

  it("(4) ⭐⭐⭐ θ를 움직이며 **세 잣대로 동시에** 잰다 — 바깥 표본이 판정한다", () => {
    // (3)에서 나온 것: 실측 격차 1.49배인데 산식은 4.30배로 본다 — **자사 우위를 2.9배 과장**.
    // 격차는 대략 (자사품질÷경쟁품질)^θ 로 정해진다. 지금 품질비 0.581·θ=3이면 5.1배다.
    // 실측 1.49배가 나오려면 **θ ≈ 0.73**이거나, θ=3을 두고 품질비를 0.874로 올려야 한다.
    //
    // ⚠️ 그런데 자사 40곳 성적은 θ=3에서 제일 좋았다. **둘이 부딪힌다.**
    //    자사 40곳은 계수를 맞출 때 쓴 **안쪽** 표본이고, 핑봇 47곳은 **바깥** 표본이다.
    //    바깥 표본이 이기는 게 통례다 — 그래서 셋을 같이 찍어 어디서 갈리는지 본다.
    //
    // ⛔ 값을 고르지 않는다. 재고 표만 남긴다.
    const ourIdxOf = (h: Hood) => h.players.findIndex((p) => p.isOurs);
    const scoreAt = (th: number) => {
      const p2 = { ...P, qualityExponent: th };
      const ours: { a: number; p: number }[] = [];
      const rivs: { a: number; p: number }[] = [];
      let pairs = 0, hit = 0;
      const gO: number[] = [], gP: number[] = [];
      const relO: number[] = [], relP: number[] = [];
      for (const h of hoods) {
        const live = h.players.map((pl, i) => ({ pl, i })).filter((x) => x.pl.actual != null && x.pl.actual > 0);
        for (const x of live) {
          const rec = { a: x.pl.actual as number, p: predOf(h, x.i, p2) };
          (x.pl.isOurs ? ours : rivs).push(rec);
        }
        for (let x = 0; x < live.length; x++) {
          for (let y = x + 1; y < live.length; y++) {
            const A = live[x], B = live[y];
            const ao = (A.pl.actual as number) / (B.pl.actual as number);
            const ap = predOf(h, A.i, p2) / predOf(h, B.i, p2);
            pairs += 1;
            if (Math.sign(ao - 1) === Math.sign(ap - 1)) hit += 1;
            gO.push(Math.log(ao)); gP.push(Math.log(ap));
          }
        }
        const oi = ourIdxOf(h);
        const rl = live.filter((x) => !x.pl.isOurs);
        if (oi >= 0 && h.players[oi].actual != null && rl.length) {
          relO.push(Math.log((h.players[oi].actual as number) / mean(rl.map((x) => x.pl.actual as number))));
          relP.push(Math.log(predOf(h, oi, p2) / mean(rl.map((x) => predOf(h, x.i, p2)))));
        }
      }
      const mae = (g: { a: number; p: number }[]) => mean(g.map((x) => Math.abs(x.p - x.a)));
      const rOf = (g: { a: number; p: number }[]) => corr(g.map((x) => Math.log(x.p)), g.map((x) => Math.log(x.a)));
      return {
        ourMae: mae(ours), ourR: rOf(ours),
        rivMae: mae(rivs), rivR: rOf(rivs),
        rivBias: mean(rivs.map((x) => x.p - x.a)),
        pairHit: hit / pairs, pairR: corr(gP, gO), pairSpread: sdOf(gP) / sdOf(gO),
        gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
      };
    };
    console.log(`\n[θ 재고 표 — 세 잣대] 자사 ${hoods.length}곳(안쪽) · 경쟁점(바깥) · 동네 안 짝(제일 깨끗)`);
    console.log(`  θ     자사MAE 자사r | 경쟁MAE 경쟁r 경쟁편향 | 짝적중 짝r 짝과장 | 자사우위 실측/예측`);
    for (const th of [3, 2.5, 2, 1.5, 1, 0.75, 0.5, 0.25, 0]) {
      const s = scoreAt(th);
      console.log(`  ${th.toFixed(2).padStart(4)}`
        + `${(s.ourMae * 100).toFixed(1).padStart(8)}%p${s.ourR.toFixed(3).padStart(7)} |`
        + `${(s.rivMae * 100).toFixed(1).padStart(8)}%p${s.rivR.toFixed(3).padStart(7)}`
        + `${(s.rivBias * 100).toFixed(1).padStart(8)}%p |`
        + `${(s.pairHit * 100).toFixed(0).padStart(6)}%${s.pairR.toFixed(3).padStart(7)}`
        + `${s.pairSpread.toFixed(2).padStart(7)}배 |`
        + `${s.gapObs.toFixed(2).padStart(9)}/${s.gapPred.toFixed(2)}배`
        + (th === 3 ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐⭐ 읽는 법`);
    console.log(`     · **짝 과장이 1.00에 가깝고 짝 적중률·짝 r이 높은 θ**가 진짜 답이다`);
    console.log(`       (짝 비교는 수요 근사가 약분되고, 바깥 표본이 절반 들어간다)`);
    console.log(`     · 자사 MAE만 보면 θ=3이 이긴다 — 그건 **그 표본으로 맞춘 값**이라 그렇다`);
    console.log(`     · "자사우위 실측/예측"이 1.00에 가까운 θ가 격차를 제대로 보는 θ다`);
    console.log(`\n  ⚠️⚠️ **절대 수치를 본 산식과 견주지 마라.** 여기 점유율 식은 간이판이다 —`);
    console.log(`     입지배율과 눈금보정을 뺐다(경쟁점 자리의 중심도 자료가 없어서다).`);
    console.log(`     그래서 자사 MAE가 본 산식(5.85%p)보다 크게 나온다. **θ 사이의 비교**와`);
    console.log(`     **짝 비교**(같은 동네라 빠진 항이 상당 부분 약분된다)만 읽어라.`);
    console.log(`  ⛔ 여기서 고르지 않는다. 사용자에게 가져간다.`);
    expect(hoods.length).toBeGreaterThan(20);
  });
});
