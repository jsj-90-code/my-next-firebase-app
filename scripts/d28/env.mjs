// D28 계산 스크립트 공용: .env.local 읽기 + Firebase(읽기 전용으로만 씀) + 사내 저장소 도우미.
// 값은 절대 출력하지 않는다.
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();

export function db() {
  const BS = String.fromCharCode(92);
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });
  return getFirestore(app);
}

export const has = (k) => Boolean(process.env[k]);
