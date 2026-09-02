// 점포평가 시스템 — Google Sheet → Firestore 자동 동기화 (Vercel Cron에서 호출).
//
// scripts/migrateFullExistingStoreProfiles.mjs / scripts/syncSalesFromRevenueSheet.mjs와
// 하는 일은 같지만, 서버리스 함수 실행시간 제한(기본 300초) 안에 끝나도록 문서 하나씩
// await하던 방식을 Firestore 배치쓰기(최대 450건씩 묶어 커밋)로 바꿨다. 그 외 판정 로직은
// 스크립트와 완전히 동일하며, 실제매출 평가창 계산은 calc.ts의 computeStabilizedPerformance를
// 그대로 import해서 쓴다(스크립트는 .ts를 못 불러와 어쩔 수 없이 복제했지만, 여기선 그럴 필요가
// 없다 — 단일 출처 원칙).
//
// 로컬에서 손으로 돌리는 scripts/*.mjs는 그대로 남겨둔다(수동 백필·디버깅용). 이 파일은 Cron
// 자동 실행 전용 경로다.

import { google } from "googleapis";
import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { computeCompetitorAvgCompetitiveness, computeCompetitivenessGap, computeExistingStoreDemandEvaluation, computeStabilizedPerformance } from "./calc";
import { defaultModelSettings } from "./settings";
import type { Competitor, ExistingStore, LocationEvaluation, ModelSettings } from "./types";
// scripts/migrateFullExistingStoreProfiles.mjs, scripts/syncSalesFromRevenueSheet.mjs와 셀 파싱/
// dirty-check 로직을 하나로 합친다(tsconfig allowJs) — 예전엔 세 곳에 거의 동일하게 복붙돼 있어서
// 핑봇_가동률 퍼센트 파싱 버그가 한쪽만 고쳐지고 이 파일엔 남아있던 사고가 있었다(2026-08-22,
// docs/data-issues.md). 단일 출처로 합쳐 같은 드리프트가 재발하지 않게 한다(2026-08-24).
import { needsWrite } from "../../../scripts/lib/diffWrite.mjs";
import { toNumber, toPercentNumber, toBool, toText, toDateStr, parseKoreanDate, isOpenDateSuspicious } from "../../../scripts/lib/sheetParsers.mjs";

const SPREADSHEET_ID = process.env.STORE_EVAL_SPREADSHEET_ID || "1Q5yCOL5IT_pT8lYKvtzhzPK3ihC0otVifQBNPi0SjRA";
const BATCH_LIMIT = 450; // Firestore 배치 한도(500)에서 여유를 둔 값

function getSheetsClient() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;
  const auth = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  return google.sheets({ version: "v4", auth });
}

/**
 * 매출DB!지점명(B열) 배경색으로 블랙라벨 여부를 읽는다(사용자 확인: "노란색만 블랙라벨").
 * 09_입지동선평가!브랜드구분과 대조해보니 노란색 41곳이 09시트의 블랙라벨 41곳과 정확히
 * 일치했다 — 매출DB 쪽이 항상 존재하는(모든 매장이 매출DB엔 있음) 더 포괄적인 소스라
 * 이걸 기준으로 삼는다. 노란색이 아니면 "확인필요"로 명확히 남긴다("리그PC방"이라고
 * 단정하지 않음 — 색만으로는 정확한 다른 브랜드명까지는 알 수 없다).
 */
async function fetchBrandColorByCode(sheets: NonNullable<ReturnType<typeof getSheetsClient>>): Promise<Map<string, boolean>> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`'${SOURCE_SHEET_NAME}'!A${SOURCE_DATA_START_ROW}:B2000`],
    fields: "sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)",
  });
  const rows = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const isBlackLabelByCode = new Map<string, boolean>();
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

/** 문서를 하나씩 await하지 않고 최대 450건씩 묶어 커밋한다 - 수천 건도 몇 초 안에 끝난다. */
class BatchWriter {
  private batch = this.db.batch();
  private count = 0;

  constructor(private db: Firestore) {}

  set(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>, merge = false) {
    if (merge) this.batch.set(ref, data, { merge: true });
    else this.batch.set(ref, data);
    this.count++;
    if (this.count >= BATCH_LIMIT) return this.flush();
    return Promise.resolve();
  }

  private async flush() {
    if (this.count === 0) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.count = 0;
  }

  async finish() {
    await this.flush();
  }
}

/**
 * patch의 값이 현재 Firestore 문서와 완전히 같으면 true.
 * updatedAt류 메타 필드는 항상 바뀌므로 비교에서 제외한다 - 실제 내용이 안 바뀌었는데도
 * 매일 다시 쓰는 것을 막아야 Firestore 무료 쓰기 할당량(하루 20,000건)을 넘기지 않는다.
 * scripts/*.mjs가 쓰는 diffWrite.mjs의 needsWrite(merge:true)를 그대로 위임한다(2026-08-24) —
 * 두 구현이 따로 있으면 한쪽만 고쳐지는 드리프트가 재발한다.
 */
function isSameData(current: Record<string, unknown> | undefined, patch: Record<string, unknown>): boolean {
  return !needsWrite(current, patch, { merge: true });
}

async function readSheetAsObjects(
  sheets: ReturnType<typeof getSheetsClient>,
  sheetName: string,
  range: string,
): Promise<Record<string, string>[]> {
  const res = await sheets!.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${sheetName}'!${range}` });
  const values = res.data.values ?? [];
  const headers = (values[0] ?? []) as string[];
  return values.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

export type ProfileMigrationSummary = {
  targetStoreCount: number;
  profileUpdated: number;
  competitorsWritten: number;
  competitivenessRecalculated: number;
  suspiciousOpenDates: string[];
};

/** 01/05/09 시트 → Firestore 전체 마이그레이션 (scripts/migrateFullExistingStoreProfiles.mjs와 동일 로직). */
export async function runFullProfileMigration(): Promise<ProfileMigrationSummary> {
  if (!adminDb) throw new Error("Firebase Admin이 초기화되지 않았습니다(FIREBASE_CLIENT_EMAIL/PRIVATE_KEY 확인).");
  const sheets = getSheetsClient();
  if (!sheets) throw new Error("Google Sheets 인증 정보가 없습니다.");
  const db = adminDb;
  const writer = new BatchWriter(db);
  const suspiciousOpenDates: string[] = [];

  // 2026-08-31 — "03_회원정보입력 → storeEvalExistingStoreMembers" 동기화 섹션을 완전히 제거했다
  // (사용자 확인: 이 컬렉션을 다시 읽는 화면이 앱 어디에도 없어 Firestore 다이어트 대상으로 전부
  // 삭제했는데, 이 동기화가 남아있으면 다음 실행 때 그대로 되살아나 삭제가 무의미해진다).
  // 셋 다 서로 의존하지 않는 읽기라 순차 await 대신 병렬로 실행한다(2026-08-24, Cron 함수
  // 실행시간 제한 안에서 여유를 늘림). 값이 안 바뀐 문서는 다시 쓰지 않기 위해 기존 경쟁점
  // 데이터도 미리 읽어둔다.
  const [storesSnap, competitorsSnap, settingsSnap, locationEvalsSnap] = await Promise.all([
    db.collection("storeEvalExistingStores").get(),
    db.collection("storeEvalCompetitors").get(),
    db.collection("storeEvalSettings").doc("current").get(),
    // 2026-08-30(경쟁력 평가 기준 최종본 §12) — 자사 "입지10%" 컴포넌트가 09_입지동선평가(4요소
    // 조합)를 쓰도록 바뀌면서, 아래 경쟁력점수 재계산 루프가 매장별 LocationEvaluation도 필요해졌다.
    // 이 컬렉션은 09_입지동선평가 시트 동기화가 끊긴 뒤로 웹(AI 평가 화면)에서만 쓰이므로, 시트를
    // 다시 읽지 않고 Firestore 컬렉션을 통째로 한 번 읽어 맵으로 만든다(매장 133곳 순회 전 1회 조회).
    db.collection("storeEvalLocationEvaluations").get(),
  ]);
  const storeCodes = new Set(storesSnap.docs.map((d) => d.id));
  const storeDataByCode = new Map(storesSnap.docs.map((d) => [d.id, d.data()]));
  const existingCompByid = new Map(competitorsSnap.docs.map((d) => [d.id, d.data()]));
  const locationEvalByCandidateCode = new Map(locationEvalsSnap.docs.map((d) => [d.id, d.data() as LocationEvaluation]));
  const settings: ModelSettings = settingsSnap.exists
    ? { ...defaultModelSettings(), ...(settingsSnap.data() as ModelSettings) }
    : { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };
  // 경쟁력점수/자사수요 재계산(아래)에 쓸, 매장별 "현재 유효한" 경쟁점 목록 — 05 루프를 도는
  // 동안 시트값+기존 문서(웹 전용 필드 보존)를 합쳐서 채운다.
  const competitorsByStoreCode = new Map<string, Competitor[]>();

  // ---- 01_점포기본정보 ----
  const stores01 = await readSheetAsObjects(sheets, "01_점포기본정보", "A1:CQ1000");
  let profileUpdated = 0;
  for (const s of stores01) {
    const code = toText(s["가맹점코드"]);
    if (!code || !storeCodes.has(code)) continue;
    const patch: Record<string, unknown> = {
      address: toText(s["주소"]),
      hasElevator: toBool(s["엘리베이터"]),
      // 오픈 후 좌석을 늘린 매장은 이 값(오픈 초기 대수)으로 V61 학습/예측을 해야 한다
      // (2026-08-22, migrateFullExistingStoreProfiles.mjs와 동일 필드 — 자동 동기화도
      // 시트가 나중에 갱신되면 따라가도록 여기에도 추가).
      evaluationPcCount: toNumber(s["평가기준_PC대수"]),
      demographicsYear: toNumber(s["상권데이터기준연도"]),
      renovationYear: toNumber(s["자사_리뉴얼연도"]),
      // 2026-08-28 (2차) — 실제 시트 컬럼이 기본/특화1/특화2(GPU·CPU)·기본/특화(RAM·모니터)로
      // 세분화됨(사용자 확정). 일부 좌석만 업그레이드된 경우를 반영하기 위해 calc.ts
      // combineHardwareTiers(기본80%+특화균등분배20%)로 결합한다. 모니터는 더 이상 숫자 평가가
      // 아니라 텍스트(주사율 Hz)에서 자동채점한다(scoreFromMonitor).
      ownVgaBase: toText(s["자사_VGA_기본"]),
      ownVgaTop: toText(s["자사_VGA_특화1"]),
      ownVgaTop2: toText(s["자사_VGA_특화2"]),
      ownCpu: toText(s["자사_CPU_기본"]),
      ownCpuTop1: toText(s["자사_CPU_특화1"]),
      ownCpuTop2: toText(s["자사_CPU_특화2"]),
      ownRam: toText(s["자사_RAM_기본"]),
      ownRamTop: toText(s["자사_RAM_특화"]),
      ownMonitorBase: toText(s["자사_모니터_기본"]),
      ownMonitorTop: toText(s["자사_모니터_특화"]),
      // 2026-08-30 — 자사_게임존수(하드웨어 가산점 컬럼) 삭제(사용자 확정). 게임존은 인테리어
      // 특화가 아니라 하드웨어 특화 좌석인데, 하드웨어는 특화1/특화2 컬럼으로 이미 별도 평가되므로
      // 가산은 이중 반영이었다(프리미엄존 가산 폐지와 같은 이유, calc.ts computeSpecScore 참고).
      // 2026-08-28 (3차) — "자사_1인석"(개방형 좌석) 컬럼 신설, 기존 "자사_1인룸"(독립 공간)과 분리.
      ownSingleSeatCount: toNumber(s["자사_1인석"]),
      ownRoom1: toNumber(s["자사_1인룸"]),
      ownRoom2: toNumber(s["자사_2인룸"]),
      ownTeamRoom: toNumber(s["자사_팀룸"]),
      ownCoupleZone: toNumber(s["자사_커플존"]),
      ownVipZone: toNumber(s["자사_VIP존"]),
      ownFriendsZone: toNumber(s["자사_프렌즈존"]),
      // 2026-08-30 추가 — 팀룸형 고급 컨셉존(파우더룸 포함, 방당 약 10좌석). 자동 산식엔 안 쓰고
      // 평가자가 인테리어평가 매길 때 참고하는 사실 기록용(사용자 확인).
      ownFirstClassZone: toNumber(s["자사_퍼스트클래스존"]),
      // 2026-08-31(시설 평가 산식 개편) — 팀룸 "개수"와 별개로 "총좌석수" 직접입력을 읽는다(01시트
      // BY/BZ, 신설 컬럼, migrateFullExistingStoreProfiles.mjs와 동일).
      ownTeamRoomTotalSeats: toNumber(s["자사_팀룸좌석수"]),
      ownTeamRoomTotalSeatsBasis: toText(s["자사_팀룸좌석근거"]),
      ownFoodScore: toNumber(s["자사_먹거리평가"]),
      ownInteriorScore: toNumber(s["자사_인테리어평가"]),
      // 2026-09-01 버그 수정 — "관리점수는 시트 수식상 자사는 항상 상수 4라 읽어올 값이 없다"는
      // 옛 전제가 더 이상 맞지 않는다. 01시트에 "자사_매장관리점수" 컬럼이 실제로 생겼으므로
      // 읽어와야 한다(applyStandardOwnFacilityDefaults가 이 값이 있으면 우선 쓰고, 없을 때만
      // 표준값 4로 폴백하도록 이미 짜여 있었는데 정작 이 필드를 아무도 채워준 적이 없었다).
      ownManagementScore: toNumber(s["자사_매장관리점수"]),
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
      floating500_10s: toNumber(s["유동500_10대"]),
      floating500_20s: toNumber(s["유동500_20대"]),
      floating500_30s: toNumber(s["유동500_30대"]),
      floating500_40s: toNumber(s["유동500_40대"]),
      floating500_50s: toNumber(s["유동500_50대"]),
      floating500_60plus: toNumber(s["유동500_60대이상"]),
      operatingPcStores500m: toNumber(s["실영업_PC방업소수_500m"]),
      updatedAt: Date.now(),
    };
    const sheetOpenedAt = toDateStr(s["오픈일"]);
    if (isOpenDateSuspicious(code, sheetOpenedAt)) {
      suspiciousOpenDates.push(`${code} ${toText(s["가맹점명"]) ?? ""}`);
    } else {
      patch.openedAt = sheetOpenedAt;
    }
    if (!isSameData(storeDataByCode.get(code), patch)) {
      await writer.set(db.collection("storeEvalExistingStores").doc(code), patch, true);
      profileUpdated++;
    }
  }

  // ---- 05_경쟁점정보 ----
  const comps05 = await readSheetAsObjects(sheets, "05_경쟁점정보", "A1:AX2000");
  let compWritten = 0;
  // id를 "코드_이름_전역순번"으로 만들면(예전 방식) 시트 행이 추가/삭제되거나 다른 경쟁점이
  // 먼저 스킵되는 순간 재실행 시 기존 문서를 덮어쓰지 못하고 옛 값이 orphan으로 남는다
  // (migrateFullExistingStoreProfiles.mjs와 동일 이유로 2026-08-22 수정 - 이 파일이 그 스크립트와
  // "완전히 동일"해야 한다는 파일 상단 주석과 어긋나 있던 걸 바로잡음). "코드_이름"만으로 키를
  // 만들어 매장 내 순서가 바뀌어도 같은 경쟁점은 항상 같은 id로 덮어써지게 하고, 같은 매장에
  // 동명 경쟁점이 있을 때만 매장별 순번을 붙여 구분한다(전역 순번 아님).
  const seenKeyCount = new Map<string, number>();
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
      // 2026-08-28 (3차) — 05_경쟁점정보도 01_점포기본정보와 같은 기본/특화1/특화2(GPU·CPU)·
      // 기본/특화(RAM·모니터) 구조로 늘렸다(사용자 확정).
      // 2026-08-28 (4차) — 실제 시트 헤더를 읽어보니 "CPU_기본"이 아니라 "CPU 기본"(밑줄 아님,
      // 공백)이었다(추측으로 밑줄을 썼다가 실측 데이터로 확인·수정 — 이 오타 때문에 매번 동기화가
      // 돌 때마다 사양 칸이 전부 공란으로 덮어써지고 있었다, 사용자 발견).
      cpu: toText(c["CPU 기본"]),
      cpuTop1: toText(c["CPU 특화1"]),
      cpuTop2: toText(c["CPU 특화2"]),
      vgaBase: toText(c["VGA 기본"]),
      vgaTop: toText(c["VGA 특화1"]),
      vgaTop2: toText(c["VGA 특화2"]),
      ram: toText(c["RAM 기본"]),
      ramTop: toText(c["RAM 특화"]),
      monitorBase: toText(c["모니터 기본"]),
      monitorTop: toText(c["모니터 특화"]),
      ratePer1000Won: toNumber(c["1000원당분"]),
      hourlyRateConverted: toNumber(c["시간당환산요금"]),
      paidDeduction: toText(c["유료차감"]),
      // 2026-08-30 — 방문일시/방문요일/이용객수/실측착석률은 05_경쟁점정보에서 컬럼 자체를
      // 삭제했다(예측 계산에 안 쓰임, 사용자 확인 — types.ts Competitor 주석 참고). 더 이상
      // 여기서 읽지 않는다 — 안 읽어야 웹에서 수동입력한 값이 매 동기화마다 null로 안 덮어써진다.
      pingbotUtilization: toPercentNumber(c["핑봇_가동률"]),
      pingbotPeriod: toText(c["핑봇_조회기간"]),
      // 2026-08-30 — 경쟁점 리뉴얼연도 컬럼도 시트에서 삭제(인테리어평가로 대체, 사용자 확인).
      foodScore: toNumber(c["먹거리평가"]),
      foodBasis: toText(c["먹거리근거"]),
      interiorScore: toNumber(c["인테리어평가"]),
      interiorBasis: toText(c["인테리어근거"]),
      // 2026-08-31(시설 평가 산식 개편) — 관리점수가 더 이상 인테리어에서 파생되지 않는 완전
      // 독립값이 됐다(189곳 재검토, 사용자 확정, migrateFullExistingStoreProfiles.mjs와 동일).
      // VIP존/프렌즈존/퍼스트클래스존은 이번에 시트에 컬럼이 새로 생겨(AP/AQ/AR) 동기화 대상으로
      // 승격(예전엔 웹 전용 입력이었음).
      // 2026-09-01 버그 수정 — 실제 시트 헤더는 "매장관리점수"가 아니라 "경쟁점_매장관리점수"였다
      // (컬럼명 불일치로 상세조사 경쟁점 142곳 전부 이 값이 null 처리되고 있었음, 사용자 확인 후 발견).
      managementScore: toNumber(c["경쟁점_매장관리점수"]),
      singleSeatCount: toNumber(c["1인석"]),
      room1: toNumber(c["1인룸"]),
      room2: toNumber(c["2인룸"]),
      teamRoom: toNumber(c["팀룸"]),
      coupleZone: toNumber(c["커플존"]),
      vipZone: toNumber(c["VIP존"]),
      friendsZone: toNumber(c["프렌즈존"]),
      firstClassZone: toNumber(c["퍼스트클래스존"]),
      // 2026-08-31 신설 — 일반2인석(전용 커플존과 별개, '조' 단위)과 팀룸 총좌석수(개수와 분리).
      regularCoupleSeatCount: toNumber(c["일반2인석"]),
      teamRoomTotalSeats: toNumber(c["팀룸좌석수"]),
      teamRoomTotalSeatsBasis: toText(c["팀룸좌석근거"]),
      createdAt: (existingCompByid.get(id)?.createdAt as number | undefined) ?? Date.now(),
      updatedAt: Date.now(),
    };
    if (!isSameData(existingCompByid.get(id), competitor)) {
      // 2026-08-28 — merge:true로 변경. 예전엔 전체 덮어쓰기라 매일 이 동기화가 돌 때마다
      // foodBrand/interiorLevelScore/seatZoneScore/comfortScore/source/lat/lng처럼 시트에 없고
      // 웹에서만 입력하는 필드가 조용히 지워지는 위험이 있었다(발견된 버그, 이번에 같이 수정).
      // 시트 원본 필드(위 competitor 객체가 명시한 것들)는 그대로 덮어쓰고, 명시 안 된 필드만 보존된다.
      await writer.set(db.collection("storeEvalCompetitors").doc(id), competitor, true);
      compWritten++;
    }
    // merge 후 실제로 Firestore에 남을 값(웹 전용 필드는 기존 문서 값 보존) — 아래 경쟁력점수
    // 재계산에 쓴다. dirty 여부와 무관하게 항상 채운다(안 바뀐 경쟁점도 계산엔 포함돼야 함).
    const mergedCompetitor = { ...existingCompByid.get(id), ...competitor } as unknown as Competitor;
    const list = competitorsByStoreCode.get(code) ?? [];
    list.push(mergedCompetitor);
    competitorsByStoreCode.set(code, list);
  }

  // ---- 경쟁력점수/자사수요 재계산 ----
  // 2026-08-30 신설 — ExistingStore.competitivenessScore/ownDemand는 최초 마이그레이션 때
  // 04_점포평가요약 스냅샷에서 한 번 박제된 캐시값이라, 01/05 시트에서 자사·경쟁점 원본입력을
  // 아무리 갱신해도 검증화면(runCohortValidation) 예측에 전혀 반영되지 않고 있었다(발견 경위는
  // calc.ts computeExistingStoreDemandEvaluation 주석 참고). 핑봇 실측 데이터 유무와 무관하게
  // (사용자 확정: "산식에서 핑봇가동률은 필수가 아니다") 매 동기화마다 원본입력 기준으로 다시
  // 계산해 캐시값을 항상 최신으로 맞춘다.
  let competitivenessRecalculated = 0;
  for (const code of storeCodes) {
    const store = storeDataByCode.get(code) as unknown as ExistingStore | undefined;
    if (!store) continue;
    const competitors = competitorsByStoreCode.get(code) ?? [];
    const loc = locationEvalByCandidateCode.get(store.originCandidateCode ?? code) ?? null;
    const evalResult = computeExistingStoreDemandEvaluation(store, competitors, loc, settings);
    // 2026-09-02(4차) — empiricalFeaturesFor 4번째 학습 피처(자사경쟁력×log(경쟁력격차))에 쓰기
    // 위해 competitivenessGap도 같이 캐시한다(사용자 확인: "경쟁점 경쟁력은 반드시 평가 항목에
    // 들어가야 한다").
    const competitorAvgCompetitiveness = computeCompetitorAvgCompetitiveness(competitors, settings);
    const competitivenessGap = computeCompetitivenessGap(evalResult.ownCompetitivenessScore, competitorAvgCompetitiveness);
    // 2026-08-30 — marketDemand/competitorIp도 같이 캐시한다(calc.ts empiricalFeaturesFor가
    // ownDemand 대신 이 둘을 분리된 학습 특징치로 쓰게 바뀜, empiricalFeaturesFor 주석 참고).
    const patch = {
      competitivenessScore: evalResult.ownCompetitivenessScore,
      ownDemand: evalResult.ownDemand,
      marketDemand: evalResult.marketDemand,
      competitorIp: evalResult.competitorIp,
      competitivenessGap,
    };
    if (!isSameData(store, patch)) {
      await writer.set(db.collection("storeEvalExistingStores").doc(code), { ...patch, updatedAt: Date.now() }, true);
      storeDataByCode.set(code, { ...store, ...patch });
      competitivenessRecalculated++;
    }
  }

  // 2026-08-30 — "09_입지동선평가 → storeEvalLocationEvaluations" 동기화 섹션을 제거했다(사용자
  // 확인: 입지동선평가는 이제 웹에서 AI로 자동 생성 → LocationEvalTab의 검토·적용·저장 흐름으로
  // Firestore에 직접 쓴다). 이 시트를 계속 읽었다면, 웹에서 새로 갱신한 값을 이 탭의 옛 스냅샷이
  // 다시 덮어쓰는 역주행 위험이 있었다 — 실제로 09시트 데이터가 전부 `updatedBy: "migration-script"`
  // 스냅샷이었음을 확인했다(사용자가 그 뒤로 웹에서 갱신한 값은 시트에 반영 안 됨). 09_입지동선평가
  // 시트 탭 자체도 삭제한다.

  await writer.finish();

  return {
    targetStoreCount: storeCodes.size,
    profileUpdated,
    competitorsWritten: compWritten,
    competitivenessRecalculated,
    suspiciousOpenDates,
  };
}

const SOURCE_SHEET_NAME = "매출DB";
const SOURCE_HEADER_ROW = 2;
const SOURCE_DATA_START_ROW = 3;
const BASE_COLUMN_COUNT = 14;
const MONTH_BLOCK_SIZE = 6;

function parseMonthHeader(text: string): { year: number; month: number } | null {
  const cleaned = String(text ?? "").trim().replace(/\s/g, "");
  const m = cleaned.match(/^(\d{2,4})년(\d{1,2})월$/);
  if (!m) return null;
  let year = Number(m[1]);
  if (year < 100) year += 2000;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function monthsBetween(openedAt: string | null | undefined, year: number, month: number): number | null {
  if (!openedAt) return null;
  const open = new Date(openedAt);
  if (Number.isNaN(open.getTime())) return null;
  return (year - open.getFullYear()) * 12 + (month - 1 - open.getMonth());
}

export type RevenueSyncSummary = {
  registeredStoreCount: number;
  autoRegisteredStores: string[];
  autoRegisterSkipped: string[];
  brandUpdated: number;
  salesUpserted: number;
  storesRecalculated: number;
};

/**
 * 매출DB → storeEvalExistingStores(신규 매장 자동등록 포함)/storeEvalExistingStoreSales 동기화.
 * scripts/syncSalesFromRevenueSheet.mjs와 동일 로직 + Firestore 배치쓰기.
 */
export async function runRevenueSync(): Promise<RevenueSyncSummary> {
  if (!adminDb) throw new Error("Firebase Admin이 초기화되지 않았습니다(FIREBASE_CLIENT_EMAIL/PRIVATE_KEY 확인).");
  const sheets = getSheetsClient();
  if (!sheets) throw new Error("Google Sheets 인증 정보가 없습니다.");
  const db = adminDb;
  const writer = new BatchWriter(db);

  // 넷 다 서로 의존하지 않는 읽기(Firestore 2건 + Sheets API 2건)라 순차 await 대신 병렬로
  // 실행한다(2026-08-24, Cron 함수 실행시간 제한 안에서 여유를 늘림).
  const [storesSnap, salesSnap, isBlackLabelByCode, sheetValuesRes] = await Promise.all([
    db.collection("storeEvalExistingStores").get(),
    // 값이 안 바뀐 매출 문서는 다시 쓰지 않기 위해 기존 매출 데이터를 미리 읽어둔다.
    db.collection("storeEvalExistingStoreSales").get(),
    fetchBrandColorByCode(sheets),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SOURCE_SHEET_NAME}'!A1:ZZ2000` }),
  ]);
  const storeCodes = new Set(storesSnap.docs.map((d) => d.id));
  const openedAtByCode = new Map<string, string | null>(storesSnap.docs.map((d) => [d.id, (d.data().openedAt as string) ?? null]));
  const storeDataByCode = new Map(storesSnap.docs.map((d) => [d.id, d.data()]));
  const existingSalesById = new Map(salesSnap.docs.map((d) => [d.id, d.data()]));
  const brandTypeFor = (code: string): "블랙라벨" | "확인필요" => (isBlackLabelByCode.get(code) ? "블랙라벨" : "확인필요");

  const values = sheetValuesRes.data.values ?? [];
  if (values.length < SOURCE_DATA_START_ROW) {
    return { registeredStoreCount: storeCodes.size, autoRegisteredStores: [], autoRegisterSkipped: [], brandUpdated: 0, salesUpserted: 0, storesRecalculated: 0 };
  }

  // ---- 1) 매출DB!E열(가맹해지여부)이 "정상"인데 아직 미등록인 매장을 자동 등록 ----
  const autoRegisteredStores: string[] = [];
  const autoRegisterSkipped: string[] = [];
  for (let r = SOURCE_DATA_START_ROW - 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row[0]) continue;
    const code = String(row[0]).trim();
    if (storeCodes.has(code)) continue;
    if (String(row[4] ?? "").trim() !== "정상") continue;
    // 2026-08-31(사용자 확정) — 블랙라벨만 평가 대상이라 리그(확인필요) 매장은 이제 자동등록도
    // 하지 않는다. 이 필터가 없으면 리그 매장을 Firestore에서 지워도 다음 크론이 그대로
    // 재등록해버린다(리그 92곳 일괄삭제 작업의 전제조건).
    if (!isBlackLabelByCode.get(code)) {
      autoRegisterSkipped.push(code);
      continue;
    }

    const storeName = String(row[1] ?? "").trim();
    const pcCount = toNumber(row[2]);
    const address = String(row[12] ?? "").trim() || null;
    const openedAt = parseKoreanDate(row[9]);
    if (!storeName || !openedAt) {
      autoRegisterSkipped.push(code);
      continue;
    }

    const now = Date.now();
    await writer.set(
      db.collection("storeEvalExistingStores").doc(code),
      {
        storeCode: code,
        storeName,
        pcCount: pcCount ?? null,
        evaluationPcCount: null,
        floor: null,
        groundLevel: null,
        openedAt,
        franchiseStatus: "정상",
        excludedFromModel: false,
        excludedReason: null,
        v61Predicted: null,
        referenceMarketDemand: null,
        brandType: brandTypeFor(code),
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
        updatedBy: "cron-sync",
      },
      true,
    );
    storeCodes.add(code);
    openedAtByCode.set(code, openedAt);
    autoRegisteredStores.push(`${code} ${storeName}`);
  }

  // ---- 1-1) 이미 등록된 매장도 매출DB 색상 기준으로 brandType을 매번 다시 맞춘다(멱등) ----
  // 09_입지동선평가에 행이 없는 매장은 여태 브랜드를 확인할 방법이 없었는데, 매출DB!지점명
  // 배경색(노란색=블랙라벨)이 09시트가 있는 41곳과 정확히 일치함을 확인해 이걸 기준으로 쓴다.
  let brandUpdated = 0;
  for (const code of storeCodes) {
    if (!isBlackLabelByCode.has(code)) continue;
    const patch = { brandType: brandTypeFor(code) };
    if (!isSameData(storeDataByCode.get(code), patch)) {
      await writer.set(db.collection("storeEvalExistingStores").doc(code), { ...patch, updatedAt: Date.now() }, true);
      brandUpdated++;
    }
  }

  // ---- 2) 월별 매출 upsert + completedMonths/actualMonthlyRevenueAvg 재계산 ----
  const headerRow = (values[SOURCE_HEADER_ROW - 1] ?? []) as string[];
  const monthBlocks: { startCol: number; year: number; month: number }[] = [];
  for (let c = BASE_COLUMN_COUNT; c < headerRow.length; c += MONTH_BLOCK_SIZE) {
    const month = parseMonthHeader(headerRow[c]);
    if (month) monthBlocks.push({ startCol: c, year: month.year, month: month.month });
  }

  const now = new Date();
  const CURRENT_YEAR_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let salesUpserted = 0;
  let storesRecalculated = 0;

  for (let r = SOURCE_DATA_START_ROW - 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row[0]) continue;
    const code = String(row[0]).trim();
    if (!storeCodes.has(code)) continue;

    const monthlyForThisStore: { yearMonth: string; pcSales: number | null; productSales: number | null }[] = [];
    for (const block of monthBlocks) {
      const pcSales = toNumber(row[block.startCol + 1]);
      const productSales = toNumber(row[block.startCol + 2]);
      const utilizationRate = toPercentNumber(row[block.startCol + 4]);
      const salesPerPcPerDay = toNumber(row[block.startCol + 5]);
      const productRatio = toPercentNumber(row[block.startCol + 3]);
      if (pcSales == null && productSales == null) continue;

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
      if (!isSameData(existingSalesById.get(salesId), salesDoc)) {
        await writer.set(db.collection("storeEvalExistingStoreSales").doc(salesId), salesDoc);
        salesUpserted++;
      }
      monthlyForThisStore.push({ yearMonth, pcSales: salesDoc.pcSales, productSales: salesDoc.productSales });
    }

    if (monthlyForThisStore.length === 0) continue;

    const openedAt = openedAtByCode.get(code);
    const withElapsed = monthlyForThisStore
      .filter((m) => m.yearMonth !== CURRENT_YEAR_MONTH)
      .map((m) => {
        const [y, mo] = m.yearMonth.split("-").map(Number);
        const elapsedMonths = monthsBetween(openedAt, y, mo);
        return elapsedMonths == null ? null : { elapsedMonths, pcSales: m.pcSales, productSales: m.productSales };
      })
      .filter((m): m is { elapsedMonths: number; pcSales: number | null; productSales: number | null } => m != null);

    if (withElapsed.length === 0) continue;
    const { completedMonths, actualMonthlyRevenueAvg } = computeStabilizedPerformance(withElapsed);
    const patch = { completedMonths, actualMonthlyRevenueAvg };
    if (!isSameData(storeDataByCode.get(code), patch)) {
      await writer.set(db.collection("storeEvalExistingStores").doc(code), { ...patch, updatedAt: Date.now() }, true);
      storesRecalculated++;
    }
  }

  await writer.finish();

  return { registeredStoreCount: storeCodes.size, autoRegisteredStores, autoRegisterSkipped, brandUpdated, salesUpserted, storesRecalculated };
}
