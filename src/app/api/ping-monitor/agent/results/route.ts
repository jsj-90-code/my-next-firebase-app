import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { checkAgentSignature } from "@/lib/pingMonitor/agentAuth";
import { learnExtraPorts, loadTargets, recordRound, writeRoundStatus } from "@/lib/pingMonitor/runRound";
import { agentRoundAtProblem, isLateRound } from "@/lib/pingMonitor/roundGuard";

// 측정 서버가 핑 + TCP로 잰 결과(켜진 IP 목록)를 받아 저장한다. 저장 방식은 Vercel TCP 경로와 같다(recordRound).
// 대상 목록은 여기서 다시 읽는다 — 서버가 보낸 IP 중 등록된 대역에 든 것만 센다.

export const maxDuration = 60;

/** 매장 IP 목록의 지문 — agent.mjs의 ipListKey와 같아야 한다(sha256(IP를 쉼표로 이은 것) 앞 16자, 목록 순서 그대로). */
function ipListKey(ips: string[]): string {
  return createHash("sha256").update(ips.join(",")).digest("hex").slice(0, 16);
}

export async function POST(request: Request) {
  const body = await request.text();
  const denied = checkAgentSignature(request, body);
  if (denied) return NextResponse.json({ error: `인증되지 않은 요청입니다 — ${denied}` }, { status: 401 });

  const parsed = JSON.parse(body) as { at?: string; aliveIps?: unknown; method?: unknown; extraOnlyIps?: unknown; measured?: unknown; measuredIps?: unknown };
  if (!Array.isArray(parsed.aliveIps)) return NextResponse.json({ error: "aliveIps가 없습니다." }, { status: 400 });
  const at = parsed.at ? new Date(parsed.at) : new Date();
  // 35일까지 받는다(AGENT_RESULT_MAX_AGE_MS) — 보내기에 실패한 회차를 서버가 pending/에 두고 다시 보낸다(2026-10-08, 처음엔 6시간).
  // 2026-11-14 Vercel 무료 한도 초과로 최대 30일 정지될 뻔했다 — 6시간 기한이면 정지 동안 서버가 잰 회차를 다 거절해 그 기간이 영영 빈다.
  // 시(時)는 잰 시각으로 묶인다. 4xx면 서버가 그 pending을 지운다(다시 보내도 같으니까).
  const problem = agentRoundAtProblem(at);
  if (problem) return NextResponse.json({ error: `측정 시각이 이상합니다 — ${problem}` }, { status: 400 });
  // 6시간 넘게 늦은 회차(밀린 회차)는 기록만 한다 — 상태 문서("마지막 회차")·측정 방식 자동 학습은 지금 상태 기준이라 옛 회차로 안 바꾼다.
  const late = isLateRound(at);

  // 잰 시각 기준으로 읽는다 — 어느 매장에 추가 포트를 보냈는지(extraReason)가 그 시와 맞아야 자동 학습이 맞다.
  // 서버가 목록을 받은 뒤(회차 도중) 등록되거나 IP가 바뀐 매장은 이번 회차에 안 쟀다 — 기록하면 가짜 0대가 된다(2026-10-14 제주 노형 14시).
  // 서버가 보낸 "잰 매장·IP 수"와 맞는 매장만 기록한다. 옛 에이전트(measured 없음)는 예전처럼 전부.
  // 밀린 회차에서 더 중요하다(2026-11-15): 며칠 사이 IP를 바꾼 매장은 IP 수가 달라져 빠지고, 서버가 캐시 목록으로 잰 회차도 같은 규칙으로 걸러진다.
  // IP 수는 같고 대역만 바뀐 매장은 IP 수로는 못 거른다(며칠 밀리면 생길 수 있다) — 새 에이전트는 매장별 IP 목록 지문(measuredIps)도 보내
  // 그것까지 같은 매장만 기록한다. 지문이 없는 옛 에이전트·옛 pending은 IP 수만 본다.
  const measured = parsed.measured && typeof parsed.measured === "object" ? (parsed.measured as Record<string, unknown>) : null;
  const ipKeys = parsed.measuredIps && typeof parsed.measuredIps === "object" ? (parsed.measuredIps as Record<string, unknown>) : null;
  const targets = (await loadTargets(at))
    .filter((t) => !measured || measured[t.id] === t.ips.length)
    .filter((t) => !ipKeys || ipKeys[t.id] === ipListKey(t.ips));
  const result = await recordRound(targets, new Set(parsed.aliveIps.map(String)), String(parsed.method ?? "agent"), at);
  // 회차 이상(측정 고장으로 대량 0대)이면 저장하지 않았다 — 상태 문서도 안 고친다(2026-10-10). 예전엔 예비(:50)가 이 시를 다시 쟀지만 예비는 2026-11-05 삭제 — 지금은 그 시가 빈다.
  // 200으로 답한다: 4xx면 서버가 pending을 지우고, 5xx면 같은 결과를 계속 다시 보낸다.
  if (result.rejected) return NextResponse.json({ ok: false, rejected: result.rejected, date: result.date, hour: result.hour });
  const summary = { date: result.date, hour: result.hour, stores: result.stores.length, written: result.stores.filter((s) => !s.skipped).length };
  if (late) return NextResponse.json({ ok: true, late: true, ...summary });
  // 추가 포트로만 잡힌 새 매장·뚫린 매장에 probe1688 자동으로 켜기(2026-10-14). 옛 에이전트는 extraOnlyIps를 안 보낸다 → 아무것도 안 함.
  const extraOnly = Array.isArray(parsed.extraOnlyIps) ? new Set(parsed.extraOnlyIps.map(String)) : new Set<string>();
  const learned = await learnExtraPorts(targets, extraOnly, at).catch((error) => {
    console.error("ping-monitor 측정 방식 자동 학습 실패:", error);
    return [] as string[];
  });
  // 상태 문서는 더 새 회차가 이미 적혀 있으면 안 덮는다(writeRoundStatus 안에서 확인 — 6시간 안 재전송도 순서가 뒤바뀔 수 있다).
  await writeRoundStatus(result).catch((error) => console.error("ping-monitor 실행 기록 저장 실패:", error));
  return NextResponse.json({ ok: true, ...summary, ...(learned.length ? { learned } : {}) });
}
