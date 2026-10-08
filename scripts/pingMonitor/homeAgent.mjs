// 경쟁점 가동률 측정 — 집/회사 PC 대리 측정(2026-10-08 밤, Oracle 서버가 멈추고 콘솔 로그인이 막혀 재부팅 못 한 동안).
// Oracle 에이전트(agent/agent.mjs)와 같은 핑 + TCP(80·3389·1688·5040)를 이 PC에서 재고, 웹을 거치지 않고 Firestore에 직접 쓴다.
// 저장은 src/lib/pingMonitor/runRound.ts recordRound와 같은 모양·같은 "같은 시(時)는 먼저 쓴 쪽만" 규칙 — 서버가 살아나도 겹쳐 세지 않는다.
// 타임스탬프 측정은 없다(관리자 권한 raw 소켓이 필요) — method는 "home-icmp+tcp".
// ⚠️ 등록된 IP대역 안의 주소에만 보낸다(사용자 규칙 2026-10-06).
//   node scripts/pingMonitor/homeAgent.mjs --dry   ← 재기만
//   node scripts/pingMonitor/homeAgent.mjs         ← 재고 저장
// 매시 실행: 작업 스케줄러 "PingMonitorHome"(매시 5분). 끄기: schtasks /Delete /TN PingMonitorHome /F
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { parseIpRanges } from "../../src/lib/pingMonitor/ipRange.ts";

const DRY = process.argv.includes("--dry");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();

// 겹쳐 돌지 않게(앞 회차가 길어지면 이번 회차는 건너뜀). 50분 넘은 잠금은 낡은 것으로 본다.
const LOCK = join(tmpdir(), "ping-monitor-home.lock");
try {
  if (Date.now() - statSync(LOCK).mtimeMs > 50 * 60_000) unlinkSync(LOCK);
} catch {}
let lockFd;
try {
  lockFd = openSync(LOCK, "wx");
} catch {
  console.log(`${new Date().toISOString()} 앞 회차가 아직 도는 중 — 건너뜀`);
  process.exit(0);
}
const unlock = () => { try { closeSync(lockFd); unlinkSync(LOCK); } catch {} };
process.on("exit", unlock);

// Windows ping은 "대상 호스트에 연결할 수 없습니다"(공유기 응답)에도 0을 돌려줄 때가 있다 → 응답에 TTL=가 있어야 켜짐.
function pingOne(ip) {
  return new Promise((resolve) => {
    const p = spawn("ping", ["-n", "2", "-w", "1000", ip], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(/TTL=/i.test(out)));
    p.on("error", () => resolve(false));
  });
}

// 켜진 PC는 "연결 거절"을 바로 돌려준다. Windows는 거절이 ~2.1초 늦게 와서 대기 4초(docs/ping-monitor.md).
function knock(ip, port) {
  return new Promise((resolve) => {
    const s = connect({ host: ip, port });
    let done = false;
    const finish = (alive) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(alive);
    };
    s.setTimeout(4000, () => finish(false));
    s.once("connect", () => finish(true));
    s.once("error", (e) => finish(e.code === "ECONNREFUSED" || e.code === "ECONNRESET"));
  });
}

async function pool(items, size, fn) {
  const alive = new Set();
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const ip = items[next++];
      if (await fn(ip)) alive.add(ip);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return alive;
}

const kstParts = (d) => {
  const iso = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return { date: iso.slice(0, 10), hour: iso.slice(11, 13) };
};

const started = new Date();
const { date, hour } = kstParts(started);
const snap = await db.collection("pingMonitorStores").where("active", "==", true).get();
const targets = snap.docs.map((d) => {
  const data = d.data();
  const ips = parseIpRanges(String(data.ipRanges ?? "")).ips;
  return { id: d.id, name: String(data.name ?? ""), ips, total: data.pcCount && data.pcCount > 0 ? data.pcCount : ips.length };
});
const ips = [...new Set(targets.flatMap((t) => t.ips))];

const [byPing, byTcp] = await Promise.all([
  pool(ips, 100, pingOne),
  pool(ips, 250, async (ip) => (await Promise.all([80, 3389, 1688, 5040].map((port) => knock(ip, port)))).some(Boolean)),
]);
const alive = new Set([...byPing, ...byTcp]);
const method = "home-icmp+tcp";
const secs = ((Date.now() - started.getTime()) / 1000).toFixed(0);
console.log(`${started.toISOString()} ${date} ${hour}시 · 매장 ${targets.length} · IP ${ips.length} · 응답 ${alive.size}(핑 ${byPing.size} · TCP ${byTcp.size}) · ${secs}초`);
if (DRY) process.exit(0);

// 측정이 다음 시로 넘어가도 잰 시작 시각의 시(時)로 묶는다(서버 에이전트와 같음).
let written = 0;
const stores = await Promise.all(
  targets.map(async (s) => {
    const aliveIps = s.ips.filter((ip) => alive.has(ip));
    if (s.ips.length === 0) return { id: s.id, name: s.name, alive: 0, total: 0, skipped: "IP 없음" };
    const dailyRef = db.collection("pingMonitorDaily").doc(`${s.id}_${date}`);
    const storeRef = db.collection("pingMonitorStores").doc(s.id);
    const ok = await db.runTransaction(async (tx) => {
      const daily = await tx.get(dailyRef);
      if (daily.exists && daily.get(`hours.${hour}`) != null) return false;
      tx.set(dailyRef, { storeId: s.id, date, hours: { [hour]: { a: aliveIps.length, t: s.total, m: method } } }, { merge: true });
      tx.set(
        storeRef,
        {
          days: { [date]: { a: FieldValue.increment(aliveIps.length), t: FieldValue.increment(s.total), n: FieldValue.increment(1) } },
          lastSample: { at: started, date, hour, alive: aliveIps.length, total: s.total, aliveIps, method },
          recent: { [hour]: { a: aliveIps.length, t: s.total, at: started } },
        },
        { merge: true },
      );
      return true;
    });
    if (ok) written++;
    return { id: s.id, name: s.name, alive: aliveIps.length, total: s.total, ...(ok ? {} : { skipped: "이번 시간 이미 기록됨" }) };
  }),
);
await db.collection("storeEvalSystemStatus").doc("pingMonitor")
  .set({ ok: true, at: started.toISOString(), date, hour, method, stores, storeCount: stores.length });
console.log(`저장 ${written}곳 (이미 기록 ${stores.filter((s) => s.skipped === "이번 시간 이미 기록됨").length})`);
