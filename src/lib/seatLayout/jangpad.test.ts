import { describe, expect, it } from "vitest";
import { computeJangpadTable } from "./calc";
import type { DeskZone } from "./types";

const zone = (typeKey: string, deskSize: string, qty: number) =>
  ({ typeKey, seats: qty, deskSize: "", sizeBreakdown: [{ deskSize, qty }] }) as unknown as DeskZone;

describe("computeJangpadTable (10-30)", () => {
  it("커플석은 820mm일 때만 IS-M800_R, 수량 0인 장패드는 여분 2개도 없음", () => {
    const rows = computeJangpadTable([zone("multi", "820mm", 10), zone("couple_seat", "850mm", 4)]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r.total]));
    expect(by["IS-M800_B(신규)"]).toBe(12);
    expect(by["IS-M800_R(커플)"]).toBe(0);
    expect(by["IS-M830_B(신규)"]).toBe(6);
    expect(by["IS-M890_B(신규)"]).toBe(0);
    expect(by["아이센스 장패드(카운터)"]).toBe(3);
    expect(computeJangpadTable([zone("couple_room", "820mm", 6)]).find((r) => r.name === "IS-M800_R(커플)")?.total).toBe(8);
  });
});
