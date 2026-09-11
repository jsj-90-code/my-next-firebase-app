// 구글시트 셀 값을 파싱하는 공용 순수함수 모음.
//
// 이 함수들은 scripts/migrateFullExistingStoreProfiles.mjs, scripts/syncSalesFromRevenueSheet.mjs,
// src/lib/storeEval/cronSync.ts 세 곳에 거의 동일하게 복붙돼 있었다(2026-08-24 확인) — 실제로
// 이 복붙 드리프트 때문에 핑봇_가동률/실측착석률 퍼센트 파싱 버그가 한쪽만 고쳐지고 다른 쪽엔
// 남아있는 사고가 있었다(docs/data-issues.md 2026-08-22 항목). tsconfig의 allowJs로 TS 쪽에서도
// 이 .mjs를 그대로 import할 수 있으므로, 세 파일 모두 여기 하나만 참조하게 통일한다.

export function toNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

// 시트에서 퍼센트 서식 셀(핑봇_가동률, 실측착석률, PC대비상품비율, 가동율 등)은 Sheets API가
// "14.1%" 같은 표시 문자열로 돌려준다. toNumber()는 "%"를 못 벗겨내서 전부 null이 됐었다
// (2026-08-21 발견) — %를 제거한 뒤 숫자로 파싱한다. 저장 관례(normalizePercentLike, calc.ts)에
// 맞춰 나눗셈 없이 원본 퍼센트 숫자 그대로 반환한다(예: "14.1%" → 14.1).
export function toPercentNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[%,]/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

// 시트는 "유/무"를 쓰지만, 셀을 체크박스로 바꾸면 Sheets API가 "TRUE"/"FALSE"를 준다.
// 예전 목록엔 대문자 TRUE도 소문자 y도 없어서, 그런 셀은 전부 조용히 false가 됐다.
// 참으로 읽을 표기만 넓힌다 — "무/없음/N/FALSE"는 그대로 false다.
const TRUTHY = new Set(["유", "y", "true", "o", "예", "있음", "1"]);

export function toBool(v) {
  if (typeof v === "boolean") return v;
  return TRUTHY.has(String(v ?? "").trim().toLowerCase());
}

export function toText(v) {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

// 날짜를 "로컬 달력 기준"으로 YYYY-MM-DD로 찍는다. toISOString()은 UTC라, KST(+9)에서
// 로컬 자정으로 파싱된 날짜가 **하루 앞당겨진다**("2015. 9. 4" → "2015-09-03"). 오픈일이
// 하루 밀리면 경과개월이 달라져 성숙도 보정까지 번진다.
function formatLocalDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDateStr(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : formatLocalDate(v);
  const s = String(v).trim();
  if (!s) return null;
  // "2015. 9. 4", "2015.9.4", "2015/9/4", "2015-09-04"는 문자열 그대로 조립한다 —
  // Date를 거치지 않으니 시간대가 개입할 여지가 없다.
  const m = s.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s : formatLocalDate(parsed);
}

// 매출DB!오픈일 열은 "2015. 9. 4" 같은 점(.) 구분 표기라 01_점포기본정보(toDateStr)와 다른
// 파서가 필요하다.
export function parseKoreanDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  const d = new Date(s);
  // toISOString()이 아니라 로컬 달력 기준 — 위 formatLocalDate 주석 참고.
  return Number.isNaN(d.getTime()) ? null : formatLocalDate(d);
}

// 가맹점코드 앞 8자리(YYYYMMDD)는 보통 오픈일과 가깝다. 훨씬 크게 벌어지면 시트 오픈일이
// 아직 정확히 입력 안 된 placeholder일 가능성이 높다(실사례: 문산점) — 이런 경우 openedAt을
// 덮어쓰지 않는다.
/**
 * 시트의 오픈일을 그대로 반영해도 되는가.
 *
 * 2026-09-11 — 예전엔 `isOpenDateSuspicious`만 보고 30일 규칙에 걸리면 무조건 거부했다.
 * 그래서 **계약(코드 발급)보다 한 달 넘게 늦게 연 정상 매장**도 영원히 거부되고, 매일
 * 동기화 보고에 같은 경고만 반복됐다(시흥능곡점 2023-04-28, 사용자 확정).
 *
 * 판정 기준을 하나 더 둔다 — **이미 저장된 값과 시트 값이 같으면 받아들인다.** 저장값은
 * 매출DB에서 들어온 것이라, 둘이 같다는 건 서로 다른 출처가 같은 날짜를 말한다는 뜻이고
 * placeholder일 수 없다. 값이 서로 다를 때만 30일 규칙으로 거른다.
 */
export function shouldAcceptSheetOpenDate(code, sheetOpenedAt, storedOpenedAt) {
  if (!sheetOpenedAt) return false;
  if (storedOpenedAt && sheetOpenedAt === storedOpenedAt) return true;
  return !isOpenDateSuspicious(code, sheetOpenedAt);
}

export function isOpenDateSuspicious(code, sheetOpenedAt) {
  const m = code.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m || !sheetOpenedAt) return false;
  const derived = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  const sheet = new Date(sheetOpenedAt);
  if (Number.isNaN(derived.getTime()) || Number.isNaN(sheet.getTime())) return false;
  return Math.abs((sheet.getTime() - derived.getTime()) / 86400000) > 30;
}
