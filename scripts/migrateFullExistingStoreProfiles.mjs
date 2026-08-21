// 01_점포기본정보/05_경쟁점정보/09_입지동선평가/03_회원정보입력(구글시트) → Firestore 전체 마이그레이션.
//
// 무엇을 하는가:
//   storeEvalExistingStores에 이미 등록된 매장(현재 41곳)의 나머지 원본 입력값(VGA·존구성·
//   반경 인구·유동인구 등 01_점포기본정보 전체, 경쟁점 실사값 05_경쟁점정보, 입지동선평가 09
//   전체 필드, 회원 스냅샷 03_회원정보입력)을 통째로 Firestore로 옮긴다.
//
// 왜 필요한가:
//   지금까지는 V61 학습에 필요한 값(요금·예측자사수요·경쟁력점수·실제매출)만 옮겼다. 나머지
//   원본 입력값은 시트에만 있어서, 시트 탭을 정리(매출DB만 남기기)하면 그대로 사라진다. 이
//   스크립트로 전부 옮겨야 탭을 지워도 데이터가 안전하다.
//
// 실행: node scripts/migrateFullExistingStoreProfiles.mjs
// 반복 실행해도 안전(멱등, set으로 덮어씀).

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

function toNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}
// 시트에서 퍼센트 서식 셀(예: 핑봇_가동률, 실측착석률)은 Sheets API가 "14.1%" 같은 표시 문자열로
// 돌려준다. toNumber()는 "%"를 못 벗겨내서 전부 null이 됐었다(2026-08-21 발견) — %를 제거한 뒤
// 숫자로 파싱한다. 저장 관례(normalizePercentLike, calc.ts)에 맞춰 나눗셈 없이 원본 퍼센트
// 숫자 그대로 반환한다(예: "14.1%" → 14.1).
function toPercentNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[%,]/g, "").trim());
  return Number.isNaN(n) ? null : n;
}
function toBool(v) {
  const s = String(v ?? "").trim();
  return s === "유" || s === "Y" || s === "true";
}
function toText(v) {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}
function toDateStr(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s : parsed.toISOString().slice(0, 10);
}

// 가맹점코드 앞 8자리(YYYYMMDD)는 보통 오픈일과 가깝다(등록일-오픈일 차이는 보통 몇 주 이내).
// 훨씬 크게 벌어지면 시트 오픈일이 아직 정확히 입력 안 된 placeholder일 가능성이 높다
// (실사례: 문산점 - 여러 신규 매장에 동일한 임시 날짜가 들어가 있었음). 이런 경우 openedAt을
// 덮어쓰지 않는다 - 이미 Firestore에 사람이 확인해서 고쳐둔 값이 있을 수 있는데 시트의
// placeholder로 되돌리면 안 되기 때문이다. 시트 쪽 오픈일을 실제로 고치는 게 근본 해결책이다.
function isOpenDateSuspicious(code, sheetOpenedAt) {
  const m = code.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m || !sheetOpenedAt) return false;
  const derived = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  const sheet = new Date(sheetOpenedAt);
  if (Number.isNaN(derived.getTime()) || Number.isNaN(sheet.getTime())) return false;
  const diffDays = Math.abs((sheet.getTime() - derived.getTime()) / 86400000);
  return diffDays > 30;
}

async function readSheetAsObjects(sheetName, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${sheetName}'!${range}` });
  const values = res.data.values ?? [];
  const headers = values[0] ?? [];
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

async function main() {
  const storesSnap = await db.collection("storeEvalExistingStores").get();
  const storeCodes = new Set(storesSnap.docs.map((d) => d.id));
  console.log(`대상 매장: ${storeCodes.size}곳`);

  // ---- 01_점포기본정보: 나머지 원본 입력값을 merge로 채운다 ----
  const stores01 = await readSheetAsObjects("01_점포기본정보", "A1:CQ1000");
  let profileUpdated = 0;
  for (const s of stores01) {
    const code = toText(s["가맹점코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const patch = {
      address: toText(s["주소"]),
      hasElevator: toBool(s["엘리베이터"]),
      demographicsYear: toNumber(s["상권데이터기준연도"]),
      renovationYear: toNumber(s["자사_리뉴얼연도"]),
      ownVgaBase: toText(s["자사_VGA_기본"]),
      ownVgaTop: toText(s["자사_VGA_최고"]),
      ownGameZoneCount: toNumber(s["자사_게임존수"]),
      ownRoom1: toNumber(s["자사_1인룸"]),
      ownRoom2: toNumber(s["자사_2인룸"]),
      ownTeamRoom: toNumber(s["자사_팀룸"]),
      ownCoupleZone: toNumber(s["자사_커플존"]),
      ownVipZone: toNumber(s["자사_VIP존"]),
      ownFriendsZone: toNumber(s["자사_프렌즈존"]),
      ownFoodScore: toNumber(s["자사_먹거리평가"]),
      ownInteriorScore: toNumber(s["자사_인테리어평가"]),
      ownMonitorScore: toNumber(s["자사_모니터평가"]),
      pop500m: toNumber(s["반경500m_총인구"]),
      area1kmKm2: toNumber(s["반경1km_조회면적_km2"]),
      pop1km: toNumber(s["반경1km_총인구"]),
      male1kmRatio: (() => {
        const n = toNumber(s["반경1km_남성비율"]);
        return n == null ? null : n > 1 ? n / 100 : n;
      })(),
      age1km_0_9: toNumber(s["반경1km_0~9세"]),
      age1km_10_19: toNumber(s["반경1km_10~19세"]),
      age1km_20_29: toNumber(s["반경1km_20~29세"]),
      age1km_30_39: toNumber(s["반경1km_30~39세"]),
      age1km_40_49: toNumber(s["반경1km_40~49세"]),
      age1km_50_59: toNumber(s["반경1km_50~59세"]),
      age1km_60_69: toNumber(s["반경1km_60~69세"]),
      age1km_70_79: toNumber(s["반경1km_70~79세"]),
      age1km_80plus: toNumber(s["반경1km_80세이상"]),
      floating500Avg: toNumber(s["유동500_일평균"]),
      floating500Male: toNumber(s["유동500_남성"]),
      floating500Female: toNumber(s["유동500_여성"]),
      floating500_10s: toNumber(s["유동500_10대"]),
      floating500_20s: toNumber(s["유동500_20대"]),
      floating500_30s: toNumber(s["유동500_30대"]),
      floating500_40s: toNumber(s["유동500_40대"]),
      floating500_50s: toNumber(s["유동500_50대"]),
      floating500_60plus: toNumber(s["유동500_60대이상"]),
      licensedPcStores500m: toNumber(s["인허가_PC방업소수_500m"]),
      operatingPcStores500m: toNumber(s["실영업_PC방업소수_500m"]),
      updatedAt: Date.now(),
    };
    const sheetOpenedAt = toDateStr(s["오픈일"]);
    if (isOpenDateSuspicious(code, sheetOpenedAt)) {
      const m = code.match(/^(\d{4})(\d{2})(\d{2})/);
      console.warn(
        `  ⚠️  ${code} ${toText(s["가맹점명"])}: 시트 오픈일(${sheetOpenedAt})이 가맹점코드 날짜(${m[1]}-${m[2]}-${m[3]})와 30일 넘게 차이 — openedAt을 덮어쓰지 않았습니다. 시트에서 실제 오픈일을 확인해 고쳐주세요.`,
      );
    } else {
      patch.openedAt = sheetOpenedAt;
    }
    await db.collection("storeEvalExistingStores").doc(code).set(patch, { merge: true });
    profileUpdated++;
  }
  console.log(`01_점포기본정보 → storeEvalExistingStores 병합: ${profileUpdated}곳`);

  // ---- 05_경쟁점정보: 기존 가맹점의 경쟁점 실사값을 storeEvalCompetitors로 ----
  const comps05 = await readSheetAsObjects("05_경쟁점정보", "A1:AX2000");
  let compWritten = 0;
  for (const c of comps05) {
    const code = toText(c["가맹점코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const name = toText(c["경쟁점명"]);
    if (!name) continue;
    const id = `${code}_${name}_${compWritten}`; // 원본에 고유ID가 없어 코드+이름+순번으로 구성
    const competitor = {
      id,
      candidateCode: code,
      name,
      surveyLevel: toText(c["조사수준"]) || "상세",
      investigationStatus: "조사완료",
      address: toText(c["경쟁점주소"]),
      distanceM: toNumber(c["거리_m"]),
      floor: toNumber(c["점포층수"]),
      groundLevel: toText(c["지상/지하"]),
      totalPcCount: toNumber(c["전체대수"]),
      appliedPcCount: toNumber(c["적용대수"]) ?? toNumber(c["전체대수"]),
      hasElevator: toBool(c["엘리베이터"]),
      cpu: toText(c["CPU"]),
      vgaBase: toText(c["VGA_기본"]),
      vgaTop: toText(c["VGA_최고"]),
      ram: toText(c["RAM"]),
      monitor: toText(c["모니터"]),
      ratePer1000Won: toNumber(c["1000원당분"]),
      hourlyRateConverted: toNumber(c["시간당환산요금"]),
      paidDeduction: toText(c["유료차감"]),
      visitedAt: toText(c["방문일시"]),
      visitedDow: toText(c["방문요일"]),
      visitorCount: toNumber(c["이용객수"]),
      measuredSeatRate: toPercentNumber(c["실측착석률"]),
      pingbotUtilization: toPercentNumber(c["핑봇_가동률"]),
      pingbotPeriod: toText(c["핑봇_조회기간"]),
      renovationYear: toNumber(c["리뉴얼연도"]),
      foodScore: toNumber(c["먹거리평가"]),
      foodBasis: toText(c["먹거리근거"]),
      interiorScore: toNumber(c["인테리어평가"]),
      interiorBasis: toText(c["인테리어근거"]),
      monitorScore: toNumber(c["모니터평가"]),
      monitorBasis: toText(c["모니터근거"]),
      room1: toNumber(c["1인룸"]),
      room2: toNumber(c["2인룸"]),
      teamRoom: toNumber(c["팀룸"]),
      coupleZone: toNumber(c["커플존"]),
      premiumZone: toBool(c["프리미엄존"]) ? 1 : 0,
      premiumSpec: toText(c["프리미엄사양"]) != null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.collection("storeEvalCompetitors").doc(id).set(competitor);
    compWritten++;
  }
  console.log(`05_경쟁점정보 → storeEvalCompetitors: ${compWritten}건`);

  // ---- 09_입지동선평가: 전체 필드 (브랜드/외부유입 외 나머지도) ----
  const loc09 = await readSheetAsObjects("09_입지동선평가", "A1:P200");
  let locUpdated = 0;
  for (const l of loc09) {
    const code = toText(l["점포코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const doc = {
      candidateCode: code,
      name: toText(l["점포명"]),
      address: toText(l["주소"]) ?? "",
      locationScore: toNumber(l["상권내위치점수"]),
      flowScore: toNumber(l["주요동선점수"]),
      preemptionScore: toNumber(l["선점경쟁점수"]),
      visibilityScore: toNumber(l["접근가시성점수"]),
      mapMemo: toText(l["지도판단메모"]),
      attractionScore: toNumber(l["상권흡인력점수"]),
      specialDemandType: toText(l["특수수요유형"]),
      specialDemandIntensity: toText(l["특수수요강도"]),
      inflowRestriction: toText(l["외부유입제한"]),
      demandLeakageRisk: toText(l["수요이탈위험"]),
      marketStructureMemo: toText(l["상권구조메모"]),
      brandType: toText(l["브랜드구분"]),
      updatedAt: Date.now(),
      updatedBy: "migration-script",
    };
    await db.collection("storeEvalLocationEvaluations").doc(code).set(doc, { merge: true });
    // V61 학습 4번째 피처(특수수요점수)에 쓰도록 storeEvalExistingStores에도 복제해 둔다
    // (calc.ts buildV61TrainingStores가 ExistingStore만 보고 순수함수로 남게 하기 위함).
    await db.collection("storeEvalExistingStores").doc(code).set(
      { specialDemandType: doc.specialDemandType, specialDemandIntensity: doc.specialDemandIntensity, updatedAt: Date.now() },
      { merge: true },
    );
    locUpdated++;
  }
  console.log(`09_입지동선평가 → storeEvalLocationEvaluations (+ storeEvalExistingStores 특수수요 복제): ${locUpdated}곳`);

  // ---- 03_회원정보입력: 스냅샷 그대로 누적 ----
  const members03 = await readSheetAsObjects("03_회원정보입력", "A1:T1000");
  let memberWritten = 0;
  for (const m of members03) {
    const code = toText(m["가맹점코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const snapshotDate = toDateStr(m["회원자료기준일"]);
    if (!snapshotDate) continue;
    const snapshot = {
      storeCode: code,
      snapshotDate,
      totalMembersReported: toNumber(m["총회원수_집계"]),
      age7under_male: toNumber(m["7세이하_남"]),
      age7under_female: toNumber(m["7세이하_여"]),
      age8to13_male: toNumber(m["8~13세_남"]),
      age8to13_female: toNumber(m["8~13세_여"]),
      age14to19_male: toNumber(m["14~19세_남"]),
      age14to19_female: toNumber(m["14~19세_여"]),
      age20to30_male: toNumber(m["20~30세_남"]),
      age20to30_female: toNumber(m["20~30세_여"]),
      age31to45_male: toNumber(m["31~45세_남"]),
      age31to45_female: toNumber(m["31~45세_여"]),
      age46plus_male: toNumber(m["46세이상_남"]),
      age46plus_female: toNumber(m["46세이상_여"]),
      enteredBy: toText(m["입력자"]),
      memo: toText(m["메모"]),
      updatedAt: Date.now(),
    };
    await db.collection("storeEvalExistingStoreMembers").doc(`${code}_${snapshotDate}`).set(snapshot);
    memberWritten++;
  }
  console.log(`03_회원정보입력 → storeEvalExistingStoreMembers: ${memberWritten}건`);

  console.log("\n전체 마이그레이션 완료");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("마이그레이션 실패:", e);
  process.exit(1);
});
