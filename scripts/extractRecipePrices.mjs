// 레시피 매뉴얼 PDF(쉐프앤클릭 음식/음료 상세매뉴얼)에서 메뉴명·판매가격을 뽑아 판본별로 맞춘다 (2026-09-25).
// 읽기전용 1회성 도구. Firestore·본체 무관. 상품몫 사실 확인(docs/releases/2026-09-25-product-share-drivers.md)용.
//
// ⚠️ pdftotext로는 한글이 안 나온다(폰트에 ToUnicode 없음) — 프로젝트의 pdfjs-dist(legacy)로 읽어야 메뉴명이 뽑힌다.
//    음식 매뉴얼은 "메뉴명 … 판매가격 N 원", 음료 매뉴얼(2024.06)은 "▶ 이름 HOT/ICE … 판매가 N 원" 형식.
//    음료 2026.08판은 형식이 또 달라 이 스크립트로는 1건만 잡힌다 — pdftotext 가격 나열이 2024.06판과 한 페이지 밀린 채 같아서 "변동 0"으로 읽었다.
//
// 실행: node scripts/extractRecipePrices.mjs "<PDF 폴더>"
//   폴더 안 *.pdf 전부를 읽고, 파일명 순으로 판본을 나열한다. 출력은 표준출력(표) + 폴더/menus.json.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("폴더를 주세요: node scripts/extractRecipePrices.mjs <PDF 폴더>"); process.exit(1); }
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const num = (s) => { const n = parseInt(s.replace(/[^\d]/g, ""), 10); return n >= 500 && n <= 50000 ? n : null; };

const out = {};
for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".pdf")).sort()) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(dir, f))), verbosity: 0 }).promise;
  const items = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const strs = (await (await doc.getPage(pn)).getTextContent()).items.map((i) => i.str.trim()).filter(Boolean);
    for (let i = 0; i < strs.length; i++) {
      if (strs[i] === "메뉴명") {
        const pi = strs.indexOf("판매가격", i); if (pi < 0) continue;
        const name = strs.slice(i + 1, pi).join("");
        let acc = ""; for (let j = pi + 1; j < Math.min(pi + 10, strs.length) && strs[j] !== "원"; j++) acc += strs[j];
        items.push({ page: pn, name, price: num(acc) }); i = pi;
      } else if (strs[i] === "▶") {
        let j = i + 1, name = "";
        while (j < strs.length && !/^(HOT|ICE|순서|판매가)$/.test(strs[j]) && strs[j] !== "▶") { name += strs[j]; j++; }
        const temp = strs[j] === "HOT" || strs[j] === "ICE" ? strs[j] : "";
        let pi = j; while (pi < strs.length && strs[pi] !== "판매가" && strs[pi] !== "▶") pi++;
        if (strs[pi] !== "판매가") continue;
        let acc = ""; for (let k = pi + 1; k < Math.min(pi + 6, strs.length) && strs[k] !== "원"; k++) acc += strs[k];
        items.push({ page: pn, name: name + (temp ? `(${temp})` : ""), price: num(acc) }); i = pi;
      }
    }
  }
  out[f] = items;
  console.log(`${f}: ${doc.numPages}쪽 · 메뉴 ${items.length} · 가격 없음 ${items.filter((x) => x.price == null).length}`);
}
writeFileSync(join(dir, "menus.json"), JSON.stringify(out, null, 1));

const keys = Object.keys(out);
const names = []; const seen = new Set();
for (const k of keys) for (const it of out[k]) if (!seen.has(it.name)) { seen.add(it.name); names.push(it.name); }
const by = {}; for (const k of keys) { by[k] = {}; for (const it of out[k]) by[k][it.name] = it.price; }
const pad = (s, n) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };
console.log("\n" + pad("메뉴", 30) + keys.map((_, i) => String(i + 1).padStart(7)).join(""));
for (const n of names) console.log(pad(n, 30) + keys.map((k) => String(by[k][n] ?? "-").padStart(7)).join(""));
console.log("\n[연속 판본 공통 메뉴 가격 변화]");
for (let i = 1; i < keys.length; i++) {
  const a = keys[i - 1], b = keys[i]; const c = names.filter((n) => by[a][n] && by[b][n]);
  if (!c.length) continue;
  const up = c.filter((n) => by[b][n] > by[a][n]), dn = c.filter((n) => by[b][n] < by[a][n]);
  const sa = c.reduce((s, n) => s + by[a][n], 0), sb = c.reduce((s, n) => s + by[b][n], 0);
  console.log(`  ${i}→${i + 1}: 공통 ${c.length} · 오른 ${up.length} · 내린 ${dn.length} · 합 ${(100 * (sb / sa - 1)).toFixed(1)}%  ${[...up, ...dn].map((n) => `${n} ${by[a][n]}→${by[b][n]}`).join(", ")}`);
}
