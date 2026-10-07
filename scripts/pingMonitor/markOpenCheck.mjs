// 경쟁점 가동률 측정기 — 사용자가 직접 확인한 영업 여부 기록 (2026-10-07, 사용자 "전체 매장 하나씩 봐볼게").
// checkClosed.mjs(카카오+대답 수)는 추정일 뿐이라, 사람이 확인한 결과를 측정기 문서 `openCheck`에 남긴다.
//   openCheck = { status: "영업" | "폐업" | "상호변경", at: "YYYY-MM-DD", by, note }
// 폐업이면 측정도 끈다(active=false — 지우지 않음, 기록은 남는다). 화면 보안규칙은 바뀐 칸만 보므로 새 칸이 화면 수정을 막지 않는다.
//   node scripts/pingMonitor/markOpenCheck.mjs --own=강릉교동 --status=영업                 ← 그 매장 경쟁점 전부(미리보기)
//   node scripts/pingMonitor/markOpenCheck.mjs --own=부천상동 --name=철구 --status=폐업 --apply
//   node scripts/pingMonitor/markOpenCheck.mjs --own=부천상동 --name=철구 --status=상호변경 "--rename=옵티멈존PC카페 상동역점 (전 철구)" --apply
// 폐업으로 적었다가 영업·상호변경으로 고치면 측정을 다시 켠다(2026-10-07 부천상동 철구 → 옵티멈존).
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const APPLY = process.argv.includes("--apply");
const OWN = arg("own"), NAME = arg("name"), STATUS = arg("status"), NOTE = arg("note"), RENAME = arg("rename");
if (!OWN || !["영업", "폐업", "상호변경"].includes(STATUS)) { console.error("--own=우리매장(일부) --status=영업|폐업|상호변경 [--name=경쟁점(일부)] [--note=] [--apply]"); process.exit(1); }

process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const docs = (await db.collection("pingMonitorStores").get()).docs.filter(
  (d) => !d.get("isOwnStore") && String(d.get("ownName") ?? "").includes(OWN) && (!NAME || String(d.get("name") ?? "").includes(NAME)),
);
if (docs.length === 0) { console.log("맞는 경쟁점 없음"); process.exit(1); }
for (const d of docs) {
  const prev = d.get("openCheck");
  console.log(`${d.get("ownName")} | ${d.get("name")} → ${STATUS}${STATUS === "폐업" ? " (측정 끔)" : prev?.status === "폐업" ? " (측정 다시 켬)" : ""}${RENAME ? ` · 이름 → ${RENAME}` : ""}${prev ? `  [이전: ${prev.status} ${prev.at}]` : ""}`);
  if (!APPLY) continue;
  await d.ref.update({
    openCheck: { status: STATUS, at: today, by: "사용자 확인", ...(NOTE ? { note: NOTE } : {}) },
    ...(STATUS === "폐업" ? { active: false } : prev?.status === "폐업" ? { active: true } : {}),
    ...(RENAME ? { name: RENAME } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: `사용자 확인 ${today} — 영업 여부 ${STATUS} (markOpenCheck.mjs)`,
  });
}
console.log(APPLY ? `\n${docs.length}곳 기록했다.` : `\n미리보기(${docs.length}곳). --apply로 쓴다.`);
process.exit(0);
