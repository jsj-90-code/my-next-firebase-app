// 선점경쟁 점수를 바꾸면 V62가 얼마나 움직이나 — 후보지 여러 곳 (2026-09-21)
//
// `_osongLocationScores.test.ts`를 일반화한 것이다. 거기는 N016 하나에 박혀 있는데,
// 후보지 점검표(`_candidateRedFlags`)에서 🔴이 여럿 나와 같은 걸 매장마다 다시 만들게 됐다.
//
// **아무것도 안 바꾼다** — Firestore도 설정도 건드리지 않고, 메모리 안에서 점수만 갈아끼워
// `evaluateCandidate`를 다시 돌린 결과를 표로 찍는다. 등급 경계도 같이 찍는다(그게 결재선이라).
//
// 실행:
//   npx vitest run src/lib/storeEval/_preemptionWhatIf.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { computeLocationCompositeScore } from "./calc";
import type {
  CandidateInput, Competitor, EvaluationResult, ExistingStore,
  ExistingStoreMonthlySales, LocationEvaluation,
} from "./types";

type Snapshot = {
  candidates: CandidateInput[];
  results: (EvaluationResult & { candidateCode: string; calculatedAt?: number })[];
  existingStores: ExistingStore[];
  competitors: Record<string, unknown>[];
  locationEvaluations: LocationEvaluation[];
  sales: ExistingStoreMonthlySales[];
  settings: Record<string, unknown> | null;
};

/** 점검표에서 🔴이 난 곳들. 늘려도 된다. */
const CODES = ["N004", "N005", "N010", "N003"];
const describeIfSnapshot = hasValidationSnapshot() ? describe : describe.skip;
const won = (v: number | null | undefined) =>
  v == null ? "      -" : `${(Math.round(v) / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만`;

describeIfSnapshot("선점경쟁 점수 감도", () => {
  const snap = loadValidationSnapshot<Snapshot>() as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));

  it("선점경쟁 1~5 · V62와 등급이 어떻게 움직이나", () => {
    for (const CODE of CODES) {
      const candidate = (snap.candidates ?? []).find((c) => c.code === CODE) ?? null;
      const baseLoc = snap.locationEvaluations.find((l) => l.candidateCode === CODE) ?? null;
      const competitors = allCompetitors.filter((c) => c.candidateCode === CODE);
      const stored = (snap.results ?? []).find((r) => r.candidateCode === CODE) ?? null;
      if (!candidate || !baseLoc || !stored) { console.log(`\n${CODE} — 자료 없음, 건너뜀`); continue; }

      const run = (preempt: number) => {
        const loc = { ...baseLoc, preemptionScore: preempt } as LocationEvaluation;
        const r = evaluateCandidate({
          candidate, competitors, locationEvaluation: loc, settings,
          existingStores: snap.existingStores,
          trainingLocationEvaluations: snap.locationEvaluations.map((l) => (l.candidateCode === CODE ? loc : l)),
          trainingCompetitors: allCompetitors,
          trainingSales: sales,
        });
        return {
          composite: computeLocationCompositeScore(
            { marketPositionFlow: baseLoc.locationScore, preemption: preempt, visibility: baseLoc.visibilityScore },
            settings,
          ),
          own: r.ownCompetitivenessScore ?? null,
          v62: r.v62Final ?? null,
          cons: r.conservativeSales ?? null,
          up: r.upperSales ?? null,
        };
      };
      // 등급은 코드가 확정한다(reportContext.storeEvaluationGrade와 같은 규칙).
      const grade = (v: number | null) => {
        if (v == null) return "-";
        const t = stored.aaBaselineRevenue != null && v >= stored.aaBaselineRevenue ? "AA"
          : stored.aaBaselineRevenue1500 != null && v >= stored.aaBaselineRevenue1500 ? "A+"
            : stored.aaBaselineRevenue1000 != null && v >= stored.aaBaselineRevenue1000 ? "A" : null;
        return t == null ? "해당없음" : (stored.marketCharacter === "번화가" ? `M${t}` : t);
      };

      const now = baseLoc.preemptionScore;
      const c = candidate;
      const comps = competitors.filter((x) => x.investigationStatus !== "경쟁점없음");
      console.log(`\n=== ${CODE} ${candidate.name} ===`);
      console.log(`  지금 점수  상권위치·동선 ${baseLoc.locationScore} · 선점경쟁 **${now}** · 접근가시성 ${baseLoc.visibilityScore}`);
      console.log(`  상권성격 ${stored.marketCharacter} · 등급 ${stored.marketGrade} · 편심도 ${(c as unknown as Record<string, number>).flowEccentricity?.toFixed(3) ?? "-"}` +
        ` (최대방위 ${(c as unknown as Record<string, string>).flowBusiestDir ?? "-"})`);
      console.log(`  경쟁점 ${comps.length}곳 · 300m 안 ${comps.filter((x) => (x.distanceM ?? 1e9) <= 300).length}곳` +
        ` · 300~500m ${comps.filter((x) => (x.distanceM ?? 0) > 300 && (x.distanceM ?? 0) <= 500).length}곳`);
      console.log(`  기준선  AA ${won(stored.aaBaselineRevenue)} · A+ ${won(stored.aaBaselineRevenue1500)} · A ${won(stored.aaBaselineRevenue1000)}`);
      console.log(`\n   선점경쟁  입지합성   자사경쟁력      V62      보수      상한    등급   지금대비`);
      const b = run(now).v62;
      for (const s of [5, 4, 3, 2, 1]) {
        const r = run(s);
        const d = b && r.v62 != null ? `${(((r.v62 - b) / b) * 100).toFixed(1)}%` : "-";
        console.log(`  ${String(s).padStart(6)}점  ${(r.composite?.toFixed(2) ?? "-").padStart(7)}  ${(r.own?.toFixed(3) ?? "-").padStart(9)}` +
          `  ${won(r.v62).padStart(9)} ${won(r.cons).padStart(9)} ${won(r.up).padStart(9)}  ${grade(r.v62).padEnd(5)} ${d.padStart(7)}${s === now ? "  <- 지금" : ""}`);
      }
    }
    expect(CODES.length).toBeGreaterThan(0);
  });
});
