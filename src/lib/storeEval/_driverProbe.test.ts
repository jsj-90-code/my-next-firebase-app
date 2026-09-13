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
import { computePeerPosition } from "./peerPosition";
import { summarizeDrivers } from "./revenueDrivers";
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

// ---------------------------------------------------------------------------
// 후보지 진단 — 총매출 순위는 대수에 오염된다. 대당으로 갈라본다 (2026-09-13 밤)
//
// backlog "① 신중동점 — 예상매출이 낮게 뜬다"의 가설: "경쟁점이 10곳으로 많고 경쟁 공급(C)이
// 커서 log(D/(N+C))가 낮아지는 구조일 수 있다". 기여도 분해로 그 가설을 직접 검정한다.
// ---------------------------------------------------------------------------
d("후보지 진단 — 대수 효과를 분리한다", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[]; existingStores: ExistingStore[]; competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[]; sales: ExistingStoreMonthlySales[]; settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));

  const run = (candidate: CandidateInput, pcCount: number) =>
    evaluateCandidate({
      candidate: { ...candidate, expectedPcCount: pcCount },
      competitors: allCompetitors.filter((c) => c.candidateCode === candidate.code),
      locationEvaluation: snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null,
      settings,
      existingStores: snap.existingStores, trainingLocationEvaluations: snap.locationEvaluations,
      trainingCompetitors: allCompetitors, trainingSales: sales,
    });

  it("총매출 순위 vs 대당 순위 — 무엇이 낮은 평가를 만드는가", () => {
    const rows = snap.candidates.map((c) => {
      const pc = c.expectedPcCount ?? 100;
      const asIs = run(c, pc);
      const at100 = run(c, 100); // 대수를 100대로 통일했을 때
      const drivers = asIs.revenueBreakdown?.usageDrivers;
      const contrib = (label: string) => {
        if (!drivers) return null;
        const i = drivers.labels.findIndex((l) => l === label);
        return i < 0 ? null : (Math.exp(drivers.contributions[i]) - 1) * 100;
      };
      return {
        code: c.code, name: c.name ?? "", pc,
        revenue: asIs.v62Final ?? 0,
        perPc: (asIs.v62Final ?? 0) / pc,
        at100: at100.v62Final ?? 0,
        supply: contrib("공급 대비 수요"),
        visibility: contrib("접근성·가시성"),
        edge: contrib("경쟁력 우위 정도"),
        competitors: allCompetitors.filter((x) => x.candidateCode === c.code && x.investigationStatus !== "경쟁점없음").length,
      };
    });
    const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
    const byPerPc = [...rows].sort((a, b) => b.perPc - a.perPc);
    const rank = (list: typeof rows, code: string) => list.findIndex((r) => r.code === code) + 1;

    console.log("\n후보지          대수  예상매출   대당      총매출순위 대당순위  100대환산   경쟁점 공급대비수요 가시성  경쟁우위");
    for (const r of byPerPc) {
      console.log(
        `${r.code} ${r.name.padEnd(10)} ${String(r.pc).padStart(3)}대 ` +
        `${(Math.round(r.revenue / 10000).toLocaleString("ko-KR") + "만").padStart(7)} ` +
        `${(Math.round(r.perPc / 10000 * 10) / 10).toFixed(1).padStart(5)}만 ` +
        `${String(rank(byRevenue, r.code)).padStart(6)}위 ${String(rank(byPerPc, r.code)).padStart(6)}위 ` +
        `${(Math.round(r.at100 / 10000).toLocaleString("ko-KR") + "만").padStart(8)} ` +
        `${String(r.competitors).padStart(4)}곳 ` +
        `${(r.supply == null ? "-" : (r.supply >= 0 ? "+" : "") + r.supply.toFixed(1) + "%").padStart(8)} ` +
        `${(r.visibility == null ? "-" : (r.visibility >= 0 ? "+" : "") + r.visibility.toFixed(1) + "%").padStart(7)} ` +
        `${(r.edge == null ? "-" : (r.edge >= 0 ? "+" : "") + r.edge.toFixed(1) + "%").padStart(7)}`,
      );
    }
    console.log("");
    expect(rows.length).toBeGreaterThan(0);
  });
});

// 기존점 분포 위치가 실데이터에서 맞는지 (2026-09-13, 계산을 peerPosition.ts로 뽑아낸 뒤)
d("기존점 분포 위치 실데이터 점검", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[]; existingStores: ExistingStore[]; competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[]; sales: ExistingStoreMonthlySales[]; settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(s.storeCode + "_" + s.yearMonth));

  const rows = snap.candidates.map((candidate) => {
    const r = evaluateCandidate({
      candidate,
      competitors: allCompetitors.filter((c) => c.candidateCode === candidate.code),
      locationEvaluation: snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null,
      settings, existingStores: snap.existingStores,
      trainingLocationEvaluations: snap.locationEvaluations, trainingCompetitors: allCompetitors, trainingSales: sales,
    });
    return { code: candidate.code, name: candidate.name ?? "", pos: computePeerPosition(snap.existingStores, r.v62Final, candidate.expectedPcCount) };
  });

  it("후보지별 순위를 표로 남긴다", () => {
    const man = (v: number | null) => (v == null ? "-" : Math.round(v / 10000).toLocaleString("ko-KR") + "만");
    console.log("");
    for (const r of rows) {
      if (!r.pos) { console.log(r.code + " " + r.name + " — 표본 부족으로 표시 안 함"); continue; }
      console.log(
        r.code + " " + r.name.padEnd(10) +
        " " + String(r.pos.rank).padStart(2) + "/" + r.pos.peerCount + "위" +
        "  중앙값 " + man(r.pos.median) +
        "  대당 " + (r.pos.perPc ? man(r.pos.perPc.own) + " (중앙 " + man(r.pos.perPc.median) + ", " + r.pos.perPc.rank + "/" + r.pos.perPc.count + "위)" : "-"),
      );
    }
    console.log("");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("순위가 1..비교군수+1 범위 안이고 중앙값이 양수다", () => {
    for (const r of rows) {
      if (!r.pos) continue;
      expect(r.pos.rank).toBeGreaterThanOrEqual(1);
      expect(r.pos.rank).toBeLessThanOrEqual(r.pos.peerCount + 1);
      expect(r.pos.median).toBeGreaterThan(0);
    }
  });

  it("모든 후보지가 같은 비교군·중앙값을 본다 (후보지마다 달라지면 기준이 흔들린 것이다)", () => {
    const withPos = rows.filter((r) => r.pos);
    const counts = new Set(withPos.map((r) => r.pos!.peerCount));
    const medians = new Set(withPos.map((r) => r.pos!.median));
    expect(counts.size).toBe(1);
    expect(medians.size).toBe(1);
  });
});

// summarizeDrivers를 뽑아낸 뒤(2026-09-13) 실데이터에서 화면에 실제로 그려질 모양을 확인한다.
d("기여도 표시 변환 실데이터 점검", () => {
  const snap = loadValidationSnapshot() as {
    candidates: CandidateInput[]; existingStores: ExistingStore[]; competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[]; sales: ExistingStoreMonthlySales[]; settings: Record<string, unknown> | null;
  };
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(s.storeCode + "_" + s.yearMonth));

  const summaries = snap.candidates.map((candidate) => {
    const r = evaluateCandidate({
      candidate,
      competitors: allCompetitors.filter((c) => c.candidateCode === candidate.code),
      locationEvaluation: snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null,
      settings, existingStores: snap.existingStores,
      trainingLocationEvaluations: snap.locationEvaluations, trainingCompetitors: allCompetitors, trainingSales: sales,
    });
    return { code: candidate.code, name: candidate.name ?? "", s: summarizeDrivers(r.revenueBreakdown?.usageDrivers) };
  });

  it("9곳 전부 표시할 내용이 나온다", () => {
    for (const x of summaries) {
      expect(x.s, x.code + " 기여도 요약이 비었다").not.toBeNull();
      expect(x.s!.rows.length).toBeGreaterThan(0);
    }
  });

  it("막대 기준(maxAbs)이 0이 아니다 — 0이면 화면에서 0으로 나눈다", () => {
    for (const x of summaries) expect(x.s!.maxAbs).toBeGreaterThan(0);
  });

  it("가장 큰 항이 맨 위에 온다", () => {
    for (const x of summaries) {
      const absList = x.s!.rows.map((r) => Math.abs(r.pct));
      expect(absList).toEqual([...absList].sort((a, b) => b - a));
    }
  });

  it("총 효과가 현실적인 범위다 (-50%~+100%)", () => {
    for (const x of summaries) {
      expect(x.s!.totalPct, x.code + " 총효과 " + (x.s!.totalPct * 100).toFixed(1) + "%").toBeGreaterThan(-0.5);
      expect(x.s!.totalPct).toBeLessThan(1);
    }
  });

  it("막대 너비가 0~100% 안에 들어간다", () => {
    for (const x of summaries) {
      for (const r of x.s!.rows) {
        const width = (Math.abs(r.pct) / x.s!.maxAbs) * 100;
        expect(width).toBeGreaterThan(0);
        expect(width).toBeLessThanOrEqual(100);
      }
    }
  });
});
