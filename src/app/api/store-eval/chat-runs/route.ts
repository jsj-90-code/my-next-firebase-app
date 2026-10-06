import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { isMcpOwner } from "@/lib/server/mcpCandidateLocation";
import { QUICK_EVAL_CHAT_COLLECTION } from "@/lib/storeEval/quickEval/quickEvalChat";

// 채팅 입지평가 기록 조회 — 2026-10-06 신설(사용자 "남은일 하셈"). 그동안 Firebase 콘솔·로컬 스크립트로만 봤다.
// quickEvalChatRuns는 브라우저 읽기가 막혀 있어(firestore.rules) 서버가 admin으로 읽어 준다.
// ⚠️ 담당자 본인만(isMcpOwner) — 다른 직원의 주소·이메일이 담긴 기록이다.
// ⚠️ Firebase 무료(Spark) 요금제라 하루 읽기 5만이 한도다. 최근 LIMIT건만 읽는다.
const LIMIT = 100;

export type ChatRunRow = {
  runId: string;
  status: string;
  email: string | null;
  name: string | null;
  address: string | null;
  roadAddress: string | null;
  modelName: string | null;
  scores: Record<string, number | string | null> | null;
  rationale: string | null;
  sourcesCount: number;
  result: {
    verdict: string;
    finalRevenue: number | null;
    finalSource: string | null;
    marketGrade: string | null;
    competitorCount: number | null;
  } | null;
  createdAt: number | null;
  scoredAt: number | null;
};

export async function GET(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
  if (!isMcpOwner({ uid: user.uid, email: user.email ?? "", name: null })) {
    return NextResponse.json({ error: "담당자만 볼 수 있는 기록입니다." }, { status: 403 });
  }
  if (!adminDb) return NextResponse.json({ error: "서버 설정(firebase-admin)이 없습니다." }, { status: 500 });

  const snap = await adminDb.collection(QUICK_EVAL_CHAT_COLLECTION).orderBy("createdAt", "desc").limit(LIMIT).get();
  const rows: ChatRunRow[] = snap.docs.map((d) => {
    const v = d.data();
    return {
      runId: d.id,
      status: v.status ?? "-",
      email: v.user?.email ?? null,
      name: v.user?.name ?? null,
      address: v.address ?? null,
      roadAddress: v.roadAddress ?? null,
      modelName: v.modelName ?? null,
      scores: v.scores ?? null,
      rationale: v.rationale ?? null,
      sourcesCount: Array.isArray(v.sources) ? v.sources.length : 0,
      result: v.result
        ? {
            verdict: v.result.verdict,
            finalRevenue: v.result.finalRevenue ?? null,
            finalSource: v.result.finalSource ?? null,
            marketGrade: v.result.marketGrade ?? null,
            competitorCount: v.result.competitorCount ?? null,
          }
        : null,
      createdAt: v.createdAt ?? null,
      scoredAt: v.scoredAt ?? null,
    };
  });
  return NextResponse.json({ rows, limit: LIMIT });
}
