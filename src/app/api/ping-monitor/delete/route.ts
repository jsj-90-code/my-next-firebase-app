import { NextResponse } from "next/server";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { PING_DAILY, PING_STORES } from "@/lib/pingMonitor/summary";

// 측정기 경쟁점 삭제(2026-10-24 사용자 "경쟁점 삭제 버튼 만들어줘") — 잘못 넣은 등록을 측정 기록째 지운다.
// 화면(보안 규칙)은 빈 항목만 지울 수 있어서, 기록이 있는 등록은 여기(admin)서 지운다.
// 우리 매장 등록은 못 지운다. 지운 매장 정보(측정 기록 빼고)는 pingMonitorDeleted에 남겨 되살릴 수 있게 한다.

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정으로 로그인해 주세요." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || id.includes("/")) return NextResponse.json({ error: "매장 id가 없습니다." }, { status: 400 });

  const ref = adminDb.collection(PING_STORES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "이미 없는 매장입니다." }, { status: 404 });
  const data = snap.data() ?? {};
  if (data.isOwnStore === true) return NextResponse.json({ error: "우리 매장 등록은 지울 수 없습니다." }, { status: 400 });

  const daily = await adminDb
    .collection(PING_DAILY)
    .where(FieldPath.documentId(), ">=", `${id}_`)
    .where(FieldPath.documentId(), "<", `${id}_\uf8ff`)
    .select()
    .get();

  const info = { ...data };
  delete info.days;
  delete info.lastSample;
  await adminDb.collection("pingMonitorDeleted").doc(id).set({ ...info, dailyCount: daily.size, deletedAt: FieldValue.serverTimestamp(), deletedBy: user.email ?? null });
  for (let i = 0; i < daily.docs.length; i += 400) {
    const batch = adminDb.batch();
    for (const d of daily.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  await ref.delete();
  return NextResponse.json({ deleted: id, dailyDeleted: daily.size });
}
