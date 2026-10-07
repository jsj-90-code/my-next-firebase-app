// 구글시트 05_경쟁점정보 "시간당환산요금" 빈칸 채우기 (2026-10-07, 사용자 "시간당환산요금 비어있는거 너가 다 대신 좀 넣어줘").
//
// 기존점(가맹점) 경쟁점은 시트가 원본이라 매일 06:00 크론(cronSync.ts)이 시트 값으로 Firestore를 덮는다 — Firestore만 채우면 다음 날 빈칸으로 돌아간다.
// 그래서 시트에 직접 넣는다. 같은 행의 "1000원당분"이 있고 "시간당환산요금"이 빈 칸만, 폼과 같은 식 Math.round(60000 / 분)으로. 다른 칸은 안 건드린다.
// 다음 크론이 Firestore로 옮긴다. 후보지 경쟁점은 scripts/fillHourlyRateConverted20261007.mjs가 Firestore에 직접 채운다.
//
//   node scripts/fillSheetHourlyRateConverted20261007.mjs          # 미리보기
//   node scripts/fillSheetHourlyRateConverted20261007.mjs --apply  # 시트에 쓴다
import { readFileSync } from "node:fs";
import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const SHEET = "05_경쟁점정보";

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();
const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const SPREADSHEET_ID = process.env.STORE_EVAL_SPREADSHEET_ID || "1Q5yCOL5IT_pT8lYKvtzhzPK3ihC0otVifQBNPi0SjRA";
if (!clientEmail || !privateKey) { console.error(".env.local에 FIREBASE_CLIENT_EMAIL · FIREBASE_PRIVATE_KEY가 필요하다."); process.exit(1); }
const auth = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });

function colLetter(i) { let s = ""; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
const num = (v) => { const n = Number(String(v ?? "").replace(/[,\s분원]/g, "")); return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null; };

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SHEET}'!A1:AX2000` });
const [header, ...rows] = res.data.values ?? [];
const iCode = header.indexOf("가맹점코드"), iName = header.indexOf("경쟁점명"), iMin = header.indexOf("1000원당분"), iHour = header.indexOf("시간당환산요금");
if ([iCode, iName, iMin, iHour].some((i) => i < 0)) { console.error("헤더를 못 찾음:", { iCode, iName, iMin, iHour }); process.exit(1); }

const updates = [];
let blankNoMin = 0;
rows.forEach((r, k) => {
  if (!String(r[iName] ?? "").trim()) return;
  if (String(r[iHour] ?? "").trim() !== "") return;
  const min = num(r[iMin]);
  if (min == null || min <= 0) { blankNoMin += 1; return; }
  const hourly = Math.round(60000 / min);
  const rowNo = k + 2;
  updates.push({ range: `'${SHEET}'!${colLetter(iHour)}${rowNo}`, values: [[hourly]], label: `${rowNo}행 ${r[iCode]} ${r[iName]}  ${min}분 → ${hourly}원/h${min < 20 || min > 120 ? "  ⚠️ 분이 이상함" : ""}` });
});
console.log(`시트 ${SHEET}: 시간당환산요금 빈칸 · 1000원당분 있음 ${updates.length}칸 (${colLetter(iHour)}열) · 분도 없어 못 채움 ${blankNoMin}행\n`);
for (const u of updates) console.log("  " + u.label);

if (APPLY && updates.length > 0) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data: updates.map(({ range, values }) => ({ range, values })) },
  });
  console.log(`\n${updates.length}칸 썼다. 다음 06:00 크론이 Firestore로 옮긴다.`);
} else if (!APPLY) {
  console.log("\n미리보기만 했다(--apply로 쓴다).");
}
process.exit(0);
