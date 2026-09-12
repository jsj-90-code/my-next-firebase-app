// 검증 스냅샷 로더 (2026-09-13 신설).
//
// `.local-tools/validation-snapshot.json`은 gitignore라 **PC를 옮기면 없다.** 이 파일을 읽는
// 정식 테스트가 셋 있는데(storedAccuracyParity / weightsCandidateParity / competitorMonotonicity),
// 전부 `existsSync(...) ? describe : describe.skip` 으로 막아뒀는데도 **실제로는 터졌다.**
//
// 이유: vitest는 `describe.skip`이어도 **콜백을 수집 단계에서 실행한다.** 콜백 첫 줄의
// `readFileSync`가 그대로 돌아 ENOENT로 파일 전체가 실패했다. 회사 PC에는 스냅샷이 있어서
// 이 구멍이 안 보였고, 2026-09-13 집 PC에서 테스트 3건이 계속 실패하는 형태로 드러났다.
//
// 그래서 "없으면 빈 스냅샷"을 돌려주는 로더로 묶는다. skip된 콜백이 빈 배열 위에서 조용히
// 돌고, 테스트 자체는 실행되지 않는다.

import { existsSync, readFileSync } from "node:fs";

export const VALIDATION_SNAPSHOT_PATH = ".local-tools/validation-snapshot.json";

/** 세 테스트가 쓰는 필드의 합집합. 각 테스트는 이 중 필요한 것만 골라 쓴다. */
export type ValidationSnapshot = {
  fetchedAt: string;
  candidates: never[] | unknown[];
  results: unknown[];
  existingStores: unknown[];
  competitors: Record<string, unknown>[];
  locationEvaluations: unknown[];
  sales: unknown[];
  settings: Record<string, unknown> | null;
  storedAccuracy: Record<string, unknown> | null;
};

const EMPTY: ValidationSnapshot = {
  fetchedAt: "",
  candidates: [],
  results: [],
  existingStores: [],
  competitors: [],
  locationEvaluations: [],
  sales: [],
  settings: null,
  storedAccuracy: null,
};

export function hasValidationSnapshot(): boolean {
  return existsSync(VALIDATION_SNAPSHOT_PATH);
}

/**
 * 스냅샷을 읽는다. **없으면 던지지 않고 빈 구조를 돌려준다** — 위 주석의 describe.skip 함정 때문.
 * 호출부는 `hasValidationSnapshot()`으로 describe/describe.skip을 고르고, 본문에서는 이 함수가
 * 준 값을 그대로 쓰면 된다.
 *
 * 스냅샷을 만드는 방법은 `.local-tools/dump-validation-snapshot.mjs`(gitignore)에 있고, 그 스크립트
 * 소스는 docs/releases/2026-09-13-validation-recovery.md에 보존해뒀다.
 */
export function loadValidationSnapshot<T = ValidationSnapshot>(): T {
  if (!hasValidationSnapshot()) return EMPTY as unknown as T;
  return JSON.parse(readFileSync(VALIDATION_SNAPSHOT_PATH, "utf8")) as T;
}
