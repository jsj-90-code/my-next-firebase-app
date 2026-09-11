// 복원은 이 앱에서 가장 위험한 동작이다(운영 데이터를 통째로 덮어쓴다). 라이브로 돌려볼 수
// 없으니 Firestore를 모킹해서 검증한다. 특히 **부분 실패**를 본다 — 컬렉션을 순차로 올리는
// 구조라 중간에 끊기면 부분 복원 상태로 남고, 그때 로그가 어디까지 갔는지 말해줘야 한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const committed: string[] = [];
const written: Record<string, unknown>[] = [];
let failOnCollection: string | null = null;

vi.mock("@/lib/firebase", () => ({ db: {} }));

vi.mock("firebase/firestore", () => {
  const makeBatch = () => {
    const staged: string[] = [];
    return {
      set: (ref: { _collection: string }) => { staged.push(ref._collection); },
      commit: async () => {
        for (const c of staged) {
          if (c === failOnCollection) throw new Error(`모의 실패: ${c}`);
          committed.push(c);
        }
      },
    };
  };
  return {
    collection: (_db: unknown, name: string) => ({ _collection: name }),
    doc: (_db: unknown, name: string, id: string) => ({ _collection: name, _id: id }),
    writeBatch: () => makeBatch(),
    setDoc: async (ref: { _collection: string }, data: Record<string, unknown>) => {
      if (ref._collection === failOnCollection) throw new Error(`모의 실패: ${ref._collection}`);
      written.push({ collection: ref._collection, data });
    },
    getDoc: async () => ({ exists: () => false, data: () => undefined }),
    getDocs: async () => ({ docs: [] }),
    query: () => ({}),
    orderBy: () => ({}),
    where: () => ({}),
    limit: () => ({}),
    deleteDoc: async () => {},
    runTransaction: async () => {},
    serverTimestamp: () => 0,
    Timestamp: {},
  };
});

const emptyPayload = () => ({
  candidates: [{ code: "N001" }, { code: "N002" }],
  existingStores: [{ storeCode: "S1" }],
  existingStoreSales: [{ storeCode: "S1", yearMonth: "2026-01" }],
  competitors: [{ id: "C1" }],
  locationEvaluations: [{ candidateCode: "N001" }],
  modelSettingsHistory: [{ id: "H1" }],
  modelSettings: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

beforeEach(() => {
  committed.length = 0;
  written.length = 0;
  failOnCollection = null;
});

describe("restoreFromBackup", () => {
  it("전부 성공하면 컬렉션별 건수를 기록한다", async () => {
    const { restoreFromBackup } = await import("./store");
    const log = await restoreFromBackup(emptyPayload(), "2026-09-11T00:00:00.000Z", "tester@isens.camp");
    expect(log.success).toBe(true);
    expect(log.counts).toMatchObject({
      candidates: 2, existingStores: 1, existingStoreSales: 1,
      competitors: 1, locationEvaluations: 1, modelSettingsHistory: 1,
    });
    expect(log.error).toBeNull();
  });

  // 핵심 — 중간에 끊겨도 "어디까지 올라갔는지"가 로그에 남아야 재실행 판단을 할 수 있다.
  it("중간에 실패하면 그때까지의 건수를 남긴다", async () => {
    const { restoreFromBackup } = await import("./store");
    failOnCollection = "storeEvalCompetitors";
    await expect(
      restoreFromBackup(emptyPayload(), null, "tester@isens.camp"),
    ).rejects.toThrow("모의 실패");

    const log = written.find((w) => w.collection === "storeEvalRestoreLog")?.data as {
      success: boolean; counts: Record<string, number> | null; error: string;
    };
    expect(log.success).toBe(false);
    // 경쟁점 앞의 세 컬렉션은 이미 올라갔다.
    expect(log.counts).toMatchObject({ candidates: 2, existingStores: 1, existingStoreSales: 1 });
    // 실패한 컬렉션과 그 뒤는 없다.
    expect(log.counts).not.toHaveProperty("competitors");
    expect(log.counts).not.toHaveProperty("locationEvaluations");
    expect(log.error).toContain("모의 실패");
  });

  it("첫 컬렉션에서 바로 실패하면 counts가 null이다", async () => {
    const { restoreFromBackup } = await import("./store");
    failOnCollection = "storeEvalCandidates";
    await expect(restoreFromBackup(emptyPayload(), null, null)).rejects.toThrow();

    const log = written.find((w) => w.collection === "storeEvalRestoreLog")?.data as { counts: unknown };
    expect(log.counts).toBeNull();
  });

  it("로그 쓰기까지 실패해도 원래 오류를 그대로 던진다", async () => {
    const { restoreFromBackup } = await import("./store");
    // 복원 로그 컬렉션 자체를 실패시키면, 로그를 못 남겨도 원인 오류가 가려지면 안 된다.
    failOnCollection = "storeEvalRestoreLog";
    await expect(restoreFromBackup(emptyPayload(), null, null)).rejects.toThrow("모의 실패");
  });
});

// v2에서 평가 결과도 복원 대상이 됐다. v1 파일에는 이 항목이 없으므로 "있을 때만" 써야 한다 —
// 빈 배열로 batch를 열면 쓸데없는 commit이 돌고, 없는 키를 읽으면 터진다.
describe("restoreFromBackup — 평가 결과(v2)", () => {
  it("평가 결과가 있으면 같이 복원하고 건수를 남긴다", async () => {
    const { restoreFromBackup } = await import("./store");
    const payload = emptyPayload();
    payload.evaluationResults = [{ candidateCode: "N001" }, { candidateCode: "N002" }];
    const log = await restoreFromBackup(payload, null, "tester@isens.camp");
    expect(log.success).toBe(true);
    expect(log.counts?.evaluationResults).toBe(2);
    expect(committed).toContain("storeEvalResults");
  });

  it("예전 v1 파일처럼 항목이 없으면 그 컬렉션은 아예 건드리지 않는다", async () => {
    const { restoreFromBackup } = await import("./store");
    const log = await restoreFromBackup(emptyPayload(), null, null);
    expect(log.success).toBe(true);
    expect(log.counts).not.toHaveProperty("evaluationResults");
    expect(committed).not.toContain("storeEvalResults");
  });

  it("빈 배열이면 쓰지 않는다", async () => {
    const { restoreFromBackup } = await import("./store");
    const payload = emptyPayload();
    payload.evaluationResults = [];
    const log = await restoreFromBackup(payload, null, null);
    expect(log.counts).not.toHaveProperty("evaluationResults");
    expect(committed).not.toContain("storeEvalResults");
  });
});
