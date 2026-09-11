// **경쟁이 늘수록 예상매출이 오르는 구간**이 남아 있는지 확인하는 도구.
//
// 2026-09-11에 확인된 미해결 문제다. 경쟁력격차가 `자사점수 ÷ 경쟁점 PC대수 가중 평균점수`라
// 평균보다 약한 경쟁점이 늘면 분모가 내려가 격차가 커지고, 그 효과가 경쟁 공급 증가 효과를
// 넘으면 매출이 오른다. 해결안 2개(공급 통합·격차 기본값)는 검정에서 탈락했고, 지금은
// **경쟁점 탭에서 왜 그런지 설명만** 띄우고 있다.
//
// **산식을 손대면 이 파일을 먼저 돌려라.** 아래 기대치가 어떻게 바뀌는지가 판정 기준이다.
// 2026-09-11 기준: 약한 경쟁점 1곳 신설 → 9곳 중 **8곳 상승** / 경쟁점 전부 제거 → 9곳 전부
// 하락 / 센 경쟁점 신설(대조군) → 9곳 전부 하락.
//
// 돌리는 법:
//   node .local-tools/dump-validation-snapshot.mjs
//   npx vitest run src/lib/storeEval/competitorMonotonicity.test.ts
//
// 왜 중요한가 — 직원이 경쟁점을 하나 더 넣었는데 예상매출이 **올라가면** 그 순간 도구를
// 못 믿게 된다. 적중률보다 먼저 걸리는 문제다.
//
// 재현: node .local-tools/dump-validation-snapshot.mjs
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeCompetitorScores } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluateCandidate } from "./evaluate";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { mergeModelSettings } from "./settings";
import type { CandidateInput, Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation } from "./types";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const describeIfSnapshot = existsSync(SNAPSHOT) ? describe : describe.skip;

type Snapshot = {
  candidates: CandidateInput[];
  competitors: Record<string, unknown>[];
  locationEvaluations: LocationEvaluation[];
  existingStores: ExistingStore[];
  sales: ExistingStoreMonthlySales[];
  settings: Record<string, unknown> | null;
};

describeIfSnapshot("경쟁이 늘어날 때 예상매출이 내려가는가", () => {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));

  const evaluate = (candidate: CandidateInput, competitors: Competitor[]) =>
    evaluateCandidate({
      candidate,
      competitors,
      locationEvaluation: snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null,
      settings,
      existingStores: snap.existingStores,
      trainingLocationEvaluations: snap.locationEvaluations,
      trainingCompetitors: allCompetitors,
      trainingSales: sales,
    });

  const pcOf = (c: Competitor) => c.appliedPcCount ?? c.totalPcCount ?? null;
  const scoreOf = (c: Competitor) => computeCompetitorScores(c, settings).total;

  type Case = { code: string; name: string; base: number; after: number; deltaPct: number; ownDemandDelta: number | null };

  function run(label: string, mutate: (list: Competitor[]) => Competitor[] | null) {
    const rows: Case[] = [];
    for (const candidate of snap.candidates) {
      const mine = allCompetitors.filter((c) => c.candidateCode === candidate.code);
      if (mine.length === 0) continue;
      const mutated = mutate(mine);
      if (!mutated) continue;
      const before = evaluate(candidate, mine);
      const after = evaluate(candidate, mutated);
      if (before.v62Final == null || after.v62Final == null || before.v62Final <= 0) continue;
      rows.push({
        code: candidate.code,
        name: candidate.name ?? "",
        base: before.v62Final,
        after: after.v62Final,
        deltaPct: (after.v62Final - before.v62Final) / before.v62Final,
        ownDemandDelta:
          before.expectedOwnDemand != null && after.expectedOwnDemand != null && before.expectedOwnDemand > 0
            ? (after.expectedOwnDemand - before.expectedOwnDemand) / before.expectedOwnDemand
            : null,
      });
    }
    const up = rows.filter((r) => r.deltaPct > 1e-9);
    console.log(
      `\n【${label}】 ${rows.length}곳 중 **예상매출이 오른 곳 ${up.length}곳**\n` +
        rows
          .map(
            (r) =>
              `  ${r.code} ${r.name.padEnd(10)} 매출 ${(r.deltaPct * 100).toFixed(3).padStart(7)}%` +
              (r.ownDemandDelta != null ? `   자사수요 ${(r.ownDemandDelta * 100).toFixed(2).padStart(7)}%` : ""),
          )
          .join("\n"),
    );
    return { rows, up };
  }

  // ① 가장 약한 경쟁점의 좌석을 늘린다 — Codex가 본 경로(평균점수가 내려가 gap이 커진다).
  it("가장 약한 경쟁점의 좌석을 늘리면", () => {
    const { rows, up } = run("가장 약한 경쟁점 PC +60대", (list) => {
      const scored = list.filter((c) => scoreOf(c) != null && pcOf(c) != null);
      if (scored.length === 0) return null;
      const weakest = scored.reduce((a, b) => ((scoreOf(a) as number) <= (scoreOf(b) as number) ? a : b));
      return list.map((c) => (c.id === weakest.id ? { ...c, appliedPcCount: (pcOf(c) as number) + 60 } : c));
    });
    expect(rows.length).toBeGreaterThan(0);
    if (up.length) console.log(`  → 경쟁 공급이 늘었는데 매출이 오른 곳이 ${up.length}곳 있다.`);
  });

  // ② 평균보다 약한 경쟁점이 하나 **새로 생긴다** — 직원이 실제로 하는 입력이다.
  it("평균보다 약한 경쟁점이 하나 새로 생기면", () => {
    const { rows, up } = run("약한 경쟁점 1곳 신설(100대)", (list) => {
      const template = list.find((c) => scoreOf(c) != null && pcOf(c) != null);
      if (!template) return null;
      // 기존 경쟁점 중 가장 약한 것을 복제한다 — 점수를 지어내지 않고 실측값을 쓴다.
      const scored = list.filter((c) => scoreOf(c) != null);
      const weakest = scored.reduce((a, b) => ((scoreOf(a) as number) <= (scoreOf(b) as number) ? a : b));
      return [...list, { ...weakest, id: `${weakest.id}__가상신설`, appliedPcCount: 100, totalPcCount: 100 }];
    });
    expect(rows.length).toBeGreaterThan(0);
    if (up.length) console.log(`  → 경쟁점이 늘었는데 매출이 오른 곳이 ${up.length}곳 있다.`);
  });

  // ③ 경계 — 경쟁점이 아예 없으면(독점) 매출이 가장 높아야 한다.
  it("경쟁점을 전부 없애면 (독점 = 최대여야 한다)", () => {
    const { rows } = run("경쟁점 전부 제거", () => []);
    const down = rows.filter((r) => r.deltaPct < -1e-9);
    console.log(`  → 독점으로 만들었는데 매출이 내려간 곳 ${down.length}곳 (0이어야 정상)`);
    expect(rows.length).toBeGreaterThan(0);
  });

  // ④ 대조군 — 가장 센 경쟁점이 새로 생기면 당연히 내려가야 한다.
  it("가장 센 경쟁점이 하나 새로 생기면 (대조군)", () => {
    const { rows, up } = run("센 경쟁점 1곳 신설(100대)", (list) => {
      const scored = list.filter((c) => scoreOf(c) != null);
      if (scored.length === 0) return null;
      const strongest = scored.reduce((a, b) => ((scoreOf(a) as number) >= (scoreOf(b) as number) ? a : b));
      return [...list, { ...strongest, id: `${strongest.id}__가상신설`, appliedPcCount: 100, totalPcCount: 100 }];
    });
    expect(rows.length).toBeGreaterThan(0);
    console.log(`  → 오른 곳 ${up.length}곳 (0이어야 정상)`);
  });
});
