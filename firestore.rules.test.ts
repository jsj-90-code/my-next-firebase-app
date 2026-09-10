/**
 * firestore.rules 행동 검증 — 에뮬레이터에서 실제 요청을 보내 허용/거부를 확인한다.
 *
 * 정적 문자열 대조가 아니라 실제 평가 결과를 본다. 규칙 파일을 읽어 에뮬레이터에 올리고
 * 인증 컨텍스트를 바꿔가며 읽기·쓰기를 시도한다.
 *
 * 실행:
 *   JAVA_HOME=<jdk> npx firebase-tools emulators:exec --only firestore --project demo-rules-test \
 *     "npx vitest run firestore.rules.test.ts"
 *
 * FIRESTORE_EMULATOR_HOST가 없으면 통째로 skip한다(일반 `vitest run`에서 자동으로 건너뛴다).
 *
 * 여기서 지키려는 것 중 둘은 2026-09-10 보안감사로 뒤늦게 발견한 구멍이라, 회귀를 코드로
 * 막아둔다 — email_verified 검사와 매출DB 삭제 차단이다. 감사가 아니라 테스트가 잡아야 한다.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorAddress ? describe : describe.skip;
const rulesText = readFileSync("firestore.rules", "utf8");

const ADMIN_EMAIL = "admin@isens.camp";
const WORKER_EMAIL = "worker@isens.camp";

describeWithEmulator("firestore.rules", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, portText] = emulatorAddress!.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: "demo-rules-test",
      firestore: { host, port: Number(portText), rules: rulesText },
    });
  });

  beforeEach(() => testEnv.clearFirestore());
  afterAll(() => testEnv.cleanup());

  /** 회사 계정 컨텍스트. email_verified를 끄면 2026-09-10에 막은 그 계정이 된다. */
  const db = (email: string | null, emailVerified = true) =>
    testEnv.authenticatedContext(email ?? "nobody", email ? { email, email_verified: emailVerified } : {}).firestore();
  const anonDb = () => testEnv.unauthenticatedContext().firestore();
  const seed = (path: [string, string], data: Record<string, unknown> = { seeded: true }) =>
    testEnv.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), ...path), data));

  describe("회사 계정 경계", () => {
    it("로그인하지 않으면 읽지 못한다", async () => {
      await assertFails(getDoc(doc(anonDb(), "storeEvalCandidates", "N001")));
    });

    // 2026-09-10 보안감사 핵심. 이 검사가 빠져 있어서 공개 API 키만으로
    // 아무거나@isens.camp 계정을 만들어 전체 매출자료에 접근할 수 있었다.
    it("도메인이 맞아도 메일 인증이 안 됐으면 거부한다", async () => {
      await assertFails(getDoc(doc(db(WORKER_EMAIL, false), "storeEvalCandidates", "N001")));
      await assertFails(setDoc(doc(db(WORKER_EMAIL, false), "storeEvalCandidates", "N001"), { name: "침입" }));
    });

    it("인증된 회사 계정은 허용한다", async () => {
      await assertSucceeds(setDoc(doc(db(WORKER_EMAIL), "storeEvalCandidates", "N001"), { name: "산본점" }));
      await assertSucceeds(getDoc(doc(db(WORKER_EMAIL), "storeEvalCandidates", "N001")));
    });

    it("인증됐어도 외부 도메인은 거부한다", async () => {
      await assertFails(getDoc(doc(db("outsider@gmail.com"), "storeEvalCandidates", "N001")));
    });

    // 정규식이 끝에 앵커돼 있는지 — isens.camp를 앞에 붙인 남의 도메인이 통과하면 안 된다.
    it("도메인을 접두어로 흉내낸 주소를 거부한다", async () => {
      await assertFails(getDoc(doc(db("x@isens.camp.evil.com"), "storeEvalCandidates", "N001")));
      await assertFails(getDoc(doc(db("x@notisens.camp"), "storeEvalCandidates", "N001")));
    });

    it("이메일이 없는 토큰을 거부한다", async () => {
      await assertFails(getDoc(doc(db(null), "storeEvalCandidates", "N001")));
    });
  });

  // CLAUDE.md "매출DB 절대 삭제 금지"를 규칙 단에서 강제한다(2026-09-10 추가).
  // 동기화는 firebase-admin이라 규칙을 우회하므로 이 차단의 부작용이 없다.
  describe("매출DB 삭제 차단", () => {
    it("인증된 회사 계정도 월별매출을 지우지 못한다", async () => {
      await seed(["storeEvalExistingStoreSales", "S001-202601"]);
      await assertFails(deleteDoc(doc(db(WORKER_EMAIL), "storeEvalExistingStoreSales", "S001-202601")));
    });

    it("생성과 수정은 계속 허용한다", async () => {
      await assertSucceeds(setDoc(doc(db(WORKER_EMAIL), "storeEvalExistingStoreSales", "S001-202601"), { pcSales: 1000 }));
      await assertSucceeds(updateDoc(doc(db(WORKER_EMAIL), "storeEvalExistingStoreSales", "S001-202601"), { pcSales: 2000 }));
    });
  });

  describe("권한 상승 차단", () => {
    it("관리자 목록에 스스로를 넣지 못한다", async () => {
      await assertFails(setDoc(doc(db(WORKER_EMAIL), "storeEvalAdmins", WORKER_EMAIL), { role: "admin" }));
    });

    it("관리자 목록 읽기는 허용한다", async () => {
      await seed(["storeEvalAdmins", ADMIN_EMAIL], { role: "admin" });
      await assertSucceeds(getDoc(doc(db(WORKER_EMAIL), "storeEvalAdmins", ADMIN_EMAIL)));
    });

    it("모델 설정은 일반 계정이 바꾸지 못하고 관리자만 바꾼다", async () => {
      await seed(["storeEvalAdmins", ADMIN_EMAIL], { role: "admin" });
      await assertSucceeds(getDoc(doc(db(WORKER_EMAIL), "storeEvalSettings", "active")));
      await assertFails(setDoc(doc(db(WORKER_EMAIL), "storeEvalSettings", "active"), { ridgeLambda: 999 }));
      await assertSucceeds(setDoc(doc(db(ADMIN_EMAIL), "storeEvalSettings", "active"), { ridgeLambda: 10 }));
    });

    it("관리자여도 메일 인증이 안 됐으면 설정을 바꾸지 못한다", async () => {
      await seed(["storeEvalAdmins", ADMIN_EMAIL], { role: "admin" });
      await assertFails(setDoc(doc(db(ADMIN_EMAIL, false), "storeEvalSettings", "active"), { ridgeLambda: 999 }));
    });
  });

  describe("불변 로그", () => {
    const immutable = ["storeEvalAuditLog", "storeEvalRestoreLog", "storeEvalMarketDataUploads"] as const;

    it.each(immutable)("%s는 생성만 되고 수정·삭제가 막힌다", async collectionId => {
      await assertSucceeds(setDoc(doc(db(WORKER_EMAIL), collectionId, "log-1"), { at: 1 }));
      await assertFails(updateDoc(doc(db(WORKER_EMAIL), collectionId, "log-1"), { at: 2 }));
      await assertFails(deleteDoc(doc(db(WORKER_EMAIL), collectionId, "log-1")));
    });

    it("설정 이력은 관리자만 남기고 아무도 고치지 못한다", async () => {
      await seed(["storeEvalAdmins", ADMIN_EMAIL], { role: "admin" });
      await assertFails(setDoc(doc(db(WORKER_EMAIL), "storeEvalSettingsHistory", "h1"), { at: 1 }));
      await assertSucceeds(setDoc(doc(db(ADMIN_EMAIL), "storeEvalSettingsHistory", "h1"), { at: 1 }));
      await assertFails(updateDoc(doc(db(ADMIN_EMAIL), "storeEvalSettingsHistory", "h1"), { at: 2 }));
      await assertFails(deleteDoc(doc(db(ADMIN_EMAIL), "storeEvalSettingsHistory", "h1")));
    });
  });

  describe("평가 결과 보존", () => {
    it("재계산 이력이 남도록 삭제만 막는다", async () => {
      await assertSucceeds(setDoc(doc(db(WORKER_EMAIL), "storeEvalResults", "N001"), { v62Final: 1 }));
      await assertSucceeds(updateDoc(doc(db(WORKER_EMAIL), "storeEvalResults", "N001"), { v62Final: 2 }));
      await assertFails(deleteDoc(doc(db(WORKER_EMAIL), "storeEvalResults", "N001")));
    });
  });

  describe("서버 전용 자료", () => {
    it("행정구역 참고자료는 읽기만 된다", async () => {
      await seed(["storeEvalAdminDongReferences", "N001"]);
      await assertSucceeds(getDoc(doc(db(WORKER_EMAIL), "storeEvalAdminDongReferences", "N001")));
      await assertFails(setDoc(doc(db(WORKER_EMAIL), "storeEvalAdminDongReferences", "N001"), { pop: 1 }));
    });

    it("수요거점은 확인표시만 되고 생성·삭제는 막힌다", async () => {
      await seed(["storeEvalDemandPoints", "p1"], { confirmed: false });
      await assertSucceeds(updateDoc(doc(db(WORKER_EMAIL), "storeEvalDemandPoints", "p1"), { confirmed: true }));
      await assertFails(setDoc(doc(db(WORKER_EMAIL), "storeEvalDemandPoints", "p2"), { confirmed: true }));
      await assertFails(deleteDoc(doc(db(WORKER_EMAIL), "storeEvalDemandPoints", "p1")));
    });
  });

  describe("시스템 상태 문서", () => {
    // 검증화면이 쓰는 accuracy 1건만 열어두고, cron이 admin SDK로 쓰는 문서는 막는다.
    it("accuracy만 클라이언트가 쓸 수 있다", async () => {
      await assertSucceeds(setDoc(doc(db(WORKER_EMAIL), "storeEvalSystemStatus", "accuracy"), { mape: 0.099 }));
      await assertFails(setDoc(doc(db(WORKER_EMAIL), "storeEvalSystemStatus", "cronSync"), { ok: false }));
    });

    it("cronSync 문서도 읽기는 된다", async () => {
      await seed(["storeEvalSystemStatus", "cronSync"], { ok: true });
      await assertSucceeds(getDoc(doc(db(WORKER_EMAIL), "storeEvalSystemStatus", "cronSync")));
    });
  });

  it("규칙 파일에 email_verified 검사가 남아 있다", () => {
    // 행동 검증이 본체지만, 조건이 통째로 사라지면 위 테스트가 조용히 무의미해지는 것을 막는다.
    expect(rulesText).toContain("request.auth.token.email_verified == true");
  });
});
