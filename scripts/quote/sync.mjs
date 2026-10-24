// 견적서 원본 → 영업부용 반영 (2026-10-23, Apps Script 버튼 대신 Claude Code에서 실행)
//   node scripts/quote/sync.mjs <black|gold> [--test] [--dry]      반영(--dry: 원본 안 정리·검사까지만)
//   node scripts/quote/sync.mjs <black|gold> [--test] --check      영업부용에서 직접 바뀐 칸만 확인
//   node scripts/quote/sync.mjs <black|gold> [--test] --adopt      직접 바뀐 칸을 원본 같은 자리에 옮긴 뒤 반영(원본도 바뀐 칸·원가 수식 칸이 있으면 멈춤)
//   node scripts/quote/sync.mjs <black|gold> [--test] --force      직접 바뀐 칸이 있어도 덮어씀(영업부용 수정을 버림)
//   node scripts/quote/sync.mjs <black|gold> [--test] --rollback   검증 실패로 남겨 둔 백업으로 되돌림
//   node scripts/quote/sync.mjs <black|gold> [--test] --accept     검증 차이를 확인하고 그대로 확정(백업 삭제·기록 저장)
//
// 순서: 원본 안에 임시 탭 → 원가(K열~)·본사 내부 정리 표 삭제, 원가 참조 수식은 값으로 → 원가 흔적 검사(걸리면 중단)
//   → 영업부용 탭마다 숨김 백업 사본 → 깨끗한 탭을 영업부용에 숨김 준비 탭으로 복사 → 기존 탭에 행 넣고 빼기·바뀐 칸만 덮어쓰기
//     (10-24부터 탭을 갈아 끼우지 않음 — 칸별 수정 기록·댓글·탭 링크·잠금 유지) → 자동 검증
//   → 통과하면 백업 삭제·기록 저장, 실패하면 백업을 남기고 멈춤(--rollback이면 백업 내용을 같은 탭에 되돌려 씀 / --accept)
// 원가가 들어간 내용은 영업부용 시트에 한 순간도 들어가지 않는다.
import { sheets, actorEmail, requireUserForWrite, AUTO_ROW, TABS, LEAK_WORDS, NOTE_LEAK_WORDS, LAST_SALES_COL, INTERNAL_BLOCK, LOG_SHEET, refsBeyondJ, renameRefs, colName, q, pickBook } from "./lib.mjs";
import { verify } from "./verify.mjs";

const args = process.argv.slice(2);
const book = pickBook(args);
const has = (f) => args.includes(f);
const TEMP = "__반영임시_", BAK = "__반영백업_";
const batch = (id, requests) => requests.length ? sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } }) : null;
const meta = async (id) => (await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets(properties(sheetId,title,index,hidden,gridProperties),protectedRanges(protectedRangeId,range,editors))" })).data.sheets;
const byTitle = (m, t) => m.find((s) => s.properties.title === t);

// ---------- 변경 감지 ----------
async function grid(id, title) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: q(title), valueRenderOption: "FORMULA", dateTimeRenderOption: "FORMATTED_STRING" });
  return (r.data.values || []).map((row) => row.map((x) => String(x)));
}
async function salesChanges() {
  let rows;
  try { rows = (await sheets.spreadsheets.values.get({ spreadsheetId: book.orig, range: `${q(LOG_SHEET)}!A1:ZZ20` })).data.values || []; } catch { return { noLog: true, list: [] }; }
  if (!rows.length) return { noLog: true, list: [] };
  const when = rows[0][1];
  const saved = Object.fromEntries(rows.slice(1).filter((r) => r[0]).map((r) => [r[0], JSON.parse(r.slice(1).join(""))]));
  const list = [], cells = [];
  const sm = await meta(book.sales);
  for (const [oName, sName] of TABS) {
    if (!byTitle(sm, sName)) { list.push(`${sName}: 탭이 없어짐`); cells.push({ oName, sName, missing: true }); continue; }
    const now = await grid(book.sales, sName), before = saved[sName] || [];
    for (let r = 0; r < Math.max(now.length, before.length); r++) {
      const R = Math.max(now[r]?.length || 0, before[r]?.length || 0);
      for (let c = 0; c < R; c++) {
        const a = before[r]?.[c] ?? "", b = now[r]?.[c] ?? "";
        if (a !== b) { list.push(`${sName} ${colName(c)}${r + 1}: ${a.slice(0, 30) || "(빈칸)"} → ${b.slice(0, 30) || "(빈칸)"}`); cells.push({ oName, sName, a1: colName(c) + (r + 1), r, c, before: a, after: b }); }
      }
    }
  }
  return { when, list, cells };
}

// ---------- 영업부용에서만 바뀐 칸을 원본 같은 자리로 옮기기(--adopt) ----------
// 10-23 사용자: "원본은 두고 영업부만 고친 데이터가 반영 때 날아가면 일 난다" → 잡힌 칸을 원본에 옮긴 뒤 반영.
// 원본 그 칸이 마지막 반영 뒤 그대로일 때만 옮긴다. 원본도 바뀌었거나(양쪽 수정) 원본이 원가 참조 수식 칸이면 옮기지 않고 사람에게 묻는다.
const toOrigRefs = (f) => { let y = f; for (const [o, s] of TABS) if (o !== s) y = y.split(`${q(s)}!`).join(`${q(o)}!`); return y; };
async function adopt(cells) {
  const moved = [], skipped = [], data = [];
  for (const x of cells) {
    if (x.missing) { skipped.push(`${x.sName}: 영업부용에서 탭이 없어짐 — 옮길 수 없음`); continue; }
    const g = await grid(book.orig, x.oName); // 탭마다 한 번 읽도록 아래에서 캐시
    const origNow = g[x.r]?.[x.c] ?? "";
    const origAsSales = origNow.startsWith("=") ? renameRefs(origNow) : origNow;
    const where = `${x.sName} ${x.a1}`;
    if (origNow.startsWith("=") && refsBeyondJ(origNow)) { skipped.push(`${where}: 원본은 원가로 계산하는 칸(${origNow.slice(0, 30)}) — 영업부용 값 ${x.after}을 그대로 넣으면 수식이 사라짐`); continue; }
    if (origAsSales === x.after) { moved.push(`${where}: 원본도 이미 같은 값`); continue; }
    if (origAsSales !== x.before) { skipped.push(`${where}: 원본도 그 사이 바뀜(원본 ${origNow.slice(0, 20) || "(빈칸)"} / 영업부용 ${x.after.slice(0, 20) || "(빈칸)"}) — 어느 쪽이 맞는지 정해야 함`); continue; }
    const v = x.after;
    data.push({ range: `${q(x.oName)}!${x.a1}`, values: [[v.startsWith("=") ? toOrigRefs(v) : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]] , formula: v.startsWith("=") });
    moved.push(`${where}: ${x.before.slice(0, 20) || "(빈칸)"} → ${v.slice(0, 20) || "(빈칸)"}`);
  }
  if (skipped.length) return { moved: [], skipped }; // 하나라도 못 옮기면 아무것도 안 씀
  const f = data.filter((d) => d.formula), n = data.filter((d) => !d.formula);
  if (f.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: book.orig, requestBody: { valueInputOption: "USER_ENTERED", data: f.map(({ range, values }) => ({ range, values })) } });
  if (n.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: book.orig, requestBody: { valueInputOption: "RAW", data: n.map(({ range, values }) => ({ range, values })) } });
  // 옮긴 뒤 원본을 다시 읽어 확인
  for (const x of cells) {
    const now = (await grid(book.orig, x.oName))[x.r]?.[x.c] ?? "";
    if ((now.startsWith("=") ? renameRefs(now) : now) !== x.after) return { moved: [], skipped: [`${x.sName} ${x.a1}: 원본에 옮겼는데 다시 읽으니 ${now} — 확인 필요`] };
  }
  return { moved, skipped };
}
async function writeLog() {
  const m = await meta(book.orig);
  if (!byTitle(m, LOG_SHEET)) await batch(book.orig, [{ addSheet: { properties: { title: LOG_SHEET, hidden: true } } }]);
  const out = [["반영 시각", new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)]];
  for (const [, sName] of TABS) {
    const json = JSON.stringify(await grid(book.sales, sName));
    const parts = []; for (let i = 0; i < json.length; i += 45000) parts.push(json.slice(i, i + 45000));
    out.push([sName, ...parts]);
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId: book.orig, range: q(LOG_SHEET) });
  await sheets.spreadsheets.values.update({ spreadsheetId: book.orig, range: `${q(LOG_SHEET)}!A1`, valueInputOption: "RAW", requestBody: { values: out } });
}

// ---------- 1) 원본 안에서 깨끗한 임시 탭 ----------
async function buildTemps() {
  const m = await meta(book.orig);
  for (const s of m) if (s.properties.title.startsWith(TEMP)) await batch(book.orig, [{ deleteSheet: { sheetId: s.properties.sheetId } }]);
  const reqs = TABS.map(([o], i) => {
    const src = byTitle(m, o); if (!src) throw new Error(`원본에 '${o}' 탭이 없다`);
    return { duplicateSheet: { sourceSheetId: src.properties.sheetId, newSheetName: TEMP + o, insertSheetIndex: m.length + i } };
  });
  const rep = (await batch(book.orig, reqs)).data.replies;
  const temps = TABS.map(([o, s, keep], i) => ({ o, s, keep, id: rep[i].duplicateSheet.properties.sheetId, src: byTitle(m, o) }));
  // 복사된 보호 제거
  const m2 = await meta(book.orig);
  await batch(book.orig, temps.flatMap((t) => (byTitle(m2, TEMP + t.o).protectedRanges || []).map((p) => ({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } }))));
  for (const t of temps) {
    const title = TEMP + t.o;
    const f = (await sheets.spreadsheets.values.get({ spreadsheetId: book.orig, range: q(title), valueRenderOption: "FORMULA" })).data.values || [];
    const v = (await sheets.spreadsheets.values.get({ spreadsheetId: book.orig, range: q(title), valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
    const asValue = [], renamed = [];
    f.forEach((row, r) => row.forEach((x, c) => {
      if (typeof x !== "string" || !x.startsWith("=")) return;
      const a1 = `${q(title)}!${colName(c)}${r + 1}`;
      if (!t.keep && c < LAST_SALES_COL && refsBeyondJ(x)) asValue.push({ range: a1, values: [[v[r]?.[c] ?? ""]] });
      else if (renameRefs(x) !== x) renamed.push({ range: a1, values: [[renameRefs(x)]] });
    }));
    if (asValue.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: book.orig, requestBody: { valueInputOption: "RAW", data: asValue } });
    if (renamed.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: book.orig, requestBody: { valueInputOption: "USER_ENTERED", data: renamed } });
    t.valueFixed = asValue.length;
    if (t.keep) continue;
    const g = t.src.properties.gridProperties;
    const req = [];
    if (t.o === "최종") {
      const i = f.findIndex((row) => String(row[1] || "").startsWith(INTERNAL_BLOCK));
      if (i >= 0) req.push({ deleteDimension: { range: { sheetId: t.id, dimension: "ROWS", startIndex: i, endIndex: g.rowCount } } });
    }
    if (g.columnCount > LAST_SALES_COL) req.push({ deleteDimension: { range: { sheetId: t.id, dimension: "COLUMNS", startIndex: LAST_SALES_COL, endIndex: g.columnCount } } });
    await batch(book.orig, req);
  }
  return temps;
}

async function leakCheck(temps) {
  const out = [];
  for (const t of temps) {
    const r = (await sheets.spreadsheets.get({ spreadsheetId: book.orig, ranges: [q(TEMP + t.o)], includeGridData: true, fields: "sheets(properties(gridProperties),data(rowData(values(formattedValue,userEnteredValue,note))))" })).data.sheets[0];
    if (!t.keep && r.properties.gridProperties.columnCount > LAST_SALES_COL) out.push(`${t.o}: J열 뒤에 열이 남음`);
    (r.data[0].rowData || []).forEach((row, i) => (row.values || []).forEach((c, j) => {
      const a1 = `${t.o} ${colName(j)}${i + 1}`;
      if (LEAK_WORDS.some((w) => (c.formattedValue || "").includes(w))) out.push(`${a1} "${c.formattedValue.slice(0, 20)}"`);
      if (c.note && NOTE_LEAK_WORDS.some((w) => c.note.includes(w))) out.push(`${a1} 메모에 원가 관련 단어`);
      if (!t.keep && c.userEnteredValue?.formulaValue && refsBeyondJ(c.userEnteredValue.formulaValue)) out.push(`${a1} 수식이 원가 열 참조`);
    }));
  }
  return out;
}

async function deleteTemps() {
  const m = await meta(book.orig);
  await batch(book.orig, m.filter((s) => s.properties.title.startsWith(TEMP)).map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })));
}

// ---------- 2) 영업부용에 덮어쓰기 ----------
// 10-24 변경: 탭을 갈아 끼우면(옛 방식) 칸별 수정 기록·댓글·탭 링크가 반영마다 끊긴다(10-26 골드 표지 건) →
// 탭은 그대로 두고 ① 원본에서 넣고 뺀 행을 같은 자리에서 넣고 빼고 ② 다른 칸만 덮어쓴다. 안 바뀐 칸은 건드리지 않는다.
// 덮어쓸 내용은 원가를 뺀 임시 탭을 영업부용에 숨김 탭(STAGE)으로 복사해 그 안에서 칸 복사 — 원가는 여전히 한 순간도 안 들어간다.
const STAGE = "__반영준비_";
// textFormatRuns = 칸 안 일부 글자 서식(냉난방기 문구의 빨간 글자 등). 빼면 그 서식만 바뀐 칸을 '안 바뀜'으로 보고 건너뛴다(10-24 검토에서 잡음)
const GRID = "sheets(properties(sheetId,title,gridProperties),merges,data(rowData(values(userEnteredValue,userEnteredFormat,textFormatRuns,note,dataValidation))))";
async function loadGrid(id, sheetTitle) {
  const s = (await sheets.spreadsheets.get({ spreadsheetId: id, ranges: [q(sheetTitle)], includeGridData: true, fields: GRID })).data.sheets[0];
  return { g: s.properties.gridProperties, merges: s.merges || [], rows: (s.data[0].rowData || []).map((r) => r.values || []) };
}
// 행 짝짓기 기준: 글자로 직접 쓴 칸(품목명·제목)만 — 번호·금액·수식은 행을 넣고 빼면 따라 바뀌므로 기준에서 뺀다
const rowKey = (row = []) => row.map((c) => c.userEnteredValue?.stringValue ?? "").join("\u0001").replace(/\u0001+$/, "");
const cellSig = (c = {}) => JSON.stringify([c.userEnteredValue ?? null, c.userEnteredFormat ?? null, c.textFormatRuns ?? null, c.note ?? "", c.dataValidation ?? null]);
// 영업부용 행(a) ↔ 넣을 행(b) 최장 공통 순서로 짝짓기 → 짝 없는 구간마다 {at: 영업부용 행 위치, del, ins}
function rowGaps(a, b) {
  const n = a.length, m = b.length, W = m + 1, dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const gaps = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) gaps.push(cur); cur = null; };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    cur ??= { at: i, del: 0, ins: 0 };
    if (j >= m || (i < n && dp[(i + 1) * W + j] >= dp[i * W + j + 1])) { cur.del++; i++; } else { cur.ins++; j++; }
  }
  flush();
  return gaps;
}
const inside = (m, r) => m.startRowIndex < r.endRowIndex && r.startRowIndex < m.endRowIndex && m.startColumnIndex < r.endColumnIndex && r.startColumnIndex < m.endColumnIndex;
const mkey = (m) => `${m.startRowIndex},${m.endRowIndex},${m.startColumnIndex},${m.endColumnIndex}`;
const rng = (sheetId, m) => ({ sheetId, startRowIndex: m.startRowIndex, endRowIndex: m.endRowIndex, startColumnIndex: m.startColumnIndex, endColumnIndex: m.endColumnIndex });

// src(같은 영업부용 시트 안의 탭) 내용으로 dst 탭을 맞춘다. size = 행 높이·열 너비를 읽어 올 곳 {id, title}
async function applyTab(srcId, srcTitle, dstId, dstTitle, size) {
  let src = await loadGrid(book.sales, srcTitle), dst = await loadGrid(book.sales, dstTitle);
  // 자기 탭 이름을 쓴 수식(='PC 및 …'!E27)은 준비·백업 탭으로 복사되며 그 탭 이름을 달고 온다 → 칸 복사 전에 원래 탭 이름으로
  // (10-24 검토: 안 고치면 영업부용에 '__반영준비_…'!가 들어가 검증에서 멈춤)
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selfRef = new RegExp(`${esc(q(srcTitle))}!|(?<![\\w'])${esc(srcTitle)}!`, "g");
  const fix = [];
  src.rows.forEach((row, r) => row.forEach((c, k) => {
    const f = c.userEnteredValue?.formulaValue;
    if (f && selfRef.test(f)) fix.push({ range: `${q(srcTitle)}!${colName(k)}${r + 1}`, values: [[f.replace(selfRef, `${q(dstTitle)}!`)]] });
    selfRef.lastIndex = 0;
  }));
  if (fix.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: book.sales, requestBody: { valueInputOption: "USER_ENTERED", data: fix } });
    src = await loadGrid(book.sales, srcTitle);
  }
  const sR = src.g.rowCount, sC = src.g.columnCount;
  // ① 행: 넣고 뺀 자리 맞추기(아래 구간부터 해야 위 위치가 안 밀린다). 같은 구간의 지움·넣음은 짝지어 '고친 행'으로 남기고 남는 만큼만 넣고 뺀다
  const pad = (rows, n) => Array.from({ length: n }, (_, r) => rowKey(rows[r]));
  const gaps = rowGaps(pad(dst.rows, dst.g.rowCount), pad(src.rows, sR));
  const req = [];
  for (const x of [...gaps].reverse()) {
    const at = x.at + Math.min(x.del, x.ins);
    if (x.ins > x.del) req.push({ insertDimension: { range: { sheetId: dstId, dimension: "ROWS", startIndex: at, endIndex: at + x.ins - x.del }, inheritFromBefore: at > 0 } });
    if (x.del > x.ins) req.push({ deleteDimension: { range: { sheetId: dstId, dimension: "ROWS", startIndex: at, endIndex: at + x.del - x.ins } } });
  }
  // 열은 끝에서만 늘리고 줄인다(영업부용은 J열까지라 열 구성은 거의 안 바뀜)
  if (sC > dst.g.columnCount) req.push({ appendDimension: { sheetId: dstId, dimension: "COLUMNS", length: sC - dst.g.columnCount } });
  if (sC < dst.g.columnCount) req.push({ deleteDimension: { range: { sheetId: dstId, dimension: "COLUMNS", startIndex: sC, endIndex: dst.g.columnCount } } });
  await batch(book.sales, req);
  const rowOps = { ins: gaps.reduce((a, x) => a + Math.max(0, x.ins - x.del), 0), del: gaps.reduce((a, x) => a + Math.max(0, x.del - x.ins), 0) };
  if (req.length) dst = await loadGrid(book.sales, dstTitle);
  if (dst.g.rowCount !== sR) throw new Error(`${dstTitle}: 행 맞추기 뒤에도 행 수가 다름(${dst.g.rowCount}/${sR})`);

  // ② 병합: 영업부용에만 있는 병합은 먼저 풀기
  const sKeys = new Set(src.merges.map(mkey)), dKeys = new Set(dst.merges.map(mkey));
  const keepMerges = dst.merges.filter((m) => sKeys.has(mkey(m)));
  const pre = dst.merges.filter((m) => !sKeys.has(mkey(m))).map((m) => ({ unmergeCells: { range: rng(dstId, m) } }));
  // ③ 다른 칸 찾기 → 행마다 이어진 구간 → 걸치는 병합까지 넓혀서 칸 복사
  const rects = [];
  let cells = 0;
  for (let r = 0; r < sR; r++) {
    let st = -1;
    for (let c = 0; c <= sC; c++) {
      const diff = c < sC && cellSig(src.rows[r]?.[c]) !== cellSig(dst.rows[r]?.[c]);
      if (diff) { cells++; if (st < 0) st = c; }
      else if (st >= 0) { rects.push({ startRowIndex: r, endRowIndex: r + 1, startColumnIndex: st, endColumnIndex: c }); st = -1; }
    }
  }
  const allMerges = [...src.merges, ...keepMerges];
  for (const rc of rects) for (let grown = true; grown;) {
    grown = false;
    for (const m of allMerges) if (inside(m, rc) && (m.startRowIndex < rc.startRowIndex || m.endRowIndex > rc.endRowIndex || m.startColumnIndex < rc.startColumnIndex || m.endColumnIndex > rc.endColumnIndex)) {
      rc.startRowIndex = Math.min(rc.startRowIndex, m.startRowIndex); rc.endRowIndex = Math.max(rc.endRowIndex, m.endRowIndex);
      rc.startColumnIndex = Math.min(rc.startColumnIndex, m.startColumnIndex); rc.endColumnIndex = Math.max(rc.endColumnIndex, m.endColumnIndex); grown = true;
    }
  }
  await batch(book.sales, [...pre, ...rects.map((rc) => ({ copyPaste: { source: rng(srcId, rc), destination: rng(dstId, rc), pasteType: "PASTE_NORMAL", pasteOrientation: "NORMAL" } }))]);
  // ④ 아직 없는 병합 걸기, 행 높이·열 너비·눈금선 (칸을 안 고쳤으면 다시 읽지 않는다 — 분당 읽기 한도)
  const after = new Set((pre.length || rects.length ? (await loadGrid(book.sales, dstTitle)).merges : keepMerges).map(mkey));
  const post = src.merges.filter((m) => !after.has(mkey(m))).map((m) => ({ mergeCells: { range: rng(dstId, m), mergeType: "MERGE_ALL" } }));
  post.push({ updateSheetProperties: { properties: { sheetId: dstId, gridProperties: { hideGridlines: !!src.g.hideGridlines } }, fields: "gridProperties.hideGridlines" } });
  post.push(...await sizeRequests(size, dstId, sR, sC));
  await batch(book.sales, post);
  return { cells, rects: rects.length, ...rowOps, merges: pre.length + post.filter((x) => x.mergeCells).length, dKeys: dKeys.size };
}

async function sizeRequests(from, dstId, dstRows, dstCols) {
  const s = (await sheets.spreadsheets.get({ spreadsheetId: from.id, ranges: [q(from.title)], fields: "sheets.data(rowMetadata(pixelSize,hiddenByUser),columnMetadata(pixelSize,hiddenByUser))" })).data.sheets[0].data[0];
  const req = [];
  const runs = (arr, n, dim) => {
    let st = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && arr[i].pixelSize === arr[st].pixelSize && !!arr[i].hiddenByUser === !!arr[st].hiddenByUser) continue;
      // 높이 21(기본값) 행은 '내용에 맞춤'일 수 있다 — API는 맞춤 행도 21로 알려 주므로 고정하지 말고 맞춤으로(10-23 표준 28행 외부 간판이 21 고정으로 잘림)
      if (dim === "ROWS" && arr[st].pixelSize === AUTO_ROW && !arr[st].hiddenByUser) req.push({ autoResizeDimensions: { dimensions: { sheetId: dstId, dimension: dim, startIndex: st, endIndex: i } } });
      else req.push({ updateDimensionProperties: { range: { sheetId: dstId, dimension: dim, startIndex: st, endIndex: i }, properties: { pixelSize: arr[st].pixelSize, hiddenByUser: !!arr[st].hiddenByUser }, fields: "pixelSize,hiddenByUser" } });
      st = i;
    }
  };
  runs(s.rowMetadata, Math.min(s.rowMetadata.length, dstRows), "ROWS");
  runs(s.columnMetadata, Math.min(s.columnMetadata.length, dstCols), "COLUMNS");
  return req;
}

async function replaceSales(temps) {
  const sm = await meta(book.sales);
  // 덮어쓰기 전에 탭마다 숨김 백업(같은 시트 안 사본) — 검증 실패면 이 내용으로 같은 탭에 되돌린다
  await batch(book.sales, TABS.map(([, s]) => byTitle(sm, s)).filter(Boolean).map((x) => ({ duplicateSheet: { sourceSheetId: x.properties.sheetId, newSheetName: BAK + x.properties.title, insertSheetIndex: sm.length } })));
  const sm2 = await meta(book.sales);
  await batch(book.sales, sm2.filter((s) => s.properties.title.startsWith(BAK)).map((s) => ({ updateSheetProperties: { properties: { sheetId: s.properties.sheetId, hidden: true }, fields: "hidden" } })));
  for (const t of temps) {
    const n = (await sheets.spreadsheets.sheets.copyTo({ spreadsheetId: book.orig, sheetId: t.id, requestBody: { destinationSpreadsheetId: book.sales } })).data;
    const stage = STAGE + t.s;
    await batch(book.sales, [{ updateSheetProperties: { properties: { sheetId: n.sheetId, title: stage, hidden: true }, fields: "title,hidden" } }]);
    const dst = byTitle(sm2, t.s);
    if (!dst) {
      // 영업부용에 아직 없는 탭: 준비 탭을 그대로 그 이름으로 쓰고 잠근다(편집자: 지금 고치는 계정만)
      await batch(book.sales, [
        { updateSheetProperties: { properties: { sheetId: n.sheetId, title: t.s, hidden: false }, fields: "title,hidden" } },
        ...await sizeRequests({ id: book.orig, title: t.o }, n.sheetId, n.gridProperties.rowCount, n.gridProperties.columnCount),
        { addProtectedRange: { protectedRange: { range: { sheetId: n.sheetId }, description: "영업부용 원판 — 원본에서 반영", editors: { users: [actorEmail] } } } },
      ]);
      console.log(`  ${t.s}: 새 탭으로 추가`);
      continue;
    }
    const r = await applyTab(n.sheetId, stage, dst.properties.sheetId, t.s, { id: book.orig, title: t.o });
    await batch(book.sales, [{ deleteSheet: { sheetId: n.sheetId } }]);
    console.log(`  ${t.s}: 바뀐 칸 ${r.cells}개${r.ins ? `, 행 넣음 ${r.ins}` : ""}${r.del ? `, 행 지움 ${r.del}` : ""}${r.merges ? `, 병합 고침 ${r.merges}` : ""}`);
  }
}
async function dropStages() {
  const sm = await meta(book.sales);
  await batch(book.sales, sm.filter((s) => s.properties.title.startsWith(STAGE)).map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })));
}

// 영업부용 탭별 탭 전체 잠금의 편집자(잠금 없으면 null). 처음 생기는 탭은 잠근다(편집자: 서비스 계정만).
function salesProtection(sm) {
  const out = {};
  for (const [, s] of TABS) {
    const x = byTitle(sm, s);
    out[s] = !x ? { users: [] } : x.protectedRanges?.find((p) => p.range.startRowIndex === undefined && p.range.startColumnIndex === undefined)?.editors || null;
  }
  return out;
}

// 백업 내용을 같은 탭에 다시 덮어써서 되돌린다(탭을 바꾸지 않으니 댓글·링크 유지). 탭이 없어졌으면 백업 이름만 되돌림
async function rollback() {
  await dropStages();
  const sm = await meta(book.sales);
  let n = 0;
  for (const [, s] of TABS) {
    const bak = byTitle(sm, BAK + s); if (!bak) continue;
    const cur = byTitle(sm, s);
    if (cur) {
      await applyTab(bak.properties.sheetId, BAK + s, cur.properties.sheetId, s, { id: book.sales, title: BAK + s });
      await batch(book.sales, [{ deleteSheet: { sheetId: bak.properties.sheetId } }]);
    } else await batch(book.sales, [{ updateSheetProperties: { properties: { sheetId: bak.properties.sheetId, title: s, hidden: false }, fields: "title,hidden" } }]);
    n++;
  }
  return n;
}
async function dropBackups() {
  const sm = await meta(book.sales);
  await batch(book.sales, sm.filter((s) => s.properties.title.startsWith(BAK)).map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })));
}

// ---------- 실행 ----------
(async () => {
  console.log(`[반영] ${book.label}${book.test ? " (시험용)" : ""}`);
  if (!has("--check")) requireUserForWrite(); // --check(읽기만) 말고는 시트를 고친다
  if (has("--rollback")) { console.log(`백업으로 되돌림: ${await rollback()}건`); return; }
  if (has("--accept")) { await dropBackups(); await writeLog(); console.log("확정: 백업 삭제, 반영 기록 저장"); return; }
  if ((await meta(book.sales)).some((s) => s.properties.title.startsWith(BAK))) throw new Error("영업부용에 지난 반영 백업이 남아 있다. --rollback 또는 --accept로 먼저 정리할 것");
  if (!has("--check")) await dropStages(); // 중간에 끊긴 반영이 남긴 준비 탭(원가 없는 내용) — 같은 이름으로 다시 만들 수 있게 지움

  const ch = await salesChanges();
  if (ch.noLog) console.log("변경 감지: 반영 기록 없음(첫 반영)");
  else if (ch.list.length) {
    console.log(`변경 감지: 마지막 반영(${ch.when}) 이후 영업부용에서 직접 바뀐 칸 ${ch.list.length}개`);
    ch.list.slice(0, 30).forEach((x) => console.log("  · " + x));
    if (has("--adopt") && !has("--check")) {
      const a = await adopt(ch.cells);
      if (a.skipped.length) { console.log("→ 원본에 옮기지 못한 칸이 있어 아무것도 옮기지 않고 멈춤(반영도 안 함):"); a.skipped.forEach((x) => console.log("  · " + x)); process.exitCode = 6; return; }
      console.log(`→ 원본에 옮김 ${a.moved.length}칸(옮긴 뒤 다시 읽어 확인함):`); a.moved.forEach((x) => console.log("  · " + x));
      console.log("→ 이어서 반영");
    } else if (has("--check") || !has("--force")) { console.log(has("--check") ? "" : "→ 반영하지 않음. 원본에 옮기려면 --adopt, 영업부용 수정을 버리려면 --force"); process.exitCode = has("--check") ? 0 : 2; return; }
  } else console.log(`변경 감지: 마지막 반영(${ch.when}) 이후 영업부용 직접 수정 없음`);
  if (has("--check")) return;

  const prot = salesProtection(await meta(book.sales)); // 검증 때 반영 전 잠금과 대조
  let temps;
  try {
    temps = await buildTemps();
    const leaks = await leakCheck(temps);
    console.log(`원본 정리: 임시 탭 ${temps.length}개, 원가 참조 수식→값 ${temps.reduce((a, t) => a + (t.valueFixed || 0), 0)}칸`);
    if (leaks.length) { console.log("원가 흔적 발견 → 중단(영업부용 변경 없음)"); leaks.slice(0, 20).forEach((x) => console.log("  · " + x)); process.exitCode = 3; return; }
    console.log("원가 흔적 검사: 통과");
    if (has("--dry")) { console.log("--dry: 영업부용은 건드리지 않음"); return; }
    try { await replaceSales(temps); }
    catch (e) { console.log("영업부용 덮어쓰기 중 실패 → 자동 되돌림:", e.message); await rollback(); process.exitCode = 4; return; }
  } finally { await deleteTemps(); await dropStages(); }

  console.log("\n[자동 검증]");
  const v = await verify(book, { prot });
  if (v.total) {
    console.log("\n검증 차이가 있어 백업을 남겨 둠. 확인 후 --rollback(되돌림) 또는 --accept(확정)");
    process.exitCode = 5; return;
  }
  await dropBackups();
  await writeLog();
  console.log(`\n반영 완료: 영업부용 최종 금액 ${Number(v.amount).toLocaleString("ko-KR")}원, 백업 삭제·반영 기록 저장`);
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
