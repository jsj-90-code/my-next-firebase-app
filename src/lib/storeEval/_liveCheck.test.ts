// 실서비스 정확도 측정 하네스. **읽기 전용**(Firestore·구글시트 조회만, 쓰기 없음).
//
// 산식을 바꿀 때 before/after를 실데이터로 재는 도구다. 검증화면(validation/page.tsx)과 똑같은
// 방식으로 입력을 만들어 runUsageCohortValidation을 돌리고, 정식검증군 지표(MAPE·중앙값·
// ±10%·±20%)와 진단(오차 분해, 학습계수, 잔차 신호)을 출력한다.
//
// 평소 `npm test`에서는 건너뛴다 — 실서비스를 읽으므로 CI·오프라인에서 깨지고 할당량도 먹는다.
// 돌리려면 STORE_EVAL_LIVE_CHECK=1 을 붙인다:
//
//   STORE_EVAL_LIVE_CHECK=1 npx.cmd vitest run src/lib/storeEval/_liveCheck.test.ts \
//     --reporter=verbose --disable-console-intercept
//
// (--disable-console-intercept 가 없으면 console.log가 안 보인다. vitest 4에 --reporter=basic은 없다.)
//
// ⚠️ 정확도를 계산할 때 필드를 헷갈리지 말 것 — 반드시 `v62PredictedRevenueAvg`(외부유입 보정·
// 초과수요·가동률상한까지 반영된, 후보지에 실제로 내보내는 값)와 `includedInCoreAccuracy`를 쓴다.
// `predictedRevenueAvg`는 보정 전 표시용이라 이걸로 재면 외부유입제한 매장이 통째로 어긋난다
// (2026-09-10에 실제로 이걸로 틀려서 "버그를 찾았다"는 오진까지 냈다).
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import {
  computeCompetitorInvestigationSummary,
  isCoreEligibleForV61Training,
  isValidVisibilityScore,
  toV61TrainingStore,
  buildMinCoefficients,
  empiricalFeaturesFor,
  type ValidationStoreInput,
} from "./calc";
import { computeOverflowPcHours, runUsageCohortValidation, buildRevenuePartsByStore, attachRevenueParts, fitUsageRevenueModel, predictUsageRevenue } from "./usageRevenue";
import { defaultModelSettings, mergeModelSettings } from "./settings";
import type {
  Competitor,
  ExistingStore,
  ExistingStoreMonthlySales,
  LocationEvaluation,
  ModelSettings,
} from "./types";

const BS = String.fromCharCode(92);
function loadEnvLocal() {
  const text = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = v;
  }
}

/**
 * Firestore 원본을 로컬에 캐시한다.
 *
 * 왜 필요한가: 이 하네스는 매 실행마다 4개 컬렉션을 통째로 읽는다(매출만 850건). 산식을
 * 만지면서 열 번 스무 번 돌리면 **Firestore 일일 읽기 할당량(무료 50,000건)을 태운다** —
 * 2026-09-10에 실제로 태워서 "Quota exceeded"가 났고, 같은 프로젝트를 쓰는 **실서비스 화면도
 * 그날 하루 영향을 받는다**. 한 번 읽어 캐시해두고 재사용한다.
 *
 * 최신 데이터로 다시 읽으려면 STORE_EVAL_LIVE_REFRESH=1 을 준다.
 */
const CACHE_PATH = new URL("../../../.local-tools/liveCheck-cache.json", import.meta.url);

async function loadAll() {
  loadEnvLocal();
  if (!process.env.STORE_EVAL_LIVE_REFRESH) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
      console.log(`[캐시] ${cached.capturedAt} 스냅샷 사용 (Firestore 읽기 0건). 새로 읽으려면 STORE_EVAL_LIVE_REFRESH=1`);
      return buildInputs(cached.storedStores, cached.competitors, cached.locations, cached.salesRows, cached.settings);
    } catch {
      console.log("[캐시] 없음 — Firestore에서 읽어 캐시를 만든다.");
    }
  }
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY!.split(BS + "n").join(String.fromCharCode(10)),
        }),
      });
  const db = getFirestore(app);
  const read = async <T,>(name: string) => (await db.collection(name).get()).docs.map((d) => d.data() as T);

  const [storedStores, competitors, locations, salesRows, settingsSnap] = await Promise.all([
    read<ExistingStore>("storeEvalExistingStores"),
    read<Competitor>("storeEvalCompetitors"),
    read<LocationEvaluation>("storeEvalLocationEvaluations"),
    read<ExistingStoreMonthlySales>("storeEvalExistingStoreSales"),
    db.collection("storeEvalSettings").doc("current").get(),
  ]);
  const settings: ModelSettings = settingsSnap.exists
    ? mergeModelSettings(settingsSnap.data() as Partial<ModelSettings>)
    : { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };

  try {
    writeFileSync(CACHE_PATH, JSON.stringify({
      capturedAt: new Date().toISOString(), storedStores, competitors, locations, salesRows, settings,
    }));
    console.log("[캐시] 저장 완료 — 다음 실행부터는 Firestore를 읽지 않는다.");
  } catch (e) {
    console.log("[캐시] 저장 실패(무시하고 진행):", String(e).slice(0, 120));
  }
  return buildInputs(storedStores, competitors, locations, salesRows, settings);
}

function buildInputs(
  storedStores: ExistingStore[],
  competitors: Competitor[],
  locations: LocationEvaluation[],
  salesRows: ExistingStoreMonthlySales[],
  settings: ModelSettings,
) {
  const stores = prepareExistingStoresForEvaluation(storedStores, competitors, locations, settings);
  const competitorsByCandidate = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const list = competitorsByCandidate.get(c.candidateCode) ?? [];
    list.push(c);
    competitorsByCandidate.set(c.candidateCode, list);
  }
  const locationByCandidate = new Map(locations.map((l) => [l.candidateCode, l]));

  const inputs: ValidationStoreInput[] = stores.map((s) => {
    const lookupCode = existingStoreSourceCode(s);
    const loc = locationByCandidate.get(lookupCode) ?? null;
    const comps = competitorsByCandidate.get(lookupCode) ?? [];
    return {
      storeCode: s.storeCode,
      storeName: s.storeName,
      brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt,
      completedMonths: s.completedMonths ?? 0,
      franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel,
      postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount,
      evaluationPcCount: s.evaluationPcCount,
      hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand,
      marketDemand: s.marketDemand,
      competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(
        s.marketDemand,
        { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore },
        comps,
        settings,
      ),
      competitivenessScore: s.competitivenessScore,
      competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity,
      inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null,
      hasLocationEvaluation: loc != null,
      floor: s.floor,
      groundLevel: s.groundLevel,
      hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(comps),
      sheetV61Predicted: s.v61Predicted,
    };
  });
  return { inputs, salesRows, settings };
}

/**
 * 평가기간(경과 1~12개월, 2개월 이상 우선) 월평균 실효 시간당요금.
 * buildRevenuePartsByStore와 같은 창을 쓴다. 가동률이 한 달이라도 비면 null.
 */
function impliedTariffs(inputs: ValidationStoreInput[], sales: ExistingStoreMonthlySales[]) {
  const nowMonth = new Date().toISOString().slice(0, 7);
  const byStore = new Map<string, ExistingStoreMonthlySales[]>();
  for (const row of sales) {
    const list = byStore.get(row.storeCode) ?? [];
    list.push(row);
    byStore.set(row.storeCode, list);
  }
  const out = new Map<string, number>();
  for (const s of inputs) {
    const m = String(s.openedAt ?? "").match(/^(\d{4})-(\d{2})/);
    const pcCount = s.evaluationPcCount ?? s.pcCount;
    if (!m || !pcCount) continue;
    const openY = Number(m[1]);
    const openM = Number(m[2]);
    const win = (byStore.get(s.storeCode) ?? [])
      .filter((r) => /^\d{4}-(0[1-9]|1[0-2])$/.test(r.yearMonth) && r.yearMonth < nowMonth)
      .map((r) => {
        const [y, mo] = r.yearMonth.split("-").map(Number);
        return { ...r, elapsed: (y - openY) * 12 + mo - openM };
      })
      .filter((r) => r.elapsed >= 1 && r.elapsed <= 12 && (r.pcSales ?? 0) + (r.productSales ?? 0) > 0);
    const later = win.filter((r) => r.elapsed >= 2);
    const sel = later.length ? later : win;
    if (!sel.length || sel.some((r) => !r.pcSales || !r.utilizationRate)) continue;
    const hours = sel.reduce((sum, r) => {
      const [y, mo] = r.yearMonth.split("-").map(Number);
      return sum + pcCount * 24 * new Date(y, mo, 0).getDate() * r.utilizationRate!;
    }, 0) / sel.length;
    const pc = sel.reduce((sum, r) => sum + r.pcSales!, 0) / sel.length;
    if (hours > 0) out.set(s.storeCode, pc / hours);
  }
  return out;
}

type Metric = { n: number; mape: number; hit10: number; hit20: number; median: number; worst: string };

// 정식검증군 판정은 앱과 똑같이 행의 includedInCoreAccuracy를 쓴다(내가 따로 세지 않는다).
function metrics(
  rows: {
    storeCode: string;
    storeName: string;
    v62PredictedRevenueAvg: number | null;
    actualRevenueAvg: number | null;
    includedInCoreAccuracy: boolean;
  }[],
): Metric {
  const errs: { name: string; pct: number }[] = [];
  for (const r of rows) {
    if (!r.includedInCoreAccuracy) continue;
    if (r.v62PredictedRevenueAvg == null || r.actualRevenueAvg == null || r.actualRevenueAvg <= 0) continue;
    errs.push({ name: r.storeName, pct: ((r.v62PredictedRevenueAvg - r.actualRevenueAvg) / r.actualRevenueAvg) * 100 });
  }
  const abs = errs.map((e) => Math.abs(e.pct)).sort((a, b) => a - b);
  const worst = [...errs].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];
  return {
    n: errs.length,
    mape: abs.reduce((a, b) => a + b, 0) / abs.length,
    hit10: abs.filter((a) => a <= 10).length,
    hit20: abs.filter((a) => a <= 20).length,
    median: abs.length % 2 ? abs[abs.length >> 1] : (abs[(abs.length >> 1) - 1] + abs[abs.length >> 1]) / 2,
    worst: worst ? `${worst.name} ${worst.pct > 0 ? "+" : ""}${worst.pct.toFixed(1)}%` : "-",
  };
}

// 실서비스를 읽으므로 기본 실행에서는 건너뛴다. STORE_EVAL_LIVE_CHECK=1 일 때만 돈다.
describe.skipIf(!process.env.STORE_EVAL_LIVE_CHECK)("실서비스 데이터 측정", () => {
  it("정식검증군 정확도와 요금 정정 상한", async () => {
    const { inputs, salesRows, settings } = await loadAll();
    const core = new Set(inputs.filter(isCoreEligibleForV61Training).map((s) => s.storeCode));
    const show = (label: string, m: Metric) =>
      console.log(
        `[${label}] n=${m.n}  MAPE ${m.mape.toFixed(3)}%  중앙값 ${m.median.toFixed(2)}%  ` +
          `±10% ${m.hit10}/${m.n}  ±20% ${m.hit20}/${m.n}  최악 ${m.worst}`,
      );

    const now = metrics(runUsageCohortValidation(inputs, salesRows, settings).rows);
    console.log("");
    show("현행", now);

    // ── 진단 전용(모형 후보 아님) ─────────────────────────────────────────────
    // 등록요금을 평가기간 실효요금으로 갈아끼우면 오차가 어디까지 줄어드는지. 실효요금은 pcSales로
    // 역산한 값이라 이 수치를 예측 성능으로 주장하면 안 된다(신규 후보지엔 없는 값). "요금 데이터를
    // 사람이 고칠 때 기대할 수 있는 상한"을 재는 용도로만 쓴다.
    const rates = impliedTariffs(inputs, salesRows);
    const patched = inputs.map((s) => {
      const rate = rates.get(s.storeCode);
      return rate ? { ...s, hourlyRate: Math.round(rate) } : s;
    });
    const ceiling = metrics(runUsageCohortValidation(patched, salesRows, settings).rows);
    show("진단(순환·모형아님) 요금이 정확하다면", ceiling);
    console.log(
      `→ 요금 정정 상한: MAPE ${(ceiling.mape - now.mape).toFixed(2)}%p, ` +
        `중앙값 ${(ceiling.median - now.median).toFixed(2)}%p, ±10% ${now.hit10}→${ceiling.hit10}곳, ` +
        `±20% ${now.hit20}→${ceiling.hit20}곳`,
    );

    // 꼬리 오차 진단 — 오차 큰 매장이 어떤 속성을 공유하는지.
    const rows = runUsageCohortValidation(inputs, salesRows, settings).rows;
    const byCode = new Map(inputs.map((s) => [s.storeCode, s]));
    const table = rows
      .filter((r) => core.has(r.storeCode) && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
      .map((r) => {
        const s = byCode.get(r.storeCode)!;
        return {
          name: r.storeName,
          err: ((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100,
          special: `${s.specialDemandType ?? "-"}/${s.specialDemandIntensity ?? "-"}`,
          inflow: s.inflowRestriction ?? "-",
          vis: s.visibilityScore ?? "-",
          comp: s.competitivenessScore?.toFixed(2) ?? "-",
          gap: s.competitivenessGap?.toFixed(2) ?? "-",
          ipDemand: s.marketDemand != null && s.competitorIp != null && s.pcCount
            ? (s.marketDemand / ((s.evaluationPcCount ?? s.pcCount)! + s.competitorIp)).toFixed(2)
            : "-",
          extra: Math.round(s.extraPcHours ?? 0),
          nComp: s.competitorSummary?.totalCount ?? 0,
        };
      })
      .sort((a, b) => Math.abs(b.err) - Math.abs(a.err));
    console.log("\n전체 오차 순위 (정식검증군)");
    console.log("매장           오차%   특수수요/강도        외부유입   가시성 경쟁력  격차  IP당수요 초과시간 경쟁점");
    for (const t of table) {
      console.log(
        `${String(t.name).padEnd(12)} ${t.err.toFixed(1).padStart(6)}  ${t.special.padEnd(18)} ${String(t.inflow).padEnd(8)} ` +
          `${String(t.vis).padStart(4)}  ${t.comp.padStart(5)} ${t.gap.padStart(5)} ${t.ipDemand.padStart(7)} ${String(t.extra).padStart(7)} ${String(t.nComp).padStart(5)}`,
      );
    }

    // ── 오차 분해: 총매출 오차가 PC 이용시간에서 오는가, 먹거리에서 오는가 ──────────────
    type Row = (typeof rows)[number] & {
      revenueBreakdown?: { pcHours: number; pcRevenue: number; productRevenue: number } | null;
      actualRevenueBreakdown?: { pcRevenueAvg: number; productRevenueAvg: number } | null;
    };
    const measuredHours = new Map<string, number>();
    for (const s of inputs) {
      const rate = rates.get(s.storeCode);
      const p = (rows as Row[]).find((r) => r.storeCode === s.storeCode)?.actualRevenueBreakdown;
      if (rate && p) measuredHours.set(s.storeCode, p.pcRevenueAvg / rate);
    }
    const decomp = (rows as Row[])
      .filter((r) => r.includedInCoreAccuracy && r.revenueBreakdown && r.actualRevenueBreakdown)
      .map((r) => {
        const b = r.revenueBreakdown!;
        const a = r.actualRevenueBreakdown!;
        const mh = measuredHours.get(r.storeCode) ?? null;
        const s = byCode.get(r.storeCode)!;
        return {
          name: r.storeName,
          total: ((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100,
          pc: ((b.pcRevenue - a.pcRevenueAvg) / a.pcRevenueAvg) * 100,
          prod: ((b.productRevenue - a.productRevenueAvg) / a.productRevenueAvg) * 100,
          hours: mh ? ((b.pcHours - mh) / mh) * 100 : null,
          prodShareActual: (a.productRevenueAvg / (a.pcRevenueAvg + a.productRevenueAvg)) * 100,
          prodSharePred: (b.productRevenue / (b.pcRevenue + b.productRevenue)) * 100,
          special: `${s.specialDemandType ?? "-"}/${s.specialDemandIntensity ?? "-"}`,
        };
      })
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const mape = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null).map(Math.abs);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    console.log(
      `\n오차 분해 (n=${decomp.length}): 총매출 MAPE ${mape(decomp.map((d) => d.total)).toFixed(2)}%  ` +
        `PC매출 ${mape(decomp.map((d) => d.pc)).toFixed(2)}%  먹거리 ${mape(decomp.map((d) => d.prod)).toFixed(2)}%  ` +
        `이용시간 ${mape(decomp.map((d) => d.hours)).toFixed(2)}%`,
    );
    console.log("매장            총오차   PC오차  먹거리오차 시간오차  실제상품비중 예측상품비중 특수수요");
    for (const d of decomp) {
      console.log(
        `${String(d.name).padEnd(12)} ${d.total.toFixed(1).padStart(7)} ${d.pc.toFixed(1).padStart(7)} ` +
          `${d.prod.toFixed(1).padStart(8)} ${(d.hours?.toFixed(1) ?? "-").padStart(8)} ` +
          `${d.prodShareActual.toFixed(1).padStart(9)} ${d.prodSharePred.toFixed(1).padStart(10)}  ${d.special}`,
      );
    }

    // 적합된 계수와 하한선 구속 여부
    {
      const parts2 = buildRevenuePartsByStore(inputs, salesRows);
      const useVis = settings.v61Training.modelVariant === "visibility-inflow";
      const training = attachRevenueParts(
        inputs.filter(isCoreEligibleForV61Training)
          .filter((s) => !useVis || isValidVisibilityScore(s.visibilityScore))
          .map((s) => toV61TrainingStore(s, settings)),
        parts2,
      );
      const model = fitUsageRevenueModel(training, settings)!;
      const floors = buildMinCoefficients(settings.v61Training).slice(1);
      const names = ["IP당수요", "경쟁력점수", "경쟁력x格차", "배후수요더미", "가시성"];
      console.log(`\n적합 계수 (학습표본 ${training.length}곳) — 하한선에 붙어있으면 그 피처는 데이터가 아니라 하한선이 결정한 것`);
      console.log("피처            하한선   PC(이용시간)  먹거리   PC구속  먹거리구속");
      for (let i = 0; i < floors.length; i++) {
        const u = model.usage.coefficients[i];
        const p = model.product.coefficients[i];
        const bind = (v: number) => (Math.abs(v - floors[i]) < 1e-9 ? "  예" : "   -");
        console.log(
          `${(names[i] ?? `f${i}`).padEnd(14)} ${floors[i].toFixed(3).padStart(6)} ${u.toFixed(4).padStart(12)} ` +
            `${p.toFixed(4).padStart(8)} ${bind(u).padStart(6)} ${bind(p).padStart(9)}`,
        );
      }
      console.log(`보정계수: PC ${model.calibration?.usageFactor.toFixed(4)} / 먹거리 ${model.calibration?.productFactor.toFixed(4)}`);
      console.log(`혼합비중: ridge ${settings.v61Training.ridgeWeight} / baseline(대당중앙값) ${settings.v61Training.baselineWeight}`);

      // 순진한 벤치마크: "대당 실제매출 중앙값 x PC대수" (매장 차이를 전혀 안 보는 모형).
      // 리브원아웃으로 자기 자신을 뺀 중앙값을 쓴다. 모형이 이걸 못 이기면 피처가 일 안 하는 것이다.
      const actualPerPc = new Map<string, number>();
      for (const r of rows) {
        const s = byCode.get(r.storeCode);
        const pc = s?.evaluationPcCount ?? s?.pcCount;
        if (r.includedInCoreAccuracy && r.actualRevenueAvg && pc) actualPerPc.set(r.storeCode, r.actualRevenueAvg / pc);
      }
      const med = (xs: number[]) => {
        const v = [...xs].sort((a, b) => a - b);
        return v.length % 2 ? v[v.length >> 1] : (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2;
      };
      const naive: number[] = [];
      for (const code of actualPerPc.keys()) {
        const others = [...actualPerPc.entries()].filter(([c]) => c !== code).map(([, x]) => x);
        const s = byCode.get(code)!;
        const pc = (s.evaluationPcCount ?? s.pcCount)!;
        const actual = rows.find((r) => r.storeCode === code)!.actualRevenueAvg!;
        naive.push(Math.abs((med(others) * pc - actual) / actual) * 100);
      }
      naive.sort((a, b) => a - b);
      console.log(
        `\n순진한 벤치마크(대당중앙값x대수, LOOCV): MAPE ${(naive.reduce((a, b) => a + b, 0) / naive.length).toFixed(3)}%  ` +
          `중앙값 ${med(naive).toFixed(2)}%  ±10% ${naive.filter((x) => x <= 10).length}/${naive.length}  ` +
          `±20% ${naive.filter((x) => x <= 20).length}/${naive.length}`,
      );
    }

    // 영업기간(완료월)별 정확도 — 정식검증 하한이 2026-09-02에 12개월→1개월로 내려갔다.
    {
      const buckets: { label: string; min: number; max: number }[] = [
        { label: "1~2개월", min: 1, max: 2 },
        { label: "3~5개월", min: 3, max: 5 },
        { label: "6~11개월", min: 6, max: 11 },
        { label: "12개월+", min: 12, max: 9999 },
      ];
      console.log("\n영업기간별 정확도 (정식검증군)");
      console.log("구간        매장수  MAPE   중앙값  ±10%   ±20%");
      for (const b of buckets) {
        const errs = rows
          .filter((r) => {
            const s = byCode.get(r.storeCode);
            return r.includedInCoreAccuracy && s && s.completedMonths >= b.min && s.completedMonths <= b.max
              && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0;
          })
          .map((r) => Math.abs((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100)
          .sort((a, b2) => a - b2);
        if (!errs.length) { console.log(`${b.label.padEnd(10)} ${String(0).padStart(5)}      -`); continue; }
        const m = errs.length % 2 ? errs[errs.length >> 1] : (errs[(errs.length >> 1) - 1] + errs[errs.length >> 1]) / 2;
        console.log(
          `${b.label.padEnd(10)} ${String(errs.length).padStart(5)}  ${(errs.reduce((a, b2) => a + b2, 0) / errs.length).toFixed(2).padStart(6)}  ` +
            `${m.toFixed(2).padStart(6)}  ${String(errs.filter((e) => e <= 10).length).padStart(2)}/${errs.length}  ${String(errs.filter((e) => e <= 20).length).padStart(2)}/${errs.length}`,
        );
      }
    }

    // 계수 하한선(사업 판단으로 통계적 최적을 덮어쓴 값)이 정확도에 도움인지 해인지.
    {
      const zeroFloors: ModelSettings = {
        ...settings,
        v61Training: {
          ...settings.v61Training,
          minHourlyRateCoef: 0,
          minMarketDemandCoef: 0,
          minCompetitivenessGapCoef: 0,
          minBackingDemandCoef: 0,
          minVisibilityCoef: 0,
        },
      };
      show("하한선 전부 0 (순수 데이터 적합)", metrics(runUsageCohortValidation(inputs, salesRows, zeroFloors).rows));
    }

    // ── 03_회원정보입력 상관분석은 제거됨 ────────────────────────────────────────────
    // 2026-09-10에 그 시트 탭 자체를 삭제해서 더 이상 읽을 수 없다(읽으려 하면 400 에러).
    // 결론은 이미 났다: 회원 규모·연령/성별 구성 모두 먹거리·상품비중·총매출 오차와 유의한
    // 상관이 없었다(n=36, 최대 r=0.211, 유의 기준 |r|>0.33).
    // 근거: docs/releases/2026-09-10-accuracy-ceiling.md

    // ── 꼬리 매장 규명: 평가에 실제로 쓰인 월이 몇 개이고 어느 구간인가 ────────────────
    {
      const nowMonth = new Date().toISOString().slice(0, 7);
      const byStore = new Map<string, ExistingStoreMonthlySales[]>();
      for (const row of salesRows) {
        const list = byStore.get(row.storeCode) ?? [];
        list.push(row);
        byStore.set(row.storeCode, list);
      }
      const usedWindow = (s: ValidationStoreInput) => {
        const m = String(s.openedAt ?? "").match(/^(\d{4})-(\d{2})/);
        if (!m) return null;
        const openY = Number(m[1]);
        const openM = Number(m[2]);
        const win = (byStore.get(s.storeCode) ?? [])
          .filter((r) => /^\d{4}-(0[1-9]|1[0-2])$/.test(r.yearMonth) && r.yearMonth < nowMonth)
          .map((r) => {
            const [y, mo] = r.yearMonth.split("-").map(Number);
            return { ...r, elapsed: (y - openY) * 12 + mo - openM };
          })
          .filter((r) => r.elapsed >= 1 && r.elapsed <= 12 && (r.pcSales ?? 0) + (r.productSales ?? 0) > 0);
        const later = win.filter((r) => r.elapsed >= 2);
        const sel = later.length ? later : win;
        return { sel, onlyFirstMonth: !later.length && win.length > 0 };
      };

      const errRows = rows
        .filter((r) => r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
        .map((r) => ({ r, err: ((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100 }))
        .sort((a, b) => Math.abs(b.err) - Math.abs(a.err));

      console.log("\n평가에 쓰인 월 구간 (오차 큰 순 12곳)");
      console.log("매장           오차%  완료월  사용월수  경과구간   월별 총매출(백만)");
      for (const { r, err } of errRows.slice(0, 12)) {
        const s = byCode.get(r.storeCode)!;
        const w = usedWindow(s);
        if (!w) continue;
        const span = w.sel.length ? `${Math.min(...w.sel.map((x) => x.elapsed))}~${Math.max(...w.sel.map((x) => x.elapsed))}` : "-";
        const vals = w.sel.map((x) => (((x.pcSales ?? 0) + (x.productSales ?? 0)) / 1e6).toFixed(0)).join(",");
        console.log(
          `${String(r.storeName).padEnd(12)} ${err.toFixed(1).padStart(6)} ${String(s.completedMonths).padStart(5)} ` +
            `${String(w.sel.length).padStart(7)}  ${span.padEnd(8)} ${w.onlyFirstMonth ? "[1개월만]" : ""} ${vals}`,
        );
      }

      // 1개월치로만 평가되는 매장이 몇 곳이고 정확도가 어떤가
      const groups = { onlyFirst: [] as number[], rest: [] as number[] };
      for (const { r, err } of errRows) {
        const w = usedWindow(byCode.get(r.storeCode)!);
        if (!w) continue;
        (w.onlyFirstMonth ? groups.onlyFirst : groups.rest).push(Math.abs(err));
      }
      const stat = (xs: number[]) => xs.length
        ? `n=${xs.length} MAPE ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}% ±10% ${xs.filter((x) => x <= 10).length}/${xs.length} ±20% ${xs.filter((x) => x <= 20).length}/${xs.length}`
        : "n=0";
      console.log(`\n경과 1개월치로만 평가: ${stat(groups.onlyFirst)}`);
      console.log(`경과 2개월 이상 포함:   ${stat(groups.rest)}`);
    }

    // ── 평균회귀(수축) 검사: 잘 되는 매장을 과소, 안 되는 매장을 과대 예측하는가 ──────────
    {
      const pts = rows
        .filter((r) => r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
        .map((r) => ({
          name: r.storeName,
          actual: r.actualRevenueAvg!,
          pred: r.v62PredictedRevenueAvg!,
          err: ((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100,
        }));
      const pearson = (xs: number[], ys: number[]) => {
        const n = xs.length;
        const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
        return sxy / Math.sqrt(sxx * syy);
      };
      const r1 = pearson(pts.map((p) => p.actual), pts.map((p) => p.err));
      const crit = 1.96 / Math.sqrt(pts.length - 3);
      const rCrit = (Math.exp(2 * crit) - 1) / (Math.exp(2 * crit) + 1);
      console.log(`\n평균회귀 검사 (n=${pts.length}, 유의 기준 |r| > ${rCrit.toFixed(2)})`);
      console.log(`  실제매출 수준 ↔ 부호 있는 오차 상관: ${r1.toFixed(3)} ${Math.abs(r1) > rCrit ? "* 유의" : "(유의 미달)"}`);

      // 예측이 실제보다 좁게 퍼져 있는가 (수축의 직접 증거)
      const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
      const la = pts.map((p) => Math.log(p.actual)), lp = pts.map((p) => Math.log(p.pred));
      console.log(`  log 실제매출 표준편차 ${sd(la).toFixed(4)} / log 예측 표준편차 ${sd(lp).toFixed(4)} → 예측 산포가 실제의 ${(sd(lp) / sd(la) * 100).toFixed(0)}%`);
      const slope = pearson(lp, la) * sd(la) / sd(lp);
      console.log(`  실제 = a + b×예측 회귀에서 기울기 b = ${slope.toFixed(3)} (1.0이면 수축 없음, >1이면 예측이 좁다)`);

      // 위 상관은 오차 정의(분모가 실제매출)에 실제매출이 들어가 있어, 잡음만 있어도 음수가
      // 나오는 인위적 상관이다. 편향 여부는 "예측값 기준"으로 봐야 한다 — 신규 후보지에서
      // 우리가 아는 값도 예측값뿐이다.
      const r2 = pearson(pts.map((p) => p.pred), pts.map((p) => p.err));
      console.log(`  예측매출 수준 ↔ 부호 있는 오차 상관: ${r2.toFixed(3)} ${Math.abs(r2) > rCrit ? "* 유의" : "(유의 미달 — 예측 수준별 편향 없음)"}`);

      const third2 = Math.floor(pts.length / 3);
      const byPred = [...pts].sort((a, b) => a.pred - b.pred);
      const band2 = (list: typeof pts, label: string) =>
        console.log(`  ${label}: 평균오차 ${(list.reduce((a, b) => a + b.err, 0) / list.length).toFixed(1)}% (n=${list.length})`);
      console.log("  [예측값 기준 구간]");
      band2(byPred.slice(0, third2), "저예측 1/3");
      band2(byPred.slice(third2, pts.length - third2), "중간 1/3 ");
      band2(byPred.slice(pts.length - third2), "고예측 1/3");

      console.log("  [실제값 기준 구간 — 참고용, 위 인위적 상관과 같은 이유로 해석 주의]");
      const third = Math.floor(pts.length / 3);
      const sorted = [...pts].sort((a, b) => a.actual - b.actual);
      const band = (list: typeof pts, label: string) =>
        console.log(`  ${label}: 평균오차 ${(list.reduce((a, b) => a + b.err, 0) / list.length).toFixed(1)}% (n=${list.length})`);
      band(sorted.slice(0, third), "저매출 1/3");
      band(sorted.slice(third, pts.length - third), "중간 1/3 ");
      band(sorted.slice(pts.length - third), "고매출 1/3");
    }

    // ── 잔차에 아직 신호가 남아 있는가: 모델이 쓰는 입력들과 오차의 상관 ────────────────
    {
      const pts = rows
        .filter((r) => r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
        .map((r) => {
          const s = byCode.get(r.storeCode)!;
          const pc = (s.evaluationPcCount ?? s.pcCount) ?? 0;
          return {
            err: ((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100,
            ipDemand: s.marketDemand != null && s.competitorIp != null && pc ? s.marketDemand / (pc + s.competitorIp) : null,
            marketDemand: s.marketDemand,
            competitorIp: s.competitorIp,
            comp: s.competitivenessScore,
            gap: s.competitivenessGap,
            vis: s.visibilityScore,
            pcCount: pc,
            rate: s.hourlyRate,
            months: s.completedMonths,
            floor: s.floor,
          };
        });
      const pearson = (xs: number[], ys: number[]) => {
        const n = xs.length;
        const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
        return sxy / Math.sqrt(sxx * syy);
      };
      const fields: [string, (p: (typeof pts)[number]) => number | null | undefined][] = [
        ["IP당수요", (p) => p.ipDemand],
        ["상권수요(원수요)", (p) => p.marketDemand],
        ["경쟁IP", (p) => p.competitorIp],
        ["자사 경쟁력점수", (p) => p.comp],
        ["경쟁력격차", (p) => p.gap],
        ["가시성", (p) => p.vis],
        ["PC대수", (p) => p.pcCount],
        ["시간당요금", (p) => p.rate],
        ["완료월수", (p) => p.months],
        ["층수", (p) => p.floor],
      ];
      console.log("\n잔차에 남은 신호 탐색 — 모델 입력 ↔ 부호 있는 오차 상관");
      let found = 0;
      for (const [name, f] of fields) {
        const pairs = pts.map((p) => [f(p), p.err] as const).filter((x): x is readonly [number, number] => typeof x[0] === "number" && Number.isFinite(x[0]));
        if (pairs.length < 10) { console.log(`  ${name.padEnd(16)} 표본 부족(${pairs.length})`); continue; }
        const r = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
        const crit = 1.96 / Math.sqrt(pairs.length - 3);
        const rCrit = (Math.exp(2 * crit) - 1) / (Math.exp(2 * crit) + 1);
        const sig = Math.abs(r) > rCrit;
        if (sig) found++;
        console.log(`  ${name.padEnd(16)} r=${r.toFixed(3).padStart(7)} (n=${pairs.length}, 기준 ${rCrit.toFixed(2)}) ${sig ? "* 유의" : ""}`);
      }
      console.log(found ? `\n  → 유의한 신호 ${found}개. 피처화 검토 대상.` : "\n  → 유의한 신호 없음. 현재 입력으로 더 짜낼 게 없다.");

      // 요금 신호가 "가격탄력성"인지 "등록요금 오류"인지 가른다.
      // 등록요금 대신 평가기간 실효요금(가동률로 역산)으로 바꿔서 같은 상관을 다시 본다.
      // 탄력성이면 실효요금으로도 남고, 등록 오류면 사라진다.
      const withRate = rows
        .filter((r) => r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
        .map((r) => {
          const s = byCode.get(r.storeCode)!;
          return {
            err: ((r.v62PredictedRevenueAvg! - r.actualRevenueAvg!) / r.actualRevenueAvg!) * 100,
            registered: s.hourlyRate,
            implied: rates.get(r.storeCode) ?? null,
          };
        })
        .filter((x): x is { err: number; registered: number; implied: number } => typeof x.registered === "number" && typeof x.implied === "number");
      const rReg = pearson(withRate.map((x) => x.registered), withRate.map((x) => x.err));
      const rImp = pearson(withRate.map((x) => x.implied), withRate.map((x) => x.err));
      const rRatio = pearson(withRate.map((x) => x.registered / x.implied), withRate.map((x) => x.err));
      const crit2 = 1.96 / Math.sqrt(withRate.length - 3);
      const rCrit2 = (Math.exp(2 * crit2) - 1) / (Math.exp(2 * crit2) + 1);
      console.log(`\n요금 신호의 정체 (n=${withRate.length}, 기준 ${rCrit2.toFixed(2)})`);
      console.log(`  등록요금        ↔ 오차: ${rReg.toFixed(3)} ${Math.abs(rReg) > rCrit2 ? "*" : ""}`);
      console.log(`  실효요금(역산)   ↔ 오차: ${rImp.toFixed(3)} ${Math.abs(rImp) > rCrit2 ? "*" : ""}`);
      console.log(`  등록/실효 괴리   ↔ 오차: ${rRatio.toFixed(3)} ${Math.abs(rRatio) > rCrit2 ? "*" : ""}`);
      console.log("  해석: 실효요금 쪽이 남으면 가격탄력성, 괴리 쪽만 남으면 요금 등록 오류.");
    }

    // ── 사전 등록 가설 검정: 요금 탄력성 β < 1.0 (backlog B-1) ────────────────────────
    //
    // 지금 구조는 `PC매출 = 예측이용시간 × 요금`으로 탄력성을 1.0에 고정한다. 잔차 분석에서
    // 시간당요금만 유의한 신호였으므로(r=+0.374), β를 풀면 나아지는지 본다.
    //
    // 이건 **사후 재척도(post-hoc rescaling)** 검정이다 — 회귀계수를 다시 적합하지 않고
    // 예측된 PC매출에 (요금/기준요금)^(β−1)만 곱한다. 제대로 하려면 학습 목표부터 바꿔
    // 다시 적합해야 하므로, 여기서 개선이 없으면 가설은 사실상 죽은 것이고 개선이 있으면
    // 본격 재적합을 해볼 가치가 있다는 뜻이다.
    //
    // β는 **리브원아웃으로 추정**한다 — 평가할 매장을 뺀 나머지에서만 β를 고르고, 그 β로
    // 뺀 매장을 예측한다. 전체로 β를 한 번 추정해 같은 표본을 평가하면 과적합이다.
    {
      type P = { code: string; name: string; pc: number; product: number; actual: number; rate: number };
      const pts: P[] = [];
      for (const r of rows) {
        const s = byCode.get(r.storeCode);
        const b = (r as { revenueBreakdown?: { pcRevenue: number; productRevenue: number } | null }).revenueBreakdown;
        if (!r.includedInCoreAccuracy || !b || !s?.hourlyRate || !(r.actualRevenueAvg ?? 0)) continue;
        pts.push({ code: r.storeCode, name: r.storeName, pc: b.pcRevenue, product: b.productRevenue, actual: r.actualRevenueAvg!, rate: s.hourlyRate });
      }
      const geoMean = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length);
      const errOf = (p: P, beta: number, ref: number) =>
        (p.pc * Math.pow(p.rate / ref, beta - 1) + p.product - p.actual) / p.actual;

      // 격자를 0까지 넓힌다. 최적값이 경계(0.5)에 붙으면 "요금 효과"가 아니라 다른 걸
      // 잡고 있다는 신호이므로 경계를 없애고 봐야 한다.
      const BETAS: number[] = [];
      for (let b = 0.00; b <= 1.401; b += 0.02) BETAS.push(Number(b.toFixed(2)));

      const looErrs: number[] = [];
      const chosen: number[] = [];
      for (const target of pts) {
        const train = pts.filter((p) => p.code !== target.code);
        const ref = geoMean(train.map((p) => p.rate));
        let best = 1, bestScore = Infinity;
        for (const beta of BETAS) {
          // 학습군의 MAPE를 최소화하는 β (평가 대상은 제외돼 있다)
          const score = train.reduce((a, p) => a + Math.abs(errOf(p, beta, ref)), 0) / train.length;
          if (score < bestScore) { bestScore = score; best = beta; }
        }
        chosen.push(best);
        looErrs.push(Math.abs(errOf(target, best, ref)) * 100);
      }
      const med = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v.length % 2 ? v[v.length >> 1] : (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2; };
      const base = pts.map((p) => Math.abs((p.pc + p.product - p.actual) / p.actual) * 100);
      const line = (label: string, xs: number[]) =>
        console.log(`  ${label.padEnd(26)} MAPE ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}%  중앙값 ${med(xs).toFixed(2)}%  ` +
          `±10% ${xs.filter((x) => x <= 10).length}/${xs.length}  ±20% ${xs.filter((x) => x <= 20).length}/${xs.length}`);

      console.log(`\n요금 탄력성 β 검정 (사후 재척도, β는 리브원아웃 추정, n=${pts.length})`);
      line("현행 (β=1 고정)", base);
      line("β 리브원아웃 추정", looErrs);
      console.log(`  선택된 β: 중앙값 ${med(chosen).toFixed(2)}, 범위 ${Math.min(...chosen).toFixed(2)}~${Math.max(...chosen).toFixed(2)}`);

      // 참고: 전체 표본으로 β를 하나 고르면 얼마나 되는지(과적합 상한 — 채택 근거로 쓰면 안 됨)
      const refAll = geoMean(pts.map((p) => p.rate));
      let bAll = 1, sAll = Infinity;
      for (const beta of BETAS) {
        const sc = pts.reduce((a, p) => a + Math.abs(errOf(p, beta, refAll)), 0) / pts.length;
        if (sc < sAll) { sAll = sc; bAll = beta; }
      }
      line(`전체적합 β=${bAll.toFixed(2)} (과적합)`, pts.map((p) => Math.abs(errOf(p, bAll, refAll)) * 100));
      console.log("  ↑ 마지막 줄은 같은 표본으로 β를 고르고 그 표본을 평가한 값이라 채택 근거가 될 수 없다.");

      // β를 고정했을 때의 지표 곡선 — 최적값이 경계에 붙는 이유와 "쓸 만한 구간"을 보여준다.
      // (아래 수치는 β를 데이터가 고른 게 아니라 내가 값을 박은 것이므로 채택 근거가 아니다.
      //  어디쯤에서 요금 반응을 얼마나 남기며 정확도를 얻을 수 있는지 지형을 보는 용도다.)
      console.log("\n  β 고정 시 지형 (β=1이 현행, β=0이면 요금이 예측에 전혀 반영 안 됨)");
      console.log("   β     MAPE     중앙값   ±10%  ±20%");
      for (const beta of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2]) {
        const es = pts.map((p) => Math.abs(errOf(p, beta, geoMean(pts.map((q) => q.rate)))) * 100);
        console.log(
          `  ${beta.toFixed(1)}  ${(es.reduce((a, b) => a + b, 0) / es.length).toFixed(3)}%  ` +
            `${med(es).toFixed(2)}%  ${String(es.filter((x) => x <= 10).length).padStart(4)}  ${String(es.filter((x) => x <= 20).length).padStart(4)}`,
        );
      }

      // ── 결정적 구분: 진짜 탄력성인가, 요금 데이터가 나빠서인가 ──────────────────────
      // 등록요금이 부정확하면(오늘 확인: 실효요금과 중앙값 8.8% 괴리) 그걸 곱할수록 잡음이
      // 끼므로 β를 낮추는 게 이득이다. 그렇다면 "요금 데이터를 고쳐라"가 답이고, 진짜
      // 탄력성이면 "산식에서 요금 비중을 낮춰라"가 답이다 — 완전히 다른 처방이다.
      //
      // 등록요금 대신 **실효요금**(가동률로 역산)으로 같은 지형을 그린다. 요금 데이터가
      // 원인이었다면 실효요금에서는 최적 β가 1.0 쪽으로 돌아와야 한다.
      {
        const withImplied = pts
          .map((p) => ({ p, imp: rates.get(p.code) ?? null }))
          .filter((x): x is { p: P; imp: number } => x.imp != null);
        const refI = geoMean(withImplied.map((x) => x.imp));
        // 실효요금 기준으로 PC매출을 다시 세운다: 이용시간 × 실효요금 (이용시간 = pc/등록요금)
        const errI = (x: { p: P; imp: number }, beta: number) => {
          const hours = x.p.pc / x.p.rate;
          return (hours * x.imp * Math.pow(x.imp / refI, beta - 1) + x.p.product - x.p.actual) / x.p.actual;
        };
        console.log(`\n  실효요금으로 바꿔 그린 같은 지형 (n=${withImplied.length})`);
        console.log("   β     MAPE     중앙값   ±10%  ±20%");
        for (const beta of [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]) {
          const es = withImplied.map((x) => Math.abs(errI(x, beta)) * 100);
          console.log(
            `  ${beta.toFixed(1)}  ${(es.reduce((a, b) => a + b, 0) / es.length).toFixed(3)}%  ` +
              `${med(es).toFixed(2)}%  ${String(es.filter((v) => v <= 10).length).padStart(4)}  ${String(es.filter((v) => v <= 20).length).padStart(4)}`,
          );
        }
        console.log("  → 여기서도 β가 낮을수록 좋으면 '진짜 탄력성', β=1 근처가 최적이면 '요금 데이터 문제'.");
      }

      // ── 대조군: 요금과 무관한 순수 수축 ────────────────────────────────────────────
      // 위 β 재척도는 "요금이 높으면 예측을 깎는" 것인데, 요금은 예측매출과 상관이 있으므로
      // 사실은 그냥 "예측을 평균 쪽으로 수축"하는 효과일 수 있다. 요금을 안 쓰는 수축
      //   pred' = M × (pred/M)^γ   (M = 학습군 예측의 기하평균)
      // 을 같은 방식(γ를 리브원아웃 추정)으로 돌려 비교한다.
      // 이쪽이 비슷하게 좋아지면 β 결과는 "요금 탄력성"이 아니라 일반적인 수축이다.
      {
        const GAMMAS: number[] = [];
        for (let g = 0.40; g <= 1.401; g += 0.02) GAMMAS.push(Number(g.toFixed(2)));
        const predOf = (p: P) => p.pc + p.product;
        const shrunk = (p: P, gamma: number, M: number) => M * Math.pow(predOf(p) / M, gamma);
        const errG = (p: P, gamma: number, M: number) => (shrunk(p, gamma, M) - p.actual) / p.actual;
        const looG: number[] = [];
        const chosenG: number[] = [];
        for (const target of pts) {
          const train = pts.filter((p) => p.code !== target.code);
          const M = geoMean(train.map(predOf));
          let best = 1, bestScore = Infinity;
          for (const g of GAMMAS) {
            const sc = train.reduce((a, p) => a + Math.abs(errG(p, g, M)), 0) / train.length;
            if (sc < bestScore) { bestScore = sc; best = g; }
          }
          chosenG.push(best);
          looG.push(Math.abs(errG(target, best, M)) * 100);
        }
        line("대조군: 요금 무관 순수수축", looG);
        console.log(`  선택된 γ: 중앙값 ${med(chosenG).toFixed(2)}, 범위 ${Math.min(...chosenG).toFixed(2)}~${Math.max(...chosenG).toFixed(2)}`);
        console.log("  → 대조군도 비슷하게 좋아지면 β 결과는 '요금 탄력성'이 아니라 일반적인 예측 수축이다.");
      }
    }

    // ── 재적합 검정: log(요금)을 이용시간 모형 피처로 되돌리고 요금 계수만 음수 허용 ──────
    {
      const withTariff = runUsageCohortValidation(inputs, salesRows, settings, new Date(), "usage");
      const withBoth = runUsageCohortValidation(inputs, salesRows, settings, new Date(), "both");
      console.log("\n요금 재적합 (log(요금)을 피처로 복원 + 요금 계수만 비음수 제약 해제)");
      show("현행 (요금 곱셈, 지수 1.0)", now);
      show("재적합 — 이용시간만", metrics(withTariff.rows));
      show("재적합 — 먹거리까지", metrics(withBoth.rows));

      // 학습된 요금 계수와 그것이 뜻하는 탄력성
      const useVis = settings.v61Training.modelVariant === "visibility-inflow";
      const training = attachRevenueParts(
        inputs.filter(isCoreEligibleForV61Training)
          .filter((s) => !useVis || isValidVisibilityScore(s.visibilityScore))
          .map((s) => toV61TrainingStore(s, settings)),
        buildRevenuePartsByStore(inputs, salesRows),
      );
      const m1 = fitUsageRevenueModel(training, settings, true, "usage")!;
      const c = m1.usage.coefficients[0];
      const sd = m1.usage.featureSds[0];
      // log(이용시간) = ... + c·(log요금 − 평균)/sd  →  이용시간 ∝ 요금^(c/sd)
      // PC매출 = 이용시간 × 요금  →  PC매출 ∝ 요금^(1 + c/sd)
      const elasticity = 1 + c / sd;
      console.log(`  학습된 요금 계수 c=${c.toFixed(4)} (표준화 좌표, sd=${sd.toFixed(4)})`);
      console.log(`  → 함의 탄력성 = 1 + c/sd = ${elasticity.toFixed(3)}  (1.0이면 현행과 동일, 0이면 요금 무반응)`);
      const others = ["IP당수요", "경쟁력점수", "경쟁력x격차", "배후수요", "가시성"];
      console.log(`  나머지 계수: ${m1.usage.coefficients.slice(1).map((v, i) => `${others[i] ?? i}=${v.toFixed(4)}`).join(" ")}`);

      // 요금 시나리오가 여전히 반응하는지 — 모형은 고정하고 **그 매장의 요금만** 올려본다.
      // (학습셋까지 같이 올리면 모형이 재학습돼 상쇄되므로 0%가 나온다 — 실제 사용 상황과 다르다.
      //  실제로는 학습된 모형이 있고, 후보지의 계획 요금만 바꿔보는 것이다.)
      const m0 = fitUsageRevenueModel(training, settings, true, false)!;
      const m2 = fitUsageRevenueModel(training, settings, true, "both")!;
      const respond = (model: typeof m0) => {
        const deltas: number[] = [];
        for (const s of inputs) {
          if (!isCoreEligibleForV61Training(s)) continue;
          const pc = s.evaluationPcCount ?? s.pcCount;
          if (!pc || s.hourlyRate == null) continue;
          const f = empiricalFeaturesFor(toV61TrainingStore(s, settings));
          const fUp = empiricalFeaturesFor(toV61TrainingStore({ ...s, hourlyRate: s.hourlyRate * 1.1 }, settings));
          const a = predictUsageRevenue(model, f, pc, s.hourlyRate, settings);
          const b = predictUsageRevenue(model, fUp, pc, s.hourlyRate * 1.1, settings);
          if (a && b) deltas.push((b.monthlyRevenue / a.monthlyRevenue - 1) * 100);
        }
        return deltas.reduce((x, y) => x + y, 0) / deltas.length;
      };
      console.log(`\n  요금 10% 인상 시 총매출 예측 변화 (모형 고정, 그 매장 요금만 변경)`);
      console.log(`    현행 ${respond(m0).toFixed(2)}%  /  재적합(이용시간) ${respond(m1).toFixed(2)}%  /  재적합(먹거리까지) ${respond(m2).toFixed(2)}%`);
      console.log("    (재적합 쪽이 0에 가까우면 요금 시나리오 기능이 죽은 것이다)");
    }

    const devs = [...rates.entries()]
      .filter(([code]) => core.has(code))
      .map(([code, rate]) => {
        const s = inputs.find((i) => i.storeCode === code)!;
        return { name: s.storeName, registered: s.hourlyRate, implied: Math.round(rate), ratio: (s.hourlyRate ?? 0) / rate };
      })
      .filter((d) => Number.isFinite(d.ratio) && d.ratio > 0)
      .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
    console.log("\n등록/실효 괴리 상위 10곳");
    for (const d of devs.slice(0, 10)) {
      console.log(`  ${String(d.name).padEnd(12)} 등록 ${String(d.registered).padStart(5)} / 실효 ${String(d.implied).padStart(5)} = ${d.ratio.toFixed(3)}`);
    }
  }, 180000);
});
