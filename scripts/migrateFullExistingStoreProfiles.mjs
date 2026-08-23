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
import { loadCollectionMap, needsWrite, makeWriteCounter } from "./lib/diffWrite.mjs";
import { toNumber, toPercentNumber, toBool, toText, toDateStr, isOpenDateSuspicious } from "./lib/sheetParsers.mjs";

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
  // 매번 재조회하지 않고 이번 실행에서 patch할 때마다 그 자리에서 같이 갱신해, 다음 단계
  // (specialDemandType 복제 등)의 비교도 추가 read 없이 메모리에서 하게 한다.
  const storeDataByCode = new Map(storesSnap.docs.map((d) => [d.id, d.data()]));
  console.log(`대상 매장: ${storeCodes.size}곳`);

  // ---- 01_점포기본정보: 나머지 원본 입력값을 merge로 채운다 ----
  // 값이 실제로 안 바뀌었으면 쓰지 않는다(Firestore 쓰기 할당량 절약, 2026-08-22).
  const stores01 = await readSheetAsObjects("01_점포기본정보", "A1:CQ1000");
  const profileCounter = makeWriteCounter();
  for (const s of stores01) {
    const code = toText(s["가맹점코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const patch = {
      address: toText(s["주소"]),
      hasElevator: toBool(s["엘리베이터"]),
      // 오픈 초기(학습표본 산정 시점) PC대수. 오픈 후 좌석을 늘린 매장은 이 값이 현재
      // PC대수(가맹점코드/매출DB 기준)와 다르다 - V61 학습/예측은 이 값을 우선 쓴다
      // (2026-08-22, 사용자 확인. 예: 시흥배곧점 168대(현재) vs 108대(평가기준)).
      evaluationPcCount: toNumber(s["평가기준_PC대수"]),
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
    const dirty = needsWrite(storeDataByCode.get(code), patch, { merge: true });
    profileCounter.mark(dirty);
    if (dirty) {
      await db.collection("storeEvalExistingStores").doc(code).set(patch, { merge: true });
      storeDataByCode.set(code, { ...storeDataByCode.get(code), ...patch });
    }
  }
  console.log(`01_점포기본정보 → storeEvalExistingStores 병합: ${profileCounter.summary()}`);

  // ---- 05_경쟁점정보: 기존 가맹점의 경쟁점 실사값을 storeEvalCompetitors로 ----
  // 값이 실제로 안 바뀌었으면 쓰지 않고, createdAt도 최초 등록 시점 값을 그대로 보존한다
  // (예전엔 안 바뀐 문서도 매번 통째로 덮어써서 createdAt이 실행할 때마다 "지금"으로
  // 리셋됐었다 — Firestore 쓰기 할당량 절약과 함께 이 부수 버그도 같이 고친다, 2026-08-22).
  const existingCompetitorMap = await loadCollectionMap(db, "storeEvalCompetitors");
  const comps05 = await readSheetAsObjects("05_경쟁점정보", "A1:AX2000");
  const compCounter = makeWriteCounter();
  // id를 "코드_이름_전역순번"으로 만들면(예전 방식) 시트 행이 추가/삭제돼 순번이 밀리는 순간
  // 재실행 시 기존 문서를 덮어쓰지 못하고 옛 값(핑봇 버그 이전 null 등)이 orphan으로 남는다
  // (2026-08-22 발견 — 실제로는 orphan이 아니라 N001~N003 후보지 문서였음을 확인했지만, 구조적
  // 위험 자체는 남아있어 예방 차원에서 고친다). "코드_이름"만으로 키를 만들어 매장 내 순서가
  // 바뀌어도 같은 경쟁점은 항상 같은 id로 덮어써지게 하고, 같은 매장에 동명 경쟁점이 있을 때만
  // 매장별 순번을 붙여 구분한다(전역 순번 아님).
  const seenKeyCount = new Map();
  for (const c of comps05) {
    const code = toText(c["가맹점코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const name = toText(c["경쟁점명"]);
    if (!name) continue;
    const baseKey = `${code}_${name}`;
    const seenCount = seenKeyCount.get(baseKey) ?? 0;
    seenKeyCount.set(baseKey, seenCount + 1);
    const id = seenCount === 0 ? baseKey : `${baseKey}_${seenCount}`;
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
      createdAt: existingCompetitorMap.get(id)?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const dirty = needsWrite(existingCompetitorMap.get(id), competitor, { merge: false, ignoreKeys: ["updatedAt"] });
    compCounter.mark(dirty);
    if (dirty) {
      await db.collection("storeEvalCompetitors").doc(id).set(competitor);
      existingCompetitorMap.set(id, competitor);
    }
  }
  console.log(`05_경쟁점정보 → storeEvalCompetitors: ${compCounter.summary()}`);

  // ---- 09_입지동선평가: 전체 필드 (브랜드/외부유입 외 나머지도) ----
  // 값이 실제로 안 바뀌었으면 쓰지 않는다(Firestore 쓰기 할당량 절약, 2026-08-22).
  const existingLocationMap = await loadCollectionMap(db, "storeEvalLocationEvaluations");
  const loc09 = await readSheetAsObjects("09_입지동선평가", "A1:P200");
  const locCounter = makeWriteCounter();
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
    const locDirty = needsWrite(existingLocationMap.get(code), doc, { merge: true });
    locCounter.mark(locDirty);
    if (locDirty) {
      await db.collection("storeEvalLocationEvaluations").doc(code).set(doc, { merge: true });
      existingLocationMap.set(code, { ...existingLocationMap.get(code), ...doc });
    }
    // V61 학습 4번째 피처(특수수요점수)에 쓰도록 storeEvalExistingStores에도 복제해 둔다
    // (calc.ts buildV61TrainingStores가 ExistingStore만 보고 순수함수로 남게 하기 위함).
    const specialDemandPatch = { specialDemandType: doc.specialDemandType, specialDemandIntensity: doc.specialDemandIntensity };
    if (needsWrite(storeDataByCode.get(code), specialDemandPatch, { merge: true })) {
      await db.collection("storeEvalExistingStores").doc(code).set({ ...specialDemandPatch, updatedAt: Date.now() }, { merge: true });
      storeDataByCode.set(code, { ...storeDataByCode.get(code), ...specialDemandPatch });
    }
  }
  console.log(`09_입지동선평가 → storeEvalLocationEvaluations (+ storeEvalExistingStores 특수수요 복제): ${locCounter.summary()}`);

  // ---- 03_회원정보입력: 스냅샷 그대로 누적 ----
  // 값이 실제로 안 바뀌었으면 쓰지 않는다(Firestore 쓰기 할당량 절약, 2026-08-22).
  const existingMemberMap = await loadCollectionMap(db, "storeEvalExistingStoreMembers");
  const members03 = await readSheetAsObjects("03_회원정보입력", "A1:T1000");
  const memberCounter = makeWriteCounter();
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
    const memberId = `${code}_${snapshotDate}`;
    const memberDirty = needsWrite(existingMemberMap.get(memberId), snapshot, { merge: false });
    memberCounter.mark(memberDirty);
    if (memberDirty) {
      await db.collection("storeEvalExistingStoreMembers").doc(memberId).set(snapshot);
      existingMemberMap.set(memberId, snapshot);
    }
  }
  console.log(`03_회원정보입력 → storeEvalExistingStoreMembers: ${memberCounter.summary()}`);

  console.log("\n전체 마이그레이션 완료");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("마이그레이션 실패:", e);
  process.exit(1);
});
