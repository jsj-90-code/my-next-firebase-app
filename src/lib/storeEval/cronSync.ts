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
import { computeStabilizedPerformance, resolveManagementScores } from "./calc";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { existingStoreEvaluationPatch, existingStoreSourceCode } from "./existingStoreEvaluation";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { mergeModelSettings } from "./settings";
import type { Competitor, ExistingStore, LocationEvaluation, ModelSettings } from "./types";
// scripts/migrateFullExistingStoreProfiles.mjs, scripts/syncSalesFromRevenueSheet.mjs와 셀 파싱/
// dirty-check 로직을 하나로 합친다(tsconfig allowJs) — 예전엔 세 곳에 거의 동일하게 복붙돼 있어서
// 핑봇_가동률 퍼센트 파싱 버그가 한쪽만 고쳐지고 이 파일엔 남아있던 사고가 있었다(2026-08-22,
// docs/data-issues.md). 단일 출처로 합쳐 같은 드리프트가 재발하지 않게 한다(2026-08-24).
import { needsWrite } from "../../../scripts/lib/diffWrite.mjs";
import { toNumber, toPercentNumber, parseKoreanDate } from "../../../scripts/lib/sheetParsers.mjs";

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

export type ProfileMigrationSummary = {
  targetStoreCount: number;
  profileUpdated: number;
  competitorsWritten: number;
  competitivenessRecalculated: number;
  suspiciousOpenDates: string[];
};

/** 기존점 경쟁력점수·수요 캐시 재계산 — 웹(Firestore) 값만 쓴다. 2026-10-10부터 01/05 시트는 읽지 않는다(이름은 호출부 호환으로 유지). */
export async function runFullProfileMigration(): Promise<ProfileMigrationSummary> {
  if (!adminDb) throw new Error("Firebase Admin이 초기화되지 않았습니다(FIREBASE_CLIENT_EMAIL/PRIVATE_KEY 확인).");
  const db = adminDb;
  const writer = new BatchWriter(db);
  const suspiciousOpenDates: string[] = [];

  // 2026-08-31 — "03_회원정보입력 → storeEvalExistingStoreMembers" 동기화 섹션을 완전히 제거했다
  // (사용자 확인: 이 컬렉션을 다시 읽는 화면이 앱 어디에도 없어 Firestore 다이어트 대상으로 전부
  // 삭제했는데, 이 동기화가 남아있으면 다음 실행 때 그대로 되살아나 삭제가 무의미해진다).
  // 셋 다 서로 의존하지 않는 읽기라 순차 await 대신 병렬로 실행한다(2026-08-24, Cron 함수
  // 실행시간 제한 안에서 여유를 늘림). 값이 안 바뀐 문서는 다시 쓰지 않기 위해 기존 경쟁점
  // 데이터도 미리 읽어둔다.
  const [storesSnap, competitorsSnap, settingsSnap, locationEvalsSnap, qscSnap] = await Promise.all([
    db.collection("storeEvalExistingStores").get(),
    db.collection("storeEvalCompetitors").get(),
    db.collection("storeEvalSettings").doc("current").get(),
    // 2026-08-30(경쟁력 평가 기준 최종본 §12) — 자사 "입지10%" 컴포넌트가 09_입지동선평가(4요소
    // 조합)를 쓰도록 바뀌면서, 아래 경쟁력점수 재계산 루프가 매장별 LocationEvaluation도 필요해졌다.
    // 이 컬렉션은 09_입지동선평가 시트 동기화가 끊긴 뒤로 웹(AI 평가 화면)에서만 쓰이므로, 시트를
    // 다시 읽지 않고 Firestore 컬렉션을 통째로 한 번 읽어 맵으로 만든다(매장 133곳 순회 전 1회 조회).
    db.collection("storeEvalLocationEvaluations").get(),
    // 2026-09-20 — 본사 QSC 점검 점수. 자사 **관리 점수**가 여기서 나온다(calc.ts
    // QSC_MANAGEMENT_FLOOR 주석). ⚠️ 이걸 안 읽으면 크론이 관리 4.00으로 캐시를 다시 써서
    // **화면과 캐시가 갈라진다** — 화면은 listQscScores로 같은 컬렉션을 읽기 때문이다.
    // firebase-admin이라 store.ts의 listQscScores(클라이언트 SDK)를 못 쓴다. 그래서 여기서
    // 직접 읽되, 평균 내는 규칙은 **같은 함수**(qscInWindowAverage)를 쓴다.
    db.collection("storeEvalQscScores").get(),
  ]);
  const storeCodes = new Set(storesSnap.docs.map((d) => d.id));
  const storeDataByCode = new Map(storesSnap.docs.map((d) => [d.id, d.data()]));
  const existingCompByid = new Map(competitorsSnap.docs.map((d) => [d.id, migrateCompetitorInvestigationStatus(d.data())]));
  const locationEvalByCandidateCode = new Map(locationEvalsSnap.docs.map((d) => [d.id, d.data() as LocationEvaluation]));
  // ⚠️ 저장된 평균값이 아니라 **원본 기록에서 여기서 계산한다**(store.ts readQscScores와 같은
  //    이유 — 창 길이와 제외 규칙이 labInput.ts 한 곳에만 있어야 한다).
  const qscByStoreCode = new Map<string, number>();
  for (const d of qscSnap.docs) {
    const v = d.data() as { storeCode?: string; openedAt?: string | null; records?: QscRecord[] };
    if (!v.storeCode) continue;
    const avg = qscInWindowAverage(v.records ?? [], v.openedAt ?? null);
    if (avg != null && avg > 0) qscByStoreCode.set(v.storeCode, avg);
  }
  const settings: ModelSettings = mergeModelSettings(settingsSnap.exists ? (settingsSnap.data() as Partial<ModelSettings>) : null);

  // ---- 01_점포기본정보 · 05_경쟁점정보: 더 이상 읽지 않는다 (2026-10-10 사용자) ----
  // "매출만 불러오고 점포정보랑 경쟁점은 이제 웹을 본데이터로". 예전엔 매일 이 두 시트로 기존점 프로필·경쟁점을 덮어써서
  // 웹에서 고친 값(측정기 정밀점검 때 고친 경쟁점 대수 등)이 다음 날 되돌아갔다. 새 기존점은 시트 자동등록이 아니라
  // 웹의 "후보지 → 기존점 전환"(store.ts, originCandidateCode)으로만 생기므로 시트로 처음 채울 일도 없다.
  // 아래 재계산은 웹(Firestore) 값만으로 한다. 옛 매핑 코드는 git 기록(b2b3d25 이전)에 있다.
  const profileUpdated = 0;
  const compWritten = 0;

  // Include web-created competitors too, exactly as the evaluation screens do.
  const competitorsByCandidateCode = new Map<string, Competitor[]>();
  for (const data of existingCompByid.values()) {
    const competitor = data as Competitor;
    const list = competitorsByCandidateCode.get(competitor.candidateCode) ?? [];
    list.push(competitor);
    competitorsByCandidateCode.set(competitor.candidateCode, list);
  }

  // ---- 경쟁력점수/자사수요 재계산 ----
  // 2026-08-30 신설 — ExistingStore.competitivenessScore/ownDemand는 최초 마이그레이션 때
  // 04_점포평가요약 스냅샷에서 한 번 박제된 캐시값이라, 01/05 시트에서 자사·경쟁점 원본입력을
  // 아무리 갱신해도 검증화면(runCohortValidation) 예측에 전혀 반영되지 않고 있었다(발견 경위는
  // calc.ts computeExistingStoreDemandEvaluation 주석 참고). 핑봇 실측 데이터 유무와 무관하게
  // (사용자 확정: "산식에서 핑봇가동률은 필수가 아니다") 매 동기화마다 원본입력 기준으로 다시
  // 계산해 캐시값을 항상 최신으로 맞춘다.
  let competitivenessRecalculated = 0;
  // 2026-09-20 — 관리 점수를 QSC 환산값으로 갈아끼운다. ⚠️ 평균을 내는 매장 목록이 화면과
  // 같아야 한다(화면은 listExistingStores 전부 = 여기 storeCodes 전부). 한쪽만 걸러 넣으면
  // 가맹점 평균이 달라져 캐시와 화면이 조용히 갈라진다.
  const management = resolveManagementScores([...storeCodes], qscByStoreCode);
  for (const code of storeCodes) {
    const store = storeDataByCode.get(code) as unknown as ExistingStore | undefined;
    if (!store) continue;
    const lookupCode = existingStoreSourceCode({ ...store, storeCode: code });
    const competitors = competitorsByCandidateCode.get(lookupCode) ?? [];
    const loc = locationEvalByCandidateCode.get(lookupCode) ?? null;
    // 2026-09-02(4차) — empiricalFeaturesFor 4번째 학습 피처(자사경쟁력×log(경쟁력격차))에 쓰기
    // 위해 competitivenessGap도 같이 캐시한다(사용자 확인: "경쟁점 경쟁력은 반드시 평가 항목에
    // 들어가야 한다").
    // 2026-08-30 — marketDemand/competitorIp도 같이 캐시한다(calc.ts empiricalFeaturesFor가
    // ownDemand 대신 이 둘을 분리된 학습 특징치로 쓰게 바뀜, empiricalFeaturesFor 주석 참고).
    const patch = existingStoreEvaluationPatch(store, competitors, loc, settings, management.scoreFor(code));
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
  /** 매출DB엔 있는데 웹 기존점이 아닌 블랙라벨 정상 매장 — 후보지→기존점 전환이 필요하다는 신호(2026-10-10). */
  salesOnlyStores: string[];
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
    return { registeredStoreCount: storeCodes.size, autoRegisteredStores: [], autoRegisterSkipped: [], salesOnlyStores: [], brandUpdated: 0, salesUpserted: 0, storesRecalculated: 0 };
  }

  // ---- 1) 자동 등록은 하지 않는다 (2026-10-10 사용자) ----
  // 새 기존점은 웹의 "후보지 → 기존점 전환"(store.ts)으로만 생긴다. 예전엔 매출DB에 새 블랙라벨 코드가 보이면 빈 기존점 문서를
  // 만들었는데, 전환보다 먼저 만들어지면 후보지 기록과 이어지지 않은 껍데기가 생긴다. 대신 "매출DB엔 있는데 웹 기존점이 아닌
  // 블랙라벨 정상 매장"을 salesOnlyStores로 알려 준다 — 전환할 후보지가 생겼다는 신호(개점 3~6개월 뒤 경쟁점 재측정 과제의 출발점).
  // 이 매장들의 매출은 전환 뒤 다음 크론부터 들어온다(아래 매출 쓰기는 웹에 등록된 매장만).
  const autoRegisteredStores: string[] = [];
  const autoRegisterSkipped: string[] = [];
  const salesOnlyStores: string[] = [];
  for (let r = SOURCE_DATA_START_ROW - 1; r < values.length; r++) {
    const row = values[r];
    if (!row || !row[0]) continue;
    const code = String(row[0]).trim();
    if (storeCodes.has(code)) continue;
    if (String(row[4] ?? "").trim() !== "정상") continue;
    if (!isBlackLabelByCode.get(code)) continue;
    salesOnlyStores.push(`${code} ${String(row[1] ?? "").trim()} (개점 ${parseKoreanDate(row[9]) ?? "?"})`);
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

  return { registeredStoreCount: storeCodes.size, autoRegisteredStores, autoRegisterSkipped, salesOnlyStores, brandUpdated, salesUpserted, storesRecalculated };
}
