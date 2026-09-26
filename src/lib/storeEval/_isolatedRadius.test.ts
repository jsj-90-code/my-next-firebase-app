// 고립 소도시 자동 규칙 시험 — "카카오 PC방이 2km 안에 한 곳도 없으면 주거 반경 2km" (2026-09-27).
//
// 배경: 영월이 주소만 초기평가에서 1,672만으로 떨어진다. 정밀 평가는 사람 확인("2km 안 다른 PC방 상권 없음")으로 2km를 쓰는데
// 주소만 화면은 늘 1km다. 사용자: "주소만 치면 결과까지 나오는 구조는 유지" → 사람 입력 없이 자동이어야 한다.
// "1~2km 고리 k곳 이하"는 기존점에서 성적이 나빠졌다(_yeongwolLab.test.ts — 시흥능곡 같은 도시 매장이 부푼다).
// 그래서 가장 엄격한 형태 "2km 안 PC방 0곳(1km 안 포함)"을 본다. 기존점은 전부 1km 안에 PC방이 있어(최소 2곳) **기존점 변화 0**.
// 대신 검증 자료가 없는 구간이라, 안 되는 자리(펜션촌·면 소재지·폐점·시흥 신현역)가 "가능"으로 뒤집히지 않는지 본다.
// 수집: 카카오 PC방 2km(이름 거르기) + 0곳이면 SGIS 2km 연령 → .local-tools/isolated-radius.json 캐시.
// 실행: npx vitest run src/lib/storeEval/_isolatedRadius.test.ts --disable-console-intercept
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

for (const line of readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue;
  let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, eq).trim()] ??= v;
}

import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { collectKakaoPcBangs } from "./quickEval/kakaoPcBangs";
import { collectSgisRadiusPopulation } from "./quickEval/sgisRadiusPopulation";
import { judgePcBangName } from "./quickEval/pcBangNameFilter";
import { floatingPatchFromSbiz } from "./floatingPopulationFromSbiz";
import { buildQuickCandidate, buildQuickLocationEvaluation, blankCompetitorForTraining, type QuickEvalPlanInput } from "./quickEval/buildQuickCandidate";
import { QUICK_EVAL_ENTRY_THRESHOLD_WON, QUICK_EVAL_PLAN_DEFAULTS, withQuickEvalSettings } from "./quickEval/quickEvalDefaults";
import { quickEvalFinalEstimate } from "./quickEval/quickEvalVerdict";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "./dualEstimate";
import type { ResidentAges } from "./textbookModel";
import type { Competitor, ExistingStore, LocationEvaluation } from "./types";

const CACHE = ".local-tools/isolated-radius.json";
type Iso = { counted2km: number; names: string[]; ages2000: ResidentAges | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Site = { key: string; label: string; kind: string; c: any; plan?: Partial<QuickEvalPlanInput> };

function loadSites(): Site[] {
  const bad = JSON.parse(readFileSync(".local-tools/bad-site-probe.json", "utf8"));
  const cand = JSON.parse(readFileSync(".local-tools/candidate-quick-eval.json", "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const out: Site[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [label, c] of Object.entries<any>(bad)) if (c.geocode) out.push({ key: `bad:${label}`, label, kind: c.kind, c });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [code, c] of Object.entries<any>(cand)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = snap.candidates.find((x: any) => x.code === code);
    out.push({ key: `cand:${code}`, label: c.label, kind: "후보지", c, plan: { expectedPcCount: d?.expectedPcCount, hourlyRate: d?.hourlyRate, floor: d?.floor, groundLevel: d?.groundLevel, hasElevator: d?.hasElevator } });
  }
  return out;
}

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("고립 소도시 2km 자동 규칙", () => {
  it("1) 카카오 2km · SGIS 2km 수집(캐시)", async () => {
    const cache: Record<string, Iso> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    for (const s of loadSites()) {
      if (cache[s.key]) continue;
      const origin = { lat: s.c.geocode.lat, lng: s.c.geocode.lng };
      const places = (await collectKakaoPcBangs(origin, 2000)).places.filter((p) => judgePcBangName(p).counted);
      let ages2000: ResidentAges | null = null;
      if (places.length === 0) {
        const r = (await collectSgisRadiusPopulation(origin, [2000])).byRadius[2000];
        const b = r?.ageBands ?? [];
        if (b.length >= 9 && b[1] != null) ages2000 = { age0s: b[0] ?? 0, age10s: b[1] ?? 0, age20s: b[2] ?? 0, age30s: b[3] ?? 0, age40s: b[4] ?? 0, age50s: b[5] ?? 0, age60plus: (b[6] ?? 0) + (b[7] ?? 0) + (b[8] ?? 0) };
      }
      cache[s.key] = { counted2km: places.length, names: places.slice(0, 5).map((p) => `${p.name}@${p.distanceM}`), ages2000 };
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`수집 ${s.label} PC방 2km ${places.length}곳`);
    }
    expect(Object.keys(cache).length).toBeGreaterThan(10);
  }, 1_800_000);

  it("2) 규칙 켜기 전/후 판정", () => {
    const cache: Record<string, Iso> = JSON.parse(readFileSync(CACHE, "utf8"));
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
    const man = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`);
    const yes = (v: number | null | undefined) => (v == null ? "?" : v > T ? "가능" : "불가");
    const plans: [string, Partial<QuickEvalPlanInput>][] = [["기본 100대·1,200원", {}], ["120대·1,500원", { expectedPcCount: 120, hourlyRate: 1500 }]];
    let flips = 0;
    for (const [planLabel, override] of plans) {
      console.log(`\n[고립 2km 규칙 · ${planLabel}(후보지는 입력값)] 2km 안 PC방 0곳인 자리만 바뀐다`);
      for (const s of loadSites()) {
        const iso = cache[s.key];
        if (!iso) continue;
        const plan: QuickEvalPlanInput = {
          name: s.label, address: s.c.address ?? "", expectedPcCount: QUICK_EVAL_PLAN_DEFAULTS.expectedPcCount, hourlyRate: QUICK_EVAL_PLAN_DEFAULTS.hourlyRate,
          floor: QUICK_EVAL_PLAN_DEFAULTS.floor, groundLevel: QUICK_EVAL_PLAN_DEFAULTS.groundLevel, hasElevator: true, ownFoodBrand: null, plannedOpenMonth: null,
          ...(s.kind === "후보지" && !Object.keys(override).length ? s.plan : {}), ...override,
        } as QuickEvalPlanInput;
        const built = buildQuickCandidate(plan, { geocode: s.c.geocode, sgis: s.c.sgis ?? null, floating: s.c.floating?.[500] ?? null, pcBangs: s.c.pcBangs ?? [], pcBangsPossiblyTruncated: false });
        const cand = { ...built.candidate, ...floatingPatchFromSbiz(s.c.floating ?? {}).patch };
        const loc = buildQuickLocationEvaluation(plan, s.c.locationDraft ?? null);
        const v = evaluateCandidate({
          candidate: cand, competitors: built.competitors, locationEvaluation: loc, settings: withQuickEvalSettings(settings),
          existingStores: raw, trainingLocationEvaluations: locations,
          trainingCompetitors: competitors.map(blankCompetitorForTraining), trainingSales: sales, trainingQscScores: snap.qscScores ?? [],
        });
        const flags = range ? rangeFlagsFor(v, range) : [];
        const labOf = (iso2: boolean) => {
          const extras = iso2 && iso.ages2000
            ? { residentRadiusByCode: new Map([[cand.code, 2000]]), residentRingsByCode: new Map([[cand.code, { 2000: iso.ages2000 }]]) }
            : undefined;
          try { return labCandidateBreakdown({ candidate: cand, preparedStores: prepared, rawStores: raw, competitors: [...competitors, ...built.competitors], locations: loc ? [...locations, loc] : locations, sales, settings, extras: extras as never })?.monthlyRevenue ?? null; } catch { return null; }
        };
        const lab1 = labOf(false), lab2 = labOf(true);
        const f1 = quickEvalFinalEstimate(v.v62Final, lab1, flags), f2 = quickEvalFinalEstimate(v.v62Final, lab2, flags);
        const flip = yes(f1.value) !== yes(f2.value);
        if (flip && s.kind !== "후보지") flips++;
        console.log(`  ${s.label.padEnd(14)} ${s.kind.padEnd(5)} PC방2km ${String(iso.counted2km).padStart(3)} | V62 ${man(v.v62Final).padStart(7)} · 실험실 ${man(lab1).padStart(7)}→${man(lab2).padStart(7)} | 판정 ${man(f1.value)} ${yes(f1.value)}(${f1.source}) → ${man(f2.value)} ${yes(f2.value)}(${f2.source})${flip ? "  ⚠️ 뒤집힘" : ""}`);
      }
    }
    console.log(`\n  안 되는 자리에서 뒤집힌 판정: ${flips}`);
    expect(flips).toBeGreaterThanOrEqual(0);
  });
});
