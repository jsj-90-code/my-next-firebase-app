import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { parseIpRanges } from "./ipRange";
import { probeIps } from "./probe";
import { roundLooksBroken, shouldReplace } from "./roundGuard";
import { PING_DAILY, PING_STORES, denominator, kstParts } from "./summary";

// 경쟁점 가동률 측정기 — 1시간에 한 번, 측정 중인 매장 전부를 재서 저장한다(2026-10-06 신설).
//
// 저장은 두 곳:
//   pingMonitorDaily/{매장id}_{날짜}.hours.{시} = { a: 켜진 수, t: 대수 }  ← 상세 화면 시간대별
//   pingMonitorStores/{매장id}.days.{날짜}     += { a, t, n: 1 }         ← 목록 화면(매장당 읽기 1번)
//   pingMonitorStores/{매장id}.recent.{시}      = { a, t, at }            ← "최근 24시간"(시간대별 마지막 값, 2026-10-07)
// 같은 시(한국 시각)에 두 번 불려도 한 번만 센다 — 알람이 늦거나 겹쳐도 기록이 부풀지 않게.
//
// 재는 쪽은 둘이다(2026-10-06):
//   - "agent": Oracle 무료 서버(도쿄)가 핑 + TCP를 둘 다 재서 보낸다(/api/ping-monitor/agent/*). 기본.
//   - "tcp": Vercel이 TCP만 잰다(runPingRound). 핑에만 대답하는 매장(106곳 중 23곳)을 못 봐서 예비용.

export type { PingTarget } from "./roundGuard";
import type { PingTarget } from "./roundGuard";

/** 기본 포트는 전 매장(80·3389). 추가 포트(1688·5040)는 그게 먹히는 매장에만 — 서버 부하를 줄이는 최적화(2026-10-09).
 *  probe1688 매장(핑·80·3389 막혀서 1688·5040으로만 잡히는 곳)만 추가 포트를 받는다. */
const EXTRA_PORTS = [1688, 5040];

export type RoundResult = {
  ok: true;
  at: string;
  date: string;
  hour: string;
  method: string;
  stores: { id: string; name: string; alive: number; total: number; skipped?: string }[];
  /** 회차가 통째로 이상해 저장하지 않았으면 그 이유(2026-10-10). 이때 상태 문서도 안 고쳐서 예비가 그 시를 다시 잰다. */
  rejected?: string;
};

function requireDb() {
  if (!adminDb) throw new Error("Firebase 관리자 설정이 없습니다.");
  return adminDb;
}

export async function loadTargets(): Promise<PingTarget[]> {
  const snap = await requireDb().collection(PING_STORES).where("active", "==", true).get();
  return snap.docs.map((d) => {
    const data = d.data();
    const ips = parseIpRanges(String(data.ipRanges ?? "")).ips;
    return {
      id: d.id,
      name: String(data.name ?? ""),
      ips,
      total: denominator({ pcCount: data.pcCount ?? null, ipCount: ips.length }),
      ...(data.probe1688 ? { extraPorts: EXTRA_PORTS } : {}),
      excluded: Boolean(data.excludeFromStats),
      recent: Object.fromEntries(
        Object.entries((data.recent ?? {}) as Record<string, { a?: number; at?: { toDate?: () => Date } }>).map(([h, v]) => [
          h,
          { a: Number(v.a ?? 0), at: v.at?.toDate?.() ?? null },
        ]),
      ),
    };
  });
}

/** 켜진 IP 집합을 받아 매장별로 저장한다. */
export async function recordRound(targets: PingTarget[], alive: Set<string>, method: string, now = new Date()): Promise<RoundResult> {
  const db = requireDb();
  const { date, hour } = kstParts(now);

  const onById = new Map(
    targets.filter((s) => s.ips.length > 0).map((s) => {
      const n = s.ips.filter((ip) => alive.has(ip)).length;
      return [s.id, s.total > 0 ? Math.min(n, s.total) : n];
    }),
  );
  const broken = roundLooksBroken(targets, onById, hour, now, method);
  if (broken) return { ok: true, at: now.toISOString(), date, hour, method, stores: [], rejected: broken };

  const results = await Promise.all(
    targets.map(async (s) => {
      const aliveIps = s.ips.filter((ip) => alive.has(ip));
      if (s.ips.length === 0) return { id: s.id, name: s.name, alive: 0, total: 0, skipped: "IP 없음" };
      // 켜진 수는 대수를 못 넘는다 — IP대역이 대수보다 넓은 매장(고트 215 IP/110대)에서 장비·공유기 응답이 얹히면
      // 시간 칸이 100%를 넘어 날·주 평균까지 부풀었다(2026-10-10 정밀점검). 켜진 IP 목록(aliveIps)은 원본 그대로 남긴다.
      const on = s.total > 0 ? Math.min(aliveIps.length, s.total) : aliveIps.length;
      const dailyRef = db.collection(PING_DAILY).doc(`${s.id}_${date}`);
      const storeRef = db.collection(PING_STORES).doc(s.id);
      const written = await db.runTransaction(async (tx) => {
        const [daily, store] = await Promise.all([tx.get(dailyRef), tx.get(storeRef)]);
        const prev = daily.exists ? (daily.get(`hours.${hour}`) as { a: number; t: number; m?: string } | undefined) : undefined;
        if (prev != null && !shouldReplace(String(prev.m ?? ""), method)) return false;
        // 늦게 다시 보낸 회차(서버 pending, 최대 6시간)가 "실시간" 칸을 옛 값으로 되돌리지 않게 — 더 새 회차가 있으면 lastSample은 둔다.
        const prevAt = store.get("lastSample.at")?.toDate?.() as Date | undefined;
        // 같은 시를 서버 결과로 바꿔 쓸 땐(prev 있음) 그 시의 lastSample도 서버 값으로 — 예비가 :52에 먼저 써서 시각이 더 늦어도.
        const sameHourLast = store.get("lastSample.date") === date && store.get("lastSample.hour") === hour;
        const newest = !prevAt || prevAt.getTime() <= now.getTime() || (prev != null && sameHourLast);
        tx.set(dailyRef, { storeId: s.id, date, hours: { [hour]: { a: on, t: s.total, m: method } } }, { merge: true });
        tx.set(
          storeRef,
          {
            // 바꿔 쓸 땐 앞 기록만큼 빼고 더한다(같은 시가 두 번 세지지 않게, n은 그대로).
            days: prev
              ? { [date]: { a: FieldValue.increment(on - prev.a), t: FieldValue.increment(s.total - prev.t) } }
              : { [date]: { a: FieldValue.increment(on), t: FieldValue.increment(s.total), n: FieldValue.increment(1) } },
            ...(newest ? { lastSample: { at: now, date, hour, alive: on, total: s.total, aliveIps, method } } : {}),
            recent: { [hour]: { a: on, t: s.total, at: now } },
          },
          { merge: true },
        );
        return true;
      });
      return {
        id: s.id,
        name: s.name,
        alive: aliveIps.length,
        total: s.total,
        ...(written ? {} : { skipped: "이번 시간 이미 기록됨" }),
      };
    }),
  );

  return { ok: true, at: now.toISOString(), date, hour, method, stores: results };
}

/** Vercel에서 TCP만으로 재는 예비 경로. 서버 에이전트와 같은 포트 규칙 — 기본 80·3389는 전 IP, 추가 1688·5040은
 *  extraPorts 매장에만(2026-10-09). 전 매장 4포트로 재면 서버 회차(2포트)와 커버리지가 달라 같은 날 집계가 섞인다. */
export async function runPingRound(now = new Date()): Promise<RoundResult> {
  const targets = await loadTargets();
  const allIps = [...new Set(targets.flatMap((s) => s.ips))];
  const extraIps = [...new Set(targets.filter((t) => t.extraPorts?.length).flatMap((t) => t.ips))];
  const [baseAlive, extraAlive] = await Promise.all([
    probeIps(allIps, [80, 3389]),
    extraIps.length ? probeIps(extraIps, EXTRA_PORTS) : Promise.resolve(new Set<string>()),
  ]);
  const alive = new Set([...baseAlive, ...extraAlive]);
  return recordRound(targets, alive, "tcp", now);
}
