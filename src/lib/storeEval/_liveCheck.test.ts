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
import { readFileSync } from "node:fs";
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
  type ValidationStoreInput,
} from "./calc";
import { computeOverflowPcHours, runUsageCohortValidation, buildRevenuePartsByStore, attachRevenueParts, fitUsageRevenueModel } from "./usageRevenue";
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

async function loadAll() {
  loadEnvLocal();
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
          nComp: s.competitorSummary?.total ?? 0,
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

    // ── 03_회원정보입력이 먹거리 매출을 설명하는가 (아직 모형에 안 쓰이는 자료) ──────────
    {
      const { google } = await import("googleapis");
      const auth = new google.auth.JWT({
        email: process.env.FIREBASE_CLIENT_EMAIL,
        key: process.env.FIREBASE_PRIVATE_KEY!.split(BS + "n").join(String.fromCharCode(10)),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
      const api = google.sheets({ version: "v4", auth });
      const res = await api.spreadsheets.values.get({
        spreadsheetId: process.env.STORE_EVAL_SPREADSHEET_ID || "1Q5yCOL5IT_pT8lYKvtzhzPK3ihC0otVifQBNPi0SjRA",
        range: "'03_회원정보입력'!A2:T1000",
      });
      const num = (v: unknown) => {
        if (v == null || v === "") return null;
        const n = Number(String(v).replace(/[,%\s]/g, ""));
        return Number.isFinite(n) ? n : null;
      };
      type Member = { date: string; total: number; teen: number; young: number; mid: number; old: number; female: number };
      const members = new Map<string, Member>();
      for (const row of res.data.values ?? []) {
        const code = String(row[0] ?? "").trim();
        const date = String(row[2] ?? "").trim();
        const total = num(row[3]);
        const cells = Array.from({ length: 12 }, (_, i) => num(row[4 + i]) ?? 0);
        const sum = cells.reduce((a, b) => a + b, 0);
        if (!code || !total || sum <= 0) continue;
        const prev = members.get(code);
        if (prev && prev.date >= date) continue;
        members.set(code, {
          date, total,
          teen: (cells[2] + cells[3] + cells[4] + cells[5]) / sum,   // 8~19세
          young: (cells[6] + cells[7]) / sum,                        // 20~30세
          mid: (cells[8] + cells[9]) / sum,                          // 31~45세
          old: (cells[10] + cells[11]) / sum,                        // 46세이상
          female: (cells[1] + cells[3] + cells[5] + cells[7] + cells[9] + cells[11]) / sum,
        });
      }
      const pearson = (xs: number[], ys: number[]) => {
        const n = xs.length;
        const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
        return sxy / Math.sqrt(sxx * syy);
      };
      const paired = decomp
        .map((d) => {
          const s = inputs.find((i) => i.storeName === d.name)!;
          const m = members.get(s.storeCode);
          const pc = s.evaluationPcCount ?? s.pcCount;
          return m && pc ? { d, m, perPc: m.total / pc } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      console.log(`\n회원자료 매칭 ${paired.length}/${decomp.length}곳 — 03_회원정보입력은 현재 모형에 안 쓰인다`);
      const targets: [string, (p: (typeof paired)[number]) => number][] = [
        ["먹거리 오차(부호)", (p) => p.d.prod],
        ["실제 상품비중", (p) => p.d.prodShareActual],
        ["총매출 오차(부호)", (p) => p.d.total],
      ];
      const signals: [string, (p: (typeof paired)[number]) => number][] = [
        ["회원수/PC대수", (p) => p.perPc],
        ["8~19세 비중", (p) => p.m.teen],
        ["20~30세 비중", (p) => p.m.young],
        ["31~45세 비중", (p) => p.m.mid],
        ["46세+ 비중", (p) => p.m.old],
        ["여성 비중", (p) => p.m.female],
      ];
      const crit = (1.96 / Math.sqrt(paired.length - 3));
      const rCrit = (Math.exp(2 * crit) - 1) / (Math.exp(2 * crit) + 1);
      console.log(`상관계수 (n=${paired.length}, 유의 기준 |r| > ${rCrit.toFixed(2)})`);
      console.log("신호              " + targets.map((t) => t[0].padStart(18)).join(""));
      for (const [sname, sf] of signals) {
        const xs = paired.map(sf);
        const line = targets.map(([, tf]) => {
          const r = pearson(xs, paired.map(tf));
          return `${(Math.abs(r) > rCrit ? "*" : " ")}${r.toFixed(3)}`.padStart(18);
        });
        console.log(sname.padEnd(16) + line.join(""));
      }
    }

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
