// 자사 실측 가동률 ÷ 같은 동네 핑봇 경쟁점 가동률 — 기존점 분포 (2026-09-26 밤, 범위 밖 검토 근거 설계용). 측정만.
import { it } from "vitest";
import { loadValidationSnapshot } from "./validationSnapshot";
import { utilizationByStore } from "./labInput";
import { existingStoreSourceCode } from "./existingStoreEvaluation";
it("자사/경쟁 가동률 비", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = loadValidationSnapshot<any>();
  const util = utilizationByStore(s.sales, s.existingStores);
  const out: { n: string; own: number; rival: number; r: number; k: number }[] = [];
  for (const e of s.existingStores) {
    if (e.excludedFromModel || e.brandType !== "블랙라벨") continue;
    const own = util.get(e.storeCode); if (own == null) continue;
    const code = existingStoreSourceCode(e);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rv = s.competitors.filter((c: any) => c.candidateCode === code && c.pingbotUtilization != null && c.pingbotUtilization >= 10);
    if (!rv.length) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals = rv.map((c: any) => c.pingbotUtilization / 100).sort((a: number, b: number) => a - b);
    const med = vals[Math.floor((vals.length - 1) / 2)];
    out.push({ n: e.storeName, own, rival: med, r: own / med, k: rv.length });
  }
  out.sort((a, b) => a.r - b.r);
  const q = (p: number) => out[Math.min(out.length - 1, Math.floor(p * out.length))].r.toFixed(2);
  console.log(`\n기존점 ${out.length}곳 — 자사 실측 가동률 ÷ 동네 핑봇 경쟁점 가동률(중앙값): 최소 ${q(0)} · 25% ${q(0.25)} · 중앙 ${q(0.5)} · 75% ${q(0.75)} · 최대 ${out.at(-1)!.r.toFixed(2)}`);
  console.log(out.map((x) => `${x.n.replace(/점$/, "")} ${x.r.toFixed(2)}(${(x.own * 100).toFixed(0)}/${(x.rival * 100).toFixed(0)}·${x.k})`).join(" · "));
});

import { recomputeSourceFromSnapshot } from "./validationSnapshot";
import { prepareRecomputeInputs, recomputeCandidates } from "./dailyRecompute";
import { labCandidateBreakdown } from "./dualEstimate";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
it("범위 밖 후보지 — 두 산식 가동률 ÷ 경쟁점 핑봇", () => {
  const src = recomputeSourceFromSnapshot(loadValidationSnapshot<unknown>());
  const pr = prepareRecomputeInputs(src);
  const prepared = prepareExistingStoresForEvaluation(src.existingStores, pr.competitors, src.locationEvaluations, pr.settings, pr.qscByStoreCode);
  const recs = new Map(recomputeCandidates(src).map((r) => [r.code, r.after]));
  for (const code of ["N014", "N002", "N010", "N016"]) {
    const cand = src.candidates.find((c) => c.code === code)!;
    const lb = labCandidateBreakdown({ candidate: cand, preparedStores: prepared, rawStores: src.existingStores, competitors: pr.competitors, locations: src.locationEvaluations, sales: pr.evaluationSales, settings: pr.settings, qscByStoreCode: pr.qscByStoreCode, extras: pr.labExtras });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v62u = (recs.get(code) as any)?.v62ImpliedUtilization as number | null;
    const rv = pr.competitors.filter((c) => c.candidateCode === code && c.pingbotUtilization != null && c.pingbotUtilization >= 10).map((c) => c.pingbotUtilization! / 100).sort((a, b) => a - b);
    const med = rv.length ? rv[Math.floor((rv.length - 1) / 2)] : null;
    const f = (u: number | null | undefined) => (u == null ? "-" : `${(u * 100).toFixed(1)}%${med ? ` (${(u / med).toFixed(2)}배)` : ""}`);
    console.log(`${cand.name} · 경쟁점 핑봇 ${rv.length}곳 중앙 ${med == null ? "없음" : (med * 100).toFixed(1) + "%"} · V62 가동률 ${f(v62u)} · 실험실 ${f(lb?.utilization)}`);
  }
});
