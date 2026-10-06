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
  if (Number.isNaN(at.getTime()) || Math.abs(Date.now() - at.getTime()) > 3600_000) {
    return NextResponse.json({ error: "측정 시각이 이상합니다." }, { status: 400 });
  }

  const targets = await loadTargets();
  const result = await recordRound(targets, new Set(parsed.aliveIps.map(String)), String(parsed.method ?? "agent"), at);
  await adminDb
    ?.collection("storeEvalSystemStatus")
    .doc("pingMonitor")
    .set({ ...result, storeCount: result.stores.length })
    .catch((error) => console.error("ping-monitor 실행 기록 저장 실패:", error));
  return NextResponse.json({ ok: true, date: result.date, hour: result.hour, stores: result.stores.length, written: result.stores.filter((s) => !s.skipped).length });
}
