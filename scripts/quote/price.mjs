// 견적서 원가(단가표) 갱신 — 모델명으로 블랙·골드 원본의 원가 칸을 찾아 미리보기·적용 (2026-10-23, "견적서" 스킬이 부름)
//   node scripts/quote/price.mjs preview <단가표.json> [--books black,gold] [--skip "탭:행,..."] [--tabs all]   찾기(기본 PC 탭만) + 원본 안 임시 탭에서 계산해 본 마진 변화(시트는 그대로)
//   node scripts/quote/price.mjs apply [계획.json] [--prices 단가.json]        미리보기 계획대로 원가(+정한 판매 단가) 쓰기
// 단가표.json: [{ "항목": "그래픽카드", "모델": "RTX5060 8GB", "가격": 565000 }]  ← 가격은 부가세 포함(받은 그대로)
// 단가.json:   [{ "book": "black", "tab": "PC 및 주변 기기 내역", "row": 18, "price": 700000 }]  ← 판매 단가(부가세 별도)
// 원가 칸은 부가세 별도라 가격 ÷ 1.1(원 단위 반올림). '매입가 (VAT 포함)' 칸이 있는 탭(서버)은 거기에 받은 가격을 그대로.
// 원가 칸이 수식(예: 32GB = 16GB×2)이면 건드리지 않는다 — 따라 바뀐다. "*4EA"처럼 묶음 표시가 있으면 ×4로 넣고 미리보기에 표시.
// 적용 뒤 영업부용 반영은 sync.mjs로 따로(스킬이 이어서 실행).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { sheets, BOOKS, TABS, colName, q } from "./lib.mjs";

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const PLAN = join(homedir(), ".isens-quote", "last-plan.json");
const PREVIEW = "__단가미리보기_";
// --test: 시험용 사본(lib.mjs BOOKS.*.test)에 — 스킬 고칠 때 확인용
const origOf = (bk) => { if (!args.includes("--test")) return BOOKS[bk].orig; if (!BOOKS[bk].test) throw new Error(`${BOOKS[bk].label}은 시험용 사본이 없다`); return BOOKS[bk].test.orig; };
// 평소 단가 갱신은 PC 탭만(10-23 사용자: 서버·가구·인테리어는 변동이 잦지 않음). --tabs all이면 품목 탭 전부
const ITEM_TABS = args.includes("all") && opt("--tabs") === "all" ? TABS.map(([o]) => o).filter((t) => !["정보입력(댓수,평수)", "최종", "표지"].includes(t)) : ["PC 및 주변 기기 내역"];
const norm = (s) => String(s || "").toLowerCase().replace(/[\s•·:_\-()]/g, "");
const won = (n) => (n == null || n === "" ? "-" : Math.round(n).toLocaleString("ko-KR"));
const roundPrice = (x) => { const u = Math.abs(x) >= 100000 ? 10000 : 1000; return Math.round(x / u) * u; };

async function readTab(id, title) {
  const [f, v] = await Promise.all(["FORMULA", "UNFORMATTED_VALUE"].map((o) =>
    sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${q(title)}!A1:O200`, valueRenderOption: o }).then((r) => r.data.values || [])));
  const h = v.findIndex((r) => String(r[4] || "").includes("상세 내역"));
  if (h < 0) return null;
  const head = v[h].map((x) => String(x || ""));
  const find = (re) => head.findIndex((x) => re.test(x));
  let costCol = find(/부품별 원가/); if (costCol < 0) costCol = find(/원가\(수정\)/);
  const vatCol = find(/VAT 포함/), costSumCol = find(/원가\(수정\)/);
  let end = v.findIndex((r, i) => i > h && String(r[1] || "").startsWith("합계 금액")); if (end < 0) end = v.length;
  return { f, v, h, end, costCol, vatCol, costSumCol, totalCol: find(/^원가 합계/) };
}
const isFormula = (x) => String(x ?? "").startsWith("=");

// 판매 단위 줄(단가 F가 숫자인 줄)의 단위당 원가 K와 원가 합계 L
function saleLines(t) {
  const out = {};
  for (let r = t.h + 1; r < t.end; r++) {
    const F = t.v[r]?.[5], K = t.v[r]?.[t.costSumCol], L = t.v[r]?.[t.totalCol], G = t.v[r]?.[6];
    if (typeof F === "number" && (typeof K === "number" || typeof L === "number"))
      out[r + 1] = { F, K, L, G, name: String(t.v[r][4] || "").slice(0, 40), fFormula: isFormula(t.f[r]?.[5]) ? t.f[r][5] : null };
  }
  return out;
}
// 계약 1건 총 마진 — 원본 최종 탭 '본사 내부 정리'의 "본사 마진 (최종)"(예시 매장 기준). 없으면 null
// 목표 마진(블랙·골드 1건당)은 10-26 부장님께 확인 예정 — 받으면 여기서 "목표 대비 여유"를 같이 보인다
async function totalMargin(id) {
  const v = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${q("최종")}!A1:F80`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const r = v.find((x) => String(x[2] || "").startsWith("본사 마진 (최종)"));
  return typeof r?.[5] === "number" ? r[5] : null;
}
const costTotal = (t) => t.v[t.end]?.[t.totalCol]; // 탭 '합계 금액' 줄의 원가 합계

// 단위당 원가 전·후: 그 줄의 원가 K가 바뀌었으면 K, 아니면 원가 합계 L ÷ 수량(서버 세트처럼 부품 원가를 합계 칸에서 묶는 줄)
function unitCosts(b, a) {
  if (typeof b.K === "number" && typeof a.K === "number" && a.K !== b.K) return [b.K, a.K];
  if (typeof b.L === "number" && typeof a.L === "number" && a.L !== b.L && b.G > 0) return [b.L / b.G, a.L / a.G];
  return null;
}

async function preview() {
  const input = JSON.parse(readFileSync(args[1], "utf8"));
  const books = (opt("--books") || "black,gold").split(",");
  // --skip "서버 및 PC 가구 내역:22,PC 및 주변 기기 내역:9" — 잘못 잡힌 줄 빼기(블랙·골드 공통)
  const skip = new Set((opt("--skip") || "").split(",").filter(Boolean).map((s) => s.trim()));
  const plan = { created: new Date().toISOString(), input, books: {} };
  for (const bk of books) {
    const id = origOf(bk), costs = [], skipped = [], notFound = [];
    const tabs = {};
    for (const title of ITEM_TABS) tabs[title] = await readTab(id, title);
    for (const it of input) {
      const key = norm(it.모델); let hit = 0;
      for (const [title, t] of Object.entries(tabs)) {
        if (!t) continue;
        for (let r = t.h + 1; r < t.end; r++) {
          const text = String(t.v[r]?.[4] || "");
          if (!key || !norm(text).includes(key)) continue;
          hit++;
          if (skip.has(`${title}:${r + 1}`)) { skipped.push({ tab: title, row: r + 1, text, why: "--skip으로 뺌" }); continue; }
          const m = text.match(/\*\s*(\d+)\s*(ea|개|set)?/i), n = m ? +m[1] : 1;
          const cell = t.f[r]?.[t.costCol];
          if (isFormula(cell)) { skipped.push({ tab: title, row: r + 1, text, why: `원가 칸이 수식(${cell}) — 따라 바뀜` }); continue; }
          const vat = it.가격 * n, cost = Math.round(vat / 1.1);
          const hasVat = t.vatCol >= 0 && typeof t.v[r]?.[t.vatCol] === "number" && !isFormula(t.f[r]?.[t.vatCol]);
          costs.push({ tab: title, row: r + 1, text, 항목: it.항목, 모델: it.모델, n, costCol: colName(t.costCol), oldCost: t.v[r]?.[t.costCol] ?? null, newCost: cost,
            vatCol: hasVat ? colName(t.vatCol) : null, oldVat: hasVat ? t.v[r][t.vatCol] : null, newVat: hasVat ? vat : null });
        }
      }
      if (!hit) notFound.push(it);
    }
    // 원본 안 임시 탭에 새 원가를 넣어 수식(세트 원가 합계 등)까지 계산해 본다 — 원본 탭은 그대로
    const lines = [];
    const affected = [...new Set(costs.filter((c) => c.oldCost !== c.newCost).map((c) => c.tab))];
    const meta = (await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(sheetId,title))" })).data.sheets;
    const temps = [];
    const marginBefore = await totalMargin(id);
    let dCostTotal = 0;
    try {
      for (const title of affected) {
        const src = meta.find((s) => s.properties.title === title).properties.sheetId;
        const res = await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ duplicateSheet: { sourceSheetId: src, newSheetName: PREVIEW + title.slice(0, 40), insertSheetIndex: 99 } }] } });
        const tmp = res.data.replies[0].duplicateSheet.properties; temps.push(tmp.sheetId);
        const data = costs.filter((c) => c.tab === title).flatMap((c) => [
          { range: `${q(tmp.title)}!${c.costCol}${c.row}`, values: [[c.newCost]] },
          ...(c.vatCol ? [{ range: `${q(tmp.title)}!${c.vatCol}${c.row}`, values: [[c.newVat]] }] : [])]);
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
        const tmpTab = await readTab(id, tmp.title);
        dCostTotal += (costTotal(tmpTab) || 0) - (costTotal(tabs[title]) || 0);
        const before = saleLines(tabs[title]), after = saleLines(tmpTab);
        for (const [row, b] of Object.entries(before)) {
          const a = after[row]; const uc = a && unitCosts(b, a); if (!uc) continue;
          const [kb, ka] = uc, dK = ka - kb, rate = kb ? b.F / kb : null;
          lines.push({ tab: title, row: +row, name: b.name, price: b.F, auto: b.fFormula, oldCost: kb, newCost: ka,
            oldMargin: b.F - kb, newMargin: (a.F ?? b.F) - ka, newPriceIfAuto: b.fFormula ? a.F : null,
            options: b.fFormula ? null : { 그대로: b.F, 마진금액유지: roundPrice(b.F + dK), 마진율유지: rate ? roundPrice(ka * rate) : null } });
        }
      }
    } finally {
      if (temps.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: temps.map((sheetId) => ({ deleteSheet: { sheetId } })) } });
    }
    plan.books[bk] = { costs, skipped, notFound, lines, marginBefore, marginAfter: marginBefore == null ? null : marginBefore - dCostTotal };
  }
  mkdirSync(dirname(PLAN), { recursive: true });
  writeFileSync(PLAN, JSON.stringify(plan, null, 2));

  for (const [bk, p] of Object.entries(plan.books)) {
    console.log(`\n■ ${BOOKS[bk].label} — 원가 칸 ${p.costs.length}곳`);
    for (const c of p.costs) console.log(`  ${c.tab} ${c.costCol}${c.row} [${c.text.replace(/\n/g, " ").slice(0, 34)}]${c.n > 1 ? ` ×${c.n}` : ""}: ${won(c.oldCost)} → ${won(c.newCost)}${c.oldCost === c.newCost ? " (같음)" : ""}${c.vatCol ? ` | 매입가 ${won(c.oldVat)} → ${won(c.newVat)}` : ""}`);
    for (const s of p.skipped) console.log(`  (안 고침) ${s.tab} ${s.row}행 [${s.text.slice(0, 30)}]: ${s.why}`);
    for (const x of p.notFound) console.log(`  ✗ 못 찾음: ${x.항목} ${x.모델}`);
    if (p.marginBefore != null) console.log(`  계약 1건 총 마진(예시 매장, 판매 단가 그대로일 때): ${won(p.marginBefore)} → ${won(p.marginAfter)} (${p.marginAfter >= p.marginBefore ? "+" : ""}${won(p.marginAfter - p.marginBefore)})`);
    if (p.lines.length) console.log(`  판매 줄 마진 변화(단위당):`);
    for (const l of p.lines) {
      const pct = (m, F) => (F ? ((m / F) * 100).toFixed(1) + "%" : "-");
      console.log(`   · ${l.tab} ${l.row}행 [${l.name.replace(/\n/g, " ")}] 단가 ${won(l.price)} | 원가 ${won(l.oldCost)} → ${won(l.newCost)} | 마진 ${won(l.oldMargin)}(${pct(l.oldMargin, l.price)}) → ${won(l.newMargin)}(${pct(l.newMargin, l.newPriceIfAuto ?? l.price)})${l.newMargin < 0 ? " ⚠ 손해" : ""}`);
      if (l.auto) console.log(`       단가 자동(${l.auto}) → ${won(l.newPriceIfAuto)}`);
      else console.log(`       선택지: 그대로 ${won(l.options.그대로)} / 마진금액 유지 ${won(l.options.마진금액유지)} / 마진율 유지 ${won(l.options.마진율유지)}`);
    }
  }
  console.log(`\n계획 저장: ${PLAN}`);
}

async function apply() {
  const plan = JSON.parse(readFileSync(args[1] && !args[1].startsWith("--") ? args[1] : PLAN, "utf8"));
  const prices = opt("--prices") ? JSON.parse(readFileSync(opt("--prices"), "utf8")) : [];
  for (const [bk, p] of Object.entries(plan.books)) {
    const id = origOf(bk), fin = `${q("최종")}!${BOOKS[bk].finalCell}`;
    const amount = async () => (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: fin, valueRenderOption: "UNFORMATTED_VALUE" })).data.values?.[0]?.[0];
    const before = await amount(), mBefore = await totalMargin(id);
    // 미리보기 뒤 원본이 바뀌었으면 멈춘다(누가 그 사이 고친 칸을 덮지 않게)
    const checks = p.costs.map((c) => `${q(c.tab)}!${c.costCol}${c.row}`);
    if (checks.length) {
      const now = (await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: checks, valueRenderOption: "UNFORMATTED_VALUE" })).data.valueRanges.map((x) => x.values?.[0]?.[0] ?? null);
      const moved = p.costs.filter((c, i) => now[i] !== c.oldCost);
      if (moved.length) { console.log(`■ ${BOOKS[bk].label}: 미리보기 뒤 원가 칸이 바뀜 → 중단(다시 미리보기 할 것)`); moved.forEach((c) => console.log(`  ${c.tab} ${c.costCol}${c.row}`)); process.exitCode = 2; return; }
    }
    const data = p.costs.filter((c) => c.oldCost !== c.newCost || (c.vatCol && c.oldVat !== c.newVat)).flatMap((c) => [
      { range: `${q(c.tab)}!${c.costCol}${c.row}`, values: [[c.newCost]] },
      ...(c.vatCol ? [{ range: `${q(c.tab)}!${c.vatCol}${c.row}`, values: [[c.newVat]] }] : [])]);
    const myPrices = prices.filter((x) => x.book === bk);
    for (const x of myPrices) data.push({ range: `${q(x.tab)}!F${x.row}`, values: [[x.price]] });
    if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
    const after = await amount(), mAfter = await totalMargin(id);
    console.log(`■ ${BOOKS[bk].label}: 원가 ${data.length - myPrices.length}칸·판매 단가 ${myPrices.length}칸 씀 | 최종 금액 ${won(before)} → ${won(after)}${before === after ? " (변화 없음)" : ""}` +
      (mBefore != null ? ` | 계약 1건 총 마진 ${won(mBefore)} → ${won(mAfter)}` : ""));
  }
}

(mode === "preview" ? preview() : mode === "apply" ? apply() : Promise.reject(new Error("preview | apply")))
  .catch((e) => { console.error("실패:", e.message); process.exit(1); });
