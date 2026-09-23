// 존구성을 **점유율(품질) 항에서 빼고 수요 항으로 옮겨** 본다 (2026-09-23)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 사용자 기전(2026-09-23): *"PC방은 친구들과 함께 오는 곳이니까 팀룸이 수요가 있지.
//   팀룸 하러 왔다가 자리 없으면 일반석에 앉는다던가 그런 구조가 있다고 느껴짐."*
// -> 팀룸은 **유입 장치**다. 효과가 매장 전체 가동률로 나타난다.
//    그런데 지금 존구성은 점유율 식의 **품질비(자사÷경쟁)^θ** 안에 있다. 그 자리에서는
//      (가) 제로섬이다 — 우리 존이 좋으면 경쟁점 몫을 뺏는다. 유입이면 뺏는 게 아니라 새로 온다
//      (나) 비(比)만 작용한다 — 동네 전체가 룸이 없어도, 있어도 절대 수준은 안 바뀐다
//    유입이면 **절대 수준**이 작용하고 **제로섬이 아니어야** 한다. 구조가 다르다.
//
// ── 어떻게 ────────────────────────────────────────────────────────────────
// 산식 코드는 안 고친다. 주인공(자사 또는 경쟁점) 하나를 계산할 때
//   · qualityWeights.zone = 0  -> 존구성이 점유율에서 빠진다(자사·경쟁점 모두)
//   · hoursPerUserPerMonth x Z(주인공의 존)  -> 그 주인공의 수요시간이 Z배가 된다
// 가동률은 수요시간에 정비례하므로(눈금보정 꺼져 있음) 이게 정확히 "수요 배수"다.
//
// Z 모양 둘:
//   (ㄱ) 존구성 점수  Z = z^ζ           z는 1~5점. 미조사 경쟁점은 1.0 -> Z=1(중립)
//   (ㄴ) 팀룸 좌석비  Z = 1 + ζ·(큰룸좌석 ÷ PC)   기전에 제일 가까운 모양(팀룸만 센다)
//
// ── 잣대 셋 (규칙) ─────────────────────────────────────────────────────────
//   자사(안쪽) / 경쟁점 핑봇(바깥) / 동네 안 짝 — `_rivalAsSubjectFull.test.ts`와 같다.
//   2SE를 같이 적는다. 자사 40곳은 MAE 0.70%p 미만 차이를 못 가른다.
//
// ⛔ 측정만 한다. 계수를 고르지 않는다. 운영 V62는 안 건드린다.
// 실행: npx vitest run src/lib/storeEval/_zoneAsDemand.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, rivalQualityParts } from "./labInput";
import { residentRingsByCodeFromDocs } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { FIRST_CLASS_ZONE_SEATS, computeLocationScoreFromFacts } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeQualityScore, computeTextbook, fittedParams, scoreTextbook,
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
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%p`;

describeIf("존구성을 수요 항으로 — 세 잣대", () => {
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
    residentRingsByCode: residentRingsByCodeFromDocs(snap.labResidentRings ?? []),
    // 항아리 판정(2026-09-23 밤 채택) — 안 넘기면 useRingEnclosure가 켜져도 안 깎인다
    ringBlockedByCode: new Map(((snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null }[])
      .filter((j) => j.code && typeof j.ringCutCount === "number").map((j) => [String(j.code), j.ringCutCount as number])) });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;
  const pcOf = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;

  /** 큰룸(팀룸+퍼스트클래스) 좌석 — calc.ts convertedZoneSeats와 같은 환산(팀룸 5석·퍼스트 11석) */
  const bigRoomSeatsOf = (teamRoom: number | null | undefined, teamRoomTotalSeats: number | null | undefined,
    firstClass: number | null | undefined) =>
    (teamRoomTotalSeats ?? (teamRoom ?? 0) * 5) + (firstClass ?? 0) * FIRST_CLASS_ZONE_SEATS;

  /** 주인공 한 명 — 자사든 경쟁점이든 같은 칸으로 */
  type Subject = {
    hood: string; name: string; isOurs: boolean; act: number;
    input: TextbookInput;
    zone: number | null;        // 존구성 점수(1~5)
    bigRoomRatio: number;       // 큰룸 좌석 ÷ PC
    /** 경쟁점 조사 시점(경쟁점 문서 createdAt의 연도). 자사는 null. 핑봇은 2026-08 한 시점이다. */
    surveyYear: number | null;
    /** 우리 매장 오픈 연도 — 동네의 조사 시점 대리값 */
    openYear: number | null;
    /** 경쟁력점수 (존구성 포함, 지금 비중) — 시점 교란을 볼 때 쓴다 */
    quality: number | null;
  };
  const subjects: Subject[] = [];
  {
    type Hood = { code: string; storeName: string; ourInput: TextbookInput; ourLat: number; ourLng: number;
      comps: { c: Competitor; lat: number; lng: number; pc: number }[] };
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
      hoods.push({ code: r.input.storeCode, storeName: r.input.storeName ?? r.input.storeCode,
        ourInput: r.input, ourLat: st.lat, ourLng: st.lng, comps });
    }
    const yearOf = (v: unknown): number | null => {
      if (v == null) return null;
      const d = typeof v === "number" ? new Date(v) : new Date(String(v));
      const y = d.getFullYear();
      return Number.isFinite(y) && y > 2000 ? y : null;
    };
    for (const h of hoods) {
      const st = storeByCode.get(h.code)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = st as any;
      const openYear = yearOf(s.openedAt);
      const a = h.ourInput.actualUtilization;
      if (a != null && a > 0) {
        subjects.push({
          hood: h.storeName, name: h.storeName, isOurs: true, act: a, input: h.ourInput,
          zone: h.ourInput.ownQualityParts?.zone ?? null,
          bigRoomRatio: bigRoomSeatsOf(s.ownTeamRoom, s.ownTeamRoomTotalSeats, s.ownFirstClassZone) / (h.ourInput.pcCount as number),
          surveyYear: null, openYear,
          quality: h.ourInput.ownQualityParts ? computeQualityScore(h.ourInput.ownQualityParts, P.qualityWeights) : null,
        });
      }
      h.comps.forEach((me, k) => {
        const pv = ping(me.c);
        if (pv == null || !(pv > 0)) return;
        const rivals: NonNullable<TextbookInput["rivals"]> = [
          { ip: h.ourInput.pcCount as number, distanceM: distM(me.lat, me.lng, h.ourLat, h.ourLng),
            parts: h.ourInput.ownQualityParts, name: h.ourInput.storeName },
          ...h.comps.filter((_, j) => j !== k).map((o) => ({
            ip: o.pc, distanceM: distM(me.lat, me.lng, o.lat, o.lng), parts: rivalQualityParts(o.c, settings), name: o.c.name ?? null,
          })),
        ];
        const myParts = rivalQualityParts(me.c, settings);
        subjects.push({
          hood: h.storeName, name: me.c.name ?? "?", isOurs: false, act: pv / 100,
          zone: myParts.zone,
          bigRoomRatio: bigRoomSeatsOf(me.c.teamRoom, me.c.teamRoomTotalSeats, me.c.firstClassZone) / me.pc,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          surveyYear: yearOf((me.c as any).createdAt), openYear,
          quality: computeQualityScore(myParts, P.qualityWeights),
          input: {
            ...h.ourInput, storeCode: `riv:${me.c.id}`, storeName: me.c.name ?? "(이름없음)",
            pcCount: me.pc, hourlyRate: me.c.hourlyRateConverted ?? h.ourInput.hourlyRate,
            actualUtilization: null, ownQualityParts: myParts, rivals,
            competitorIp: rivals.reduce((s, x) => s + x.ip, 0), competitorCount: rivals.length,
            location: h.ourInput.location ? {
              centrality: h.ourInput.location.centrality,
              access: computeLocationScoreFromFacts(me.c.floor ?? null, me.c.groundLevel ?? null, me.c.hasElevator ?? null),
              direction: null, flowBlock: null, visibility: null,
            } : null,
          },
        });
      });
    }
  }

  /** 변형 하나 = (존구성이 점유율에 있나) x (주인공 수요 배수 Z) */
  type Variant = { label: string; zoneInShare: boolean; Z: (s: Subject) => number };
  type Obs = Subject & { pred: number };
  const run = (v: Variant): Obs[] => {
    const w = { ...P.qualityWeights, zone: v.zoneInShare ? P.qualityWeights.zone : 0 };
    const out: Obs[] = [];
    for (const s of subjects) {
      const p2: TextbookParams = { ...P, qualityWeights: w, hoursPerUserPerMonth: P.hoursPerUserPerMonth * v.Z(s) };
      const u = computeTextbook(s.input, p2).utilization;
      if (u != null && u > 0) out.push({ ...s, pred: u });
    }
    return out;
  };

  type Score = ReturnType<typeof score>;
  const score = (obs: Obs[]) => {
    const ours = obs.filter((o) => o.isOurs), riv = obs.filter((o) => !o.isOurs);
    const mae = (g: Obs[]) => mean(g.map((x) => Math.abs(x.pred - x.act)));
    const bias = (g: Obs[]) => mean(g.map((x) => x.pred - x.act));
    const rOf = (g: Obs[]) => corr(g.map((x) => Math.log(x.pred)), g.map((x) => Math.log(x.act)));
    const spread = (g: Obs[]) => sdOf(g.map((x) => Math.log(x.pred))) / sdOf(g.map((x) => Math.log(x.act)));
    const floor = (g: Obs[]) => {
      const a = g.map((x) => x.act);
      return mean(a.map((v, i) => Math.abs(mean(a.filter((_, j) => j !== i)) - v)));
    };
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
    return {
      ours, riv,
      ourMae: mae(ours), ourBias: bias(ours), ourR: rOf(ours), ourSpread: spread(ours), ourFloor: floor(ours),
      rivMae: mae(riv), rivBias: bias(riv), rivR: rOf(riv), rivSpread: spread(riv), rivFloor: floor(riv),
      pairHit: pairs ? hit / pairs : NaN, pairR: corr(gP, gO), pairSpread: sdOf(gP) / sdOf(gO),
      gapObs: Math.exp(med(relO)), gapPred: Math.exp(med(relP)),
    };
  };
  /** 기준 변형 대비 MAE 변화의 2SE (짝지은 차이) — 이보다 작은 변화는 못 가른다 */
  const twoSeDelta = (a: Obs[], b: Obs[]) => {
    const bm = new Map(b.map((o) => [o.input.storeCode, o]));
    const d: number[] = [];
    for (const o of a) { const q = bm.get(o.input.storeCode); if (q) d.push(Math.abs(q.pred - q.act) - Math.abs(o.pred - o.act)); }
    return d.length > 1 ? 2 * sdOf(d) / Math.sqrt(d.length) : NaN;
  };

  const header = () => console.log(
    `  변형                     자사MAE 자사편향 자사r 퍼짐 | 경쟁MAE 경쟁편향 경쟁r | 짝적중 짝r 짝과장 | 자사우위 실측/예측`);
  const line = (label: string, s: Score, mark = "") => console.log(
    `  ${label.padEnd(24)}`
    + `${(s.ourMae * 100).toFixed(2).padStart(6)}%p${(s.ourBias * 100).toFixed(1).padStart(6)}%p${s.ourR.toFixed(3).padStart(6)}${s.ourSpread.toFixed(2).padStart(5)}배 |`
    + `${(s.rivMae * 100).toFixed(1).padStart(6)}%p${(s.rivBias * 100).toFixed(1).padStart(6)}%p${s.rivR.toFixed(3).padStart(6)} |`
    + `${(s.pairHit * 100).toFixed(0).padStart(5)}%${s.pairR.toFixed(3).padStart(6)}${s.pairSpread.toFixed(2).padStart(5)}배 |`
    + `${s.gapObs.toFixed(2).padStart(7)}/${s.gapPred.toFixed(2)}배${mark}`);

  const NOW: Variant = { label: "지금(존구성=점유율)", zoneInShare: true, Z: () => 1 };
  const OUT: Variant = { label: "존구성 뺌(어디에도 없음)", zoneInShare: false, Z: () => 1 };
  const zPow = (zeta: number): Variant => ({
    label: `수요 Z=z^${zeta}`, zoneInShare: false,
    Z: (s) => (s.zone != null && s.zone > 0 ? Math.pow(s.zone, zeta) : 1),
  });
  const roomLin = (zeta: number): Variant => ({
    label: `수요 Z=1+${zeta}·큰룸비`, zoneInShare: false,
    Z: (s) => 1 + zeta * s.bigRoomRatio,
  });

  it("(0) 표본 — 주인공이 몇 명이고 존구성·큰룸비가 어떻게 갈리나", () => {
    const ours = subjects.filter((s) => s.isOurs), riv = subjects.filter((s) => !s.isOurs);
    console.log(`\n[표본] 자사 ${ours.length} · 경쟁점(핑봇) ${riv.length}`);
    const desc = (g: Subject[], label: string) => {
      const z = g.map((s) => s.zone).filter((v): v is number => v != null);
      const rr = g.map((s) => s.bigRoomRatio);
      const withRoom = rr.filter((v) => v > 0).length;
      console.log(`  ${label.padEnd(8)} 존구성 평균 ${mean(z).toFixed(2)} (중앙 ${med(z).toFixed(2)})`
        + ` · 큰룸비 평균 ${(mean(rr) * 100).toFixed(1)}% (중앙 ${(med(rr) * 100).toFixed(1)}%)`
        + ` · 큰룸 있는 곳 ${withRoom}/${g.length}`);
    };
    desc(ours, "자사"); desc(riv, "경쟁점");
    console.log(`  ⚠️ 미조사 경쟁점은 존구성 1.0·큰룸비 0 -> 어느 Z에서도 1배(중립)다.`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(1) ⭐⭐⭐ 존구성을 점유율에서 빼고 수요 배수로 — 세 잣대", () => {
    const now = score(run(NOW));
    console.log(`\n[존구성 자리 바꾸기] 자사=안쪽 · 경쟁점=바깥 · 짝=제일 깨끗`);
    console.log(`  전부 평균 바닥 — 자사 ${pct(now.ourFloor, 2)} · 경쟁점 ${pct(now.rivFloor, 2)}`);
    header();
    line(NOW.label, now, "  ← 지금");
    const outS = score(run(OUT));
    line(OUT.label, outS);
    console.log(`  ── (ㄱ) 존구성 점수를 수요 배수로 (Z = z^ζ, z 1~5점, 룸 없으면 1배) ──`);
    for (const zeta of [0.25, 0.5, 0.75, 1.0]) line(zPow(zeta).label, score(run(zPow(zeta))));
    console.log(`  ── (ㄴ) 큰룸 좌석비를 수요 배수로 (Z = 1 + ζ·큰룸좌석÷PC) — 기전에 제일 가까운 모양 ──`);
    for (const zeta of [0.5, 1, 2, 3, 5]) line(roomLin(zeta).label, score(run(roomLin(zeta))));

    const nowObs = run(NOW);
    console.log(`\n  2SE(지금 대비 MAE 변화, 짝지은 차이) — 자사 ${pct(twoSeDelta(nowObs, run(OUT)), 2)}`
      + ` · 경쟁점 ${pct(twoSeDelta(nowObs.filter((o) => !o.isOurs), run(OUT).filter((o) => !o.isOurs)), 2)}  (존구성 뺌 기준)`);
    console.log(`\n  ⭐⭐ 읽는 법`);
    console.log(`     · 자사우위 예측이 실측(≈1.49)에 다가가고 경쟁편향이 0으로 올라오면 **구조가 그쪽**이다`);
    console.log(`     · 자사 MAE가 나빠지는 건 감수한다 — 안쪽에서 맞춘 값이라 그렇다(과적합 해소 패턴)`);
    console.log(`     · 짝 r·짝적중이 떨어지면 존구성이 점유율 자리에서 **진짜 일을 하고 있었다**는 뜻이다`);
    console.log(`  ⛔ 값을 고르지 않는다. 재고 표다.`);
    expect(now.ours.length).toBeGreaterThan(20);
  });

  it("(2) ⭐⭐ 바깥 표본이 직접 답한다 — 존구성을 뺀 뒤 남은 오차가 존구성을 따라가나", () => {
    // 존구성을 어디에도 안 넣은 상태(OUT)에서 잔차 log(실측÷예측)를 본다.
    //   유입 장치가 맞으면 -> 존이 좋은 매장이 예측보다 **더 돈다** -> 잔차가 z와 양의 상관
    //   점유율 항이 맞으면 -> 같은 동네에서 상대적으로만 -> 짝 안에서 z 차이와 상관
    // 경쟁점끼리(바깥)에서 재면 자사 편향이 안 낀다. 자사(안쪽)도 같이 찍어 견준다.
    const obs = run(OUT);
    const resid = (o: Obs) => Math.log(o.act / o.pred);
    const show = (g: Obs[], label: string) => {
      const withZ = g.filter((o) => o.zone != null);
      const rz = corr(withZ.map((o) => Math.log(o.zone as number)), withZ.map(resid));
      const rRoom = corr(g.map((o) => o.bigRoomRatio), g.map(resid));
      const has = g.filter((o) => o.bigRoomRatio > 0), no = g.filter((o) => !(o.bigRoomRatio > 0));
      const d = has.length && no.length ? mean(has.map(resid)) - mean(no.map(resid)) : NaN;
      const se = has.length > 1 && no.length > 1
        ? Math.sqrt(sdOf(has.map(resid)) ** 2 / has.length + sdOf(no.map(resid)) ** 2 / no.length) : NaN;
      console.log(`  ${label.padEnd(10)} n=${String(g.length).padStart(2)}`
        + `  잔차~log존구성 r ${rz.toFixed(3).padStart(6)}`
        + `  잔차~큰룸비 r ${rRoom.toFixed(3).padStart(6)}`
        + `  큰룸 있음(${has.length}) − 없음(${no.length}) 잔차차 ${Number.isFinite(d) ? `${(Math.exp(d) * 100 - 100).toFixed(0)}%` : "—"}`
        + ` (2SE ${Number.isFinite(se) ? `${(Math.exp(2 * se) * 100 - 100).toFixed(0)}%` : "—"})`
        + `  유의선 ±${(2 / Math.sqrt(g.length)).toFixed(2)}`);
    };
    console.log(`\n[존구성을 뺀 뒤 잔차 log(실측÷예측)가 존을 따라가나]`);
    show(obs.filter((o) => !o.isOurs), "경쟁점(바깥)");
    show(obs.filter((o) => o.isOurs), "자사(안쪽)");
    show(obs, "합쳐서");
    // 짝 안에서 — 같은 동네 두 선수의 잔차 차이 vs 존 차이(점유율 자리라면 이게 살아야 한다)
    const byHood = new Map<string, Obs[]>();
    for (const o of obs) byHood.set(o.hood, [...(byHood.get(o.hood) ?? []), o]);
    // 짝을 둘로 가른다 — 경쟁점끼리(자사 편향·수준차가 안 낀다) / 자사-경쟁점
    const pairSets = { "경쟁점끼리": { dz: [] as number[], dr: [] as number[], dRoom: [] as number[] },
      "자사-경쟁점": { dz: [] as number[], dr: [] as number[], dRoom: [] as number[] } };
    for (const g of byHood.values()) {
      for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) {
        if (g[x].zone == null || g[y].zone == null) continue;
        const set = pairSets[g[x].isOurs || g[y].isOurs ? "자사-경쟁점" : "경쟁점끼리"];
        set.dz.push(Math.log((g[x].zone as number) / (g[y].zone as number)));
        set.dRoom.push(g[x].bigRoomRatio - g[y].bigRoomRatio);
        set.dr.push(resid(g[x]) - resid(g[y]));
      }
    }
    for (const [label, s] of Object.entries(pairSets)) {
      console.log(`  짝 ${label.padEnd(6)}(${String(s.dz.length).padStart(2)}쌍)  잔차차~존구성차 r ${corr(s.dz, s.dr).toFixed(3).padStart(6)}`
        + `  잔차차~큰룸비차 r ${corr(s.dRoom, s.dr).toFixed(3).padStart(6)}`
        + `  유의선 ±${(2 / Math.sqrt(s.dz.length)).toFixed(2)} (쌍이 독립이 아니라 후하게 읽을 것)`);
    }
    console.log(`\n  ⭐ 바깥(경쟁점끼리)에서 양의 상관이 유의하면 존구성은 **어딘가에 있어야 하는 항**이고,`);
    console.log(`     그 크기가 수요 배수 ζ의 자료 쪽 근거가 된다. 0이면 자료는 존구성을 못 본다(기전은 별개).`);
    expect(obs.length).toBeGreaterThan(40);
  });

  it("(3) 대조 — 점유율에 두고 수요에도 넣으면(이중) · 경쟁점 존구성만 점유율에서 빼면", () => {
    // 이중으로 넣는 건 기전이 없다. "더 넣으면 좋아진다" 식의 착시를 걸러내는 대조군이다.
    // 경쟁점만 빼는 것도 기전이 없다 — 자사우위 과장이 "자사 점수가 후해서"인지 가르는 용도.
    header();
    line(NOW.label, score(run(NOW)), "  ← 지금");
    line("이중: 점유율+수요 z^0.5", score(run({ label: "", zoneInShare: true, Z: zPow(0.5).Z })));
    // 경쟁점의 존만 null로 — 자사만 존구성을 갖는다(자사엔 유리한 쪽으로 기울어진 대조)
    const onlyOurs: Obs[] = [];
    for (const s of subjects) {
      const nullZone = (q: TextbookInput["ownQualityParts"]) => (q ? { ...q, zone: null } : q);
      const inp: TextbookInput = {
        ...s.input,
        ownQualityParts: s.isOurs ? s.input.ownQualityParts : nullZone(s.input.ownQualityParts),
        rivals: (s.input.rivals ?? []).map((r) => (r.name === s.hood ? r : { ...r, parts: nullZone(r.parts) })),
      };
      const u = computeTextbook(inp, P).utilization;
      if (u != null && u > 0) onlyOurs.push({ ...s, pred: u });
    }
    line("경쟁점 존만 뺌(자사만 존)", score(onlyOurs));
    console.log(`  ⚠️ 위 둘은 기전이 없는 대조군이다. 좋아 보여도 채택 후보가 아니다.`);
    expect(onlyOurs.length).toBeGreaterThan(40);
  });

  it("(4) ⭐⭐ 존구성을 뺀 뒤에도 남는 1.6배 — 나머지 네 항목 어디에 있나", () => {
    // 존구성을 어디에도 안 넣어도 자사우위 예측 2.45배(실측 1.49). 남은 항목은
    // 사양·먹거리·인테리어·관리다. 자사/경쟁점 평균: 사양 3.38/2.72 · 먹거리 4.00/2.53 ·
    // 인테리어 4.00/2.55 · 관리 4.20/2.59 (handoff-20260925 4절).
    // ⚠️ 먹거리·인테리어는 자사 **전 매장 같은 값**(같은 도면·같은 메뉴)이라 매장별로 못 쪼갠다.
    //    고칠 수 있는 건 **기본값 수준**뿐이고, 그건 θ와 바꿔칠 수 있다([[project_own_facility_scores_are_time_aligned]]).
    //    그래서 여기서는 (가) θ, (나) 항목 끄기, (다) 자사 먹거리·인테리어 기본값 수준 — 셋을
    //    **존구성 뺀 상태**에서 따로 돈다. 바깥 잣대(자사우위 실측/예측·경쟁편향)로 읽는다.
    const runWith = (mut: (s: Subject) => TextbookInput, p2: TextbookParams): Obs[] => {
      const out: Obs[] = [];
      for (const s of subjects) {
        const u = computeTextbook(mut(s), p2).utilization;
        if (u != null && u > 0) out.push({ ...s, pred: u });
      }
      return out;
    };
    const wOut = { ...P.qualityWeights, zone: 0 };
    const pOut: TextbookParams = { ...P, qualityWeights: wOut };
    const same = (s: Subject) => s.input;

    console.log(`\n[존구성 뺀 상태에서 — (가) θ 재고 표]`);
    header();
    line(NOW.label, score(run(NOW)), "  ← 지금");
    for (const th of [3, 2.5, 2, 1.5, 1]) {
      line(`존구성 뺌 · θ=${th}`, score(runWith(same, { ...pOut, qualityExponent: th })), th === 3 ? "  ← 존구성만 뺌" : "");
    }

    console.log(`\n[존구성 뺀 상태에서 — (나) 나머지 항목을 하나씩 더 끄면]`);
    header();
    const KEYS = ["spec", "food", "interior", "management"] as const;
    const KO: Record<typeof KEYS[number], string> = { spec: "사양", food: "먹거리", interior: "인테리어", management: "관리" };
    for (const k of KEYS) {
      line(`존구성 뺌 + ${KO[k]} 끔`, score(runWith(same, { ...pOut, qualityWeights: { ...wOut, [k]: 0 } })));
    }

    console.log(`\n[존구성 뺀 상태에서 — (다) 자사 먹거리·인테리어 기본값 수준 v (지금 4.0 · 경쟁점 평균 2.5)]`);
    console.log(`  ⚠️ 2026-09-24에 안쪽(자사 MAE)만으로 훑었을 땐 4.0이 최선이었다. 여기서는 **바깥 잣대**로 다시 본다.`);
    header();
    const setOwnFI = (v: number) => (s: Subject): TextbookInput => {
      const fix = (q: TextbookInput["ownQualityParts"]) => (q ? { ...q, food: v, interior: v } : q);
      return {
        ...s.input,
        ownQualityParts: s.isOurs ? fix(s.input.ownQualityParts) : s.input.ownQualityParts,
        // 경쟁점이 주인공일 때 상대로 들어가는 우리 매장도 같이 바꾼다
        rivals: (s.input.rivals ?? []).map((r) => (r.name === s.hood ? { ...r, parts: fix(r.parts) } : r)),
      };
    };
    for (const v of [4.0, 3.5, 3.0, 2.5]) {
      line(`존구성 뺌 · 자사 먹/인=${v.toFixed(1)}`, score(runWith(setOwnFI(v), pOut)), v === 4 ? "  ← 존구성만 뺌" : "");
    }
    console.log(`\n  ⭐ 읽는 법 — 자사우위 예측이 1.49에 닿고 **자사편향·경쟁편향이 같이 0으로 가는** 칸이 있으면 그쪽이 구조다.`);
    console.log(`     자사 편향만 크게 음수가 되면 "자사 품질을 낮춰서 격차를 맞춘 대신 우리를 과소예측"이다 — 수요 쪽 문제가 따로 있다는 뜻.`);
    console.log(`  ⛔ 값을 고르지 않는다.`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(5) ⭐⭐ 격차와 수준을 같이 — 존구성 뺀 상태에서 θ x 자사 먹/인 x 수요배수", () => {
    // (4)에서 격차를 맞추는 손잡이(θ↓·자사 기본값↓)는 전부 **자사·경쟁점을 같이 과소예측**으로 밀었다.
    // 그러면 남는 건 공통 수준, 즉 수요다. 수요를 n배 하면 두 편향이 **동시에** 0에 가는 칸이 있나 본다.
    // 수요배수는 hoursPerUserPerMonth에 곱하는 **진단용**이다(원장 실측 8.20h는 못 건드린다 — 고칠 자리는 이용자 수).
    // ⛔ 값을 고르지 않는다. 칸이 있으면 "구조가 그쪽"이라는 증거일 뿐이다.
    const wOut = { ...P.qualityWeights, zone: 0 };
    const setOwnFI = (v: number) => (s: Subject): TextbookInput => {
      const fix = (q: TextbookInput["ownQualityParts"]) => (q ? { ...q, food: v, interior: v } : q);
      return {
        ...s.input,
        ownQualityParts: s.isOurs ? fix(s.input.ownQualityParts) : s.input.ownQualityParts,
        rivals: (s.input.rivals ?? []).map((r) => (r.name === s.hood ? { ...r, parts: fix(r.parts) } : r)),
      };
    };
    const cell = (th: number, v: number, dm: number) => {
      const p2: TextbookParams = { ...P, qualityWeights: wOut, qualityExponent: th, hoursPerUserPerMonth: P.hoursPerUserPerMonth * dm };
      const out: Obs[] = [];
      for (const s of subjects) {
        const u = computeTextbook(setOwnFI(v)(s), p2).utilization;
        if (u != null && u > 0) out.push({ ...s, pred: u });
      }
      return score(out);
    };
    console.log(`\n[격차 x 수준] 존구성 뺌. 칸 = 자사편향/경쟁편향(%p) · 자사우위예측(실측 1.49) · 짝r`);
    const DMS = [1.0, 1.25, 1.5, 1.75];
    console.log(`  θ   먹/인 ${DMS.map((d) => `수요x${d.toFixed(2)}`.padStart(26)).join("")}`);
    for (const th of [3, 2.5, 2, 1.5]) {
      for (const v of [4.0, 3.0]) {
        let row = `  ${th.toFixed(1)}  ${v.toFixed(1)}  `;
        for (const dm of DMS) {
          const s = cell(th, v, dm);
          const both = Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03;
          row += `${`${(s.ourBias * 100).toFixed(1)}/${(s.rivBias * 100).toFixed(1)} ${s.gapPred.toFixed(2)}배 r${s.pairR.toFixed(2)}${both ? "*" : " "}`.padStart(26)}`;
        }
        console.log(row);
      }
    }
    console.log(`  (* = 두 편향이 다 ±3%p 안)`);
    console.log(`\n  ⭐ 읽는 법 — *가 찍힌 칸이 있고 거기서 자사우위 예측이 1.49 근처면 "격차는 품질 눈금, 수준은 수요"로 갈라진다.`);
    console.log(`     짝 r은 θ에만 반응해야 정상이다(수요배수는 비를 안 바꾼다). 그게 아니면 상한(0.55)에 걸린 매장이 있다는 뜻.`);
    console.log(`  ⚠️ 수요배수 자체는 채택 후보가 아니다 — 이용자 수를 그만큼 키우는 **정당한 경로**가 따로 필요하다(2절 과제).`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(6) ⭐ 주거 500m 모양 — 실측 수요와 제일 잘 맞던 모양을 세 잣대로", () => {
    // `_measuredDemand.test.ts`: 산식 수요 vs 핑봇 실측 수요에서 주거 500m이 퍼짐을 제일 잘 맞췄다(0.411 -> 0.344).
    // 다만 그 모양은 수준이 더 낮다(배율 1.86배). 여기서는 존구성 뺀 상태·θ=3 그대로 두고
    // 주거 반경만 500m로 바꾼 뒤 수요배수를 훑어 세 잣대가 어떻게 되나 본다.
    // ⚠️ 경쟁점 주인공도 우리 매장의 pop500m을 그대로 쓴다(같은 동네 근사) — 짝 비교가 제일 깨끗하다.
    const wOut = { ...P.qualityWeights, zone: 0 };
    const at = (rr: 500 | 1000, dm: number) => {
      const p2: TextbookParams = { ...P, qualityWeights: wOut, residentRadius: rr, hoursPerUserPerMonth: P.hoursPerUserPerMonth * dm };
      const out: Obs[] = [];
      for (const s of subjects) {
        const u = computeTextbook(s.input, p2).utilization;
        if (u != null && u > 0) out.push({ ...s, pred: u });
      }
      return score(out);
    };
    console.log(`\n[주거 반경 500m vs 1km] 존구성 뺌 · θ=3`);
    header();
    for (const rr of [1000, 500] as const) {
      for (const dm of [1.0, 1.5, 2.0]) {
        const s = at(rr, dm);
        line(`주거 ${rr}m · 수요x${dm.toFixed(1)}`, s, rr === 1000 && dm === 1 ? "  ← 존구성만 뺌" : "");
      }
    }
    console.log(`\n  ⭐ 읽는 법 — 500m이 1km보다 **자사 r·경쟁 r·짝 r이 같이** 좋아지면 실측 수요 쪽 결론과 맞는다.`);
    console.log(`     한쪽만 좋아지면 잣대가 갈리는 것이다(2026-09-24: 자사 매출 기준으로는 1km가 이겼다).`);
    console.log(`  ⚠️ 경쟁점 주인공에 우리 매장 인구를 쓰므로 반경을 바꿔도 경쟁점끼리의 비는 안 바뀐다 — 자사 r·경쟁 r로 읽는다.`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(7) 시점차 교란 — 경쟁점 조사 연도별로 갈라서 품질↔핑봇 상관을 재면", () => {
    // 경쟁점 품질은 우리 매장 오픈 당시 조사값, 핑봇은 2026-08 한 시점. 매장에 따라 1~3년 차이.
    // 사용자: *"리뉴얼하는 경우는 거의 없어서 … 거의 없다고 봐도 무방할 듯."* -> 교란은 작다고 본다.
    // 확인: 조사가 오래된 묶음일수록 품질↔핑봇 상관이 약해지면 교란이 있는 것이다.
    // ⚠️ 47곳을 연도로 가르면 묶음당 10곳 안팎 — 유의선 ±0.6. **크기를 재는 게 아니라 방향만 본다.**
    const riv = subjects.filter((s) => !s.isOurs && s.quality != null);
    // ⚠️ 경쟁점 문서 createdAt은 전부 2026(일괄 입력)이라 조사 시점을 못 대표한다(2026-09-23 확인).
    //    **우리 매장 오픈 연도**를 동네의 조사 시점 대리값으로 쓴다 — 경쟁점 조사는 오픈 전후에 한다.
    const yearKey = (s: Subject) => s.openYear ?? s.surveyYear;
    const groups = new Map<string, Subject[]>();
    for (const s of riv) {
      const k = yearKey(s) != null ? String(yearKey(s)) : "연도없음";
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    const obsOut = run(OUT);
    const residBy = new Map(obsOut.map((o) => [o.input.storeCode, Math.log(o.act / o.pred)]));
    console.log(`\n[우리 매장 오픈 연도별(=경쟁점 조사 시점 대리)] 핑봇 2026-08 기준 · 경쟁점 ${riv.length}곳`);
    console.log(`  연도    n   품질평균  핑봇평균   r(품질,핑봇)  r(품질,잔차·존뺌)  유의선`);
    for (const k of [...groups.keys()].sort()) {
      const g = groups.get(k)!;
      const q = g.map((s) => s.quality as number), u = g.map((s) => s.act);
      const rz = g.map((s) => residBy.get(s.input.storeCode)).filter((v): v is number => v != null);
      const rq = corr(q, u);
      const rr = rz.length === g.length ? corr(q, rz) : NaN;
      console.log(`  ${k.padEnd(7)}${String(g.length).padStart(3)}${mean(q).toFixed(2).padStart(9)}`
        + `${(mean(u) * 100).toFixed(1).padStart(9)}%${(g.length >= 4 ? rq.toFixed(3) : "—").padStart(12)}`
        + `${(g.length >= 4 && Number.isFinite(rr) ? rr.toFixed(3) : "—").padStart(16)}`
        + `${g.length >= 4 ? `  ±${(2 / Math.sqrt(g.length)).toFixed(2)}` : ""}`);
    }
    const all = riv;
    console.log(`  전체${String(all.length).padStart(6)}${mean(all.map((s) => s.quality as number)).toFixed(2).padStart(9)}`
      + `${(mean(all.map((s) => s.act)) * 100).toFixed(1).padStart(9)}%`
      + `${corr(all.map((s) => s.quality as number), all.map((s) => s.act)).toFixed(3).padStart(12)}  ±${(2 / Math.sqrt(all.length)).toFixed(2)}`);
    // 조사 경과년수(2026 − 조사연도)와 |잔차|의 상관 — 오래된 조사일수록 틀리면 양의 상관
    const aged = riv.filter((s) => yearKey(s) != null && residBy.has(s.input.storeCode));
    const age = aged.map((s) => 2026 - (yearKey(s) as number));
    const absRes = aged.map((s) => Math.abs(residBy.get(s.input.storeCode) as number));
    console.log(`\n  조사 경과년수 ↔ |잔차|(존뺌)  r ${corr(age, absRes).toFixed(3)} (n=${aged.length}, 유의선 ±${(2 / Math.sqrt(aged.length)).toFixed(2)})`
      + ` — 양수면 오래된 조사가 더 틀린다`);
    console.log(`  ⚠️ 연도는 우리 매장 오픈 연도다. 경쟁점 문서 createdAt은 전부 2026이라 못 쓴다(일괄 입력).`);
    expect(riv.length).toBeGreaterThan(20);
  });
});
