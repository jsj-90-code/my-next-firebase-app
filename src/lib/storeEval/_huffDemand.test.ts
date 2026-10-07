// 배후지 겹침 — 허프 몫(추정)·상권 쏠림(실측 유동)을 실험실 수요에 넣으면 어디로 가나 (2026-10-07). 읽기전용.
// 본체/운영/Firestore 미변경. 재고 표 + 권고 → 사용자 결정. 상세 docs/huff-hinterland-20261007.md
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 사용자(2026-10-07): "상권이 겹치더라도 어느 상권에 인구가 쏠려있는지 데이터로 확인하고자 함" · "산식에 포함되는 게 궁극적".
// 두 지표를 같은 틀로 시험한다:
//   허프 몫  = 배후 2km 주민 중 우리 1km 창으로 오는 몫(점포 수·거리로 추정, computeHuffShare.mjs)
//   쏠림 비  = 우리 자리 300m 유동 ÷ 옆 상권 봉우리 300m 유동(소상공인365 실측, buildHubPoints.mjs)
//              최대 봉우리 대비(max) · 상위 3곳 평균 대비(top3) 두 가지
// 첫 날것 확인: 허프 몫 ↔ 가동률 순위상관 −0.42 — "뺏긴다"보다 "모이면 붐빈다". 그래서 γ를 음수까지 연다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 배수 = exp(γ·(ln x − 자사 평균 ln x)) — 자사 기하평균이 1이 되게 가운데 맞춤 → 수준 이동이 아니라 순서만 바꾼다.
//    그다음 fittedParams로 축척을 다시 맞춘다(변형마다 공정하게).
// 2. γ ∈ {−0.5, −0.25, 0, +0.25, +0.5}. 고르는 게 아니라 방향을 본다. 최적 γ 하나를 채택 근거로 쓰지 않는다.
// 3. 잣대: `_layerSplit` (6)과 같은 전체 MAE · 이해되는 오차 · ±5%p · 33곳 편향 · 10%p↑ · 바닥(전부 평균) + 후보지 평균 이동·최대 이동.
// 4. 기각 기준: 후보지가 한결같이 한쪽으로만 움직이면(09-24 고리 묶음 실패) · 바닥 못 넘으면 · 개선이 2SE(≈0.7%p) 안이면 "판정 불가".
// 5. 지표가 없는 자리(유동 미수집 후보지 등)는 배수 1.
//
// 실행: npx vitest run src/lib/storeEval/_huffDemand.test.ts --disable-console-intercept

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { LAB_UPSIDE_STORE_CODES, buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const HUFF = ".local-tools/huff-share.json";
const FLOAT = ".local-tools/sbiz-floating-population.json";
const HUBS = ".local-tools/hub-points.json";
const ready = hasValidationSnapshot() && existsSync(HUFF) && existsSync(FLOAT) && existsSync(HUBS);
const describeIf = ready ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const pp = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}`;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("배후지 겹침 — 허프 몫 · 상권 쏠림을 실험실 수요 배수로", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
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
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locByCode = new Map<string, LocationEvaluation>(((snap.locationEvaluations ?? []) as LocationEvaluation[]).map((l) => [l.candidateCode, l]));
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement: franchiseManagementFromRows(rows), residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
  const own = rows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
  const isUp = (code: string) => LAB_UPSIDE_STORE_CODES.has(code);

  // ── 지표 ────────────────────────────────────────────────────────────────
  const huff = new Map<string, number>((JSON.parse(readFileSync(HUFF, "utf8")).rows as { code: string; shareAll: number }[]).map((r) => [r.code, r.shareAll]));
  const fl = JSON.parse(readFileSync(FLOAT, "utf8")).sites as Record<string, { radii?: Record<string, { selected?: number[] }> }>;
  const f300 = (key: string) => { const s = fl[key]?.radii?.["300"]?.selected; return s && s.length ? mean(s.slice(-12)) : null; };
  const hubsBySite = new Map<string, string[]>();
  for (const h of JSON.parse(readFileSync(HUBS, "utf8")).points as { code: string; sites: string[] }[]) for (const s of h.sites) hubsBySite.set(s, [...(hubsBySite.get(s) ?? []), h.code]);
  const pull = (code: string, mode: "max" | "top3") => {
    const ownF = f300(`existing:${code}`) ?? f300(`candidate:${code}`);
    const hubF = (hubsBySite.get(code) ?? []).map((h) => f300(`hub:${h}`)).filter((v): v is number => v != null && v > 0).sort((a, b) => b - a);
    if (ownF == null || !hubF.length) return null;
    return ownF / (mode === "max" ? hubF[0] : mean(hubF.slice(0, 3)));
  };
  const metrics: { key: string; label: string; of: (code: string) => number | null }[] = [
    { key: "huff", label: "허프 몫(추정)", of: (c) => huff.get(c) ?? null },
    { key: "pullMax", label: "쏠림 비 max(실측)", of: (c) => pull(c, "max") },
    { key: "pullTop3", label: "쏠림 비 top3(실측)", of: (c) => pull(c, "top3") },
  ];
  const center = new Map(metrics.map((m) => {
    const xs = own.map((r) => m.of(r.input.storeCode)).filter((v): v is number => v != null && v > 0);
    return [m.key, { mu: mean(xs.map(Math.log)), n: xs.length }];
  }));
  const withMul = <T extends { input: (typeof rows)[number]["input"] }>(list: T[], mKey: string, gamma: number): T[] => list.map((r) => {
    const m = metrics.find((x) => x.key === mKey)!;
    const x = m.of(r.input.storeCode);
    const mul = x != null && x > 0 ? Math.exp(gamma * (Math.log(x) - center.get(mKey)!.mu)) : 1;
    return { ...r, input: { ...r.input, demandMultiplier: mul } };
  });

  const scoreOf = (ownRows: typeof own, candR: typeof candRows, p: TextbookParams) => {
    const xs = ownRows.map((r) => ({ code: r.input.storeCode, e: (computeTextbook(r.input, p).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
    const okErr = (x: { code: string; e: number }) => (isUp(x.code) && x.e < 0 ? 0 : Math.abs(x.e));
    const cand = candR.map((r) => ({ name: r.input.storeName ?? r.input.storeCode, u: computeTextbook(r.input, p).utilization ?? NaN }));
    return { maeAll: mean(xs.map((x) => Math.abs(x.e))), maeOk: mean(xs.map(okErr)), w5: xs.filter((x) => okErr(x) <= 0.05).length,
      biasEx: mean(xs.filter((x) => !isUp(x.code)).map((x) => x.e)), over10: xs.filter((x) => Math.abs(x.e) >= 0.1).length, n: xs.length, cand };
  };
  const base = scoreOf(own, candRows, P);
  const floor = (() => { const a = own.map((r) => r.input.actualUtilization as number); const m = mean(a); return mean(a.map((v) => Math.abs(v - m))); })();

  it("(1) 지표 덮임 — 자사·후보지 중 몇 곳에 값이 있나", () => {
    for (const m of metrics) {
      const cOwn = own.filter((r) => m.of(r.input.storeCode) != null).length;
      const cCand = candRows.filter((r) => m.of(r.input.storeCode) != null).length;
      console.log(`  ${pad(m.label, 20)} 자사 ${cOwn}/${own.length} · 후보지 ${cCand}/${candRows.length} · 자사 기하평균 ${Math.exp(center.get(m.key)!.mu).toFixed(3)}`);
    }
    expect(own.length).toBeGreaterThan(30);
  });

  it("(2) 재고 표 — γ별 (음수 = 몫이 작을수록/쏠림이 약할수록 수요↑)", () => {
    console.log(`\n[자사 ${own.length}곳 · 후보지 ${candRows.length}곳] 바닥(전부 평균) ${(floor * 100).toFixed(2)}%p · 지금 전체 ${(base.maeAll * 100).toFixed(2)}`);
    console.log(`  ${pad("변형", 28)} ${"전체".padStart(6)} ${"이해".padStart(6)} ${"±5".padStart(5)} ${"편향".padStart(7)} ${"10↑".padStart(4)} ${"후보Δ평균".padStart(9)} ${"후보Δ최대".padStart(9)}`);
    const line = (label: string, s: ReturnType<typeof scoreOf>) => {
      const d = s.cand.map((c, i) => c.u - base.cand[i].u).filter(Number.isFinite);
      const maxAbs = d.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0);
      console.log(`  ${pad(label, 28)} ${(s.maeAll * 100).toFixed(2).padStart(6)} ${(s.maeOk * 100).toFixed(2).padStart(6)} ${`${s.w5}/${s.n}`.padStart(5)} ${pp(s.biasEx, 2).padStart(7)} ${String(s.over10).padStart(4)} ${(pp(mean(d)) + "p").padStart(9)} ${(pp(maxAbs) + "p").padStart(9)}`);
    };
    line("지금(배수 없음)", base);
    for (const m of metrics) for (const g of [-0.5, -0.25, 0.25, 0.5]) {
      const r2 = withMul(rows, m.key, g);
      const p2 = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(r2, DEFAULT_TEXTBOOK_PARAMS));
      const own2 = r2.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
      line(`${m.label} γ${g > 0 ? "+" : ""}${g}`, scoreOf(own2, withMul(candRows, m.key, g), p2));
    }
    console.log(`  ⭐ 읽는 법 — 2SE ≈ 0.7%p. 그 안의 개선은 판정 불가. 후보Δ평균이 크고 최대와 부호가 같으면 '한결같은 이동'(09-24 실패 모양).`);
    expect(base.n).toBeGreaterThan(30);
  });

  it("(3) 후보지별 지표와 γ−0.25 이동 (지표마다)", () => {
    for (const m of metrics) {
      const r2 = withMul(rows, m.key, -0.25);
      const p2 = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(r2, DEFAULT_TEXTBOOK_PARAMS));
      const c2 = scoreOf(r2.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0), withMul(candRows, m.key, -0.25), p2).cand;
      console.log(`\n  [${m.label}] 후보지: 지표값 · 지금 가동률 → γ−0.25`);
      candRows.forEach((r, i) => {
        const x = m.of(r.input.storeCode);
        console.log(`    ${pad(base.cand[i].name, 16)} ${x == null ? "   -  " : x.toFixed(3).padStart(6)}  ${(base.cand[i].u * 100).toFixed(1).padStart(5)}% → ${(c2[i].u * 100).toFixed(1).padStart(5)}%`);
      });
    }
    expect(candRows.length).toBeGreaterThan(5);
  });
});
