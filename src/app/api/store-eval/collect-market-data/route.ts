import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { collectMarketDataForCandidate } from "@/lib/storeEval/collectMarketData";

// 신규후보지 "상권자료 수집" — 로그인 확인 뒤 본체(src/lib/storeEval/collectMarketData.ts)를 부른다.
// 본체는 2026-10-15에 스킬(다우 심사글 → 후보지 등록)에서도 부르려고 떼어 냈다. 무엇을 모으는지는 그 파일 머리 주석.

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });

  let body: { candidateCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const candidateCode = body.candidateCode?.trim();
  if (!candidateCode) return NextResponse.json({ error: "candidateCode가 필요합니다." }, { status: 400 });
  const result = await collectMarketDataForCandidate(adminDb, candidateCode);
  return NextResponse.json(result.body, { status: result.status });
}
