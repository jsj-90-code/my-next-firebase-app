// V61 실측 학습모형 학습 데이터를 Firestore에 1회성으로 심는 스크립트.
//
// 무엇을 하는가:
//   reference/existing-store-seed.json (gitignored - reference/점포평가_최신본.xlsx에서 추출한
//   기존 가맹점 41곳의 실측 특징치·실제매출)을 읽어 storeEvalExistingStores /
//   storeEvalLocationEvaluations 컬렉션에 그대로 upsert한다.
//
// 왜 필요한가:
//   src/lib/storeEval/evaluate.ts의 V61 계산은 이 두 컬렉션에서 기존 가맹점 데이터를 읽어
//   실제로 학습(비음수 릿지회귀)한다. 이 스크립트를 실행하지 않으면 학습표본이 0개라
//   V61이 계속 폴백 회귀식("임시 근사치·검증 전")으로만 표시된다.
//
// 실행 전 확인:
//   .env.local에 FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가
//   있어야 한다(src/lib/firebase-admin.ts와 동일한 자격증명). 이미 문서가 있으면 필드가
//   합쳐지지 않고 그대로 덮어쓴다(set, merge 없음) - 재실행해도 안전하지만, 이 컬렉션에 다른
//   손으로 입력해둔 값이 있다면 실행 전에 Firestore 콘솔에서 먼저 백업하는 것을 권장한다.
//
// 실행: node scripts/seedExistingStoreTrainingData.mjs

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 프로젝트에 dotenv 의존성이 없어 .env.local을 직접 최소 파싱한다(따옴표·개행이스케이프만 처리).
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

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가 .env.local에 필요합니다.");
  process.exit(1);
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);

const rows = JSON.parse(readFileSync(new URL("../reference/existing-store-seed.json", import.meta.url), "utf8"));

let storeCount = 0;
let locCount = 0;

for (const r of rows) {
  const existingStore = {
    storeCode: r.code,
    storeName: r.name,
    pcCount: r.pcCount,
    floor: r.floor,
    groundLevel: r.groundLevel,
    openedAt: r.openedAt,
    franchiseStatus: r.franchiseStatus,
    excludedFromModel: r.excludedFromModel,
    excludedReason: r.excludedReason,
    v61Predicted: r.v61Predicted,
    referenceMarketDemand: r.referenceMarketDemand,
    brandType: r.brandType,
    validationUse: r.validationUse,
    hourlyRate: r.hourlyRate,
    ownDemand: r.ownDemand,
    competitivenessScore: r.competitivenessScore,
    actualMonthlyRevenueAvg: r.actualMonthlyRevenueAvg,
    completedMonths: r.completedMonths,
  };
  await db.collection("storeEvalExistingStores").doc(r.code).set(existingStore);
  storeCount++;

  if (r.brandType != null || r.inflowRestriction != null) {
    await db.collection("storeEvalLocationEvaluations").doc(r.code).set(
      {
        candidateCode: r.code,
        name: r.name,
        address: "",
        locationScore: null,
        flowScore: null,
        preemptionScore: null,
        visibilityScore: null,
        mapMemo: null,
        attractionScore: null,
        specialDemandType: null,
        specialDemandIntensity: null,
        inflowRestriction: r.inflowRestriction,
        demandLeakageRisk: null,
        marketStructureMemo: null,
        brandType: r.brandType,
        updatedAt: Date.now(),
        updatedBy: "seed-script",
      },
      { merge: true },
    );
    locCount++;
  }
}

console.log(`storeEvalExistingStores: ${storeCount}건 upsert`);
console.log(`storeEvalLocationEvaluations: ${locCount}건 upsert`);
console.log("완료");
process.exit(0);
