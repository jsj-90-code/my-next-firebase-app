// 막힌 상권 AI 판정(.local-tools/trade-area-judgments.json)을 실험실 전용 컬렉션 storeEvalLabTradeAreaJudgments에 쓴다.
//
//   node scripts/tradeArea/writeTradeAreaJudgmentsToFirestore.mjs           # 미리보기
//   node scripts/tradeArea/writeTradeAreaJudgmentsToFirestore.mjs --apply   # 실제로 쓴다(달라진 문서만)
//
// ⚠️ 사람 표본 대조가 끝난 뒤에 돌린다. 원본 답(방향별 예/아니오·근거)을 그대로 남기고 blockedCount만 산식이 읽는다.
//    문서 id = "existing:<매장코드>" | "candidate:<후보지코드>". 운영 V62는 이 컬렉션을 모른다.
import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "../lib/diffWrite.mjs";

const DATA = ".local-tools/trade-area-judgments.json";
const COLLECTION = "storeEvalLabTradeAreaJudgments";
const APPLY = process.argv.includes("--apply");

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
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
if (!clientEmail || !privateKey || !projectId) { console.error("FIREBASE_* 환경변수가 필요하다."); process.exit(1); }
if (!existsSync(DATA)) { console.error(`${DATA}이 없다. 먼저 judge.mjs를 돌린다.`); process.exit(1); }

const file = JSON.parse(readFileSync(DATA, "utf8"));
const plan = [], skipped = [];
for (const s of Object.values(file.sites ?? {})) {
  if (s.error || s.blockedCount == null) { skipped.push(`${s.key} ${s.name} — 판정 실패/없음`); continue; }
  plan.push({
    id: s.key,
    doc: {
      key: s.key, kind: s.kind, code: String(s.code), name: s.name ?? null,
      blocked: s.blocked ?? null, blockedBy: s.blockedBy ?? null, blockedCount: s.blockedCount,
      // 산식이 읽는 값 — 2차(사용자 정의): 고리에 주거 없는 방향 수
      residential: s.residential ?? null, residentialNote: s.residentialNote ?? null,
      ringCutCount: s.ringCutCount ?? s.noResidentialCount ?? null, ringCutBasis: s.ringCutBasis ?? null,
      otherCommercialWithin2km: s.otherCommercialWithin2km ?? null, otherCommercialNote: s.otherCommercialNote ?? null,
      aptBlock: s.aptBlock ?? null, note: s.note ?? null,
      judgedAt: s.judgedAt ?? null, model: s.model ?? file.model ?? null,
      method: "카카오 지도 반경 2km 캡처 + AI 방향별 단절 예/아니오 사실 판정 (사람 표본 대조 후 저장)",
    },
  });
}
const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
const current = await loadCollectionMap(db, COLLECTION);
const flat = (d) => ({ ...d, blocked: JSON.stringify(d.blocked), blockedBy: JSON.stringify(d.blockedBy), residential: JSON.stringify(d.residential), residentialNote: JSON.stringify(d.residentialNote) });
for (const p of plan) { const c = current.get(p.id); p.changed = needsWrite(c ? flat(c) : undefined, flat(p.doc), { merge: false }); }
const toWrite = plan.filter((p) => p.changed);
console.log(`\n대상 ${plan.length}곳 · 값이 달라진 곳 ${toWrite.length}곳 · 건너뜀 ${skipped.length}건 · 컬렉션에 이미 ${current.size}건`);
for (const s of skipped) console.log(`  · ${s}`);
const hist = [0, 1, 2, 3, 4].map((k) => `${k}방향 ${plan.filter((p) => p.doc.blockedCount === k).length}`).join(" · ");
console.log(`막힌 방향 수 분포: ${hist}`);
if (!APPLY) { console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다."); process.exit(0); }
let written = 0;
for (const p of toWrite) { await db.collection(COLLECTION).doc(p.id).set({ ...p.doc, updatedAt: Date.now() }); written++; }
console.log(`\n${written}곳에 썼다 -> ${COLLECTION}`);
console.log("useRingEnclosure가 꺼져 있으면 예측은 안 바뀐다. 화면·하네스가 값을 읽을 수 있게 된 것뿐이다.");
process.exit(0);
