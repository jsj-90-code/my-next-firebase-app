// 경쟁점 가동률 측정 서버 에이전트(2026-10-06) — Oracle 무료 서버(도쿄, opc@168.110.12.33:~/ping-agent)에서 매시 5분에 돈다.
// 1) 등록 IP 목록을 받고 2) 핑·TCP·ICMP 타임스탬프를 동시에 재서 3) 응답 IP의 합집합을 보낸다.
// 요청은 이 서버 안에서 만든 열쇠(agent.key)로 서명한다 — 웹은 공개 열쇠로 확인만 한다(src/lib/pingMonitor/agentAuth.ts).
// 왜 핑과 TCP 둘 다: 2026-10-06 106곳 실측에서 핑에만 대답 23곳·TCP에만 15곳(docs/ping-monitor.md).
// ⚠️ 등록된 IP대역 안의 주소에만 보낸다 — 범위 밖(공유기·다른 기기·다른 사업장일 수 있음)으론 절대 보내지 않는다(사용자 2026-10-06).
// 설치·갱신: scripts/pingMonitor/agent/README.md
import { createHash, createPrivateKey, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { timestampAll, combineResponses } from "./timestamp.mjs";

const BASE = process.env.PING_MONITOR_BASE ?? "https://my-next-firebase-app-one.vercel.app";
const DRY = process.argv.includes("--dry");
const key = createPrivateKey(readFileSync(new URL("./agent.key", import.meta.url)));

function signedHeaders(method, path, body) {
  const ts = String(Math.floor(Date.now() / 1000));
  const hash = createHash("sha256").update(body).digest("hex");
  const sig = sign(null, Buffer.from(`${ts}\n${method}\n${path}\n${hash}`), key).toString("base64");
  return { "x-ping-agent-ts": ts, "x-ping-agent-sig": sig };
}

// fping은 못 깐다 — 무료 서버(메모리 1GB)에서 dnf가 EPEL 목록을 읽다 메모리 부족으로 두 번 죽었다(2026-10-06).
// 그래서 원래 있는 ping을 여러 개 동시에 돌린다. 두 번 보내 하나라도 오면 켜짐.
function pingOne(ip) {
  return new Promise((resolve) => {
    const p = spawn("ping", ["-n", "-q", "-c", "2", "-i", "0.2", "-W", "1", ip], { stdio: "ignore" });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

async function pingAll(ips) {
  const alive = new Set();
  let next = 0;
  async function worker() {
    while (next < ips.length) {
      const ip = ips[next++];
      if (await pingOne(ip)) alive.add(ip);
    }
  }
  await Promise.all(Array.from({ length: Math.min(40, ips.length) }, worker));
  return alive;
}

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
    s.setTimeout(2000, () => finish(false));
    s.once("connect", () => finish(true));
    s.once("error", (e) => finish(e.code === "ECONNREFUSED" || e.code === "ECONNRESET"));
  });
}

async function tcpAll(ips) {
  const alive = new Set();
  let next = 0;
  async function worker() {
    while (next < ips.length) {
      const ip = ips[next++];
      const r = await Promise.all([80, 3389].map((port) => knock(ip, port)));
      if (r.some(Boolean)) alive.add(ip);
    }
  }
  await Promise.all(Array.from({ length: Math.min(120, ips.length) }, worker));
  return alive;
}

const started = new Date();
const tPath = "/api/ping-monitor/agent/targets";
const tRes = await fetch(BASE + tPath, { headers: signedHeaders("GET", tPath, "") });
if (!tRes.ok) throw new Error(`목록 받기 실패 ${tRes.status}: ${await tRes.text()}`);
const { targets } = await tRes.json();
const ips = [...new Set(targets.flatMap((t) => t.ips))];

const [byPing, byTcp, byTimestamp] = await Promise.all([
  pingAll(ips), tcpAll(ips),
  timestampAll(ips).catch((error) => {
    console.error(`타임스탬프 검사 실패 — 이번 회차는 기존 핑+TCP만 사용: ${error.message}`);
    return null;
  }),
]);
const { alive, method, timestampOnly } = combineResponses(ips, byPing, byTcp, byTimestamp);
const pingOnly = [...byPing].filter((ip) => !byTcp.has(ip)).length;
const tcpOnly = [...byTcp].filter((ip) => !byPing.has(ip)).length;
const secs = ((Date.now() - started.getTime()) / 1000).toFixed(0);
console.log(`${started.toISOString()} 매장 ${targets.length} · IP ${ips.length} · 응답 ${alive.length}(핑 ${byPing.size} · TCP ${byTcp.size} · 핑만 ${pingOnly} · TCP만 ${tcpOnly} · 타임스탬프 ${byTimestamp?.size ?? "실패"} · 타임스탬프만 ${timestampOnly}) · ${method} · ${secs}초`);
if (DRY) process.exit(0);

const rPath = "/api/ping-monitor/agent/results";
const body = JSON.stringify({ at: started.toISOString(), method, aliveIps: alive });
const rRes = await fetch(BASE + rPath, { method: "POST", headers: { "content-type": "application/json", ...signedHeaders("POST", rPath, body) }, body });
console.log(`보냄 ${rRes.status}: ${await rRes.text()}`);
if (!rRes.ok) process.exit(1);
