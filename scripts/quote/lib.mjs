// 견적서(블랙·골드) 원본 → 영업부용 반영 공용 모듈 (2026-10-23)
// 기본은 사용자 본인 구글 계정(OAuth)으로 접근한다 — 시트 수정 기록에 로봇 이름 대신 본인 이름이 남게(10-23 사용자 요청).
//   준비: .env.local에 QUOTE_OAUTH_CLIENT_ID·QUOTE_OAUTH_CLIENT_SECRET, PC마다 한 번 `node scripts/quote/login.mjs`
//   로그인 정보는 저장소 밖 ~/.isens-quote/token.json(PC마다 따로, git에 안 올라감).
// 로그인 정보가 없으면 서비스 계정(FIREBASE_CLIENT_EMAIL/PRIVATE_KEY)으로 — 이때는 대상 시트와 탭 보호에 그 계정이 편집자로 있어야 한다.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();
// 분당 읽기·쓰기 한도(429)나 일시 오류(5xx)면 기다렸다가 다시 시도(최대 6번, 점점 길게)
google.options({ retryConfig: { retry: 6, retryDelay: 5000, statusCodesToRetry: [[429, 429], [500, 599]], httpMethodsToRetry: ["GET", "POST", "PUT"], onRetryAttempt: (e) => console.log(`  (구글 한도/오류 ${e.response?.status ?? ""} → 잠시 후 다시 시도)`) } });

export const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "openid", "email"];
export const TOKEN_FILE = join(homedir(), ".isens-quote", "token.json");
export function oauthClient(redirectUri) {
  const id = process.env.QUOTE_OAUTH_CLIENT_ID, secret = process.env.QUOTE_OAUTH_CLIENT_SECRET;
  return id && secret ? new google.auth.OAuth2(id, secret, redirectUri) : null;
}
function readToken() { try { return JSON.parse(readFileSync(TOKEN_FILE, "utf8")); } catch { return null; } }

export const saEmail = process.env.FIREBASE_CLIENT_EMAIL;
const token = process.env.QUOTE_AUTH === "sa" ? null : readToken();
const userAuth = token?.refresh_token ? oauthClient() : null;
let auth;
if (userAuth) {
  userAuth.setCredentials({ refresh_token: token.refresh_token });
  auth = userAuth;
} else {
  const key = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\+n/g, "\n").replace(/^"|"$/g, "");
  if (!saEmail || !key) throw new Error("로그인 정보도 서비스 계정도 없다 — node scripts/quote/login.mjs 로 로그인할 것");
  if (!process.argv[1]?.endsWith("login.mjs")) console.log("  ※ 로그인 정보 없음 → 서비스 계정(로봇)으로 읽기만 함 — 시트를 고치는 작업은 멈춤(login.mjs로 로그인할 것)");
  auth = new google.auth.JWT({ email: saEmail, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
}
export const sheets = google.sheets({ version: "v4", auth });
export const userEmail = userAuth ? token.email : null;
// 탭 잠금을 새로 걸 때 편집자에 꼭 넣을 계정(지금 시트를 고치는 계정) / 검증 때 비교에서 빼는 계정
export const actorEmail = userEmail || saEmail;
export const TOOL_EMAILS = [saEmail, userEmail].filter(Boolean);
// 로봇(서비스 계정)으로는 시트를 고치지 않는다 — 수정 기록에 로봇 이름이 남는 걸 사용자가 싫어함(10-23). 꼭 필요하면 QUOTE_AUTH=sa로 명시
export function requireUserForWrite() {
  if (userEmail || process.env.QUOTE_AUTH === "sa") return;
  throw new Error("이 PC에서 구글 로그인을 안 해서 시트를 고치지 않고 멈춤 — node scripts/quote/login.mjs 로 로그인한 뒤 다시");
}

// 시트 주소. test = 반영 시험용 사본(사용자 내 드라이브).
export const BOOKS = {
  black: {
    label: "블랙", finalCell: "F20",
    orig: "1hwhFUnG1wdBFRVq89OjE0SgF7Lb73-LiomemBrsEd10", sales: "1wuCXfCFBhwI9R3l2S8CIMfIMwcaLXcj2ygKESELZZi0",
    test: { orig: "1axj0nXq2CC_IV1KDWFZcujdX6P2nES6LG_ELMEFrJCw", sales: "1hQP_DwjkdBkJKJXQiPdX88lSLcG0gQp9V7X9BUg1HDw" },
  },
  gold: {
    label: "골드", finalCell: "F17",
    orig: "1e3HsbUHHU7gp8jlZsE4Rgl73bHxouMoQSFoezThN8T0", sales: "1X4uHaFxJkb_Jy3pfHJmhJaGiXaw07mw6yzeOn4sK6OM",
  },
};

// [원본 탭, 영업부용 탭, 열을 자르지 않음]. 순서 = 영업부용에 복사하는 순서(참조되는 탭이 먼저).
export const TABS = [
  ["정보입력(댓수,평수)", "정보입력(댓수,평수)", true],
  ["PC 및 주변 기기 내역", "PC 및 주변 기기 내역", false],
  ["서버 및 PC 가구 내역", "서버 및 PC 가구 내역", false],
  ["인테리어 표준 공사 및 주방 내역", "인테리어 표준 공사 및 주방 내역", false],
  ["인테리어 비표준 공사 및 가맹비 내역", "인테리어 비표준 공사 및 가맹비 내역", false],
  ["최종", "최종_민주채린", false],
  ["표지", "표지", true],
];
export const AUTO_ROW = 21; // 구글 시트가 "내용에 맞춤" 행에 알려 주는 높이(기본값)
export const LAST_SALES_COL = 10; // J열까지만 영업부용으로
export const INTERNAL_BLOCK = "본사 내부 정리"; // 최종 탭의 원본 전용 표(이 줄부터 아래는 안 보냄)
export const LEAK_WORDS = ["원가(수정)", "원가 합계", "개별 마진", "본사 마진", "본사 내부 정리", "부품별 원가", "매입가", "원가 대비"];
export const NOTE_LEAK_WORDS = [...LEAK_WORDS, "원가", "마진", "공급가", "매입"];
export const LOG_SHEET = "__반영기록"; // 원본 안 숨김 탭: 마지막 반영 때 영업부용 내용(변경 감지 기준)

export const refsBeyondJ = (f) => /(^|[^A-Za-z0-9_])\$?([K-Z]|[A-Z]{2,3})\$?\d+/.test(String(f).replace(/"[^"]*"/g, ""));
export const colName = (c) => { let s = ""; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
export const q = (t) => `'${t.replace(/'/g, "''")}'`;
export const nameMap = Object.fromEntries(TABS.filter(([o, s]) => o !== s).map(([o, s]) => [o, s]));
export function renameRefs(formula) {
  let y = formula;
  for (const [o, s] of Object.entries(nameMap)) y = y.split(`${q(o)}!`).join(`${q(s)}!`);
  return y;
}

export function pickBook(args) {
  const name = args.find((a) => BOOKS[a]);
  if (!name) throw new Error(`대상: ${Object.keys(BOOKS).join(" | ")}`);
  const b = BOOKS[name];
  const test = args.includes("--test");
  if (test && !b.test) throw new Error(`${b.label}은 시험용 사본이 없다`);
  return { name, ...b, orig: test ? b.test.orig : b.orig, sales: test ? b.test.sales : b.sales, test };
}
