// 반영 검증: 원본(영업부용으로 보낼 모습) ↔ 영업부용을 칸 단위로 대조
//   node scripts/quote/verify.mjs <black|gold> [--test]
// 값·수식·서식(정렬·글꼴·색·숫자서식·테두리·줄바꿈)·메모·병합·열 너비·행 높이·보호·원가 유출·최종 금액
import { pathToFileURL } from "node:url";
import { sheets, TOOL_EMAILS, AUTO_ROW, TABS, LEAK_WORDS, NOTE_LEAK_WORDS, LAST_SALES_COL, INTERNAL_BLOCK, refsBeyondJ, colName, q, renameRefs, pickBook } from "./lib.mjs";

// textFormatRuns(칸 안 일부 글자 서식)도 비교 — 10-24 덮어쓰기 방식 검토 때 이것만 바뀐 칸을 검증이 못 잡는 걸 확인
const runsSig = (c) => JSON.stringify((c.textFormatRuns || []).map((r) => [r.startIndex || 0, { ...r.format, foregroundColorStyle: undefined, link: r.format?.link?.uri }]));
const FIELDS = "sheets(properties(title,gridProperties),merges,protectedRanges(range,editors),data(columnMetadata(pixelSize,hiddenByUser),rowMetadata(pixelSize,hiddenByUser),rowData(values(formattedValue,userEnteredValue,note,textFormatRuns,effectiveFormat(horizontalAlignment,verticalAlignment,wrapStrategy,numberFormat,backgroundColor,borders,textFormat(fontFamily,fontSize,bold,italic,strikethrough,underline,foregroundColor))))))";
const fmtSig = (f = {}) => JSON.stringify({ h: f.horizontalAlignment, v: f.verticalAlignment, w: f.wrapStrategy, n: f.numberFormat?.pattern || f.numberFormat?.type, b: f.backgroundColor, t: f.textFormat && { ...f.textFormat, foregroundColorStyle: undefined }, br: f.borders && Object.fromEntries(Object.entries(f.borders).map(([k, x]) => [k, x.style])) });
const load = async (id, title) => (await sheets.spreadsheets.get({ spreadsheetId: id, ranges: [q(title)], includeGridData: true, fields: FIELDS })).data.sheets[0];
const mk = (m) => `${colName(m.startColumnIndex)}${m.startRowIndex + 1}:${colName(m.endColumnIndex - 1)}${m.endRowIndex}`;

export async function verify(book, { log = console.log, prot = null } = {}) {
  let total = 0;
  const report = {};
  for (const [oName, sName, keepCols] of TABS) {
    const o = await load(book.orig, oName), s = await load(book.sales, sName);
    const issues = { 값: [], 수식: [], 서식: [], 메모: [], 병합: [], 크기: [], 유출: [], 보호: [] };
    const oRows = o.data[0].rowData || [], sRows = s.data[0].rowData || [];
    let lastRow = o.properties.gridProperties.rowCount;
    if (oName === "최종") { const i = oRows.findIndex((r) => String(r.values?.[1]?.formattedValue || "").startsWith(INTERNAL_BLOCK)); if (i >= 0) lastRow = i; }
    const lastCol = keepCols ? o.properties.gridProperties.columnCount : LAST_SALES_COL;
    let valueFixed = 0;
    for (let r = 0; r < Math.max(lastRow, sRows.length); r++) for (let c = 0; c < lastCol; c++) {
      const oc = r < lastRow ? oRows[r]?.values?.[c] || {} : {}, sc = sRows[r]?.values?.[c] || {};
      const a1 = colName(c) + (r + 1);
      const of = oc.userEnteredValue?.formulaValue, sf = sc.userEnteredValue?.formulaValue;
      if ((oc.formattedValue || "") !== (sc.formattedValue || "")) issues.값.push(`${a1} 원본[${(oc.formattedValue || "").slice(0, 18)}] 영업[${(sc.formattedValue || "").slice(0, 18)}]`);
      if (of && !keepCols && refsBeyondJ(of)) { if (sf) issues.수식.push(`${a1} 원가 참조 수식이 값으로 안 바뀜`); else valueFixed++; }
      else if ((of ? renameRefs(of) : "") !== (sf || "")) issues.수식.push(`${a1} 원본[${(of || "").slice(0, 30)}] 영업[${(sf || "").slice(0, 30)}]`);
      if (r < lastRow && (fmtSig(oc.effectiveFormat) !== fmtSig(sc.effectiveFormat) || runsSig(oc) !== runsSig(sc))) issues.서식.push(a1);
      if ((oc.note || "") !== (sc.note || "")) issues.메모.push(a1);
      if (LEAK_WORDS.some((w) => (sc.formattedValue || "").includes(w))) issues.유출.push(`${a1} "${sc.formattedValue.slice(0, 20)}"`);
      if (sc.note && NOTE_LEAK_WORDS.some((w) => sc.note.includes(w))) issues.유출.push(`${a1} 메모`);
      if (sf && !keepCols && refsBeyondJ(sf)) issues.유출.push(`${a1} 수식이 K열 이후 참조`);
    }
    if (!keepCols && s.properties.gridProperties.columnCount > LAST_SALES_COL) issues.유출.push(`J열 뒤에 열 ${s.properties.gridProperties.columnCount - LAST_SALES_COL}개`);
    const om = new Set((o.merges || []).filter((m) => m.startRowIndex < lastRow && m.startColumnIndex < lastCol)
      .map((m) => ({ ...m, endColumnIndex: Math.min(m.endColumnIndex, lastCol) })).filter((m) => m.endColumnIndex - m.startColumnIndex + m.endRowIndex - m.startRowIndex > 2).map(mk));
    const sm = new Set((s.merges || []).map(mk));
    for (const x of om) if (!sm.has(x)) issues.병합.push("빠짐 " + x);
    for (const x of sm) if (!om.has(x)) issues.병합.push("추가 " + x);
    o.data[0].columnMetadata.slice(0, lastCol).forEach((m, i) => { const t = s.data[0].columnMetadata[i] || {}; if (m.pixelSize !== t.pixelSize || !!m.hiddenByUser !== !!t.hiddenByUser) issues.크기.push(`${colName(i)}열 ${m.pixelSize}/${t.pixelSize}`); });
    // 원본 높이 21 = '내용에 맞춤'일 수 있어 영업부용은 맞춤 결과(더 클 수 있음)라 높이는 비교하지 않는다
    o.data[0].rowMetadata.slice(0, lastRow).forEach((m, i) => { const t = s.data[0].rowMetadata[i] || {}; if ((m.pixelSize !== AUTO_ROW && m.pixelSize !== t.pixelSize) || !!m.hiddenByUser !== !!t.hiddenByUser) issues.크기.push(`${i + 1}행 ${m.pixelSize}/${t.pixelSize}`); });
    // 잠금은 반영 전 상태(prot)와 같아야 한다 — 따로 돌릴 때(prot 없음)는 잠금을 보지 않는다
    if (prot) {
      const whole = (s.protectedRanges || []).find((p) => p.range.startRowIndex === undefined && p.range.startColumnIndex === undefined);
      const want = prot[sName];
      if (!!want !== !!whole) issues.보호.push(want ? "탭 전체 잠금 빠짐" : "원래 없던 잠금이 걸림");
      else if (want) {
        const users = (u) => [...new Set(u || [])].filter((x) => !TOOL_EMAILS.includes(x)).sort().join(",");
        if (users(want.users) !== users(whole.editors?.users)) issues.보호.push("잠금 편집자가 반영 전과 다름");
      }
    }
    const n = Object.values(issues).reduce((a, b) => a + b.length, 0);
    total += n;
    report[sName] = issues;
    log(`■ ${sName}: ${n ? "차이 " + n + "건" : "일치"}${valueFixed ? ` (원가 참조 수식→값 고정 ${valueFixed}칸)` : ""}`);
    for (const [k, v] of Object.entries(issues)) if (v.length) log(`   ${k} ${v.length}: ${v.slice(0, 6).join(" | ")}${v.length > 6 ? " …" : ""}`);
  }
  const fin = TABS.find(([o]) => o === "최종");
  const [a, b] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: book.orig, range: `${q(fin[0])}!${book.finalCell}`, valueRenderOption: "UNFORMATTED_VALUE" }),
    sheets.spreadsheets.values.get({ spreadsheetId: book.sales, range: `${q(fin[1])}!${book.finalCell}`, valueRenderOption: "UNFORMATTED_VALUE" }),
  ]);
  const amountO = a.data.values?.[0]?.[0], amountS = b.data.values?.[0]?.[0];
  const amountOk = Math.round(amountO) === Math.round(amountS);
  if (!amountOk) total++;
  log(`최종 금액: 원본 ${Number(amountO).toLocaleString("ko-KR")} / 영업부용 ${Number(amountS).toLocaleString("ko-KR")} ${amountOk ? "✓" : "✗"}`);
  log(`=== 전체 ${total ? "차이 " + total + "건" : "일치 ✓"} ===`);
  return { total, report, amount: amountS };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const book = pickBook(process.argv.slice(2));
  console.log(`[검증] ${book.label}${book.test ? " (시험용)" : ""}`);
  verify(book).then((r) => process.exit(r.total ? 1 : 0)).catch((e) => { console.error("실패:", e.message); process.exit(1); });
}
