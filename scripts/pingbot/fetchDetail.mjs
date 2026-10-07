// 옛 핑봇 매장 편집 화면에서 IP대역·좌표를 읽는다(읽기만, 저장 버튼은 누르지 않는다) — 2026-10-07.
// 로그인한 크롬(--remote-debugging-port=9222)의 핑봇 탭 안에서 fetch로 HTML을 받아 파싱한다.
// 실행: node scripts/pingbot/fetchDetail.mjs 2217 2293 ...   → .local-tools/pingbot-ip-detail.json에 합친다
//       --dump=IDX 는 그 화면 HTML 일부를 보여 준다(구조 확인용).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, evaluate, pickTarget } from "./cdp127.mjs";

const OUT = ".local-tools/pingbot-ip-detail.json";
const dump = process.argv.find((a) => a.startsWith("--dump="))?.slice(7);
const ids = dump ? [dump] : process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const t = await pickTarget("ping.isens.camp");
const cdp = connect(t.webSocketDebuggerUrl); await cdp.ready;
const get = (idx) => evaluate(cdp, `fetch("/store/add_franchise?mode=edit&idx=${idx}", {credentials:"include"}).then(r=>r.text())`);
if (dump) {
  const h = await get(dump);
  for (const k of ["ips1", "lat", "lng", "raddr", "addr"]) { let i = h.indexOf(k); let n = 0; while (i >= 0 && n++ < 3) { console.log(`--- ${k} @${i}\n` + h.slice(Math.max(0, i - 150), i + 250)); i = h.indexOf(k, i + 1); } }
  cdp.close(); process.exit(0);
}
let x = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
if (typeof x === "string") x = JSON.parse(x);
for (const idx of ids) {
  const h = await get(idx);
  x[idx] = parse(h);
  console.log(idx, JSON.stringify(x[idx]));
  await new Promise((s) => setTimeout(s, 500));
}
writeFileSync(OUT, JSON.stringify(x));
cdp.close();
function parse(h) {
  const starts = [...h.matchAll(/ips1\[ips1\.length\]\s*=\s*'([\d.]+)'/g)].map((m) => m[1]);
  const ends = [...h.matchAll(/ips1_end\[ips1_end\.length\]\s*=\s*'(\d*)'/g)].map((m) => m[1]);
  const v = (id) => h.match(new RegExp(`\\$\\("#${id}"\\)\\.val\\("([^"]*)"\\)`))?.[1] ?? "";
  return { ranges: starts.map((s, i) => `${s}~${ends[i] ?? ""}`), lat: Number(v("lat")) || 0, lng: Number(v("lng")) || 0, raddr: v("raddr34") };
}
