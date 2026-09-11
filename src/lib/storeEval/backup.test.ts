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

// v2(2026-09-11)에서 담는 범위를 넓혔다. 여기서 지켜야 하는 건 두 가지다 —
// ① 예전(v1) 백업 파일이 계속 복원될 것. 갑자기 못 쓰게 되면 그게 더 큰 사고다.
// ② v1 파일에 없는 항목을 "0건"으로 보여주지 말 것. "복원했는데 좌석배치도가 안 돌아왔다"는
//    오해를 만든다.
describe("백업 v2 — 넓어진 범위와 예전 파일 호환", () => {
  const v1 = () => {
    const p = validPayload({ schemaVersion: 1 });
    delete (p as Record<string, unknown>).seatLayoutProjects;
    return p;
  };

  it("예전 v1 파일도 그대로 통과한다", () => {
    expect(validateBackupPayload(v1()).valid).toBe(true);
  });

  it("v1 파일에는 새 항목을 아예 세지 않는다 (0건으로 보여주지 않는다)", () => {
    const result = validateBackupPayload(v1());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.counts).not.toHaveProperty("seatLayoutProjects");
      expect(result.counts).not.toHaveProperty("candidateCodeCounter");
    }
  });

  it("v2 파일은 새 항목까지 센다", () => {
    const result = validateBackupPayload(
      validPayload({
        seatLayoutProjects: [{ id: "a" }, { id: "b" }],
        seatLayoutSettings: { updatedAt: 1 },
        evaluationResults: [{ candidateCode: "N001" }],
        candidateCodeCounter: 12,
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.counts.seatLayoutProjects).toBe(2);
      expect(result.counts.seatLayoutSettings).toBe(1);
      expect(result.counts.evaluationResults).toBe(1);
      expect(result.counts.candidateCodeCounter).toBe(1);
    }
  });

  it("카운터가 0이어도 항목이 있으면 센다 (0은 '없음'이 아니다)", () => {
    const result = validateBackupPayload(validPayload({ candidateCodeCounter: 0 }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.counts.candidateCodeCounter).toBe(1);
  });

  it("현재 버전은 2다", () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(2);
  });

  it("v1·v2 말고는 여전히 거부한다", () => {
    expect(validateBackupPayload(validPayload({ schemaVersion: 3 })).valid).toBe(false);
    expect(validateBackupPayload(validPayload({ schemaVersion: 0 })).valid).toBe(false);
  });
});
