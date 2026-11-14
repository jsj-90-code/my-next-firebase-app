// 경쟁점 가동률 측정 서버 에이전트(2026-10-06) — Oracle 무료 서버(도쿄, opc@168.110.12.33:~/ping-agent)에서 매시 5분에 돈다.
// 1) 등록 IP 목록을 받고 2) 핑·TCP·ICMP 타임스탬프를 동시에 재서 3) 응답 IP의 합집합을 보낸다.
// 요청은 이 서버 안에서 만든 열쇠(agent.key)로 서명한다 — 웹은 공개 열쇠로 확인만 한다(src/lib/pingMonitor/agentAuth.ts).
// 왜 핑과 TCP 둘 다: 2026-10-06 106곳 실측에서 핑에만 대답 23곳·TCP에만 15곳(docs/ping-monitor.md).
// ⚠️ 등록된 IP대역 안의 주소에만 보낸다 — 범위 밖(공유기·다른 기기·다른 사업장일 수 있음)으론 절대 보내지 않는다(사용자 2026-10-06).
// 설치·갱신: scripts/pingMonitor/agent/README.md
import { createHash, createPrivateKey, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

// 기본 포트는 전 IP(80). extraByIp에 있는 IP(1688·5040 필요한 매장)만 그 포트를 더 두드린다 —
// 전 매장에 1688·5040을 다 쏘면 작은 서버(498MB)가 버벅인다(2026-10-09 최적화). extraByIp: Map<ip, number[]>.
// extraOnly: 추가 포트로만 대답한 IP — 웹이 이걸 보고 그 매장에 1688·5040을 계속 보낼지 스스로 정한다(2026-10-14 자동 학습).
// 3389(윈도우 원격접속)는 뺐다(2026-10-28): 저장 안 하는 진단 측정에서 3389로만 잡히는 IP가 0개 —
// 핑·80·타임스탬프가 이미 다 덮어 측정 손실이 없고, 보안 장비에 '원격접속 탐색'으로 오인될 소지만 컸다.
// 조회 안 되는 매장이 생기면 그 매장 extraPorts에 3389를 넣어 되살릴 수 있다(매장 단위, 전 IP 아님).
async function tcpAll(ips, extraByIp) {
  const alive = new Set();
  const extraOnly = new Set();
  let next = 0;
  async function worker() {
    while (next < ips.length) {
      const ip = ips[next++];
      const ports = [80, ...(extraByIp.get(ip) ?? [])];
      const r = await Promise.all(ports.map((port) => knock(ip, port)));
      if (r.some(Boolean)) alive.add(ip);
      if (!r[0] && r.slice(1).some(Boolean)) extraOnly.add(ip);
    }
  }
  await Promise.all(Array.from({ length: Math.min(120, ips.length) }, worker));
  return { alive, extraOnly };
}

// 웹 요청은 시간 제한 + 다시 시도(2026-10-08 — 한 번 실패로 회차 전체를 잃지 않게). 서명은 시도마다 새로 만든다(5분 넘으면 거절).
// waits: 시도 사이 쉬는 시간. 밀린 회차 재전송은 한 번만 해 본다(ONCE) — 웹이 멈춰 있으면 다음 회차에 어차피 다시 보내니,
// 4번 시도(최대 약 9분)를 밀린 회차에 쓰면 이번 회차 측정·전송이 50분 제한(timeout 3000)에 걸릴 수 있다(2026-11-15).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY = [0, 20_000, 60_000, 120_000];
const ONCE = [0];
// 웹 쪽 답이 아니라 "웹이 지금 없다"는 4xx — Vercel이 프로젝트를 멈추면(무료 한도 초과) 402 DEPLOYMENT_DISABLED 같은 4xx를 준다.
// 이걸 우리 라우트의 4xx(측정 시각 이상·서명 거절 = 다시 보내도 같음)처럼 다루면 pending을 지우고 이번 회차도 버린다 → 5xx처럼 남긴다(2026-11-15).
// x-vercel-error 머리글이 붙은 답은 Vercel 플랫폼이 낸 것(우리 코드까지 안 감)이다.
function webUnavailable(res) {
  return res.headers.get("x-vercel-error") != null || [402, 404, 408, 425, 429].includes(res.status);
}
async function call(method, path, body, waits = RETRY) {
  let last;
  for (const wait of waits) {
    if (wait) await sleep(wait);
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...signedHeaders(method, path, body ?? "") },
        body: body ?? undefined,
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && !webUnavailable(res))) return res; // 우리 라우트의 4xx는 다시 해도 같다
      last = new Error(`${res.status}${res.headers.get("x-vercel-error") ? ` ${res.headers.get("x-vercel-error")}` : ""}: ${(await res.text()).slice(0, 300)}`);
    } catch (error) {
      last = error;
    }
    console.error(`${method} ${path} 실패 — ${last.message}`);
  }
  throw last;
}

// 못 보낸 회차는 pending/에 두고 다음 회차 시작 때 다시 보낸다. 웹은 잰 시각(at)의 시(時)로 묶고 35일까지 받는다(2026-11-15, 전엔 6시간).
// 웹이 오래 멈추면(Vercel 정지 최대 30일) pending이 수백 개 쌓인다 — 회차마다 오래된 것부터 PENDING_PER_ROUND개만 보낸다.
//   - 한꺼번에 다 보내면: 이번 회차 측정이 그만큼 늦어지고(50분 제한), 웹 함수·저장소(Firestore 쓰기 한도)에 한 번에 몰린다.
//   - 6개면 매시 6회차씩 따라잡는다 — 30일(720회차) 밀려도 약 5일이면 다 보내고, 웹은 35일까지 받아 오래된 것부터 안 버려진다.
//   - 하나라도 못 보내면 그 회차 재전송은 멈춘다(웹이 아직 안 돌아옴 — 나머지도 실패할 것이라 시간만 쓴다).
//   - 서버 메모리가 작아(498MB) 파일 이름만 정렬해서 하나씩 읽는다.
// 지우는 규칙은 그대로: 우리 라우트가 답한 4xx(35일 지남·서명 거절 등)면 지운다 — 다시 보내도 안 받는다. 5xx·네트워크 오류·웹 멈춤(webUnavailable)이면 남긴다.
const PENDING_PER_ROUND = 6;
const PENDING = new URL("./pending/", import.meta.url);
const rPath = "/api/ping-monitor/agent/results";
mkdirSync(PENDING, { recursive: true });
if (!DRY) {
  const names = readdirSync(PENDING).filter((n) => n.endsWith(".json")).sort();
  for (const f of names.slice(0, PENDING_PER_ROUND)) {
    const file = new URL(f, PENDING);
    try {
      const res = await call("POST", rPath, readFileSync(file, "utf8"), ONCE);
      console.log(`밀린 회차 ${f} 보냄 ${res.status}: ${await res.text()}`);
      unlinkSync(file);
    } catch (error) {
      console.error(`밀린 회차 ${f} 아직 못 보냄 — 이번 회차 재전송은 여기서 멈춤: ${error.message}`);
      break;
    }
  }
  if (names.length > PENDING_PER_ROUND) console.log(`밀린 회차 ${names.length}개 중 ${PENDING_PER_ROUND}개까지만 이번에 보냄 — 나머지는 다음 회차에`);
}

// 지난 회차가 timeout으로 죽으면 node만 죽고 sudo python 타임스탬프 helper는 남을 수 있다 — 메모리 498MB라 쌓이면 서버가 멈춘다.
// cron은 flock으로 한 번에 하나만 돌리므로 지금 남아 있는 helper는 전부 낡은 것이다(2026-10-08).
await new Promise((r) => spawn("sudo", ["-n", "pkill", "-f", "timestamp_prob[e]\.py"], { stdio: "ignore" }).on("close", r).on("error", r));

const started = new Date();
const tPath = "/api/ping-monitor/agent/targets";
// 목록 캐시(2026-11-15) — 목록을 받으면 targets-cache.json에 저장하고, 못 받으면(웹 멈춤) 저장해 둔 목록으로 잰다.
// 예전엔 여기서 throw해 측정 자체를 안 했고 pending도 안 남아 웹이 멈춘 기간이 통째로 비었다.
// 캐시로 잰 회차도 매장별 IP 수·IP 지문(measured·measuredIps)을 같이 보내므로, 그사이 IP가 바뀐 매장은 웹이 기록에서 뺀다.
// 캐시도 없으면 예전처럼 실패한다.
const CACHE = new URL("./targets-cache.json", import.meta.url);
let targets;
try {
  const tRes = await call("GET", tPath);
  if (!tRes.ok) throw new Error(`목록 받기 실패 ${tRes.status}: ${await tRes.text()}`);
  const text = await tRes.text();
  ({ targets } = JSON.parse(text));
  if (!Array.isArray(targets)) throw new Error("목록 모양이 이상합니다");
  const tmp = new URL("./targets-cache.json.tmp", import.meta.url);
  writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), targets }));
  renameSync(tmp, CACHE); // 쓰다 죽어도 옛 캐시가 반쯤 쓴 파일로 바뀌지 않게
} catch (error) {
  if (!existsSync(CACHE)) throw error;
  const cached = JSON.parse(readFileSync(CACHE, "utf8"));
  targets = cached.targets;
  console.error(`목록 받기 실패 — 저장해 둔 목록(${cached.savedAt})으로 잰다: ${error.message}`);
}
const ips = [...new Set(targets.flatMap((t) => t.ips))];
// IP별 추가 포트 — 그 IP가 속한 매장에 extraPorts가 있으면 모은다(여러 매장이 같은 IP면 합집합).
const extraByIp = new Map();
for (const t of targets) if (t.extraPorts?.length) for (const ip of t.ips) extraByIp.set(ip, [...new Set([...(extraByIp.get(ip) ?? []), ...t.extraPorts])]);

const [byPing, { alive: byTcp, extraOnly }, byTimestamp] = await Promise.all([
  pingAll(ips), tcpAll(ips, extraByIp),
  timestampAll(ips).catch((error) => {
    console.error(`타임스탬프 검사 실패 — 이번 회차는 기존 핑+TCP만 사용: ${error.message}`);
    return null;
  }),
]);
const { alive, method, timestampOnly } = combineResponses(ips, byPing, byTcp, byTimestamp);
const pingOnly = [...byPing].filter((ip) => !byTcp.has(ip)).length;
const tcpOnly = [...byTcp].filter((ip) => !byPing.has(ip)).length;
// 핑·타임스탬프로도 안 잡히고 1688·5040으로만 잡힌 IP만 — 그 매장은 추가 포트가 있어야 재진다.
const extraOnlyIps = [...extraOnly].filter((ip) => !byPing.has(ip) && !byTimestamp?.has(ip));
const secs = ((Date.now() - started.getTime()) / 1000).toFixed(0);
console.log(`${started.toISOString()} 매장 ${targets.length} · IP ${ips.length} · 응답 ${alive.length}(핑 ${byPing.size} · TCP ${byTcp.size} · 핑만 ${pingOnly} · TCP만 ${tcpOnly} · 타임스탬프 ${byTimestamp?.size ?? "실패"} · 타임스탬프만 ${timestampOnly} · 추가포트만 ${extraOnlyIps.length}) · ${method} · ${secs}초`);
if (DRY) process.exit(0);

// measured: 이번 회차에 실제로 잰 매장과 IP 수 — 회차 도중 등록·IP 변경된 매장을 웹이 0대로 적지 않게(2026-10-14 제주 노형 14시 가짜 0대).
const measured = Object.fromEntries(targets.map((t) => [t.id, t.ips.length]));
// measuredIps: 매장별 IP 목록 지문 — IP 수는 같고 대역만 바뀐 매장도 웹이 거른다(밀린 회차·캐시 목록, 2026-11-15). 웹 results route의 ipListKey와 같아야 한다.
const ipListKey = (list) => createHash("sha256").update(list.join(",")).digest("hex").slice(0, 16);
const measuredIps = Object.fromEntries(targets.map((t) => [t.id, ipListKey(t.ips)]));
const body = JSON.stringify({ at: started.toISOString(), method, aliveIps: alive, extraOnlyIps, measured, measuredIps });
// --local: 웹에 안 보내고 compare/에만 남긴다(2026-11-04 품의 승인 — 사내 서버가 기록, 해외 서버는 1~2주 대조용).
// 같은 시에 두 서버가 다 보내면 서로 덮어쓰므로 대조하는 쪽은 반드시 --local. --copy: 보내면서 compare/에도 사본(사내 쪽).
// 대조: scripts/pingMonitor/agent/compareRounds.mjs
if (process.argv.includes("--local") || process.argv.includes("--copy")) {
  const dir = new URL("./compare/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${started.toISOString().slice(0, 13)}.json`, dir), body);
  if (process.argv.includes("--local")) {
    console.log(`대조용으로 compare/에 저장(웹에 안 보냄)`);
    process.exit(0);
  }
}
try {
  const rRes = await call("POST", rPath, body);
  console.log(`보냄 ${rRes.status}: ${await rRes.text()}`);
  if (!rRes.ok) process.exit(1); // 우리 라우트의 4xx — 다시 보내도 같다(웹 멈춤 4xx는 call이 실패로 던져 아래 pending으로 간다)
} catch (error) {
  writeFileSync(new URL(`${started.toISOString().replace(/[:.]/g, "-")}.json`, PENDING), body);
  console.error(`보내기 실패 — pending/에 두고 다음 회차에 다시 보낸다: ${error.message}`);
  process.exit(1);
}
