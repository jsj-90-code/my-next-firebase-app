import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
  publishSeatNumbersToSheet,
  type SeatNumberSheetEntry,
  type StoreInfo,
} from "@/lib/googleSheets";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";

type PublishSeatNumbersRequestBody = {
  projectName?: string;
  entries?: SeatNumberSheetEntry[];
  storeInfo?: StoreInfo;
};

async function getVerifiedUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !adminAuth) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getVerifiedUser(request);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!isAllowedEmail(user.email)) {
    return NextResponse.json({ error: "회사 계정으로만 이용할 수 있습니다." }, { status: 403 });
  }

  let body: PublishSeatNumbersRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { projectName, entries, storeInfo } = body;
  if (!projectName || !entries?.length) {
    return NextResponse.json({ error: "등록할 좌석번호 데이터가 없습니다." }, { status: 400 });
  }

  try {
    const result = await publishSeatNumbersToSheet({ projectName, entries, storeInfo });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "시트 등록에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
