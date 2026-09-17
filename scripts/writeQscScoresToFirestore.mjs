// fcdaum QSC 점검 점수 -> `storeEvalLabQscScores` (실험실 전용).
//
//   node scripts/writeQscScoresToFirestore.mjs           # 미리보기(쓰지 않는다)
//   node scripts/writeQscScoresToFirestore.mjs --apply
//
// ── 무엇을 쓰나 ────────────────────────────────────────────────────────────
// 매장마다 **평가창(개점 다음 달~12개월) 안 점검의 평균** 하나다. 이 값이 실험실에서
// 관리 점수로 환산된다(labInput.ts qscToManagementScore: 100점->5점 · 80점->1점).
//
// 걸러내는 기록 둘 (2026-09-17 사용자 확인: "0점·오픈점검 둘 다 제외"):
//   - 0점: 송도점은 개점 0개월(오픈 2주 차), 창원남양점은 다른 점검이 전부 90점대다.
//          미실시나 입력오류지 "관리가 0점"이 아니다.
//   - `블랙라벨PC존 오픈 매장 점검`: 오픈 직후 체크리스트라 **재는 것이 다르다.**
// ⚠️ 이 셋을 안 빼면 관문이 미달이다(대조군 p=0.070/0.052 -> 걸러낸 뒤 0.040/0.050).
//
// ── 왜 전용 컬렉션인가 ─────────────────────────────────────────────────────
// 매장 문서에 필드로 붙이면 syncLabCollections.mjs가 운영 문서로 덮을 때 날아간다.
// 로드뷰 판정(storeEvalLabRoadviewJudgments)과 같은 이유·같은 방식이다.
// **운영 V62는 이 컬렉션을 아예 읽지 않는다** — 실험실 전용이다.
//
// 원자료: `.local-tools/qsc-scores.json` (gitignore — 매장별 전체 점검 이력이라 매출은 없지만
// 재수집에 로그인이 필요하다. 만드는 법은 인계 문서 6절).
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

// .env.local의 키는 한 줄에 "\n" 이스케이프로 들어 있다. 정규식 대신 split/join을 쓴다 —
// 셸 heredoc으로 이 파일을 쓰면 백슬래시가 먹혀 조용히 깨진다(2026-09-15에 실제로 겪음).
const BS = String.fromCharCode(92);
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가 .env.local에 필요합니다.");
  process.exit(1);
}
if (projectId !== "my-next-firebase-app-541f4") {
  console.error(`예상치 못한 프로젝트: ${projectId}`);
  process.exit(1);
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const SRC = ".local-tools/qsc-scores.json";
let raw;
try {
  raw = JSON.parse(readFileSync(SRC, "utf8"));
} catch {
  console.error(`${SRC}가 없다. 인계 문서 6절의 재수집 방법을 볼 것.`);
  process.exit(1);
}

const usable = (r) => r.score > 0 && !String(r.form ?? "").includes("오픈 매장 점검");

const COLLECTION = "storeEvalLabQscScores";
const rows = [];
for (const [key, site] of Object.entries(raw.sites ?? {})) {
  const storeCode = key.startsWith("existing:") ? key.slice("existing:".length) : key;
  const records = site.records ?? [];
  if (!records.length || !site.openedAt) continue;
  const open = new Date(site.openedAt);
  if (Number.isNaN(open.getTime())) continue;
  const kept = records.filter(usable);
  const inWindow = kept.filter((r) => {
    const d = new Date(String(r.date).split(".").join("-"));
    if (Number.isNaN(d.getTime())) return false;
    const m = (d.getFullYear() - open.getFullYear()) * 12 + (d.getMonth() - open.getMonth());
    return m >= 1 && m <= 12;
  });
  if (!inWindow.length) continue;
  const avg = inWindow.reduce((a, r) => a + r.score, 0) / inWindow.length;
  rows.push({
    storeCode,
    storeName: site.name ?? null,
    openedAt: site.openedAt,
    inWindowAvg: Math.round(avg * 100) / 100,
    inWindowCount: inWindow.length,
    droppedCount: records.length - kept.length,
    source: raw.source ?? "fcdaum.com",
    collectedAt: raw.collectedAt ?? null,
  });
}

const existing = await db.collection(COLLECTION).get();
const before = new Map(existing.docs.map((d) => [d.id, d.data()]));
rows.sort((a, b) => a.storeCode.localeCompare(b.storeCode));

const mgmt = (q) => Math.max(1, Math.min(5, 1 + (q - 80) * (4 / 20)));
console.log(`원자료 ${Object.keys(raw.sites ?? {}).length}곳 -> 평가창 안 점검이 있는 ${rows.length}곳`);
console.log(`${"매장".padEnd(14)}${"QSC평균".padStart(8)}${"관리점수".padStart(9)}${"점검수".padStart(7)}${"버린기록".padStart(9)}`);
for (const r of rows) {
  console.log(`${String(r.storeName ?? r.storeCode).slice(0, 13).padEnd(14)}${r.inWindowAvg.toFixed(2).padStart(8)}${mgmt(r.inWindowAvg).toFixed(2).padStart(9)}${String(r.inWindowCount).padStart(7)}${String(r.droppedCount || "").padStart(9)}`);
}
const avgMgmt = rows.reduce((a, r) => a + mgmt(r.inWindowAvg), 0) / rows.length;
console.log(`\n관리 점수 평균 ${avgMgmt.toFixed(2)} · 범위 ${Math.min(...rows.map((r) => mgmt(r.inWindowAvg))).toFixed(2)}~${Math.max(...rows.map((r) => mgmt(r.inWindowAvg))).toFixed(2)}`);
console.log(`(QSC 없는 매장과 후보지에는 이 평균이 들어간다 — 두 자가 섞이지 않게)`);
console.log(`\n실험실 컬렉션 ${COLLECTION}: 기존 ${before.size}건 -> 쓸 것 ${rows.length}건`);

if (!process.argv.includes("--apply")) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다.");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < rows.length; i += 400) {
  const batch = db.batch();
  for (const r of rows.slice(i, i + 400)) {
    batch.set(db.doc(`${COLLECTION}/${r.storeCode}`), r);
    written++;
  }
  await batch.commit();
}
// 원자료에서 사라진 매장은 지운다 — 남겨두면 없는 점검이 계속 점수를 만든다.
const keep = new Set(rows.map((r) => r.storeCode));
const stale = [...before.keys()].filter((id) => !keep.has(id));
for (const id of stale) await db.doc(`${COLLECTION}/${id}`).delete();
console.log(`\n${written}건 썼다${stale.length ? ` · 낡은 ${stale.length}건 지웠다` : ""}.`);
console.log("운영 V62는 이 컬렉션을 읽지 않는다 — 예상매출에 영향 없다.");
