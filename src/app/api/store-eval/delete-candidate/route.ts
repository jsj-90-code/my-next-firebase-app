import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

// 후보지 삭제 - 관련 컬렉션(경쟁점·수요거점·소상공인365 업로드이력·행정동참고자료·입지동선평가·
// 최종결과)까지 함께 지운다. storeEvalDemandPoints/storeEvalMarketDataUploads/
// storeEvalAdminDongReferences/storeEvalResults는 firestore.rules가 클라이언트 delete를 의도적으로
// 막아뒀다(수요거점·업로드이력은 서버 전용 쓰기, 최종결과는 재계산 이력 보존 목적) — 그래서 이
// 컬렉션들은 firebase-admin(보안규칙 우회)으로 서버에서만 지울 수 있다.
// 2026-08-27: 예전엔 storeEvalCandidates 본체만 지워서(store.ts의 클라이언트 delete) 나머지
// 컬렉션에 고아 데이터가 남았다(N004/N006 재사용 시도 중 실제로 발견·수동 정리함). 이 라우트로 대체.

const BY_ID_COLLECTIONS = [
  "storeEvalCandidates",
  "storeEvalLocationEvaluations",
  "storeEvalResults",
  "storeEvalAdminDongReferences",
];
const BY_FIELD_COLLECTIONS = ["storeEvalCompetitors", "storeEvalDemandPoints", "storeEvalMarketDataUploads"];

async function getVerifiedUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !adminAuth) return null;
  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getVerifiedUser(request);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });

  let body: { candidateCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const candidateCode = body.candidateCode?.trim();
  if (!candidateCode) return NextResponse.json({ error: "candidateCode가 필요합니다." }, { status: 400 });

  // 2026-08-27 발견 — 이 후보지가 이미 오픈해서 기존 가맹점으로 전환된 경우(convertCandidateToExistingStore),
  // 경쟁점/입지평가는 옮기지 않고 originCandidateCode로 되짚어 찾는 구조라(위 주석·store.ts 참고),
  // 여기서 확인 없이 지우면 그 매장 자체는 안 지워져도 검증(LOOCV)에 쓰이는 경쟁점·입지평가 데이터가
  // 조용히 사라진다. 연결된 기존 가맹점이 있으면 삭제를 막는다.
  const linkedStoreSnap = await adminDb
    .collection("storeEvalExistingStores")
    .where("originCandidateCode", "==", candidateCode)
    .limit(1)
    .get();
  const linkedByStoreCode = linkedStoreSnap.empty
    ? await adminDb.collection("storeEvalExistingStores").doc(candidateCode).get()
    : null;
  if (!linkedStoreSnap.empty || linkedByStoreCode?.exists) {
    const storeName = linkedStoreSnap.empty ? linkedByStoreCode?.data()?.storeName : linkedStoreSnap.docs[0].data().storeName;
    return NextResponse.json(
      { error: `이미 기존 가맹점(${storeName ?? "이름 미상"})으로 전환된 후보지입니다. 경쟁점·입지평가 데이터가 그 매장 검증에 쓰이고 있어 삭제할 수 없습니다.` },
      { status: 409 },
    );
  }

  const candidateRef = adminDb.collection("storeEvalCandidates").doc(candidateCode);
  const before = (await candidateRef.get()).data() ?? null;

  const batch = adminDb.batch();
  for (const col of BY_ID_COLLECTIONS) {
    batch.delete(adminDb.collection(col).doc(candidateCode));
  }
  for (const col of BY_FIELD_COLLECTIONS) {
    const snap = await adminDb.collection(col).where("candidateCode", "==", candidateCode).get();
    snap.docs.forEach((d) => batch.delete(d.ref));
  }
  await batch.commit();

  await adminDb
    .collection("storeEvalAuditLog")
    .doc(`candidate_${candidateCode}_${Date.now()}`)
    .set({
      entityType: "candidate",
      entityId: candidateCode,
      action: "삭제",
      before,
      after: null,
      actor: user.email ?? null,
      at: Date.now(),
    });

  return NextResponse.json({ ok: true });
}
