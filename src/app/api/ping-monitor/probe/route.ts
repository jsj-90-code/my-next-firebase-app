import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { parseIpRanges } from "@/lib/pingMonitor/ipRange";
import { probeIps } from "@/lib/pingMonitor/probe";

// 경쟁점 가동률 측정기 "지금 확인" — 등록 전·상세 화면에서 대역이 대답하는지 바로 본다.
// 기록은 남기지 않는다(1시간 간격 기록에 끼면 시간대가 치우친다).

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정으로 로그인해 주세요." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { ipRanges?: unknown } | null;
  const parsed = parseIpRanges(typeof body?.ipRanges === "string" ? body.ipRanges : "");
  if (parsed.errors.length > 0 || parsed.ips.length === 0) {
    return NextResponse.json({ error: parsed.errors[0] ?? "IP대역을 입력해 주세요." }, { status: 400 });
  }

  const alive = await probeIps(parsed.ips);
  return NextResponse.json({
    at: new Date().toISOString(),
    total: parsed.ips.length,
    aliveIps: parsed.ips.filter((ip) => alive.has(ip)),
  });
}
