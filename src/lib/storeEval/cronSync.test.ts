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

// 2026-10-10 — 01·05 시트는 더 이상 읽지 않는다(웹이 정본, 사용자). 시트에 다른 값이 있어도 웹 값으로만 재계산하고,
// 시트 경쟁점을 새로 만들거나 기존점 프로필을 덮어쓰지 않아야 한다.
it.each(["N1", null])("동기화는 웹 기본정보·웹 경쟁점만으로 재계산한다 (원본 코드 %s)", async (originCode) => {
  mocks.originCode = originCode;
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "test@example.invalid");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-only");
  const {runFullProfileMigration} = await import("./cronSync");
  const summary = await runFullProfileMigration();
  expect(summary.profileUpdated).toBe(0);
  expect(summary.competitorsWritten).toBe(0);
  expect(mocks.calculate).toHaveBeenCalledWith(
    expect.objectContaining({ownVgaBase:"RTX 3060",originCandidateCode:originCode}),
    [expect.objectContaining({id:"web",candidateCode:originCode ?? "S1",investigationStatus:"경쟁점없음"})],
    null,
    expect.any(Object),
    // 2026-09-20 — QSC에서 환산한 관리 점수. 이 시험은 storeEvalQscScores가 비어 있으므로
    // null이 넘어가야 한다 = **자료가 없으면 저장된 관리 점수를 그대로 쓴다**는 안전장치.
    null,
  );
  expect(mocks.writes).toContainEqual({id:"S1",data:expect.objectContaining({competitivenessScore:4})});
  expect(mocks.writes.some((w) => w.id === "S1_시트 경쟁점")).toBe(false);
  expect(mocks.writes.some((w) => w.data.ownVgaBase === "RTX 5060")).toBe(false);
});
