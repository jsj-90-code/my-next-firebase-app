// 핑봇 매장관리 표 전체를 긁어 .local-tools/pingbot-all.json 에 저장한다. (사람이 로그인한 크롬에 CDP로 붙는다 — README)
import { writeFileSync } from "node:fs";
import { pickTarget, connect, evaluate } from "./cdp127.mjs";

const t = await pickTarget("ping.isens.camp");
if (!t) { console.error("ping.isens.camp 탭이 없다. 디버깅 포트 크롬에서 /store?showall=1 을 열고 로그인할 것."); process.exit(1); }
const cdp = connect(t.webSocketDebuggerUrl); await cdp.ready; await cdp.send("Runtime.enable");
const expr = `JSON.stringify({
  period: (document.querySelectorAll('table')[1] || {textContent:''}).textContent.trim(),
  rows: [...(document.querySelectorAll('table')[3] || {rows:[]}).rows].slice(1).map(r => {
    const c = r.cells; const spans = c[1] ? c[1].querySelectorAll('span') : [];
    return { idx: r.getAttribute('data-idx'), title: spans[0] ? spans[0].textContent.trim() : '', gpu: spans[2] ? spans[2].textContent.trim() : '',
      addr: spans[3] ? spans[3].textContent.trim() : '', util: c[2] ? c[2].textContent.trim() : '', kind: c[3] ? c[3].textContent.trim() : '' };
  })
})`;
const json = await evaluate(cdp, expr);
cdp.close();
const data = JSON.parse(json);
if (!data.rows.length) { console.error("행이 0개 — 로그인 전이거나 표 구조가 바뀌었다. URL:", t.url); process.exit(1); }
writeFileSync(new URL("../../.local-tools/pingbot-all.json", import.meta.url), JSON.stringify({ scrapedAt: new Date().toISOString(), url: t.url, ...data }, null, 1));
console.log(`창 ${data.period} · ${data.rows.length}행 → .local-tools/pingbot-all.json`);
