// 등록 전 확인 — 계획 파일의 각 경쟁점 IP대역을 한 번만 재서 몇 대가 대답하는지 본다(2026-10-07).
// ⚠️ 적힌 대역 안의 주소에만 보낸다. 주변 IP·/24 전체는 건드리지 않는다(사용자 2026-10-06).
// 방식은 src/lib/pingMonitor/probe.ts와 같다(포트 80·3389·1688·5040을 한 번 두드리고 끊음, 거절 = 켜짐).
// 실행: node scripts/pingMonitor/precheck.mjs --file=.local-tools/xxx-plan.json   (plan.register[].ipRanges)
// 결과: 같은 파일의 register[]에 _alive(대답 수)·_checkedAt을 적는다. 5대 이상이면 등록 후보.
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";

const file = process.argv.find((a) => a.startsWith("--file="))?.slice(7);
if (!file) throw new Error("--file= 이 필요합니다");
const plan = JSON.parse(readFileSync(file, "utf8"));

const num = (ip) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const txt = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
// "a.b.c.1~100, a.b.d.5~20" — 끝은 마지막 자리만. 255를 넘거나 거꾸로면 버린다.
function expand(ranges) {
  const out = [];
  for (const part of String(ranges).split(/[,\n;]+/)) {
    const [s, e] = part.trim().split(/\s*~\s*/);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(s ?? "")) continue;
    const last = Number(e ?? s.split(".").at(-1));
    const first = Number(s.split(".").at(-1));
    if (!(last >= first) || last > 255) continue;
    for (let n = num(s); n <= num(s) + (last - first); n++) out.push(txt(n));
  }
  return out;
}
const TIMEOUT_MS = process.platform === "win32" ? 4000 : 2000;
const knock = (ip, port) => new Promise((resolve) => {
  const s = connect({ host: ip, port }); let done = false;
  const fin = (a) => { if (done) return; done = true; s.destroy(); resolve(a); };
  s.setTimeout(TIMEOUT_MS, () => fin(false));
  s.once("connect", () => fin(true));
  s.once("error", (e) => fin(e.code === "ECONNREFUSED" || e.code === "ECONNRESET"));
});
const alive = async (ip) => (await Promise.all([80, 3389, 1688, 5040].map((p) => knock(ip, p)))).some(Boolean);

for (const r of plan.register) {
  const ips = expand(r.ipRanges);
  let hit = 0, next = 0;
  await Promise.all(Array.from({ length: Math.min(200, ips.length) }, async () => { while (next < ips.length) if (await alive(ips[next++])) hit++; }));
  r._alive = hit; r._checkedAt = new Date().toISOString();
  console.log(`${hit >= 5 ? "OK " : "-- "} ${r.ownName} ${r.name} · ${r.ipRanges} · ${hit}/${ips.length}대 대답`);
}
writeFileSync(file, JSON.stringify(plan, null, 1));
