import { NextResponse } from "next/server";
import { runFullProfileMigration, runRevenueSync } from "@/lib/storeEval/cronSync";
import { adminDb } from "@/lib/firebase-admin";

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

// 2026-08-30 — Vercel CLI의 `vercel logs`는 실시간 tail만 되고 과거 실행 기록을 조회할 수
// 없어서, 매일 06:00 KST 크론이 실제로 도는지 확인할 방법이 없었다. 매 실행마다 결과를 이
// 문서 하나에 덮어써서(추가 컬렉션 없이 read/write 1건) "마지막으로 언제, 성공/실패, 무엇을
// 몇 건 갱신했는지"를 바로 조회할 수 있게 한다.
async function logRunResult(result: Record<string, unknown>) {
  if (!adminDb) return;
  try {
    await adminDb.collection("storeEvalSystemStatus").doc("cronSync").set(result);
  } catch (error) {
    console.error("store-eval cron-sync 실행 기록 저장 실패:", error);
  }
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
    await logRunResult({ ok: true, lastRunAt: Date.now(), revenue, profile });
    return NextResponse.json({ ok: true, revenue, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "동기화에 실패했습니다.";
    console.error("store-eval cron-sync 실패:", error);
    await logRunResult({ ok: false, lastRunAt: Date.now(), error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
