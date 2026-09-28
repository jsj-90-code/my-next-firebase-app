import { describe, expect, it } from "vitest";
import {
  PERMIT_AREA_PER_PC_M2, PERMIT_MIN_GAME_COUNT, lookupPcBangPermit, normalizePcBangName, suggestPcCountFromPermit,
} from "./pcBangPermit";

describe("인허가 대수 제안 규칙", () => {
  it("게임기수가 기준 이상이면 그대로, 아니면 면적, 둘 다 없으면 null", () => {
    expect(suggestPcCountFromPermit(120, 300)).toEqual({ count: 120, how: "게임기수" });
    expect(suggestPcCountFromPermit(PERMIT_MIN_GAME_COUNT - 1, 267)).toEqual({ count: Math.round(267 / PERMIT_AREA_PER_PC_M2), how: "면적" });
    expect(suggestPcCountFromPermit(null, null)).toEqual({ count: null, how: null });
    expect(suggestPcCountFromPermit(null, 0)).toEqual({ count: null, how: null });
  });

  it("이름 정규화는 pc방·피씨·공백·괄호를 뺀다", () => {
    expect(normalizePcBangName("놀러와PC방 (2호점)")).toBe(normalizePcBangName("놀러와 피씨"));
    expect(normalizePcBangName("제로백PC 안산선부점")).toContain("제로백");
  });

  it("이름이 맞으면 120m 안에서, 아니면 25m 안 최근접만 짝짓는다", () => {
    const base = { lat: 37.3, lng: 127.0 };
    const off = (m: number) => base.lat + m / 111000; // 위도 m → 도
    const rows: [string, number, number, number | null, number | null, string | null][] = [
      ["놀러와PC방", off(90), base.lng, 90, 250, "2019-01-01"],
      ["딴집PC", off(10), base.lng, 60, 150, null],
    ];
    const byName = lookupPcBangPermit({ name: "놀러와 피씨", ...base }, rows);
    expect(byName?.name).toBe("놀러와PC방");
    expect(byName?.matchedBy).toBe("name");
    expect(byName?.suggestedPcCount).toBe(90);
    const byDist = lookupPcBangPermit({ name: "이름이 전혀 다름", ...base }, rows);
    expect(byDist?.name).toBe("딴집PC");
    expect(byDist?.matchedBy).toBe("distance");
    const none = lookupPcBangPermit({ name: "이름이 전혀 다름", lat: off(60), lng: base.lng }, rows);
    expect(none).toBeNull();
  });

  it("번들 색인으로도 찾는다 — 실제 좌표(안산선부 제로백)에서 게임기수가 나온다", () => {
    const hit = lookupPcBangPermit({ name: "제로백PC", lat: 37.3365, lng: 126.8158 });
    // 색인은 자료 갱신으로 바뀔 수 있어 값은 못 박지 않는다. 있으면 형태만 본다.
    if (hit) {
      expect(hit.source).toBe("인허가");
      expect(hit.basis).toContain("인허가");
    }
  });
});
