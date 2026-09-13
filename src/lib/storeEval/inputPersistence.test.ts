import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, type Firestore } from "firebase/firestore";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const connection = vi.hoisted(() => ({ db: null as Firestore | null }));
vi.mock("@/lib/firebase", () => ({ get db() { return connection.db; } }));
import { saveCandidate, saveCompetitor, saveLocationEvaluation, updateCandidateFields } from "./store";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const suite = emulator ? describe : describe.skip;

suite("입력 저장과 감사이력의 실제 원자성", () => {
  let normal: RulesTestEnvironment;
  let denied: RulesTestEnvironment;
  const candidate = { code: "N001", name: "테스트", address: "주소", expectedPcCount: 100, hourlyRate: 1500, judgedRevenue: null, updatedAt: 1 } as CandidateInput;
  beforeAll(async () => {
    const [host, port] = emulator!.split(":");
    normal = await initializeTestEnvironment({
      projectId: "demo-input-persistence", firestore: { host, port: Number(port), rules: readFileSync("firestore.rules", "utf8") },
    });
    // Deliberately deny only the audit write in this isolated demo project.
    denied = await initializeTestEnvironment({
      projectId: "demo-input-audit-denied", firestore: { host, port: Number(port), rules: `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{collection}/{id} { allow read: if true; allow write: if collection != 'storeEvalAuditLog'; } } }` },
    });
  });
  beforeEach(async () => {
    await Promise.all([normal.clearFirestore(), denied.clearFirestore()]);
    connection.db = normal.authenticatedContext("editor", { email: "worker@isens.camp", email_verified: true }).firestore() as unknown as Firestore;
  });
  afterAll(async () => {
    connection.db = null;
    await Promise.all([normal?.cleanup(), denied?.cleanup()]);
  });

  it("저장된 값과 반환값·이력 after의 시각과 작성자가 일치한다", async () => {
    const saved = await saveCandidate(candidate, "worker@isens.camp");
    const actual = (await getDoc(doc(connection.db!, "storeEvalCandidates", "N001"))).data();
    const audit = (await getDocs(collection(connection.db!, "storeEvalAuditLog"))).docs[0].data();
    expect(actual).toEqual(saved);
    expect(audit.after).toEqual(saved);
    expect(audit.before).toBeNull();
    expect(audit.action).toBe("생성");
    expect(saved.updatedBy).toBe("worker@isens.camp");
  });
  it("판단 저장 후 오래된 기본정보 폼을 저장해도 판단은 유지된다", async () => {
    const baseline = await saveCandidate(candidate, null);
    await updateCandidateFields("N001", { judgedRevenue: 45000000 }, "judge@isens.camp");
    const edited = await saveCandidate({ ...baseline, name: "새 이름" }, null, baseline);
    expect(edited.name).toBe("새 이름");
    expect(edited.judgedRevenue).toBe(45000000);
  });
  it("다른 화면의 동일 항목 수정과 충돌하면 문서와 이력을 추가로 쓰지 않는다", async () => {
    const baseline = await saveCandidate(candidate, null);
    await saveCandidate({ ...baseline, name: "다른 화면" }, null, baseline);
    await expect(saveCandidate({ ...baseline, name: "내 화면" }, null, baseline)).rejects.toThrow("다른 화면");
    expect((await getDoc(doc(connection.db!, "storeEvalCandidates", "N001"))).data()?.name).toBe("다른 화면");
    expect((await getDocs(collection(connection.db!, "storeEvalAuditLog"))).size).toBe(2);
  });
  it("좌표만 확정하면 다른 입력은 변하지 않고 삭제된 후보지는 되살리지 않는다", async () => {
    await saveCandidate(candidate, null);
    const saved = await updateCandidateFields("N001", { lat: 37.5, lng: 127 }, null);
    expect(saved.name).toBe(candidate.name);
    await expect(updateCandidateFields("N999", { lat: 37.5 }, null)).rejects.toThrow("찾지 못했습니다");
    await expect(saveCandidate({ ...candidate, code: "N999" }, null, { ...candidate, code: "N999" })).rejects.toThrow("삭제되었습니다");
  });
  it("경쟁점의 독립 수정은 병합하고 같은 항목 충돌과 삭제 후 재생성은 막는다", async () => {
    const baseline = await saveCompetitor({ id: "C001", candidateCode: "N001", name: "원본", totalPcCount: 100 } as Competitor, null, null);
    await saveCompetitor({ ...baseline, totalPcCount: 120 }, null, baseline);
    const saved = await saveCompetitor({ ...baseline, name: "새 이름" }, null, baseline);
    expect(saved).toMatchObject({ name: "새 이름", totalPcCount: 120 });
    await expect(saveCompetitor({ ...baseline, totalPcCount: 140 }, null, baseline)).rejects.toThrow("다른 화면");
    await expect(saveCompetitor(baseline, null, null)).rejects.toThrow("이미 저장");
    expect((await getDocs(collection(connection.db!, "storeEvalAuditLog"))).size).toBe(3);
    await deleteDoc(doc(connection.db!, "storeEvalCompetitors", "C001"));
    await expect(saveCompetitor(saved, null, saved)).rejects.toThrow("삭제되었습니다");
    expect((await getDoc(doc(connection.db!, "storeEvalCompetitors", "C001"))).exists()).toBe(false);
  });
  it("입지평가의 독립 수정은 병합하고 동시 신규 저장과 같은 항목 충돌을 막는다", async () => {
    const baseline = await saveLocationEvaluation({ candidateCode: "N001", name: "원본", locationScore: 3, mapMemo: null } as LocationEvaluation, null, null);
    await saveLocationEvaluation({ ...baseline, locationScore: 5 }, null, baseline);
    const saved = await saveLocationEvaluation({ ...baseline, mapMemo: "현장 메모" }, null, baseline);
    expect(saved).toMatchObject({ locationScore: 5, mapMemo: "현장 메모" });
    await expect(saveLocationEvaluation({ ...baseline, locationScore: 1 }, null, baseline)).rejects.toThrow("다른 화면");
    await expect(saveLocationEvaluation(baseline, null, null)).rejects.toThrow("다른 화면");
    expect((await getDocs(collection(connection.db!, "storeEvalAuditLog"))).size).toBe(3);
    await deleteDoc(doc(connection.db!, "storeEvalLocationEvaluations", "N001"));
    await expect(saveLocationEvaluation(saved, null, saved)).rejects.toThrow("삭제되었습니다");
  });
  it.each(["candidate", "competitor", "location"] as const)("%s 이력 저장이 거절되면 본문 수정도 반영되지 않는다", async (kind) => {
    connection.db = denied.authenticatedContext("editor").firestore() as unknown as Firestore;
    const name = kind === "candidate" ? "storeEvalCandidates" : kind === "competitor" ? "storeEvalCompetitors" : "storeEvalLocationEvaluations";
    const id = "N001";
    await setDoc(doc(connection.db, name, id), { name: "원본" });
    const operation = kind === "candidate"
      ? saveCandidate(candidate, null)
      : kind === "competitor"
        ? saveCompetitor({ id, candidateCode: id, name: "수정" } as Competitor, null)
        : saveLocationEvaluation({ candidateCode: id, name: "수정" } as LocationEvaluation, null);
    await expect(operation).rejects.toThrow();
    expect((await getDoc(doc(connection.db, name, id))).data()).toEqual({ name: "원본" });
    expect((await getDocs(collection(connection.db, "storeEvalAuditLog"))).size).toBe(0);
  });
});
