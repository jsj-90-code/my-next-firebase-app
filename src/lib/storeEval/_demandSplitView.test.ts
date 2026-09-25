// 동네 수요 나눔 표 — "상권수요 10,000 중 우리가 3,000이면 경쟁점이 7,000. 그 7,000이 경쟁점에서 어떤 가동률로 보이나" (2026-09-25 저녁, 사용자 아이디어). 읽기전용.
// 본체/운영/Firestore 미변경. 계수를 고르지 않는다.
//
// ── 무엇을 보나 ─────────────────────────────────────────────────────────────
// 자사 매장마다 산식이 만든 **동네 수요시간 D**를 우리 몫과 경쟁 몫으로 가르고, 경쟁 몫을 500m 안 경쟁점 PC로 나눠 "경쟁 함의 가동률"을 낸다.
// 그걸 핑봇 실측(1:1 대조용 — 사용자 결정 2026-09-25: 채점 자료로는 안 쓴다)과 대보면 오차가 **총량(수요) 문제**인지 **나눔(점유율) 문제**인지 동네별로 갈린다.
//   총량 비  = (우리 실측 시간 + 경쟁 핑봇 실측 시간) ÷ D        ← 500m 안 경쟁점이 전부 핑봇 있을 때만 온전(아니면 "부분")
//   나눔     = 우리 실측 몫 ÷ (우리 실측 + 경쟁 실측)  vs  산식 몫 ÷ (산식 우리 + 산식 경쟁)   ← 같은 매장들끼리
//   자사우위 = 우리 대당 시간 ÷ 경쟁 대당 시간 — 산식 vs 실측. "우리 경쟁력이 경쟁점보다 얼마나 낫다고 산식이 보나 vs 실제"
// 진단 규칙(고정): 총량 비 > 1.25 → 수요 과소 · 나눔 산식이 실측보다 +10%p 넘게 크면 점유율 과대 · 둘 다 안이면 일치.
//
// 실행: npx vitest run src/lib/storeEval/_demandSplitView.test.ts --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, qscInWindowAverage, residentRadiusByCodeFromDocs, rivalQualityParts, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_UNSURVEYED_PC_COUNT, computeLocationScoreFromFacts } from "./calc";
import { existingSiteKey, operatingShareInWindow, rival2kmRecords } from "./rival2km";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type QualityParts, type TextbookInput, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const MONTH_HOURS = 720;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };
const pc1 = (v: number) => (v * 100).toFixed(1);
const distM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371000, toR = Math.PI / 180, dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const PINGBOT_MIN_RELIABLE_PCT = 10;
const NEIGHBORHOOD_M = 500;

describeIf("동네 수요 나눔 — 우리 몫 / 경쟁 몫, 경쟁 함의 가동률 vs 핑봇 실측", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const qscByStoreCode = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as QscSite[]) { const code = doc.storeCode ?? doc.id; const avg = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null); if (code && avg != null) qscByStoreCode.set(code, avg); }
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
  const residentRadiusByCode = residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []);
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
  const P: TextbookParams = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ping = (c: Competitor) => (c as any).pingbotUtilization as number | null | undefined;
  const pcOf = (c: Competitor) => c.totalPcCount ?? c.appliedPcCount ?? null;

  it("(1) 매장별 나눔 표", () => {
    console.log(`\n[동네 수요 나눔] D = 산식 동네 수요시간(월). 경쟁 = 우리 매장 ${NEIGHBORHOOD_M}m 안, 핑봇 ≥${PINGBOT_MIN_RELIABLE_PCT}%만 실측으로 셈. 함의 = 경쟁 몫 ÷ (500m 경쟁 PC 전체 × 720)`);
    console.log(`  ${pad("매장", 10)} ${"D(천h)".padStart(7)} | ${"우리예측%".padStart(8)} ${"우리실측%".padStart(8)} ${"몫예측".padStart(6)} ${"몫실측".padStart(6)} | ${"경쟁(핑/전)".padStart(10)} ${"경쟁PC".padStart(6)} ${"함의(실측)".padStart(9)} ${"함의(예측)".padStart(9)} ${"핑봇실측".padStart(8)} | ${"총량비".padStart(6)} ${"나눔산식".padStart(8)} ${"나눔실측".padStart(8)} ${"우위산식".padStart(8)} ${"우위실측".padStart(8)} | 진단`);
    const out: { name: string; totalRatio: number | null; shareModel: number | null; shareAct: number | null; advModel: number | null; advAct: number | null; verdict: string }[] = [];
    for (const r of rows) {
      const st = storeByCode.get(r.input.storeCode);
      const act = r.input.actualUtilization;
      if (!st?.lat || !st?.lng || !(r.input.pcCount ?? 0) || act == null || !(act > 0)) continue;
      const b = computeTextbook(r.input, P);
      const D = b.totalDemandHours ?? 0; if (!(D > 0)) continue;
      const pc = r.input.pcCount as number;
      const ownPred = b.ownDemandHours ?? 0, ownAct = act * pc * MONTH_HOURS;
      const comps = (compsByCode.get(r.input.storeCode) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음" && c.lat != null && c.lng != null && (pcOf(c) ?? 0) > 0)
        .map((c) => ({ c, pc: pcOf(c) as number, lat: c.lat as number, lng: c.lng as number, d: distM(st.lat!, st.lng!, c.lat as number, c.lng as number) }))
        .filter((x) => x.d <= NEIGHBORHOOD_M);
      if (!comps.length) continue;
      const withPing = comps.filter((x) => (ping(x.c) ?? 0) >= PINGBOT_MIN_RELIABLE_PCT);
      const compPcAll = comps.reduce((a, x) => a + x.pc, 0);
      const compPcPing = withPing.reduce((a, x) => a + x.pc, 0);
      const rivalActHours = withPing.reduce((a, x) => a + x.pc * MONTH_HOURS * ((ping(x.c) as number) / 100), 0);
      const rivalActUtil = compPcPing > 0 ? rivalActHours / (compPcPing * MONTH_HOURS) : null;
      const impliedAct = Math.max(0, D - ownAct) / (compPcAll * MONTH_HOURS);
      const impliedPred = Math.max(0, D - ownPred) / (compPcAll * MONTH_HOURS);
      // 산식이 경쟁점을 주인공으로 보면 — 핑봇 있는 경쟁점 각각의 예측 가동률(_layerSplit 1:1 조립과 같음)
      const months = evaluationMonths(st.openedAt);
      let rivalPredHours = 0;
      for (const me of withPing) {
        const twoKm = rival2kmRecords(existingSiteKey(r.input.storeCode))
          .map((x) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * operatingShareInWindow(x, months), distanceM: distM(me.lat, me.lng, x.lat, x.lng), parts: null as QualityParts | null, name: x.name }))
          .filter((x) => x.ip > 0);
        const others = (compsByCode.get(r.input.storeCode) ?? []).filter((o) => o !== me.c && o.investigationStatus !== "경쟁점없음" && o.lat != null && o.lng != null && (pcOf(o) ?? 0) > 0);
        const rivals: NonNullable<TextbookInput["rivals"]> = [
          { ip: pc, distanceM: me.d, parts: r.input.ownQualityParts, name: r.input.storeName },
          ...others.map((o) => ({ ip: pcOf(o) as number, distanceM: distM(me.lat, me.lng, o.lat as number, o.lng as number), parts: rivalQualityParts(o, settings), name: o.name ?? null })),
          ...twoKm,
        ];
        const input: TextbookInput = {
          ...r.input, storeCode: `riv:${me.c.id}`, storeName: me.c.name ?? "(이름없음)", pcCount: me.pc,
          hourlyRate: me.c.hourlyRateConverted ?? r.input.hourlyRate, actualUtilization: null, productUnitPriceOverride: null,
          ownQualityParts: rivalQualityParts(me.c, settings), rivals,
          competitorIp: rivals.reduce((s, x) => s + x.ip, 0), competitorCount: rivals.length,
          location: r.input.location ? { centrality: r.input.location.centrality, access: computeLocationScoreFromFacts(me.c.floor ?? null, me.c.groundLevel ?? null, me.c.hasElevator ?? null), direction: null, flowBlock: null, visibility: null } : null,
        };
        const u = computeTextbook(input, P).utilization;
        if (u != null && u > 0) rivalPredHours += u * me.pc * MONTH_HOURS;
      }
      const full = withPing.length === comps.length;
      const totalRatio = full && compPcPing > 0 ? (ownAct + rivalActHours) / D : null;
      const shareAct = compPcPing > 0 ? ownAct / (ownAct + rivalActHours) : null;
      const shareModel = compPcPing > 0 && rivalPredHours > 0 ? ownPred / (ownPred + rivalPredHours) : null;
      const advAct = rivalActUtil ? act / rivalActUtil : null;
      const advModel = compPcPing > 0 && rivalPredHours > 0 ? (ownPred / (pc * MONTH_HOURS)) / (rivalPredHours / (compPcPing * MONTH_HOURS)) : null;
      const verdict = totalRatio == null ? (withPing.length ? "부분(핑봇 없는 경쟁 있음)" : "핑봇 없음")
        : totalRatio > 1.25 && shareModel != null && shareAct != null && shareModel - shareAct > 0.10 ? "수요 과소 + 점유율 과대"
        : totalRatio > 1.25 ? "수요 과소(총량)"
        : shareModel != null && shareAct != null && shareModel - shareAct > 0.10 ? "점유율 과대(나눔)"
        : shareModel != null && shareAct != null && shareAct - shareModel > 0.10 ? "점유율 과소(나눔)"
        : totalRatio < 0.8 ? "수요 과대(총량)" : "일치";
      out.push({ name: r.input.storeName ?? "", totalRatio, shareModel, shareAct, advModel, advAct, verdict });
      const f = (v: number | null, d = 2) => (v == null ? "-" : v.toFixed(d));
      console.log(`  ${pad((r.input.storeName ?? "").replace(/점$/, ""), 10)} ${(D / 1000).toFixed(1).padStart(7)} | ${pc1(b.utilization ?? NaN).padStart(8)} ${pc1(act).padStart(8)} ${pc1(ownPred / D).padStart(6)} ${pc1(ownAct / D).padStart(6)} | ${`${withPing.length}/${comps.length}`.padStart(10)} ${String(compPcAll).padStart(6)} ${pc1(impliedAct).padStart(9)} ${pc1(impliedPred).padStart(9)} ${(rivalActUtil == null ? "-" : pc1(rivalActUtil)).padStart(8)} | ${f(totalRatio).padStart(6)} ${(shareModel == null ? "-" : pc1(shareModel)).padStart(8)} ${(shareAct == null ? "-" : pc1(shareAct)).padStart(8)} ${f(advModel).padStart(8)} ${f(advAct).padStart(8)} | ${verdict}`);
    }
    const fullRows = out.filter((o) => o.totalRatio != null);
    console.log(`\n  [요약 — 500m 경쟁점이 전부 핑봇 있는 ${fullRows.length}곳] 총량 비 중앙 ${median(fullRows.map((o) => o.totalRatio as number)).toFixed(2)} (1이면 산식 수요 = 실측 합) · 나눔 산식−실측 중앙 ${(100 * median(fullRows.filter((o) => o.shareModel != null && o.shareAct != null).map((o) => (o.shareModel as number) - (o.shareAct as number)))).toFixed(1)}%p · 자사우위 산식 중앙 ${median(fullRows.filter((o) => o.advModel != null).map((o) => o.advModel as number)).toFixed(2)} vs 실측 ${median(fullRows.filter((o) => o.advAct != null).map((o) => o.advAct as number)).toFixed(2)}`);
    const byV = new Map<string, string[]>(); for (const o of out) byV.set(o.verdict, [...(byV.get(o.verdict) ?? []), o.name.replace(/점$/, "")]);
    for (const [v, ns] of byV) console.log(`  ${pad(v, 22)} ${ns.length}곳: ${ns.join(" · ")}`);
    console.log(`  ⭐ 읽는 법 — "총량 비"가 1보다 크면 동네 전체가 산식 수요보다 바쁘다(수요층 문제). "나눔"이 산식 쪽이 크면 우리 몫을 후하게 본다(점유율층 문제). 둘은 따로 고쳐야 하고, 자사 오차만 보면 둘이 상쇄돼 안 보인다.`);
    console.log(`     "자사우위"는 우리 대당 이용시간 ÷ 경쟁 대당 — 산식이 우리 경쟁력을 경쟁점 대비 몇 배로 보나 vs 실제. 감각과 대볼 칸이 이것이다.`);
    expect(out.length).toBeGreaterThan(10);
  });
});
