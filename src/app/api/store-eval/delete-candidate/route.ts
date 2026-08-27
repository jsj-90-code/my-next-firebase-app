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
