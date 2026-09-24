// 층 가르기 — 가동률 오차가 큰 매장부터 "수요 층"과 "점유율 층" 어느 쪽이 틀렸나 (2026-09-24 집 PC)
//
// ── 왜 ───────────────────────────────────────────────────────────────────
// 사용자(2026-09-24 퇴근 전): *"가동률차 나는 거 보완할 방안 찾기, 오차 큰 것부터 어떤 요소로 잡을지."*
// 산식은 두 층이다:  가동률 = (동네 수요시간 ÷ 자사 좌석시간) × 우리 몫
//                    ─── 수요 층 ("수요 전부라면") ───   ─ 점유율 층 ─
// 자사 실측 하나로는 두 층을 못 가른다 — 예측÷실측이 곧 점유율 비이기도 하고 수요 비이기도 하다(항등).
// 그래서 **바깥 증거**로 가른다:
//   (a) 필요 점유율 = 실측 이용시간 ÷ 산식 수요시간. 1을 넘으면 동네를 전부 먹어도 모자란다 → 수요 층이 틀렸다(확정)
//   (b) 동네 실측 하한(자사 실측시간 + 핑봇 잡힌 경쟁점 실측시간) ÷ 산식 수요시간. 1을 넘으면 수요 층이 틀렸다(확정)
//   (c) 같은 동네 경쟁점 1:1(경쟁점 A 예측 vs A 핑봇). 경쟁점도 우리와 같은 방향으로 틀리면 그 동네 **수요**가 틀린 것이고,
//       경쟁점은 맞는데 우리만 틀리면 **점유율**(품질비·입지·경쟁 무게)이 틀린 것이다
//
// ── ⚠️ 사전 등록 — 자료를 보기 전에 정한 판정 규칙. 고치지 말 것 ──────────────
//   1. (a) 또는 (b)가 1을 넘으면 → "수요↓ 확정"
//   2. 아니면 (c): 핑봇 경쟁점이 1곳 이상이고, 경쟁점 평균 편향이 자사 오차와 **같은 부호**이며 |경쟁 편향| ≥ 3%p → "수요"
//                  경쟁점 평균 편향이 반대 부호이거나 |경쟁 편향| < 3%p → "점유율"
//   3. 핑봇 경쟁점이 없으면 → "미판정(바깥 증거 없음)" — 필요 점유율·산식 점유율만 적고 판정하지 않는다
//   ⚠️ 핑봇은 1:1 대조에만 쓴다(사용자 2026-09-24). 핑봇 평균으로 자사우위 배수를 만들지 않는다.
//   ⚠️ 여기서 계수를 고치지 않는다. 운영 V62는 안 건드린다. 튀는 매장(송도·구미산동·동탄북광장·전대후문)은 빼지 않고 라벨.
//
// ── 자료 ─────────────────────────────────────────────────────────────────
//   화면(/store-eval/lab)과 **같은 조립** — QSC 관리점수·고리 인구·항아리 판정을 스냅샷 컬렉션에서 싣는다(_labCandidate와 같음).
//   _bundleCandidate는 QSC를 안 싣는다(그래서 (0) 검산 5.84%p가 뜻을 유지한다) — 여기 숫자와 소수점이 다를 수 있다.
//
// 실행: npx vitest run src/lib/storeEval/_layerSplit.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, qscInWindowAverage, rivalQualityParts, utilizationByStore, type QscRecord } from "./labInput";
import type { CandidateInput, LocationEvaluation } from "./types";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_UNSURVEYED_PC_COUNT, computeLocationScoreFromFacts } from "./calc";
import { existingSiteKey, operatingShareInWindow, rival2kmRecords } from "./rival2km";
import { evaluationMonths } from "./evaluationSalesPeriod";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeQualityScore, computeTextbook, fittedParams, rivalDistanceWeight, scoreTextbook,
  type QualityParts, type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const MONTH_HOURS = 720;
const LABELED = new Set(["송도점", "구미산동점", "동탄북광장점", "전대후문점"]);
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const pp = (v: number | null | undefined, w = 6, d = 1) => (v == null || !Number.isFinite(v) ? "-".padStart(w) : `${(v * 100).toFixed(d)}`.padStart(w));
const num = (v: number | null | undefined, w = 6, d = 0) => (v == null || !Number.isFinite(v) ? "-".padStart(w) : v.toFixed(d).padStart(w));
const nm = (s: string | null | undefined, w = 10) => {
  // 한글은 두 칸이라 표가 어긋난다 — 글자 수가 아니라 폭으로 맞춘다.
  const t = (s ?? "").slice(0, w);
  const width = [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  return t + " ".repeat(Math.max(0, w * 2 - width - w));
};

describeIf("층 가르기 — 수요 층 vs 점유율 층", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));

  // QSC — 화면과 같은 값(스냅샷 storeEvalLabQscScores)
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const qscByStoreCode = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as QscSite[]) {
    const code = doc.storeCode ?? doc.id;
    const avg = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null);
    if (code && avg != null) qscByStoreCode.set(code, avg);
  }
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) {
    const c = j.ringCutCount ?? j.blockedCount;
    if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c);
  }
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode });
  const P: TextbookParams = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
  // 후보지 13곳 — 점유율 항을 바꾸면 후보지도 움직이므로 (4) 실험의 세 번째 잣대로 같이 찍는다(_labCandidate와 같은 조립).
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locByCode = new Map<string, LocationEvaluation>(((snap.locationEvaluations ?? []) as LocationEvaluation[]).map((l) => [l.candidateCode, l]));
  const candRows = buildLabCandidateRows({
    candidates, compsByCode, locByCode, settings, franchiseManagement: franchiseManagementFromRows(rows), residentRingsByCode, ringBlockedByCode,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;
  const pcOf = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;

  // ── 경쟁점 1:1 주인공 — _bundleCandidate와 같은 조립(거리는 경쟁점 기준으로 다시 잼, 2km 경쟁점 포함) ──
  type RivalObs = { name: string; act: number; pred: number; distM: number; input: TextbookInput };
  // 입력은 한 번 조립하고, 예측은 파라미터마다 다시 낸다((4) 실험이 θ·감쇠를 바꿔 가며 경쟁점 편향을 재야 한다).
  const rivalInputsByCode = new Map<string, { name: string; act: number; distM: number; input: TextbookInput }[]>();
  const rivalObsFor = (p2: TextbookParams): Map<string, RivalObs[]> => {
    const m = new Map<string, RivalObs[]>();
    for (const [code, list] of rivalInputsByCode) {
      const out: RivalObs[] = [];
      for (const x of list) { const u = computeTextbook(x.input, p2).utilization; if (u != null && u > 0) out.push({ ...x, pred: u }); }
      m.set(code, out);
    }
    return m;
  };
  for (const r of rows) {
    const st = storeByCode.get(r.input.storeCode);
    if (!st?.lat || !st?.lng || !(r.input.pcCount ?? 0)) continue;
    const comps: { c: Competitor; lat: number; lng: number; pc: number }[] = [];
    for (const c of compsByCode.get(r.input.storeCode) ?? []) {
      if (c.investigationStatus === "경쟁점없음") continue;
      const pc = pcOf(c);
      if (c.lat == null || c.lng == null || !(pc && pc > 0)) continue;
      comps.push({ c, lat: c.lat, lng: c.lng, pc });
    }
    const months = evaluationMonths(st.openedAt);
    const out: { name: string; act: number; distM: number; input: TextbookInput }[] = [];
    comps.forEach((me, k) => {
      const pv = ping(me.c);
      if (pv == null || !(pv > 0)) return;
      const twoKm = rival2kmRecords(existingSiteKey(r.input.storeCode))
        .map((x) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * operatingShareInWindow(x, months), distanceM: distM(me.lat, me.lng, x.lat, x.lng), parts: null as QualityParts | null, name: x.name }))
        .filter((x) => x.ip > 0);
      const rivals: NonNullable<TextbookInput["rivals"]> = [
        { ip: r.input.pcCount as number, distanceM: distM(me.lat, me.lng, st.lat!, st.lng!), parts: r.input.ownQualityParts, name: r.input.storeName },
        ...comps.filter((_, j) => j !== k).map((o) => ({ ip: o.pc, distanceM: distM(me.lat, me.lng, o.lat, o.lng), parts: rivalQualityParts(o.c, settings), name: o.c.name ?? null })),
        ...twoKm,
      ];
      const input: TextbookInput = {
        ...r.input, storeCode: `riv:${me.c.id}`, storeName: me.c.name ?? "(이름없음)", pcCount: me.pc,
        hourlyRate: me.c.hourlyRateConverted ?? r.input.hourlyRate, actualUtilization: null,
        ownQualityParts: rivalQualityParts(me.c, settings), rivals,
        competitorIp: rivals.reduce((s, x) => s + x.ip, 0), competitorCount: rivals.length,
        location: r.input.location ? {
          centrality: r.input.location.centrality,
          access: computeLocationScoreFromFacts(me.c.floor ?? null, me.c.groundLevel ?? null, me.c.hasElevator ?? null),
          direction: null, flowBlock: null, visibility: null,
        } : null,
      };
      out.push({ name: me.c.name ?? "(이름없음)", act: pv / 100, distM: distM(me.lat, me.lng, st.lat!, st.lng!), input });
    });
    rivalInputsByCode.set(r.input.storeCode, out);
  }
  const rivalObsByCode = rivalObsFor(P);

  // ── 동네 실측 하한 — _bundleCandidate `sites`와 같은 조립(핑봇 2곳 이상 · 핑봇 달의 우리 실측 월) ──
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
  const measuredLowByCode = new Map<string, { hours: number; n: number }>();
  for (const r of rows) {
    const code = r.input.storeCode;
    const cs = (compsByCode.get(code) ?? []).filter((c) => (ping(c) ?? 0) > 0 && (pcOf(c) ?? 0) > 0);
    if (cs.length < 2) continue;
    const months = cs.map(pingMonth).filter((x): x is string => !!x);
    const ym = months.length ? med(months.map((m) => Number(m.replace("-", "")))) : null;
    const ymStr = ym ? `${String(ym).slice(0, 4)}-${String(ym).slice(4)}` : null;
    const ourUtil = ymStr ? panel.get(code)?.get(ymStr) : undefined;
    const ourPc = r.input.pcCount ?? 0;
    if (!ymStr || ourUtil == null || !(ourUtil > 0) || !(ourPc > 0)) continue;
    const pingHours = cs.reduce((a, c) => a + (pcOf(c) as number) * MONTH_HOURS * ((ping(c) as number) / 100), 0);
    measuredLowByCode.set(code, { hours: ourPc * MONTH_HOURS * ourUtil + pingHours, n: cs.length });
  }

  // 경쟁점 47곳 전체의 1:1 편향 중앙값 — 경쟁점은 **어디서나** 과소예측된다(θ 문제, 인계 −10.9%p). 그래서 규칙 2의
  // "경쟁점도 같은 방향"은 이 바닥을 뺀 값으로도 본다(보정 판정). 원 규칙(사전 등록)과 보정 판정을 둘 다 적는다.
  const allRivalErr = [...rivalObsByCode.values()].flat().map((x) => x.pred - x.act);
  const rivalFloor = allRivalErr.length ? med(allRivalErr) : 0;

  // ── 매장별 층 분해 ──────────────────────────────────────────────────────
  type Split = {
    code: string; name: string; type: string; pc: number; act: number; pred: number; err: number;
    demandHours: number; utilIfAll: number; requiredShare: number; share: number; coreShare: number; locMul: number;
    rivN: number; rivBias: number | null; rivBiasAdj: number | null; rivNames: string; rivalW: number; rivalPcIn: number; nIn: number;
    pop1km: number | null;
    lowRatio: number | null; lowN: number;
    verdict: string; verdictAdj: string; labeled: boolean;
  };
  const splits: Split[] = [];
  for (const r of rows) {
    const a = r.input.actualUtilization;
    if (a == null || !(a > 0)) continue;
    const b = computeTextbook(r.input, P);
    if (b.utilization == null || b.totalDemandHours == null || b.share == null || !(r.input.pcCount ?? 0)) continue;
    const pc = r.input.pcCount as number;
    const utilIfAll = b.totalDemandHours / (pc * MONTH_HOURS);
    const requiredShare = a / utilIfAll;
    const locMul = b.locationMultiplier ?? 1;
    const coreShare = locMul > 0 ? b.share / locMul : b.share; // 상한 1에 걸리면 정확하지 않다(표시용)
    const rv = rivalObsByCode.get(r.input.storeCode) ?? [];
    const rivBias = rv.length ? mean(rv.map((x) => x.pred - x.act)) : null;
    const rivBiasAdj = rivBias == null ? null : rivBias - rivalFloor;
    const low = measuredLowByCode.get(r.input.storeCode);
    const lowRatio = low ? low.hours / b.totalDemandHours : null;
    const err = b.utilization - a;
    // 경쟁 무게 — 산식 분모의 경쟁 항을 그대로 다시 계산(품질비^θ × 거리 감쇠)
    const oq = r.input.ownQualityParts ? computeQualityScore(r.input.ownQualityParts, P.qualityWeights) : null;
    let rivalW = 0, rivalPcIn = 0, nIn = 0;
    for (const v of r.input.rivals ?? []) {
      if (!(v.ip > 0)) continue;
      const w = rivalDistanceWeight(v.distanceM, P);
      if (w <= 0) continue;
      nIn += 1; rivalPcIn += v.ip;
      const q = oq && oq > 0 && v.parts ? (computeQualityScore(v.parts, P.qualityWeights) ?? oq) / oq : 1;
      rivalW += v.ip * Math.pow(q, P.qualityExponent) * w;
    }
    const judge = (rb: number | null): string => {
      if (requiredShare > 1) return "수요↓ 확정(전부 먹어도 모자람)";
      if (lowRatio != null && lowRatio > 1) return "수요↓ 확정(동네 실측시간 > 산식수요)";
      if (!rv.length || rb == null) return "미판정(핑봇 없음)";
      if (Math.sign(rb) === Math.sign(err) && Math.abs(rb) >= 0.03) return err < 0 ? "수요↓ (경쟁점도 과소)" : "수요↑ (경쟁점도 과대)";
      return "점유율 (경쟁점은 맞음)";
    };
    splits.push({
      code: r.input.storeCode, name: r.input.storeName ?? r.input.storeCode, type: r.input.specialDemandType ?? "없음", pc, act: a, pred: b.utilization, err,
      demandHours: b.totalDemandHours, utilIfAll, requiredShare, share: b.share, coreShare, locMul,
      rivN: rv.length, rivBias, rivBiasAdj, rivNames: rv.map((x) => `${x.name.slice(0, 8)} ${((x.pred - x.act) * 100).toFixed(0)}`).join(" · "), rivalW, rivalPcIn, nIn,
      pop1km: r.input.pop1km ?? null,
      lowRatio, lowN: low?.n ?? 0, verdict: judge(rivBias), verdictAdj: judge(rivBiasAdj), labeled: LABELED.has(r.input.storeName ?? ""),
    });
  }
  splits.sort((x, y) => Math.abs(y.err) - Math.abs(x.err));
  const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b), s = sdOf(a) * sdOf(b); return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN; };

  it("(1) ⭐⭐⭐ 매장별 층 가르기 — 가동률 오차 큰 순", () => {
    console.log(`\n[층 가르기 · 자사 ${splits.length}곳 · 지금 기본값 θ${P.qualityExponent} 존 ${P.qualityWeights.zone} λ${P.residentRingDecayM} 배수 ${Object.entries(P.specialDemandMultipliers).filter(([, v]) => v !== 1).map(([k, v]) => `${k} ${v}`).join("·")}]`);
    console.log(`  MAE ${(mean(splits.map((s) => Math.abs(s.err))) * 100).toFixed(2)}%p (화면 조립 · QSC 포함) · ±5%p ${splits.filter((s) => Math.abs(s.err) <= 0.05).length} · ±10%p ${splits.filter((s) => Math.abs(s.err) <= 0.10).length}`);
    console.log(`  수요전부 = 동네 수요를 전부 먹었을 때 가동률 · 필요점유 = 실측÷수요전부 · 산식점유 = 핵심점유 × 입지 · 경쟁편향 = 그 동네 핑봇 경쟁점 1:1 평균(예측−실측) · 하한÷수요 = (자사+핑봇 실측시간)÷산식수요`);
    console.log(`  경쟁점 1:1 편향 바닥(전체 ${allRivalErr.length}곳 중앙) ${(rivalFloor * 100).toFixed(1)}%p — "보정" 열은 이 바닥을 뺀 경쟁편향으로 규칙 2를 다시 적용한 것`);
    console.log(`  ${"이름".padEnd(10)}  유형     PC  실측   예측   오차 | 수요전부 필요점유 산식점유 (핵심 ×입지) | 핑봇n 경쟁편향  보정  하한÷수요 | 판정(원 규칙) → 보정 판정`);
    for (const s of splits) {
      const v = s.verdict === s.verdictAdj ? s.verdict : `${s.verdict} → ${s.verdictAdj}`;
      console.log(`  ${nm(s.name)}${s.labeled ? "*" : " "} ${nm(s.type, 4)}${num(s.pc, 4)}${pp(s.act)}${pp(s.pred)}${pp(s.err)} |${pp(s.utilIfAll, 8)}%${pp(s.requiredShare, 8)}%${pp(s.share, 8)}% (${pp(s.coreShare, 5)}% ×${s.locMul.toFixed(2)}) |${num(s.rivN, 5)}${s.rivBias == null ? "       -" : pp(s.rivBias, 8) + "p"}${s.rivBiasAdj == null ? "      -" : pp(s.rivBiasAdj, 6) + "p"}${s.lowRatio == null ? "        -" : num(s.lowRatio, 8, 2) + "배"} | ${v}`);
    }
    console.log(`  * = 라벨 매장(기전 확인·빼지 않음)`);
    const count = (pick: (s: Split) => string, pred: (v: string) => boolean, g = splits) => g.filter((s) => pred(pick(s))).length;
    const tally = (label: string, pick: (s: Split) => string, g = splits) =>
      `${label}: 수요 ${count(pick, (v) => v.startsWith("수요"), g)} · 점유율 ${count(pick, (v) => v.startsWith("점유율"), g)} · 미판정 ${count(pick, (v) => v.startsWith("미판정"), g)}`;
    const big = splits.filter((s) => Math.abs(s.err) > 0.05);
    console.log(`\n  판정 집계(전체 ${splits.length}곳)  ${tally("원 규칙", (s) => s.verdict)}  |  ${tally("보정", (s) => s.verdictAdj)}`);
    console.log(`  |오차| > 5%p ${big.length}곳          ${tally("원 규칙", (s) => s.verdict, big)}  |  ${tally("보정", (s) => s.verdictAdj, big)}`);
    console.log(`  ⭐ 읽는 법 — 오차 큰 매장이 "수요"에 몰리면 수요식(주거·유동·배수) 항목을, "점유율"에 몰리면 품질비·입지·경쟁 무게를 본다. 미판정은 자료를 더 받아야 한다.`);
    expect(splits.length).toBeGreaterThan(30);
  });

  it("(3) ⭐⭐⭐ 패턴 — 오차가 어느 층의 크기와 같이 움직이나 (수요전부 가동률·경쟁 무게·주거 1km)", () => {
    // 층 가르기 표를 보면 "수요전부 가동률"이 낮은 소도시 매장은 과소, 높은 밀집 매장은 과대로 보인다. 감각이 아니라 상관으로 잰다.
    const err = splits.map((s) => s.err);
    const line = (label: string, x: number[]) => console.log(`  ${label.padEnd(34)} r = ${corr(x, err).toFixed(3)}`);
    console.log(`\n[오차(예측−실측 %p)와의 상관 · 자사 ${splits.length}곳] 음수 = 그 값이 클수록 과소예측`);
    line("log(수요전부 가동률)", splits.map((s) => Math.log(s.utilIfAll)));
    line("log(주거 1km 인구)", splits.map((s) => Math.log(Math.max(1, s.pop1km ?? 1))));
    line("log(유효거리 안 경쟁 PC ÷ 자사 PC)", splits.map((s) => Math.log(Math.max(1, s.rivalPcIn) / s.pc)));
    line("log(경쟁 무게 ÷ 자사 PC)", splits.map((s) => Math.log(Math.max(0.5, s.rivalW) / s.pc)));
    line("필요 점유율", splits.map((s) => s.requiredShare));
    line("산식 점유율", splits.map((s) => s.share));
    line("입지 배율", splits.map((s) => s.locMul));
    line("실측 가동률", splits.map((s) => s.act));

    // 구간표 — 수요전부 가동률(=동네 수요 ÷ 자사 좌석) 세 구간
    console.log(`\n  [수요전부 가동률 구간별] 동네 수요가 자사 좌석에 비해 작은 곳 → 큰 곳`);
    console.log(`  구간            n   평균오차  MAE   평균 필요점유  평균 산식점유  상한(100%) 걸린 곳  매장`);
    const bands: [string, (s: Split) => boolean][] = [
      ["< 45%(소도시)", (s) => s.utilIfAll < 0.45],
      ["45~90%", (s) => s.utilIfAll >= 0.45 && s.utilIfAll < 0.9],
      ["≥ 90%(밀집)", (s) => s.utilIfAll >= 0.9],
    ];
    for (const [label, f] of bands) {
      const g = splits.filter(f);
      if (!g.length) continue;
      console.log(`  ${label.padEnd(14)}${num(g.length, 4)}${pp(mean(g.map((s) => s.err)), 9)}%p${pp(mean(g.map((s) => Math.abs(s.err))), 6)}${pp(mean(g.map((s) => s.requiredShare)), 12)}%${pp(mean(g.map((s) => s.share)), 12)}%${num(g.filter((s) => s.share >= 0.999).length, 10)}곳   ${g.map((s) => `${s.name.replace(/점$/, "")} ${(s.err * 100).toFixed(0)}`).join(" · ")}`);
    }
    // 같은 표를 경쟁 밀도로
    console.log(`\n  [유효거리 안 경쟁 PC ÷ 자사 PC 구간별]`);
    console.log(`  구간            n   평균오차  MAE   평균 핵심점유  경쟁 무게÷경쟁PC  매장`);
    const bands2: [string, (s: Split) => boolean][] = [
      ["< 5배", (s) => s.rivalPcIn / s.pc < 5],
      ["5~12배", (s) => s.rivalPcIn / s.pc >= 5 && s.rivalPcIn / s.pc < 12],
      ["≥ 12배", (s) => s.rivalPcIn / s.pc >= 12],
    ];
    for (const [label, f] of bands2) {
      const g = splits.filter(f);
      if (!g.length) continue;
      console.log(`  ${label.padEnd(14)}${num(g.length, 4)}${pp(mean(g.map((s) => s.err)), 9)}%p${pp(mean(g.map((s) => Math.abs(s.err))), 6)}${pp(mean(g.map((s) => s.coreShare)), 12)}%${num(mean(g.map((s) => (s.rivalPcIn > 0 ? s.rivalW / s.rivalPcIn : 0))), 14, 3)}   ${g.map((s) => `${s.name.replace(/점$/, "")} ${(s.err * 100).toFixed(0)}`).join(" · ")}`);
    }
    console.log(`\n  ⭐ 읽는 법 — 수요전부 가동률과의 상관이 뚜렷히 양수면 "동네 수요 크기 차이를 산식이 과장"하고 있다(소도시 수요는 너무 작게, 밀집 수요는 너무 크게).`);
    console.log(`     그건 배수 하나(특수수요)가 아니라 **수요 반경**(소도시는 1km보다 넓게 온다) 또는 **점유율 눈금**(밀집에서 경쟁 무게가 감쇠·θ로 너무 깎임) 문제다.`);
    console.log(`     경쟁 무게÷경쟁PC가 0.1 안팎이면 유효거리 안 경쟁 PC의 90%가 감쇠·품질비^θ로 사라진 것이다.`);
    expect(err.length).toBeGreaterThan(30);
  });

  it("(2) ⭐⭐ 최악 8곳 요소 분해 — 어느 항목이 얼마나 움직여야 맞나", () => {
    const worst = splits.slice(0, 8);
    console.log(`\n[최악 8곳 요소 분해] 각 층을 "맞다"고 가정했을 때 다른 층이 몇 배여야 실측이 나오나`);
    for (const s of worst) {
      const r = rows.find((x) => x.input.storeCode === s.code)!;
      const b = computeTextbook(r.input, P);
      const inp = r.input;
      const oq = inp.ownQualityParts ? computeQualityScore(inp.ownQualityParts, P.qualityWeights) : null;
      const { rivalW, rivalPcIn: rivalPcRaw, nIn } = s;
      const qratios: number[] = [];
      for (const v of inp.rivals ?? []) {
        if (!(v.ip > 0) || rivalDistanceWeight(v.distanceM, P) <= 0) continue;
        qratios.push(oq && oq > 0 && v.parts ? (computeQualityScore(v.parts, P.qualityWeights) ?? oq) / oq : 1);
      }
      const own = s.pc;
      // 수요가 맞다면: 필요 점유율을 내려면 경쟁 무게가 몇 배여야 하나 (입지배율은 그대로)
      const targetCore = Math.min(1, s.requiredShare / (s.locMul || 1));
      const rivalWNeeded = targetCore > 0 && targetCore < 1 ? own * (1 / targetCore - 1) : NaN;
      // 점유율이 맞다면: 수요가 몇 배여야 하나
      const demandNeeded = s.act / s.pred;
      const sdMul = P.specialDemandMultipliers[inp.specialDemandType ?? "없음"] ?? 1;
      const rv = rivalObsByCode.get(s.code) ?? [];
      // 1km 밖 인구(고리 자료가 있으면) — 소도시 매장은 1km 안이 작고 밖이 크다는 걸 숫자로
      const sumAges = (a: NonNullable<TextbookInput["residentAges"]>) => a.age0s + a.age10s + a.age20s + a.age30s + a.age40s + a.age50s + a.age60plus;
      const cum = inp.residentAgesByRadius;
      const popRings = inp.residentAges && cum
        ? ([1500, 2000, 5000] as const).map((rad) => cum[rad] ? `${(rad / 1000).toFixed(1)}km ×${(sumAges(cum[rad]!) / Math.max(1, sumAges(inp.residentAges!))).toFixed(2)}` : null).filter(Boolean).join(" · ")
        : "고리 자료 없음";
      // 500m 조사 경쟁점과 2km 경쟁점(기본대수·품질 없음)을 갈라 본다 — 유효거리는 exp 감쇠라 전부 "안"이다
      const near = (inp.rivals ?? []).filter((v) => v.ip > 0 && (v.distanceM ?? 9e9) <= 500);
      const nearW = near.reduce((acc, v) => {
        const q = oq && oq > 0 && v.parts ? (computeQualityScore(v.parts, P.qualityWeights) ?? oq) / oq : 1;
        return acc + v.ip * Math.pow(q, P.qualityExponent) * rivalDistanceWeight(v.distanceM, P);
      }, 0);
      const nearPc = near.reduce((acc, v) => acc + v.ip, 0);
      console.log(`\n  ── ${s.name}${s.labeled ? " *라벨" : ""} (${s.type}) 실측 ${(s.act * 100).toFixed(1)}% · 예측 ${(s.pred * 100).toFixed(1)}% · 오차 ${(s.err * 100).toFixed(1)}%p → ${s.verdict}${s.verdictAdj !== s.verdict ? ` (보정: ${s.verdictAdj})` : ""}`);
      console.log(`     수요 층   주거 1km 인구 ${num(inp.pop1km, 6)} → 이용자 ${num(b.residentDemandUsers, 6)} · 유동 ${P.floatingRadius}m 이용자 ${num(b.floatingDemandUsers, 6)} · 특수배수 ×${sdMul} · 수요시간 ${num(b.totalDemandHours, 8)}h · 수요전부 가동률 ${(s.utilIfAll * 100).toFixed(1)}%  | 누적 인구(1km 대비) ${popRings}`);
      console.log(`     점유율 층 자사 PC ${own} · 500m 조사 경쟁 ${near.length}곳 PC ${num(nearPc, 4)} 무게 ${num(nearW, 5, 1)} · 전체(2km 포함) ${nIn}곳 PC ${num(rivalPcRaw, 4)} 무게 ${num(rivalW, 5, 1)} · 품질비 중앙 ${qratios.length ? med(qratios).toFixed(2) : "-"} (1보다 크면 경쟁이 우리보다 좋음) · 핵심점유 ${(s.coreShare * 100).toFixed(1)}% × 입지 ${s.locMul.toFixed(2)}${b.locationFactors.length ? ` [${b.locationFactors.map((f) => `${f.key} ${f.value.toFixed(2)}`).join(" ")}]` : ""} = ${(s.share * 100).toFixed(1)}%`);
      console.log(`     필요 점유율 ${(s.requiredShare * 100).toFixed(1)}%  |  점유율이 맞다면 수요가 ×${demandNeeded.toFixed(2)}  |  수요가 맞다면 경쟁 무게가 ${num(rivalW, 1, 1)} → ${Number.isFinite(rivalWNeeded) ? rivalWNeeded.toFixed(1) : "(점유율 1 초과 — 불가)"} (×${Number.isFinite(rivalWNeeded) && rivalW > 0 ? (rivalWNeeded / rivalW).toFixed(2) : "-"})`);
      if (rv.length) console.log(`     경쟁점 1:1  ${rv.map((x) => `${x.name.slice(0, 10)} 실측 ${(x.act * 100).toFixed(0)} 예측 ${(x.pred * 100).toFixed(0)} (${((x.pred - x.act) * 100) >= 0 ? "+" : ""}${((x.pred - x.act) * 100).toFixed(0)}) ${Math.round(x.distM)}m`).join(" · ")}`);
      else console.log(`     경쟁점 1:1  핑봇 없음`);
      if (s.lowRatio != null) console.log(`     동네 실측 하한 ÷ 산식수요 ${s.lowRatio.toFixed(2)}배 (핑봇 ${s.lowN}곳)`);
      if (b.missing.length) console.log(`     빠진 자료: ${b.missing.join(" · ")}`);
    }
    console.log(`\n  ⭐ 읽는 법 — "수요 ×1.5" 같은 배수가 특수수요 배수 하나로 설명되면 유형 문제, 아니면 그 매장 배후지(반경·막힘) 문제. "경쟁 무게 ×0.5"면 경쟁점 품질·거리 자료를 다시 본다.`);
    expect(worst.length).toBe(8);
  });

  it("(4) ⭐⭐⭐ 밀집 점유율 갈래 — 경쟁 무게가 어디서 깎이나(대수·품질비^θ·거리) · θ/감쇠/품질비 상한 실험을 세 잣대로", () => {
    // 사용자(2026-09-24 밤): "1번 밀집 점유율 갈래 진행해". 층 가르기에서 일산탄현(+13)·시흥배곧(+12)·부경대(+10)·평내호평(+9)·시흥은계(+9)는
    // 경쟁점은 맞는데 우리 몫만 크다. 우리 몫 = 자사PC ÷ (자사PC + Σ 경쟁PC × 품질비^θ × 거리무게). 경쟁 항이 어느 곱에서 사라지는지 먼저 본다.
    // ⚠️ 사전 기준(자료 보기 전): 채택 후보는 (1) 밀집 편향이 줄고 (2) 소도시·중간 편향이 3%p 넘게 안 나빠지고 (3) 경쟁점 47곳 1:1 편향이 0 쪽으로 오고
    //    (4) 후보지 13곳 평균 이동이 ±1%p 안이어야 한다. 하나라도 어긋나면 "기각"으로 적는다. 채택은 사용자 몫.
    const DENSE = ["일산탄현점", "시흥배곧점", "부경대점", "평내호평점", "시흥은계점"];
    const qOf = (parts: QualityParts | null | undefined, p2: TextbookParams) => (parts ? computeQualityScore(parts, p2.qualityWeights) : null);
    console.log(`\n[밀집 5곳 — 경쟁점별 무게 분해] 무게 = PC × 품질비^θ × 거리무게. 핑봇 = 그 경쟁점 실측 가동률, 1:1 = 그 경쟁점을 주인공으로 한 산식 예측`);
    for (const name of DENSE) {
      const s = splits.find((x) => x.name === name);
      const r = rows.find((x) => x.input.storeName === name);
      if (!s || !r) continue;
      const oq = qOf(r.input.ownQualityParts, P);
      const rv = rivalObsByCode.get(r.input.storeCode) ?? [];
      const list = (r.input.rivals ?? []).filter((v) => v.ip > 0).map((v) => {
        const w = rivalDistanceWeight(v.distanceM, P);
        const q = oq && oq > 0 && v.parts ? (computeQualityScore(v.parts, P.qualityWeights) ?? oq) / oq : 1;
        const ping = rv.find((x) => x.name === (v.name ?? ""));
        return { v, w, q, weight: v.ip * Math.pow(q, P.qualityExponent) * w, ping };
      }).sort((a, b) => (a.v.distanceM ?? 9e9) - (b.v.distanceM ?? 9e9));
      const total = list.reduce((a, x) => a + x.weight, 0);
      const needW = s.requiredShare < 1 ? s.pc * (1 / Math.min(1, s.requiredShare / (s.locMul || 1)) - 1) : NaN;
      console.log(`  ── ${name} 실측 ${(s.act * 100).toFixed(1)}% · 예측 ${(s.pred * 100).toFixed(1)}% · 필요 점유율 ${(s.requiredShare * 100).toFixed(1)}% vs 산식 ${(s.share * 100).toFixed(1)}% · 자사 PC ${s.pc} · 자사 품질 ${oq?.toFixed(2) ?? "-"} · 경쟁 무게 합 ${total.toFixed(1)} (맞으려면 ${Number.isFinite(needW) ? needW.toFixed(1) : "-"})`);
      console.log(`     ${"경쟁점".padEnd(14)} 거리   PC  거리무게  품질비  품질비^θ   무게 | 핑봇  1:1`);
      for (const x of list.slice(0, 12)) {
        console.log(`     ${nm(x.v.name ?? "(2km)", 7)}${num(x.v.distanceM, 6)}m${num(x.v.ip, 5)}${x.w.toFixed(2).padStart(9)}${x.v.parts ? x.q.toFixed(2).padStart(8) : "    없음"}${Math.pow(x.q, P.qualityExponent).toFixed(2).padStart(9)}${x.weight.toFixed(1).padStart(7)} |${x.ping ? `${(x.ping.act * 100).toFixed(0).padStart(4)}%${(x.ping.pred * 100).toFixed(0).padStart(5)}%` : "     -    -"}`);
      }
      if (list.length > 12) console.log(`     … 외 ${list.length - 12}곳(2km 목록, 무게 합 ${list.slice(12).reduce((a, x) => a + x.weight, 0).toFixed(1)})`);
    }
    // 품질 부품 채움률 — 밀집 동네 경쟁점 중 품질 자료가 있는 비율(없으면 비 1 = 우리와 같다고 봄)
    const dense = splits.filter((s) => s.utilIfAll >= 0.9), small = splits.filter((s) => s.utilIfAll < 0.45), mid = splits.filter((s) => s.utilIfAll >= 0.45 && s.utilIfAll < 0.9);
    const fill = (g: Split[]) => { let n = 0, f = 0; for (const s of g) for (const v of rows.find((x) => x.input.storeCode === s.code)?.input.rivals ?? []) if ((v.distanceM ?? 9e9) <= 500 && v.ip > 0) { n += 1; if (v.parts) f += 1; } return n ? `${f}/${n}` : "-"; };
    console.log(`\n  500m 조사 경쟁점 품질 자료 채움: 밀집 ${fill(dense)} · 중간 ${fill(mid)} · 소도시 ${fill(small)}`);

    // ── 실험 — 세 잣대 ──────────────────────────────────────────────────────
    type Variant = { label: string; p: TextbookParams; capRatio?: [number, number] };
    const cappedInput = (input: TextbookInput, p2: TextbookParams, cap: [number, number]): TextbookInput => {
      // 품질비 상한: 산식엔 없으므로 경쟁점 parts를 "우리 품질 × 잘린 비"가 되도록 바꿔 흉내 낸다(측정용). 비는 지금 비중으로 계산.
      const oq = qOf(input.ownQualityParts, p2);
      if (!oq || !(oq > 0)) return input;
      return { ...input, rivals: (input.rivals ?? []).map((v) => {
        if (!v.parts) return v;
        const q = (computeQualityScore(v.parts, p2.qualityWeights) ?? oq) / oq;
        const qc = Math.min(cap[1], Math.max(cap[0], q));
        if (qc === q) return v;
        const k = qc / q; // 모든 부품을 같은 배로 늘리면 가중평균도 같은 배
        const sc = (x: number | null) => (x == null ? null : x * k);
        return { ...v, parts: { spec: sc(v.parts.spec), food: sc(v.parts.food), zone: sc(v.parts.zone), interior: sc(v.parts.interior), management: sc(v.parts.management) } };
      }) };
    };
    const variants: Variant[] = [
      { label: "지금 (θ3 · 감쇠 200/200)", p: P },
      { label: "θ 2.5", p: { ...P, qualityExponent: 2.5 } },
      { label: "θ 2", p: { ...P, qualityExponent: 2 } },
      { label: "θ 1.5", p: { ...P, qualityExponent: 1.5 } },
      { label: "감쇠 scale 300 (wf 1)", p: { ...P, rivalDistanceDecay: { plateauM: 200, scaleM: 300, weightFactor: 1 } } },
      { label: "감쇠 scale 400 (wf 1)", p: { ...P, rivalDistanceDecay: { plateauM: 200, scaleM: 400, weightFactor: 1 } } },
      { label: "평지 300 · scale 200", p: { ...P, rivalDistanceDecay: { plateauM: 300, scaleM: 200, weightFactor: 1 } } },
      { label: "품질비 상한 0.7~1.4 (θ3)", p: P, capRatio: [0.7, 1.4] },
      { label: "품질비 상한 0.8~1.25 (θ3)", p: P, capRatio: [0.8, 1.25] },
      { label: "θ2 + 상한 0.7~1.4", p: { ...P, qualityExponent: 2 }, capRatio: [0.7, 1.4] },
      { label: "θ2 + 감쇠 300", p: { ...P, qualityExponent: 2, rivalDistanceDecay: { plateauM: 200, scaleM: 300, weightFactor: 1 } } },
    ];
    const own = rows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const util0 = new Map(own.map((r) => [r.input.storeCode, splits.find((s) => s.code === r.input.storeCode)?.utilIfAll ?? NaN]));
    const cand0 = new Map(candRows.map((r) => [r.input.storeCode, computeTextbook(r.input, P).utilization ?? NaN]));
    const denseBias0 = dense.length ? mean(dense.map((s) => s.err)) : NaN;
    console.log(`\n  [실험 — 세 잣대] 오차 = 예측 − 실측 %p. 밀집/중간/소도시 = 수요전부 가동률 ≥90 / 45~90 / <45. 경쟁 = 핑봇 경쟁점 1:1. 후보지 Δ = 지금 대비`);
    console.log(`  변형                          자사MAE  편향 | 밀집  중간 소도시 | 경쟁MAE 경쟁편향 | 후보지 평균Δ 3%p↑ 3%p↓ | 일산탄현 시흥배곧 부경대 | 판정`);
    let mid0 = NaN, small0 = NaN, riv0 = NaN;
    for (const v of variants) {
      const map = (input: TextbookInput) => (v.capRatio ? cappedInput(input, v.p, v.capRatio) : input);
      const errs = own.map((r) => ({ code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(map(r.input), v.p).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
      const g = (f: (u: number) => boolean) => { const xs = errs.filter((x) => f(util0.get(x.code) ?? NaN)); return xs.length ? mean(xs.map((x) => x.e)) : NaN; };
      const rivErr: number[] = [];
      for (const [, list] of rivalInputsByCode) for (const x of list) { const u = computeTextbook(map(x.input), v.p).utilization; if (u != null && u > 0) rivErr.push(u - x.act); }
      const cd = candRows.map((r) => (computeTextbook(map(r.input), v.p).utilization ?? NaN) - (cand0.get(r.input.storeCode) ?? NaN)).filter(Number.isFinite);
      const one = (name: string) => { const x = errs.find((y) => y.name === name); return x ? (x.e * 100).toFixed(1).padStart(7) : "      -"; };
      const dB = g((u) => u >= 0.9), mB = g((u) => u >= 0.45 && u < 0.9), sB = g((u) => u < 0.45);
      const rivBias = mean(rivErr), candMean = mean(cd);
      if (v === variants[0]) { mid0 = mB; small0 = sB; riv0 = rivBias; }
      const verdict = v === variants[0] ? "기준" : [
        Math.abs(dB) < Math.abs(denseBias0) - 0.005 ? "" : "밀집 안 줄음",
        Math.abs(candMean) <= 0.01 ? "" : "후보지 이동",
        rivBias > riv0 + 0.005 ? "" : "경쟁 안 좋아짐",
        (sB < small0 - 0.03 || mB < mid0 - 0.03) ? "소도시/중간 나빠짐" : "",
      ].filter(Boolean).join(" · ") || "기준 4개 통과";
      console.log(`  ${v.label.padEnd(28)}${(mean(errs.map((x) => Math.abs(x.e))) * 100).toFixed(2).padStart(6)}${(mean(errs.map((x) => x.e)) * 100).toFixed(1).padStart(6)} |${(dB * 100).toFixed(1).padStart(5)}${(mB * 100).toFixed(1).padStart(6)}${(sB * 100).toFixed(1).padStart(6)} |${(mean(rivErr.map(Math.abs)) * 100).toFixed(1).padStart(7)}${(rivBias * 100).toFixed(1).padStart(8)} |${(candMean * 100).toFixed(1).padStart(9)}${String(cd.filter((d) => d > 0.03).length).padStart(5)}${String(cd.filter((d) => d < -0.03).length).padStart(5)} |${one("일산탄현점")}${one("시흥배곧점")}${one("부경대점")} | ${verdict}`);
    }
    // ── C. 품질비가 정말 점유율을 가르나 — 핑봇 짝으로 θ를 직접 잰다 ───────────────────────────
    // 같은 동네 (우리, 경쟁점 A) 짝에서 ln(A 실측 ÷ 우리 실측) = θ_함의 × ln(A 품질비) + … 이어야 θ가 뜻이 있다.
    // 산식은 θ=3 — 품질이 20% 나쁘면 손님을 반만 받는다는 뜻. 실측 짝에서 기울기(θ_함의)와 상관(r)을 본다.
    const pairs: { hood: string; name: string; q: number; relAct: number; pcRatio: number }[] = [];
    const allRatios: number[] = [];
    for (const r of rows) {
      const oq = qOf(r.input.ownQualityParts, P);
      if (!oq || !(oq > 0)) continue;
      const a = r.input.actualUtilization;
      for (const v of r.input.rivals ?? []) {
        if (!v.parts || !(v.ip > 0) || (v.distanceM ?? 9e9) > 500) continue;
        const q = (computeQualityScore(v.parts, P.qualityWeights) ?? oq) / oq;
        allRatios.push(q);
        const ping = (rivalObsByCode.get(r.input.storeCode) ?? []).find((x) => x.name === (v.name ?? ""));
        if (ping && a && a > 0) pairs.push({ hood: r.input.storeName ?? "", name: v.name ?? "", q, relAct: ping.act / a, pcRatio: v.ip / (r.input.pcCount ?? 1) });
      }
    }
    const srt = [...allRatios].sort((x, y) => x - y);
    const qtl = (f: number) => srt[Math.min(srt.length - 1, Math.floor(f * (srt.length - 1)))];
    console.log(`\n  [C. 500m 조사 경쟁점 품질비 분포 · n=${srt.length}] 1 = 우리와 같음. 하위10% ${qtl(0.1).toFixed(2)} · 중앙 ${qtl(0.5).toFixed(2)} · 상위10% ${qtl(0.9).toFixed(2)} · 1 이상 ${srt.filter((x) => x >= 1).length}곳(${(srt.filter((x) => x >= 1).length / srt.length * 100).toFixed(0)}%)`);
    console.log(`     θ3에서 중앙 품질비 ${qtl(0.5).toFixed(2)}의 경쟁점은 대수의 ${(Math.pow(qtl(0.5), 3) * 100).toFixed(0)}%로 센다 — 경쟁점이 거의 전부 우리보다 낮게 채점돼 있으면 θ는 "매장 간 변별"이 아니라 "자사우위 배수"로 일한다.`);
    if (pairs.length >= 5) {
      const x = pairs.map((p) => Math.log(p.q)), y = pairs.map((p) => Math.log(p.relAct));
      const mx = mean(x), my = mean(y);
      const slope = x.reduce((a, xi, i) => a + (xi - mx) * (y[i] - my), 0) / x.reduce((a, xi) => a + (xi - mx) ** 2, 0);
      console.log(`  [C. 핑봇 짝 ${pairs.length}쌍 — 품질비가 경쟁점 상대 가동률을 설명하나] ln(경쟁 실측÷우리 실측) vs ln(품질비): 기울기(θ_함의) ${slope.toFixed(2)} · r ${corr(x, y).toFixed(3)} · 지금 θ 3`);
      console.log(`     상대 가동률 중앙 ${Math.exp(med(y)).toFixed(2)}배(경쟁÷우리) · 품질비 중앙 ${Math.exp(med(x)).toFixed(2)} → 산식은 이 짝들에서 우리 몫을 ${(Math.pow(Math.exp(med(x)), -3)).toFixed(1)}배 유리하게 봄, 실측은 ${(1 / Math.exp(med(y))).toFixed(1)}배`);
      for (const p of [...pairs].sort((a, b) => a.q - b.q)) console.log(`     ${nm(p.hood, 7)} ${nm(p.name, 7)} 품질비 ${p.q.toFixed(2)}  PC비 ${p.pcRatio.toFixed(2)}  경쟁÷우리 실측 ${p.relAct.toFixed(2)}  (θ3이 말하는 값 ${Math.pow(p.q, 3).toFixed(2)})`);
      console.log(`     ⭐ θ_함의가 3보다 훨씬 작고 r이 약하면, 품질비^3은 동네별 경쟁 차이를 가르는 항이 아니라 전 매장에 같은 크기로 걸리는 자사우위 배수다 — 그 배수는 수요 축척과 상쇄돼 자사 편향엔 안 보이고 경쟁점 47곳 −11%p·자사우위 3.69배로만 보인다.`);
    }
    console.log(`\n  ⭐ 읽는 법 — 밀집 편향만 내리고 소도시·후보지·경쟁점을 안 건드리는 변형이 있으면 그것이 "밀집에서만 경쟁을 덜 깎는" 항목이다.`);
    console.log(`     θ를 내리면 전 매장 몫이 같이 줄어 소도시가 더 과소된다(알려짐). 품질비 상한은 "우리가 훨씬 좋다"는 극단만 자른다 — 밀집 동네 경쟁점이 품질 자료가 있어 비가 0.6대인 곳에 작용한다.`);
    console.log(`     감쇠를 넓히면 500m 밖 미조사 경쟁점(기본대수)이 분모를 휩쓴다(2026-09-23 (4) 기각) — 여기선 300·400만 본다.`);
    expect(dense.length).toBeGreaterThan(3);
  });
});
