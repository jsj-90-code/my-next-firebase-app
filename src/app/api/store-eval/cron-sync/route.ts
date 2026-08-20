import { NextResponse } from "next/server";
import { runFullProfileMigration, runRevenueSync } from "@/lib/storeEval/cronSync";

export const maxDuration = 300; // Vercel Fluid Compute 기본 상한. 배치쓰기 덕분에 보통 훨씬 빨리 끝난다.

// Vercel Cron이 GET으로 호출한다. CRON_SECRET을 설정해두면 Vercel이 매 호출에
// Authorization: Bearer {CRON_SECRET}을 자동으로 붙여준다 - 그 값만 검사하면 외부에서
// 아무나 이 경로를 두드려 동기화를 강제로 돌리지 못하게 막을 수 있다.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 시크릿 미설정이면 항상 거부 - 무방비로 공개하지 않는다
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }

  try {
    // 매출DB(신규 매장 자동등록 + 월매출)를 먼저 반영해 새 매장이 등록된 뒤에, 그 매장들의
    // 나머지 프로필(01/05/09/03)도 같은 실행에서 채운다.
    const revenue = await runRevenueSync();
    const profile = await runFullProfileMigration();
    return NextResponse.json({ ok: true, revenue, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동기화에 실패했습니다.";
    console.error("store-eval cron-sync 실패:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
