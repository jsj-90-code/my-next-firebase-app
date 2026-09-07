import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  calculate: vi.fn(() => ({ competitivenessScore: 4 })),
  originCode: "N1" as string | null,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    batch: () => ({
      set: (ref: {id:string}, data: Record<string, unknown>) => mocks.writes.push({id:ref.id,data}),
      commit: async () => undefined,
    }),
    collection: (name: string) => ({
      get: async () => ({docs: name === "storeEvalExistingStores"
        ? [{id:"S1",data:() => ({ownVgaBase:"RTX 3060",originCandidateCode:mocks.originCode})}]
        : name === "storeEvalCompetitors"
          ? [{id:"web",data:() => ({id:"web",candidateCode:mocks.originCode ?? "S1",name:"웹 경쟁점",surveyState:"경쟁점없음"})}]
          : []}),
      doc: (id: string) => ({id,get:async () => ({exists:false})}),
    }),
  },
}));
vi.mock("googleapis", () => ({google:{
  auth:{JWT:class {}},
  sheets:() => ({spreadsheets:{values:{get:async ({range}:{range:string}) => ({data:{values:
    range.includes("01_점포기본정보")
      ? [["가맹점코드","자사_VGA_기본"],["S1","RTX 5060"]]
      : [["가맹점코드","경쟁점명"],["S1","시트 경쟁점"]],
  }})}}}),
}}));
vi.mock("./existingStoreEvaluation", async (importOriginal) => ({
  ...await importOriginal<typeof import("./existingStoreEvaluation")>(),
  existingStoreEvaluationPatch: mocks.calculate,
}));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); mocks.writes.length = 0; });

it.each(["N1", null])("동기화는 최신 기본정보와 올바른 연결 자료를 사용한다 (원본 코드 %s)", async (originCode) => {
  mocks.originCode = originCode;
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "test@example.invalid");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-only");
  const {runFullProfileMigration} = await import("./cronSync");
  const summary = await runFullProfileMigration();
  expect(summary.profileUpdated).toBe(1);
  expect(mocks.calculate).toHaveBeenCalledWith(
    expect.objectContaining({ownVgaBase:"RTX 5060",originCandidateCode:originCode}),
    [
      expect.objectContaining({id:"web",candidateCode:originCode ?? "S1",investigationStatus:"경쟁점없음"}),
      expect.objectContaining({id:"S1_시트 경쟁점",candidateCode:originCode ?? "S1",investigationStatus:"조사완료"}),
    ],
    null,
    expect.any(Object),
  );
  expect(mocks.writes).toContainEqual({id:"S1",data:expect.objectContaining({competitivenessScore:4})});
  expect(mocks.writes).toContainEqual({id:"S1_시트 경쟁점",data:expect.objectContaining({candidateCode:originCode ?? "S1"})});
});
