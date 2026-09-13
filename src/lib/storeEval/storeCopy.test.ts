import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), runTransaction: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", async importOriginal => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  ...mocks,
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, name: string) => name,
  query: (value: unknown) => value,
}));

import { duplicateCandidate } from "./store";

describe("후보지 복사 시 담당자 판단 격리", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getDocs.mockResolvedValue({ docs: [] });
    mocks.setDoc.mockResolvedValue(undefined);
    mocks.runTransaction.mockResolvedValue(12);
  });

  it("입력은 복사하지만 다른 후보지의 판단 금액·근거·작성자는 승계하지 않는다", async () => {
    const source = { code: "N001", name: "원본", expectedPcCount: 100, hourlyRate: 1200,
      judgedRevenue: 70_000_000, judgedReason: "원본 현장 방문", judgedAt: 123, judgedBy: "original@example.com" };
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => source })
      .mockResolvedValueOnce({ exists: () => false });
    const copy = await duplicateCandidate("N001", "copy@example.com");
    expect(copy).toMatchObject({ code: "N012", name: "원본 (복사본)", isDraft: true,
      expectedPcCount: 100, hourlyRate: 1200, judgedRevenue: null, judgedReason: null,
      judgedAt: null, judgedBy: null, updatedBy: "copy@example.com" });
    expect(source.judgedRevenue).toBe(70_000_000);
    expect(mocks.setDoc).toHaveBeenCalledWith({ collection: "storeEvalCandidates", id: "N012" }, expect.objectContaining({ judgedRevenue: null, judgedBy: null }));
  });

  it("원본이 없으면 새 후보지를 저장하지 않는다", async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    await expect(duplicateCandidate("N001", null)).rejects.toThrow("복사할 후보지를 찾지 못했습니다");
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
