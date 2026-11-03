import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { parseIpRanges } from "./ipRange";
import { probeIps } from "./probe";
import { roundLooksBroken, shouldReplace, wantsExtraPorts } from "./roundGuard";
import { PING_DAILY, PING_STORES, denominator, kstParts } from "./summary";
import { istore, usesInternalStore } from "./internalStore";

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

/** 기본 포트는 전 매장(80). 추가 포트(1688·5040)는 그게 필요한 매장에만 — 서버 부하를 줄이는 최적화(2026-10-09).
 *  누가 받는지는 wantsExtraPorts(roundGuard.ts): probe1688 매장 · 첫 24회차 학습 중인 새 매장 · 늘 0대 매장의 21시 재확인(2026-10-14). */
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

/** 매장 문서 하나 → 잴 대상. Firebase(Timestamp)·사내 저장소(Date) 둘 다 받는다. */
function toTarget(id: string, data: Record<string, unknown>, hour: string): PingTarget {
  const ips = parseIpRanges(String(data.ipRanges ?? "")).ips;
  const recentRaw = (data.recent ?? {}) as Record<string, { a?: number; at?: unknown }>;
  const extraReason = wantsExtraPorts({ probe1688: Boolean(data.probe1688), recent: recentRaw as Record<string, { a: number }> }, hour);
  return {
    id,
    name: String(data.name ?? ""),
    ips,
    total: denominator({ pcCount: (data.pcCount as number | null | undefined) ?? null, ipCount: ips.length }),
    ...(extraReason ? { extraPorts: EXTRA_PORTS, extraReason } : {}),
    excluded: Boolean(data.excludeFromStats),
    recent: Object.fromEntries(Object.entries(recentRaw).map(([h, v]) => [h, { a: Number(v.a ?? 0), at: toDateValue(v.at) }])),
  };
}
const toDateValue = (v: unknown): Date | null =>
  v instanceof Date ? v : v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate() : null;

export async function loadTargets(now = new Date()): Promise<PingTarget[]> {
  const { hour } = kstParts(now);
  if (usesInternalStore()) {
    const docs = await istore.list(PING_STORES, { where: [["active", "==", true]] });
    return docs.map((d) => toTarget(d.id, d.data, hour));
  }
  const snap = await requireDb().collection(PING_STORES).where("active", "==", true).get();
  return snap.docs.map((d) => toTarget(d.id, d.data(), hour));
}

/** 켜진 IP 집합을 받아 매장별로 저장한다. */
export async function recordRound(targets: PingTarget[], alive: Set<string>, method: string, now = new Date()): Promise<RoundResult> {
  if (usesInternalStore()) return recordRoundInternal(targets, alive, method, now);
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

/** 측정 방식 자동 학습(2026-10-14) — 서버가 "추가 포트(1688·5040)로만 대답한 IP"를 보내 오면, 학습 중이거나 21시 재확인 중인
 *  매장 중 그런 IP가 3개 이상인 곳에 probe1688을 켠다(한두 개는 장비일 수 있음). 켜진 뒤엔 매시 추가 포트를 받는다.
 *  늘 0대였다가 뚫린 매장은 그날을 portSwitchDate로 적어 그 전 0대 날이 평균에 안 섞이게 한다(ba11eeb와 같은 규칙).
 *  새 매장(학습 중)은 첫 회차부터 추가 포트를 받았으니 전환 날이 없다. 켠 매장 이름을 돌려준다. */
export async function learnExtraPorts(targets: PingTarget[], extraOnlyIps: Set<string>, now = new Date()): Promise<string[]> {
  if (extraOnlyIps.size === 0) return [];
  const { date } = kstParts(now);
  const learned = targets.filter(
    (t) => (t.extraReason === "learning" || t.extraReason === "silent-recheck") && t.ips.filter((ip) => extraOnlyIps.has(ip)).length >= 3,
  );
  if (usesInternalStore()) {
    await istore.commit(learned.map((t) => ({ op: "merge" as const, c: PING_STORES, id: t.id, data: learnedPatch(t, extraOnlyIps, now, date) })));
    return learned.map((t) => t.name);
  }
  await Promise.all(
    learned.map((t) =>
      requireDb()
        .collection(PING_STORES)
        .doc(t.id)
        .set(
          {
            probe1688: true,
            probe1688Auto: { at: now, reason: t.extraReason, ips: t.ips.filter((ip) => extraOnlyIps.has(ip)).length },
            ...(t.extraReason === "silent-recheck" ? { portSwitchDate: date } : {}),
          },
          { merge: true },
        ),
    ),
  );
  return learned.map((t) => t.name);
}

/** Vercel에서 TCP만으로 재는 예비 경로. 서버 에이전트와 같은 포트 규칙 — 기본 80은 전 IP, 추가 1688·5040은
 *  extraPorts 매장에만(2026-10-09). 3389는 뺐다(2026-10-28, 서버 에이전트와 같이): 진단에서 3389로만 잡히는 IP 0개. */
export async function runPingRound(now = new Date()): Promise<RoundResult> {
  const targets = await loadTargets(now);
  const allIps = [...new Set(targets.flatMap((s) => s.ips))];
  const extraIps = [...new Set(targets.filter((t) => t.extraPorts?.length).flatMap((t) => t.ips))];
  const [baseAlive, extraAlive] = await Promise.all([
    probeIps(allIps, [80]),
    extraIps.length ? probeIps(extraIps, EXTRA_PORTS) : Promise.resolve(new Set<string>()),
  ]);
  const alive = new Set([...baseAlive, ...extraAlive]);
  return recordRound(targets, alive, "tcp", now);
}

// ---------- 사내 저장소 쪽(2026-11-03, PING_STORE_BACKEND=internal일 때) ----------
// 규칙은 위 Firebase 쪽과 똑같다 — 같은 시 두 번이면 한 번만(서버 결과가 예비를 이김), 늦게 온 회차는 lastSample을 안 되돌림.
// 차이: Firebase 트랜잭션 대신 "그날 문서·매장 문서를 한 번에 읽고 → 한 묶음으로 쓰기". 같은 시를 동시에 두 경로가 쓰는 일은
// 예비가 서버 기록이 없을 때만(30분 뒤) 돌아서 사실상 없다.

function learnedPatch(t: PingTarget, extraOnlyIps: Set<string>, now: Date, date: string): Record<string, unknown> {
  return {
    probe1688: true,
    probe1688Auto: { at: now, reason: t.extraReason, ips: t.ips.filter((ip) => extraOnlyIps.has(ip)).length },
    ...(t.extraReason === "silent-recheck" ? { portSwitchDate: date } : {}),
  };
}

async function recordRoundInternal(targets: PingTarget[], alive: Set<string>, method: string, now: Date): Promise<RoundResult> {
  const { date, hour } = kstParts(now);
  const onById = new Map(
    targets.filter((s) => s.ips.length > 0).map((s) => {
      const n = s.ips.filter((ip) => alive.has(ip)).length;
      return [s.id, s.total > 0 ? Math.min(n, s.total) : n];
    }),
  );
  const broken = roundLooksBroken(targets, onById, hour, now, method);
  if (broken) return { ok: true, at: now.toISOString(), date, hour, method, stores: [], rejected: broken };

  const measured = targets.filter((s) => s.ips.length > 0);
  const [dailies, stores] = await Promise.all([
    istore.getMany(PING_DAILY, measured.map((s) => `${s.id}_${date}`)),
    istore.getMany(PING_STORES, measured.map((s) => s.id)),
  ]);
  const writes: Parameters<typeof istore.commit>[0] = [];
  const results = targets.map((s) => {
    if (s.ips.length === 0) return { id: s.id, name: s.name, alive: 0, total: 0, skipped: "IP 없음" };
    const aliveIps = s.ips.filter((ip) => alive.has(ip));
    const on = s.total > 0 ? Math.min(aliveIps.length, s.total) : aliveIps.length;
    const daily = dailies[`${s.id}_${date}`];
    const store = stores[s.id] ?? {};
    const prev = (daily?.hours as Record<string, { a: number; t: number; m?: string }> | undefined)?.[hour];
    if (prev != null && !shouldReplace(String(prev.m ?? ""), method)) return { id: s.id, name: s.name, alive: aliveIps.length, total: s.total, skipped: "이번 시간 이미 기록됨" };
    const last = (store.lastSample ?? {}) as { at?: unknown; date?: string; hour?: string };
    const prevAt = toDateValue(last.at);
    const sameHourLast = last.date === date && last.hour === hour;
    const newest = !prevAt || prevAt.getTime() <= now.getTime() || (prev != null && sameHourLast);
    writes.push({ op: "merge", c: PING_DAILY, id: `${s.id}_${date}`, data: { storeId: s.id, date, hours: { [hour]: { a: on, t: s.total, m: method } } } });
    writes.push({
      op: "merge",
      c: PING_STORES,
      id: s.id,
      data: {
        days: prev
          ? { [date]: { a: { __inc: on - prev.a }, t: { __inc: s.total - prev.t } } }
          : { [date]: { a: { __inc: on }, t: { __inc: s.total }, n: { __inc: 1 } } },
        ...(newest ? { lastSample: { at: now, date, hour, alive: on, total: s.total, aliveIps, method } } : {}),
        recent: { [hour]: { a: on, t: s.total, at: now } },
      },
    });
    return { id: s.id, name: s.name, alive: aliveIps.length, total: s.total };
  });
  await istore.commit(writes);
  return { ok: true, at: now.toISOString(), date, hour, method, stores: results };
}

// ---------- 마지막 회차 기록(storeEvalSystemStatus/pingMonitor) — 예비가 "이번 시 이미 기록됨"을 보는 문서 ----------
const STATUS = { c: "storeEvalSystemStatus", id: "pingMonitor" };
export async function readRoundStatus(): Promise<Record<string, unknown> | undefined> {
  if (usesInternalStore()) return (await istore.get(STATUS.c, STATUS.id)) ?? undefined;
  return (await adminDb?.collection(STATUS.c).doc(STATUS.id).get())?.data();
}
export async function writeRoundStatus(result: RoundResult): Promise<void> {
  const data = { ...result, storeCount: result.stores.length };
  if (usesInternalStore()) return istore.commit([{ op: "set", c: STATUS.c, id: STATUS.id, data }]);
  await adminDb?.collection(STATUS.c).doc(STATUS.id).set(data);
}
