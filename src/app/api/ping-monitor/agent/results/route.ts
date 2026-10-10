import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { checkAgentSignature } from "@/lib/pingMonitor/agentAuth";
import { loadTargets, recordRound } from "@/lib/pingMonitor/runRound";

// 측정 서버가 핑 + TCP로 잰 결과(켜진 IP 목록)를 받아 저장한다. 저장 방식은 Vercel TCP 경로와 같다(recordRound).
// 대상 목록은 여기서 다시 읽는다 — 서버가 보낸 IP 중 등록된 대역에 든 것만 센다.

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.text();
  const denied = checkAgentSignature(request, body);
  if (denied) return NextResponse.json({ error: `인증되지 않은 요청입니다 — ${denied}` }, { status: 401 });

  const parsed = JSON.parse(body) as { at?: string; aliveIps?: unknown; method?: unknown };
  if (!Array.isArray(parsed.aliveIps)) return NextResponse.json({ error: "aliveIps가 없습니다." }, { status: 400 });
  const at = parsed.at ? new Date(parsed.at) : new Date();
  // 6시간까지 받는다 — 보내기에 실패한 회차를 서버가 다음 회차에 다시 보낸다(2026-10-08). 시(時)는 잰 시각으로 묶인다.
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 600_000 || Date.now() - at.getTime() > 6 * 3600_000) {
    return NextResponse.json({ error: "측정 시각이 이상합니다." }, { status: 400 });
  }

  const targets = await loadTargets();
  const result = await recordRound(targets, new Set(parsed.aliveIps.map(String)), String(parsed.method ?? "agent"), at);
  // 회차 이상(측정 고장으로 대량 0대)이면 저장하지 않았다 — 상태 문서도 안 고쳐서 예비(:50)가 이 시를 다시 잰다(2026-10-10).
  // 200으로 답한다: 4xx면 서버가 pending을 지우고, 5xx면 같은 결과를 계속 다시 보낸다.
  if (result.rejected) return NextResponse.json({ ok: false, rejected: result.rejected, date: result.date, hour: result.hour });
  await adminDb
    ?.collection("storeEvalSystemStatus")
    .doc("pingMonitor")
    .set({ ...result, storeCount: result.stores.length })
    .catch((error) => console.error("ping-monitor 실행 기록 저장 실패:", error));
  return NextResponse.json({ ok: true, date: result.date, hour: result.hour, stores: result.stores.length, written: result.stores.filter((s) => !s.skipped).length });
}
