import { google } from "googleapis";
import type { ZoneTypeKey } from "./seatLayout/types";

// 좌석번호표(모니터 표찰) 제작용 공유 스프레드시트.
const DEFAULT_SPREADSHEET_ID = "18r6u-Wp0cMM28zRGQZHaDF4R_XkT2hmQEGmX9v0iReA";
// 매장별 탭은 항상 이 탭의 양식(컬럼 구성/서식)을 그대로 복제해서 만든다.
const TEMPLATE_SHEET_TITLE = "260717 광주첨단점";
// 템플릿 탭 기준: 5행이 매장정보, 6행이 헤더("존이름"/"좌석번호"/...), 7행부터 데이터.
const STORE_INFO_ROW = 5;
const DATA_START_ROW = 7;
const DATA_CLEAR_END_ROW = 500;
// 새로 만든 탭은 항상 맨 앞(안내 탭 바로 다음, index 1 = 두번째 탭)에 꽂는다.
const NEW_TAB_INSERT_INDEX = 1;

export function getSeatNumberSpreadsheetId() {
  return process.env.GOOGLE_SEAT_NUMBER_SHEET_ID || DEFAULT_SPREADSHEET_ID;
}

// Firestore/Slides 발행에 쓰는 것과 같은 서비스 계정을 재사용한다 (스프레드시트 접근 권한만
// 추가로 필요 — 대상 시트를 이 서비스 계정에 편집자로 공유해두어야 한다).
function getGoogleAuth() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// 작업 툴에서는 같은 존 유형이 여러 개일 때 "FPS존A", "FPS존B"처럼 존 이름 끝에 구분용
// 알파벳을 붙이는데, 좌석번호표 양식에는 그 알파벳 없이 존 이름만 적는다(구간은 행을 나눠서).
function stripZoneLetterSuffix(name: string): string {
  return name.replace(/[A-Za-z]$/, "");
}

function todayTabPrefix(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

// ---------------- 사양1~4 / 설명글 매핑 ----------------

// 존 유형별 고정 소개 문구 (매핑이 없는 유형은 빈 칸으로 둔다).
const ZONE_DESCRIPTIONS: Partial<Record<ZoneTypeKey, string>> = {
  couple_seat: "커플들을 위한 아이센스만의 꽁냥꽁냥 커플석",
  fps: "FPS를 선호하는 고객을 위한 대회용 프리미엄 좌석",
  lol: "더욱 선명한 화질로 한타 승리 보장! 승리를 위해 세팅된 좌석",
  friends: "아이센스만의 와글와글 프렌즈존, 같이 웃고 같이 즐기자!",
  one_seat: "혼자서 몰입할 수 있는 아이센스만의 1인 전용 좌석",
  vip: "더 넓은 와이드데스크로 VIP만을 위한 프라이빗 좌석",
  multi: "더 빠르고 부드러운 플레이를 위한 240Hz 고주사율 모니터 좌석",
  team: "팀 게임을 위한 아이센스만의 프리미엄 좌석",
  fc: "더욱 선명한 화질과 무선 조이패드가 세팅된 FC온라인 전용석",
};

// 사양3(키보드)에서 VIP/멀티/FC ONLINE존은 실제 키보드값과 무관하게 이 문구로 고정한다.
// 사양4(마우스)는 이 유형들도 다른 존과 동일하게 실제 마우스값 매핑을 그대로 따른다.
const SPEC3_TYPE_OVERRIDES: Partial<Record<ZoneTypeKey, string>> = {
  vip: "더 넓은 와이드데스크",
  multi: "게이밍 듀얼 마우스",
  fc: "조이패드",
};

const COUPLE_MOUSE_OVERRIDE = "커플을 위한 핑크 헤드셋과 무선 마우스";

const KEYBOARD_LABELS: Record<string, string> = {
  "Razer Huntsman V3 Pro": "레이저 헌츠맨 키보드",
  "AULA F87 Pro 독거미 텐키리스": "아우라 텐키리스 키보드",
};

const MOUSE_LABELS: Record<string, string> = {
  "G304 & 스틸시리즈 라이벌3": "스틸시리즈 RIVAL 3 마우스",
  "G304 & ROCCAT PURE SEL 유선 화이트": "게이밍 듀얼 마우스",
};

// 제조사명 뒤에 공백이 없는 옛날 표기(예: "제이씨현32인치240hz")가 남아있어도 브랜드를 확실히
// 떼어내도록, 단어 분리 대신 알려진 제조사명 접두어 목록으로 직접 매칭한다.
const MONITOR_BRAND_PREFIXES = ["제이씨현", "비트엠", "큐닉스"];

// "제이씨현 32인치 240Hz" -> "32인치 240Hz 모니터" / BenQ, LG 울트라기어는 제조사명을 유지한다.
function formatMonitorSpec(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const keepBrand = trimmed.startsWith("BenQ") || trimmed.startsWith("LG 울트라기어");
  let body = trimmed;
  if (!keepBrand) {
    const brand = MONITOR_BRAND_PREFIXES.find((b) => trimmed.startsWith(b));
    body = brand ? trimmed.slice(brand.length).trim() : trimmed;
  }
  return body.endsWith("모니터") ? body : `${body} 모니터`;
}

function formatSpec3(typeKey: ZoneTypeKey, keyboard: string): string {
  const override = SPEC3_TYPE_OVERRIDES[typeKey];
  if (override) return override;
  return KEYBOARD_LABELS[(keyboard ?? "").trim()] ?? "";
}

function formatSpec4(typeKey: ZoneTypeKey, mouse: string): string {
  // 멀티존은 사양3에 이미 "게이밍 듀얼 마우스"가 들어가므로, 사양4에 같은 문구가 또 들어가지
  // 않게 비워둔다.
  if (typeKey === "multi") return "";
  if (typeKey === "couple_seat" || typeKey === "couple_room") return COUPLE_MOUSE_OVERRIDE;
  return MOUSE_LABELS[(mouse ?? "").trim()] ?? "";
}

type SheetRow = [string, string, string, string, string, string, string];

// 존이름/사양1~4/설명글이 전부 같은데 좌석번호 구간만 다른 경우(예: 사양 차이가 없어서 그냥
// 존만 나눠뒀던 FPS존A/B), 굳이 행을 나누지 않고 좌석번호만 ", "로 이어붙여 한 행으로 합친다.
// 하나라도 다르면(사양이 실제로 다른 경우) 원래대로 행을 나눠서 보여준다.
function buildSheetRows(entries: SeatNumberSheetEntry[]): SheetRow[] {
  const rowsByKey = new Map<string, SheetRow>();
  const order: string[] = [];
  entries.forEach((e) => {
    const name = stripZoneLetterSuffix(e.zoneName);
    const gpu = (e.gpu ?? "").trim();
    const monitor = formatMonitorSpec(e.monitor);
    const spec3 = formatSpec3(e.typeKey, e.keyboard);
    const spec4 = formatSpec4(e.typeKey, e.mouse);
    const description = ZONE_DESCRIPTIONS[e.typeKey] ?? "";
    const key = [name, gpu, monitor, spec3, spec4, description].join("");
    const existing = rowsByKey.get(key);
    if (existing) {
      existing[1] = `${existing[1]}, ${e.ranges}`;
      return;
    }
    rowsByKey.set(key, [name, e.ranges, gpu, monitor, spec3, spec4, description]);
    order.push(key);
  });
  return order.map((key) => rowsByKey.get(key)!);
}

export type SeatNumberSheetEntry = {
  zoneName: string;
  ranges: string;
  typeKey: ZoneTypeKey;
  gpu: string;
  monitor: string;
  keyboard: string;
  mouse: string;
};

export type StoreInfo = {
  openDate?: string;
  deliveryDate?: string;
  svName?: string;
  svPhone?: string;
  ownerName?: string;
  ownerPhone?: string;
  address?: string;
};

function buildStoreInfoText(info: StoreInfo | undefined): string {
  const s = info ?? {};
  const svLine = [s.svName, s.svPhone].filter(Boolean).join(" / ");
  const ownerLine = [s.ownerName, s.ownerPhone].filter(Boolean).join(" / ");
  return [
    `매장 오픈일 : ${s.openDate ?? ""}`,
    `입고 희망일 : ${s.deliveryDate ?? ""}`,
    `담당 SV : ${svLine}`,
    `점주님 정보 : ${ownerLine}`,
    `매장 주소 : ${s.address ?? ""}`,
  ].join("\n");
}

export async function publishSeatNumbersToSheet({
  projectName,
  entries,
  storeInfo,
}: {
  projectName: string;
  entries: SeatNumberSheetEntry[];
  storeInfo?: StoreInfo;
}): Promise<{ spreadsheetUrl: string; sheetTitle: string }> {
  const auth = getGoogleAuth();
  if (!auth) {
    throw new Error(
      "Google 서비스 계정 키(FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY)가 설정되지 않았습니다.",
    );
  }

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSeatNumberSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = meta.data.sheets ?? [];
  const templateSheet = allSheets.find((s) => s.properties?.title === TEMPLATE_SHEET_TITLE);
  if (templateSheet?.properties?.sheetId == null) {
    throw new Error(`양식 탭("${TEMPLATE_SHEET_TITLE}")을 찾을 수 없습니다.`);
  }

  const sheetTitle = `${todayTabPrefix()} ${projectName}`.trim();

  // 같은 날 같은 프로젝트로 이미 등록한 적이 있으면 새로 복제하지 않고 그 탭을 갱신한다.
  let targetSheetId: number;
  const existing = allSheets.find((s) => s.properties?.title === sheetTitle);
  if (existing?.properties?.sheetId != null) {
    targetSheetId = existing.properties.sheetId;
  } else {
    const dup = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: templateSheet.properties.sheetId,
              insertSheetIndex: NEW_TAB_INSERT_INDEX,
              newSheetName: sheetTitle,
            },
          },
        ],
      },
    });
    const newSheetId = dup.data.replies?.[0]?.duplicateSheet?.properties?.sheetId;
    if (newSheetId == null) throw new Error("시트 탭 복제에 실패했습니다.");
    targetSheetId = newSheetId;
  }

  // 복제 직후에는 원본 매장(260717 광주첨단점)의 매장정보/존별 데이터가 그대로 들어있으므로,
  // 이번 프로젝트 값으로 다시 채우기 전에 지운다.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [
        `'${sheetTitle}'!B${STORE_INFO_ROW}:H${STORE_INFO_ROW}`,
        `'${sheetTitle}'!B${DATA_START_ROW}:H${DATA_CLEAR_END_ROW}`,
      ],
    },
  });

  const rows = buildSheetRows(entries);
  const rowCount = Math.max(1, rows.length);
  // 존 개수가 양식의 원래 예시 행 수보다 많거나 적어도 폰트/정렬/테두리가 깨지지 않도록,
  // 데이터 첫 행(7행)의 서식을 실제로 채울 행 수만큼 복사해 통일한다.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          copyPaste: {
            source: {
              sheetId: targetSheetId,
              startRowIndex: DATA_START_ROW - 1,
              endRowIndex: DATA_START_ROW,
              startColumnIndex: 1,
              endColumnIndex: 8,
            },
            destination: {
              sheetId: targetSheetId,
              startRowIndex: DATA_START_ROW - 1,
              endRowIndex: DATA_START_ROW - 1 + rowCount,
              startColumnIndex: 1,
              endColumnIndex: 8,
            },
            pasteType: "PASTE_FORMAT",
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!B${STORE_INFO_ROW}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[buildStoreInfoText(storeInfo)]] },
  });

  if (rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!B${DATA_START_ROW}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  }

  // 다중 줄 좌석번호(예: "25~29\n32~36")가 있어도 행이 잘려 보이지 않도록 높이를 다시 맞춘다.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: targetSheetId,
              dimension: "ROWS",
              startIndex: DATA_START_ROW - 1,
              endIndex: DATA_START_ROW - 1 + rowCount,
            },
          },
        },
      ],
    },
  });

  return {
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${targetSheetId}`,
    sheetTitle,
  };
}
