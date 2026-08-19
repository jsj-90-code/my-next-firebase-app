// 데이터 백업 - 점포평가 시스템의 전체 데이터를 JSON 하나로 모아 다운로드한다.
// store.ts에 이미 있는 조회 함수만 사용한다(중복 구현 금지).

import {
  getModelSettings,
  listCandidates,
  listExistingStores,
  listExistingStoreSales,
  listModelSettingsHistory,
} from "./store";

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

/** 후보지/기존 가맹점/매출/모델설정/설정이력 전체를 모아 JSON 파일로 다운로드한다. */
export async function exportFullBackup(): Promise<void> {
  const [candidates, existingStores, existingStoreSales, modelSettings, modelSettingsHistory] = await Promise.all([
    listCandidates(),
    listExistingStores(),
    listExistingStoreSales(),
    getModelSettings(),
    listModelSettingsHistory(),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    candidates,
    existingStores,
    existingStoreSales,
    modelSettings,
    modelSettingsHistory,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(new Date());
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
