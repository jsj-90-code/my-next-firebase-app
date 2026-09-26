// 크론이 매출·프로필 동기화 **뒤에** 부르는 재계산 단계 (2026-09-26). 계산은 dailyRecompute.ts, 여기는 읽기·쓰기만.
//
// 쓰는 곳은 사용자가 허락한 세 곳뿐이다(2026-09-26 "응 진행해"):
//   - storeEvalSystemStatus/accuracy  — 적중률 요약 1건(매일 덮어씀 — updatedAt이 "언제 잰 값"을 알려준다)
//   - storeEvalResults/{코드}         — **저장값과 달라진 후보지만**(0.5%·실효단가 1원 잣대). 같으면 안 쓴다
//   - storeEvalAuditLog               — 바꾼 후보지마다 "재계산" 기록 1건(화면 saveEvaluationResult와 같은 모양)
//
// 읽기는 하루 한 번 약 1,300건(검증 화면을 한 번 여는 것과 비슷한 양).
import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { computeAccuracySummary, prepareRecomputeInputs, recomputeCandidates, type RecomputeSource } from "./dailyRecompute";

const ACTOR = "매일 06:00 크론(dailyRecompute)";

export type DailyRecomputeSummary = {
  accuracy: { sampleCount: number; mape: number | null; modelVersion: string | null } | null;
  accuracySkipped?: string;
  candidatesChecked: number;
  candidatesUpdated: { code: string; name: string; reasons: string[] }[];
};

async function all(db: Firestore, name: string) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => d.data());
}

export async function loadRecomputeSource(db: Firestore): Promise<RecomputeSource> {
  const [candidates, results, existingStores, competitors, locationEvaluations, sales, qscDocs,
    labResidentRings, labTradeAreaJudgments, labResidentRadius, labRoadviewJudgments, settingsSnap] = await Promise.all([
    all(db, "storeEvalCandidates"),
    all(db, "storeEvalResults"),
    all(db, "storeEvalExistingStores"),
    all(db, "storeEvalCompetitors"),
    all(db, "storeEvalLocationEvaluations"),
    all(db, "storeEvalExistingStoreSales"),
    all(db, "storeEvalQscScores"),
    all(db, "storeEvalLabResidentRings"),
    all(db, "storeEvalLabTradeAreaJudgments"),
    all(db, "storeEvalLabResidentRadius"),
    all(db, "storeEvalLabRoadviewJudgments"),
    db.collection("storeEvalSettings").doc("current").get(),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    settingsDoc: settingsSnap.exists ? (settingsSnap.data() as Record<string, unknown>) : null,
    candidates: candidates as any,
    results: results as any,
    existingStores: existingStores as any,
    competitors,
    locationEvaluations: locationEvaluations as any,
    sales: sales as any,
    qscDocs: qscDocs as any,
    labResidentRings: labResidentRings as any,
    labTradeAreaJudgments: labTradeAreaJudgments as any,
    labResidentRadius: labResidentRadius as any,
    labRoadviewJudgments: labRoadviewJudgments as any,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function runDailyRecompute(): Promise<DailyRecomputeSummary> {
  if (!adminDb) throw new Error("firebase-admin 서비스 계정이 없어 재계산을 건너뜁니다.");
  const db = adminDb;
  const src = await loadRecomputeSource(db);
  const prepared = prepareRecomputeInputs(src);
  const now = Date.now();

  const accuracy = computeAccuracySummary(src, prepared, now, ACTOR);
  if (accuracy) await db.collection("storeEvalSystemStatus").doc("accuracy").set(clean(accuracy));

  const rows = recomputeCandidates(src, prepared);
  const changed = rows.filter((r) => r.reasons.length > 0);
  for (const r of changed) {
    await db.collection("storeEvalResults").doc(r.code).set(clean(r.after));
    const at = Date.now();
    const id = `evaluationResult_${r.code}_${at}`;
    await db.collection("storeEvalAuditLog").doc(id).set(clean({
      entityType: "evaluationResult", entityId: r.code, action: "재계산",
      before: r.before, after: r.after, actor: `${ACTOR} — ${r.reasons.join("·")}`, at,
    }));
  }

  return {
    accuracy: accuracy && { sampleCount: accuracy.sampleCount, mape: accuracy.meanAbsoluteErrorPct, modelVersion: accuracy.modelVersion },
    ...(accuracy ? {} : { accuracySkipped: "운영설정 문서가 없거나 정식검증군 0곳 — 검증 화면처럼 저장하지 않음" }),
    candidatesChecked: rows.length,
    candidatesUpdated: changed.map((r) => ({ code: r.code, name: r.name, reasons: r.reasons })),
  };
}
