import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { runDaouReportDraft } from "@/lib/storeEval/daouReportAi";
import { buildDaouReportContext, type DaouReportContextCandidate, type DaouReportContextCompetitor } from "@/lib/storeEval/reportContext";
import type { EvaluationResult } from "@/lib/storeEval/types";

// 다우오피스 평가기록 보고서 텍스트 초안 - API 라우트.
// ai-location-eval과 달리 Firestore를 다시 조회하지 않는다 — 화면(ResultTab)이 방금 "다시 계산"
// 으로 만든 값(candidate/competitors/result)을 그대로 받아 그 화면에 떠 있는 숫자 그대로 보고서를
// 쓴다(재조회 시 그 사이 값이 바뀌면 화면과 보고서 내용이 어긋날 수 있어 이 편이 더 정확하다).

type GenerateDaouReportBody = {
  candidate?: DaouReportContextCandidate;
  competitors?: DaouReportContextCompetitor[];
  result?: EvaluationResult;
};

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) {
    return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
  }

  let body: GenerateDaouReportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!body.candidate || !body.result) {
    return NextResponse.json({ error: "candidate/result가 필요합니다." }, { status: 400 });
  }

  const contextText = buildDaouReportContext({
    candidate: body.candidate,
    competitors: body.competitors ?? [],
    result: body.result,
  });

  try {
    const draft = await runDaouReportDraft(contextText);
    return NextResponse.json(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
