// 자사 먹거리·인테리어 기준값을 내리면 무엇이 움직이나 — 2026-09-18 사용자 요청
//
// 사용자: *"먹거리 평가에 대한 부분이 기준점이 없으니까. 자사 먹거리를 3.5 정도로 낮추는 거
//          어떤데. 3~4 정도로 조정하는 거 검토 좀. 인테리어도 지금 4점인데 3~4로 검토 좀.
//          다만 이건 매장별 차등 주진 않을 거고 일괄 적용임."*
//   근거: *"먹거리는 프차 자체브랜드니까 통일성 있는 거고, 인테리어는 신규매장 1년 이내 평가"*
//
// ── 이건 계수가 아니라 **값**이다 ──────────────────────────────────────────
// 자사 41곳이 전부 같은 값이라, 자사끼리의 순서는 무엇을 넣어도 안 바뀐다. 움직이는 건
// **자사 ÷ 경쟁점 비**뿐이다. 그래서 성적이 좋아지는 쪽으로 고르면 그냥 눈금 옮기기가 된다
// (이 저장소 규칙: 항목은 뜻으로 정하고 계수만 자료로 정한다).
// 여기서는 **정하지 않는다.** 뜻은 사람이 정하고, 이 하네스는 그 선택이 얼마나 움직이는지만 잰다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_ownFoodInterior.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  qscInWindowAverage, utilizationByStore, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const manwon = (v: number | null | undefined) =>
  v == null ? "      -" : `${Math.round(v / 10000).toLocaleString().padStart(6)}만`;

describeIf("자사 먹거리·인테리어 기준값", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];

  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const locByCode = new Map(locationEvaluations.map((l) => [l.candidateCode, l]));
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id; if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }

  it("(1) 지금 자사와 경쟁점이 어떤 값을 받고 있나", () => {
    const own = { food: new Map<number, number>(), interior: new Map<number, number>() };
    for (const s of snap.existingStores ?? []) {
      for (const [k, v] of [["food", s.ownFoodScore], ["interior", s.ownInteriorScore]] as const) {
        if (v == null) continue;
        const m = own[k as "food" | "interior"];
        m.set(Number(v), (m.get(Number(v)) ?? 0) + 1);
      }
    }
    const rivals = { food: new Map<number, number>(), interior: new Map<number, number>() };
    for (const c of allCompetitors) {
      for (const [k, v] of [["food", c.foodScore], ["interior", c.interiorScore]] as const) {
        if (v == null) continue;
        const m = rivals[k as "food" | "interior"];
        m.set(Number(v), (m.get(Number(v)) ?? 0) + 1);
      }
    }
    const show = (label: string, m: Map<number, number>) => {
      const keys = [...m.keys()].sort((a, b) => a - b);
      let n = 0, sum = 0;
      for (const k of keys) { n += m.get(k)!; sum += k * m.get(k)!; }
      console.log(`  ${label.padEnd(16)} ${keys.map((k) => `${k}점:${m.get(k)}`).join(" · ")}` +
        `   평균 ${(sum / n).toFixed(2)} (n=${n})`);
    };
    console.log(`\n[지금 값]`);
    show("자사 먹거리", own.food);
    show("경쟁점 먹거리", rivals.food);
    show("자사 인테리어", own.interior);
    show("경쟁점 인테리어", rivals.interior);
    console.log(`\n  비중(실험실): 먹거리 ${DEFAULT_TEXTBOOK_PARAMS.qualityWeights.food} · ` +
      `인테리어 ${DEFAULT_TEXTBOOK_PARAMS.qualityWeights.interior}` +
      `  (합 ${(DEFAULT_TEXTBOOK_PARAMS.qualityWeights.food + DEFAULT_TEXTBOOK_PARAMS.qualityWeights.interior).toFixed(3)})`);
    expect(own.food.size).toBeGreaterThan(0);
  });

  // 자사 점수를 갈아끼운 사본으로 전체를 다시 돌린다. 원본 스냅샷은 안 건드린다.
  const runWith = (food: number | null, interior: number | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storesRaw = (snap.existingStores as any[]).map((s) => ({
      ...s,
      ...(food == null ? {} : { ownFoodScore: food }),
      ...(interior == null ? {} : { ownInteriorScore: interior }),
    }));
    const stores = prepareExistingStoresForEvaluation(storesRaw, allCompetitors, locationEvaluations, settings);
    const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
    const P = { ...DEFAULT_TEXTBOOK_PARAMS };
    const s = scoreTextbook(rows, P);
    const full = fittedParams(P, s);
    const cands = candidates.map((c) => ({
      ...c,
      ...(food == null ? {} : { ownFoodScore: food }),
      ...(interior == null ? {} : { ownInteriorScore: interior }),
    })) as CandidateInput[];
    const franchiseManagement = franchiseManagementFromRows(rows);
    const candRows = buildLabCandidateRows({ candidates: cands, compsByCode, locByCode, settings, franchiseManagement });
    const preds = new Map<string, number | null>();
    for (const r of candRows) preds.set(r.input.storeCode, computeTextbook(r.input, full).monthlyRevenue ?? null);
    return { score: s, preds };
  };

  it("(2) 먹거리만 내리면", () => {
    const base = runWith(4, 4);
    console.log(`\n[먹거리만 조정 — 인테리어 4 고정]`);
    console.log(`  먹거리   MAPE     중앙    ±20%    후보지 평균 예측 변화`);
    // ⚠️ 위쪽(4.5·5)도 같이 훑는다. 아래로만 훑으면 "4가 최선"이라는 착각이 생긴다 —
    //    실제로 물어야 할 건 "성적이 4에서 꺾이나, 아니면 그냥 높을수록 좋나"다.
    //    후자면 자료는 값을 못 고르는 것이고, 4는 우리가 멈춘 자리일 뿐이다.
    for (const f of [5, 4.5, 4, 3.5, 3, 2.5]) {
      const r = runWith(f, 4);
      const deltas: number[] = [];
      for (const [k, v] of r.preds) {
        const b = base.preds.get(k);
        if (v != null && b != null && b > 0) deltas.push((v - b) / b);
      }
      const avg = deltas.length ? (deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100 : 0;
      console.log(`  ${String(f).padStart(5)}   ${(r.score.mape! * 100).toFixed(2)}%  ` +
        `${(r.score.medianAbsErr! * 100).toFixed(1)}%  ${(r.score.within20! * 100).toFixed(0)}%   ` +
        `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%${f === 4 ? "   <- 지금" : ""}`);
    }
    expect(base.preds.size).toBeGreaterThan(0);
  });

  it("(3) 인테리어만 내리면", () => {
    const base = runWith(4, 4);
    console.log(`\n[인테리어만 조정 — 먹거리 4 고정]`);
    console.log(`  인테리어  MAPE     중앙    ±20%    후보지 평균 예측 변화`);
    for (const v0 of [5, 4.5, 4, 3.5, 3, 2.5]) {
      const r = runWith(4, v0);
      const deltas: number[] = [];
      for (const [k, v] of r.preds) {
        const b = base.preds.get(k);
        if (v != null && b != null && b > 0) deltas.push((v - b) / b);
      }
      const avg = deltas.length ? (deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100 : 0;
      console.log(`  ${String(v0).padStart(6)}   ${(r.score.mape! * 100).toFixed(2)}%  ` +
        `${(r.score.medianAbsErr! * 100).toFixed(1)}%  ${(r.score.within20! * 100).toFixed(0)}%   ` +
        `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%${v0 === 4 ? "   <- 지금" : ""}`);
    }
    expect(true).toBe(true);
  });

  it("(4) 같이 내리면 — 후보지 낱개로", () => {
    const base = runWith(4, 4);
    const combos: [number, number][] = [[4, 4], [3.5, 4], [3.5, 3.5], [3, 3.5], [3, 3]];
    const runs = combos.map(([f, i]) => ({ f, i, ...runWith(f, i) }));
    console.log(`\n[같이 조정]`);
    console.log(`  먹거리·인테리어   MAPE     중앙    ±20%`);
    for (const r of runs) {
      console.log(`  ${`${r.f} · ${r.i}`.padEnd(14)}  ${(r.score.mape! * 100).toFixed(2)}%  ` +
        `${(r.score.medianAbsErr! * 100).toFixed(1)}%  ${(r.score.within20! * 100).toFixed(0)}%` +
        `${r.f === 4 && r.i === 4 ? "   <- 지금" : ""}`);
    }
    console.log(`\n  후보지 예측`);
    console.log(`  코드    ${combos.map(([f, i]) => `${f}·${i}`.padStart(8)).join("")}`);
    for (const code of [...base.preds.keys()]) {
      console.log(`  ${code.padEnd(6)}  ${runs.map((r) => manwon(r.preds.get(code)).padStart(8)).join("")}`);
    }
    expect(runs.length).toBe(combos.length);
  });
});
