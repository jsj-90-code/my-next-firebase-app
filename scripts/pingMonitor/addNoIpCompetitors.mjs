// 점포평가 경쟁점 중 측정기에 없는 것을 "IP 미등록" 빈칸으로 넣는다(2026-10-06 사용자 "기존점의 경쟁점을 일단 다 넣어주고, 빈곳은 빈곳으로").
// 기존점 경쟁점만(후보지 제외). "경쟁점 없음(독점상권 확인)" 표시용 문서는 뺀다. 같은 매장·같은 거리의 중복 문서(라이즈/라이즈(3POP))는 하나만.
// 측정기에 점포평가와 안 이어진 등록이 대수가 같게 있으면 같은 매장일 수 있다고 메모에 남긴다.
//   node scripts/pingMonitor/addNoIpCompetitors.mjs [--apply]   (입력: .local-tools/validation-snapshot.json)
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/g, "\n") }) });
const db = getFirestore();
const snap = JSON.parse(readFileSync(".local-tools/validation-snapshot.json", "utf8"));
const ping = (await db.collection("pingMonitorStores").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const linked = new Set(ping.map((p) => p.competitorId).filter(Boolean));
const base = (n) => String(n).toLowerCase().replace(/\(.*?\)|\s|pc방|pc|피씨방|피시방/g, "");

const todo = [];
for (const s of snap.existingStores) {
  const comps = snap.competitors.filter((c) => c.candidateCode === s.storeCode && !/^경쟁점 없음/.test(c.name));
  const linkedHere = comps.filter((c) => linked.has(c.id));
  const seen = new Set();
  for (const c of comps) {
    if (linked.has(c.id)) continue;
    // 같은 거리·비슷한 이름의 문서가 이미 이어져 있으면(크루PC방 ↔ 크루PC방(옵티멈)) 같은 매장
    if (linkedHere.some((l) => l.distanceM === c.distanceM && (base(l.name).includes(base(c.name)) || base(c.name).includes(base(l.name))))) continue;
    const key = `${c.distanceM}|${base(c.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pc = c.totalPcCount ?? c.appliedPcCount ?? null;
    const maybe = ping.filter((p) => p.ownCode === s.storeCode && !p.competitorId && pc && (p.pcCount ?? p.ipCount) === pc);
    todo.push({
      ownCode: s.storeCode, ownName: s.storeName, name: c.name, address: c.address ?? "", pcCount: pc, distanceM: c.distanceM ?? null, competitorId: c.id,
      memo: `점포평가 경쟁점 · IP 미등록${maybe.length ? ` · 측정기의 "${maybe.map((p) => p.name).join(", ")}"(같은 ${pc}대)과 같은 매장일 수 있음` : ""}`,
    });
  }
}
console.log(`넣을 빈칸 ${todo.length}곳 (기존점 ${new Set(todo.map((t) => t.ownCode)).size}곳)`);
for (const t of todo.filter((t) => /같은 매장/.test(t.memo))) console.log("  ", t.ownName, t.name, "—", t.memo);
if (!APPLY) { console.log("(미리보기 — --apply로 쓴다)"); process.exit(0); }
const batch = db.batch();
for (const t of todo) batch.set(db.collection("pingMonitorStores").doc(), {
  ...t, ipRanges: "", ipCount: 0, active: true,
  createdAt: FieldValue.serverTimestamp(), createdBy: "import:addNoIpCompetitors", updatedAt: FieldValue.serverTimestamp(), updatedBy: null,
});
await batch.commit();
console.log(`${todo.length}곳 썼다.`);
