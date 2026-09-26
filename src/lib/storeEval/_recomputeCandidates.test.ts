// 신규 후보지 평가 결과(storeEvalResults)를 지금 데이터·코드로 다시 계산해 저장한다 (2026-09-25 밤, 사용자 "재계산 필요한 곳 갱신해줘").
// 계산은 매일 06:00 크론과 같은 dailyRecompute.recomputeCandidates(결과 탭 "다시 계산"과 같은 조립) — 2026-09-26부터 크론이 자동으로 하므로, 산식을 바꾼 날 바로 쓰고 싶을 때만 쓴다.
// 기본은 미리보기(차이 표만). 실제 저장은 RECOMPUTE_APPLY=1일 때만 — 0.5% 넘게 다르거나 실효단가가 1원 넘게 다른 후보지만 쓴다.
// 쓰기는 firebase-admin(.env.local 서비스 계정)으로 storeEvalResults/{코드}를 통째로 교체 + storeEvalAuditLog에 "재계산" 기록.
// ⚠️ 스냅샷(.local-tools/validation-snapshot.json)을 쓰므로 먼저 node scripts/dumpValidationSnapshot.mjs 로 최신화할 것.
// 실행: npx vitest run src/lib/storeEval/_recomputeCandidates.test.ts --disable-console-intercept   (미리보기)
//       RECOMPUTE_APPLY=1 npx vitest run src/lib/storeEval/_recomputeCandidates.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { hasValidationSnapshot, loadValidationSnapshot, recomputeSourceFromSnapshot } from "./validationSnapshot";
import { recomputeCandidates } from "./dailyRecompute";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const APPLY = process.env.RECOMPUTE_APPLY === "1";

function adminDb() {
  const text = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq === -1) continue;
    let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  const privateKey = env.FIREBASE_PRIVATE_KEY?.split("\\n").join("\n");
  if (!env.FIREBASE_CLIENT_EMAIL || !privateKey || !env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new Error(".env.local 서비스 계정 없음");
  if (!getApps().length) initializeApp({ credential: cert({ projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey }) });
  return getFirestore();
}

describeIf("후보지 결과 재계산", () => {
  it(APPLY ? "다시 계산해 저장한다" : "미리보기 — 저장값 vs 지금 계산", async () => {
    // 2026-09-26 — 계산·비교는 매일 크론과 **같은 함수**(dailyRecompute.recomputeCandidates). 크론이 06:00에 알아서 하므로
    // 이 하네스는 산식을 바꾼 날 "크론까지 기다리지 않고 지금" 쓰고 싶을 때만 쓴다.
    const rows = recomputeCandidates(recomputeSourceFromSnapshot(loadValidationSnapshot<unknown>()));
    const FORCE = process.env.RECOMPUTE_FORCE === "1";
    const won = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString("ko-KR"));
    console.log(`
[후보지 ${rows.length}곳] 저장값 → 지금 계산 (V62 최종 월매출)`);
    for (const r of rows) {
      const s0 = r.before?.v62Final ?? null, n = r.after.v62Final ?? null;
      const diff = s0 && n != null ? n / s0 - 1 : null;
      const d = r.after.dualEstimate;
      console.log(`  ${r.code} ${r.name.padEnd(8)} ${won(s0).padStart(12)} → ${won(n).padStart(12)}  ${diff == null ? "(저장값 없음)" : `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(2)}%`}${r.reasons.length ? ` · 다시 쓸 이유: ${r.reasons.join("·")}` : ""} | 실험실 ${won(d?.lab)} · 주 값 ${d?.primary} ${won(d?.primaryValue)} — ${d?.reason.slice(0, 50)}`);
    }
    const stale = rows.filter((r) => FORCE || r.reasons.length > 0);
    console.log(`  재계산 필요 ${stale.length}곳: ${stale.map((r) => r.name).join(" · ") || "없음"}`);
    if (APPLY && stale.length) {
      const db = adminDb();
      const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      for (const r of stale) {
        await db.collection("storeEvalResults").doc(r.code).set(clean(r.after));
        const id = `${Date.now()}_${r.code}_recompute`;
        await db.collection("storeEvalAuditLog").doc(id).set(clean({ id, entityType: "evaluationResult", entityId: r.code, action: "재계산", before: r.before, after: r.after, actor: "Claude 재계산 하네스(_recomputeCandidates)", at: Date.now() }));
      }
      console.log(`  ✅ ${stale.length}곳 저장했다. 다음: node scripts/dumpValidationSnapshot.mjs 로 스냅샷 갱신 → storedAccuracyParity 후보지 항목이 초록인지 확인`);
    } else if (!APPLY) console.log(`  (미리보기 — RECOMPUTE_APPLY=1 로 저장)`);
    expect(rows.length).toBeGreaterThan(0);
  }, 120000);
});
