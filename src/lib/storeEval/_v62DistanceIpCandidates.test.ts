// 2단계 C1 채택 전 재고 표 — V62 경쟁IP 거리 가중을 켜면 후보지 13곳 금액이 어떻게 바뀌나 (2026-09-26 밤, 사용자 "후보지 금액 변화표 뽑아봐")
//
// 크론·검증 화면과 **같은 조립**(dailyRecompute)으로 설정 스위치 `v61Training.competitorIpDistanceWeighted`만 켜고 끈다. 읽기전용.
// 같이 찍는 것: 기존점 V62 적중률(요약) — 하네스(_v62LabFeed C1) 9.27%가 운영 조립에서도 나오는지 검산.
// 실행: npx vitest run src/lib/storeEval/_v62DistanceIpCandidates.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot, recomputeSourceFromSnapshot } from "./validationSnapshot";
import { computeAccuracySummary, recomputeCandidates } from "./dailyRecompute";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const won = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 10000).toLocaleString("ko-KR")}만`);
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("V62 경쟁IP 거리 가중 — 후보지 금액 재고 표", () => {
  const src = recomputeSourceFromSnapshot(loadValidationSnapshot<unknown>());
  const doc = (src.settingsDoc ?? {}) as Record<string, unknown>;
  const on = { ...src, settingsDoc: { ...doc, v61Training: { ...((doc.v61Training as object) ?? {}), competitorIpDistanceWeighted: true } } };

  it("후보지 13곳 · 기존점 적중률 — 끔 vs 켬", () => {
    const a0 = computeAccuracySummary(src), a1 = computeAccuracySummary(on);
    console.log(`\n[기존점 V62 적중률] 끔 MAPE ${((a0?.meanAbsoluteErrorPct ?? NaN) * 100).toFixed(2)}% (n=${a0?.sampleCount}) → 켬 ${((a1?.meanAbsoluteErrorPct ?? NaN) * 100).toFixed(2)}% (n=${a1?.sampleCount})`);
    const r0 = new Map(recomputeCandidates(src).map((r) => [r.code, r.after]));
    const r1 = recomputeCandidates(on);
    console.log(`\n[후보지 V62 최종 월매출] 끔 → 켬 · 경쟁IP(끔→켬) · 주 값(dualEstimate) 끔→켬`);
    console.log(`  ${pad("후보지", 16)} ${"끔".padStart(8)} ${"켬".padStart(8)}  변화     경쟁IP        주 값`);
    const diffs: number[] = [];
    for (const r of r1) {
      const b = r0.get(r.code)!, a = r.after;
      const d = b.v62Final && a.v62Final ? a.v62Final / b.v62Final - 1 : null;
      if (d != null) diffs.push(d);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ip = (x: any) => Math.round(x.competitorIp ?? NaN);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prim = (x: any) => x.dualEstimate?.primary ?? "-";
      console.log(`  ${pad(`${r.code} ${r.name}`, 16)} ${won(b.v62Final).padStart(8)} ${won(a.v62Final).padStart(8)}  ${d == null ? "  -  " : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`.padStart(6)}   ${String(ip(b)).padStart(5)}→${String(ip(a)).padEnd(5)}  ${prim(b)}→${prim(a)}`);
    }
    for (const r of r1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = r0.get(r.code) as any, a = r.after as any;
      if (b.dualEstimate?.primary !== a.dualEstimate?.primary) console.log(`  ↳ ${r.name} 주 값 바뀐 이유(켬): ${a.dualEstimate?.reason}`);
    }
    const abs = diffs.map(Math.abs).sort((x, y) => x - y);
    console.log(`  |변화| 중앙 ${(abs[Math.floor(abs.length / 2)] * 100).toFixed(1)}% · 최대 ${(abs.at(-1)! * 100).toFixed(1)}% · 올라간 곳 ${diffs.filter((x) => x > 0.005).length} · 내려간 곳 ${diffs.filter((x) => x < -0.005).length}`);
    expect(r1.length).toBeGreaterThan(5);
  });
});
