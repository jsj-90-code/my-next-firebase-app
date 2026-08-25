import { describe, expect, it } from "vitest";
import { BACKUP_SCHEMA_VERSION, validateBackupPayload } from "./backup";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: "2026-08-25T00:00:00.000Z",
    candidates: [],
    existingStores: [],
    existingStoreSales: [],
    competitors: [],
    locationEvaluations: [],
    modelSettings: null,
    modelSettingsHistory: [],
    ...overrides,
  };
}

describe("validateBackupPayload", () => {
  it("정상적인 백업 파일은 통과하고 건수를 집계한다", () => {
    const result = validateBackupPayload(
      validPayload({ candidates: [{ code: "N001" }, { code: "N002" }] }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.counts.candidates).toBe(2);
      expect(result.counts.modelSettings).toBe(0);
    }
  });

  it("객체가 아니면 거부한다", () => {
    expect(validateBackupPayload(null).valid).toBe(false);
    expect(validateBackupPayload("문자열").valid).toBe(false);
    expect(validateBackupPayload([1, 2, 3]).valid).toBe(false);
  });

  it("schemaVersion이 없거나 다르면 거부한다(지어낸 버전으로 통과시키지 않음)", () => {
    const noVersion = validPayload();
    delete (noVersion as Record<string, unknown>).schemaVersion;
    expect(validateBackupPayload(noVersion).valid).toBe(false);

    const wrongVersion = validPayload({ schemaVersion: 999 });
    const result = validateBackupPayload(wrongVersion);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("지원하지 않는 백업 버전"))).toBe(true);
  });

  it("필수 배열 항목이 없거나 배열이 아니면 거부한다", () => {
    const missing = validPayload();
    delete (missing as Record<string, unknown>).competitors;
    expect(validateBackupPayload(missing).valid).toBe(false);

    const wrongType = validPayload({ existingStores: "이건 배열이 아님" });
    expect(validateBackupPayload(wrongType).valid).toBe(false);
  });

  it("modelSettings가 null이어도 통과한다(설정을 아직 저장 안 한 상태의 정상 백업)", () => {
    expect(validateBackupPayload(validPayload({ modelSettings: null })).valid).toBe(true);
  });
});
