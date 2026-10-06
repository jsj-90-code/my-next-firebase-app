import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { checkGithubOidc } from "@/lib/pingMonitor/githubOidc";
import { runPingRound } from "@/lib/pingMonitor/runRound";

// 경쟁점 가동률 측정기 1시간 알람 — GitHub Actions(.github/workflows/ping-monitor.yml)가 매시 부른다.
// 경위(2026-10-06): Vercel 무료 요금제라 예약 실행이 하루 1번뿐(매시로 넣으니 배포가 거절됨) → GitHub Actions로 깨운다.
// 비밀값을 사용자가 손으로 넣지 않도록, GitHub가 서명한 OIDC 토큰으로 "이 저장소 main의 알람"인지 확인한다(githubOidc.ts).
// CRON_SECRET(Vercel 예약 실행용)도 받는다 — 나중에 요금제가 바뀌면 vercel.json에 매시 예약만 넣으면 된다.
// vercel.json에서 서울(icn1)에 고정 — 한국 IP에서 두드려야 사무실에서 잰 것과 같은 조건이 된다.

export const maxDuration = 300;

function matchesCronSecret(header: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function authError(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return "인증 정보가 없습니다.";
  if (matchesCronSecret(header)) return null;
  return checkGithubOidc(header.slice(7)).catch((error) => (error instanceof Error ? error.message : "토큰 확인 실패"));
}

export async function GET(request: Request) {
  const denied = await authError(request);
  if (denied) {
    return NextResponse.json({ error: `인증되지 않은 요청입니다 — ${denied}` }, { status: 401 });
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
