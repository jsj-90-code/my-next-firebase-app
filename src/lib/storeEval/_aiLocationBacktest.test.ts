// 기존점 40곳 AI 입지평가 되짚기 (2026-09-27, 사용자 "작업진행해").
//
// 왜: 주소만 초기평가 성적(40곳 중 30곳 판정 맞음)은 입지평가를 **사람 값**으로 넣고 쟀다. 그런데 신규후보지 13곳을 보니
// AI 초안은 외부유입제한을 전부 "없음", 선점을 대체로 1점 높게 매긴다(_candidateQuickEval.test.ts (3)). 그 13곳은 사람 값이
// AI 초안에서 출발한 경우가 많아 비교가 오염돼 있다 — 기존점 40곳(사람이 따로 매긴 입지평가)으로 다시 잰다.
// (09-23에 같은 일을 한 _quickEvalBias/_quickEvalAiBacktest는 커밋되지 않아 사라졌다 — 이 파일은 git에 강제로 올린다.)
//
// 1) AI 초안 받기 — 주소만 화면(quick-eval/collect/route.ts)과 같은 컨텍스트: 카카오 PC방 500m(자기 매장 제외, 이름 거르기)
//    · 수요거점(카카오) · 유동 500m(그 매장 문서 값) · 층·지상/지하·엘리베이터 사실. 유료 AI 호출 → .local-tools/ai-location-backtest.json 캐시.
// 2) 칸별로 AI vs 사람 비교 · 3) 주소만 판정(V62 화면 + 실험실 가드)을 AI 값 / 사람 값으로 각각 LOO 채점.
// 실행: npx vitest run src/lib/storeEval/_aiLocationBacktest.test.ts --disable-console-intercept   (COLLECT=1이면 AI 다시)
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
import { judgePcBangName } from "./quickEval/pcBangNameFilter";
import type { KakaoPcBangPlace } from "./quickEval/kakaoPcBangs";
import { buildQuickCandidate, buildQuickLocationEvaluation, blankCompetitorForTraining, type QuickEvalPlanInput } from "./quickEval/buildQuickCandidate";
import { QUICK_EVAL_ENTRY_THRESHOLD_WON, withQuickEvalSettings } from "./quickEval/quickEvalDefaults";
import { quickEvalFinalEstimate } from "./quickEval/quickEvalVerdict";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "./dualEstimate";
import type { Competitor, DemandPoint, ExistingStore, LocationEvaluation } from "./types";

const CACHE = ".local-tools/ai-location-backtest.json";
type Draft = { fields: Record<string, number | string | null>; rationale?: string } | null;
const FIELDS = ["locationScore", "preemptionScore", "visibilityScore", "specialDemandType", "specialDemandIntensity", "inflowRestriction"] as const;

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("기존점 AI 입지평가 되짚기", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const raw: ExistingStore[] = snap.existingStores;
  const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const locations: LocationEvaluation[] = snap.locationEvaluations;
  const wanted = new Set(evaluationSalesIds(raw));
  const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const qscScores = snap.qscScores ?? [];
  const kakao = JSON.parse(readFileSync(".local-tools/kakao-neighborhood.json", "utf8")).sites as Record<string, { pcRooms: { docs: { name: string; category?: string; lat: number; lng: number; distanceM: number; address?: string; id?: string }[] } }>;
  const prepared = prepareExistingStoresForEvaluation(raw, competitors, locations, settings);
  const core = raw.filter((s) => s.brandType === "블랙라벨" && !s.excludedFromModel && (s.actualMonthlyRevenueAvg ?? 0) > 0 && s.lat != null && s.lng != null);
  const humanLoc = (s: ExistingStore) => locations.find((l) => l.candidateCode === (s as unknown as { sourceCode?: string }).sourceCode || l.candidateCode === s.storeCode) ?? null;

  // _addressOnlyDual.test.ts buildFor와 같다(주소만 조건 재현).
  const pcBangsFor = (s: ExistingStore): KakaoPcBangPlace[] => (kakao[`existing:${s.storeCode}`]?.pcRooms?.docs ?? [])
    .filter((d) => d.distanceM <= 500 && !(d.distanceM < 30 && /블랙라벨/.test(d.name)))
    .map((d, i) => ({ id: d.id ?? `${s.storeCode}_${i}`, name: d.name, categoryName: d.category ?? null, address: d.address ?? null, lat: d.lat, lng: d.lng, distanceM: d.distanceM }));
  const planFor = (s: ExistingStore): QuickEvalPlanInput => ({
    name: s.storeName, address: s.address ?? "", expectedPcCount: s.evaluationPcCount ?? s.pcCount, hourlyRate: s.hourlyRate,
    floor: s.floor ?? null, groundLevel: s.groundLevel ?? null, hasElevator: s.hasElevator ?? null, ownFoodBrand: null, plannedOpenMonth: null,
  });
  const buildFor = (s: ExistingStore) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = s as any;
    const ages = [r.age1km_0_9, r.age1km_10_19, r.age1km_20_29, r.age1km_30_39, r.age1km_40_49, r.age1km_50_59, r.age1km_60_69, r.age1km_70_79, r.age1km_80plus];
    const built = buildQuickCandidate(planFor(s), {
      geocode: { lat: s.lat as number, lng: s.lng as number, roadAddress: null, jibunAddress: null, buildingName: null },
      sgis: { baseYear: "2024", byRadius: {
        500: { radiusM: 500, totalPopulation: r.pop500m ?? null, malePopulation: null, femalePopulation: null, ageBands: [], areaSizeM2: null, areaOffRatio: 0 },
        1000: { radiusM: 1000, totalPopulation: r.pop1km ?? null, malePopulation: r.pop1km && r.male1kmRatio != null ? Math.round(r.pop1km * r.male1kmRatio) : null, femalePopulation: null, ageBands: ages, areaSizeM2: r.area1kmKm2 ? r.area1kmKm2 * 1e6 : null, areaOffRatio: 0 },
      } },
      floating: r.floating500Avg ? { radiusM: 500, avg: r.floating500Avg, months: [], monthly: [], scale: 1, admiCd: "", admiNm: "",
        scaled: { total: r.floating500Avg, male: r.floating500Male ?? 0, female: 0, age10s: r.floating500_10s ?? 0, age20s: r.floating500_20s ?? 0, age30s: r.floating500_30s ?? 0, age40s: r.floating500_40s ?? 0, age50s: r.floating500_50s ?? 0, age60plus: r.floating500_60plus ?? 0 } } : null,
      pcBangs: pcBangsFor(s), pcBangsPossiblyTruncated: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cand = { ...built.candidate } as any;
    for (const rad of [100, 200, 300, 400]) for (const k of ["Avg", "Male", "_10s", "_20s", "_30s", "_40s", "_50s", "_60plus"]) cand[`floating${rad}${k}`] = r[`floating${rad}${k}`] ?? null;
    cand.floating1000Avg = r.floating1000Avg ?? null;
    return { candidate: cand, competitors: built.competitors };
  };

  it("1) AI 초안 받기(캐시 있으면 건너뜀)", async () => {
    const cache: Record<string, Draft> = existsSync(CACHE) && process.env.COLLECT !== "1" ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    for (const s of core) {
      if (cache[s.storeCode]) continue;
      const origin = { lat: s.lat as number, lng: s.lng as number };
      const demandPoints: DemandPoint[] = [];
      const seen = new Set<string>();
      for (const t of DEMAND_POINT_TARGETS) {
        try {
          const places = t.kind === "category" ? await searchByCategory(origin.lat, origin.lng, t.code, t.radiusM) : await searchByKeyword(origin.lat, origin.lng, t.keyword, t.radiusM);
          for (const p of places) { if (seen.has(p.id)) continue; seen.add(p.id); demandPoints.push({ id: p.id, candidateCode: "QUICK", name: p.name, category: t.category, lat: p.lat, lng: p.lng, distanceM: p.distanceM ?? null, source: "kakao", createdAt: Date.now() } as unknown as DemandPoint); }
        } catch { /* AI 컨텍스트용 — 없어도 된다 */ }
      }
      const counted = pcBangsFor(s).filter((p) => judgePcBangName(p).counted).map((p) => ({ name: p.name, distanceM: p.distanceM }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = s as any;
      const ctx = appendSiteFactsToContext(buildLocationEvalContext({
        candidate: { name: s.address ?? s.storeName, address: s.address ?? "", roadAddress: s.address ?? null, floating500Avg: r.floating500Avg ?? null, employ500Total: null, employ1kmTotal: null, operatingPcStores500m: counted.length, operatingPcStores1km: null, facility500SubwayRiders: null },
        competitors: counted as never, demandPoints, adminDongReference: null,
      }), { floor: s.floor ?? null, groundLevel: s.groundLevel ?? null, hasElevator: s.hasElevator ?? null });
      try { cache[s.storeCode] = await runLocationEvalDraft({ contextText: ctx }); } catch (e) { console.log(`AI 실패 ${s.storeName} ${String(e).slice(0, 100)}`); continue; }
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`AI ${s.storeName} ok`);
    }
    expect(Object.keys(cache).length).toBeGreaterThan(30);
  }, 3_600_000);

  it("2) 칸별 AI vs 사람 · 3) 판정 정답률(AI 값 / 사람 값)", () => {
    const cache: Record<string, Draft> = JSON.parse(readFileSync(CACHE, "utf8"));
    // 칸별 비교
    console.log(`\n[칸별 AI vs 사람 · 기존점 ${core.length}곳]`);
    for (const f of FIELDS) {
      const pairs: [unknown, unknown][] = [];
      for (const s of core) { const a = cache[s.storeCode]?.fields?.[f]; const h = (humanLoc(s) as unknown as Record<string, unknown> | null)?.[f]; if (a != null && h != null) pairs.push([a, h]); }
      const same = pairs.filter(([a, h]) => a === h).length;
      const numeric = pairs.every(([a, h]) => typeof a === "number" && typeof h === "number");
      const tally: Record<string, number> = {};
      for (const [a, h] of pairs) { const k = `${a}/${h}`; tally[k] = (tally[k] ?? 0) + 1; }
      const extra = numeric ? ` · 평균 차(AI−사람) ${(pairs.reduce((p, [a, h]) => p + (a as number) - (h as number), 0) / pairs.length).toFixed(2)}` : "";
      console.log(`  ${f.padEnd(22)} 일치 ${same}/${pairs.length}${extra} · AI/사람 ${Object.entries(tally).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}:${n}`).join(" ")}`);
    }

    const T = QUICK_EVAL_ENTRY_THRESHOLD_WON;
    // 2026-09-27 — 칸 조합: AI 초안에서 괄호 안 칸만 사람 값으로 바꾼다.
    const COMBOS: Record<string, readonly (typeof FIELDS)[number][]> = {
      "AI": [], "사람": FIELDS, "AI+사람유입": ["inflowRestriction"], "AI+사람선점": ["preemptionScore"],
      "AI+사람위치": ["locationScore"], "AI+사람가시성": ["visibilityScore"], "AI+사람위치·가시성": ["locationScore", "visibilityScore"],
      "AI+사람위치·가시성·유입": ["locationScore", "visibilityScore", "inflowRestriction"],
      "AI+사람특수수요": ["specialDemandType", "specialDemandIntensity"],
      "AI+위치·가시성 +1점": [],
      // 2026-09-27 — 학습도 제미나이 기준으로(사용자: "주소만은 제미나이 평가가 자동으로 들어가니 그걸로 판단").
      "AI입력·AI학습(6칸)": [], "AI입력·AI학습(점수 3칸)": [],
      // 2026-09-27 — 오송(AI "산업단지" → 배후수요 더미 켜짐)에서 나온 일반 규칙 후보. AI 특수수요를 안 쓰면?
      "AI 특수수요 끔(없음)": [], "AI 산업단지·군부대→기타(더미만 끔)": [],
    };
    type Mode = string;
    const modes: Mode[] = Object.keys(COMBOS);
    const res: Record<Mode, { act: number; v: number | null; name: string }[]> = Object.fromEntries(modes.map((m) => [m, []]));
    // 기존점 입지평가를 제미나이 초안으로 바꾼 학습 자료(칸 목록만큼). 초안이 없는 매장은 원래 값.
    const AI_TRAIN_FIELDS: Record<string, readonly (typeof FIELDS)[number][]> = {
      "AI입력·AI학습(6칸)": FIELDS, "AI입력·AI학습(점수 3칸)": ["locationScore", "preemptionScore", "visibilityScore"],
    };
    const aiTrainLocations = (fields: readonly (typeof FIELDS)[number][]) => locations.map((l) => {
      const st = core.find((x) => (x as unknown as { sourceCode?: string }).sourceCode === l.candidateCode || x.storeCode === l.candidateCode);
      const f = st ? cache[st.storeCode]?.fields : null;
      if (!f) return l;
      const q = buildQuickLocationEvaluation(planFor(st!), { fields: f })!;
      return { ...l, ...Object.fromEntries(fields.map((k) => [k, (q as unknown as Record<string, unknown>)[k]])) } as LocationEvaluation;
    });
    const trainByMode: Record<string, LocationEvaluation[]> = Object.fromEntries(Object.entries(AI_TRAIN_FIELDS).map(([m, fs2]) => [m, aiTrainLocations(fs2)]));
    for (const s of core) {
      const { candidate, competitors: comps } = buildFor(s);
      const others = raw.filter((x) => x.storeCode !== s.storeCode);
      const salesO = sales.filter((x: { storeCode: string }) => x.storeCode !== s.storeCode);
      const preparedO = prepared.filter((x) => x.storeCode !== s.storeCode);
      const range = v62TrainingRange(preparedO);
      const ai = cache[s.storeCode]?.fields ?? null;
      const hl = humanLoc(s) as unknown as Record<string, number | string | null> | null;
      for (const m of modes) {
        let loc: LocationEvaluation | null;
        if (m === "사람") loc = hl ? ({ ...(hl as object), candidateCode: candidate.code } as LocationEvaluation) : null;
        else if (!ai) loc = null;
        else if (AI_TRAIN_FIELDS[m]) loc = buildQuickLocationEvaluation(planFor(s), { fields: ai });
        else if (m === "AI 특수수요 끔(없음)") loc = buildQuickLocationEvaluation(planFor(s), { fields: { ...ai, specialDemandType: "없음", specialDemandIntensity: "없음" } });
        else if (m === "AI 산업단지·군부대→기타(더미만 끔)") loc = buildQuickLocationEvaluation(planFor(s), { fields: { ...ai, specialDemandType: ai.specialDemandType === "산업단지" || ai.specialDemandType === "군부대" ? "기타" : ai.specialDemandType } });
        else if (m === "AI+위치·가시성 +1점") {
          const bump = (v: number | string | null) => (typeof v === "number" ? Math.min(5, v + 1) : v);
          loc = buildQuickLocationEvaluation(planFor(s), { fields: { ...ai, locationScore: bump(ai.locationScore), visibilityScore: bump(ai.visibilityScore) } });
        } else loc = buildQuickLocationEvaluation(planFor(s), { fields: { ...ai, ...Object.fromEntries(COMBOS[m].map((f) => [f, hl?.[f] ?? ai[f]])) } });
        const screen = evaluateCandidate({
          candidate, competitors: comps, locationEvaluation: loc, settings: withQuickEvalSettings(settings),
          existingStores: others, trainingLocationEvaluations: trainByMode[m] ?? locations,
          trainingCompetitors: competitors.map(blankCompetitorForTraining), trainingSales: salesO, trainingQscScores: qscScores,
        });
        let lab: number | null = null;
        try { lab = labCandidateBreakdown({ candidate, preparedStores: preparedO, rawStores: others, competitors: [...competitors, ...comps], locations: loc ? [...locations, loc] : locations, sales: salesO, settings })?.monthlyRevenue ?? null; } catch { lab = null; }
        const fin = quickEvalFinalEstimate(screen.v62Final, lab, range ? rangeFlagsFor(screen, range) : []);
        res[m].push({ act: s.actualMonthlyRevenueAvg as number, v: fin.value, name: s.storeName });
      }
    }
    console.log(`\n[주소만 판정 · 기존점 LOO] 정답 = 실매출 ${Math.round(T / 1e4)}만 초과면 가능`);
    for (const m of modes) {
      const rows = res[m].filter((r) => r.v != null);
      let tp = 0, fn = 0, fp = 0, tn = 0;
      for (const r of rows) { const y = (r.v as number) > T; const t = r.act > T; if (t && y) tp++; else if (t) fn++; else if (y) fp++; else tn++; }
      const e = rows.map((r) => (r.v as number) / r.act - 1);
      const mape = e.reduce((p, q) => p + Math.abs(q), 0) / e.length;
      const bias = e.reduce((p, q) => p + q, 0) / e.length;
      console.log(`  입지 ${m.padEnd(18)} n=${rows.length} · 판정 맞음 ${tp + tn}/${rows.length} · 된 자리를 불가로 ${fn} · 안 된 자리를 가능으로 ${fp} · MAPE ${(mape * 100).toFixed(1)}% · 편향 ${(bias * 100).toFixed(1)}% · ±20% ${e.filter((v) => Math.abs(v) <= 0.2).length}`);
    }
    writeFileSync(".local-tools/ai-location-backtest-result.json", JSON.stringify(res, null, 1));
    expect(res.AI.length).toBeGreaterThan(30);
  });
});
