import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { fetchKakaoMapImage } from "@/lib/server/kakaoMapImage";
import { buildLocationEvalContext } from "@/lib/storeEval/locationEvalContext";
import { runLocationEvalDraft } from "@/lib/storeEval/locationEvalAi";
import type { AdminDongReference, CandidateInput, Competitor, DemandPoint } from "@/lib/storeEval/types";

// 3단계 — 입지동선평가 AI 초안(기존 Claude+web_search 5점수 라우트를 Gemini로 교체, 2026-08-25).
// 실제 필드 스키마·프롬프트·Gemini 2단계 호출은 locationEvalAi.ts에 있다 — 4단계(기존 매장
// AI채점검증)도 같은 함수를 공유한다. 이 라우트는 인증 + Firestore 조회 + 지도 이미지 확보만
// 담당하는 얇은 레이어다.

type AiLocationEvalBody = {
  candidateCode?: string;
  mapImageUrl?: string;
};

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) {
    return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
  }
  if (!adminDb) {
    return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });
  }

  let body: AiLocationEvalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const candidateCode = body.candidateCode?.trim();
  if (!candidateCode) {
    return NextResponse.json({ error: "candidateCode가 필요합니다." }, { status: 400 });
  }

  const candidateSnap = await adminDb.collection("storeEvalCandidates").doc(candidateCode).get();
  if (!candidateSnap.exists) {
    return NextResponse.json({ error: "후보지를 찾을 수 없습니다." }, { status: 404 });
  }
  const candidate = candidateSnap.data() as CandidateInput;
  if (!candidate.address?.trim()) {
    return NextResponse.json({ error: "주소가 필요합니다. 기본정보 탭에서 먼저 입력해주세요." }, { status: 400 });
  }

  const [competitorsSnap, demandPointsSnap, adminDongSnap] = await Promise.all([
    adminDb.collection("storeEvalCompetitors").where("candidateCode", "==", candidateCode).get(),
    adminDb.collection("storeEvalDemandPoints").where("candidateCode", "==", candidateCode).get(),
    adminDb.collection("storeEvalAdminDongReferences").doc(candidateCode).get(),
  ]);
  const competitors = competitorsSnap.docs.map((d) => d.data() as Competitor);
  const demandPoints = demandPointsSnap.docs.map((d) => d.data() as DemandPoint);
  const adminDongReference = adminDongSnap.exists ? (adminDongSnap.data() as AdminDongReference) : null;

  const contextText = buildLocationEvalContext({ candidate, competitors, demandPoints, adminDongReference });

  // 지도 이미지는 클라이언트가 카카오 StaticMap에서 뽑아낸 이미지 URL만 보내고, 여기서 서버가
  // 직접 fetch한다 — 브라우저 canvas/fetch는 카카오 CDN이 CORS 헤더를 안 주면 픽셀을 못 읽지만
  // 서버↔서버 요청은 그 제약이 없다. 실패해도 전체 요청을 막지 않고 텍스트만으로 진행한다.
  let mapImageBase64: string | null = null;
  let mapImageMimeType: "image/png" | "image/jpeg" | "image/webp" | null = null;
  const warnings: string[] = [];
  if (body.mapImageUrl) {
    try {
      const image = await fetchKakaoMapImage(body.mapImageUrl);
      mapImageBase64 = image.buffer.toString("base64");
      mapImageMimeType = image.mimeType;
    } catch (err) {
      warnings.push(`지도 이미지를 불러오지 못해 텍스트 정보만으로 진행합니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const draft = await runLocationEvalDraft({ contextText, mapImageBase64, mapImageMimeType });
    return NextResponse.json({ ...draft, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
