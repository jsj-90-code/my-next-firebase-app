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
// 2026-10-27 사용자: 시트는 "실제 매장에 입고된 사양"을 적고 매장마다 다를 수 있다 → 존 유형별 고정 문구 대신
// 그 존의 실제 사양값(웹 PC 사양)에서 뽑는다. 기준은 가장 최근 수기 탭 "261015 울산삼산점"(이 규칙으로 울산 웹 데이터를
// 돌리면 시트와 같게 나온다):
//   사양3 = 그 존의 대표 장비 — 커플 → 핑크 헤드셋 문구, FC → 조이패드, 키보드가 매장 기본과 다르면 키보드,
//           헤드셋이 다르면 헤드셋, 아니면 마우스.  사양4 = RAM이 매장 기본보다 크면 "RAM 32GB", 아니면 빈칸.
//   표에 없는 새 제품은 빈칸 대신 제품명을 그대로 적는다(사람이 시트에서 다듬음).
// 옛 규칙(사양3=키보드·VIP 와이드데스크 고정, 사양4=마우스)은 웹 마우스 이름이 "G304 & 로켓(번지)"처럼 바뀐 뒤
// 짝맞춤이 전부 빗나가 빈칸만 나왔다.

const TEAM_DESC = "팀 게임을 위한 아이센스만의 프리미엄 좌석";
// 존 유형별 고정 소개 문구 (매핑이 없는 유형은 빈 칸으로 둔다).
const ZONE_DESCRIPTIONS: Partial<Record<ZoneTypeKey, string>> = {
  couple_seat: "커플들을 위한 아이센스만의 꽁냥꽁냥 커플석",
  couple_room: "커플들을 위한 아이센스만의 꽁냥꽁냥 커플석",
  fps: "FPS를 선호하는 고객을 위한 대회용 프리미엄 좌석",
  lol: "더욱 선명한 화질로 한타 승리 보장! 승리를 위해 세팅된 좌석",
  friends: "아이센스만의 와글와글 프렌즈존, 같이 웃고 같이 즐기자!",
  one_seat: "혼자서 몰입할 수 있는 아이센스만의 1인 전용 좌석",
  one_room: "혼자서 몰입할 수 있는 아이센스만의 1인 전용 좌석",
  two: "둘만의 몰입감을 높여주는 2인 전용 프라이빗 좌석",
  three: TEAM_DESC,
  vip: "더 넓은 와이드데스크로 VIP만을 위한 프라이빗 좌석",
  multi: "더 빠르고 부드러운 플레이를 위한 240Hz 고주사율 모니터 좌석",
  team: TEAM_DESC,
  ceremony_team: TEAM_DESC,
  fc: "더욱 선명한 화질과 무선 조이패드가 세팅된 FC온라인 전용석",
};

function zoneDescription(typeKey: ZoneTypeKey, name: string): string {
  // 4인룸은 유형 목록에 없어 "기타" 유형에 이름 "4인룸"으로 들어온다(울산 시트: 팀 문구).
  if (typeKey === "etc" && /^[34]인룸/.test(name)) return TEAM_DESC;
  return ZONE_DESCRIPTIONS[typeKey] ?? "";
}

const COUPLE_TEXT = "커플을 위한 핑크 헤드셋과 무선 마우스";

function keyboardLabel(raw: string): string {
  if (/헌츠맨|huntsman/i.test(raw)) return "레이저 헌츠맨 키보드";
  if (/aula|독거미/i.test(raw)) return "아우라 텐키리스 키보드";
  return raw;
}

function headsetLabel(raw: string): string {
  if (/blackshark|블랙샤크/i.test(raw)) return "레이저 블랙샤크 헤드셋";
  return /헤드셋/.test(raw) ? raw : `${raw} 헤드셋`;
}

function mouseLabel(raw: string): string {
  if (/카타르|katar/i.test(raw)) return "커세어 KATAR PRO 마우스";
  if (/라이벌|rival/i.test(raw)) return "스틸시리즈 RIVAL 3 마우스";
  if (/로켓|roccat/i.test(raw)) return "게이밍 듀얼 마우스";
  return raw;
}

const same = (a?: string, b?: string) => (a ?? "").trim() === (b ?? "").trim();

function formatSpec3(e: SeatNumberSheetEntry): string {
  if (e.typeKey === "couple_seat" || e.typeKey === "couple_room") return COUPLE_TEXT;
  if (e.typeKey === "fc") return "조이패드";
  const kb = (e.keyboard ?? "").trim();
  if (kb && e.baseKeyboard !== undefined && !same(kb, e.baseKeyboard)) return keyboardLabel(kb);
  const hs = (e.headset ?? "").trim();
  if (hs && e.baseHeadset !== undefined && !same(hs, e.baseHeadset)) return headsetLabel(hs);
  const ms = (e.mouse ?? "").trim();
  return ms ? mouseLabel(ms) : "";
}

const gb = (raw?: string) => Number((raw ?? "").match(/(\d+)\s*GB/i)?.[1] ?? 0);

function formatSpec4(e: SeatNumberSheetEntry): string {
  const ram = gb(e.ram);
  return ram > 0 && ram > gb(e.baseRam) ? `RAM ${ram}GB` : "";
}

// 제조사명 뒤에 공백이 없는 옛날 표기(예: "제이씨현32인치240hz")가 남아있어도 브랜드를 확실히
// 떼어내도록, 단어 분리 대신 알려진 제조사명 접두어 목록으로 직접 매칭한다.
const MONITOR_BRAND_PREFIXES = ["제이씨현", "비트엠", "큐닉스"];

// "제이씨현 32인치 240Hz" -> "32인치 240Hz 모니터" / BenQ, LG 울트라기어는 제조사명을 유지한다.
// 보조 모니터가 있으면(보조 모니터 칸, 또는 예전처럼 모니터 칸에 "+ 제우스랩 …"로 붙인 값) "27인치 300Hz + 듀얼 모니터"(울산 시트).
function formatMonitorSpec(raw: string, subMonitor?: string): string {
  // 앞에 띄어쓰기가 있는 " +"만 보조 모니터 — "BenQ XL2540X+ 280Hz"처럼 모델명 안의 +는 그대로 둔다.
  const [main, ...extra] = (raw ?? "").split(/\s+\+/);
  const trimmed = main.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const keepBrand = trimmed.startsWith("BenQ") || trimmed.startsWith("LG 울트라기어");
  let body = trimmed;
  if (!keepBrand) {
    const brand = MONITOR_BRAND_PREFIXES.find((b) => trimmed.startsWith(b));
    body = brand ? trimmed.slice(brand.length).trim() : trimmed;
  }
  const hasSub = !!subMonitor && !["없음", "해당없음", ""].includes(subMonitor.trim());
  if (hasSub || extra.some((x) => x.trim())) return `${body.replace(/\s*모니터$/, "")} + 듀얼 모니터`;
  return body.endsWith("모니터") ? body : `${body} 모니터`;
}

type SheetRow = [string, string, string, string, string, string, string];

// 존이름/사양1~4/설명글이 전부 같은데 좌석번호 구간만 다른 경우(예: 사양 차이가 없어서 그냥
// 존만 나눠뒀던 FPS존A/B), 굳이 행을 나누지 않고 좌석번호만 ", "로 이어붙여 한 행으로 합친다.
// 하나라도 다르면(사양이 실제로 다른 경우) 원래대로 행을 나눠서 보여준다.
// "책상만 설치" 존은 표찰을 만들지 않으므로 행에서 빼고, 번호만 모아 맨 아래 안내 줄로 적는다(평택 시트).
export function buildSheetRows(entries: SeatNumberSheetEntry[]): { rows: SheetRow[]; skipped: string[] } {
  const rowsByKey = new Map<string, SheetRow>();
  const order: string[] = [];
  const skipped: string[] = [];
  entries.forEach((e) => {
    if (e.typeKey === "desk_only") {
      skipped.push(e.ranges);
      return;
    }
    const name = stripZoneLetterSuffix(e.zoneName);
    const gpu = (e.gpu ?? "").trim();
    const monitor = formatMonitorSpec(e.monitor, e.subMonitor);
    const spec3 = formatSpec3(e);
    const spec4 = formatSpec4(e);
    const description = zoneDescription(e.typeKey, name);
    const key = [name, gpu, monitor, spec3, spec4, description].join("");
    const existing = rowsByKey.get(key);
    if (existing) {
      existing[1] = `${existing[1]}, ${e.ranges}`;
      return;
    }
    rowsByKey.set(key, [name, e.ranges, gpu, monitor, spec3, spec4, description]);
    order.push(key);
  });
  return { rows: order.map((key) => rowsByKey.get(key)!), skipped };
}

export type SeatNumberSheetEntry = {
  zoneName: string;
  ranges: string;
  typeKey: ZoneTypeKey;
  gpu: string;
  monitor: string;
  keyboard: string;
  mouse: string;
  headset?: string;
  ram?: string;
  subMonitor?: string;
  // 매장 기본사양 — 존 사양이 이와 다르면 "그 존의 대표 장비"로 본다.
  baseKeyboard?: string;
  baseHeadset?: string;
  baseRam?: string;
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

  const { rows, skipped } = buildSheetRows(entries);
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

  if (skipped.length) {
    // 데이터 아래 한 줄 띄우고 B열에 안내 문구(평택 시트 "※19~26, 28~32번은 제작하지 않습니다.").
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!B${DATA_START_ROW + rows.length + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[`※${skipped.join(", ")}번은 제작하지 않습니다.`]] },
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
