// 화면 전체에서 공유하는 표시 포맷 함수. 금액은 원 단위 + 천단위 쉼표, 비율/점수는 단위를 붙인다.

export function formatWon(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

// 2026-09-13 신설 — 다우오피스 평가기록용 금액 표기. 실제 담당자가 쓰는 문서는 원 단위를 쓰지
// 않고 "약 5,646만원"처럼 만원 단위로 적는다("58,280,450원"이라고 쓰지 않는다). AI에게 반올림을
// 맡기면 자릿수를 틀리므로 코드가 미리 계산해서 완성된 표현으로 넘긴다.
export function formatManwon(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
}

// 예상 월매출처럼 정밀도를 주장할 수 없는 값은 100만원 단위로 끊는다 — 실제 문서가 "약 6,200만원",
// "약 5,700만원"처럼 쓰는 자리다(회귀예측값을 만원 단위까지 적으면 없는 정밀도를 주장하게 된다).
// 반대로 기준매출·차액은 계산이 확정적이라 formatManwon(만원 단위)을 그대로 쓴다.
export function formatManwonRough(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${(Math.round(value / 1_000_000) * 100).toLocaleString("ko-KR")}만원`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toFixed(digits);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toLocaleString("ko-KR");
}

export function formatDateTime(value: number | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// YYYY-MM-DD를 보는 사람의 시간대로 만든다. toISOString()은 UTC라 한국시간 오전 0~9시에는
// 날짜가 하루 전으로 나온다(2026-09-11 08:23 KST에 저장한 값이 "2026-09-10"으로 보이던 문제).
export function formatDate(value: number | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
