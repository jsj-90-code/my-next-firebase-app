import { describe, expect, it } from "vitest";
import { zoneDisplayLabels } from "./calc";

describe("zoneDisplayLabels", () => {
  it("계열에 묶음이 하나뿐이면 알파벳을 뗀다", () => {
    const labels = zoneDisplayLabels([{ names: ["멀티존A"] }, { names: ["FPS존A", "FPS존B"] }]);
    expect(labels.get("멀티존A")).toBe("멀티존");
    expect(labels.get("FPS존A")).toBe("FPS존");
    expect(labels.get("FPS존B")).toBe("FPS존");
  });

  it("묶음이 둘 이상이면 A·B·C를 다시 매긴다", () => {
    const labels = zoneDisplayLabels([{ names: ["LOL존A", "LOL존B"] }, { names: ["LOL존C"] }]);
    expect(labels.get("LOL존A")).toBe("LOL존A");
    expect(labels.get("LOL존B")).toBe("LOL존A");
    expect(labels.get("LOL존C")).toBe("LOL존B");
  });

  it("알파벳 없는 이름은 그대로", () => {
    const labels = zoneDisplayLabels([{ names: ["4인룸"] }]);
    expect(labels.get("4인룸")).toBe("4인룸");
  });
});
