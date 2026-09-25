// 주거 상권 반경 — **사람이 확인한 매장별 사실**을 실험실 전용 컬렉션 `storeEvalLabResidentRadius`에 쓴다 (2026-09-24 밤, 사용자 결정).
//
// ── 무엇인가 ──────────────────────────────────────────────────────────────
// 기준(사용자): **"2km 안에 다른 PC방 상권(묶음)이 자리잡혀 있나."** 없으면 주거 원을 2km 누적 인구로 넓히고(residentRadiusM 2000),
// 있으면 1km 그대로(문서를 안 만든다). 고리(별도 점유율·감쇠)가 아니라 **원 자체를 넓히는 것**이다 — textbookModel `residentRadiusM`.
//   확실: 양주덕정(옥정신도시 2km 안 다른 PC방 상권 없음, 1~2km 사람은 우리 상권밖에 없다) · 영월(후보지) · 진주혁신도시(지도 확인)
//   문경: 사용자 "줄 만하지만 결과를 알고 넣은 것" — 순환 자백. 그래도 사용자 지시로 넣되 note에 그대로 적는다.
//   못 줌(문서 없음): 구미산동(아래 상권 PC방 몰림) · 호구포역(옆 상권) · 야당 · 송도 · 김포구래 — 옆 상권에 PC방이 자리잡혀 있다.
// 경쟁점 모양으로는 못 가른다 — 같은 모양 6곳에 2km를 일괄로 걸면 4곳이 +13~+34%p 터진다(`_labCandidate` (16)). AI 지도 판정은
// 구미산동·양주덕정을 둘 다 반대로 봤다. 그래서 자동화하지 않고 여기 손으로 적는다.
//
// ── 왜 실험실 전용인가 ────────────────────────────────────────────────────
// 실험실 산식만 읽는다. 운영 V62는 모른다(운영 V62 금지). 운영 기존점 문서에 넣으면 나중에 운영이 조용히 읽게 될 수 있어 따로 둔다
// (고리 인구·막힌 상권 판정과 같은 결정 — `storeEvalLab*`). syncLabCollections.mjs가 안 건드린다.
//
// ── 문서 모양 ─────────────────────────────────────────────────────────────
//   id = "existing:<매장코드>" | "candidate:<후보지코드>"
//   { key, kind, code, name, residentRadiusM(1500|2000), note(근거 — 없으면 화면·하네스가 안 싣는다), confirmedBy, confirmedAt, updatedAt }
//
// ⚠️ 이 값은 계수가 아니라 자료다. 적중률을 보고 반경을 고르지 말 것 — 근거(note)는 현장 사실이어야 한다.
//
//   node scripts/writeLabResidentRadius.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeLabResidentRadius.mjs --apply   # 실제로 쓴다(달라진 문서만)
//   그 다음: node scripts/dumpValidationSnapshot.mjs   # 하네스가 화면과 같은 자료를 읽게

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const COLLECTION = "storeEvalLabResidentRadius";
const APPLY = process.argv.includes("--apply");
const CONFIRMED_BY = "사용자(점포개발) 2026-09-24 밤 — 지도 확인";
const CONFIRMED_AT = "2026-09-24";

/** 사람이 확인한 사실. 값·근거를 여기 적는다 — 새 매장은 줄을 추가한다. */
const FACTS = [
  { kind: "existing", code: "20231019404", name: "양주덕정점", residentRadiusM: 2000,
    note: "300m 안 경쟁 3곳 빼면 2km 안 다른 PC방 상권 없음. 1~2km 옥정신도시 배후지 사람은 우리 상권밖에 선택지가 없어 온다(1.6km까지). 확실." },
  // 문경시청점(20240530413) 2km — 2026-09-25 저녁 사용자 결정으로 **되돌림**(scripts/revertLabResidentRadius20260925.mjs). 1.4~1.5km에 경쟁 4곳이 있어
  // "2km 안 다른 PC방 상권 없음" 규칙에 안 맞았고, 09-24에 '결과 알고 넣은 것'이라 자백한 예외였다. 이 목록에 다시 넣지 말 것.
  { kind: "existing", code: "20260626435", name: "진주혁신도시본점", residentRadiusM: 2000,
    note: "지도 확인: 혁신도시 2km 안 다른 PC방 상권 없음(사용자 2026-09-24 밤, 처음엔 '다른 상권 있음'이라 했다가 지도 보고 정정). 완료월 2개월이라 실측이 아직 움직인다." },
  { kind: "candidate", code: "N014", name: "영월점", residentRadiusM: 2000,
    note: "소도시. 2km 안 다른 PC방 상권 없음(사용자 확인). 1~2km 경쟁 0곳." },
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
if (!clientEmail || !privateKey || !projectId) {
  console.error(".env.local에 FIREBASE_CLIENT_EMAIL · FIREBASE_PRIVATE_KEY · NEXT_PUBLIC_FIREBASE_PROJECT_ID가 필요하다.");
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

// 매장·후보지가 실제로 있는지 먼저 본다 — 없는 코드에 사실을 적지 않는다.
const [stores, cands] = await Promise.all([db.collection("storeEvalLabExistingStores").get(), db.collection("storeEvalLabCandidates").get()]);
const storeNames = new Map(stores.docs.map((d) => [String(d.get("storeCode") ?? d.id), d.get("storeName")]));
const candNames = new Map(cands.docs.map((d) => [String(d.get("code") ?? d.id), d.get("name")]));

const plan = [];
for (const f of FACTS) {
  const known = f.kind === "existing" ? storeNames.get(f.code) : candNames.get(f.code);
  if (!known) { console.log(`✗ ${f.name}(${f.code}) — 실험실 복제본에 없다. 건너뜀`); continue; }
  if (known !== f.name) console.log(`⚠️ ${f.code} 이름이 다르다: 복제본 '${known}' vs 목록 '${f.name}' — 코드 기준으로 진행`);
  if (!(f.residentRadiusM === 1500 || f.residentRadiusM === 2000)) { console.log(`✗ ${f.name} 반경 ${f.residentRadiusM}은 허용값(1500·2000)이 아니다. 건너뜀`); continue; }
  if (!f.note?.trim()) { console.log(`✗ ${f.name} 근거(note)가 비었다 — 근거 없는 반경은 싣지 않는다. 건너뜀`); continue; }
  plan.push({ id: `${f.kind}:${f.code}`, doc: { key: `${f.kind}:${f.code}`, kind: f.kind, code: f.code, name: known, residentRadiusM: f.residentRadiusM, note: f.note, confirmedBy: CONFIRMED_BY, confirmedAt: CONFIRMED_AT } });
}

const current = await loadCollectionMap(db, COLLECTION);
for (const p of plan) p.changed = needsWrite(current.get(p.id), p.doc, { merge: false });
const toWrite = plan.filter((p) => p.changed);
console.log(`\n대상 ${plan.length}곳 · 값이 달라진 곳 ${toWrite.length}곳 · 컬렉션에 이미 ${current.size}건`);
for (const p of plan) console.log(`  ${p.changed ? "→" : "="} ${p.doc.name.padEnd(10)} ${p.doc.residentRadiusM}m  ${p.doc.note.slice(0, 60)}${p.doc.note.length > 60 ? "…" : ""}`);
const extra = [...current.keys()].filter((k) => !plan.some((p) => p.id === k));
if (extra.length) console.log(`  ⚠️ 목록에 없는데 컬렉션에 있는 문서 ${extra.length}건(안 지운다 — 파일 삭제 금지 규칙과 같은 뜻): ${extra.join(", ")}`);
if (!APPLY) { console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다."); process.exit(0); }
let written = 0;
for (const p of toWrite) { await db.collection(COLLECTION).doc(p.id).set({ ...p.doc, updatedAt: Date.now() }); written++; }
console.log(`\n${written}곳에 썼다 -> ${COLLECTION}. 다음: node scripts/dumpValidationSnapshot.mjs`);
process.exit(0);
