// 신규 후보지 평가 결과(storeEvalResults)를 지금 데이터·코드로 다시 계산해 저장한다 (2026-09-25 밤, 사용자 "재계산 필요한 곳 갱신해줘").
// 화면(결과 탭 "다시 계산")과 같은 evaluateCandidate 조립 — storedAccuracyParity "저장된 후보지 평가 결과" 블록과 같은 입력.
// 기본은 미리보기(차이 표만). 실제 저장은 RECOMPUTE_APPLY=1일 때만 — 0.5% 넘게 다르거나 실효단가가 1원 넘게 다른 후보지만 쓴다.
// 쓰기는 firebase-admin(.env.local 서비스 계정)으로 storeEvalResults/{코드}를 통째로 교체 + storeEvalAuditLog에 "재계산" 기록.
// ⚠️ 스냅샷(.local-tools/validation-snapshot.json)을 쓰므로 먼저 node scripts/dumpValidationSnapshot.mjs 로 최신화할 것.
// 실행: npx vitest run src/lib/storeEval/_recomputeCandidates.test.ts --disable-console-intercept   (미리보기)
//       RECOMPUTE_APPLY=1 npx vitest run src/lib/storeEval/_recomputeCandidates.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import type { CandidateInput, Competitor, EvaluationResult, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation } from "./types";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const settings = mergeModelSettings(snap.settings);
    const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
    const existingStores = snap.existingStores as ExistingStore[];
    const wanted = new Set(evaluationSalesIds(existingStores));
    const sales = (snap.sales as ExistingStoreMonthlySales[]).filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
    const qsc = new Map<string, number>();
    for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string; records?: QscRecord[] }[]) { if (!d.storeCode) continue; const a = qscInWindowAverage(d.records ?? [], d.openedAt ?? null); if (a != null && a > 0) qsc.set(d.storeCode, a); }
    const locs = snap.locationEvaluations as LocationEvaluation[];
    const results = (snap.results ?? []) as EvaluationResult[];
    const out: { code: string; name: string; stored: number | null; now: number | null; diff: number | null; rateOff: boolean; result: EvaluationResult }[] = [];
    for (const candidate of (snap.candidates ?? []) as CandidateInput[]) {
      const result = evaluateCandidate({
        candidate, competitors: allCompetitors.filter((c) => c.candidateCode === candidate.code), locationEvaluation: locs.find((l) => l.candidateCode === candidate.code) ?? null,
        settings, existingStores, trainingLocationEvaluations: locs, trainingCompetitors: allCompetitors, trainingSales: sales, trainingQscScores: qsc,
      });
      const stored = results.find((r) => r.candidateCode === candidate.code) ?? null;
      const s = stored?.v62Final ?? null, n = result.v62Final ?? null;
      const rate = (r: EvaluationResult | null) => (r?.revenueBreakdown && r.revenueBreakdown.pcHours > 0 ? r.revenueBreakdown.pcRevenue / r.revenueBreakdown.pcHours : null);
      const rs = rate(stored), rn = rate(result);
      out.push({ code: candidate.code, name: candidate.name ?? "", stored: s, now: n, diff: s && n != null ? n / s - 1 : null, rateOff: rs != null && rn != null && Math.abs(rs - rn) > 1, result });
    }
    const won = (v: number | null) => (v == null ? "-" : Math.round(v).toLocaleString("ko-KR"));
    console.log(`\n[후보지 ${out.length}곳] 저장값 → 지금 계산 (V62 최종 월매출)`);
    for (const r of out) console.log(`  ${r.code} ${r.name.padEnd(8)} ${won(r.stored).padStart(12)} → ${won(r.now).padStart(12)}  ${r.diff == null ? "(저장값 없음)" : `${r.diff >= 0 ? "+" : ""}${(r.diff * 100).toFixed(2)}%`}${r.rateOff ? " · 실효단가 다름" : ""}`);
    const stale = out.filter((r) => r.stored == null || (r.diff != null && Math.abs(r.diff) > 0.005) || r.rateOff);
    console.log(`  재계산 필요 ${stale.length}곳: ${stale.map((r) => r.name).join(" · ") || "없음"}`);
    if (APPLY && stale.length) {
      const db = adminDb();
      const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      for (const r of stale) {
        const before = results.find((x) => x.candidateCode === r.code) ?? null;
        await db.collection("storeEvalResults").doc(r.code).set(clean(r.result));
        const id = `${Date.now()}_${r.code}_recompute`;
        await db.collection("storeEvalAuditLog").doc(id).set(clean({ id, entityType: "evaluationResult", entityId: r.code, action: "재계산", before, after: r.result, actor: "Claude 재계산 스크립트(_recomputeCandidates) 2026-09-25", at: Date.now() }));
      }
      console.log(`  ✅ ${stale.length}곳 저장했다. 다음: node scripts/dumpValidationSnapshot.mjs 로 스냅샷 갱신 → storedAccuracyParity 후보지 항목이 초록인지 확인`);
    } else if (!APPLY) console.log(`  (미리보기 — RECOMPUTE_APPLY=1 로 저장)`);
    expect(out.length).toBeGreaterThan(0);
  }, 120000);
});
