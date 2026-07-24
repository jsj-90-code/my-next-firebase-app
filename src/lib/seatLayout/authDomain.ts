// 좌석배치도 툴 접속을 허용할 회사 구글 워크스페이스 도메인.
// firestore.rules / API 라우트에도 같은 값을 그대로 맞춰서 하드코딩해두었다
// (규칙 파일은 이 상수를 import할 수 없어서 값을 동기화해서 관리해야 한다).
export const ALLOWED_EMAIL_DOMAIN = "isens.camp";

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}
