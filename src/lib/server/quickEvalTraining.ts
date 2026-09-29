import "server-only";
// 주소만 초기평가 계산용 학습 자료를 **서버에서** 읽는다(admin SDK). 채팅 입지평가(MCP)가 쓴다. (2026-09-29)
//
// 화면(quick-eval/page.tsx)은 같은 자료를 클라이언트 SDK(store.ts의 list* 함수)로 읽는다. 여기는 그 서버판이고,
// 읽는 컬렉션·거르는 규칙을 store.ts와 **똑같이** 맞췄다:
//   기존점 전부 · 설정 current · 입지평가 전부 · 경쟁점 전부(옛 조사상태 변환) · QSC(원본 기록에서 창 평균) ·
//   매출은 평가 창 12개월 문서만(evaluationSalesIds)
//
// ⚠️ 2026-09-29 오전 사용자가 Firebase를 **무료 요금제(Spark)로 내렸다** — 하루 읽기 5만 건을 넘으면 앱이 멈춘다.
//    한 번 읽는 데 약 1,300건이라 **메모리 캐시**를 둔다. 같은 서버 인스턴스에서 CACHE_MS 안에 다시 부르면 안 읽는다.
//    기존점·경쟁점은 하루 한 번 크론이 바꾸는 자료라 몇 분 낡아도 결과가 사실상 같다.
import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { migrateCompetitorInvestigationStatus } from "@/lib/storeEval/competitorCompatibility";
import { evaluationSalesIds } from "@/lib/storeEval/evaluationSalesPeriod";
import { qscInWindowAverage, type QscRecord } from "@/lib/storeEval/labInput";
import { mergeModelSettings } from "@/lib/storeEval/settings";
import type { QuickEvalTraining } from "@/lib/storeEval/quickEval/quickEvalCompute";
import type { ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings } from "@/lib/storeEval/types";

export const QUICK_EVAL_TRAINING_CACHE_MS = 10 * 60 * 1000;

let cache: { at: number; value: Promise<QuickEvalTraining> } | null = null;

export function loadQuickEvalTraining(now = Date.now()): Promise<QuickEvalTraining> {
  if (!adminDb) return Promise.reject(new Error("서버 Firebase 설정(FIREBASE_CLIENT_EMAIL·FIREBASE_PRIVATE_KEY)이 없습니다."));
  if (cache && now - cache.at < QUICK_EVAL_TRAINING_CACHE_MS) return cache.value;
  const value = readTraining(adminDb);
  cache = { at: now, value };
  // 실패한 읽기는 캐시에 남기지 않는다(다음 호출이 다시 시도).
  value.catch(() => {
    if (cache?.value === value) cache = null;
  });
  return value;
}

async function readTraining(db: Firestore): Promise<QuickEvalTraining> {
  const all = async (name: string) => (await db.collection(name).get()).docs.map((d) => d.data());
  const [stores, settingsSnap, locations, competitors, qscDocs] = await Promise.all([
    all("storeEvalExistingStores"),
    db.collection("storeEvalSettings").doc("current").get(),
    all("storeEvalLocationEvaluations"),
    all("storeEvalCompetitors"),
    all("storeEvalQscScores"),
  ]);
  const existingStores = stores as ExistingStore[];

  const trainingQscScores = new Map<string, number>();
  for (const v of qscDocs as { storeCode?: string; openedAt?: string | null; records?: QscRecord[] }[]) {
    if (!v.storeCode) continue;
    const avg = qscInWindowAverage(v.records ?? [], v.openedAt ?? null);
    if (avg != null && avg > 0) trainingQscScores.set(v.storeCode, avg);
  }

  // 매출은 평가 창 문서만 — 전체(약 850건)를 읽지 않는다(store.listEvaluationSales와 같은 id).
  const ids = evaluationSalesIds(existingStores);
  const trainingSales: ExistingStoreMonthlySales[] = [];
  const col = db.collection("storeEvalExistingStoreSales");
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db.getAll(...ids.slice(i, i + 100).map((id) => col.doc(id)));
    for (const s of snaps) if (s.exists) trainingSales.push(s.data() as ExistingStoreMonthlySales);
  }

  return {
    existingStores,
    settingsDoc: settingsSnap.exists ? mergeModelSettings(settingsSnap.data() as Partial<ModelSettings>) : null,
    trainingLocationEvaluations: locations as LocationEvaluation[],
    trainingCompetitors: competitors.map((c) => migrateCompetitorInvestigationStatus(c)),
    trainingQscScores,
    trainingSales,
  };
}
