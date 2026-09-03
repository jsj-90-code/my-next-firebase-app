import "server-only";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";

/** Firebase ID 토큰과 회사 이메일 도메인을 서버에서 함께 검증한다. */
export async function getVerifiedCompanyUser(request: Request): Promise<DecodedIdToken | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !adminAuth) return null;

  try {
    const user = await adminAuth.verifyIdToken(token);
    return user.email_verified === true && isAllowedEmail(user.email) ? user : null;
  } catch {
    return null;
  }
}
