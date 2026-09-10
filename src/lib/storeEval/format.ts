// 화면 전체에서 공유하는 표시 포맷 함수. 금액은 원 단위 + 천단위 쉼표, 비율/점수는 단위를 붙인다.

export function formatWon(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
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
