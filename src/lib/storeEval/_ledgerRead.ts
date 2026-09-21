// 건별 매출원장 읽기 — 하네스 공용 (2026-09-22 분리)
//
// `_ledgerPerUser.test.ts`가 갖고 있던 파서를 그대로 꺼냈다. 원장을 읽는 하네스가 둘이 되면서
// 파서가 둘이 될 참이었다. 이 저장소는 그걸로 이미 한 번 데였다 — 화면이 거리 계단을 따로
// 구현해 두는 바람에 산식은 302m를 89%로 세는데 화면은 "안 셈"이라고 그리고 있었다(2026-09-21).
// **읽는 자리는 하나로 둔다.**
//
// ⚠️ 원장은 저장소 밖(바탕화면)에 있다. 자리를 옮기면 아래 LEDGER_DIRS만 고친다.
// ⚠️ 여기서 걸러 낸 함정은 `_ledgerPerUser.test.ts` 머리에 전부 적혀 있다
//    (합계행 · 월 없는 날짜 · 인코딩 두 종 · 열 구성 · 연도 섞임 · 부분월 · 누적분모).
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

/**
 * 원장 폴더 후보. **앞에서부터 찾아 처음 있는 것을 쓴다.**
 *
 * 2026-09-22에 늘렸다 — 그전에는 회사 PC 바탕화면 하나가 박혀 있어서 집에서는 하네스가
 * **조용히 skip**됐다(인계문 4절). 조용한 skip은 "변화 없음"이라는 거짓 결론을 만든다.
 * 환경변수 `LEDGER_DIR`가 있으면 그게 제일 앞이다.
 */
export const LEDGER_DIRS: string[] = [
  process.env.LEDGER_DIR ?? "",
  "C:/Users/ISENS/Desktop/좌석가동률_7월",
  "C:/Users/ISENS/Desktop/바탕화면/좌석가동률_7월",
  "C:/Users/ISENS/OneDrive/바탕 화면/좌석가동률_7월",
  "C:/Users/ISENS/Documents/좌석가동률_7월",
].filter(Boolean);

/** 원장 폴더를 찾는다. 없으면 null — 부르는 쪽이 **skip 이유를 찍어야 한다**. */
export function findLedgerDir(): string | null {
  return LEDGER_DIRS.find((d) => existsSync(d)) ?? null;
}

/** 비회원은 번호를 100개쯤 돌려쓴다 — 인원 세기에서 뺀다(시간 비중은 따로 본다). */
export const isGuest = (id: string) => id.startsWith("비*원*") || id === "";

/** 두 파일이 같은 매장 것인가 — csv·xls·xlsx 중복 포맷을 거르는 데 쓴다. */
export function sameStore(a: string, b: string, stores: { storeName: string }[]): boolean {
  const of = (f: string) => stores.map((s) => s.storeName).find((n) => f.includes(n));
  const x = of(a);
  return x != null && x === of(b);
}

/** "2일 08:39" · "12시간 05분" · "51분" · "1:30" 전부 분으로. 못 읽으면 null. */
export function parseLedgerMinutes(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)일\s+(\d+):(\d+)$/))) return +m[1] * 1440 + +m[2] * 60 + +m[3];
  if ((m = s.match(/^(\d+)시간(?:\s+(\d+)분)?$/))) return +m[1] * 60 + (+m[2] || 0);
  if ((m = s.match(/^(\d+)분$/))) return +m[1];
  if ((m = s.match(/^(\d+):(\d+)$/))) return +m[1] * 60 + +m[2];
  return null;
}

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** BOM이 있으면 UTF-8, 없으면 CP949. 파일마다 다르다 — 처음 다섯과 재내보낸 셋이 갈린다. */
function decodeCsv(path: string): string {
  const buf = readFileSync(path);
  const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  return bom ? buf.toString("utf8").replace(/^\uFEFF/, "") : new TextDecoder("euc-kr").decode(buf);
}

/**
 * 달 경계 — 최신순 정렬이라 날짜가 줄다가 **크게 튀면** 달이 바뀐 것이다. 다만 끝에
 * 전월 말 걸침 건이 한둘 붙어 있어, 그것까지 한 달로 세면 1개월치가 2개월이 된다.
 * → 구간 건수가 전체의 5% 미만이면 경계 잡음으로 보고 앞 달에 붙인다.
 */
export function monthSegments(days: number[], total: number): [number, number][] {
  if (!total) return [[0, 0]];
  const cuts = [0];
  for (let i = 1; i < days.length; i++) if (days[i] > days[i - 1] + 10) cuts.push(i);
  cuts.push(total);
  const segs: [number, number][] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if ((b - a) / total >= .05) segs.push([a, b]);
    else if (segs.length) segs[segs.length - 1][1] = b;
  }
  return segs.length ? segs : [[0, total]];
}

export type LedgerRecord = { id: string; min: number };

/**
 * 한 파일 → 원시 레코드. CSV(인코딩 두 종)와 xlsx를 같은 모양으로 돌려준다.
 * ⚠️ 구형 `.xls`는 OLE 형식이라 exceljs가 못 읽는다 — 부르는 쪽에서 csv를 먼저 골라야 한다.
 * ⚠️ 열은 **이름으로** 찾는다. 나중에 재내보낸 파일엔 "회원마케팅 쿠폰 시간"이 끼어 있다.
 */
export async function readLedgerFile(path: string): Promise<{ recs: LedgerRecord[]; days: number[] }> {
  const recs: LedgerRecord[] = [], days: number[] = [];
  const push = (id: string, useRaw: unknown, startRaw: unknown) => {
    if (!id && !String(useRaw ?? "").trim()) return;        // 합계행
    const min = parseLedgerMinutes(useRaw);
    if (min == null) return;
    recs.push({ id, min });
    const m = String(startRaw ?? "").match(/^(\d+)일/);
    if (m) days.push(+m[1]);
  };
  if (path.endsWith(".csv")) {
    const lines = decodeCsv(path).split(/\r?\n/).filter((l) => l.trim());
    const head = splitCsv(lines[0]).map((s) => s.trim());
    const cId = head.indexOf("ID"), cUse = head.indexOf("사용시간"), cStart = head.indexOf("시작시간");
    if (cId < 0 || cUse < 0) throw new Error(`${path}: ID·사용시간 열을 못 찾음`);
    for (const line of lines.slice(1)) {
      const f = splitCsv(line);
      push((f[cId] ?? "").trim(), f[cUse], f[cStart]);
    }
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const ws = wb.worksheets[0];
    const head = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim());
    const cId = head.indexOf("ID"), cUse = head.indexOf("사용시간"), cStart = head.indexOf("시작시간");
    if (cId < 0 || cUse < 0) throw new Error(`${path}: ID·사용시간 열을 못 찾음`);
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r).values as unknown[];
      push(String(row[cId] ?? "").trim(), row[cUse], row[cStart]);
    }
  }
  return { recs, days };
}

export type LedgerMonth = {
  /** 그 달 **고유 회원 수**. 비회원은 뺀 값이다. */
  uniq: number;
  /** 회원 이용시간 합(시간). */
  h: number;
  /** 원장에 실제로 찍힌 날 수. 부분월이면 30보다 작다. */
  nDays: number;
  /** 1인당 월 이용시간 — 30일로 환산한 값. */
  per: number;
};

/**
 * 달마다 따로 집계한다. **누적 분모를 쓰면 안 된다** — 3개월치를 한 번에 세면 고유회원이
 * 부풀려져 1인당이 과소된다(발산역 3.27 → 6.95h).
 *
 * ⚠️ `uniq`는 **인원이라 30일 환산을 하지 않는다.** 부분월이면 그만큼 적게 잡힌 값이다
 *    (시간은 per에서 환산한다). 인원을 쓸 때는 nDays를 같이 봐야 한다.
 */
export function ledgerMonths(recs: LedgerRecord[], days: number[]): LedgerMonth[] {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return monthSegments(days, recs.length).map(([a, b]) => {
    const slice = recs.slice(a, b).filter((r) => !isGuest(r.id));
    const uniq = new Set(slice.map((r) => r.id)).size;
    const nDays = new Set(days.slice(a, b)).size || 30;
    const h = sum(slice.map((r) => r.min)) / 60;
    return { uniq, h, nDays, per: uniq ? h / uniq * (30 / nDays) : NaN };
  });
}
