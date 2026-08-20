import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function createAdminApp(): App | null {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return getApps().length > 0
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const adminApp = createAdminApp();

export const adminAuth = adminApp ? getAuth(adminApp) : null;
// 보안규칙을 우회하는 서버 전용 Firestore 클라이언트 - 로그인 세션이 없는 Cron 작업 등에서 쓴다.
export const adminDb = adminApp ? getFirestore(adminApp) : null;
