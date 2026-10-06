import { NextResponse } from "next/server";
import { checkAgentSignature } from "@/lib/pingMonitor/agentAuth";
import { loadTargets } from "@/lib/pingMonitor/runRound";

// 측정 서버가 매시 먼저 부른다 — 잴 IP 목록(매장 id별). 이름은 보내지 않는다(측정에 필요 없다).
export async function GET(request: Request) {
  const denied = checkAgentSignature(request, "");
  if (denied) return NextResponse.json({ error: `인증되지 않은 요청입니다 — ${denied}` }, { status: 401 });
  const targets = await loadTargets();
  return NextResponse.json({ targets: targets.map((t) => ({ id: t.id, ips: t.ips })) });
}
