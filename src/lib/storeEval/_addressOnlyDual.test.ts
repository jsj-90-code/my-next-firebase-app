// 3단계 — 주소만 초기평가에 두 산식을 넣기 전에 재는 되짚기 (2026-09-26 밤). 읽기전용·측정만.
//
// 기존점 하나를 "주소만 넣었다면"으로 재현해(주소만 화면과 **같은 함수** buildQuickCandidate → evaluateCandidate),
// 그 매장을 학습에서 빼고 맞힌다. 경쟁점은 **카카오 500m**(kakao-neighborhood.json, 주소만 화면과 같은 이름 거르기)이고
// 대수·품질은 주소만 화면 기본값(RIVAL_PC_COUNT_WHEN_UNSURVEYED · RIVAL_TYPICAL_WHEN_UNSURVEYED)이다 — 09-23 교훈
// ("조사된 경쟁점으로 도는 되짚기는 카카오 구간을 대표 못 한다")을 따른다.
// 자사 기획값(PC수·요금·층·엘리베이터)은 그 매장 값, 인구·유동은 그 매장 문서(SGIS·소상공인365 같은 경로로 넣은 값).
//
// 방식:
//   V62(화면)  = 지금 주소만 화면: 상권수요 천장 · 송도·동탄 학습 포함 · 학습 경쟁점 비움 · QSC 최저 채움
//   V62(운영)  = 후보지 화면과 같은 설정·학습(화면 전용 변형 없음). 입력만 주소만.
//   실험실     = labCandidateBreakdown(후보지 화면과 같은 조립). 유동 100~1000m는 그 매장 값(=자동수집 확장 뒤 상태)
//   규칙       = chooseEstimate(V62(운영), 실험실) — 후보지 화면과 같은 주 값 규칙
// 입지평가: AI 초안은 되짚기에서 못 돌리므로 두 경우 — 없음(null) / 사람 입지평가(=AI가 사람만큼 맞힌다는 상한).
// 실행: npx vitest run src/lib/storeEval/_addressOnlyDual.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { chooseEstimate, labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "./dualEstimate";
import { buildQuickCandidate, blankCompetitorForTraining, type QuickEvalPlanInput } from "./quickEval/buildQuickCandidate";
import { withQuickEvalSettings } from "./quickEval/quickEvalDefaults";
import type { KakaoPcBangPlace } from "./quickEval/kakaoPcBangs";
import type { Competitor, ExistingStore, LocationEvaluation } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const summary = (e: number[]) => `n=${e.length} · MAPE ${(mean(e.map(Math.abs)) * 100).toFixed(1)}% · 중앙 ${(median(e.map(Math.abs)) * 100).toFixed(1)}% · 편향 ${(mean(e) * 100 >= 0 ? "+" : "")}${(mean(e) * 100).toFixed(1)}% · ±20% ${e.filter((v) => Math.abs(v) <= 0.2).length} · 최악 ${(Math.max(...e.map(Math.abs)) * 100).toFixed(0)}%`;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("주소만 조건 되짚기 — V62(화면) · V62(운영) · 실험실 · 규칙", () => {
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

  const buildFor = (s: ExistingStore) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = s as any;
    const docs = kakao[`existing:${s.storeCode}`]?.pcRooms?.docs ?? [];
    // 자기 매장은 뺀다(거리 30m 안의 블랙라벨) — 주소만 화면에서는 아직 없는 가게다.
    const pcBangs: KakaoPcBangPlace[] = docs
      .filter((d) => d.distanceM <= 500 && !(d.distanceM < 30 && /블랙라벨/.test(d.name)))
      .map((d, i) => ({ id: d.id ?? `${s.storeCode}_${i}`, name: d.name, categoryName: d.category ?? null, address: d.address ?? null, lat: d.lat, lng: d.lng, distanceM: d.distanceM }));
    const ages = [r.age1km_0_9, r.age1km_10_19, r.age1km_20_29, r.age1km_30_39, r.age1km_40_49, r.age1km_50_59, r.age1km_60_69, r.age1km_70_79, r.age1km_80plus];
    const plan: QuickEvalPlanInput = {
      name: s.storeName, address: s.address ?? "", expectedPcCount: s.evaluationPcCount ?? s.pcCount, hourlyRate: s.hourlyRate,
      floor: s.floor ?? null, groundLevel: s.groundLevel ?? null, hasElevator: s.hasElevator ?? null, ownFoodBrand: null, plannedOpenMonth: null,
    };
    const built = buildQuickCandidate(plan, {
      geocode: { lat: s.lat as number, lng: s.lng as number, roadAddress: null, jibunAddress: null, buildingName: null },
      sgis: { baseYear: "2024", byRadius: {
        500: { radiusM: 500, totalPopulation: r.pop500m ?? null, malePopulation: null, femalePopulation: null, ageBands: [], areaSizeM2: null, areaOffRatio: 0 },
        1000: { radiusM: 1000, totalPopulation: r.pop1km ?? null, malePopulation: r.pop1km && r.male1kmRatio != null ? Math.round(r.pop1km * r.male1kmRatio) : null, femalePopulation: null, ageBands: ages, areaSizeM2: r.area1kmKm2 ? r.area1kmKm2 * 1e6 : null, areaOffRatio: 0 },
      } },
      floating: r.floating500Avg ? { radiusM: 500, avg: r.floating500Avg, months: [], monthly: [], scale: 1, admiCd: "", admiNm: "",
        scaled: { total: r.floating500Avg, male: r.floating500Male ?? 0, female: 0, age10s: r.floating500_10s ?? 0, age20s: r.floating500_20s ?? 0, age30s: r.floating500_30s ?? 0, age40s: r.floating500_40s ?? 0, age50s: r.floating500_50s ?? 0, age60plus: r.floating500_60plus ?? 0 } } : null,
      pcBangs, pcBangsPossiblyTruncated: false,
    });
    // 자동수집 확장 뒤 상태 — 유동 100~1000m(실험실 입력)를 그 매장 값으로 싣는다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cand = { ...built.candidate } as any;
    for (const rad of [100, 200, 300, 400]) for (const k of ["Avg", "Male", "_10s", "_20s", "_30s", "_40s", "_50s", "_60plus"]) cand[`floating${rad}${k}`] = r[`floating${rad}${k}`] ?? null;
    cand.floating1000Avg = r.floating1000Avg ?? null;
    return { candidate: cand, competitors: built.competitors, kakaoCount: built.competitors.length };
  };

  type Row = { name: string; act: number; vScreen: number | null; vProd: number | null; lab: number | null; pick: number | null; primary: string; far: boolean; kakao: number; pickS: number | null; primaryS: string; farS: boolean };
  const runAll = (withLoc: boolean): Row[] => {
    const out: Row[] = [];
    for (const s of core) {
      const { candidate, competitors: comps, kakaoCount } = buildFor(s);
      const others = raw.filter((x) => x.storeCode !== s.storeCode);
      const loc = withLoc ? (locations.find((l) => l.candidateCode === (s as unknown as { sourceCode?: string }).sourceCode || l.candidateCode === s.storeCode) ?? null) : null;
      const locQ = loc ? { ...loc, candidateCode: candidate.code } : null;
      const salesO = sales.filter((x: { storeCode: string }) => x.storeCode !== s.storeCode);
      const screen = evaluateCandidate({
        candidate, competitors: comps, locationEvaluation: locQ, settings: withQuickEvalSettings(settings),
        existingStores: others, trainingLocationEvaluations: locations,
        trainingCompetitors: competitors.map(blankCompetitorForTraining), trainingSales: salesO, trainingQscScores: qscScores,
      });
      const prod = evaluateCandidate({
        candidate, competitors: comps, locationEvaluation: locQ, settings,
        existingStores: others, trainingLocationEvaluations: locations, trainingCompetitors: competitors, trainingSales: salesO, trainingQscScores: qscScores,
      });
      const preparedO = prepared.filter((x) => x.storeCode !== s.storeCode);
      let lab: number | null = null;
      try {
        lab = labCandidateBreakdown({ candidate, preparedStores: preparedO, rawStores: others, competitors: [...competitors, ...comps], locations: locQ ? [...locations, locQ] : locations, sales: salesO, settings })?.monthlyRevenue ?? null;
      } catch { lab = null; }
      const range = v62TrainingRange(preparedO);
      const flags = range ? rangeFlagsFor(prod, range) : [];
      const d = chooseEstimate(prod.v62Final, lab, flags, prod.competitorIpRaw ?? prod.competitorIp ?? null, range?.sampleCount ?? null);
      const flagsS = range ? rangeFlagsFor(screen, range) : [];
      const dS = chooseEstimate(screen.v62Final, lab, flagsS, screen.competitorIpRaw ?? screen.competitorIp ?? null, range?.sampleCount ?? null);
      out.push({ name: s.storeName, act: s.actualMonthlyRevenueAvg as number, vScreen: screen.v62Final, vProd: prod.v62Final, lab, pick: d.primaryValue, primary: d.primary, far: flags.some((f) => f.far), kakao: kakaoCount, pickS: dS.primaryValue, primaryS: dS.primary, farS: flagsS.some((f) => f.far) });
    }
    return out;
  };

  it("화면 전용 변형 가르기 — 하나씩 켜 보기(입지평가 사람 값)", () => {
    type V = { label: string; ceiling: boolean; include: boolean; blank: boolean; floor: boolean };
    const vs: V[] = [
      { label: "운영 설정(변형 0)", ceiling: false, include: false, blank: false, floor: false },
      { label: "+ 상권수요 천장만", ceiling: true, include: false, blank: false, floor: false },
      { label: "+ 학습 경쟁점 비움만", ceiling: false, include: false, blank: true, floor: false },
      { label: "+ 송도·동탄 학습 포함만", ceiling: false, include: true, blank: false, floor: false },
      { label: "+ QSC 최저 채움만", ceiling: false, include: false, blank: false, floor: true },
      { label: "천장 + 경쟁점 비움", ceiling: true, include: false, blank: true, floor: false },
      { label: "넷 다(지금 화면)", ceiling: true, include: true, blank: true, floor: true },
    ];
    console.log("\n[화면 전용 변형 가르기] 주소만 · 입지평가 사람 값 · 기존점 LOO");
    for (const v of vs) {
      const es: number[] = [];
      for (const s of core) {
        const { candidate, competitors: comps } = buildFor(s);
        const others = raw.filter((x) => x.storeCode !== s.storeCode);
        const loc = locations.find((l) => l.candidateCode === (s as unknown as { sourceCode?: string }).sourceCode || l.candidateCode === s.storeCode) ?? null;
        const r = evaluateCandidate({
          candidate, competitors: comps, locationEvaluation: loc ? { ...loc, candidateCode: candidate.code } : null,
          settings: v.ceiling ? withQuickEvalSettings(settings) : settings,
          existingStores: v.include ? others : others, trainingLocationEvaluations: locations,
          trainingCompetitors: v.blank ? competitors.map(blankCompetitorForTraining) : competitors,
          trainingSales: sales.filter((x: { storeCode: string }) => x.storeCode !== s.storeCode), trainingQscScores: v.floor ? qscScores : qscScores,
        });
        if (r.v62Final) es.push(r.v62Final / (s.actualMonthlyRevenueAvg as number) - 1);
      }
      console.log(`  ${pad(v.label, 24)} ${summary(es)}`);
    }
    expect(core.length).toBeGreaterThan(30);
  });

  it("가능/불가 정답률 — 기존점(실매출 > 기준이면 가능이 정답) · 판정 방식별", () => {
    const T = 55_000_000;
    const rows = runAll(true);
    type P = { label: string; pick: (r: (typeof rows)[number]) => number | null };
    const ps: P[] = [
      { label: "V62(화면)만", pick: (r) => r.vScreen },
      { label: "실험실만", pick: (r) => r.lab },
      { label: "규칙(검증불가→낮은 쪽)", pick: (r) => r.pickS },
      { label: "갈리면(>1.2배) 낮은 쪽", pick: (r) => (r.vScreen != null && r.lab != null && Math.max(r.vScreen, r.lab) / Math.min(r.vScreen, r.lab) > 1.2 ? Math.min(r.vScreen, r.lab) : r.vScreen) },
      { label: "갈리면(>2배) 낮은 쪽", pick: (r) => (r.vScreen != null && r.lab != null && Math.max(r.vScreen, r.lab) / Math.min(r.vScreen, r.lab) > 2 ? Math.min(r.vScreen, r.lab) : r.vScreen) },
      { label: "실험실이 V62의 1/1.5 아래면 실험실", pick: (r) => (r.vScreen != null && r.lab != null && r.lab < r.vScreen / 1.5 ? r.lab : r.vScreen) },
      { label: "실험실이 V62의 1/2 아래면 실험실", pick: (r) => (r.vScreen != null && r.lab != null && r.lab < r.vScreen / 2 ? r.lab : r.vScreen) },
      { label: "실험실이 V62의 1/2.5 아래면 실험실", pick: (r) => (r.vScreen != null && r.lab != null && r.lab < r.vScreen / 2.5 ? r.lab : r.vScreen) },
      { label: "실험실이 V62의 1/3 아래면 실험실", pick: (r) => (r.vScreen != null && r.lab != null && r.lab < r.vScreen / 3 ? r.lab : r.vScreen) },
    ];
    for (const k of [1.5, 2, 2.5, 3]) console.log(`  (1/${k} 기준에 걸리는 기존점: ${rows.filter((r) => r.vScreen != null && r.lab != null && r.lab < r.vScreen / k).map((r) => `${r.name.replace(/점$/, "")}(실측 ${Math.round(r.act / 1e4)}만·V62 ${Math.round(r.vScreen! / 1e4)}·실험실 ${Math.round(r.lab! / 1e4)})`).join(", ") || "없음"})`);
    const _unused = [
    ];
    void _unused;
    const truthYes = rows.filter((r) => r.act > T).length;
    console.log(`
[가능/불가 정답률 · 기존점 ${rows.length}곳] 정답 '가능' ${truthYes}곳 · '불가' ${rows.length - truthYes}곳 (실매출 기준 5,500만)`);
    for (const pp of ps) {
      let tp = 0, fn = 0, fp = 0, tn = 0;
      for (const r of rows) { const v = pp.pick(r); const y = v != null && v > T; const t = r.act > T; if (t && y) tp++; else if (t) fn++; else if (y) fp++; else tn++; }
      console.log(`  ${pad(pp.label, 26)} 맞음 ${tp + tn}/${rows.length} · 되는 자리를 불가로 ${fn} · 안 되는 자리를 가능으로 ${fp}`);
    }
    expect(rows.length).toBeGreaterThan(30);
  });

  for (const withLoc of [false, true]) {
    it(`기존점 되짚기 — 입지평가 ${withLoc ? "있음(사람 값 = AI 상한)" : "없음"}`, () => {
      const rows = runAll(withLoc);
      const e = (k: keyof Row) => rows.filter((r) => typeof r[k] === "number").map((r) => (r[k] as number) / r.act - 1);
      console.log(`\n[주소만 되짚기 · 입지평가 ${withLoc ? "사람 값" : "없음"}] 카카오 경쟁점 중앙 ${median(rows.map((r) => r.kakao))}곳`);
      console.log(`  V62(화면·지금)  ${summary(e("vScreen"))}`);
      console.log(`  V62(운영 설정)  ${summary(e("vProd"))}`);
      console.log(`  실험실          ${summary(e("lab"))}`);
      console.log(`  규칙(화면 V62)  ${summary(e("pickS"))} · 실험실 주 값 ${rows.filter((r) => r.primaryS === "실험실").length}곳 · 검증 불가 ${rows.filter((r) => r.farS).length}곳`);
      console.log(`  규칙 주 값      ${summary(e("pick"))} · 실험실 주 값 ${rows.filter((r) => r.primary === "실험실").length}곳 · 검증 불가 ${rows.filter((r) => r.far).length}곳`);
      const worst = [...rows].sort((a, b) => Math.abs((b.pick ?? 0) / b.act - 1) - Math.abs((a.pick ?? 0) / a.act - 1)).slice(0, 6);
      console.log(`  규칙 주 값 오차 큰 곳: ${worst.map((r) => `${r.name.replace(/점$/, "")} ${(((r.pick ?? 0) / r.act - 1) * 100).toFixed(0)}%(${r.primary}, 카카오 ${r.kakao})`).join(" · ")}`);
      console.log(`  ${pad("", 0)}`);
      expect(rows.length).toBeGreaterThan(30);
    });
  }
});
