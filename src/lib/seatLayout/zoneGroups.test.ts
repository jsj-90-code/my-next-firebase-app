// 존 유형 묶음이 실제 목록과 어긋나지 않는지 고정한다 (2026-09-14 신설).
//
// 묶음은 화면에만 쓰는 것이라 어긋나도 빌드가 안 깨진다. 그래서 조용히 틀어진다 —
// 존 유형을 새로 추가하고 묶음에 안 넣으면 **그 존은 화면에서 아예 사라진다.**
// 오늘 하루가 그런 종류의 버그를 11건 잡은 날이라 여기서 미리 막는다.

import { describe, expect, it } from "vitest";
import { ZONE_GROUPS, ZONE_TYPES } from "./constants";

const grouped = ZONE_GROUPS.flatMap((g) => g.typeKeys);

describe("존 유형 묶음", () => {
  it("모든 존 유형이 정확히 한 묶음에 들어 있다", () => {
    // 빠진 것 — 화면에서 사라진다
    const missing = ZONE_TYPES.map((t) => t.key).filter((k) => !grouped.includes(k));
    expect(missing, "묶음에 빠진 존 유형").toEqual([]);
    // 겹친 것 — 두 번 나온다
    expect(grouped.length, "중복 없이 전부 한 번씩").toBe(ZONE_TYPES.length);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("없는 존 유형을 가리키지 않는다", () => {
    const known = new Set(ZONE_TYPES.map((t) => t.key));
    const unknown = grouped.filter((k) => !known.has(k));
    expect(unknown, "ZONE_TYPES에 없는 키").toEqual([]);
  });

  it("묶음 이름이 비어 있지 않고 서로 다르다", () => {
    const labels = ZONE_GROUPS.map((g) => g.label);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("사용자가 알려준 분류를 그대로 지킨다", () => {
    // 2026-09-14 사용자 확인 내용. 여기가 깨지면 누가 임의로 바꾼 것이다.
    const byKey = new Map(ZONE_GROUPS.map((g) => [g.key, g.typeKeys]));
    expect(byKey.get("basic")).toEqual(["multi"]);
    expect(byKey.get("spec")).toEqual(["lol", "fps", "fc"]);
    expect(byKey.get("zone")).toEqual([
      "friends", "couple_seat", "couple_room", "vip", "ceremony_team", "team", "one_seat", "one_room", "two", "three",
    ]);
    expect(byKey.get("legacy")).toEqual(["buff", "progamer"]);
  });

  it("지금 안 쓰는 묶음만 접혀 있다", () => {
    const collapsed = ZONE_GROUPS.filter((g) => g.collapsed).map((g) => g.key);
    expect(collapsed).toEqual(["legacy"]);
  });
});
