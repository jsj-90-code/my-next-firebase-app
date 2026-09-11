// 데이터 백업/복원 - 점포평가 시스템의 전체 데이터를 JSON 하나로 모아 다운로드하거나,
// 그 JSON 파일로 되돌린다. store.ts에 이미 있는 조회/쓰기 함수만 사용한다(중복 구현 금지).
//
// 복원 안전 원칙(요청사항 17) — 이 파일이 지키는 것:
//   1) 복원은 항상 upsert(병합)만 한다 — 백업 파일에 없는 기존 문서를 지우지 않는다.
//   2) 복원 전에 반드시 "지금 상태"를 자동으로 한 번 더 백업(다운로드)한다.
//   3) 실행 전 미리보기(몇 건 추가/몇 건 덮어쓸지)를 반드시 보여준다.
//   4) 스키마 버전이 다르거나 필수 항목이 없는 파일은 거부한다.
//   5) 성공/실패 여부와 무관하게 항상 로그 1건을 남긴다(store.ts의 restoreFromBackup이 처리).

import { listAllProjects, saveProject } from "../seatLayout/store";
import { loadSeatLayoutSettings, saveSeatLayoutSettings, type SeatLayoutSettings } from "../seatLayout/settings";
import type { SeatLayoutProject } from "../seatLayout/types";
import {
  getCandidateCodeCounter,
  getModelSettings,
  listAllCompetitors,
  listAllLocationEvaluations,
  listAllMarketDataUploads,
  listCandidates,
  listEvaluationResults,
  listExistingStores,
  listExistingStoreSales,
  listModelSettingsHistory,
  raiseCandidateCodeCounter,
  restoreFromBackup,
  restoreMarketDataUploads,
  type RestoreBackupPayload,
  type RestoreLogEntry,
} from "./store";
import type { MarketDataUpload } from "./types";
// v2(2026-09-11) — 담는 범위를 넓혔다. 예전엔 7종만 담겨서 **좌석배치도가 통째로 백업 밖**이었고,
// 후보지코드 카운터도 안 들어가 있었다(카운터를 잃으면 N001부터 다시 발급돼 기존 후보지를
// 덮어쓴다). v1 파일도 그대로 복원된다 — 새 항목이 없으면 그 부분만 건너뛴다.
export const BACKUP_SCHEMA_VERSION = 2;
const SUPPORTED_SCHEMA_VERSIONS = [1, 2];

export type StoreEvalBackupPayload = RestoreBackupPayload & {
  schemaVersion: number;
  exportedAt: string;
  /** v2부터 — 되돌릴 수 있는 것들. evaluationResults는 RestoreBackupPayload 쪽에 있다. */
  seatLayoutProjects?: SeatLayoutProject[];
  seatLayoutSettings?: SeatLayoutSettings | null;
  candidateCodeCounter?: number | null;
  /**
   * 2026-09-11 추가 — 상권자료 업로드 이력. **재생성이 안 되는 유일한 항목**이라 담는다
   * ("어느 파일에서 언제 뽑았는지"의 기록). 복원은 없는 문서만 만든다(불변 로그라 덮어쓰기 금지).
   *
   * 나머지 미포함 4종은 이유가 있어 뺀다 — 수요거점·행정구역 참고자료는 **자동 재수집**이
   * 되고 보안규칙이 클라이언트 create를 막는다. 감사 로그는 **복원하면 안 되는** 성격이고
   * 1.2MB로 백업 파일 크기를 배로 만든다. 관리자 목록은 Firebase 콘솔에서 다시 넣는다.
   */
  marketDataUploads?: MarketDataUpload[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function backupFileName(now: Date): string {
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `점포평가_백업_${y}${m}${d}_${hh}${mm}.json`;
}

async function buildBackupPayload(): Promise<StoreEvalBackupPayload> {
  const [
    candidates,
    existingStores,
    existingStoreSales,
    competitors,
    locationEvaluations,
    modelSettings,
    modelSettingsHistory,
    seatLayoutProjects,
    seatLayoutSettings,
    candidateCodeCounter,
    evaluationResults,
    marketDataUploads,
  ] = await Promise.all([
    listCandidates(),
    listExistingStores(),
    listExistingStoreSales(),
    listAllCompetitors(),
    listAllLocationEvaluations(),
    getModelSettings(),
    listModelSettingsHistory(),
    listAllProjects(),
    loadSeatLayoutSettings(),
    getCandidateCodeCounter(),
    listEvaluationResults(),
    listAllMarketDataUploads(),
  ]);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    candidates,
    existingStores,
    existingStoreSales,
    competitors,
    locationEvaluations,
    modelSettings,
    modelSettingsHistory,
    seatLayoutProjects,
    seatLayoutSettings,
    candidateCodeCounter,
    evaluationResults,
    marketDataUploads,
  };
}

function downloadJson(payload: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 신규후보지/기존 가맹점/매출/경쟁점/입지동선평가/운영설정과 변경이력 전체를 JSON 파일로 다운로드한다. */
export async function exportFullBackup(): Promise<void> {
  const payload = await buildBackupPayload();
  downloadJson(payload, backupFileName(new Date()));
}

const REQUIRED_ARRAY_KEYS = [
  "candidates",
  "existingStores",
  "existingStoreSales",
  "competitors",
  "locationEvaluations",
  "modelSettingsHistory",
] as const;

export type BackupValidation =
  | { valid: true; payload: StoreEvalBackupPayload; counts: Record<string, number> }
  | { valid: false; errors: string[] };

/** 업로드된 JSON이 이 도구가 만든 백업 파일이 맞는지 확인한다. 지어내지 않고 형태만 검사. */
export function validateBackupPayload(raw: unknown): BackupValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["파일이 올바른 JSON 객체가 아닙니다."] };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "number") {
    errors.push("schemaVersion 필드가 없습니다 — 이 화면에서 만든 백업 파일이 맞는지 확인해주세요.");
  } else if (!SUPPORTED_SCHEMA_VERSIONS.includes(obj.schemaVersion)) {
    // v1 파일도 계속 받는다 — 예전 백업이 갑자기 못 쓰게 되면 그게 더 큰 사고다.
    errors.push(
      `지원하지 않는 백업 버전입니다(파일: v${obj.schemaVersion}, 현재 지원: v${SUPPORTED_SCHEMA_VERSIONS.join("·")}).`,
    );
  }
  if (typeof obj.exportedAt !== "string") errors.push("exportedAt(백업 생성 시각) 필드가 없습니다.");
  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(obj[key])) errors.push(`"${key}" 항목이 없거나 배열이 아닙니다.`);
  }
  if (errors.length > 0) return { valid: false, errors };

  const payload = obj as unknown as StoreEvalBackupPayload;
  const counts: Record<string, number> = {};
  for (const key of REQUIRED_ARRAY_KEYS) counts[key] = (obj[key] as unknown[]).length;
  counts.modelSettings = obj.modelSettings ? 1 : 0;
  // v2 항목은 없을 수 있다(v1 파일). 있을 때만 센다.
  if (Array.isArray(obj.seatLayoutProjects)) counts.seatLayoutProjects = obj.seatLayoutProjects.length;
  if (obj.seatLayoutSettings) counts.seatLayoutSettings = 1;
  if (Array.isArray(obj.evaluationResults)) counts.evaluationResults = obj.evaluationResults.length;
  if (Array.isArray(obj.marketDataUploads)) counts.marketDataUploads = obj.marketDataUploads.length;
  if (typeof obj.candidateCodeCounter === "number") counts.candidateCodeCounter = 1;
  return { valid: true, payload, counts };
}

export type RestorePreviewItem = { label: string; toAdd: number; toUpdate: number; currentTotal: number };

/** 백업 파일 vs 현재 라이브 데이터를 문서ID 기준으로 대조해서 "몇 건 추가/몇 건 덮어쓸지" 미리 보여준다. */
export async function computeRestorePreview(payload: StoreEvalBackupPayload): Promise<RestorePreviewItem[]> {
  const [currentCandidates, currentStores, currentCompetitors, currentLocEvals] = await Promise.all([
    listCandidates(),
    listExistingStores(),
    listAllCompetitors(),
    listAllLocationEvaluations(),
  ]);

  function diff(label: string, backupIds: string[], currentIds: string[]): RestorePreviewItem {
    const currentSet = new Set(currentIds);
    let toAdd = 0;
    let toUpdate = 0;
    for (const id of backupIds) {
      if (currentSet.has(id)) toUpdate++;
      else toAdd++;
    }
    return { label, toAdd, toUpdate, currentTotal: currentSet.size };
  }

  const items: RestorePreviewItem[] = [
    diff("신규후보지", payload.candidates.map((c) => c.code), currentCandidates.map((c) => c.code)),
    diff("기존 가맹점", payload.existingStores.map((s) => s.storeCode), currentStores.map((s) => s.storeCode)),
    diff("경쟁점", payload.competitors.map((c) => c.id), currentCompetitors.map((c) => c.id)),
    diff("입지동선평가", payload.locationEvaluations.map((l) => l.candidateCode), currentLocEvals.map((l) => l.candidateCode)),
    { label: "매출(월별)", toAdd: payload.existingStoreSales.length, toUpdate: 0, currentTotal: -1 },
    { label: "운영설정 변경이력", toAdd: payload.modelSettingsHistory.length, toUpdate: 0, currentTotal: -1 },
  ];

  // v2 항목. v1 파일에는 없으므로 있을 때만 줄을 추가한다 — 없는 항목을 "0건"으로 보여주면
  // "복원했는데 좌석배치도가 안 돌아왔다"는 오해를 만든다.
  if (payload.seatLayoutProjects) {
    items.push({ label: "좌석배치도 프로젝트", toAdd: payload.seatLayoutProjects.length, toUpdate: 0, currentTotal: -1 });
  }
  if (payload.seatLayoutSettings) {
    items.push({ label: "좌석배치도 설정", toAdd: 1, toUpdate: 0, currentTotal: -1 });
  }
  if (payload.evaluationResults) {
    items.push({ label: "평가 결과", toAdd: payload.evaluationResults.length, toUpdate: 0, currentTotal: -1 });
  }
  if (typeof payload.candidateCodeCounter === "number") {
    items.push({ label: `후보지코드 카운터(N${String(payload.candidateCodeCounter).padStart(3, "0")}까지 발급됨)`, toAdd: 1, toUpdate: 0, currentTotal: -1 });
  }
  if (payload.marketDataUploads) {
    items.push({ label: "상권자료 업로드 이력(없는 것만 추가)", toAdd: payload.marketDataUploads.length, toUpdate: 0, currentTotal: -1 });
  }
  return items;
}

/**
 * 복원 실행. 반드시 이 함수 호출 "직전에" 호출부가 exportFullBackup()으로 사전 백업을 먼저
 * 받게 한다(이 함수 자체는 강제하지 않음 — UI에서 순서를 보장한다, backup/page.tsx 참고).
 */
export async function performRestore(payload: StoreEvalBackupPayload, actor: string | null): Promise<RestoreLogEntry> {
  const log = await restoreFromBackup(payload, payload.exportedAt, actor);
  // v2 항목은 storeEval 컬렉션 밖(좌석배치도)이거나 성격이 달라서(카운터는 "더 큰 값만"
  // 올려야 한다) restoreFromBackup 안에 넣지 않고 여기서 이어서 처리한다. 위에서 본체 복원이
  // 실패하면 예외가 나서 여기까지 오지 않는다.
  await restoreExtras(payload);
  return log;
}

/** v2에서 추가된 항목 복원. v1 파일이면 아무것도 하지 않는다. */
async function restoreExtras(payload: StoreEvalBackupPayload): Promise<void> {
  if (payload.seatLayoutProjects?.length) {
    for (const project of payload.seatLayoutProjects) {
      // saveProject가 updatedAt/updatedBy를 지금 시각으로 덮으므로 원래 값을 다시 얹는다 —
      // 복원은 "그때 상태로 되돌리는 것"이지 "지금 저장하는 것"이 아니다.
      await saveProject(project, project.updatedBy ?? "restore");
    }
  }
  if (payload.seatLayoutSettings) {
    await saveSeatLayoutSettings(payload.seatLayoutSettings, payload.seatLayoutSettings.updatedBy ?? "restore");
  }
  if (typeof payload.candidateCodeCounter === "number") {
    await raiseCandidateCodeCounter(payload.candidateCodeCounter);
  }
  if (payload.marketDataUploads?.length) {
    await restoreMarketDataUploads(payload.marketDataUploads);
  }
}
