import { google } from "googleapis";
import { computeDeskSummary } from "./seatLayout/calc";
import type { DeskZone } from "./seatLayout/types";

// 통합 책상 발주서 스프레드시트.
const DEFAULT_SPREADSHEET_ID = "1ToFbYn6PrjrkbEzA6x2Ri7zUQS-lLP9w-Qqh3h7-MqY";
// 매장별 탭은 항상 이 탭(3번째 탭)의 양식(컬럼 구성/서식)을 그대로 복제해서 만든다.
const TEMPLATE_SHEET_TITLE = "광주첨단점";
// 새로 만든 탭은 항상 3번째 탭(안내/발주양식 탭 다음)에 꽂는다.
const NEW_TAB_INSERT_INDEX = 2;

const STORE_NAME_ROW = 11;
const DESK_QTY_ROW = 13;
const INSTALL_LOCATION_ROW = 14;
const INSTALL_DATE_COL = "AE";

// 템플릿 기준: 19행이 헤더("품명"/"규격(WxDxH)"/"단위"/"수량"/"책상 번호"), 20행부터 책상 품목.
const DESK_COMBO_START_ROW = 20;
const TEMPLATE_DESK_COMBO_ROW_COUNT = 9;
// 책상 품목 구간 바로 다음에 오는 고정 항목 — 이 라벨이 몇 번째 행에 있는지로, 이미 등록된 적
// 있는 탭의 현재 책상 품목 구간 크기를 알아낸다(그래야 다시 등록할 때 행 수를 정확히 맞출 수 있음).
const BOUNDARY_LABEL = "맞 테이블 케이싱";
const MENG_DESK_LABEL = "멍책상";

// 맞 테이블 케이싱부터 시작하는 "다른 품목" 구간의 고정 순서(멍책상을 1줄로 정리한 뒤 기준).
// 인테리어팀이 채우는 항목(맞 테이블 케이싱~원형테이블)과 아직 데이터가 없는 항목은 공백으로
// 두고, 작업 툴에서 계산 가능한 항목(낮은/와이드 유리칸막이, 아센암)만 자동으로 채운다.
const OTHER_ITEM_ROW_COUNT = 10;
const OTHER_ITEM_OFFSET = {
  mengDesk: 2, // 멍책상 (1줄만 남김, 규격도 비움)
  lowGlassPartition: 4,
  wideGlassPartition: 5,
  monitorArm: 6,
  ramenCabinet: 9,
};
const RAMEN_CABINET_FIXED_QTY = 2;

export function getDeskOrderSpreadsheetId() {
  return process.env.GOOGLE_DESK_ORDER_SHEET_ID || DEFAULT_SPREADSHEET_ID;
}

// Firestore/Slides/좌석번호표 시트 발행에 쓰는 것과 같은 서비스 계정을 재사용한다 (대상 시트를
// 이 서비스 계정에 편집자로 공유해두어야 한다).
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

// 작업 툴의 "책상" 값 -> 발주서 품명 접두어.
const DESK_TYPE_LABELS: Record<string, string> = {
  리그: "화이트매립책상",
  퍼스트클래스: "메이플클래스매립책상",
};

// 작업 툴의 "칸막이" 값 -> 발주서 품명 접미어.
const PARTITION_LABELS: Record<string, string> = {
  없음: "유리X",
  "낮은 유리칸막이": "낮은유리",
};

function formatDeskProductName(desk: string, partition: string): string {
  const deskLabel = DESK_TYPE_LABELS[desk] ?? desk;
  const partitionLabel = PARTITION_LABELS[partition] ?? partition;
  // 쿨러는 현재 LED 쿨러 단일 값이라 실제 값을 보지 않고 "L쿨러"로 고정 표기한다.
  return `${deskLabel}_L쿨러_${partitionLabel}`;
}

function stripSizeUnit(deskSize: string): string {
  return deskSize.replace(/mm$/i, "");
}

function buildComboRowArray(productName: string, size: string, qty: number, types: string): string[] {
  // B(품명)~Z(책상 번호) 25개 열. 규격은 W(가로)만 쓰고 D/H는 템플릿과 동일하게 "X"로 채운다.
  const row = new Array(25).fill("");
  row[0] = productName; // B
  row[11] = size; // M
  row[13] = "X"; // O
  row[16] = "X"; // R
  row[21] = String(qty); // W
  row[24] = types; // Z
  return row;
}

export async function publishDeskOrderToSheet({
  projectName,
  zones,
}: {
  projectName: string;
  zones: DeskZone[];
}): Promise<{ spreadsheetUrl: string; sheetTitle: string }> {
  const auth = getGoogleAuth();
  if (!auth) {
    throw new Error(
      "Google 서비스 계정 키(FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY)가 설정되지 않았습니다.",
    );
  }

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getDeskOrderSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = meta.data.sheets ?? [];
  const templateSheet = allSheets.find((s) => s.properties?.title === TEMPLATE_SHEET_TITLE);
  if (templateSheet?.properties?.sheetId == null) {
    throw new Error(`양식 탭("${TEMPLATE_SHEET_TITLE}")을 찾을 수 없습니다.`);
  }

  const sheetTitle = projectName.trim();

  // 같은 이름으로 이미 등록한 적이 있으면(양식 탭 자신은 제외) 새로 복제하지 않고 그 탭을 갱신한다.
  let targetSheetId: number;
  const existing = allSheets.find(
    (s) => s.properties?.title === sheetTitle && s.properties?.sheetId !== templateSheet.properties!.sheetId,
  );
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

  // 존별 책상 사양(책상 종류/칸막이/사이즈)을 합산 — 발주요약 이미지의 "책상 발주 합계" 표와
  // 동일한 계산을 재사용한다. 존종류(types)는 letter 접미사 없는 존 유형 라벨이 콤마로 묶여 나온다.
  const combos = computeDeskSummary(zones);

  // 이 탭의 "책상 품목" 구간이 현재 몇 행인지(과거에 등록해서 이미 늘리거나 줄여둔 상태일 수
  // 있음) 그 다음 고정 항목("맞 테이블 케이싱")이 몇 번째 행에 있는지로 알아낸다.
  const probe = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!B${DESK_COMBO_START_ROW}:B300`,
  });
  const probeRows = probe.data.values ?? [];
  const boundaryOffset = probeRows.findIndex((r) => r[0] === BOUNDARY_LABEL);
  const currentComboRowCount = boundaryOffset === -1 ? TEMPLATE_DESK_COMBO_ROW_COUNT : boundaryOffset;

  const newComboCount = Math.max(1, combos.length);
  const delta = newComboCount - currentComboRowCount;
  if (delta > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId: targetSheetId,
                dimension: "ROWS",
                startIndex: DESK_COMBO_START_ROW - 1 + currentComboRowCount,
                endIndex: DESK_COMBO_START_ROW - 1 + currentComboRowCount + delta,
              },
              inheritFromBefore: true,
            },
          },
        ],
      },
    });
  } else if (delta < 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: targetSheetId,
                dimension: "ROWS",
                startIndex: DESK_COMBO_START_ROW - 1 + newComboCount,
                endIndex: DESK_COMBO_START_ROW - 1 + currentComboRowCount,
              },
            },
          },
        ],
      },
    });
  }

  if (combos.length) {
    const comboRows = combos.map((c) =>
      buildComboRowArray(
        formatDeskProductName(c.desk, c.partition),
        stripSizeUnit(c.deskSize),
        c.qty,
        c.types,
      ),
    );
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetTitle}'!B${DESK_COMBO_START_ROW}:Z${DESK_COMBO_START_ROW + comboRows.length - 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: comboRows },
    });
  }

  const boundaryRowNow = DESK_COMBO_START_ROW + newComboCount;

  // 멍책상은 양식(광주첨단점)에 규격별로 3줄이 예시로 들어있지만, 실제로는 규격 구분 없이 1줄만
  // 쓰면 되므로 나머지 줄은 실제로 행을 지운다 (이미 정리된 탭이면 1줄만 있어서 아무 것도 하지 않음).
  const mengProbe = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!B${boundaryRowNow + OTHER_ITEM_OFFSET.mengDesk}:B${boundaryRowNow + OTHER_ITEM_OFFSET.mengDesk + 5}`,
  });
  const mengProbeRows = mengProbe.data.values ?? [];
  let mengCount = 0;
  while (mengProbeRows[mengCount]?.[0] === MENG_DESK_LABEL) mengCount += 1;
  if (mengCount > 1) {
    const firstMengRow0 = boundaryRowNow - 1 + OTHER_ITEM_OFFSET.mengDesk; // 0-indexed
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: targetSheetId,
                dimension: "ROWS",
                startIndex: firstMengRow0 + 1,
                endIndex: firstMengRow0 + mengCount,
              },
            },
          },
        ],
      },
    });
  }

  // 인테리어팀이 채우는 항목(맞 테이블 케이싱/ㄷ자 알루미늄 마감대/멍책상)은 규격도 지운다.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [
        `'${sheetTitle}'!M${boundaryRowNow}:R${boundaryRowNow}`,
        `'${sheetTitle}'!M${boundaryRowNow + 1}:R${boundaryRowNow + 1}`,
        `'${sheetTitle}'!M${boundaryRowNow + OTHER_ITEM_OFFSET.mengDesk}:R${boundaryRowNow + OTHER_ITEM_OFFSET.mengDesk}`,
      ],
    },
  });

  // 아직 자동기입 대상이 아닌 다른 품목의 수량은 비워두고, 작업 툴에서 계산 가능한 항목(낮은/
  // 와이드 유리칸막이, 아센암)과 고정값(라면수납장)만 채운다.
  const lowGlassQty = zones
    .filter((z) => z.partition === "낮은 유리칸막이")
    .reduce((s, z) => s + (Number(z.seats) || 0), 0);
  const wideGlassQty = zones
    .filter((z) => z.partition === "와이드 유리칸막이")
    .reduce((s, z) => s + (Number(z.seats) || 0), 0);
  const monitorArmQty = zones
    .filter((z) => z.monitorArm === "아센암")
    .reduce((s, z) => s + (Number(z.seats) || 0), 0);

  const otherItemsColumn: string[][] = Array.from({ length: OTHER_ITEM_ROW_COUNT }, () => [""]);
  otherItemsColumn[OTHER_ITEM_OFFSET.lowGlassPartition] = [String(lowGlassQty)];
  otherItemsColumn[OTHER_ITEM_OFFSET.wideGlassPartition] = [String(wideGlassQty)];
  otherItemsColumn[OTHER_ITEM_OFFSET.monitorArm] = [String(monitorArmQty)];
  otherItemsColumn[OTHER_ITEM_OFFSET.ramenCabinet] = [String(RAMEN_CABINET_FIXED_QTY)];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!W${boundaryRowNow}:W${boundaryRowNow + OTHER_ITEM_ROW_COUNT - 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: otherItemsColumn },
  });

  // 설치예정일/책상수량/설치장소는 아직 값이 없으므로 비워두고, 매장명만 탭 이름과 맞춰 채운다.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges: [
        `'${sheetTitle}'!I${DESK_QTY_ROW}`,
        `'${sheetTitle}'!I${INSTALL_LOCATION_ROW}`,
        `'${sheetTitle}'!${INSTALL_DATE_COL}${DESK_QTY_ROW}`,
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!I${STORE_NAME_ROW}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[projectName]] },
  });

  return {
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${targetSheetId}`,
    sheetTitle,
  };
}
