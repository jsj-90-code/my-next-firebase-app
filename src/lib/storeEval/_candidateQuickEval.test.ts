// 현재 신규후보지를 **주소만 초기평가 파이프라인 그대로** 돌린다 (2026-09-27, 사용자 "주소만 초기평가 산식으로 현재 신규후보지 예상매출 판단").
//   후보지에 저장된 좌표 → SGIS 500m·1km → 소상공인365 유동 → 카카오 PC방 500m → 수요거점 → AI 입지평가 초안
//   → buildQuickCandidate → V62(주소만 화면 설정) · 실험실 → quickEvalFinalEstimate(판정 값) → 기준 초과면 가능
// 계획값(대수·요금·층·지상/지하·엘리베이터)은 후보지에 입력된 값을 쓴다 — 주소만 화면에서도 사람이 넣는 칸이다.
// 비교: 정밀 평가에 저장된 V62(v62Final)·두 산식 주 값(dualEstimate.primaryValue).
// 수집 부분은 _badSiteProbe.test.ts와 같다(계획 층만 후보지 값).
// ⚠️ 1단계는 외부 API(유료 AI 포함)를 부르므로 .local-tools/candidate-quick-eval.json에 캐시한다(COLLECT=1이면 다시).
// 실행: npx vitest run src/lib/storeEval/_candidateQuickEval.test.ts --disable-console-intercept
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue;
  let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, eq).trim()] ??= v;
}

import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { searchByCategory, searchByKeyword } from "@/lib/kakao";
import { DEMAND_POINT_TARGETS } from "./demandPointTargets";
import { buildLocationEvalContext } from "./locationEvalContext";
import { runLocationEvalDraft } from "./locationEvalAi";
import { appendSiteFactsToContext } from "./quickEval/quickEvalLocationContext";
import { collectKakaoPcBangs, type KakaoPcBangPlace } from "./quickEval/kakaoPcBangs";
import { collectSgisRadiusPopulation } from "./quickEval/sgisRadiusPopulation";
import { collectSbizFloating, type SbizFloatingResult } from "./quickEval/sbizFloating";
import { judgePcBangName } from "./quickEval/pcBangNameFilter";
import { floatingPatchFromSbiz, SBIZ_FLOATING_RADII, type SbizFloatingRadius } from "./floatingPopulationFromSbiz";
import { buildQuickCandidate, buildQuickLocationEvaluation, blankCompetitorForTraining, type QuickEvalPlanInput } from "./quickEval/buildQuickCandidate";
import { QUICK_EVAL_ENTRY_THRESHOLD_WON, QUICK_EVAL_PLAN_DEFAULTS, withQuickEvalSettings } from "./quickEval/quickEvalDefaults";
import { quickEvalFinalEstimate } from "./quickEval/quickEvalVerdict";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "./dualEstimate";
import type { Competitor, DemandPoint, ExistingStore, LocationEvaluation } from "./types";

type Site = {
  code: string; label: string; address: string; at: { lat: number; lng: number };
  pc: number; rate: number; floor: number; groundLevel: QuickEvalPlanInput["groundLevel"]; hasElevator: boolean;
};

function loadSites(): Site[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return snap.candidates.filter((c: any) => c.lat && c.lng).map((c: any): Site => ({
    code: c.code, label: String(c.name).trim(), address: c.roadAddress ?? c.address, at: { lat: c.lat, lng: c.lng },
    pc: c.expectedPcCount ?? QUICK_EVAL_PLAN_DEFAULTS.expectedPcCount, rate: c.hourlyRate ?? QUICK_EVAL_PLAN_DEFAULTS.hourlyRate,
    floor: c.floor ?? QUICK_EVAL_PLAN_DEFAULTS.floor, groundLevel: c.groundLevel ?? QUICK_EVAL_PLAN_DEFAULTS.groundLevel, hasElevator: c.hasElevator ?? true,
  })).sort((a: Site, b: Site) => a.code.localeCompare(b.code));
}

const CACHE = ".local-tools/candidate-quick-eval.json";
type Collected = {
  label: string; address: string; error?: string;
  geocode?: { lat: number; lng: number; roadAddress: string | null; jibunAddress: string | null; buildingName: string | null };
  sgis?: Awaited<ReturnType<typeof collectSgisRadiusPopulation>> | null;
  floating?: Partial<Record<SbizFloatingRadius, SbizFloatingResult>>;
  pcBangs?: KakaoPcBangPlace[];
  locationDraft?: { fields: Record<string, number | string | null>; rationale?: string } | null;
  notes: string[];
};

async function collect(site: Site): Promise<Collected> {
  const out: Collected = { label: site.label, address: site.address, notes: [] };
  const g = { ...site.at, roadAddress: site.address, jibunAddress: null, buildingName: null };
  out.geocode = g;
  const origin = { lat: g.lat, lng: g.lng };
  try { out.sgis = await collectSgisRadiusPopulation(origin, [500, 1000]); } catch (e) { out.notes.push(`SGIS 실패 ${e}`); out.sgis = null; }
  out.floating = {};
  for (const r of SBIZ_FLOATING_RADII) { try { out.floating[r] = await collectSbizFloating(origin, r); } catch (e) { out.notes.push(`유동 ${r}m 실패 ${String(e).slice(0, 80)}`); } }
  try { out.pcBangs = (await collectKakaoPcBangs(origin, 500)).places; } catch (e) { out.notes.push(`카카오 실패 ${e}`); out.pcBangs = []; }
  const demandPoints: DemandPoint[] = [];
  const seen = new Set<string>();
  for (const t of DEMAND_POINT_TARGETS) {
    try {
      const places = t.kind === "category" ? await searchByCategory(g.lat, g.lng, t.code, t.radiusM) : await searchByKeyword(g.lat, g.lng, t.keyword, t.radiusM);
      for (const p of places) { if (seen.has(p.id)) continue; seen.add(p.id); demandPoints.push({ id: p.id, candidateCode: "PROBE", name: p.name, category: t.category, lat: p.lat, lng: p.lng, distanceM: p.distanceM ?? null, source: "kakao", createdAt: Date.now() } as unknown as DemandPoint); }
    } catch { /* 수요거점은 AI 컨텍스트용 — 없어도 된다 */ }
  }
  const counted = (out.pcBangs ?? []).filter((p) => judgePcBangName(p).counted).map((p) => ({ name: p.name, distanceM: p.distanceM }));
  const ctx = appendSiteFactsToContext(buildLocationEvalContext({
    candidate: { name: site.label, address: site.address, roadAddress: site.address, floating500Avg: out.floating[500]?.avg ?? null, employ500Total: null, employ1kmTotal: null, operatingPcStores500m: counted.length, operatingPcStores1km: null, facility500SubwayRiders: null },
    competitors: counted as never, demandPoints, adminDongReference: null,
  }), { floor: site.floor, groundLevel: site.groundLevel, hasElevator: site.hasElevator });
  try { out.locationDraft = await runLocationEvalDraft({ contextText: ctx }); } catch (e) { out.notes.push(`AI 초안 실패 ${String(e).slice(0, 80)}`); out.locationDraft = null; }
  return out;
}

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("현재 신규후보지 — 주소만 초기평가 판정", () => {
  it("1) 수집(캐시 있으면 건너뜀)", async () => {
    const sites = loadSites();
    const cache: Record<string, Collected> = existsSync(CACHE) && process.env.COLLECT !== "1" ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    for (const s of sites) {
      if (cache[s.code] && !cache[s.code].error) continue;
      cache[s.code] = await collect(s);
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`수집 ${s.code} ${s.label} ${cache[s.code].error ?? ""} ${cache[s.code].notes.join(" / ")}`);
    }
    expect(Object.keys(cache).length).toBeGreaterThanOrEqual(sites.length);
  }, 1_800_000);

  it("2) 판정 — 주소만(V62 화면 · 실험실 · 판정 값) vs 정밀 평가 저장값", () => {
    const sites = loadSites();
    const cache: Record<string, Collected> = JSON.parse(readFileSync(CACHE, "utf8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const settings = mergeModelSettings(snap.settings);
    const raw: ExistingStore[] = snap.existingStores;
    const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
    const locations: LocationEvaluation[] = snap.locationEvaluations;
    const wanted = new Set(evaluationSalesIds(raw));
    const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
    const prepared = prepareExistingStoresForEvaluation(raw, competitors, locations, settings);
    const range = v62TrainingRange(prepared);
    const T = QUICK_EVAL_ENTRY_THRESHOLD_WON;
    const man = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 10000).toLocaleString("ko-KR")}만`);
    const yes = (v: number | null | undefined) => (v == null ? "?" : v > T ? "가능" : "불가");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stored = new Map<string, any>(snap.results.map((r: any) => [r.candidateCode, r]));
    console.log(`\n[신규후보지 ${sites.length}곳 · 주소만 초기평가] 기준 ${man(T)} 초과면 가능 · 계획값은 후보지 입력값`);
    console.log("  코드 후보지         대수  요금 PC방 | 주소만V62  실험실   판정값        | 정밀V62  정밀주값      | 주소÷정밀");
    const out: Record<string, unknown>[] = [];
    for (const s of sites) {
      const c = cache[s.code];
      if (!c || c.error || !c.geocode) { console.log(`  ${s.code} ${s.label} — ${c?.error ?? "수집 없음"}`); continue; }
      const plan: QuickEvalPlanInput = { name: s.label, address: s.address, expectedPcCount: s.pc, hourlyRate: s.rate, floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator, ownFoodBrand: null, plannedOpenMonth: null };
      const built = buildQuickCandidate(plan, { geocode: c.geocode, sgis: c.sgis ?? null, floating: c.floating?.[500] ?? null, pcBangs: c.pcBangs ?? [], pcBangsPossiblyTruncated: false });
      const cand = { ...built.candidate, ...floatingPatchFromSbiz(c.floating ?? {}).patch };
      const loc = buildQuickLocationEvaluation(plan, c.locationDraft ?? null);
      const v = evaluateCandidate({
        candidate: cand, competitors: built.competitors, locationEvaluation: loc, settings: withQuickEvalSettings(settings),
        existingStores: raw, trainingLocationEvaluations: locations,
        trainingCompetitors: competitors.map(blankCompetitorForTraining), trainingSales: sales, trainingQscScores: snap.qscScores ?? [],
      });
      let lab: number | null = null;
      try { lab = labCandidateBreakdown({ candidate: cand, preparedStores: prepared, rawStores: raw, competitors: [...competitors, ...built.competitors], locations: loc ? [...locations, loc] : locations, sales, settings })?.monthlyRevenue ?? null; } catch { lab = null; }
      const flags = range ? rangeFlagsFor(v, range) : [];
      const fin = quickEvalFinalEstimate(v.v62Final, lab, flags);
      const st = stored.get(s.code);
      const precise: number | null = st?.v62Final ?? null;
      const precisePrimary: number | null = st?.dualEstimate?.primaryValue ?? precise;
      const ratio = fin.value != null && precisePrimary ? (fin.value / precisePrimary).toFixed(2) : "-";
      const far = flags.some((f) => f.far);
      console.log(`  ${s.code} ${s.label.padEnd(10)} ${String(s.pc).padStart(4)} ${String(s.rate).padStart(5)} ${String(built.competitors.length).padStart(4)} | ${man(v.v62Final).padStart(8)} ${man(lab).padStart(8)} ${man(fin.value).padStart(8)} ${yes(fin.value)}(${fin.source}) | ${man(precise).padStart(8)} ${man(precisePrimary).padStart(8)} ${yes(precisePrimary)} | ${ratio}${v.demandCapped ? " ·천장" : ""}${far ? " ·검증불가" : flags.length ? " ·범위밖" : ""}${fin.reason ? " · " + fin.reason : ""}`);
      out.push({ code: s.code, name: s.label, pc: s.pc, rate: s.rate, floor: s.floor, groundLevel: s.groundLevel, rivals: built.competitors.length, quickV62: v.v62Final, lab, final: fin.value, source: fin.source, reason: fin.reason, precise, precisePrimary, far, flagCount: flags.length, demandCapped: v.demandCapped, marketDemand: v.marketDemand, aiFields: c.locationDraft?.fields ?? null, aiRationale: c.locationDraft?.rationale ?? null });
    }
    writeFileSync(".local-tools/candidate-quick-eval-result.json", JSON.stringify(out, null, 1));
    expect(out.length).toBeGreaterThan(5);
  });
});
