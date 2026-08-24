// 업로드한 엑셀/CSV 파일을 "라벨-값" 후보 쌍 목록으로 바꾼다(marketDataExtract.ts가 실제 필드
// 매칭을 한다). 브라우저에서만 동작한다(File API + exceljs). 실제 SGIS/소상공인365 원본파일을
// 아직 못 봐서 두 가지 흔한 레이아웃을 모두 시도한다:
//   1) 한 행에 "라벨, 값"이 나란히 있는 2열 표(항목/값 세로 나열)
//   2) 헤더 행(예: 연령대별 라벨)과 바로 아래 행(그 값)이 같은 열에 있는 가로 표
// 둘 다 아니어도 손해는 없다 — marketDataExtract가 실제 필요한 라벨만 찾아 쓰고 나머지 후보는
// 그냥 버려진다.

import ExcelJS from "exceljs";
import type { LabelValuePair } from "./marketDataExtract";

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof (value as any).text === "string") return (value as any).text;
    if ("result" in value) return String((value as any).result ?? "");
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return "";
  }
  return String(value);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function pairsFromGrid(grid: string[][]): LabelValuePair[] {
  const pairs: LabelValuePair[] = [];
  for (const row of grid) {
    for (let c = 0; c < row.length - 1; c++) {
      const label = row[c]?.trim();
      const value = row[c + 1]?.trim();
      if (label && value) pairs.push({ label, value });
    }
  }
  for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
    for (let r = 0; r < grid.length - 1; r++) {
      const label = grid[r]?.[c]?.trim();
      const value = grid[r + 1]?.[c]?.trim();
      if (label && value) pairs.push({ label, value });
    }
  }
  return pairs;
}

async function readCsvGrid(file: File): Promise<string[][]> {
  const text = await file.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map(parseCsvLine);
}

async function readXlsxGrid(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const grid: string[][] = [];
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cellText(cell.value));
      });
      grid.push(cells);
    });
  }
  return grid;
}

/** 업로드한 파일(.xlsx/.xls/.csv)에서 라벨-값 후보 쌍을 뽑는다. 지원하지 않는 형식이면 던진다. */
export async function extractLabelValuePairsFromFile(file: File): Promise<LabelValuePair[]> {
  const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
  const grid = isCsv ? await readCsvGrid(file) : await readXlsxGrid(file);
  return pairsFromGrid(grid);
}

/** 원본파일 대조/재추출 추적용 SHA-256 해시(16진수). */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
