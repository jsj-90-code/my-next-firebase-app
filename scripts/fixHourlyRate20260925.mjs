// 기존점 hourlyRate 정의 통일 — "회원 기본 시간당 요금"(키오스크 정액권 중 가장 작은 권종의 시간당 단가) (2026-09-25 저녁, 사용자 결정 — 인계 5번 "하자").
//
// hourlyRate가 뭔가: 기존점 문서(storeEvalExistingStores)의 시간당 PC 요금(원). 산식 둘 다 이 값으로 PC몫을 만든다 —
//   운영 V62: log(hourlyRate) 피처 + effectiveHourlyRate(usageRevenue.ts) · 실험실: PC몫 = 1,343 × (hourlyRate/1,343)^0.546.
//   후보지는 키오스크 기본요금(회원 기본 시간당 요금)밖에 모르므로, 기존점도 같은 뜻이어야 한 자로 잰 것이 된다.
//   원본은 구글시트 01_점포기본정보 "요금표_시간당원" 칸(scripts/migrateFullExistingStoreProfiles.mjs가 옮김)인데 뜻이 특정돼 있지 않았고,
//   2026-09-25 키오스크 사진(src/lib/storeEval/data/tariffTables.json)과 대보니 8곳이 다르다(광주각화 1,700 vs 1,200 등).
//
// ⚠️ 매일 크론(cronSync.ts)은 기존점 hourlyRate를 안 건드린다(후보지만 null로 만든다). 단 migrateFullExistingStoreProfiles.mjs를 다시 돌리면
//    시트 값으로 되돌아가니, 시트 "요금표_시간당원"도 같은 값으로 고쳐 두는 게 맞다(사용자 몫).
// ⚠️ V62는 hourlyRate로 학습하므로 적용 뒤 V62 적중률이 움직인다 — storedAccuracyParity로 전후를 재고 06:00 크론 뒤 저장값 확인.
//
//   node scripts/fixHourlyRate20260925.mjs          # 미리보기
//   node scripts/fixHourlyRate20260925.mjs --apply  # 실제로 쓴다 → 다음: node scripts/syncLabCollections.mjs --apply --only=existingStores && node scripts/dumpValidationSnapshot.mjs
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const UPDATED_BY = "사용자 결정 2026-09-25 — hourlyRate = 회원 기본 시간당 요금(키오스크 최소 권종 단가)로 통일(scripts/fixHourlyRate20260925.mjs)";
// 키오스크 정액권 표(tariffTables.json)에서 가장 작은 권종의 시간당 단가. 화면 사진에 적힌 이용시간 기준.
const FIXES = [
  { code: "20241108419", name: "광주각화점", rate: 1200, why: "키오스크 3,000원/150분 = 1,200원/h (문서 1,700)" },
  { code: "20251121428", name: "발산역점", rate: 1500, why: "키오스크 3,000원/120분 = 1,500원/h (문서 1,600)" },
  { code: "20240517412", name: "수원망포점", rate: 1500, why: "키오스크 1,000원/40분 = 1,500원/h (문서 1,400)" },
  { code: "20240126408", name: "전대상대점", rate: 1200, why: "키오스크 3,000원/150분 = 1,200원/h (문서 1,300)" },
  { code: "20231215406", name: "전대후문점", rate: 1091, why: "키오스크 최소 권종 5,000원/275분 = 1,091원/h (문서 1,300)" },
  { code: "20250124422", name: "증평점", rate: 1500, why: "키오스크 최소 권종 10,000원/400분 = 1,500원/h (문서 1,400)" },
  { code: "20240607414", name: "탕정역점", rate: 1500, why: "키오스크 3,000원/120분 = 1,500원/h (문서 1,400)" },
  { code: "20260626435", name: "진주혁신도시본점", rate: 1500, why: "키오스크 3,000원/120분 = 1,500원/h (문서 1,600)" },
];

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

let changed = 0;
for (const f of FIXES) {
  const ref = db.collection("storeEvalExistingStores").doc(f.code);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`✗ ${f.name}(${f.code}) 문서 없음 — 건너뜀`); continue; }
  const cur = snap.get("hourlyRate") ?? null;
  const same = cur === f.rate;
  console.log(`${same ? "=" : "→"} ${f.name.padEnd(10)} hourlyRate ${cur} → ${f.rate}   ${f.why}`);
  if (same || !APPLY) continue;
  await ref.update({ hourlyRate: f.rate, hourlyRatePrev: cur, hourlyRateNote: f.why, hourlyRateDefinition: "회원 기본 시간당 요금(키오스크 최소 권종 단가)", updatedBy: UPDATED_BY, updatedAt: Date.now() });
  changed += 1;
}
console.log(APPLY ? `\n${changed}건 썼다. 다음: node scripts/syncLabCollections.mjs --apply --only=existingStores && node scripts/dumpValidationSnapshot.mjs` : "\n미리보기만 했다(--apply로 쓴다).");
process.exit(0);
