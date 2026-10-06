import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { runPingRound } from "@/lib/pingMonitor/runRound";

// 경쟁점 가동률 측정기 1시간 알람 — GitHub Actions(.github/workflows/ping-monitor.yml)가 매시 부른다.
// Vercel 예약 실행은 하루 1번만 돼서 바깥 알람을 쓴다. 저장소가 공개라 비밀값(PING_MONITOR_SECRET) 없이는 거부한다.
// vercel.json에서 서울(icn1)에 고정 — 한국 IP에서 두드려야 사무실에서 잰 것과 같은 조건이 된다.

export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.PING_MONITOR_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }
  try {
    const result = await runPingRound();
    // 마지막 실행 기록(알람이 실제로 도는지 확인용) — 문서 하나를 덮어쓴다.
    await adminDb
      ?.collection("storeEvalSystemStatus")
      .doc("pingMonitor")
      .set({ ...result, storeCount: result.stores.length })
      .catch((error) => console.error("ping-monitor 실행 기록 저장 실패:", error));
    return NextResponse.json(result);
  } catch (error) {
    console.error("ping-monitor 측정 실패:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "측정에 실패했습니다." }, { status: 500 });
  }
}
