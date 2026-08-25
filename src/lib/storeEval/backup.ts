// 데이터 백업/복원 - 점포평가 시스템의 전체 데이터를 JSON 하나로 모아 다운로드하거나,
// 그 JSON 파일로 되돌린다. store.ts에 이미 있는 조회/쓰기 함수만 사용한다(중복 구현 금지).
//
// 복원 안전 원칙(요청사항 17) — 이 파일이 지키는 것:
//   1) 복원은 항상 upsert(병합)만 한다 — 백업 파일에 없는 기존 문서를 지우지 않는다.
//   2) 복원 전에 반드시 "지금 상태"를 자동으로 한 번 더 백업(다운로드)한다.
//   3) 실행 전 미리보기(몇 건 추가/몇 건 덮어쓸지)를 반드시 보여준다.
//   4) 스키마 버전이 다르거나 필수 항목이 없는 파일은 거부한다.
//   5) 성공/실패 여부와 무관하게 항상 로그 1건을 남긴다(store.ts의 restoreFromBackup이 처리).

import {
  getModelSettings,
  listAllCompetitors,
  listAllLocationEvaluations,
  listCandidates,
  listExistingStores,
  listExistingStoreSales,
  listModelSettingsHistory,
  restoreFromBackup,
  type RestoreBackupPayload,
  type RestoreLogEntry,
} from "./store";

export const BACKUP_SCHEMA_VERSION = 1;

export type StoreEvalBackupPayload = RestoreBackupPayload & {
  schemaVersion: number;
  exportedAt: string;
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
  const [candidates, existingStores, existingStoreSales, competitors, locationEvaluations, modelSettings, modelSettingsHistory] =
    await Promise.all([
      listCandidates(),
      listExistingStores(),
      listExistingStoreSales(),
      listAllCompetitors(),
      listAllLocationEvaluations(),
      getModelSettings(),
      listModelSettingsHistory(),
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
  } else if (obj.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push(`지원하지 않는 백업 버전입니다(파일: v${obj.schemaVersion}, 현재 지원: v${BACKUP_SCHEMA_VERSION}).`);
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

  return [
    diff("신규후보지", payload.candidates.map((c) => c.code), currentCandidates.map((c) => c.code)),
    diff("기존 가맹점", payload.existingStores.map((s) => s.storeCode), currentStores.map((s) => s.storeCode)),
    diff("경쟁점", payload.competitors.map((c) => c.id), currentCompetitors.map((c) => c.id)),
    diff("입지동선평가", payload.locationEvaluations.map((l) => l.candidateCode), currentLocEvals.map((l) => l.candidateCode)),
    { label: "매출(월별)", toAdd: payload.existingStoreSales.length, toUpdate: 0, currentTotal: -1 },
    { label: "운영설정 변경이력", toAdd: payload.modelSettingsHistory.length, toUpdate: 0, currentTotal: -1 },
  ];
}

/**
 * 복원 실행. 반드시 이 함수 호출 "직전에" 호출부가 exportFullBackup()으로 사전 백업을 먼저
 * 받게 한다(이 함수 자체는 강제하지 않음 — UI에서 순서를 보장한다, backup/page.tsx 참고).
 */
export async function performRestore(payload: StoreEvalBackupPayload, actor: string | null): Promise<RestoreLogEntry> {
  return restoreFromBackup(payload, payload.exportedAt, actor);
}
