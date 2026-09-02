// 1회성 라이브 조사 스크립트 — 커밋 안 함.
// 목적: 웹 헤드라인(정식+조기검증 통합, combinedSummary)과 정확히 같은 로직을 재현해 대조.
import { readFileSync, writeFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, it } from "vitest";
import {
  computeCompetitorInvestigationSummary,
  runCohortValidation,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { defaultModelSettings } from "./settings";
import type { Competitor, ExistingStore, LocationEvaluation, ModelSettings } from "./types";

function loadEnvLocal() {
  let text: string;
  try {
    text = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(adminApp);

describe("live check", () => {
  it("reproduces web headline (combinedSummary)", async () => {
    const [storesSnap, settingsSnap, competitorsSnap, locSnap] = await Promise.all([
      db.collection("storeEvalExistingStores").get(),
      db.doc("storeEvalSettings/current").get(),
      db.collection("storeEvalCompetitors").get(),
      db.collection("storeEvalLocationEvaluations").get(),
    ]);
    const stores = storesSnap.docs.map((d) => d.data() as ExistingStore);
    const settings: ModelSettings = settingsSnap.exists ? { ...defaultModelSettings(), ...(settingsSnap.data() as ModelSettings) } : { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };
    const allCompetitors = competitorsSnap.docs.map((d) => d.data() as Competitor);
    const allLocationEvaluations = locSnap.docs.map((d) => d.data() as LocationEvaluation);

    const competitorsByCandidateCode = new Map<string, Competitor[]>();
    for (const c of allCompetitors) {
      const list = competitorsByCandidateCode.get(c.candidateCode) ?? [];
      list.push(c);
      competitorsByCandidateCode.set(c.candidateCode, list);
    }
    const locByCandidateCode = new Map(allLocationEvaluations.map((l) => [l.candidateCode, l]));

    const inputs: ValidationStoreInput[] = stores.map((s) => {
      const lookupCode = s.originCandidateCode ?? s.storeCode;
      const loc = locByCandidateCode.get(lookupCode) ?? null;
      const competitors = competitorsByCandidateCode.get(lookupCode) ?? [];
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
        competitivenessScore: s.competitivenessScore,
        competitivenessGap: s.competitivenessGap,
        actualRevenueAvg: s.actualMonthlyRevenueAvg,
        specialDemandType: s.specialDemandType,
        specialDemandIntensity: s.specialDemandIntensity,
        inflowRestriction: loc?.inflowRestriction ?? null,
        hasLocationEvaluation: loc != null,
        floor: s.floor,
        groundLevel: s.groundLevel,
        hasElevator: s.hasElevator,
        competitorSummary: computeCompetitorInvestigationSummary(competitors),
        sheetV61Predicted: s.v61Predicted,
      };
    });

    const { rows } = runCohortValidation(inputs, settings);
    const targets = {
      mape: settings.targetMAE,
      medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio,
      within20: settings.target20pctRatio,
      maxBias: settings.maxAvgBias,
    };
    const blackLabelRows = rows.filter((r) => r.brand === "블랙라벨");
    const coreRows = blackLabelRows.filter((r) => r.includedInCoreAccuracy);
    const earlyNormalRows = blackLabelRows.filter(
      (r) =>
        !r.includedInCoreAccuracy &&
        (r.cohort === "조기 검증 A" || r.cohort === "조기 검증 B" || r.cohort === "조기 검증 C") &&
        !r.isPostOpenIssue &&
        r.franchiseStatus === "정상" &&
        r.actualRevenueAvg != null &&
        r.v62PredictedRevenueAvg != null,
    );
    const combinedRows = [...coreRows, ...earlyNormalRows];
    const coreSummary = summarizeValidationRows(coreRows, targets);
    const combinedSummary = summarizeValidationRows(combinedRows, targets);
    const out =
      "정식검증만(coreSummary): " +
      JSON.stringify(coreSummary, null, 2) +
      "\n정식+조기 통합(combinedSummary, 웹 헤드라인): " +
      JSON.stringify(combinedSummary, null, 2) +
      "\n매장별 오차: " +
      JSON.stringify(
        combinedRows
          .map((r) => ({
            name: r.storeName,
            months: r.completedMonths,
            actual: Math.round((r.actualRevenueAvg ?? 0) / 10000),
            pred: Math.round((r.v62PredictedRevenueAvg ?? 0) / 10000),
            errPct: Number((((r.v62PredictedRevenueAvg ?? 0) / (r.actualRevenueAvg ?? 1) - 1) * 100).toFixed(1)),
          }))
          .sort((a, b) => a.errPct - b.errPct),
        null,
        1,
      );
    writeFileSync("live-check-out.txt", out, "utf8");
    console.log(out);
  }, 60000);
});
