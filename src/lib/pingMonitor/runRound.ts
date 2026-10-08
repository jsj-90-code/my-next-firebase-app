import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { parseIpRanges } from "./ipRange";
import { probeIps } from "./probe";
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

export type PingTarget = { id: string; name: string; ips: string[]; total: number };

export type RoundResult = {
  ok: true;
  at: string;
  date: string;
  hour: string;
  method: string;
  stores: { id: string; name: string; alive: number; total: number; skipped?: string }[];
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
    };
  });
}

/** 켜진 IP 집합을 받아 매장별로 저장한다. */
export async function recordRound(targets: PingTarget[], alive: Set<string>, method: string, now = new Date()): Promise<RoundResult> {
  const db = requireDb();
  const { date, hour } = kstParts(now);

  const results = await Promise.all(
    targets.map(async (s) => {
      const aliveIps = s.ips.filter((ip) => alive.has(ip));
      if (s.ips.length === 0) return { id: s.id, name: s.name, alive: 0, total: 0, skipped: "IP 없음" };
      const dailyRef = db.collection(PING_DAILY).doc(`${s.id}_${date}`);
      const storeRef = db.collection(PING_STORES).doc(s.id);
      const written = await db.runTransaction(async (tx) => {
        const daily = await tx.get(dailyRef);
        if (daily.exists && daily.get(`hours.${hour}`) != null) return false;
        tx.set(dailyRef, { storeId: s.id, date, hours: { [hour]: { a: aliveIps.length, t: s.total, m: method } } }, { merge: true });
        tx.set(
          storeRef,
          {
            days: { [date]: { a: FieldValue.increment(aliveIps.length), t: FieldValue.increment(s.total), n: FieldValue.increment(1) } },
            lastSample: { at: now, date, hour, alive: aliveIps.length, total: s.total, aliveIps, method },
            recent: { [hour]: { a: aliveIps.length, t: s.total, at: now } },
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

/**
 * 1688 보충(2026-10-08 밤) — 측정 서버(Oracle)에 1688이 들어가기 전 다리. `probe1688: true`인 매장(1688에만 대답하는 곳 —
 * 평택 뉴블랙 소사벌·비전, 욜로)만 1688로 다시 재서, 서버가 이번 시에 못 잡은 IP를 그 시 기록에 더한다(합집합).
 * 한 시에 한 번만(m에 "1688"이 붙으면 끝). 서버 기록이 없으면 아무것도 안 한다.
 */
export async function supplement1688(now = new Date()): Promise<{ stores: number; added: number }> {
  const db = requireDb();
  const { date, hour } = kstParts(now);
  const snap = await db.collection(PING_STORES).where("probe1688", "==", true).get();
  const stores = snap.docs
    .filter((d) => d.get("active") === true)
    .map((d) => ({ ref: d.ref, id: d.id, ips: parseIpRanges(String(d.get("ipRanges") ?? "")).ips }));
  const alive = await probeIps(stores.flatMap((s) => s.ips), [1688]);
  let added = 0;
  for (const s of stores) {
    const dailyRef = db.collection(PING_DAILY).doc(`${s.id}_${date}`);
    added += await db.runTransaction(async (tx) => {
      const [daily, store] = await Promise.all([tx.get(dailyRef), tx.get(s.ref)]);
      const h = daily.exists ? daily.get(`hours.${hour}`) : null;
      const ls = store.get("lastSample");
      if (!h || String(h.m).includes("1688") || ls?.date !== date || ls?.hour !== hour) return 0;
      const base = new Set<string>(ls.aliveIps ?? []);
      const extra = s.ips.filter((ip) => alive.has(ip) && !base.has(ip));
      tx.update(dailyRef, { [`hours.${hour}.a`]: h.a + extra.length, [`hours.${hour}.m`]: `${h.m}+1688` });
      if (extra.length)
        tx.update(s.ref, {
          [`days.${date}.a`]: FieldValue.increment(extra.length),
          [`recent.${hour}.a`]: FieldValue.increment(extra.length),
          "lastSample.alive": (ls.alive ?? base.size) + extra.length,
          "lastSample.aliveIps": [...base, ...extra],
          "lastSample.method": `${ls.method}+1688`,
        });
      return extra.length;
    });
  }
  return { stores: stores.length, added };
}

/** Vercel에서 TCP만으로 재는 예비 경로. */
export async function runPingRound(now = new Date()): Promise<RoundResult> {
  const targets = await loadTargets();
  // 모든 매장의 IP를 한 번에 확인한다(매장마다 기다리면 2초×매장 수가 된다).
  const alive = await probeIps(targets.flatMap((s) => s.ips));
  return recordRound(targets, alive, "tcp", now);
}
