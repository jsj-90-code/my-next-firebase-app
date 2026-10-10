// 측정기 회차 저장 전 점검(2026-10-10 정밀점검) — runRound.ts(server-only)에서 빼서 시험할 수 있게 둔 순수 함수.

/** recent: 그 시간대 칸에 남아 있던 직전 기록(보통 어제 같은 시각) — 회차 이상 점검(roundLooksBroken)에 쓴다. */
export type PingTarget = {
  id: string;
  name: string;
  ips: string[];
  total: number;
  extraPorts?: number[];
  recent?: Record<string, { a: number; at: Date | null }>;
  /** 계산 제외(excludeFromStats) 매장 — 노이즈라 회차 이상 점검 비교에서 뺀다. */
  excluded?: boolean;
};

/** 예비(Vercel TCP "tcp")·집 PC("home-")처럼 핑·타임스탬프가 없는 약한 측정. */
export function isWeakMethod(m: string): boolean {
  return m === "tcp" || m.startsWith("tcp+") || m.startsWith("home");
}

/**
 * 회차 이상 점검(2026-10-10 정밀점검) — 측정 쪽 고장(소켓·메모리 부족, 10-08 22시 121곳 0대)은 "꺼짐"과 구분이 안 돼
 * 0대로 저장되고, 같은 시는 먼저 쓴 쪽이 이겨 그대로 굳었다. 그래서 저장 전에 어제 같은 시각과 견준다:
 * 어제 이 시각 5대 이상 켜져 있던 매장(20곳 이상일 때만 판정) 중 20% 이상이 이번에 0대거나, 그 매장들 합계가
 * 어제의 40% 미만이면 회차 전체를 버린다. 하루 사이 실제 변동은 시간대 합계로 0.8~1.08배였다(10-09 휴일 vs 10-10 토).
 * 버린 시는 그 시의 남은 예비 호출(GitHub :52 등)이 다시 잰다 — 그것도 버려지면 그 시는 빈다.
 *
 * 2026-10-10 최종점검 보완:
 * - 비교 기준은 그 시간대 칸(recent)의 직전 기록이다. 보통 어제 같은 시각이지만, 늦게 재전송된 서버 결과면 오늘 이 시에 예비가 쓴
 *   값이 기준이 된다(예전엔 12시간 안 기록을 빼서 판정을 건너뛰었고, 고장 난 늦은 결과가 정상 예비 기록을 덮어쓸 수 있었다).
 * - 약한 측정(TCP만)은 "0대 비율"을 안 본다 — 핑에만 대답하는 매장(약 22%)이 늘 0대라 정상 회차도 걸린다. 합계 기준만 본다
 *   (10-08 05시 예비 고장은 합계 0.30배라 그대로 걸림).
 * - 계산 제외 매장은 비교에서 뺀다.
 */
export function roundLooksBroken(
  targets: PingTarget[],
  onById: Map<string, number>,
  hour: string,
  now: Date,
  method = "",
): string | null {
  let compared = 0, zero = 0, prevSum = 0, nowSum = 0;
  for (const t of targets) {
    const p = t.recent?.[hour];
    if (!p?.at || !onById.has(t.id) || t.excluded) continue;
    const age = now.getTime() - p.at.getTime();
    if (age > 36 * 3600_000 || p.a < 5) continue;
    const on = onById.get(t.id) ?? 0;
    compared += 1;
    prevSum += p.a;
    nowSum += on;
    if (on === 0) zero += 1;
  }
  if (compared < 20) return null;
  if (!isWeakMethod(method) && zero / compared >= 0.2) return `직전 이 시각 기록에서 켜져 있던 ${compared}곳 중 ${zero}곳이 0대 — 측정 고장으로 보고 버림`;
  if (nowSum < prevSum * 0.4) return `켜진 합계 ${nowSum}대가 직전 이 시각 기록(${prevSum}대)의 40% 미만 — 측정 고장으로 보고 버림`;
  return null;
}

/** 같은 시에 이미 기록이 있을 때 새 결과로 바꿀지 — 측정 서버(핑+TCP+타임스탬프)가 예비(Vercel TCP만 "tcp")나 집 PC("home-")를
 *  이긴다. 서버 결과가 늦게 오면(pending 재전송·회차 지연) 예비가 먼저 써서 핑에만 대답하는 매장(약 22%)이 낮게 굳던 것(2026-10-10). */
export function shouldReplace(existingMethod: string, incomingMethod: string): boolean {
  return isWeakMethod(existingMethod) && !isWeakMethod(incomingMethod);
}

