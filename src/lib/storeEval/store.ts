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
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { defaultModelSettings } from "./settings";
import type {
  AdminDongReference,
  CandidateInput,
  Competitor,
  DemandPoint,
  EvaluationResult,
  ExistingStore,
  ExistingStoreMemberSnapshot,
  ExistingStoreMonthlySales,
  LocationEvaluation,
  MarketDataUpload,
  ModelSettings,
  ModelSettingsHistoryEntry,
} from "./types";

const CANDIDATES = "storeEvalCandidates";
const COMPETITORS = "storeEvalCompetitors";
const ADMIN_DONG_REFERENCES = "storeEvalAdminDongReferences";
const DEMAND_POINTS = "storeEvalDemandPoints";
const MARKET_DATA_UPLOADS = "storeEvalMarketDataUploads";
const LOCATION_EVALS = "storeEvalLocationEvaluations";
const RESULTS = "storeEvalResults";
const SETTINGS = "storeEvalSettings";
const SETTINGS_HISTORY = "storeEvalSettingsHistory";
const EXISTING_STORES = "storeEvalExistingStores";
const EXISTING_STORE_SALES = "storeEvalExistingStoreSales";
const AUDIT_LOG = "storeEvalAuditLog";
const RESTORE_LOG = "storeEvalRestoreLog";
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
  entityType: "candidate" | "competitor" | "locationEvaluation" | "evaluationResult" | "modelSettings" | "existingStore";
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

/**
 * 후보지 본체(storeEvalCandidates)만 지운다. candidateCode로 딸려 있는 storeEvalResults/
 * storeEvalAdminDongReferences/storeEvalDemandPoints/storeEvalMarketDataUploads는 firestore.rules가
 * 클라이언트 delete를 의도적으로 막아둬서(재계산 이력 보존, 서버 전용 쓰기) 여기서 지울 수 없다 —
 * 화면(candidates/page.tsx)은 이 함수 대신 전체 컬렉션을 함께 지우는
 * POST /api/store-eval/delete-candidate(firebase-admin)를 쓴다. 이 함수는 다른 용도로 후보지
 * 본체만 지워야 할 때를 위해 남겨둔다.
 */
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
/**
 * 2026-08-20: Competitor.surveyState 필드를 investigationStatus로 개명했다. 개명 전에 저장된
 * 문서는 investigationStatus가 없고 surveyState만 있으므로, 읽어올 때 옮겨 담아 하위호환한다.
 */
function migrateCompetitorInvestigationStatus(data: Record<string, unknown>): Competitor {
  if (data.investigationStatus == null && data.surveyState != null) {
    return { ...data, investigationStatus: data.surveyState } as Competitor;
  }
  return data as Competitor;
}

export async function listCompetitors(candidateCode: string): Promise<Competitor[]> {
  const snap = await getDocs(query(collection(requireDb(), COMPETITORS), where("candidateCode", "==", candidateCode)));
  return snap.docs.map((d) => migrateCompetitorInvestigationStatus(d.data()));
}

/** 백업 전용 — 후보지 구분 없이 전체 경쟁점 문서를 그대로 가져온다(개수가 많지 않아 컬렉션 통째로 조회). */
export async function listAllCompetitors(): Promise<Competitor[]> {
  const snap = await getDocs(collection(requireDb(), COMPETITORS));
  return snap.docs.map((d) => migrateCompetitorInvestigationStatus(d.data()));
}

/** 백업 전용 — 전체 입지동선평가 문서를 그대로 가져온다. */
export async function listAllLocationEvaluations(): Promise<LocationEvaluation[]> {
  const snap = await getDocs(collection(requireDb(), LOCATION_EVALS));
  return snap.docs.map((d) => d.data() as LocationEvaluation);
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
// 상권자료 자동수집 1단계 — 행정구역 참고자료 / 수요거점 (읽기 전용, 쓰기는
// /api/store-eval/collect-market-data가 firebase-admin으로 처리한다)
// ---------------------------------------------------------------------------
export async function getAdminDongReference(candidateCode: string): Promise<AdminDongReference | null> {
  const snap = await getDoc(doc(requireDb(), ADMIN_DONG_REFERENCES, candidateCode));
  return snap.exists() ? (snap.data() as AdminDongReference) : null;
}

export async function listDemandPoints(candidateCode: string): Promise<DemandPoint[]> {
  const snap = await getDocs(query(collection(requireDb(), DEMAND_POINTS), where("candidateCode", "==", candidateCode)));
  return snap.docs.map((d) => d.data() as DemandPoint);
}

/** 수요거점을 화면에서 확인했다는 표시만 남긴다(내용 자체는 자동수집 그대로 - 사람이 값을 고치지 않음). */
export async function confirmDemandPoint(id: string): Promise<void> {
  await setDoc(doc(requireDb(), DEMAND_POINTS, id), { confirmed: true }, { merge: true });
}

export async function deleteDemandPoint(id: string): Promise<void> {
  await deleteDoc(doc(requireDb(), DEMAND_POINTS, id));
}

// ---------------------------------------------------------------------------
// 상권자료 자동수집 2단계 — SGIS/소상공인365 반자동 업로드 이력(출처 추적, 불변 로그)
// ---------------------------------------------------------------------------
export async function listMarketDataUploads(candidateCode: string): Promise<MarketDataUpload[]> {
  // where절 하나만 쓰면 복합 인덱스가 필요 없다 - 업로드 수가 후보지당 몇 건뿐이라 정렬은 JS에서 한다.
  const snap = await getDocs(query(collection(requireDb(), MARKET_DATA_UPLOADS), where("candidateCode", "==", candidateCode)));
  return snap.docs.map((d) => d.data() as MarketDataUpload).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function saveMarketDataUpload(upload: MarketDataUpload): Promise<void> {
  await setDoc(doc(requireDb(), MARKET_DATA_UPLOADS, upload.id), sanitize(upload));
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
  if (!snap.exists()) return null;
  // 2026-08-28 — interiorWeights처럼 새로 추가된 필드가 아예 없는 옛 Firestore 문서를 만나도
  // 죽지 않도록 기본값과 얕은 병합한다(문서에 있는 값은 그대로 쓰고, 없는 최상위 필드만 기본값).
  return { ...defaultModelSettings(), ...(snap.data() as ModelSettings) };
}

export async function saveModelSettings(settings: ModelSettings, actor: string | null, reason: string | null = null): Promise<void> {
  const before = await getModelSettings();
  await setDoc(doc(requireDb(), SETTINGS, "current"), sanitize({ ...settings, updatedAt: Date.now(), updatedBy: actor }));
  if (before) {
    const historyId = `${Date.now()}`;
    const historyEntry: ModelSettingsHistoryEntry = { id: historyId, changedAt: Date.now(), changedBy: actor, before, after: settings, reason };
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

export async function getExistingStore(storeCode: string): Promise<ExistingStore | null> {
  const snap = await getDoc(doc(requireDb(), EXISTING_STORES, storeCode));
  return snap.exists() ? (snap.data() as ExistingStore) : null;
}

/**
 * 후보지코드로 이미 전환된 기존 가맹점을 찾는다. 전환 시점에 실제 가맹점코드(후보지코드와
 * 다를 수 있음 - 계약 확정 후 부여되는 정식 코드가 따로 있는 업무 구조, 2026-08-22 확인)를
 * 입력받게 되면서, "이미 전환됐는지" 판정을 더 이상 storeCode===candidateCode로 가정할 수 없다.
 * originCandidateCode로 역조회한다(가맹점코드가 후보지코드와 같아도, 달라도 항상 이 필드로 찾음).
 */
export async function findExistingStoreByOriginCandidate(candidateCode: string): Promise<ExistingStore | null> {
  const snap = await getDocs(query(collection(requireDb(), EXISTING_STORES), where("originCandidateCode", "==", candidateCode)));
  return snap.empty ? null : (snap.docs[0].data() as ExistingStore);
}

export async function deleteExistingStore(storeCode: string, actor: string | null): Promise<void> {
  const ref = doc(requireDb(), EXISTING_STORES, storeCode);
  const before = await getDoc(ref);
  await deleteDoc(ref);
  await writeAuditLog({ entityType: "existingStore", entityId: storeCode, action: "삭제", before: before.exists() ? before.data() : null, after: null, actor });
}

// ---------------------------------------------------------------------------
// 03_회원정보입력 (ExistingStoreMemberSnapshot, storeCode+snapshotDate로 1:N 스냅샷 누적)
// calc.ts 계산에는 쓰지 않는 참고 데이터다(docs/data-issues.md #4) - 12개월 미만 매장 위주로
// 계속 갱신한다는 전제로 화면에서 자유롭게 추가한다.
// ---------------------------------------------------------------------------
const EXISTING_STORE_MEMBERS = "storeEvalExistingStoreMembers";

export async function listExistingStoreMembers(storeCode?: string): Promise<ExistingStoreMemberSnapshot[]> {
  const base = collection(requireDb(), EXISTING_STORE_MEMBERS);
  const snap = await getDocs(storeCode ? query(base, where("storeCode", "==", storeCode)) : base);
  return snap.docs.map((d) => d.data() as ExistingStoreMemberSnapshot);
}

export async function upsertExistingStoreMemberSnapshot(snapshot: ExistingStoreMemberSnapshot): Promise<void> {
  const id = `${snapshot.storeCode}_${snapshot.snapshotDate}`;
  await setDoc(doc(requireDb(), EXISTING_STORE_MEMBERS, id), sanitize(snapshot));
}

// ---------------------------------------------------------------------------
// 신규 가맹점 오픈 → 기존 가맹점으로 전환
// 후보지로 평가받아 오픈까지 간 매장은 07/05/09 입력값을 다시 타이핑할 필요 없이 그대로
// 옮겨 기존 가맹점 마스터를 만든다. Google Sheet 없이도 이 경로 하나로 신규 매장이 계속
// 쌓이도록 하기 위한 구조다.
// ---------------------------------------------------------------------------
export async function convertCandidateToExistingStore(input: {
  candidate: CandidateInput;
  competitors: Competitor[];
  locationEvaluation: LocationEvaluation | null;
  // 2026-08-21 추가 — 전환하는 그 순간 화면에 보이던 예측값을 스냅샷으로 동결해 둔다("후보지평가
  // → 오픈 → 실제매출로 검증" 흐름을 잇기 위함). storeEvalResults는 이후 재계산되며 덮어써지므로
  // 이 시점에 넘겨받은 값만이 "그때 본 예측"의 유일한 기록이다. 없으면(로딩 실패 등) null로 두고
  // 예측값 없이 연결만 한다 - 나중에 linkExistingStoreToCandidate로 다시 채울 수는 없다(재계산
  // 금지 원칙과 같은 이유로, 지나간 예측값을 사후에 지어내지 않는다).
  evaluationResult: EvaluationResult | null;
  // 계약 확정 후 부여되는 정식 가맹점코드 - 후보지코드(N001 등)와 다른 게 정상적인 업무 구조다
  // (2026-08-22 확인). 안 주어지면 이전처럼 후보지코드를 그대로 쓴다(하위호환).
  storeCode?: string;
  actor: string | null;
}): Promise<ExistingStore> {
  const { candidate: c, competitors, locationEvaluation: loc, evaluationResult, actor } = input;
  const finalStoreCode = input.storeCode?.trim() || c.code;
  const now = Date.now();

  const store: ExistingStore = {
    storeCode: finalStoreCode,
    storeName: c.name,
    pcCount: c.expectedPcCount,
    evaluationPcCount: null, // 전환 시점 pcCount가 곧 오픈 초기 대수이므로 별도값 불필요 - 이후 대수가 늘면 사용자가 채운다.
    floor: c.floor,
    groundLevel: c.groundLevel,
    openedAt: null, // 실제 오픈일은 전환 직후 화면에서 입력해야 한다 (평가 단계엔 확정일이 없음)
    franchiseStatus: "정상",
    excludedFromModel: false,
    excludedReason: null,
    v61Predicted: null,
    referenceMarketDemand: null,
    // originCandidateCode는 항상 후보지코드(c.code)다 - storeCode가 달라져도 이 필드로 후보지
    // 평가 당시의 경쟁점/입지평가 데이터(candidateCode로 저장돼 있음)를 계속 찾아올 수 있다.
    originCandidateCode: c.code,
    predictedAtConversion: evaluationResult
      ? {
          candidateCode: evaluationResult.candidateCode,
          v61Baseline: evaluationResult.v61Baseline,
          v61ModelLabel: evaluationResult.v61ModelLabel,
          v61TrainingSampleCount: evaluationResult.v61TrainingSampleCount,
          v62Rate: evaluationResult.v62Rate,
          v62Final: evaluationResult.v62Final,
          conservativeSales: evaluationResult.conservativeSales,
          upperSales: evaluationResult.upperSales,
          expectedPcCount: evaluationResult.expectedPcCount,
          hourlyRate: evaluationResult.hourlyRate,
          calculatedAt: evaluationResult.calculatedAt,
          linkedAt: now,
        }
      : null,
    brandType: loc?.brandType ?? null,
    specialDemandType: loc?.specialDemandType ?? null,
    specialDemandIntensity: loc?.specialDemandIntensity ?? null,
    validationUse: null,
    hourlyRate: c.hourlyRate,
    ownDemand: null, // 실측 가동률이 쌓이기 전까지는 계산하지 않는다 (04_점포평가요약!예측_자사수요와 동일 산식 필요)
    marketDemand: null,
    competitorIp: null,
    competitivenessScore: null,
    actualMonthlyRevenueAvg: null,
    completedMonths: 0,
    address: c.address,
    hasElevator: c.hasElevator,
    demographicsYear: c.demographicsYear,
    renovationYear: null,
    ownCpu: c.ownCpu,
    ownCpuTop1: c.ownCpuTop1,
    ownCpuTop2: c.ownCpuTop2,
    ownRam: c.ownRam,
    ownRamTop: c.ownRamTop,
    ownVgaBase: c.ownVgaBase,
    ownVgaTop: c.ownVgaTop,
    ownVgaTop2: c.ownVgaTop2,
    ownSingleSeatCount: c.ownSingleSeatCount,
    ownRoom1: c.ownRoom1,
    ownRoom2: c.ownRoom2,
    ownTeamRoom: c.ownTeamRoom,
    ownCoupleZone: c.ownCoupleZone,
    ownVipZone: c.ownVipZone,
    ownFriendsZone: c.ownFriendsZone,
    ownFirstClassZone: c.ownFirstClassZone,
    ownTeamRoomTotalSeats: c.ownTeamRoomTotalSeats,
    ownTeamRoomTotalSeatsBasis: c.ownTeamRoomTotalSeatsBasis,
    ownManagementScore: c.ownManagementScore,
    // 2026-08-27 확인 — 후보지에서 빈칸이던 값(null)은 여기서도 null 그대로 넘어온다. 후보지
    // 평가 때는 빈칸이 5점(신규후보지 기본값)으로 계산됐지만, 전환 후 이 매장을 백테스트할 땐
    // EXISTING_STORE_FACILITY_DEFAULTS(4점, 원본 시트 규칙)로 채워진다 — 의도된 것이다. 백테스트는
    // "이 매장이 후보지였을 때 얼마로 추정됐는지"가 아니라 "다른 91개 기존 가맹점과 같은 기준으로
    // 비교했을 때 어떤지"가 목적이라, 전환 출처와 무관하게 전부 원본 규칙을 따라야 한다.
    ownFoodScore: c.ownFoodScore,
    ownInteriorScore: c.ownInteriorScore,
    ownMonitorBase: c.ownMonitorBase,
    ownMonitorTop: c.ownMonitorTop,
    ownFoodBrand: c.ownFoodBrand,
    ownInteriorLevelScore: c.ownInteriorLevelScore,
    ownInteriorConditionScore: c.ownInteriorConditionScore,
    ownSeatZoneScore: c.ownSeatZoneScore,
    ownComfortScore: c.ownComfortScore,
    pop500m: c.pop500m,
    area1kmKm2: c.area1kmKm2,
    pop1km: c.pop1km,
    male1kmRatio: c.male1kmRatio,
    age1km_0_9: c.age1km_0_9,
    age1km_10_19: c.age1km_10_19,
    age1km_20_29: c.age1km_20_29,
    age1km_30_39: c.age1km_30_39,
    age1km_40_49: c.age1km_40_49,
    age1km_50_59: c.age1km_50_59,
    age1km_60_69: c.age1km_60_69,
    age1km_70_79: c.age1km_70_79,
    age1km_80plus: c.age1km_80plus,
    floating500Avg: c.floating500Avg,
    floating500Male: c.floating500Male,
    floating500_10s: c.floating500_10s,
    floating500_20s: c.floating500_20s,
    floating500_30s: c.floating500_30s,
    floating500_40s: c.floating500_40s,
    floating500_50s: c.floating500_50s,
    floating500_60plus: c.floating500_60plus,
    operatingPcStores500m: c.operatingPcStores500m,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  };
  await upsertExistingStore(store);

  // 경쟁점/입지평가는 옮기지 않고 후보지코드(c.code)에 그대로 둔다 - storeCode가 후보지코드와
  // 달라져도(2026-08-22부터) originCandidateCode로 항상 되짚어 찾아올 수 있으므로 복사할
  // 필요가 없다(listCompetitors/getLocationEvaluation 호출부가 store.originCandidateCode를
  // 우선 쓰도록 되어 있다 - validation/page.tsx 참고).
  for (const comp of competitors) {
    await saveCompetitor({ ...comp, candidateCode: c.code }, actor);
  }

  await writeAuditLog({ entityType: "existingStore", entityId: finalStoreCode, action: "생성", before: null, after: store, actor });
  return store;
}

/**
 * 이미 등록된 기존 가맹점(이 전환 기능이 생기기 전에 만들어졌거나, 후보지평가 없이 매출DB
 * 자동감지로 등록된 매장)을 나중에라도 후보지코드와 수동으로 연결한다. 이름/주소로 자동
 * 추측하지 않고, 사용자가 직접 코드를 확인해서 입력하는 것만 받는다(오매칭 방지).
 * storeEvalResults에 그 후보지의 예측값 스냅샷이 아직 남아있으면 같이 채우고, 이미 재계산으로
 * 덮어써져서 없으면(evaluate.ts는 Result 탭을 열 때마다 재계산·덮어쓴다) 연결만 하고 예측값은
 * 지어내지 않는다.
 */
export async function linkExistingStoreToCandidate(
  storeCode: string,
  candidateCode: string,
  actor: string | null,
): Promise<ExistingStore> {
  const store = await getExistingStore(storeCode);
  if (!store) throw new Error(`기존 가맹점을 찾지 못했습니다: ${storeCode}`);
  const result = await getEvaluationResult(candidateCode);
  const now = Date.now();

  const updated: ExistingStore = {
    ...store,
    originCandidateCode: candidateCode,
    predictedAtConversion: result
      ? {
          candidateCode: result.candidateCode,
          v61Baseline: result.v61Baseline,
          v61ModelLabel: result.v61ModelLabel,
          v61TrainingSampleCount: result.v61TrainingSampleCount,
          v62Rate: result.v62Rate,
          v62Final: result.v62Final,
          conservativeSales: result.conservativeSales,
          upperSales: result.upperSales,
          expectedPcCount: result.expectedPcCount,
          hourlyRate: result.hourlyRate,
          calculatedAt: result.calculatedAt,
          linkedAt: now,
        }
      : null,
    updatedAt: now,
    updatedBy: actor,
  };
  await upsertExistingStore(updated);
  await writeAuditLog({ entityType: "existingStore", entityId: storeCode, action: "수정", before: store, after: updated, actor });
  return updated;
}

// ---------------------------------------------------------------------------
// 백업 복원 (요청사항 17) — backup.ts가 검증·미리보기·자동사전백업을 담당하고, 여기서는
// "이 문서들을 이 컬렉션에 그대로 덮어쓴다"는 실제 쓰기만 한다. 항상 upsert(merge 없는 set)만
// 하고 백업 파일에 없는 기존 문서는 절대 지우지 않는다 — "복원=병합"이 이 기능의 안전 경계다
// (전체 컬렉션을 지우고 다시 채우는 방식은 훨씬 위험해서 채택하지 않음).
const RESTORE_BATCH_LIMIT = 450; // Firestore batch 500건 제한에 여유를 둔 값(cronSync.ts와 동일 기준)

async function batchUpsert<T extends object>(collectionName: string, items: T[], idOf: (item: T) => string): Promise<number> {
  let written = 0;
  for (let i = 0; i < items.length; i += RESTORE_BATCH_LIMIT) {
    const chunk = items.slice(i, i + RESTORE_BATCH_LIMIT);
    const batch = writeBatch(requireDb());
    for (const item of chunk) {
      batch.set(doc(requireDb(), collectionName, idOf(item)), sanitize(item) as Record<string, unknown>);
      written++;
    }
    await batch.commit();
  }
  return written;
}

export type RestoreBackupPayload = {
  candidates: CandidateInput[];
  existingStores: ExistingStore[];
  existingStoreSales: ExistingStoreMonthlySales[];
  competitors: Competitor[];
  locationEvaluations: LocationEvaluation[];
  modelSettings: ModelSettings | null;
  modelSettingsHistory: ModelSettingsHistoryEntry[];
};

export type RestoreLogEntry = {
  id: string;
  restoredAt: number;
  actor: string | null;
  sourceExportedAt: string | null; // 백업 파일 자체의 exportedAt(어느 시점 스냅샷인지)
  success: boolean;
  counts: Record<string, number> | null; // 컬렉션별 upsert 건수(성공 시)
  error: string | null; // 실패 시 메시지
};

/** 백업 파일 내용을 그대로 각 컬렉션에 upsert한다. 실패해도 성공해도 항상 로그 1건을 남긴다. */
export async function restoreFromBackup(
  payload: RestoreBackupPayload,
  sourceExportedAt: string | null,
  actor: string | null,
): Promise<RestoreLogEntry> {
  const restoredAt = Date.now();
  const id = `${restoredAt}`;
  try {
    const counts: Record<string, number> = {};
    counts.candidates = await batchUpsert(CANDIDATES, payload.candidates, (c) => c.code);
    counts.existingStores = await batchUpsert(EXISTING_STORES, payload.existingStores, (s) => s.storeCode);
    counts.existingStoreSales = await batchUpsert(EXISTING_STORE_SALES, payload.existingStoreSales, (s) => `${s.storeCode}_${s.yearMonth}`);
    counts.competitors = await batchUpsert(COMPETITORS, payload.competitors, (c) => c.id);
    counts.locationEvaluations = await batchUpsert(LOCATION_EVALS, payload.locationEvaluations, (l) => l.candidateCode);
    counts.modelSettingsHistory = await batchUpsert(SETTINGS_HISTORY, payload.modelSettingsHistory, (h) => h.id);
    if (payload.modelSettings) {
      await setDoc(doc(requireDb(), SETTINGS, "current"), sanitize(payload.modelSettings));
      counts.modelSettings = 1;
    }
    const log: RestoreLogEntry = { id, restoredAt, actor, sourceExportedAt, success: true, counts, error: null };
    await setDoc(doc(requireDb(), RESTORE_LOG, id), sanitize(log));
    return log;
  } catch (err) {
    const log: RestoreLogEntry = {
      id,
      restoredAt,
      actor,
      sourceExportedAt,
      success: false,
      counts: null,
      error: err instanceof Error ? err.message : String(err),
    };
    // 로그 자체 쓰기도 실패할 수 있으니(예: 이미 Firestore 연결이 끊긴 상황) 조용히 무시하고
    // 원래 에러를 그대로 던진다 — 로그 실패로 원인이 가려지면 안 된다.
    await setDoc(doc(requireDb(), RESTORE_LOG, id), sanitize(log)).catch(() => {});
    throw err;
  }
}

export async function listRestoreLog(): Promise<RestoreLogEntry[]> {
  const snap = await getDocs(query(collection(requireDb(), RESTORE_LOG), orderBy("restoredAt", "desc")));
  return snap.docs.map((d) => d.data() as RestoreLogEntry);
}

export { serverTimestamp };
