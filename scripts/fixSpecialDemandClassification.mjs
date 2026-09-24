// 특수수요 오분류 두 건을 바로잡는다 (2026-09-24 집 PC, 사용자 지시).
//
// ── 무엇을 고치나 ──────────────────────────────────────────────────────────
//   1. 오송점(N016) 입지평가: specialDemandType 대학가 → **기타**. 강도 보통은 그대로.
//      AI 초안이 "대학가/보통"으로 넣었는데 초안 메모 스스로 "학부 중심이 아니므로"라고 적었다. 약대·보건의료 행정타운·연구단지는
//      학부 대학가(전남대·청주대·부경대·울산대 — 재학생 수만 명, 원룸촌 배후지)와 같은 분류가 아니다.
//      사용자: *"여기 약간 의료대학이라 일반대학이랑 같은분류로 보기 어렵지않나?"*
//      ⚠️ '산업단지'로 바꾸지 않는다 — 운영 V62의 배후수요 더미(군부대·산업단지)가 켜져 V62 매출이 바뀐다. '기타'는 V62에 영향 없다.
//   2. 전대상대점(20240126408) 입지평가: specialDemandIntensity 높음 → **보통**.
//      기존점 문서는 보통인데 입지평가만 2026-09-02 "실측 백테스트 보정"이 높음으로 올렸다 — 실측에 맞추려 강도를 올린 수동보정이라
//      원래 값으로 되돌린다. 강도 문(textbookModel.specialDemandHighOnly) 아래에서 전대상대는 배수를 안 타고 −0.9%p가 된다(켜면 +5.8).
//
// 운영 컬렉션(storeEvalLocationEvaluations)에 쓰고, 실험실 복제본은 scripts/syncLabCollections.mjs --only=locationEvaluations로 옮긴다.
// 범위: **두 문서, 각 한 필드**만. 다른 필드는 건드리지 않는다.
//
//   node scripts/fixSpecialDemandClassification.mjs          # 미리보기
//   node scripts/fixSpecialDemandClassification.mjs --apply  # 실제로 쓴다

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = "storeEvalLocationEvaluations";
const APPLY = process.argv.includes("--apply");
const UPDATED_BY = "사용자 지시 2026-09-24 — 특수수요 오분류 정정(scripts/fixSpecialDemandClassification.mjs)";

const FIXES = [
  { code: "N016", name: "오송점", field: "specialDemandType", expectBefore: "대학가", after: "기타" },
  { code: "20240126408", name: "전대상대점", field: "specialDemandIntensity", expectBefore: "높음", after: "보통" },
];

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
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
if (!clientEmail || !privateKey || !projectId) {
  console.error(".env.local에 FIREBASE_CLIENT_EMAIL · FIREBASE_PRIVATE_KEY · NEXT_PUBLIC_FIREBASE_PROJECT_ID가 필요하다.");
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

let changed = 0;
for (const f of FIXES) {
  const ref = db.collection(COLLECTION).doc(f.code);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`✗ ${f.name}(${f.code}) 문서가 없다 — 건너뜀`); continue; }
  const before = snap.get(f.field) ?? null;
  const type = snap.get("specialDemandType") ?? null, intensity = snap.get("specialDemandIntensity") ?? null, by = snap.get("updatedBy") ?? null;
  console.log(`${f.name}(${f.code})  지금: ${type}/${intensity}  (updatedBy: ${by})`);
  if (before === f.after) { console.log(`  = 이미 ${f.after} — 건너뜀`); continue; }
  if (before !== f.expectBefore) { console.log(`  ⚠️ ${f.field}가 예상(${f.expectBefore})과 다르다: ${before} — 건너뜀(직접 확인할 것)`); continue; }
  console.log(`  ${f.field}: ${before} → ${f.after}${APPLY ? "  (쓴다)" : "  (미리보기 — --apply로 쓴다)"}`);
  if (APPLY) {
    await ref.update({ [f.field]: f.after, updatedBy: UPDATED_BY, updatedAt: Date.now() });
    changed += 1;
  }
}
console.log(APPLY ? `\n${changed}건 썼다. 다음: node scripts/syncLabCollections.mjs --apply --only=locationEvaluations` : "\n미리보기만 했다.");
