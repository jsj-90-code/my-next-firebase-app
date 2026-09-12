// 요인별 기여도("왜 이 매출인가") 실데이터 점검 — 조사용 프로브 (2026-09-13).
//
// 파일명이 `_`로 시작해 평소 `npm test`에서는 제외된다(`--exclude "**/_*.test.ts"`).
// 돌리려면 파일을 직접 지정한다:
//   npx vitest run src/lib/storeEval/_driverProbe.test.ts --reporter=verbose --disable-console-intercept
//
// 목적: 화면에 새로 붙인 기여도 분해가 **실제 후보지에서 말이 되는 값**을 내는지 눈으로 본다.
// 계산 자체는 예측 경로에서 그대로 꺼낸 값이라 틀릴 여지가 적지만, 라벨이 값과 짝이 맞는지와
// "요금 +30%" 같은 비현실적 수치가 없는지는 실데이터로만 확인된다.

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { collectReviewSignals } from "./reviewSignals";
import { storeEvaluationGrade } from "./reportContext";
import type { CandidateInput, Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation } from "./types";

const d = hasValidationSnapshot() ? describe : describe.skip;

d("요인별 기여도 실데이터 점검", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[];
    existingStores: ExistingStore[];
    competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[];
    sales: ExistingStoreMonthlySales[];
    settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));

  const rows = snap.candidates.map((candidate) => {
    const evaluated = evaluateCandidate({
      candidate,
      competitors: allCompetitors.filter((c) => c.candidateCode === candidate.code),
      locationEvaluation: snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null,
      settings,
      existingStores: snap.existingStores,
      trainingLocationEvaluations: snap.locationEvaluations,
      trainingCompetitors: allCompetitors,
      trainingSales: sales,
    });
    return { code: candidate.code, name: candidate.name ?? "", drivers: evaluated.revenueBreakdown?.usageDrivers ?? null, revenue: evaluated.v62Final };
  });

  it("후보지별 기여도를 표로 남긴다", () => {
    const lines: string[] = [];
    for (const r of rows) {
      lines.push(`\n■ ${r.code} ${r.name} — 예상 ${r.revenue == null ? "-" : Math.round(r.revenue / 10000).toLocaleString("ko-KR") + "만원"}`);
      if (!r.drivers) {
        lines.push("  (기여도 없음 — 모형이 예측을 못 낸 후보지)");
        continue;
      }
      const { labels, contributions } = r.drivers;
      lines.push(`  라벨 ${labels.length}개 / 기여도 ${contributions.length}개${labels.length === contributions.length ? "" : "  ⚠️ 길이 불일치!"}`);
      labels.forEach((label, i) => {
        const pct = (Math.exp(contributions[i]) - 1) * 100;
        lines.push(`    ${label.padEnd(22)} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
      });
      // 모든 항을 곱하면 코호트 평균 대비 총배수가 된다. 화면 설명("함께 곱해져 나온다")의 근거.
      const total = (Math.exp(contributions.reduce((s, v) => s + v, 0)) - 1) * 100;
      lines.push(`    ${"→ 전부 곱하면".padEnd(22)} ${total >= 0 ? "+" : ""}${total.toFixed(1)}%`);
    }
    console.log(lines.join("\n"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("라벨과 기여도 개수가 항상 맞는다", () => {
    for (const r of rows) {
      if (!r.drivers) continue;
      expect(r.drivers.labels.length, `${r.code} 라벨/기여도 길이 불일치`).toBe(r.drivers.contributions.length);
    }
  });

  it("기여도가 비현실적으로 크지 않다 (한 요인이 ±10배를 넘지 않는다)", () => {
    // 표준화 좌표계라 극단값이 나오면 입력이 코호트 범위를 크게 벗어났다는 신호다 — 그 자체가
    // 확인할 거리다. 여기서 잡히면 해당 후보지의 입력값을 봐야 한다.
    for (const r of rows) {
      if (!r.drivers) continue;
      r.drivers.contributions.forEach((v, i) => {
        expect(Math.abs(v), `${r.code} ${r.drivers!.labels[i]} 기여도가 비정상`).toBeLessThan(Math.log(10));
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 확인 신호·기존점 순위가 실데이터에서 쓸 만한지 점검 (2026-09-13 밤)
// 신호가 모든 후보지에서 우수수 뜨면 노이즈라 아무도 안 본다. 실제 분포를 본다.
// ---------------------------------------------------------------------------
d("확인 신호 실데이터 점검", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[];
    existingStores: ExistingStore[];
    competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[];
    sales: ExistingStoreMonthlySales[];
    settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));

  const rows = snap.candidates.map((candidate) => {
    const competitors = allCompetitors.filter((c) => c.candidateCode === candidate.code);
    const loc = snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null;
    const result = evaluateCandidate({
      candidate, competitors, locationEvaluation: loc, settings,
      existingStores: snap.existingStores, trainingLocationEvaluations: snap.locationEvaluations,
      trainingCompetitors: allCompetitors, trainingSales: sales,
    });
    const signals = collectReviewSignals({ result, candidate, competitors, locationEvaluation: loc, usedDefaultSettings: false });
    // 기존점 순위(PeerPositionNote와 같은 기준)
    const peers = snap.existingStores.filter(
      (s) => s.brandType === "블랙라벨" && !s.excludedFromModel && s.actualMonthlyRevenueAvg != null && s.actualMonthlyRevenueAvg > 0,
    );
    const revenues = peers.map((s) => s.actualMonthlyRevenueAvg as number);
    const rank = result.v62Final == null ? null : revenues.filter((r) => r > result.v62Final!).length + 1;
    return { code: candidate.code, name: candidate.name ?? "", signals, rank, peerCount: peers.length, revenue: result.v62Final };
  });

  it("후보지별 신호 개수와 순위를 표로 남긴다", () => {
    const lines = rows.map((r) => {
      const byLevel = ["확인", "주의", "정보"].map((lv) => `${lv} ${r.signals.filter((s) => s.level === lv).length}`).join(" / ");
      const forReport = r.signals.filter((s) => s.forReport).length;
      return `${r.code} ${r.name.padEnd(10)} 신호 ${String(r.signals.length).padStart(2)}건 (${byLevel}) · 문서용 ${forReport}건 · 순위 ${r.rank}/${r.peerCount}`;
    });
    const total = rows.reduce((s, r) => s + r.signals.length, 0);
    console.log(`\n${lines.join("\n")}\n\n평균 ${(total / rows.length).toFixed(1)}건/후보지`);
    console.log(`\n[신호별 등장 횟수]`);
    const counts = new Map<string, number>();
    for (const r of rows) for (const s of r.signals) counts.set(s.title.replace(/\d+/g, "N"), (counts.get(s.title.replace(/\d+/g, "N")) ?? 0) + 1);
    for (const [title, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}곳  ${title}`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("신호가 노이즈 수준으로 쏟아지지 않는다 (후보지당 평균 6건 미만)", () => {
    const avg = rows.reduce((s, r) => s + r.signals.length, 0) / rows.length;
    expect(avg, `후보지당 평균 ${avg.toFixed(1)}건 — 너무 많으면 아무도 안 본다`).toBeLessThan(6);
  });

  it("순위가 표본 범위 안에 있다", () => {
    for (const r of rows) {
      if (r.rank == null) continue;
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.rank).toBeLessThanOrEqual(r.peerCount + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// PC대수 시뮬레이션 타당성 측정 (2026-09-13 밤)
// evaluateCandidate는 호출할 때마다 모형을 새로 학습한다. 대수를 여러 개 돌리려면 그 비용이
// 화면에서 감당 가능한지부터 재야 한다.
// ---------------------------------------------------------------------------
d("PC대수 재계산 비용", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[]; existingStores: ExistingStore[]; competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[]; sales: ExistingStoreMonthlySales[]; settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const candidate = snap.candidates[0];

  it("대수 11개를 다시 계산하는 데 걸리는 시간", () => {
    const competitors = allCompetitors.filter((c) => c.candidateCode === candidate.code);
    const loc = snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null;
    const base = candidate.expectedPcCount ?? 100;
    const counts = Array.from({ length: 11 }, (_, i) => Math.max(10, base - 25 + i * 5));
    const t0 = performance.now();
    const out = counts.map((pcCount) => {
      const r = evaluateCandidate({
        candidate: { ...candidate, expectedPcCount: pcCount },
        competitors, locationEvaluation: loc, settings,
        existingStores: snap.existingStores, trainingLocationEvaluations: snap.locationEvaluations,
        trainingCompetitors: allCompetitors, trainingSales: sales,
      });
      return { pcCount, revenue: r.v62Final, grade: storeEvaluationGrade(r), util: r.v62ImpliedUtilization, baseline: r.aaBaselineRevenue };
    });
    const ms = performance.now() - t0;
    console.log(`\n${candidate.code} ${candidate.name} — 11개 대수 재계산 ${ms.toFixed(0)}ms (개당 ${(ms / 11).toFixed(0)}ms)\n`);
    console.log("대수\t예상매출\t등급\t필요가동률\t선투자기준");
    for (const o of out) {
      console.log(`${o.pcCount}대\t${o.revenue == null ? "-" : Math.round(o.revenue / 10000).toLocaleString("ko-KR") + "만원"}\t${o.grade ?? "-"}\t${o.util == null ? "-" : (o.util * 100).toFixed(1) + "%"}\t${o.baseline == null ? "-" : Math.round(o.baseline / 10000).toLocaleString("ko-KR") + "만원"}`);
    }
    // 화면에서 즉시 돌리려면 넉넉히 2초 안에는 끝나야 한다.
    expect(ms, `11개 재계산에 ${ms.toFixed(0)}ms — 너무 느리면 화면에서 버튼 눌러 실행하는 방식으로 바꿔야 한다`).toBeLessThan(2000);
  });
});

// 등급 경계가 실제로 존재하는지 — 기능을 만들 가치가 있는지부터 데이터로 본다.
d("PC대수와 등급의 관계", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[]; existingStores: ExistingStore[]; competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[]; sales: ExistingStoreMonthlySales[]; settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));

  it("후보지마다 대수를 넓게 바꿔보고 등급이 변하는 지점을 찾는다", () => {
    const counts = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140];
    const lines: string[] = [];
    for (const candidate of snap.candidates) {
      const competitors = allCompetitors.filter((c) => c.candidateCode === candidate.code);
      const loc = snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null;
      const grades = counts.map((pcCount) => {
        const r = evaluateCandidate({
          candidate: { ...candidate, expectedPcCount: pcCount },
          competitors, locationEvaluation: loc, settings,
          existingStores: snap.existingStores, trainingLocationEvaluations: snap.locationEvaluations,
          trainingCompetitors: allCompetitors, trainingSales: sales,
        });
        return { pcCount, grade: storeEvaluationGrade(r) ?? "미달", util: r.v62ImpliedUtilization };
      });
      const distinct = [...new Set(grades.map((g) => g.grade))];
      const utilRange = grades.map((g) => g.util).filter((u): u is number => u != null);
      lines.push(
        `${candidate.code} ${(candidate.name ?? "").padEnd(10)} 계획 ${String(candidate.expectedPcCount ?? "-").padStart(3)}대 · ` +
        `등급 ${distinct.join(",")} ${distinct.length === 1 ? "(대수 30~140대 내내 동일)" : "← 경계 있음: " + grades.map((g) => `${g.pcCount}:${g.grade}`).join(" ")}` +
        ` · 필요가동률 ${(Math.min(...utilRange) * 100).toFixed(1)}~${(Math.max(...utilRange) * 100).toFixed(1)}%`,
      );
    }
    console.log(`\n${lines.join("\n")}\n`);
    expect(lines.length).toBeGreaterThan(0);
  });
});
