// 매출DB(구글시트) → storeEvalExistingStores/storeEvalExistingStoreSales(Firestore) 동기화 스크립트.
//
// 무엇을 하는가:
//   1) 매출DB 기본열(A~N)에 있지만 storeEvalExistingStores에는 아직 없는 "정상" 상태 매장을
//      찾아 자동 등록한다(신규 가맹점이 매출DB에 매장정보를 입력하면, 이 스크립트를 다시
//      돌리는 것만으로 웹에도 매장이 새로 생긴다). 브랜드는 매출DB!지점명 배경색(노란색=
//      블랙라벨, 사용자 확인)으로 매번 다시 판정해 이미 등록된 매장까지 포함해 갱신한다.
//      요금·경쟁력점수 등 나머지 V61 학습 특징치는 매출DB에 없으므로 null로 두고,
//      migrateFullExistingStoreProfiles.mjs가 01_점포기본정보를 채운 뒤에야 학습 대상이 된다.
//   2) Google Sheet의 `매출DB` 탭(원본 매출 원장, 매달 6열씩 블록으로 늘어나는 구조)에서
//      storeEvalExistingStores에 등록된(위 1단계로 새로 등록된 매장 포함) 매장들의 월별 실적을
//      읽어 storeEvalExistingStoreSales에 upsert하고, 그 최신 상태로 각 매장의
//      completedMonths/actualMonthlyRevenueAvg를 다시 계산해 storeEvalExistingStores 문서도
//      함께 갱신한다(월초에 전달 매출을 매출DB에 기입 → 이 스크립트 재실행 → 웹에 자동 반영).
//
// 왜 매출DB를 직접 읽는가(02_월별성과DB를 안 쓰는 이유):
//   02_월별성과DB는 Apps Script 메뉴("점포평가 관리 → 전체 데이터 동기화")를 실행해야만
//   매출DB에서 다시 계산되는 파생 탭이다. 시트 탭 정리(매출DB만 남기기) 이후에도 계속 동작하려면
//   매출DB 원본 열 구조를 직접 파싱해야 한다. 파싱 규칙은 점포평가.gs의
//   detectMonthBlocks_/parseMonthHeader_/CONFIG(BASE_COLUMN_COUNT=14, MONTH_BLOCK_SIZE=6,
//   SOURCE_HEADER_ROW=2, SOURCE_DATA_START_ROW=3)를 그대로 따른다.
//
// 실행: node scripts/syncSalesFromRevenueSheet.mjs
// 반복 실행 안전함(멱등) — 이미 있는 월/매장도 값이 같으면 그대로 덮어쓸 뿐 중복이 생기지 않는다.
// 권장 순서: 매출DB에 신규 매장·월매출을 입력한 뒤 이 스크립트를 돌리고, 그다음
// migrateFullExistingStoreProfiles.mjs로 01/05/09/03 시트의 나머지 값을 채운다.

import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite, makeWriteCounter } from "./lib/diffWrite.mjs";

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

// 매출DB!J열(오픈일)은 "2015. 9. 4" 같은 점(.) 구분 표기다. 01_점포기본정보(toDateStr)와
// 다른 포맷이라 별도 파서가 필요하다.
function parseKoreanDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// 매출DB!지점명(B열) 배경색으로 블랙라벨 여부를 읽는다(사용자 확인: "노란색만 블랙라벨").
// 09_입지동선평가!브랜드구분과 대조해보니 노란색 41곳이 09시트의 블랙라벨 41곳과 정확히
// 일치했다 — 매출DB 쪽이 항상 존재하는(모든 매장이 매출DB엔 있음) 더 포괄적인 소스라 이걸
// 기준으로 삼는다. 노란색이 아니면 "확인필요"로 명확히 남긴다(다른 브랜드명을 단정하지 않음).
async function fetchBrandColorByCode() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`'${SOURCE_SHEET_NAME}'!A${SOURCE_DATA_START_ROW}:B2000`],
    fields: "sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)",
  });
  const rows = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const isBlackLabelByCode = new Map();
  for (const row of rows) {
    const cells = row.values ?? [];
    const code = cells[0]?.formattedValue?.trim();
    if (!code) continue;
    const bg = cells[1]?.effectiveFormat?.backgroundColor;
    const isYellow = !!bg && (bg.red ?? 0) >= 0.9 && (bg.green ?? 0) >= 0.9 && (bg.blue ?? 0) <= 0.2;
    isBlackLabelByCode.set(code, isYellow);
  }
  return isBlackLabelByCode;
}

// 신규 매장을 매출DB에서 자동으로 찾아 storeEvalExistingStores에 등록한다. 매출DB!E열
// (가맹해지여부)이 "정상"인 매장만 대상으로 한다 — 과거 폐업/가맹해지 매장까지 전부
// 끌어오면 학습·검증과 무관한 죽은 매장이 쌓이기 때문이다. brandType은 위 색상 판정을 쓰고,
// 그 외 요금·경쟁력점수 등 V61 학습 특징치는 매출DB에 없으므로 null로 남겨두고,
// migrateFullExistingStoreProfiles.mjs 재실행으로 채운다.
async function autoRegisterNewStores(storeCodes, openedAtByCode, isBlackLabelByCode) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SOURCE_SHEET_NAME}'!A1:N2000` });
  const values = res.data.values ?? [];
  let registered = 0;
  let skipped = 0;
  for (let r = SOURCE_DATA_START_ROW - 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row[0]) continue;
    const code = String(row[0]).trim();
    if (storeCodes.has(code)) continue;

    const franchiseStatusRaw = String(row[4] ?? "").trim();
    if (franchiseStatusRaw !== "정상") continue; // 신규 자동등록은 현재 정상 운영 매장만

    const storeName = String(row[1] ?? "").trim();
    const pcCount = toNumber(row[2]);
    const address = String(row[12] ?? "").trim() || null;
    const openedAt = parseKoreanDate(row[9]);
    if (!storeName || !openedAt) {
      console.log(`  ⚠️  ${code}: 매장명 또는 오픈일이 비어 있어 자동등록을 건너뜁니다 — 매출DB를 확인해주세요.`);
      skipped++;
      continue;
    }

    const now = Date.now();
    const doc = {
      storeCode: code,
      storeName,
      pcCount: pcCount ?? null,
      floor: null,
      groundLevel: null,
      openedAt,
      franchiseStatus: "정상",
      excludedFromModel: false,
      excludedReason: null,
      v61Predicted: null,
      referenceMarketDemand: null,
      brandType: isBlackLabelByCode.get(code) ? "블랙라벨" : "확인필요",
      validationUse: null,
      hourlyRate: null,
      ownDemand: null,
      competitivenessScore: null,
      actualMonthlyRevenueAvg: null,
      completedMonths: 0,
      specialDemandType: null,
      specialDemandIntensity: null,
      address,
      createdAt: now,
      updatedAt: now,
      updatedBy: "auto-sync-script",
    };
    await db.collection("storeEvalExistingStores").doc(code).set(doc, { merge: true });
    storeCodes.add(code);
    openedAtByCode.set(code, openedAt);
    registered++;
    console.log(`  ✅ 신규 매장 자동등록: ${code} ${storeName} (오픈일 ${openedAt}, PC ${pcCount ?? "?"}대)`);
  }
  console.log(`매출DB 기준 신규 매장 자동등록: ${registered}곳 (건너뜀 ${skipped}곳)`);
}

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
// PC대비상품비율/가동율 셀은 "30.85%" 같은 표시 문자열로 온다. toNumber()는 %를 못 벗겨내
// null이 돼버렸었다(2026-08-22 발견, cronSync.ts와 동일 버그) — %/,를 제거한 뒤 파싱한다.
function toPercentNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[%,]/g, "").trim());
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
  // 매번 재조회하지 않고 이번 실행에서 갱신할 때마다 그 자리에서 같이 갱신해, brandType/
  // completedMonths 비교를 추가 read 없이 메모리에서 바로 할 수 있게 한다.
  const storeDataByCode = new Map(storesSnap.docs.map((d) => [d.id, d.data()]));
  console.log(`기존 등록 매장: ${storeCodes.size}곳`);

  const isBlackLabelByCode = await fetchBrandColorByCode();

  // 1-1) 매출DB에서 아직 등록 안 된 신규 매장을 자동 등록 (storeCodes/openedAtByCode를 그
  //      자리에서 갱신하므로, 아래 매출 동기화 루프가 같은 실행에서 바로 반영한다)
  await autoRegisterNewStores(storeCodes, openedAtByCode, isBlackLabelByCode);

  // 1-2) 이미 등록된 매장도 매출DB 색상 기준으로 brandType을 매번 다시 맞춘다(멱등) —
  //      09_입지동선평가에 행이 없어 여태 브랜드를 확인할 방법이 없던 매장도 이걸로 채워진다.
  //      값이 실제로 안 바뀌었으면 쓰지 않는다(Firestore 쓰기 할당량 절약, 2026-08-22).
  const brandCounter = makeWriteCounter();
  for (const code of storeCodes) {
    if (!isBlackLabelByCode.has(code)) continue;
    const brandType = isBlackLabelByCode.get(code) ? "블랙라벨" : "확인필요";
    const dirty = needsWrite(storeDataByCode.get(code), { brandType }, { merge: true });
    brandCounter.mark(dirty);
    if (!dirty) continue;
    await db.collection("storeEvalExistingStores").doc(code).set({ brandType, updatedAt: Date.now() }, { merge: true });
    storeDataByCode.set(code, { ...storeDataByCode.get(code), brandType });
  }
  console.log(`매출DB 색상 기준 brandType 갱신: ${brandCounter.summary()}`);

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

  // 매출DB 6000여 건을 매번 통째로 다시 쓰지 않도록, 기존 값을 한 번에 읽어 메모리에서 비교한다
  // (2026-08-22, Firestore 쓰기 할당량 초과 반복 발생 후 도입).
  const existingSalesMap = await loadCollectionMap(db, "storeEvalExistingStoreSales");
  const salesCounter = makeWriteCounter();
  const storesCounter = makeWriteCounter();

  for (let r = SOURCE_DATA_START_ROW - 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row[0]) continue;
    const code = String(row[0]).trim();
    if (!storeCodes.has(code)) continue; // 아직 웹에 등록 안 된 매장은 건너뛴다

    const monthlyForThisStore = [];
    for (const block of monthBlocks) {
      const pcSales = toNumber(row[block.startCol + 1]);
      const productSales = toNumber(row[block.startCol + 2]);
      const utilizationRate = toPercentNumber(row[block.startCol + 4]);
      const salesPerPcPerDay = toNumber(row[block.startCol + 5]);
      const productRatio = toPercentNumber(row[block.startCol + 3]);
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
      const salesId = `${code}_${yearMonth}`;
      const dirty = needsWrite(existingSalesMap.get(salesId), salesDoc, { merge: false, ignoreKeys: [] });
      salesCounter.mark(dirty);
      if (dirty) {
        await db.collection("storeEvalExistingStoreSales").doc(salesId).set(salesDoc);
        existingSalesMap.set(salesId, salesDoc);
      }
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

    const dirty = needsWrite(storeDataByCode.get(code), { completedMonths, actualMonthlyRevenueAvg }, { merge: true });
    storesCounter.mark(dirty);
    if (dirty) {
      await db.collection("storeEvalExistingStores").doc(code).set(
        { completedMonths, actualMonthlyRevenueAvg, updatedAt: Date.now() },
        { merge: true },
      );
    }
  }

  console.log(`\nstoreEvalExistingStoreSales: ${salesCounter.summary()}`);
  console.log(`storeEvalExistingStores 재계산 갱신: ${storesCounter.summary()}`);
  console.log("완료");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("동기화 실패:", e);
  process.exit(1);
});
