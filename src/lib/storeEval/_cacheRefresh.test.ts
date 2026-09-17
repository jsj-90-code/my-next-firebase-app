// 일회성 — 기존점 파생 캐시(경쟁력점수·격차·수요)를 지금 설정으로 다시 계산해 저장한다.
//
// `.local-tools/refresh-existing-store-cache.mjs`와 **같은 일**을 한다. 그 스크립트는
// 2026-09-17 현재 node로 못 돈다 — `src/`의 TS를 부르는데 그 안이 확장자 없는 상대 import
// (`./calc`)를 쓰고 node의 타입 스트리핑이 그걸 못 푼다. vitest는 푼다.
//
//   미리보기:  npx vitest run src/lib/storeEval/_cacheRefresh.test.ts --disable-console-intercept
//   실제 저장:  APPLY=1 npx vitest run src/lib/storeEval/_cacheRefresh.test.ts --disable-console-intercept
//
// ⚠️ 예측에는 영향이 없다. 검증·후보지 계산은 prepareExistingStoresForEvaluation이 메모리에서
//    다시 계산한다. 이 캐시는 **기존점 화면 표시용**이다. 매일 06:00 KST 크론도 같은 일을 한다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existingStoreEvaluationPatch, existingStoreSourceCode } from "./existingStoreEvaluation";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { mergeModelSettings } from "./settings";

function loadEnv() {
  let text = "";
  try { text = readFileSync(".env.local", "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
loadEnv();
const hasCreds = !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY;
const describeIf = hasCreds ? describe : describe.skip;

const FIELDS = ["competitivenessScore", "competitivenessGap", "ownDemand", "marketDemand", "competitorIp"] as const;
const near = (a: unknown, b: unknown) =>
  (a == null && b == null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("기존점 파생 캐시를 지금 설정으로 맞춘다", () => {
  it("차이를 세고, APPLY=1이면 저장한다", async () => {
    // 프로젝트를 한 번 더 확인한다 — 엉뚱한 프로젝트에 쓰면 되돌리기 어렵다.
    if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "my-next-firebase-app-541f4")
      throw new Error(`예상치 못한 프로젝트: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        }),
      });
    }
    const db = getFirestore();
    const settings = mergeModelSettings((await db.doc("storeEvalSettings/current").get()).data() ?? null);
    const stores = (await db.collection("storeEvalExistingStores").get()).docs.map((d) => ({ storeCode: d.id, ...d.data() } as any));
    const competitors = (await db.collection("storeEvalCompetitors").get()).docs.map((d) => migrateCompetitorInvestigationStatus(d.data() as any));
    const locations = (await db.collection("storeEvalLocationEvaluations").get()).docs.map((d) => d.data() as any);

    const byCandidate = new Map<string, any[]>();
    for (const c of competitors) byCandidate.set(c.candidateCode, [...(byCandidate.get(c.candidateCode) ?? []), c]);
    const locByCode = new Map(locations.map((l) => [l.candidateCode, l]));

    const changes: { storeCode: string; storeName: string; diff: string[]; patch: any; before: any }[] = [];
    for (const store of stores) {
      const code = existingStoreSourceCode(store);
      const patch = existingStoreEvaluationPatch(store, byCandidate.get(code) ?? [], locByCode.get(code) ?? null, settings) as any;
      const diff = FIELDS.filter((f) => !near(store[f] ?? null, patch[f] ?? null));
      if (diff.length) changes.push({
        storeCode: store.storeCode, storeName: store.storeName, diff: [...diff], patch,
        before: Object.fromEntries(FIELDS.map((f) => [f, store[f] ?? null])),
      });
    }

    const apply = process.env.APPLY === "1";
    console.log(`\n대상 ${stores.length}곳 중 갱신 필요 ${changes.length}곳 — ${apply ? "저장한다" : "미리보기(저장 안 함)"}`);
    for (const c of changes)
      console.log(`  ${String(c.storeName ?? c.storeCode).slice(0, 12).padEnd(13)} ${c.diff.map((f) => `${f} ${c.before[f]} → ${c.patch[f]}`).join(" · ")}`);

    if (apply && changes.length) {
      let written = 0;
      for (let i = 0; i < changes.length; i += 400) {
        const batch = db.batch();
        for (const c of changes.slice(i, i + 400)) {
          batch.update(db.doc(`storeEvalExistingStores/${c.storeCode}`), Object.fromEntries(FIELDS.map((f) => [f, c.patch[f] ?? null])));
          written++;
        }
        await batch.commit();
      }
      console.log(`APPLIED ${written}곳`);
    }
    expect(stores.length).toBeGreaterThan(0);
  }, 120_000);
});
