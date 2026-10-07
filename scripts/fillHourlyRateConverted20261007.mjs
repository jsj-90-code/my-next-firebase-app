// 경쟁점 시간당환산요금 빈칸 채우기 (2026-10-07, 사용자 "시간당환산요금 비어있는거 너가 다 대신 좀 넣어줘").
//
// 시간당환산요금(hourlyRateConverted)은 1000원당분(ratePer1000Won)에서 나오는 값이다 — 경쟁점 폼 칸과 붙여넣기와 같은 식
// Math.round(60000 / 분). 폼에서 분을 손으로 칠 때만 채워져 빈칸이 쌓였다(커밋 8b7386c에서 붙여넣기도 채우게 고침).
// 산식(V62·실험실)은 이 칸을 안 쓴다 — 쓰는 곳은 판정 신호 "계획 요금이 경쟁점 평균보다 높습니다"(reviewSignals.ts)와 입력 점검뿐.
//
// 1000원당분이 있고 시간당환산요금이 비어 있는 경쟁점만 채운다. 이미 값이 있는 칸은 건드리지 않는다.
// ⚠️ 기존점(가맹점) 경쟁점은 매일 06:00 크론(cronSync.ts)이 구글시트 05_경쟁점정보 "시간당환산요금" 칸으로 덮어쓴다 —
//    시트가 비어 있으면 다음 날 다시 빈칸이 된다. 그래서 기본은 후보지(N코드) 경쟁점만 채우고, 기존점은 목록만 보여준다.
//    시트를 먼저 채웠으면(scripts/fillSheetHourlyRateConverted20261007.mjs) --include-existing으로 기존점도 같은 값을 바로 넣는다
//    (크론이 옮겨 올 값과 같아 덮어써도 그대로 — 화면에 내일 아침까지 빈칸으로 안 보이게).
//
//   node scripts/fillHourlyRateConverted20261007.mjs          # 미리보기
//   node scripts/fillHourlyRateConverted20261007.mjs --apply  # 실제로 쓴다
//   node scripts/fillHourlyRateConverted20261007.mjs --apply --include-existing  # 시트 채운 뒤 기존점까지
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const INCLUDE_EXISTING = process.argv.includes("--include-existing");
const UPDATED_BY = "사용자 요청 2026-10-07 — 시간당환산요금 빈칸을 1000원당분으로 채움(scripts/fillHourlyRateConverted20261007.mjs)";

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
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

const isCandidate = (code) => /^N\d/.test(String(code ?? ""));
const snap = await db.collection("storeEvalCompetitors").get();
const targets = [];
const existingStoreBlank = [];
let blankNoMinutes = 0;
for (const doc of snap.docs) {
  const d = doc.data();
  if (d.hourlyRateConverted != null) continue;
  const min = typeof d.ratePer1000Won === "number" ? d.ratePer1000Won : null;
  if (min == null || min <= 0) { blankNoMinutes += 1; continue; }
  const row = { ref: doc.ref, code: d.candidateCode ?? "", name: d.name ?? doc.id, min, hourly: Math.round(60000 / min) };
  (isCandidate(row.code) || INCLUDE_EXISTING ? targets : existingStoreBlank).push(row);
}

targets.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
console.log(`경쟁점 ${snap.size}곳 중 시간당환산요금 빈칸 · 1000원당분 있음 — 채울 곳 ${targets.length}곳${INCLUDE_EXISTING ? "(기존점 포함)" : "(후보지)"} · 기존점 ${existingStoreBlank.length}곳 (시트 몫)`);
console.log(`빈칸인데 1000원당분도 없어 계산 못 함: ${blankNoMinutes}곳\n`);
for (const t of targets) {
  const odd = t.min < 20 || t.min > 120 ? "  ⚠️ 분이 이상함 — 확인" : "";
  console.log(`  ${t.code.padEnd(5)} ${t.name.padEnd(16)} 1000원당 ${String(t.min).padStart(3)}분 → ${t.hourly.toLocaleString("ko-KR")}원/h${odd}`);
}
if (existingStoreBlank.length > 0) {
  console.log(`\n[기존점 경쟁점 — 크론이 시트 값으로 덮으므로 여기선 안 씀. 구글시트 05_경쟁점정보 "시간당환산요금"에 넣어야 남는다]`);
  for (const t of existingStoreBlank) console.log(`  ${String(t.code).padEnd(12)} ${t.name.padEnd(16)} ${t.min}분 → ${t.hourly}원/h`);
}

if (APPLY) {
  const now = Date.now();
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const t of targets.slice(i, i + 400)) batch.update(t.ref, { hourlyRateConverted: t.hourly, updatedBy: UPDATED_BY, updatedAt: now });
    await batch.commit();
  }
  console.log(`\n${targets.length}건 썼다.`);
} else {
  console.log("\n미리보기만 했다(--apply로 쓴다).");
}
process.exit(0);
