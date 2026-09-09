import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", async importOriginal => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  collection: () => "sales",
  documentId: () => "__name__",
  where: (field: string, operator: string, values: string[]) => ({ field, operator, values }),
  query: (base: string, constraint: unknown) => ({ base, constraint }),
  getDocs: calls.getDocs,
}));
import { listEvaluationSales } from "./store";
beforeEach(() => calls.getDocs.mockReset().mockResolvedValue({ docs: [] }));

it("never queries the collection when no evaluation period can be resolved", async () => {
  expect(await listEvaluationSales([{ storeCode: "A", openedAt: null }])).toEqual([]);
  expect(calls.getDocs).not.toHaveBeenCalled();
});
it("bounds every request to evaluation IDs and chunks under the in-query limit", async () => {
  await listEvaluationSales(Array.from({ length: 4 }, (_, i) => ({ storeCode: `S${i}`, openedAt: "2023-07-07" })));
  expect(calls.getDocs).toHaveBeenCalledTimes(2);
  const ids = calls.getDocs.mock.calls.flatMap(([request]) => {
    expect(request.constraint.field).toBe("__name__");
    expect(request.constraint.operator).toBe("in");
    expect(request.constraint.values.length).toBeLessThanOrEqual(30);
    return request.constraint.values as string[];
  });
  expect(ids).toHaveLength(48);
  expect(ids).toContain("S0_2023-08");
  expect(ids).toContain("S3_2024-07");
  expect(ids).not.toContain("S0_2023-07");
  expect(ids).not.toContain("S0_2024-08");
});
it("propagates read failures instead of falling back to full-history queries", async () => {
  calls.getDocs.mockRejectedValueOnce(new Error("denied"));
  await expect(listEvaluationSales([{ storeCode: "A", openedAt: "2023-07-07" }])).rejects.toThrow("denied");
  expect(calls.getDocs).toHaveBeenCalledTimes(1);
});
