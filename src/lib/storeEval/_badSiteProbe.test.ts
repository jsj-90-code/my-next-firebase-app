// "안 되는 자리" 시험 세트 — 주소만 초기평가가 입점 불가를 제대로 내나 (2026-09-26 밤, 사용자 "너가 골라서 바로 시작해").
//
// 사용자 목적: 점포팀이 주소 하나로 **입점 가능/불가**를 바로 받는다(기준 QUICK_EVAL_ENTRY_THRESHOLD_WON 초과면 가능).
// 문제: V62 기반이라 펜션촌·깡시골에서도 3천~5천만이 뜬다. 기존점 40곳은 전부 살아남은 자리라 "안 되는 자리"를 못 잰다.
// 그래서 폐점 자리(양주 삼숭로) + 누가 봐도 안 되는 펜션촌·면 소재지를 **주소만 파이프라인 그대로** 돌린다:
//   카카오 좌표 → SGIS 500m·1km → 소상공인365 유동 100~1000m → 카카오 PC방 500m → 수요거점 → AI 입지평가 초안(유료 키)
//   → buildQuickCandidate → V62(주소만 화면 설정) · 실험실(labCandidateBreakdown) · 주 값 규칙(chooseEstimate)
// ⚠️ 1단계(수집)는 외부 API를 부르므로 결과를 .local-tools/bad-site-probe.json에 저장하고, 있으면 다시 안 부른다(COLLECT=1이면 다시).
// ⚠️ 이 자리들은 "망한 자리"가 아니라 "누가 봐도 안 되는 자리"(양주 삼숭로만 실제 폐점) — 증거 강도는 그만큼이다.
// 실행: npx vitest run src/lib/storeEval/_badSiteProbe.test.ts --disable-console-intercept
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 외부 API 키 — .env.local을 process.env에 싣는다(모듈들이 호출 시점에 읽는다).
for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue;
  let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, eq).trim()] ??= v;
}

import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
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
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { chooseEstimate, labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "./dualEstimate";
import type { Competitor, DemandPoint, ExistingStore, LocationEvaluation } from "./types";

const SITES: { label: string; address: string; kind: "폐점" | "펜션촌" | "시골" | "관광" | "사용자기억"; at?: { lat: number; lng: number } }[] = [
  { label: "양주 삼숭로(폐점)", address: "경기도 양주시 삼숭로38번길 5", kind: "폐점" },
  { label: "양평 서종 문호리", address: "경기 양평군 서종면 문호리", kind: "펜션촌" },
  { label: "가평 북면 목동리", address: "경기 가평군 북면 목동리", kind: "펜션촌" },
  { label: "평창 봉평 창동리", address: "강원 평창군 봉평면 창동리", kind: "펜션촌" },
  { label: "양양 현남 인구리", address: "강원 양양군 현남면 인구리", kind: "펜션촌" },
  { label: "태안 안면 승언리", address: "충남 태안군 안면읍 승언리", kind: "펜션촌" },
  { label: "남해 남면 당항리", address: "경남 남해군 남면 당항리", kind: "펜션촌" },
  { label: "무주 설천 소천리", address: "전북 무주군 설천면 소천리", kind: "관광" },
  { label: "정선 사북 사북리", address: "강원 정선군 사북읍 사북리", kind: "관광" },
  { label: "인제 기린 현리", address: "강원 인제군 기린면 현리", kind: "시골" },
  { label: "봉화 춘양 의양리", address: "경북 봉화군 춘양면 의양리", kind: "시골" },
  { label: "괴산 청천 청천리", address: "충북 괴산군 청천면 청천리", kind: "시골" },
  { label: "신안 증도 대초리", address: "전남 신안군 증도면 대초리", kind: "시골" },
  { label: "포천 이동 장암리", address: "경기 포천시 이동면 장암리", kind: "시골" },
  { label: "홍천 서면 팔봉리", address: "강원 홍천군 서면 팔봉리", kind: "펜션촌" },
  { label: "고성 토성 봉포리", address: "강원 고성군 토성면 봉포리", kind: "펜션촌" },
  // 사용자 기억(09-27): "시흥 신현역 근처였나 3천~5천 떴다" — 주소 검색이 안 돼 카카오 장소(신현역 서해선) 좌표로 넣는다.
  { label: "시흥 신현역", address: "경기 시흥시 신현역(서해선)", kind: "사용자기억", at: { lat: 37.40956486776796, lng: 126.787838368873 } },
];
const CACHE = ".local-tools/bad-site-probe.json";
type Collected = {
  label: string; address: string; kind: string; error?: string;
  geocode?: { lat: number; lng: number; roadAddress: string | null; jibunAddress: string | null; buildingName: string | null };
  sgis?: Awaited<ReturnType<typeof collectSgisRadiusPopulation>> | null;
  floating?: Partial<Record<SbizFloatingRadius, SbizFloatingResult>>;
  pcBangs?: KakaoPcBangPlace[];
  locationDraft?: { fields: Record<string, number | string | null>; rationale?: string } | null;
  notes: string[];
};

async function collect(site: (typeof SITES)[number]): Promise<Collected> {
  const out: Collected = { ...site, notes: [] };
  const g = site.at ? { ...site.at, roadAddress: null, jibunAddress: null, buildingName: null } : await geocodeAddress(site.address);
  if (!g) return { ...out, error: "지오코딩 실패" };
  out.geocode = { lat: g.lat, lng: g.lng, roadAddress: g.roadAddress ?? null, jibunAddress: g.jibunAddress ?? null, buildingName: g.buildingName ?? null };
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
    candidate: { name: site.label, address: site.address, roadAddress: g.roadAddress ?? null, floating500Avg: out.floating[500]?.avg ?? null, employ500Total: null, employ1kmTotal: null, operatingPcStores500m: counted.length, operatingPcStores1km: null, facility500SubwayRiders: null },
    competitors: counted as never, demandPoints, adminDongReference: null,
  }), { floor: QUICK_EVAL_PLAN_DEFAULTS.floor, groundLevel: QUICK_EVAL_PLAN_DEFAULTS.groundLevel, hasElevator: true });
  try { out.locationDraft = await runLocationEvalDraft({ contextText: ctx }); } catch (e) { out.notes.push(`AI 초안 실패 ${String(e).slice(0, 80)}`); out.locationDraft = null; }
  return out;
}

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("안 되는 자리 시험 세트 — 주소만 입점 판정", () => {
  it("1) 수집(캐시 있으면 건너뜀)", async () => {
    const cache: Record<string, Collected> = existsSync(CACHE) && process.env.COLLECT !== "1" ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    for (const s of SITES) {
      if (cache[s.label] && !cache[s.label].error) continue;
      cache[s.label] = await collect(s);
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`수집 ${s.label} ${cache[s.label].error ?? ""} ${cache[s.label].notes.join(" / ")}`);
    }
    expect(Object.keys(cache).length).toBe(SITES.length);
  }, 1_800_000);

  it("2) 판정 — V62(주소만 화면) · 실험실 · 주 값 규칙", () => {
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
    console.log(`\n[안 되는 자리 ${SITES.length}곳] 기준 ${man(T)} 초과면 가능 · ${process.env.PLAN_PC ?? QUICK_EVAL_PLAN_DEFAULTS.expectedPcCount}대·${process.env.PLAN_RATE ?? QUICK_EVAL_PLAN_DEFAULTS.hourlyRate}원·2층`);
    console.log("  자리                  종류   상권수요 주거1km 유동400 PC방 | V62(화면)      실험실          규칙 주 값");
    let v62Yes = 0, ruleYes = 0, n = 0;
    for (const s of SITES) {
      const c = cache[s.label];
      if (!c || c.error || !c.geocode) { console.log(`  ${s.label} — ${c?.error ?? "수집 없음"}`); continue; }
      const plan: QuickEvalPlanInput = { name: s.label, address: s.address, expectedPcCount: Number(process.env.PLAN_PC ?? QUICK_EVAL_PLAN_DEFAULTS.expectedPcCount), hourlyRate: Number(process.env.PLAN_RATE ?? QUICK_EVAL_PLAN_DEFAULTS.hourlyRate), floor: QUICK_EVAL_PLAN_DEFAULTS.floor, groundLevel: QUICK_EVAL_PLAN_DEFAULTS.groundLevel, hasElevator: true, ownFoodBrand: null, plannedOpenMonth: null };
      const built = buildQuickCandidate(plan, { geocode: c.geocode, sgis: c.sgis ?? null, floating: c.floating?.[500] ?? null, pcBangs: c.pcBangs ?? [], pcBangsPossiblyTruncated: false });
      // 자동수집 확장 뒤 상태 — 유동 100~1000m를 실험실 입력으로(기본정보 탭 버튼과 같은 필드 대응)
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
      const d = chooseEstimate(v.v62Final, lab, flags, v.competitorIpRaw ?? v.competitorIp ?? null, range?.sampleCount ?? null);
      n++; if (v.v62Final != null && v.v62Final > T) v62Yes++; if (d.primaryValue != null && d.primaryValue > T) ruleYes++;
      console.log(`  ${s.label.padEnd(14)} ${s.kind.padEnd(4)} ${String(Math.round(v.marketDemand ?? 0)).padStart(7)} ${String(cand.pop1km ?? "-").padStart(7)} ${String(Math.round((cand as { floating400Avg?: number }).floating400Avg ?? 0)).padStart(7)} ${String(built.competitors.length).padStart(4)} | ${man(v.v62Final).padStart(7)} ${yes(v.v62Final)}   ${man(lab).padStart(7)} ${yes(lab)}   ${man(d.primaryValue).padStart(7)} ${yes(d.primaryValue)}(${d.primary}${flags.some((f) => f.far) ? "·검증불가" : flags.length ? "·범위밖" : ""})${v.demandCapped ? " ·천장" : ""}`);
    }
    console.log(`  → "가능"으로 잘못 낸 곳: V62(화면) ${v62Yes}/${n} · 규칙 주 값 ${ruleYes}/${n}`);
    expect(n).toBeGreaterThan(5);
  });
});
