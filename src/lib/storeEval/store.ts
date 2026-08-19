// 점포평가 시스템 - Firestore 데이터 접근 레이어.
// src/lib/seatLayout/store.ts와 동일한 패턴(클라이언트 SDK 직접 사용, undefined 제거)을 따른다.
// 컬렉션 구조는 docs/model-spec.md의 시트 구조를 그대로 옮긴 것이다:
//   storeEvalCandidates          <- 07_신규후보지 (입력값만, 계산열은 저장하지 않음)
//   storeEvalCompetitors         <- 05_경쟁점정보 (candidateCode로 1:N)
//   storeEvalLocationEvaluations <- 09_입지동선평가 (candidateCode가 문서ID, 1:1)
//   storeEvalResults             <- 13_신규후보지판정 (계산 결과 스냅샷, candidateCode가 문서ID)
//   storeEvalSettings            <- 12_운영판정 계수 (관리자 전용)
//   storeEvalSettingsHistory     <- 설정 변경이력
//   storeEvalExistingStores      <- 01_점포기본정보 (기존 가맹점 마스터)
//   storeEvalExistingStoreSales  <- 매출DB (구글시트 동기화 대상)
//   storeEvalAuditLog            <- 수정·삭제·재계산 이력 (불변 로그)

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  CandidateInput,
  Competitor,
  EvaluationResult,
  ExistingStore,
  ExistingStoreMonthlySales,
  LocationEvaluation,
  ModelSettings,
  ModelSettingsHistoryEntry,
} from "./types";

const CANDIDATES = "storeEvalCandidates";
const COMPETITORS = "storeEvalCompetitors";
const LOCATION_EVALS = "storeEvalLocationEvaluations";
const RESULTS = "storeEvalResults";
const SETTINGS = "storeEvalSettings";
const SETTINGS_HISTORY = "storeEvalSettingsHistory";
const EXISTING_STORES = "storeEvalExistingStores";
const EXISTING_STORE_SALES = "storeEvalExistingStoreSales";
const AUDIT_LOG = "storeEvalAuditLog";
const META = "storeEvalMeta";

function requireDb(): Firestore {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다.");
  return db;
}

function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export type AuditAction = "생성" | "수정" | "삭제" | "재계산";
export type AuditLogEntry = {
  id: string;
  entityType: "candidate" | "competitor" | "locationEvaluation" | "evaluationResult" | "modelSettings";
  entityId: string;
  action: AuditAction;
  before: unknown;
  after: unknown;
  actor: string | null;
  at: number;
};

export async function writeAuditLog(entry: Omit<AuditLogEntry, "id" | "at">): Promise<void> {
  const id = `${entry.entityType}_${entry.entityId}_${Date.now()}`;
  await setDoc(doc(requireDb(), AUDIT_LOG, id), sanitize({ ...entry, at: Date.now() }));
}

// ---------------------------------------------------------------------------
// 후보지코드 자동 생성 (N001 형식) - 트랜잭션 카운터로 동시 생성 충돌 방지
// ---------------------------------------------------------------------------
export async function generateNextCandidateCode(): Promise<string> {
  const counterRef = doc(requireDb(), META, "candidateCodeCounter");
  const next = await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? ((snap.data().value as number) ?? 0) : 0;
    const nextValue = current + 1;
    tx.set(counterRef, { value: nextValue });
    return nextValue;
  });
  return `N${String(next).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// 07_신규후보지 (CandidateInput)
// ---------------------------------------------------------------------------
export async function listCandidates(): Promise<CandidateInput[]> {
  const snap = await getDocs(query(collection(requireDb(), CANDIDATES), orderBy("updatedAt", "desc")));
  return snap.docs.map((d) => d.data() as CandidateInput);
}

export async function getCandidate(code: string): Promise<CandidateInput | null> {
  const snap = await getDoc(doc(requireDb(), CANDIDATES, code));
  return snap.exists() ? (snap.data() as CandidateInput) : null;
}

export async function saveCandidate(candidate: CandidateInput, actor: string | null): Promise<void> {
  const before = await getCandidate(candidate.code);
  await setDoc(doc(requireDb(), CANDIDATES, candidate.code), sanitize({ ...candidate, updatedAt: Date.now(), updatedBy: actor }));
  await writeAuditLog({ entityType: "candidate", entityId: candidate.code, action: before ? "수정" : "생성", before, after: candidate, actor });
}

export async function deleteCandidate(code: string, actor: string | null): Promise<void> {
  const before = await getCandidate(code);
  await deleteDoc(doc(requireDb(), CANDIDATES, code));
  await writeAuditLog({ entityType: "candidate", entityId: code, action: "삭제", before, after: null, actor });
}

/** 후보지 복사 - 새 코드로 입력값만 그대로 복제(임시저장 상태로). */
export async function duplicateCandidate(sourceCode: string, actor: string | null): Promise<CandidateInput> {
  const source = await getCandidate(sourceCode);
  if (!source) throw new Error("복사할 후보지를 찾지 못했습니다.");
  const newCode = await generateNextCandidateCode();
  const copy: CandidateInput = { ...source, code: newCode, name: `${source.name} (복사본)`, isDraft: true, createdAt: Date.now(), updatedAt: Date.now(), updatedBy: actor };
  await saveCandidate(copy, actor);
  return copy;
}

// ---------------------------------------------------------------------------
// 05_경쟁점정보 (Competitor, candidateCode로 1:N)
// ---------------------------------------------------------------------------
export async function listCompetitors(candidateCode: string): Promise<Competitor[]> {
  const snap = await getDocs(query(collection(requireDb(), COMPETITORS), where("candidateCode", "==", candidateCode)));
  return snap.docs.map((d) => d.data() as Competitor);
}

export async function saveCompetitor(competitor: Competitor, actor: string | null): Promise<void> {
  const ref = doc(requireDb(), COMPETITORS, competitor.id);
  const before = await getDoc(ref);
  await setDoc(ref, sanitize({ ...competitor, updatedAt: Date.now() }));
  await writeAuditLog({ entityType: "competitor", entityId: competitor.id, action: before.exists() ? "수정" : "생성", before: before.exists() ? before.data() : null, after: competitor, actor });
}

export async function deleteCompetitor(id: string, actor: string | null): Promise<void> {
  const ref = doc(requireDb(), COMPETITORS, id);
  const before = await getDoc(ref);
  await deleteDoc(ref);
  await writeAuditLog({ entityType: "competitor", entityId: id, action: "삭제", before: before.exists() ? before.data() : null, after: null, actor });
}

// ---------------------------------------------------------------------------
// 09_입지동선평가 (LocationEvaluation, candidateCode가 문서ID)
// ---------------------------------------------------------------------------
export async function getLocationEvaluation(candidateCode: string): Promise<LocationEvaluation | null> {
  const snap = await getDoc(doc(requireDb(), LOCATION_EVALS, candidateCode));
  return snap.exists() ? (snap.data() as LocationEvaluation) : null;
}

export async function saveLocationEvaluation(evaluation: LocationEvaluation, actor: string | null): Promise<void> {
  const before = await getLocationEvaluation(evaluation.candidateCode);
  await setDoc(doc(requireDb(), LOCATION_EVALS, evaluation.candidateCode), sanitize({ ...evaluation, updatedAt: Date.now(), updatedBy: actor }));
  await writeAuditLog({ entityType: "locationEvaluation", entityId: evaluation.candidateCode, action: before ? "수정" : "생성", before, after: evaluation, actor });
}

// ---------------------------------------------------------------------------
// 13_신규후보지판정 (EvaluationResult 스냅샷, candidateCode가 문서ID)
// ---------------------------------------------------------------------------
export async function getEvaluationResult(candidateCode: string): Promise<EvaluationResult | null> {
  const snap = await getDoc(doc(requireDb(), RESULTS, candidateCode));
  return snap.exists() ? (snap.data() as EvaluationResult) : null;
}

export async function listEvaluationResults(): Promise<EvaluationResult[]> {
  const snap = await getDocs(collection(requireDb(), RESULTS));
  return snap.docs.map((d) => d.data() as EvaluationResult);
}

export async function saveEvaluationResult(result: EvaluationResult, actor: string | null): Promise<void> {
  const before = await getEvaluationResult(result.candidateCode);
  await setDoc(doc(requireDb(), RESULTS, result.candidateCode), sanitize(result));
  await writeAuditLog({ entityType: "evaluationResult", entityId: result.candidateCode, action: "재계산", before, after: result, actor });
}

// ---------------------------------------------------------------------------
// 12_운영판정 계수 (ModelSettings, 관리자 전용 - firestore.rules에서 강제)
// ---------------------------------------------------------------------------
export async function getModelSettings(): Promise<ModelSettings | null> {
  const snap = await getDoc(doc(requireDb(), SETTINGS, "current"));
  return snap.exists() ? (snap.data() as ModelSettings) : null;
}

export async function saveModelSettings(settings: ModelSettings, actor: string | null): Promise<void> {
  const before = await getModelSettings();
  await setDoc(doc(requireDb(), SETTINGS, "current"), sanitize({ ...settings, updatedAt: Date.now(), updatedBy: actor }));
  if (before) {
    const historyId = `${Date.now()}`;
    const historyEntry: ModelSettingsHistoryEntry = { id: historyId, changedAt: Date.now(), changedBy: actor, before, after: settings };
    await setDoc(doc(requireDb(), SETTINGS_HISTORY, historyId), sanitize(historyEntry));
  }
}

export async function listModelSettingsHistory(): Promise<ModelSettingsHistoryEntry[]> {
  const snap = await getDocs(query(collection(requireDb(), SETTINGS_HISTORY), orderBy("changedAt", "desc")));
  return snap.docs.map((d) => d.data() as ModelSettingsHistoryEntry);
}

// ---------------------------------------------------------------------------
// 기존 가맹점 마스터 + 월별 매출 (6.기존 가맹점 검증 화면 / 구글시트 동기화)
// ---------------------------------------------------------------------------
export async function listExistingStores(): Promise<ExistingStore[]> {
  const snap = await getDocs(collection(requireDb(), EXISTING_STORES));
  return snap.docs.map((d) => d.data() as ExistingStore);
}

export async function upsertExistingStore(store: ExistingStore): Promise<void> {
  await setDoc(doc(requireDb(), EXISTING_STORES, store.storeCode), sanitize(store));
}

export async function listExistingStoreSales(storeCode?: string): Promise<ExistingStoreMonthlySales[]> {
  const base = collection(requireDb(), EXISTING_STORE_SALES);
  const snap = await getDocs(storeCode ? query(base, where("storeCode", "==", storeCode)) : base);
  return snap.docs.map((d) => d.data() as ExistingStoreMonthlySales);
}

export async function upsertExistingStoreSales(sales: ExistingStoreMonthlySales): Promise<void> {
  const id = `${sales.storeCode}_${sales.yearMonth}`;
  await setDoc(doc(requireDb(), EXISTING_STORE_SALES, id), sanitize(sales));
}

export { serverTimestamp };
