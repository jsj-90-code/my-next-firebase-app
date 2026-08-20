// 매출DB(구글시트) → storeEvalExistingStoreSales(Firestore) 동기화 스크립트.
//
// 무엇을 하는가:
//   Google Sheet의 `매출DB` 탭(원본 매출 원장, 매달 6열씩 블록으로 늘어나는 구조)에서 이미
//   storeEvalExistingStores에 등록된 매장들의 월별 실적을 읽어 storeEvalExistingStoreSales에
//   upsert하고, 그 최신 상태로 각 매장의 completedMonths/actualMonthlyRevenueAvg를 다시 계산해
//   storeEvalExistingStores 문서도 함께 갱신한다.
//
// 왜 매출DB를 직접 읽는가(02_월별성과DB를 안 쓰는 이유):
//   02_월별성과DB는 Apps Script 메뉴("점포평가 관리 → 전체 데이터 동기화")를 실행해야만
//   매출DB에서 다시 계산되는 파생 탭이다. 시트 탭 정리(매출DB만 남기기) 이후에도 계속 동작하려면
//   매출DB 원본 열 구조를 직접 파싱해야 한다. 파싱 규칙은 점포평가.gs의
//   detectMonthBlocks_/parseMonthHeader_/CONFIG(BASE_COLUMN_COUNT=14, MONTH_BLOCK_SIZE=6,
//   SOURCE_HEADER_ROW=2, SOURCE_DATA_START_ROW=3)를 그대로 따른다.
//
// 실행: node scripts/syncSalesFromRevenueSheet.mjs
// 반복 실행 안전함(멱등) — 이미 있는 월도 값이 같으면 그대로 덮어쓸 뿐 중복이 생기지 않는다.

import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

const SPREADSHEET_ID = process.env.STORE_EVAL_SPREADSHEET_ID || "1Q5yCOL5IT_pT8lYKvtzhzPK3ihC0otVifQBNPi0SjRA";
const SOURCE_SHEET_NAME = "매출DB";
const SOURCE_HEADER_ROW = 2; // 1-based
const SOURCE_DATA_START_ROW = 3; // 1-based
const BASE_COLUMN_COUNT = 14; // 0-based 열 개수(A~N)
const MONTH_BLOCK_SIZE = 6; // [월라벨, PC매출, 상품매출, PC대비상품비율, 가동율, 대당일매출]

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가 .env.local에 필요합니다.");
  process.exit(1);
}

const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(adminApp);

const sheetsAuth = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth: sheetsAuth });

function parseMonthHeader(text) {
  const cleaned = String(text ?? "").trim().replace(/\s/g, "");
  const m = cleaned.match(/^(\d{2,4})년(\d{1,2})월$/);
  if (!m) return null;
  let year = Number(m[1]);
  if (year < 100) year += 2000;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

// src/lib/storeEval/calc.ts의 computeStabilizedPerformance와 반드시 같은 규칙을 써야 한다
// (원본 점포평가.gs: EVAL_MONTHS=12, CUMUL_FROM=2 — 오픈 1~12개월만 평가창, 2개월차부터 평균,
// 단 2개월차 데이터가 없으면 1개월차라도 쓴다). 스크립트는 TS를 직접 import할 수 없어 그대로
// 복제한다 — calc.ts 쪽을 고치면 이 블록도 반드시 같이 고쳐야 한다.
const EVAL_WINDOW_MONTHS = 12;
const CUMULATIVE_AVERAGE_FROM_MONTH = 2;
function computeStabilizedPerformance(monthlySales) {
  const inWindow = monthlySales.filter((m) => m.elapsedMonths >= 1 && m.elapsedMonths <= EVAL_WINDOW_MONTHS);
  const completedMonths = inWindow.filter((m) => (m.pcSales ?? 0) + (m.productSales ?? 0) > 0).length;
  const avgOf = (list) => {
    const totals = list.map((m) => (m.pcSales ?? 0) + (m.productSales ?? 0)).filter((v) => v > 0);
    return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  };
  const fromMonth2 = inWindow.filter((m) => m.elapsedMonths >= CUMULATIVE_AVERAGE_FROM_MONTH);
  const avg = avgOf(fromMonth2) ?? avgOf(inWindow);
  return { completedMonths, actualMonthlyRevenueAvg: avg };
}

const now = new Date();
const CURRENT_YEAR_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

function monthsBetween(openedAt, year, month) {
  if (!openedAt) return null;
  const open = new Date(openedAt);
  if (Number.isNaN(open.getTime())) return null;
  return (year - open.getFullYear()) * 12 + (month - 1 - open.getMonth());
}

async function main() {
  // 1) 이미 등록된 매장 코드 목록 (등록 안 된 매장은 이 스크립트 대상이 아니다 - 신규 매장은
  //    convertCandidateToExistingStore로 먼저 등록해야 한다)
  const storesSnap = await db.collection("storeEvalExistingStores").get();
  const storeCodes = new Set(storesSnap.docs.map((d) => d.id));
  const openedAtByCode = new Map(storesSnap.docs.map((d) => [d.id, d.data().openedAt]));
  console.log(`대상 매장(storeEvalExistingStores에 이미 등록된 매장): ${storeCodes.size}곳`);

  // 2) 매출DB 전체 값 읽기
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SOURCE_SHEET_NAME}'!A1:ZZ2000` });
  const values = res.data.values ?? [];
  if (values.length < SOURCE_DATA_START_ROW) {
    console.error("매출DB에 데이터 행이 없습니다.");
    process.exit(1);
  }

  const headerRow = values[SOURCE_HEADER_ROW - 1] ?? [];
  const monthBlocks = [];
  for (let c = BASE_COLUMN_COUNT; c < headerRow.length; c += MONTH_BLOCK_SIZE) {
    const month = parseMonthHeader(headerRow[c]);
    if (month) monthBlocks.push({ startCol: c, year: month.year, month: month.month });
  }
  console.log(`매출DB에서 발견한 월별 블록 수: ${monthBlocks.length} (최초 ${monthBlocks[0]?.year}-${monthBlocks[0]?.month}, 최신 ${monthBlocks.at(-1)?.year}-${monthBlocks.at(-1)?.month})`);

  let salesWritten = 0;
  let storesUpdated = 0;

  for (let r = SOURCE_DATA_START_ROW - 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row[0]) continue;
    const code = String(row[0]).trim();
    if (!storeCodes.has(code)) continue; // 아직 웹에 등록 안 된 매장은 건너뛴다

    const monthlyForThisStore = [];
    for (const block of monthBlocks) {
      const pcSales = toNumber(row[block.startCol + 1]);
      const productSales = toNumber(row[block.startCol + 2]);
      const utilizationRate = toNumber(row[block.startCol + 4]);
      const salesPerPcPerDay = toNumber(row[block.startCol + 5]);
      const productRatio = toNumber(row[block.startCol + 3]);
      const hasAny = pcSales != null || productSales != null;
      if (!hasAny) continue;

      const yearMonth = `${block.year}-${String(block.month).padStart(2, "0")}`;
      const salesDoc = {
        storeCode: code,
        yearMonth,
        pcSales: pcSales ?? null,
        productSales: productSales ?? null,
        productRatio: productRatio != null ? (productRatio > 1 ? productRatio / 100 : productRatio) : null,
        utilizationRate: utilizationRate != null ? (utilizationRate > 1 ? utilizationRate / 100 : utilizationRate) : null,
        salesPerPcPerDay: salesPerPcPerDay ?? null,
      };
      await db.collection("storeEvalExistingStoreSales").doc(`${code}_${yearMonth}`).set(salesDoc);
      salesWritten++;
      monthlyForThisStore.push(salesDoc);
    }

    if (monthlyForThisStore.length === 0) continue;

    // completedMonths/actualMonthlyRevenueAvg 재계산 — calc.ts computeStabilizedPerformance와
    // 동일하게 오픈 1~12개월 평가창만 쓴다(매출DB는 오픈 후 수년치가 계속 쌓이므로, 창을 안
    // 씌우면 "누적평균매출"이 평생평균이 되어 신규 후보지 예측과 비교할 수 없는 값이 된다).
    // 진행 중인 이번 달(아직 안 끝난 달)은 시트에 값이 미리 들어가 있어도 "완료월"로 세지
    // 않는다 — 이번 달 수치는 아직 확정된 실적이 아니라서 비교 대상이 아니다.
    const openedAt = openedAtByCode.get(code);
    const withElapsed = monthlyForThisStore
      .filter((m) => m.yearMonth !== CURRENT_YEAR_MONTH)
      .map((m) => {
        const [y, mo] = m.yearMonth.split("-").map(Number);
        const elapsedMonths = monthsBetween(openedAt, y, mo);
        return elapsedMonths == null ? null : { elapsedMonths, pcSales: m.pcSales, productSales: m.productSales };
      })
      .filter((m) => m != null);

    if (withElapsed.length === 0) {
      console.log(`  ${code}: 오픈일이 없어 평가창을 못 씌움 — completedMonths/actualMonthlyRevenueAvg 갱신 건너뜀`);
      continue;
    }
    const { completedMonths, actualMonthlyRevenueAvg } = computeStabilizedPerformance(withElapsed);

    await db.collection("storeEvalExistingStores").doc(code).set(
      { completedMonths, actualMonthlyRevenueAvg, updatedAt: Date.now() },
      { merge: true },
    );
    storesUpdated++;
  }

  console.log(`\nstoreEvalExistingStoreSales: ${salesWritten}건 upsert`);
  console.log(`storeEvalExistingStores 재계산 갱신: ${storesUpdated}곳`);
  console.log("완료");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("동기화 실패:", e);
  process.exit(1);
});
