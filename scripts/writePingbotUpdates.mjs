// 핑봇 재조회 값을 운영 경쟁점 문서(storeEvalCompetitors)에 쓴다 (2026-09-24 밤, 사용자가 채팅으로 준 값).
//
//   node scripts/writePingbotUpdates.mjs --period=2026-09-15~2026-09-21           # 미리보기
//   node scripts/writePingbotUpdates.mjs --period=2026-09-15~2026-09-21 --apply   # 실제로 쓴다
//   그 다음: node scripts/syncLabCollections.mjs --apply --only=competitors && node scripts/dumpValidationSnapshot.mjs
//
// 매칭은 candidateCode + name(공백 제거, 대소문자 무시)이다 — 문서 id의 N00x 접두는 옛 번호가 남은 곳이 있어 안 쓴다.
// 옛 값은 pingbotPrev{Utilization,Period}에 남긴다 — 덮어쓰기 전 값이 docs/pingbot-request-20260924.md에도 있다.
// ⚠️ 여기 목록에 없는 문서는 건드리지 않는다. 값이 같으면 안 쓴다.

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = "storeEvalCompetitors";
const APPLY = process.argv.includes("--apply");
const periodArg = process.argv.find((a) => a.startsWith("--period="));
const PERIOD = periodArg ? periodArg.slice("--period=".length) : null;
if (!PERIOD || !/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(PERIOD)) {
  console.error("--period=YYYY-MM-DD~YYYY-MM-DD 가 필요하다(핑봇 조회 창). 예: --period=2026-09-15~2026-09-21");
  process.exit(1);
}

/** 사용자가 준 값(%). 매장 candidateCode + 경쟁점 이름. */
const UPDATES = [
  // 울산삼산점(N005) — 사용자 2026-09-24 밤. 옛 값(기간 '21'): 52.1 / 30.4 / 24.6 / 28.1
  { candidateCode: "N005", name: "레벨업PC방 울산삼산점", value: 34.7 },
  { candidateCode: "N005", name: "레드포스PC아레나 삼산점", value: 22.3 },
  { candidateCode: "N005", name: "탑스타PC 울산삼산점", value: 19.1 },
  { candidateCode: "N005", name: "피에스타스토리 PC CAFE", value: 17.9 },
];

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return; }
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
const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) { console.error(".env.local에 FIREBASE_CLIENT_EMAIL · FIREBASE_PRIVATE_KEY · NEXT_PUBLIC_FIREBASE_PROJECT_ID가 필요하다."); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
const snap = await db.collection(COLLECTION).get();
const docs = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));

let changed = 0;
for (const u of UPDATES) {
  const hits = docs.filter((d) => d.candidateCode === u.candidateCode && norm(d.name) === norm(u.name));
  if (hits.length !== 1) { console.log(`✗ ${u.candidateCode} ${u.name} — 문서 ${hits.length}건 매칭(정확히 1이어야) ${hits.map((h) => h.id).join(", ")}`); continue; }
  const d = hits[0];
  const before = d.pingbotUtilization ?? null, beforeP = d.pingbotPeriod ?? null;
  const same = before === u.value && beforeP === PERIOD;
  console.log(`${same ? "=" : "→"} ${u.name.padEnd(22)} ${String(before).padStart(5)}% [${beforeP ?? "없음"}]  →  ${u.value}% [${PERIOD}]   (${d.id})`);
  if (same || !APPLY) continue;
  await d.ref.update({
    pingbotUtilization: u.value, pingbotPeriod: PERIOD,
    pingbotPrevUtilization: before, pingbotPrevPeriod: beforeP,
    updatedAt: Date.now(), updatedBy: `핑봇 재조회 ${PERIOD} (scripts/writePingbotUpdates.mjs, 사용자 제공)`,
  });
  changed += 1;
}
console.log(APPLY ? `\n${changed}건 썼다. 다음: node scripts/syncLabCollections.mjs --apply --only=competitors && node scripts/dumpValidationSnapshot.mjs` : "\n미리보기만 했다(--apply로 쓴다).");
process.exit(0);
