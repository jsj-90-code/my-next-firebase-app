// 사람 판정(브라우저 localStorage에서 받은 JSON)을 판정 목록 CSV에 합쳐 굳힌다 — 2026-09-18.
//
//   node scripts/mergeMarketSplitJudgment.mjs
//
// 입력  .local-tools/market-split-judgment.csv       (dumpMarketSplitJudgment.mjs가 만든 목록)
//       .local-tools/market-split-judgment-raw.json  (판정 페이지의 localStorage 내용)
// 출력  .local-tools/market-split-judgment-filled.csv
//
// ⚠️ 판정 페이지는 CSV와 **같은 순서·같은 줄번호**를 쓴다(시드 20260918 고정). raw JSON의
//    키가 그 줄번호다. 목록을 다시 뽑아 순서가 바뀌면 판정이 엉뚱한 쌍에 붙는다 —
//    그래서 합칠 때 쌍 수가 맞는지 확인하고, 안 맞으면 멈춘다.
import { readFileSync, writeFileSync } from "node:fs";

const CSV = new URL("../.local-tools/market-split-judgment.csv", import.meta.url);
const RAW = new URL("../.local-tools/market-split-judgment-raw.json", import.meta.url);
const OUT = new URL("../.local-tools/market-split-judgment-filled.csv", import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}
const cell = (s) => {
  s = String(s ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = parseCsv(readFileSync(CSV, "utf8").replace(/^﻿/, ""));
if ((rows[0][0] ?? "").startsWith("#")) rows.shift();
const header = rows.shift();
const raw = JSON.parse(readFileSync(RAW, "utf8"));

if (rows.length !== Object.keys(raw).length) {
  console.error(
    `멈춘다 — 목록은 ${rows.length}쌍인데 판정은 ${Object.keys(raw).length}개다.` +
      `\n목록을 다시 뽑아 순서가 바뀌었을 수 있다. 그대로 합치면 판정이 다른 쌍에 붙는다.`,
  );
  process.exit(1);
}

const iJudge = header.indexOf("판정");
const iMemo = header.indexOf("메모");
const outHeader = [...header];
if (outHeader[iMemo] === "메모") outHeader.splice(iMemo, 0, "수요편");

let q1 = 0, q2 = 0;
const lines = [outHeader.map(cell).join(",")];
rows.forEach((r, i) => {
  const c = raw[String(i)] ?? {};
  if (c.v) q1++;
  if (c.d) q2++;
  const o = [...r];
  o[iJudge] = c.v ?? "";
  o.splice(iMemo, 0, c.d ?? "");
  o[iMemo + 1] = c.m ?? "";
  lines.push(o.map(cell).join(","));
});

writeFileSync(OUT, "﻿" + lines.join("\n") + "\n", "utf8");

const tally = {};
for (const k of Object.keys(raw)) { const v = raw[k]?.v; if (v) tally[v] = (tally[v] ?? 0) + 1; }
console.log(`합쳤다 — ${rows.length}쌍 · 1번 답 ${q1}개 · 2번 답 ${q2}개`);
console.log(`  1번 분포: ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`  -> ${OUT.pathname.replace(/^\//, "")}`);
