import { describe, expect, it } from "vitest";
import { describeVerdictFlips, findVerdictFlips } from "./verdictSensitivity";
import type { LocationEvaluation } from "./types";

const loc = { locationScore: 3, preemptionScore: 2, visibilityScore: 5 } as LocationEvaluation;
// 점수 합 × 1,000만원짜리 장난감 계산 — 합 10이면 1억
const revalue = (l: LocationEvaluation) => ((l.locationScore ?? 0) + (l.preemptionScore ?? 0) + (l.visibilityScore ?? 0)) * 10_000_000;

describe("판정 흔들림", () => {
  it("1점에 기준선을 넘나드는 항목만 고른다", () => {
    // 지금 합 10 → 1억. 기준 9,500만이면 어느 항목이든 1점 내리면 9,000만으로 불가가 된다.
    const flips = findVerdictFlips(loc, revalue(loc), 95_000_000, revalue);
    expect(flips.map((f) => `${f.field}:${f.from}->${f.to}`)).toEqual([
      "locationScore:3->2",
      "preemptionScore:2->1",
      "visibilityScore:5->4",
    ]);
  });

  it("기준선에서 멀면 아무것도 없다", () => {
    expect(findVerdictFlips(loc, revalue(loc), 50_000_000, revalue)).toEqual([]);
    expect(describeVerdictFlips([], 50_000_000)).toBeNull();
  });

  it("1~5 밖으로 나가지 않고, 빈 점수는 건너뛴다", () => {
    const partial = { locationScore: null, preemptionScore: 1, visibilityScore: 5 } as unknown as LocationEvaluation;
    const seen: number[] = [];
    findVerdictFlips(partial, 1, 0, (l) => { seen.push((l.preemptionScore ?? 0) * 10 + (l.visibilityScore ?? 0)); return 1; });
    expect(seen).toEqual([25, 14]);
  });
});
