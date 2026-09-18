// 오송점(N016) 입지동선평가 3종 점수를 바꾸면 V62 최종값이 얼마나 움직이는지만 잰다.
// **아무것도 안 바꾼다** — Firestore도 설정도 건드리지 않고, 메모리 안에서 점수만 갈아끼워
// `evaluateCandidate`를 다시 돌린 결과를 표로 찍는다.
//
//   npx vitest run src/lib/storeEval/_labCandidate.test.ts --disable-console-intercept
//
// 스냅샷이 있어야 돈다: node scripts/dumpValidationSnapshot.mjs
// (2026-09-18 회사 PC에서 같은 이름으로 만들었던 하네스가 커밋되지 않아 집 PC에서 다시 만들었다.)
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { computeLocationCompositeScore } from "./calc";
import type {
  CandidateInput,
  Competitor,
  EvaluationResult,
  ExistingStore,
  ExistingStoreMonthlySales,
  LocationEvaluation,
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

const CODE = "N016";
const describeIfSnapshot = hasValidationSnapshot() ? describe : describe.skip;

describeIfSnapshot("오송점 입지동선평가 3종 감도", () => {
  const snap = loadValidationSnapshot<Snapshot>() as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));

  const candidate = (snap.candidates ?? []).find((c) => c.code === CODE) ?? null;
  const baseLoc = snap.locationEvaluations.find((l) => l.candidateCode === CODE) ?? null;
  const competitors = allCompetitors.filter((c) => c.candidateCode === CODE);
  const stored = (snap.results ?? []).find((r) => r.candidateCode === CODE) ?? null;

  // 점수 셋만 갈아끼운 사본으로 평가한다. 원본 객체는 건드리지 않는다.
  const runWith = (flow: number, preempt: number, visibility: number) => {
    const loc = baseLoc
      ? ({ ...baseLoc, locationScore: flow, preemptionScore: preempt, visibilityScore: visibility } as LocationEvaluation)
      : null;
    const r = evaluateCandidate({
      candidate: candidate as CandidateInput,
      competitors,
      locationEvaluation: loc,
      settings,
      existingStores: snap.existingStores,
      trainingLocationEvaluations: snap.locationEvaluations.map((l) =>
        l.candidateCode === CODE && loc ? loc : l,
      ),
      trainingCompetitors: allCompetitors,
      trainingSales: sales,
    });
    const composite = computeLocationCompositeScore(
      { marketPositionFlow: flow, preemption: preempt, visibility },
      settings,
    );
    return {
      composite,
      own: r.ownCompetitivenessScore ?? null,
      gap: r.competitivenessGap ?? null,
      v62: r.v62Final ?? null,
    };
  };

  it("후보지와 입지평가가 스냅샷에 있다", () => {
    expect(candidate).not.toBeNull();
    expect(baseLoc).not.toBeNull();
  });

  it("점수 조합별 V62 최종값을 표로 남긴다", () => {
    const now = {
      flow: baseLoc?.locationScore ?? null,
      preempt: baseLoc?.preemptionScore ?? null,
      visibility: baseLoc?.visibilityScore ?? null,
    };
    const cases: { label: string; s: [number, number, number] }[] = [
      { label: "옛 기준 (4·4·4)", s: [4, 4, 4] },
      { label: "위치동선만 3 (3·4·4)", s: [3, 4, 4] },
      { label: "접근가시성만 3 (4·4·3)", s: [4, 4, 3] },
      { label: "선점경쟁만 2 (4·2·4)", s: [4, 2, 4] },
      { label: "지금 Firestore (3·4·3)", s: [3, 4, 3] },
      { label: "셋 다 3 (3·3·3)", s: [3, 3, 3] },
      { label: "권고 3·2·3", s: [3, 2, 3] },
      { label: "더 낮게 2·2·3", s: [2, 2, 3] },
      { label: "셋 다 5 (5·5·5)", s: [5, 5, 5] },
    ];

    const base = runWith(4, 4, 4).v62;
    const won = (v: number | null) => (v == null ? "-" : `${(Math.round(v) / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}만`);
    const lines = cases.map(({ label, s }) => {
      const r = runWith(s[0], s[1], s[2]);
      const vs = base && r.v62 != null ? `${(((r.v62 - base) / base) * 100).toFixed(1)}%` : "-";
      return [
        label.padEnd(22),
        (r.composite?.toFixed(2) ?? "-").padStart(6),
        (r.own?.toFixed(3) ?? "-").padStart(7),
        (r.gap?.toFixed(3) ?? "-").padStart(7),
        won(r.v62).padStart(9),
        vs.padStart(8),
      ].join(" ");
    });

    console.log(
      `\n[오송점 ${CODE} 입지 3종 감도] 지금 Firestore = ${now.flow}·${now.preempt}·${now.visibility}\n` +
        `저장된 결과값 ${won(stored?.v62Final ?? null)} (계산 시각 ${stored?.calculatedAt ? new Date(stored.calculatedAt).toISOString() : "-"})\n` +
        `입지평가 최종수정 ${baseLoc?.updatedAt ? new Date(baseLoc.updatedAt).toISOString() : "-"}\n\n` +
        `  ${"바꾼 것".padEnd(20)} ${"합성".padStart(6)} ${"경쟁력".padStart(7)} ${"격차".padStart(7)} ${"V62최종".padStart(9)} ${"4·4·4대비".padStart(8)}\n` +
        lines.map((l) => `  ${l}`).join("\n"),
    );
    expect(lines.length).toBe(cases.length);
  });
});
