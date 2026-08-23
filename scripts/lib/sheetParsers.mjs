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

export function toBool(v) {
  const s = String(v ?? "").trim();
  return s === "유" || s === "Y" || s === "true";
}

export function toText(v) {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

export function toDateStr(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s : parsed.toISOString().slice(0, 10);
}

// 매출DB!오픈일 열은 "2015. 9. 4" 같은 점(.) 구분 표기라 01_점포기본정보(toDateStr)와 다른
// 파서가 필요하다.
export function parseKoreanDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// 가맹점코드 앞 8자리(YYYYMMDD)는 보통 오픈일과 가깝다. 훨씬 크게 벌어지면 시트 오픈일이
// 아직 정확히 입력 안 된 placeholder일 가능성이 높다(실사례: 문산점) — 이런 경우 openedAt을
// 덮어쓰지 않는다.
export function isOpenDateSuspicious(code, sheetOpenedAt) {
  const m = code.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m || !sheetOpenedAt) return false;
  const derived = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  const sheet = new Date(sheetOpenedAt);
  if (Number.isNaN(derived.getTime()) || Number.isNaN(sheet.getTime())) return false;
  return Math.abs((sheet.getTime() - derived.getTime()) / 86400000) > 30;
}
