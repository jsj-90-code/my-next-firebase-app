import { NextResponse } from "next/server";
import { checkAgentSignature } from "@/lib/pingMonitor/agentAuth";
import { loadTargets } from "@/lib/pingMonitor/runRound";

// 측정 서버가 매시 먼저 부른다 — 잴 IP 목록(매장 id별). 이름은 보내지 않는다(측정에 필요 없다).
export async function GET(request: Request) {
  const denied = checkAgentSignature(request, "");
  if (denied) return NextResponse.json({ error: `인증되지 않은 요청입니다 — ${denied}` }, { status: 401 });
  const targets = await loadTargets();
  // extraPorts: 기본(80·3389) 외에 그 매장에만 보낼 포트(1688·5040) — 서버 부하 최소화(2026-10-09).
  return NextResponse.json({ targets: targets.map((t) => ({ id: t.id, ips: t.ips, ...(t.extraPorts ? { extraPorts: t.extraPorts } : {}) })) });
}
