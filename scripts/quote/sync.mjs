// 견적서 원본 → 영업부용 반영 (2026-10-23, Apps Script 버튼 대신 Claude Code에서 실행)
//   node scripts/quote/sync.mjs <black|gold> [--test] [--dry]      반영(--dry: 원본 안 정리·검사까지만)
//   node scripts/quote/sync.mjs <black|gold> [--test] --check      영업부용에서 직접 바뀐 칸만 확인
//   node scripts/quote/sync.mjs <black|gold> [--test] --adopt      직접 바뀐 칸을 원본 같은 자리에 옮긴 뒤 반영(원본도 바뀐 칸·원가 수식 칸이 있으면 멈춤)
//   node scripts/quote/sync.mjs <black|gold> [--test] --force      직접 바뀐 칸이 있어도 덮어씀(영업부용 수정을 버림)
//   node scripts/quote/sync.mjs <black|gold> [--test] --rollback   검증 실패로 남겨 둔 백업으로 되돌림
//   node scripts/quote/sync.mjs <black|gold> [--test] --accept     검증 차이를 확인하고 그대로 확정(백업 삭제·기록 저장)
//
// 순서: 원본 안에 임시 탭 → 원가(K열~)·본사 내부 정리 표 삭제, 원가 참조 수식은 값으로 → 원가 흔적 검사(걸리면 중단)
//   → 영업부용 기존 탭은 이름만 바꿔 백업 → 깨끗한 탭 복사·행 높이/열 너비·보호 → 자동 검증
//   → 통과하면 백업 삭제·기록 저장, 실패하면 백업을 남기고 멈춤(--rollback/--accept로 결정)
// 원가가 들어간 내용은 영업부용 시트에 한 순간도 들어가지 않는다.
import { sheets, actorEmail, AUTO_ROW, TABS, LEAK_WORDS, NOTE_LEAK_WORDS, LAST_SALES_COL, INTERNAL_BLOCK, LOG_SHEET, refsBeyondJ, renameRefs, colName, q, pickBook } from "./lib.mjs";
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

// ---------- 2) 영업부용 교체 ----------
async function sizeRequests(srcSheetTitle, dstId, dstRows, dstCols) {
  const s = (await sheets.spreadsheets.get({ spreadsheetId: book.orig, ranges: [q(srcSheetTitle)], fields: "sheets.data(rowMetadata(pixelSize,hiddenByUser),columnMetadata(pixelSize,hiddenByUser))" })).data.sheets[0].data[0];
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
  // 탭마다 반영 전 잠금(편집자)을 그대로 — 없던 잠금은 걸지 않는다(10-23: 블랙 정보입력·표지는 원래 안 잠김, 골드는 탭마다 편집자 수가 다름)
  const prot = salesProtection(sm);
  const order = TABS.map(([, s]) => s).sort((a, b) => (byTitle(sm, a)?.properties.index ?? 99) - (byTitle(sm, b)?.properties.index ?? 99));
  // 기존 탭은 이름만 바꿔 백업
  await batch(book.sales, TABS.map(([, s]) => byTitle(sm, s)).filter(Boolean).map((x) => ({ updateSheetProperties: { properties: { sheetId: x.properties.sheetId, title: BAK + x.properties.title }, fields: "title" } })));
  for (const t of temps) {
    const n = (await sheets.spreadsheets.sheets.copyTo({ spreadsheetId: book.orig, sheetId: t.id, requestBody: { destinationSpreadsheetId: book.sales } })).data;
    const req = [{ updateSheetProperties: { properties: { sheetId: n.sheetId, title: t.s, gridProperties: { hideGridlines: !!t.src.properties.gridProperties.hideGridlines } }, fields: "title,gridProperties.hideGridlines" } }];
    req.push(...await sizeRequests(t.o, n.sheetId, n.gridProperties.rowCount, n.gridProperties.columnCount));
    const editors = prot[t.s];
    if (editors) req.push({ addProtectedRange: { protectedRange: { range: { sheetId: n.sheetId }, description: "영업부용 원판 — 원본에서 반영", editors: { users: [...new Set([...(editors.users || []), actorEmail])], groups: editors.groups || [], domainUsersCanEdit: !!editors.domainUsersCanEdit } } } });
    await batch(book.sales, req);
  }
  const sm2 = await meta(book.sales);
  const synced = new Set(TABS.map(([, s]) => s));
  await batch(book.sales, [
    ...sm2.filter((s) => s.properties.title.startsWith(BAK)).map((s) => ({ updateSheetProperties: { properties: { sheetId: s.properties.sheetId, hidden: true }, fields: "hidden" } })),
    // 반영 대상이 아닌 탭은 숨김 상태를 반영 전과 똑같이 — 바뀐 탭만(잠긴 탭은 바꾸지 않는 요청도 거부됨, 10-23 블랙 '최종(이전)_사용불가')
    ...sm.filter((s) => !synced.has(s.properties.title) && !s.properties.title.startsWith(BAK) && !!byTitle(sm2, s.properties.title)?.properties.hidden !== !!s.properties.hidden).map((s) => ({ updateSheetProperties: { properties: { sheetId: s.properties.sheetId, hidden: !!s.properties.hidden }, fields: "hidden" } })),
    ...order.map((name, i) => ({ updateSheetProperties: { properties: { sheetId: byTitle(sm2, name).properties.sheetId, index: i }, fields: "index" } })),
  ]);
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

async function rollback() {
  const sm = await meta(book.sales);
  const req = [];
  for (const [, s] of TABS) {
    const bak = byTitle(sm, BAK + s); if (!bak) continue;
    const cur = byTitle(sm, s); if (cur) req.push({ deleteSheet: { sheetId: cur.properties.sheetId } });
    req.push({ updateSheetProperties: { properties: { sheetId: bak.properties.sheetId, title: s, hidden: false }, fields: "title,hidden" } });
  }
  await batch(book.sales, req);
  return req.length;
}
async function dropBackups() {
  const sm = await meta(book.sales);
  await batch(book.sales, sm.filter((s) => s.properties.title.startsWith(BAK)).map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })));
}

// ---------- 실행 ----------
(async () => {
  console.log(`[반영] ${book.label}${book.test ? " (시험용)" : ""}`);
  if (has("--rollback")) { console.log(`백업으로 되돌림: ${await rollback()}건`); return; }
  if (has("--accept")) { await dropBackups(); await writeLog(); console.log("확정: 백업 삭제, 반영 기록 저장"); return; }
  if ((await meta(book.sales)).some((s) => s.properties.title.startsWith(BAK))) throw new Error("영업부용에 지난 반영 백업이 남아 있다. --rollback 또는 --accept로 먼저 정리할 것");

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
    catch (e) { console.log("영업부용 교체 중 실패 → 자동 되돌림:", e.message); await rollback(); process.exitCode = 4; return; }
  } finally { await deleteTemps(); }

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
