// 입지평가 채점자 기준 차이 — 후보지(사람 확정)를 학습 기준(기존점 GPT 등)으로 옮기면 정밀 V62가 얼마나 움직이나 (2026-09-27, 측정만).
// 사용자: 기존점 입지평가는 상위 AI(GPT/Claude)에 개별 요청한 것, 후보지는 사람이 2차 검증. 제미나이 초안을 공통 자로 두면
// 후보지는 학습 기준보다 상권위치 0.78 · 선점 0.69 · 가시성 0.24점 낮게 매겨져 있다(_aiLocationBacktest · _candidateQuickEval 캐시).
// ⚠️ 간접 비교(제미나이가 두 집단에서 같은 자라는 가정). 결론은 "같은 채점자로 양쪽을 다시 매겨야 확정"이다.
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot, recomputeSourceFromSnapshot } from "./validationSnapshot";
import { recomputeCandidates } from "./dailyRecompute";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const SHIFT = { locationScore: 0.78, preemptionScore: 0.69, visibilityScore: 0.24 };

describeIf("채점자 기준 차이 — 후보지 입지평가를 학습 기준으로 옮기면", () => {
  it("V62 변화", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const src = recomputeSourceFromSnapshot(snap);
    const codes = new Set(src.candidates.map((c) => c.code));
    const shifted = {
      ...src,
      locationEvaluations: src.locationEvaluations.map((l) => (codes.has(l.candidateCode)
        ? { ...l, ...Object.fromEntries(Object.entries(SHIFT).map(([k, d]) => { const v = (l as unknown as Record<string, number | null>)[k]; return [k, typeof v === "number" ? Math.min(5, Math.round(v + d)) : v]; })) }
        : l)),
    };
    const before = recomputeCandidates(src);
    const after = recomputeCandidates(shifted);
    const man = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`);
    console.log("\n[후보지 입지평가 +위치 0.78 · +선점 0.69 · +가시성 0.24 → 반올림(5점 상한)] 정밀 V62 · 주 값");
    const ch: number[] = [];
    for (const b of before) {
      const a = after.find((x) => x.code === b.code)!;
      const bv = b.after.v62Final, av = a.after.v62Final;
      if (bv && av) ch.push(av / bv - 1);
      const bp = b.after.dualEstimate?.primaryValue ?? bv, ap = a.after.dualEstimate?.primaryValue ?? av;
      const yes = (v: number | null | undefined) => (v == null ? "?" : v > 55_000_000 ? "가능" : "불가");
      console.log(`  ${b.code} ${b.name.padEnd(10)} V62 ${man(bv)} → ${man(av)} (${bv && av ? ((av / bv - 1) * 100).toFixed(1) : "-"}%) · 주 값 ${man(bp)} ${yes(bp)} → ${man(ap)} ${yes(ap)}`);
    }
    console.log(`  평균 ${(ch.reduce((x, y) => x + y, 0) / ch.length * 100).toFixed(1)}%`);
    expect(ch.length).toBeGreaterThan(5);
  });
});
