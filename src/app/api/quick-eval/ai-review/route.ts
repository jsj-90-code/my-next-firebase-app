// V62 결과를 읽고 **AI 평가문**을 쓴다. (주소만 초기평가 도구 · 새 경로)
//
// 화면이 이미 계산해 둔 V62 결과와 수집 내역을 그대로 받아서 Gemini에 넘긴다 —
// 여기서 산식을 다시 돌리지 않는다. 같은 화면의 숫자와 평가문이 어긋나면 안 되기 때문이다.
//
// 과금: **무료 티어 키**를 쓴다(사용자 결정 2026-09-22 — 평가문은 웹검색이 필요 없어서
// 무료 티어로 된다). 키 선택 규칙과 주의점은 `quickEvalReviewAi.ts` 머리 주석에 있다.
//
// ⚠️ 버튼을 눌러야 돌아간다 — 무료라도 좌석배치도와 할당량을 공유하므로 자동 호출은 안 한다.
// ⚠️ AI가 숫자를 새로 만들지 못하게 프롬프트에서 막는다(quickEvalReviewPrompt.ts 참고).

import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { buildQuickEvalReviewContext } from "@/lib/storeEval/quickEval/quickEvalReviewPrompt";
import { runQuickEvalReview } from "@/lib/storeEval/quickEval/quickEvalReviewAi";
import type { QuickEvalAssembly } from "@/lib/storeEval/quickEval/buildQuickCandidate";
import type { QuickEvalPeerSummary } from "@/lib/storeEval/quickEval/quickEvalPeers";
import type { EvaluationResult } from "@/lib/storeEval/types";

export const maxDuration = 300;

type ReviewBody = {
  result?: EvaluationResult;
  assembly?: QuickEvalAssembly;
  collectErrors?: string[];
  locationDraftRationale?: string | null;
  /** 가맹점 실적 비교표 — AI가 **자체 매출 판단**의 근거로 쓴다(2026-09-22 사용자 요청).
   *  화면이 이미 기존점을 불러왔으므로 거기서 만들어 보낸다(서버가 Firestore를 또 읽지 않는다). */
  peers?: QuickEvalPeerSummary | null;
  /** 2026-09-27 — 판정에 쓴 최종 금액(quickEvalVerdict.quickEvalFinalEstimate) */
  finalEstimate?: { value: number | null; source: "V62" | "실험실" | null; reason: string | null } | null;
};

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });

  let body: ReviewBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!body.result || !body.assembly) {
    return NextResponse.json({ error: "평가 결과가 필요합니다. 먼저 계산을 실행해주세요." }, { status: 400 });
  }

  const contextText = buildQuickEvalReviewContext({
    result: body.result,
    assembly: body.assembly,
    collectErrors: body.collectErrors ?? [],
    peers: body.peers ?? null,
    locationDraftRationale: body.locationDraftRationale ?? null,
    finalEstimate: body.finalEstimate ?? null,
  });

  try {
    const review = await runQuickEvalReview(contextText);
    return NextResponse.json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 평가문 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
