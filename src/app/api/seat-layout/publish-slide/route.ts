import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { publishCompositeToSlides } from "@/lib/googleSlides";

type PublishSlideRequestBody = {
  slideKey?: string;
  projectName?: string;
  imageDataUrl?: string;
};

async function getVerifiedUserId(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !adminAuth) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);

  if (!userId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: PublishSlideRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { slideKey, projectName, imageDataUrl } = body;
  if (!slideKey || !imageDataUrl) {
    return NextResponse.json({ error: "슬라이드 정보가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const result = await publishCompositeToSlides({
      slideKey,
      projectName: projectName ?? "매장",
      imageDataUrl,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "프레젠테이션 등록에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
