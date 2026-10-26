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
import { sheets, BOOKS, TABS, colName, q, requireUserForWrite } from "./lib.mjs";

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
      out[r + 1] = { F, K, L, G, name: String(t.v[r][4] || "").slice(0, 40), fFormula: isFormula(t.f[r]?.[5]) ? t.f[r][5] : null,
        // L이 여러 줄 원가를 묶은 합계(예: PC 탭 L16 = G16*K16+…+G20*K20, 좌석 세트 전체)면 이 줄 하나의 원가가 아니다
        groupL: (String(t.f[r]?.[t.totalCol] ?? "").match(/K\d+/g) || []).length > 1 };
  }
  return out;
}
// 계약 1건 총 마진 — 원본 최종 탭 '본사 내부 정리'의 "본사 마진 (최종)"(예시 매장 기준). 없으면 null
// (10-26부터 블랙은 선투자 성실이행 지원 2,500만을 '보정 ④'로 뺀 값 — 분할 상환분은 돌려받으니 안 뺌)
async function totalMargin(id, tab = "최종") {
  const v = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${q(tab)}!A1:F80`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const r = v.find((x) => String(x[2] || "").startsWith("본사 마진 (최종)"));
  return typeof r?.[5] === "number" ? r[5] : null;
}

// 목표 마진(2026-10-26 부장님 확인): 계약 1건, 100대 매장 기준. 평수는 80평으로 본다(10-26 사용자).
const TARGET = { black: [70000000, 70000000], gold: [40000000, 50000000] };
const STD = { seats: 100, pyeong: 80 };
const SUBSIDY_CAP = 8000000; // 인터넷 지원금 대체 품목 합계(PC 탭 I열) 한도 — 넘으면 최종 탭이 아니라 단가 수정·제품 교체(10-26 사용자)
const INFO = "정보입력(댓수,평수)", PC = "PC 및 주변 기기 내역", STD_TMP = "__마진100_";
const won만 = (n) => `${n < 0 ? "−" : "+"}${Math.round(Math.abs(n) / 10000).toLocaleString("ko-KR")}만`;
const vsTarget = (bk, m) => { const [lo, hi] = TARGET[bk]; return m > hi ? `목표 ${(hi / 1e4).toLocaleString("ko-KR")}만보다 ${won만(m - hi)}` : m < lo ? `목표 ${(lo / 1e4).toLocaleString("ko-KR")}만보다 ${won만(m - lo)}` : "목표 안"; };
// PC 탭 '인터넷 지원금' 줄의 금액(I열). 줄을 못 찾으면 null
const subsidyOf = (v) => { const r = v.find((x) => String(x[2] || "").startsWith("인터넷 지원금")); return typeof r?.[8] === "number" ? r[8] : null; };
const subsidyLine = (n) => n == null ? "인터넷 지원금 줄 못 찾음 — 확인할 것" : n > SUBSIDY_CAP ? `⚠ 인터넷 지원금 품목 합계 ${won(n)} — 800만 초과: 단가 수정·제품 교체 필요` : `인터넷 지원금 품목 합계 ${won(n)} (800만 이하)`;

// 100대·80평 기준 마진: 원본 안에 품목·최종 탭을 숨김 임시 탭으로 복사하고 서로를 가리키게 고친 뒤 대수·평수만 바꿔 계산(원본 탭은 그대로).
// writes([{tab, a1, value}])를 주면 그 값을 넣은 뒤 값도 계산 → { before, after, subsidyBefore, subsidyAfter }
async function standardMargin(id, writes = []) {
  const titles = TABS.map(([o]) => o).filter((t) => t !== "표지");
  const meta = (await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(sheetId,title))" })).data.sheets;
  const tmp = (t) => STD_TMP + t;
  const fix = (f) => { let y = f; for (const o of titles) { y = y.split(`${q(o)}!`).join(`${q(tmp(o))}!`); if (!/[\s(),]/.test(o)) y = y.replace(new RegExp(`(^|[^'\\w가-힣])${o}!`, "g"), `$1${q(tmp(o))}!`); } return y; };
  const read = async () => ({
    margin: await totalMargin(id, tmp("최종")),
    subsidy: subsidyOf((await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${q(tmp(PC))}!A1:J60`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || []),
  });
  const stale = meta.filter((s) => s.properties.title.startsWith(STD_TMP)); // 지난번에 끊겨 남은 임시 탭
  if (stale.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: stale.map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })) } });
  const temps = [];
  try {
    for (const t of titles) {
      const src = meta.find((s) => s.properties.title === t)?.properties.sheetId; if (src == null) throw new Error(`탭 없음: ${t}`);
      const r = await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ duplicateSheet: { sourceSheetId: src, newSheetName: tmp(t), insertSheetIndex: 99 } }] } });
      const sid = r.data.replies[0].duplicateSheet.properties.sheetId; temps.push(sid);
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: sid, hidden: true }, fields: "hidden" } }] } });
    }
    for (const t of titles) {
      const f = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${q(tmp(t))}!A1:Z200`, valueRenderOption: "FORMULA" })).data.values || [];
      const data = [];
      f.forEach((row, i) => row.forEach((c, j) => { if (typeof c === "string" && c.startsWith("=")) { const y = fix(c); if (y !== c) data.push({ range: `${q(tmp(t))}!${colName(j)}${i + 1}`, values: [[y]] }); } }));
      if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "USER_ENTERED", data } });
    }
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${q(tmp(INFO))}!B3:B4`, valueInputOption: "RAW", requestBody: { values: [[STD.seats], [STD.pyeong]] } });
    const b = await read();
    let a = b;
    if (writes.length) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data: writes.map((w) => ({ range: `${q(tmp(w.tab))}!${w.a1}`, values: [[w.value]] })) } });
      a = await read();
    }
    return { before: b.margin, after: a.margin, subsidyBefore: b.subsidy, subsidyAfter: a.subsidy };
  } finally {
    if (temps.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: temps.map((sheetId) => ({ deleteSheet: { sheetId } })) } });
  }
}
const costTotal = (t) => t.v[t.end]?.[t.totalCol]; // 탭 '합계 금액' 줄의 원가 합계

// 단위당 원가 전·후: 그 줄의 원가 K가 바뀌었으면 K, 아니면 원가 합계 L ÷ 수량(서버 세트처럼 부품 원가를 합계 칸에서 묶는 줄)
function unitCosts(b, a) {
  if (typeof b.K === "number" && typeof a.K === "number" && a.K !== b.K) return [b.K, a.K];
  if (!b.groupL && typeof b.L === "number" && typeof a.L === "number" && a.L !== b.L && b.G > 0) return [b.L / b.G, a.L / a.G];
  return null;
}

async function preview() {
  requireUserForWrite(); // 미리보기도 원본에 임시 탭을 만들었다 지운다
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
    const costWrites = costs.filter((c) => c.oldCost !== c.newCost || (c.vatCol && c.oldVat !== c.newVat)).flatMap((c) => [
      { tab: c.tab, a1: `${c.costCol}${c.row}`, value: c.newCost }, ...(c.vatCol ? [{ tab: c.tab, a1: `${c.vatCol}${c.row}`, value: c.newVat }] : [])]);
    const std = await standardMargin(id, costWrites);
    plan.books[bk] = { costs, skipped, notFound, lines, marginBefore, marginAfter: marginBefore == null ? null : marginBefore - dCostTotal, std };
  }
  mkdirSync(dirname(PLAN), { recursive: true });
  writeFileSync(PLAN, JSON.stringify(plan, null, 2));

  for (const [bk, p] of Object.entries(plan.books)) {
    console.log(`\n■ ${BOOKS[bk].label} — 원가 칸 ${p.costs.length}곳`);
    for (const c of p.costs) console.log(`  ${c.tab} ${c.costCol}${c.row} [${c.text.replace(/\n/g, " ").slice(0, 34)}]${c.n > 1 ? ` ×${c.n}` : ""}: ${won(c.oldCost)} → ${won(c.newCost)}${c.oldCost === c.newCost ? " (같음)" : ""}${c.vatCol ? ` | 매입가 ${won(c.oldVat)} → ${won(c.newVat)}` : ""}`);
    for (const s of p.skipped) console.log(`  (안 고침) ${s.tab} ${s.row}행 [${s.text.slice(0, 30)}]: ${s.why}`);
    for (const x of p.notFound) console.log(`  ✗ 못 찾음: ${x.항목} ${x.모델}`);
    if (p.std?.before != null) console.log(`  계약 1건 총 마진(${STD.seats}대·${STD.pyeong}평 기준, 판매 단가 그대로일 때): ${won(p.std.before)} → ${won(p.std.after)} | ${vsTarget(bk, p.std.before)} → ${vsTarget(bk, p.std.after)}`);
    if (p.marginBefore != null) console.log(`  (참고) 예시 매장 기준: ${won(p.marginBefore)} → ${won(p.marginAfter)} (${p.marginAfter >= p.marginBefore ? "+" : ""}${won(p.marginAfter - p.marginBefore)})`);
    if (p.std) console.log(`  ${subsidyLine(p.std.subsidyBefore)}`);
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

// ---------- 적용: 쓰기 전에 정답지를 만들고, 쓴 뒤 대조, 다르면 되돌림 ----------
// 10-23 사용자 지적: 미리보기 표가 맞아도 실제 쓰기가 어긋나면 sync 검증("영업부용 = 원본")으로는 못 잡는다.
const GRID = "A1:Z200";
async function grids(id, titles) {
  const out = {};
  for (const t of titles) {
    const [f, v] = await Promise.all(["FORMULA", "UNFORMATTED_VALUE"].map((o) =>
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${q(t)}!${GRID}`, valueRenderOption: o }).then((r) => r.data.values || [])));
    out[t] = { f, v };
  }
  return out;
}
const cellAt = (g, a1) => { const m = a1.match(/^([A-Z]+)(\d+)$/); const c = m[1].split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1; return g[+m[2] - 1]?.[c] ?? ""; };
function diffCells(a, b) { // 두 격자에서 다른 칸 목록(A1)
  const out = [];
  for (let r = 0; r < Math.max(a.length, b.length); r++) for (let c = 0; c < Math.max(a[r]?.length || 0, b[r]?.length || 0); c++) {
    const x = a[r]?.[c] ?? "", y = b[r]?.[c] ?? "";
    if (String(x) !== String(y)) out.push({ a1: colName(c) + (r + 1), from: x, to: y });
  }
  return out;
}

async function apply() {
  requireUserForWrite();
  const plan = JSON.parse(readFileSync(args[1] && !args[1].startsWith("--") ? args[1] : PLAN, "utf8"));
  const prices = opt("--prices") ? JSON.parse(readFileSync(opt("--prices"), "utf8")) : [];

  // 1) 쓸 칸 목록 + 지금 값이 미리보기 때와 같은지(블랙·골드 모두 먼저 확인 — 하나라도 어긋나면 아무것도 안 씀)
  const jobs = [];
  for (const [bk, p] of Object.entries(plan.books)) {
    const id = origOf(bk);
    const writes = p.costs.filter((c) => c.oldCost !== c.newCost || (c.vatCol && c.oldVat !== c.newVat)).flatMap((c) => [
      { tab: c.tab, a1: `${c.costCol}${c.row}`, value: c.newCost, expectOld: c.oldCost },
      ...(c.vatCol ? [{ tab: c.tab, a1: `${c.vatCol}${c.row}`, value: c.newVat, expectOld: c.oldVat }] : [])]);
    for (const x of prices.filter((x) => x.book === bk)) {
      const line = p.lines.find((l) => l.tab === x.tab && l.row === x.row);
      writes.push({ tab: x.tab, a1: `F${x.row}`, value: x.price, expectOld: line ? line.price : undefined, price: true });
    }
    const tabs = [...new Set(writes.map((w) => w.tab))];
    const before = await grids(id, tabs);
    const bad = [];
    for (const w of writes) {
      const f = cellAt(before[w.tab].f, w.a1), v = cellAt(before[w.tab].v, w.a1);
      if (String(f).startsWith("=")) bad.push(`${w.tab} ${w.a1}: 수식 칸(${f}) — 쓰지 않음`);
      else if (w.expectOld !== undefined && v !== w.expectOld) bad.push(`${w.tab} ${w.a1}: 미리보기 때 ${won(w.expectOld)} → 지금 ${won(v)}`);
    }
    if (bad.length) { console.log(`■ ${BOOKS[bk].label}: 미리보기 뒤 원본이 바뀜 → 아무것도 쓰지 않고 중단(다시 미리보기 할 것)`); bad.forEach((x) => console.log("  " + x)); process.exitCode = 2; return; }
    jobs.push({ bk, id, writes, tabs, before });
  }

  // 2) 책별로: 임시 탭에 같은 값을 넣어 정답지 → 실제로 쓰기 → 대조 → 어긋나면 지금까지 쓴 책 전부 되돌림
  const done = [];
  const revert = async () => {
    for (const j of done.reverse()) {
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: j.id, requestBody: { valueInputOption: "RAW",
        data: j.writes.map((w) => ({ range: `${q(w.tab)}!${w.a1}`, values: [[cellAt(j.before[w.tab].f, w.a1)]] })) } });
      const back = await grids(j.id, j.tabs);
      const left = j.tabs.flatMap((t) => diffCells(j.before[t].f, back[t].f).map((d) => `${t} ${d.a1}`));
      console.log(`  되돌림 ${BOOKS[j.bk].label}: ${left.length ? "⚠ 원래대로 안 돌아온 칸 " + left.join(", ") + " — 버전 기록에서 확인할 것" : "원래 값으로 돌아옴(확인함)"}`);
    }
  };
  for (const j of jobs) {
    const fin = `${q("최종")}!${BOOKS[j.bk].finalCell}`;
    const amount = async () => (await sheets.spreadsheets.values.get({ spreadsheetId: j.id, range: fin, valueRenderOption: "UNFORMATTED_VALUE" })).data.values?.[0]?.[0];
    const amtBefore = await amount(), mBefore = await totalMargin(j.id);
    const meta = (await sheets.spreadsheets.get({ spreadsheetId: j.id, fields: "sheets(properties(sheetId,title))" })).data.sheets;
    const expect = {}, temps = [];
    try {
      for (const t of j.tabs) {
        const src = meta.find((s) => s.properties.title === t).properties.sheetId;
        const res = await sheets.spreadsheets.batchUpdate({ spreadsheetId: j.id, requestBody: { requests: [{ duplicateSheet: { sourceSheetId: src, newSheetName: PREVIEW + "정답_" + t.slice(0, 36), insertSheetIndex: 99 } }] } });
        const tmp = res.data.replies[0].duplicateSheet.properties; temps.push(tmp.sheetId);
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: j.id, requestBody: { valueInputOption: "RAW",
          data: j.writes.filter((w) => w.tab === t).map((w) => ({ range: `${q(tmp.title)}!${w.a1}`, values: [[w.value]] })) } });
        expect[t] = (await grids(j.id, [tmp.title]))[tmp.title].v;
      }
    } finally {
      if (temps.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: j.id, requestBody: { requests: temps.map((sheetId) => ({ deleteSheet: { sheetId } })) } });
    }
    // 판매 단가를 바꿔 인터넷 지원금 품목 합계가 800만을 넘으면 쓰지 않는다(이 책은 아직 안 씀, 앞서 쓴 책은 되돌림)
    const sub = expect[PC] ? subsidyOf(expect[PC]) : null;
    if (sub != null && sub > SUBSIDY_CAP) {
      console.log(`■ ${BOOKS[j.bk].label}: ${subsidyLine(sub)} → 쓰지 않고 중단`);
      await revert(); process.exitCode = 4; return;
    }

    // QUOTE_FAULT=1: 되돌림 시험용으로 첫 칸에 일부러 1 더 씀(시험용 사본에서만)
    const fault = process.env.QUOTE_FAULT === "1" && args.includes("--test");
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: j.id, requestBody: { valueInputOption: "RAW",
      data: j.writes.map((w, i) => ({ range: `${q(w.tab)}!${w.a1}`, values: [[fault && i === 0 ? w.value + 1 : w.value]] })) } });
    done.push(j);

    const after = await grids(j.id, j.tabs), problems = [];
    const planned = new Map(j.writes.map((w) => [`${w.tab}!${w.a1}`, w.value]));
    for (const t of j.tabs) {
      // 입력(수식 말고 값) 칸: 계획한 칸만, 계획한 값으로 바뀌었는가
      for (const d of diffCells(j.before[t].f, after[t].f)) {
        const k = `${t}!${d.a1}`;
        if (!planned.has(k)) problems.push(`${t} ${d.a1}: 계획에 없는 칸이 바뀜(${d.from} → ${d.to})`);
        else if (Number(d.to) !== planned.get(k)) problems.push(`${t} ${d.a1}: ${planned.get(k)}을 썼는데 ${d.to}`);
      }
      for (const [k, val] of planned) if (k.startsWith(t + "!") && Number(cellAt(after[t].f, k.split("!")[1])) !== val) problems.push(`${k.replace("!", " ")}: 계획 값과 다름`);
      // 계산 결과까지: 실제 탭 = 정답지(임시 탭)
      diffCells(expect[t], after[t].v).slice(0, 10).forEach((d) => problems.push(`${t} ${d.a1}: 정답지 ${d.from} / 실제 ${d.to}`));
    }
    if (problems.length) {
      console.log(`■ ${BOOKS[j.bk].label}: 적용 결과가 계획과 다름 → 되돌림`);
      problems.slice(0, 20).forEach((x) => console.log("  · " + x));
      await revert(); process.exitCode = 3; return;
    }
    const amtAfter = await amount(), mAfter = await totalMargin(j.id);
    const nPrice = j.writes.filter((w) => w.price).length;
    console.log(`■ ${BOOKS[j.bk].label}: 원가 ${j.writes.length - nPrice}칸·판매 단가 ${nPrice}칸 씀 | 적용 확인: 바뀐 칸 = 계획 ${j.writes.length}칸, 정답지와 전체 일치 ✓ | 최종 금액 ${won(amtBefore)} → ${won(amtAfter)}${amtBefore === amtAfter ? " (변화 없음)" : ""}` +
      (mBefore != null ? ` | 예시 매장 총 마진 ${won(mBefore)} → ${won(mAfter)}` : ""));
    const std = await standardMargin(j.id), sb = plan.books[j.bk].std?.before;
    console.log(`  ${STD.seats}대·${STD.pyeong}평 기준 총 마진 ${sb != null ? won(sb) + " → " : ""}${won(std.before)} | ${vsTarget(j.bk, std.before)} | ${subsidyLine(std.subsidyBefore)}`);
  }
}

(mode === "preview" ? preview() : mode === "apply" ? apply() : Promise.reject(new Error("preview | apply")))
  .catch((e) => { console.error("실패:", e.message); process.exit(1); });
