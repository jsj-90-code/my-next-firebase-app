// 후보지 13곳이 V62 학습 범위(기존점) 안에 있나 + V62 vs 실험실 차이 (2026-09-25 밤, 사용자 "영월 같은 경우가 일부분 중 하나인가?"). 읽기전용.
// V62는 회귀라 학습 범위 밖 입력에서 직선을 그대로 늘린다(영월: 상권 수요 383 = 기존점 최저 1,128의 1/3).
// 범위 = 모델 포함 기존점의 [최소, 최대]. 넘으면 "밖". 실험실 값은 화면과 같은 조립(buildLabCandidateRows).
// 실행: npx vitest run src/lib/storeEval/_candidateRangeCheck.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { CandidateInput, Competitor, EvaluationResult, LocationEvaluation } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };
const man = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`);

describeIf("후보지 범위 점검", () => {
  it("13곳 표", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const settings = mergeModelSettings(snap.settings);
    const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
    const compsByCode = new Map<string, Competitor[]>(); for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
    const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
    const inc = stores.filter((s) => !s.excludedFromModel && s.brandType === "블랙라벨" && s.marketDemand != null && s.actualMonthlyRevenueAvg != null);
    const rng = (f: (s: (typeof inc)[number]) => number | null | undefined) => { const v = inc.map(f).filter((x): x is number => x != null && Number.isFinite(x)); return [Math.min(...v), Math.max(...v)] as const; };
    const R = {
      demand: rng((s) => s.marketDemand), rate: rng((s) => s.hourlyRate), pc: rng((s) => s.evaluationPcCount ?? s.pcCount),
      comp: rng((s) => s.competitorIp), dpc: rng((s) => (s.marketDemand as number) / (((s.evaluationPcCount ?? s.pcCount) ?? 0) + (s.competitorIp ?? 0))),
    };
    const qsc = new Map<string, number>();
    for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string; records?: QscRecord[] }[]) { if (!d.storeCode) continue; const a = qscInWindowAverage(d.records ?? [], d.openedAt ?? null); if (a != null && a > 0) qsc.set(d.storeCode, a); }
    const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
    const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
    const ringBlockedByCode = new Map<string, number>();
    for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
    const residentRadiusByCode = residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []);
    const labStores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
    const rows = buildLabRows({ stores: labStores, compsByCode, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores), settings, qscByStoreCode: qsc, residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
    const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
    const locByCode = new Map<string, LocationEvaluation>(((snap.locationEvaluations ?? []) as LocationEvaluation[]).map((l) => [l.candidateCode, l]));
    const candRows = buildLabCandidateRows({ candidates: snap.candidates as CandidateInput[], compsByCode, locByCode, settings, franchiseManagement: franchiseManagementFromRows(rows), residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
    const labBy = new Map(candRows.map((r) => [r.input.storeCode, computeTextbook(r.input, P).monthlyRevenue]));
    console.log(`\n[V62 학습 범위 — 모델 포함 기존점 ${inc.length}곳] 상권수요 ${Math.round(R.demand[0])}~${Math.round(R.demand[1])} · 정가 ${R.rate[0]}~${R.rate[1]} · PC ${R.pc[0]}~${R.pc[1]} · 경쟁IP ${R.comp[0]}~${R.comp[1]} · 수요/(PC+경쟁) ${R.dpc[0].toFixed(2)}~${R.dpc[1].toFixed(2)}`);
    console.log(`  ${pad("후보지", 14)} ${"상권수요".padStart(7)} ${"정가".padStart(5)} ${"PC".padStart(4)} ${"경쟁IP".padStart(6)} ${"수요/공급".padStart(8)} | ${"V62".padStart(8)} ${"실험실".padStart(8)} ${"V62÷실험실".padStart(10)} | 범위 밖`);
    let outN = 0, bigGap = 0, both = 0;
    for (const r of (snap.results ?? []) as EvaluationResult[]) {
      const c = (snap.candidates as CandidateInput[]).find((x) => x.code === r.candidateCode); if (!c) continue;
      const pc = c.expectedPcCount ?? 0, d = r.marketDemand ?? null, comp = r.competitorIp ?? 0;
      const dpc = d != null && pc + comp > 0 ? d / (pc + comp) : null;
      const flags: string[] = [];
      const chk = (label: string, v: number | null | undefined, [lo, hi]: readonly [number, number]) => { if (v == null) return; if (v < lo) flags.push(`${label}↓(${Math.round(v * 100) / 100}<${Math.round(lo * 100) / 100})`); else if (v > hi) flags.push(`${label}↑(${Math.round(v * 100) / 100}>${Math.round(hi * 100) / 100})`); };
      chk("수요", d, R.demand); chk("정가", c.hourlyRate, R.rate); chk("PC", pc, R.pc); chk("경쟁", comp, R.comp); chk("수요/공급", dpc, R.dpc);
      const lab = labBy.get(c.code) ?? null; const ratio = lab && r.v62Final ? r.v62Final / lab : null;
      if (flags.length) outN++; if (ratio != null && (ratio > 1.2 || ratio < 1 / 1.2)) bigGap++; if (flags.length && ratio != null && (ratio > 1.2 || ratio < 1 / 1.2)) both++;
      console.log(`  ${pad(c.name ?? c.code, 14)} ${String(Math.round(d ?? NaN)).padStart(7)} ${String(c.hourlyRate).padStart(5)} ${String(pc).padStart(4)} ${String(Math.round(comp)).padStart(6)} ${(dpc == null ? "-" : dpc.toFixed(2)).padStart(8)} | ${man(r.v62Final).padStart(8)} ${man(lab).padStart(8)} ${(ratio == null ? "-" : ratio.toFixed(2) + "배").padStart(10)} | ${flags.join(" ") || "-"}`);
    }
    console.log(`\n  범위 밖 입력이 하나라도 있는 후보지 ${outN}/13 · 두 산식이 20% 넘게 갈리는 곳 ${bigGap}/13 · 둘 다 ${both}`);
    expect(true).toBe(true);
  });
});
