// 주소 하나로 상권자료를 전부 자동수집한다. (주소만 초기평가 도구 · 새 경로)
//
// ⚠️ **운영 후보지 흐름과 완전히 별개다.** Firestore에 아무것도 쓰지 않고(사용자 확정
//    2026-09-22: "저장 안 함 — 화면에만"), 기존 `collect-market-data` 라우트도 건드리지 않는다.
//    이 라우트는 받은 자료를 그대로 JSON으로 돌려주고, 계산은 화면에서 V62를 불러서 한다.
//
// 2026-09-29 — 수집 1~5단계는 `quickEvalCollectSite.ts`로 옮겼다(채팅 입지평가 MCP와 같이 쓴다).
// 이 라우트에 남은 건 6단계 **입지평가 AI 초안(Gemini, 유료 키)** 뿐이다.
// 한 단계가 실패해도 나머지를 버리지 않는다. 대신 `errors`에 사람이 읽을 문장으로 담아
// 화면이 "무엇을 모른 채로 낸 숫자인지"를 같이 보여준다.

import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { runLocationEvalDraft } from "@/lib/storeEval/locationEvalAi";
import type { GroundLevel } from "@/lib/storeEval/types";
import { collectQuickEvalSite } from "@/lib/storeEval/quickEval/quickEvalCollectSite";

// 소상공인365 스크래핑이 지점당 4초쯤 걸리고 AI 초안이 웹검색까지 한다 — 기본 타임아웃으로는
// 모자란다. Fluid Compute에서 긴 함수가 허용되므로 넉넉히 준다.
export const maxDuration = 300;

type CollectBody = {
  address?: string;
  name?: string;
  skipFloating?: boolean;
  skipAi?: boolean;
  // 물건 정보 — AI 입지평가의 **접근가시성 판단에 넘긴다**(2026-09-22 추가). 안 넘기면 AI가
  // 층수를 모른 채 가시성을 매긴다(quickEvalLocationContext.ts 머리 주석).
  floor?: number | null;
  groundLevel?: GroundLevel | null;
  hasElevator?: boolean | null;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });

  let body: CollectBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const address = body.address?.trim();
  if (!address) return NextResponse.json({ error: "주소가 필요합니다." }, { status: 400 });

  const site = await collectQuickEvalSite({
    address,
    name: body.name,
    skipFloating: body.skipFloating,
    floor: body.floor,
    groundLevel: body.groundLevel,
    hasElevator: body.hasElevator,
  });
  if (!site.ok) return NextResponse.json({ error: site.error }, { status: site.status });
  const { contextText, ...data } = site.data;
  const errors = [...data.errors];

  // 6) 입지평가 AI 초안 — 앞 단계 자료를 컨텍스트로 준다. 실패해도 나머지는 살린다.
  let locationDraft = null;
  if (!body.skipAi) {
    try {
      locationDraft = await runLocationEvalDraft({ contextText });
    } catch (err) {
      errors.push(`입지평가 AI 초안 실패: ${message(err)} (입지 항목 없이 계산됩니다)`);
    }
  }

  return NextResponse.json({ ...data, locationDraft, errors });
}
