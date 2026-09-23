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
import { residentRingsByCodeFromDocs, residentRingsByCodeFromSgis, type LabResidentRingsDoc, type SgisFile } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_UNSURVEYED_PC_COUNT, computeLocationScoreFromFacts } from "./calc";
import { existingSiteKey, operatingShareInWindow, rival2kmRecords } from "./rival2km";
import { evaluationMonths } from "./evaluationSalesPeriod";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight, residentRingWeight,
  type QualityParts, type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const SGIS_FILE = ".local-tools/sgis-resident-population.json";
// 2026-09-24 — 고리 인구는 스냅샷(storeEvalLabResidentRings)에 있으므로 SGIS 파일은 필수가 아니다(집 PC에는 그 파일이 없다).
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
  // 고리 인구 — **화면과 같은 자료**(스냅샷의 storeEvalLabResidentRings)를 먼저 쓴다. 없으면 SGIS 파일로.
  // 2026-09-17에 하네스와 화면이 다른 자료를 읽어 성적이 조용히 갈라진 적이 있다.
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length
    ? residentRingsByCodeFromDocs(ringDocs)
    : existsSync(SGIS_FILE) ? residentRingsByCodeFromSgis(JSON.parse(readFileSync(SGIS_FILE, "utf8")) as SgisFile)
    : new Map<string, never>() as unknown as ReturnType<typeof residentRingsByCodeFromDocs>;
  const ringSource = ringDocs.length ? `스냅샷 storeEvalLabResidentRings ${ringDocs.length}건` : existsSync(SGIS_FILE) ? "SGIS 파일" : "없음(고리 항 빠짐)";
  // 항아리 판정(2026-09-23 밤 채택) — 화면과 같은 컬렉션. 안 넘기면 useRingEnclosure가 켜져도 안 깎여 "새 기본값" 줄이 낡는다.
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) {
    const c = j.ringCutCount ?? j.blockedCount;
    if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c);
  }
  // ⭐ 배선된 경로 — 고리 인구·항아리 판정을 입력에 실어 넣는다. λ=0이면 산식이 그 입력을 안 읽는다.
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, residentRingsByCode, ringBlockedByCode });
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
      // ⚠️ 2026-09-23 — 경쟁점 주인공에도 **2km 경쟁점**을 넣는다(거리는 주인공 기준으로 다시 잼, 대수는
      //    우리 매장과 같은 기본대수 90 x 평가창 영업비중, 품질 null). 그전엔 우리 입력에만 2km가 있어서
      //    gravity에서 우리만 2km 경쟁에 깎이는 비대칭이 있었다(core에선 무게 ~0이라 티가 안 났다).
      const months = evaluationMonths(st.openedAt);
      const twoKm = rival2kmRecords(existingSiteKey(r.input.storeCode))
        .map((x) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * operatingShareInWindow(x, months), distanceM: distM(me.lat, me.lng, x.lat, x.lng), parts: null as QualityParts | null, name: x.name }))
        .filter((x) => x.ip > 0);
      const rivals: NonNullable<TextbookInput["rivals"]> = [
        { ip: r.input.pcCount as number, distanceM: distM(me.lat, me.lng, st.lat!, st.lng!), parts: r.input.ownQualityParts, name: r.input.storeName },
        ...comps.filter((_, j) => j !== k).map((o) => ({ ip: o.pc, distanceM: distM(me.lat, me.lng, o.lat, o.lng), parts: rivalQualityParts(o.c, settings), name: o.c.name ?? null })),
        ...twoKm,
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
  // ⚠️ 2026-09-23에 기본값이 묶음(θ1.75·존 0.06·λ600)으로 바뀌었다. 이 표의 "지금" 줄은 **옛 배선**
  //    (θ3·존 0.238·λ0)을 뜻하므로 P의 값이 아니라 상수로 고정한다 — 그래야 (0) 검산 5.84%p가 뜻을 유지한다.
  const OLD_ZONE_W = 0.238;
  const paramsOf = (c: Cell): TextbookParams => ({
    ...P, qualityExponent: c.theta, residentRingDecayM: c.lambda,
    qualityWeights: { ...P.qualityWeights, zone: c.zoneIn ? OLD_ZONE_W : 0 },
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
    // ⚠️ 2026-09-24 — 5.84%p는 **특수수요 배수를 다시 켜기 전**(09-23 12:01 커밋 539b17b 이전) 숫자다. 그때 배수는
    //    군부대 2.25만 켜져 있고 나머지 1.0이었다(git show 539b17b^). NOW 칸은 P를 상속해 지금 배수(대학가 1.3·
    //    산업단지 1.4·군부대 2.0)까지 물고 오므로 λ=0이어도 5.22%p로 어긋난다. 검산은 배수를 그 시점 값으로
    //    되돌린 칸에서 한다. 배수만 지금 값인 옛 배선도 같이 찍어 차이를 남긴다.
    const OLD_MULTIPLIERS: TextbookParams["specialDemandMultipliers"] = { ...Object.fromEntries(Object.keys(P.specialDemandMultipliers).map((k) => [k, 1])), "군부대": 2.25 };
    const oldParams: TextbookParams = { ...paramsOf(NOW), specialDemandMultipliers: OLD_MULTIPLIERS, useRingEnclosure: false, residentRingShare: "core" };
    const runWith = (p2: TextbookParams): Obs[] => { const out: Obs[] = []; for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); } return out; };
    const now = score(runWith(oldParams));
    const nowMul = score(run(NOW));
    console.log(`\n[검산] 옛 배선(θ3·존 0.238·λ0·배수 군부대 2.25만): 자사 ${now.ours.length}곳 MAE ${(now.ourMae * 100).toFixed(2)}%p (2026-09-22 5.84%p) · 경쟁점 ${now.riv.length}곳 편향 ${(now.rivBias * 100).toFixed(1)}%p (−10.9%p)`);
    console.log(`  ${Math.abs(now.ourMae - 0.0584) < 0.002 ? "✅ 같다 — 배선이 λ=0에서 아무것도 안 바꿨다" : "⚠️ 다르다 — 배선을 다시 볼 것"}`);
    console.log(`  (참고) 옛 배선 + 특수수요 배수만: 자사 MAE ${(nowMul.ourMae * 100).toFixed(2)}%p · 자사편향 ${(nowMul.ourBias * 100).toFixed(1)}%p · 경쟁편향 ${(nowMul.rivBias * 100).toFixed(1)}%p — 격자(2)~(5)의 "지금" 줄은 이 값이다`);
    // 새 기본값(P 그대로) — 채택 칸이 재현되는지
    const cur = score((() => { const out: Obs[] = []; for (const s of subjects) { const u = computeTextbook(s.input, P).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); } return out; })());
    console.log(`  새 기본값(θ${P.qualityExponent}·존 ${P.qualityWeights.zone}·λ${P.residentRingDecayM}): 자사 MAE ${(cur.ourMae * 100).toFixed(2)}%p · 자사편향 ${(cur.ourBias * 100).toFixed(1)}%p · 경쟁편향 ${(cur.rivBias * 100).toFixed(1)}%p · 자사우위 ${cur.gapPred.toFixed(2)}배`);

    // 사용자(2026-09-23): *"예상가동률 편차가 더 커진 것 같은데? 기분 탓인가"* — 옛/새를 나란히.
    const dist = (label: string, g: Obs[]) => {
      const pred = g.map((o) => o.pred), act = g.map((o) => o.act), err = g.map((o) => o.pred - o.act);
      const within5 = err.filter((e) => Math.abs(e) <= 0.05).length, within10 = err.filter((e) => Math.abs(e) <= 0.10).length;
      const worst = [...g].sort((a, b) => Math.abs(b.pred - b.act) - Math.abs(a.pred - a.act)).slice(0, 4)
        .map((o) => `${o.hood} ${((o.pred - o.act) * 100).toFixed(0)}`).join(" · ");
      console.log(`  ${label.padEnd(10)} 예측 ${(Math.min(...pred) * 100).toFixed(0)}~${(Math.max(...pred) * 100).toFixed(0)}% (SD ${(sdOf(pred) * 100).toFixed(1)})`
        + ` · 실측 ${(Math.min(...act) * 100).toFixed(0)}~${(Math.max(...act) * 100).toFixed(0)}% (SD ${(sdOf(act) * 100).toFixed(1)})`
        + ` · 오차 SD ${(sdOf(err) * 100).toFixed(1)}%p · ±5%p ${within5}/${g.length} · ±10%p ${within10}/${g.length}`
        + ` · 최악: ${worst}`);
    };
    console.log(`\n  [퍼짐 — 자사 37곳] 예측이 실측보다 넓게 벌어지나`);
    dist("옛 배선", now.ours); dist("새 기본값", cur.ours);
    console.log(`  [퍼짐 — 경쟁점 47곳]`);
    dist("옛 배선", now.riv); dist("새 기본값", cur.riv);
    console.log(`  ⭐ 예측 SD가 실측 SD보다 크면 산식이 매장 차이를 과장하는 것이다. 새 배선이 더 벌어지면 사용자 감각이 맞다.`);
    const withRings = base.filter((r) => r.input.residentAgesByRadius).length;
    console.log(`  고리 인구가 실린 매장 ${withRings}/${base.length} (출처: ${ringSource})`);
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

  it("(5) ⭐⭐⭐ 빼는 게 정답인가 — 존구성 비중을 0과 지금(23.8%) 사이로 놓으면", () => {
    // 사용자(2026-09-23): *"빼는 게 정답임?"* — 맞는 질문이다. 지금까지는 "있음(23.8%)" vs "뺌(0)"만 봤다.
    // 규칙 [[feedback_item_vs_coefficient]]: 항목은 뜻으로 두고 **계수만** 자료로 고른다. 팀룸 유입 기전은
    // 사용자가 댔으니 항목을 자르는 건 규칙에 어긋난다. 그러면 물어야 할 건 "비중을 얼마로 두면 되나"다.
    // ⚠️ 바깥 표본(경쟁점 47곳)은 존구성을 못 본다 — 큰룸 있는 경쟁점 11곳, 2SE 54%. "0이 맞다"는 증거가 아니라
    //    "자료로는 못 고른다"는 뜻이다. 그래서 여기서는 **수준(두 편향)과 격차(자사우위)**만으로 본다.
    type Cell5 = { zoneW: number; theta: number; lambda: number };
    const ZW = [0, 0.06, 0.12, 0.18, 0.238];
    const paramsOf5 = (c: Cell5): TextbookParams => ({
      ...P, qualityExponent: c.theta, residentRingDecayM: c.lambda,
      qualityWeights: { ...P.qualityWeights, zone: c.zoneW },
    });
    const run5 = (c: Cell5): Obs[] => {
      const p2 = paramsOf5(c);
      const out: Obs[] = [];
      for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); }
      return out;
    };
    console.log(`\n[존구성 비중 재고 표] 비중 0 = 뺌 · 0.238 = 지금. 나머지 네 항목 비중은 그대로(합으로 나눠 정규화)`);
    console.log(`  존비중  θ     λ    자사MAE 자사편향 자사r | 경쟁MAE 경쟁편향 경쟁r | 짝r  짝과장 | 자사우위 예측(목표 1.74)`);
    const rows5: { c: Cell5; s: Score }[] = [];
    for (const zoneW of ZW) {
      for (const theta of [2, 1.75]) for (const lambda of [500, 600, 700]) {
        const c = { zoneW, theta, lambda };
        const s = score(run5(c));
        rows5.push({ c, s });
        const pass = Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03;
        console.log(`  ${zoneW.toFixed(3)}  ${theta.toFixed(2)}  ${String(lambda).padStart(4)}`
          + `${(s.ourMae * 100).toFixed(2).padStart(7)}%p${(s.ourBias * 100).toFixed(1).padStart(6)}%p${s.ourR.toFixed(3).padStart(6)} |`
          + `${(s.rivMae * 100).toFixed(1).padStart(6)}%p${(s.rivBias * 100).toFixed(1).padStart(6)}%p${s.rivR.toFixed(3).padStart(6)} |`
          + `${s.pairR.toFixed(3).padStart(6)}${s.pairSpread.toFixed(2).padStart(5)}배 |`
          + `${s.gapPred.toFixed(2).padStart(8)}배${pass ? "  *" : ""}`);
      }
      console.log("");
    }
    const passing5 = rows5.filter(({ s }) => Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03)
      .sort((a, b) => Math.abs(a.s.gapPred - TARGET_GAP_YOUNG) - Math.abs(b.s.gapPred - TARGET_GAP_YOUNG) || b.s.ourR - a.s.ourR);
    console.log(`  [사전 등록 기준 순위 — 비중까지 포함]`);
    passing5.slice(0, 8).forEach(({ c, s }, i) => console.log(`  ${String(i + 1).padStart(3)}  존비중 ${c.zoneW.toFixed(3)} θ${c.theta.toFixed(2)} λ${c.lambda}`
      + `  자사우위 ${s.gapPred.toFixed(2)} (|목표차| ${Math.abs(s.gapPred - TARGET_GAP_YOUNG).toFixed(2)})  자사r ${s.ourR.toFixed(3)}  짝r ${s.pairR.toFixed(3)}  자사MAE ${(s.ourMae * 100).toFixed(2)}%p`));
    console.log(`\n  ⭐ 읽는 법 — 비중을 조금 남겨도(0.06~0.12) 두 편향과 자사우위가 기준 안이면 **항목을 자르지 않아도 된다.**`);
    console.log(`     그 경우 "뺌"이 아니라 "비중 축소"가 답이고, 기전(팀룸 유입)을 산식에 남길 수 있다.`);
    console.log(`     자사 r·짝 r이 비중을 남길 때 더 높으면 존구성이 순서 맞히기에는 일하고 있다는 뜻이다.`);
    expect(rows5.length).toBe(ZW.length * 6);
  });

  it("(6) ⭐⭐⭐ 고리 수요의 점유율 — 1km 안과 같게(core) vs 가까운 쪽으로(gravity)", () => {
    // 사용자(2026-09-23): 채택 뒤 *"편차가 커진 게 별로다. 근거가 있으면 감수, 값을 위해 조정한 거면 별로."*
    // 커진 편차의 출처는 밀집 도심 과대(발산역 +23·수원망포 +21)이고, 원인은 비대칭이다 — 1~2km 사람은
    // 세면서 그 곁의 PC방은 경쟁으로 안 센다. 고치는 방법도 기전으로: **가까운 쪽으로 간다(기하)**.
    // ⚠️ gravity는 고리 수요의 우리 몫을 줄이므로 수준이 내려간다. 같은 λ에서 먼저 견주고, 수준을 맞추는
    //    λ도 같이 찍는다(λ는 기전 상수가 아니라 눈금이므로 사전 기준으로 고르되 그 사실을 적는다).
    type Cell6 = { mode: "core" | "gravity"; lambda: number; theta: number; zoneW: number };
    const run6 = (c: Cell6): Obs[] => {
      const p2: TextbookParams = { ...P, residentRingShare: c.mode, residentRingDecayM: c.lambda, qualityExponent: c.theta,
        qualityWeights: { ...P.qualityWeights, zone: c.zoneW } };
      const out: Obs[] = [];
      for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); }
      return out;
    };
    const spreadLine = (label: string, obs: Obs[]) => {
      const s = score(obs);
      const g = s.ours, pred = g.map((o) => o.pred), err = g.map((o) => o.pred - o.act);
      const within5 = err.filter((e) => Math.abs(e) <= 0.05).length;
      const worst = [...g].sort((a, b) => Math.abs(b.pred - b.act) - Math.abs(a.pred - a.act)).slice(0, 3)
        .map((o) => `${o.hood} ${((o.pred - o.act) * 100).toFixed(0)}`).join("·");
      const pass = Math.abs(s.ourBias) <= 0.03 && Math.abs(s.rivBias) <= 0.03;
      console.log(`  ${label.padEnd(30)}`
        + `${(s.ourMae * 100).toFixed(2).padStart(6)}%p${(s.ourBias * 100).toFixed(1).padStart(6)}%p${s.ourR.toFixed(3).padStart(6)}`
        + ` SD${(sdOf(pred) * 100).toFixed(1).padStart(5)} ±5:${String(within5).padStart(2)} |`
        + `${(s.rivMae * 100).toFixed(1).padStart(6)}%p${(s.rivBias * 100).toFixed(1).padStart(6)}%p${s.rivR.toFixed(3).padStart(6)} |`
        + `${s.pairR.toFixed(3).padStart(6)} |${s.gapPred.toFixed(2).padStart(6)}배 | ${worst}${pass ? "  *" : ""}`);
      return s;
    };
    console.log(`\n[고리 점유율 방식] 실측 자사 SD 6.4 · 옛 배선 예측 SD 8.1 · 채택(core λ600) 9.9`);
    console.log(`  칸                            자사MAE 자사편향 자사r 예측SD ±5%p | 경쟁MAE 경쟁편향 경쟁r | 짝r  | 자사우위 | 자사 최악 3곳`);
    const th = P.qualityExponent, zw = P.qualityWeights.zone;
    console.log(`  ── 같은 λ에서 방식만 바꾸면 (θ${th}·존 ${zw}) ──`);
    for (const lambda of [600]) for (const mode of ["core", "gravity"] as const) spreadLine(`${mode.padEnd(7)} λ${lambda}`, run6({ mode, lambda, theta: th, zoneW: zw }));
    console.log(`  ── gravity에서 λ를 올리면 (수준을 되찾는 데 얼마나 필요한가) ──`);
    for (const lambda of [800, 1000, 1500, 2000, 3000]) spreadLine(`gravity λ${lambda}`, run6({ mode: "gravity", lambda, theta: th, zoneW: zw }));
    console.log(`  ── 대조: core에서 같은 λ ──`);
    for (const lambda of [800, 1000]) spreadLine(`core    λ${lambda}`, run6({ mode: "core", lambda, theta: th, zoneW: zw }));
    // ── (6b) 남은 최악 3곳 — 사용자 현장 사정(2026-09-23)과 대조 ──────────────────────────
    //   송도: 경쟁점 500원 요금전쟁, 우리도 1500→1000원. 요금 경쟁력은 점유율 항에 없다(오픈 후 변화).
    //   구미산동: 운영 부진(QSC 반영) + **항아리상권**(외부 유입 없음) → 고리를 세면 안 되는 곳.
    //   전대후문: 대학 특수수요를 받는데 대학가 배수가 1.0(꺼짐). 상권 내 가동률 최고.
    // 각자 "빠진 항"을 켜면 얼마나 움직이나만 본다. 매장별로 맞추는 게 아니다 — 기전을 항으로 만들 때 참고.
    const focus = ["송도점", "구미산동점", "전대후문점"];
    const predOf = (o: Subject, p2: TextbookParams) => computeTextbook(o.input, p2).utilization;
    console.log(`\n  [남은 최악 3곳 — 현장 사정 대조] 실측 / 옛 배선 / 지금(gravity λ${P.residentRingDecayM}) / 고리 끔 / 대학가 x1.45`);
    for (const name of focus) {
      const o = subjects.find((s) => s.isOurs && s.hood === name);
      if (!o) { console.log(`  ${name} — 표본에 없음`); continue; }
      const old = predOf(o, { ...P, qualityExponent: 3, residentRingDecayM: 0, qualityWeights: { ...P.qualityWeights, zone: OLD_ZONE_W } });
      const cur = predOf(o, P);
      const noRing = predOf(o, { ...P, residentRingDecayM: 0 });
      const univ = predOf(o, { ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, "대학가": 1.45 } });
      const f = (v: number | null) => (v == null ? "  -  " : `${(v * 100).toFixed(1).padStart(5)}%`);
      console.log(`  ${name.padEnd(8)} 실측 ${f(o.act)} · 옛 ${f(old)} · 지금 ${f(cur)} · 고리끔 ${f(noRing)} · 대학가x1.45 ${f(univ)}`
        + `  (특수수요 유형: ${o.input.specialDemandType ?? "없음"} · 고리 이용자 ${(() => { const b = computeTextbook(o.input, P); return b.residentRingUsers && b.residentDemandUsers ? `${(b.residentRingUsers / b.residentDemandUsers * 100).toFixed(0)}%` : "-"; })()} · 고리 점유율 ${(() => { const b = computeTextbook(o.input, P); return b.residentRingShare == null ? "-" : `${(b.residentRingShare * 100).toFixed(0)}%`; })()})`);
    }
    const univCount = subjects.filter((s) => s.isOurs && s.input.specialDemandType === "대학가").length;
    console.log(`  대학가 유형 자사 매장 ${univCount}곳 (배수를 다시 재려면 바깥 표본으로 — 2026-09-20에 순환 오염으로 껐던 항이다)`);

    console.log(`\n  ⭐ 읽는 법 — gravity가 같은 수준(편향)에서 **예측 SD와 최악 매장을 줄이고 자사 r을 안 깎으면** 비대칭이 범인이었고 고친 것이다.`);
    console.log(`     gravity에서 수준을 맞추는 λ가 훨씬 커야 하면(예: 2000 이상) 고리가 "먼 사람을 많이 세되 대부분 남에게 준다"는 뜻 — 그것도 기전상 자연스럽다.`);
    console.log(`     ⚠️ 500m 밖 경쟁점 대수는 미조사 기본값이다. gravity는 그 대수를 더 쓴다.`);
    expect(subjects.length).toBeGreaterThan(40);
  });

  it("(7) ⭐⭐ 특수수요 유형별 — 자사와 경쟁점(바깥)이 같이 과소예측되나 (대학가 배수를 다시 잴 자격)", () => {
    // 전대후문(대학가) −18%p. `specialDemandMultipliers.대학가`는 1.0(꺼짐) — 2026-09-20에 "축척을 독점매장에서
    // 맞추는데 그 매장이 특수수요 유형이라 순환"이라는 이유로 껐다. **지금은 축척이 원장 8.20h로 고정**돼 그 이유가
    // 사라졌다. 다시 재되, 자사 5곳만으로 고르면 매장 맞추기다 — 바깥 표본(그 동네 경쟁점 핑봇)이 같이
    // 과소예측되면 **수요**가 작은 것이고(배수가 맞다), 자사만 그러면 점유율 문제다.
    type G = { ours: Obs[]; riv: Obs[] };
    const groups = new Map<string, G>();
    const obs: Obs[] = [];
    for (const s of subjects) { const u = computeTextbook(s.input, P).utilization; if (u != null && u > 0) obs.push({ ...s, pred: u }); }
    for (const o of obs) {
      const k = o.input.specialDemandType ?? "없음";
      const g = groups.get(k) ?? { ours: [], riv: [] };
      (o.isOurs ? g.ours : g.riv).push(o); groups.set(k, g);
    }
    console.log(`\n[특수수요 유형별 · 지금 배선] 함의 배수 = median(실측÷예측). 자사·경쟁점이 같은 방향이면 수요 배수, 자사만이면 점유율`);
    console.log(`  유형        자사n  자사편향  자사 함의배수 | 경쟁n  경쟁편향  경쟁 함의배수 | 지금 배수`);
    for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].ours.length - a[1].ours.length)) {
      const imp = (xs: Obs[]) => (xs.length ? Math.exp(med(xs.map((o) => Math.log(o.act / o.pred)))) : NaN);
      const bias = (xs: Obs[]) => (xs.length ? mean(xs.map((o) => o.pred - o.act)) : NaN);
      console.log(`  ${k.padEnd(10)}${String(g.ours.length).padStart(4)}${(bias(g.ours) * 100).toFixed(1).padStart(9)}%p${imp(g.ours).toFixed(2).padStart(10)}배 |`
        + `${String(g.riv.length).padStart(5)}${(bias(g.riv) * 100).toFixed(1).padStart(9)}%p${imp(g.riv).toFixed(2).padStart(10)}배 |`
        + `${String(P.specialDemandMultipliers[k] ?? 1).padStart(8)}`);
    }
    // 대학가 배수 재고 표 — 대학가 매장 5곳과 그 동네 경쟁점, 그리고 전체
    console.log(`\n  [대학가 배수 재고 표] 배수를 바꾸면 대학가 자사·경쟁점 편향과 전체 성적이 어떻게 되나`);
    console.log(`  배수   대학가자사편향  대학가경쟁편향 | 전체 자사MAE 자사r | 전체 경쟁편향 | 자사우위`);
    for (const m of [1.0, 1.2, 1.45, 1.7, 2.0]) {
      const p2: TextbookParams = { ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, "대학가": m } };
      const o2: Obs[] = [];
      for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) o2.push({ ...s, pred: u }); }
      const s = score(o2);
      const uo = o2.filter((o) => o.isOurs && o.input.specialDemandType === "대학가"), ur = o2.filter((o) => !o.isOurs && o.input.specialDemandType === "대학가");
      const bias = (xs: Obs[]) => (xs.length ? mean(xs.map((o) => o.pred - o.act)) : NaN);
      console.log(`  ${m.toFixed(2)}${(bias(uo) * 100).toFixed(1).padStart(12)}%p(${uo.length})${(bias(ur) * 100).toFixed(1).padStart(12)}%p(${ur.length}) |`
        + `${(s.ourMae * 100).toFixed(2).padStart(9)}%p${s.ourR.toFixed(3).padStart(7)} |${(s.rivBias * 100).toFixed(1).padStart(9)}%p |${s.gapPred.toFixed(2).padStart(7)}배`
        + (m === (P.specialDemandMultipliers["대학가"] ?? 1) ? "  ← 지금" : ""));
    }
    // 2026-09-24 사용자: *"기본적으로 대학쪽이 가동률이 낮게 나오는데 배수 좀 늘려도 되는 거 아닌가"* — 매장별로 어디가 얼마나.
    console.log(`\n  [특수수요 매장별 — 배수 1.0 vs 1.3 vs 1.5] 오차 = 예측 − 실측 %p. 경쟁점은 1:1(그 매장 예측 vs 그 매장 핑봇)`);
    for (const type of ["대학가", "산업단지", "관광·유흥"]) {
      const at = (m: number) => { const p2: TextbookParams = { ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, [type]: m } }; return new Map(subjects.map((s) => [s.input.storeCode, computeTextbook(s.input, p2).utilization])); };
      const u10 = at(1.0), u13 = at(1.3), u15 = at(1.5);
      const grp = subjects.filter((s) => s.input.specialDemandType === type).sort((a, b) => Number(b.isOurs) - Number(a.isOurs));
      if (!grp.length) continue;
      console.log(`  ── ${type} ──`);
      for (const s of grp) {
        const e = (m: Map<string, number | null>) => { const u = m.get(s.input.storeCode); return u == null ? "    -" : `${((u - s.act) * 100).toFixed(1).padStart(6)}`; };
        console.log(`     ${s.isOurs ? "자사" : "경쟁"} ${(s.input.storeName ?? "").slice(0, 12).padEnd(12)} 실측 ${(s.act * 100).toFixed(1).padStart(5)}%  1.0 ${e(u10)}  1.3 ${e(u13)}  1.5 ${e(u15)}`);
      }
    }
    console.log(`\n  ⭐ 읽는 법 — 대학가 **경쟁점** 편향도 음수면 그 동네 수요가 작은 것이라 배수가 정당하다. 경쟁점 편향이 0인데 자사만 음수면 배수가 아니다.`);
    console.log(`     n이 5곳(자사)·몇 곳(경쟁점)이라 값은 못 고른다 — 방향만 본다. 값은 사용자와 정한다.`);

    // ── (7b) 사용자(2026-09-23): "특수상권 배수 켤 수 있는 건 켜보자 — 대학상권·군인·산업단지" ──
    // 유형마다 배수를 훑어 **자사·경쟁점 편향이 같이 0에 가까운 값**을 찍는다(사전 기준: |자사편향|+|경쟁편향| 최소,
    // 둘 다 ±3%p 안이면 통과). 다른 유형은 지금 값 그대로 두고 한 유형만 바꾼다(유형 간 간섭 없음 — 배수는 그 유형에만 곱한다).
    console.log(`\n  [유형별 배수 재고 표] 한 유형만 바꾸고 나머지는 지금 값. * = 자사·경쟁점 편향 둘 다 ±3%p 안`);
    for (const type of ["대학가", "산업단지", "군부대"]) {
      const cands = type === "군부대" ? [1.0, 1.5, 1.75, 2.0, 2.25, 2.5] : [1.0, 1.2, 1.3, 1.4, 1.5, 1.7, 2.0];
      console.log(`  ── ${type} (지금 ${P.specialDemandMultipliers[type] ?? 1}) ──   배수   자사편향(n)   경쟁편향(n)   |합|   전체 자사MAE 자사r`);
      let best: { m: number; sum: number } | null = null;
      for (const m of cands) {
        const p2: TextbookParams = { ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, [type]: m } };
        const o2: Obs[] = [];
        for (const s of subjects) { const u = computeTextbook(s.input, p2).utilization; if (u != null && u > 0) o2.push({ ...s, pred: u }); }
        const sc = score(o2);
        const uo = o2.filter((o) => o.isOurs && o.input.specialDemandType === type), ur = o2.filter((o) => !o.isOurs && o.input.specialDemandType === type);
        const bias = (xs: Obs[]) => (xs.length ? mean(xs.map((o) => o.pred - o.act)) : NaN);
        const bo = bias(uo), br = bias(ur), sum = Math.abs(bo) + (Number.isFinite(br) ? Math.abs(br) : 0);
        const pass = Math.abs(bo) <= 0.03 && (!Number.isFinite(br) || Math.abs(br) <= 0.03);
        if (!best || sum < best.sum) best = { m, sum };
        console.log(`  ${"".padEnd(24)}${m.toFixed(2).padStart(6)}${(bo * 100).toFixed(1).padStart(9)}%p(${uo.length})${(br * 100).toFixed(1).padStart(9)}%p(${ur.length})`
          + `${(sum * 100).toFixed(1).padStart(7)}${(sc.ourMae * 100).toFixed(2).padStart(12)}%p${sc.ourR.toFixed(3).padStart(7)}${pass ? "  *" : ""}`
          + (m === (P.specialDemandMultipliers[type] ?? 1) ? "  ← 지금" : ""));
      }
      if (best) console.log(`  ${"".padEnd(24)}→ |합| 최소: ${best.m.toFixed(2)}  (표본이 작으면 값이 아니라 방향으로 읽을 것)`);
    }
    expect(obs.length).toBeGreaterThan(40);
  });

  it("(8) ⭐⭐ 막힌 상권 보정 — AI 판정(막힌 방향 수)으로 고리를 깎으면", () => {
    // 사용자(2026-09-23): 항아리상권은 AI 자동화로. scripts/tradeArea → .local-tools/trade-area-judgments.json (또는 스냅샷 컬렉션).
    // 고리 인구 × (1 − 막힌 방향 수 ÷ 4). 사실 개수라 맞춘 계수가 없다. ⚠️ AI 판정은 사람 표본 대조 전이다.
    // 2차(사용자 정의): 항아리 = 반경 밖에 상권·동네가 없다 → ringCutCount = 고리에 주거 없는 방향 수. 1차 단절(blockedCount)은 참고.
    type J = { code?: string; name?: string; blockedCount?: number | null; ringCutCount?: number | null; residentialNote?: Record<string, string>; otherCommercialWithin2km?: boolean | null; error?: string };
    const fromSnap = ((snap.labTradeAreaJudgments ?? []) as J[]);
    const file = ".local-tools/trade-area-judgments.json";
    const fromFile = existsSync(file) ? (Object.values((JSON.parse(readFileSync(file, "utf8")) as { sites?: Record<string, J> }).sites ?? {}) as J[]) : [];
    const judged = fromSnap.length ? fromSnap : fromFile;
    const blockedByCode = new Map<string, number>();
    for (const j of judged) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") blockedByCode.set(String(j.code), c); }
    const basis = judged.some((j) => typeof j.ringCutCount === "number") ? "고리에 주거 없는 방향(2차·사용자 정의)" : "단절 방향(1차)";
    console.log(`\n[막힌 상권 보정] 판정 ${blockedByCode.size}곳 (출처: ${fromSnap.length ? "스냅샷" : "로컬 파일"} · 기준: ${basis})`);
    if (!blockedByCode.size) { console.log("  판정 자료가 없다 — judge.mjs를 먼저 돌린다"); return; }
    const hist = [0, 1, 2, 3, 4].map((k) => `${k}방향 ${[...blockedByCode.values()].filter((v) => v === k).length}곳`).join(" · ");
    console.log(`  깎는 방향 수 분포: ${hist} · 2km 안 유일 상권: ${judged.filter((j) => j.otherCommercialWithin2km === false).length}곳`);
    const withJ = (s: Subject): TextbookInput => ({ ...s.input, ringBlockedDirections: blockedByCode.get(s.code) ?? null });
    const runE = (on: boolean): Obs[] => {
      const p2: TextbookParams = { ...P, useRingEnclosure: on };
      const out: Obs[] = [];
      for (const s of subjects) { const u = computeTextbook(withJ(s), p2).utilization; if (u != null && u > 0) out.push({ ...s, pred: u }); }
      return out;
    };
    const off = runE(false), on = runE(true);
    const so = score(off), sn = score(on);
    // 변형 C — 사용자 정의 그대로: "2km 안 다른 상권 없음(유일 상권)"이면 항아리 → 고리를 통째로 끈다(방향 4)
    const solo = new Set(judged.filter((j) => j.otherCommercialWithin2km === false && j.code).map((j) => String(j.code)));
    const runSolo = (): Obs[] => {
      const p2: TextbookParams = { ...P, useRingEnclosure: true };
      const out: Obs[] = [];
      for (const s of subjects) {
        const cut = solo.has(s.code) ? 4 : (blockedByCode.get(s.code) ?? null);
        const u = computeTextbook({ ...s.input, ringBlockedDirections: cut }, p2).utilization;
        if (u != null && u > 0) out.push({ ...s, pred: u });
      }
      return out;
    };
    const soloObs = runSolo(), ss = score(soloObs);
    console.log(`  유일 상권 ${solo.size}곳: ${judged.filter((j) => solo.has(String(j.code ?? ""))).map((j) => j.name).join(" · ")}`);
    const sdP = (g: Obs[]) => sdOf(g.map((o) => o.pred)) * 100;
    const w5 = (g: Obs[]) => g.filter((o) => Math.abs(o.pred - o.act) <= 0.05).length;
    const line8 = (label: string, s: Score, g: Obs[]) => console.log(`  ${label.padEnd(8)} 자사 MAE ${(s.ourMae * 100).toFixed(2)}%p 편향 ${(s.ourBias * 100).toFixed(1)} r ${s.ourR.toFixed(3)} 예측SD ${sdP(s.ours).toFixed(1)} ±5%p ${w5(s.ours)} | 경쟁 MAE ${(s.rivMae * 100).toFixed(1)} 편향 ${(s.rivBias * 100).toFixed(1)} | 짝r ${s.pairR.toFixed(3)} | 자사우위 ${s.gapPred.toFixed(2)}`
      + (g.length ? "" : ""));
    line8("끔(지금)", so, off); line8("켬", sn, on); line8("켬+유일상권 고리0", ss, soloObs);
    const soloBy = new Map(soloObs.map((o) => [o.input.storeCode, o]));
    console.log(`  [유일 상권 자사 매장] 실측 / 끔 / 켬 / 켬+고리0`);
    for (const o of off.filter((x) => x.isOurs && solo.has(x.code))) {
      const onP = on.find((x) => x.input.storeCode === o.input.storeCode)?.pred ?? 0;
      console.log(`  ${o.hood.padEnd(10)} 실측 ${(o.act * 100).toFixed(1)}% · 끔 ${(o.pred * 100).toFixed(1)}% · 켬 ${(onP * 100).toFixed(1)}% · 고리0 ${((soloBy.get(o.input.storeCode)?.pred ?? 0) * 100).toFixed(1)}%`);
    }
    console.log(`\n  [매장별 — 막힌 방향 2 이상인 자사 매장] 실측 / 끔 / 켬`);
    const onBy = new Map(on.map((o) => [o.input.storeCode, o]));
    for (const o of off.filter((x) => x.isOurs && (blockedByCode.get(x.code) ?? 0) >= 2).sort((a, b) => (blockedByCode.get(b.code) ?? 0) - (blockedByCode.get(a.code) ?? 0))) {
      const j = judged.find((x) => String(x.code) === o.code);
      const dirs = j?.residentialNote ? Object.entries(j.residentialNote).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ") : "";
      console.log(`  ${o.hood.padEnd(10)} 깎음 ${blockedByCode.get(o.code)}/4 [${dirs}] 유일상권 ${j?.otherCommercialWithin2km === false ? "예" : "아니오"}  실측 ${(o.act * 100).toFixed(1)}% · 끔 ${(o.pred * 100).toFixed(1)}% · 켬 ${((onBy.get(o.input.storeCode)?.pred ?? 0) * 100).toFixed(1)}%`);
    }
    console.log(`\n  ⭐ 읽는 법 — 켰을 때 자사 MAE·예측 SD·최악이 줄고 편향이 크게 안 움직이면 판정이 일하는 것. 구미산동이 2방향 이상이어야 사용자 감각과 맞다.`);
    console.log(`  ⚠️ 판정이 사람 대조 전이면 채택하지 않는다. 대조용 표본: 막힌 방향 3~4 매장 + 0 매장 몇 곳.`);
    expect(off.length).toBeGreaterThan(40);
  });
});
