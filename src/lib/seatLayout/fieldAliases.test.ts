import { describe, expect, it } from "vitest";
import { normalizeFieldValue } from "./calc";

// 11-10 범례 하드웨어 표기 통일 — 저장된 옛 이름이 범례에서 새 표기로 보이는지.
describe("하드웨어 표기 통일", () => {
  it.each([
    ["ram", "16GB", "DDR5-5600 16GB"],
    ["ram", "DDR5 32GB", "DDR5-5600 16GB×2"],
    ["gpu", "RTX 5060", "RTX 5060 8GB"],
    ["gpu", "RTX 5060Ti", "RTX 5060 Ti 8GB"],
    ["cpu", "울트라5 시리즈2 225F", "울트라5 225F"],
    ["mb", "H810M-X 2.5G", "ASUS PRIME H810M-X 2.5G"],
    ["power", "600W", "잘만 MegaMax 600W"],
    ["monitor", "제이씨현 32인치 240Hz", "제이씨현 BG32CV 32인치 240Hz"],
    ["monitor", "큐닉스 27인치 300Hz", "큐닉스 MG27B 27인치 300Hz"],
    ["monitor", "BenQ XL2540X+ 280Hz", "BenQ XL2540X+ 25인치 280Hz"],
    ["monitor", "비트엠 27인치 IPS 240Hz", "비트엠 B2799F 27인치 240Hz"],
    ["monitor", "비트엠 34인치 울트라와이드", "비트엠 X34IPS 34인치"],
  ] as const)("%s: %s → %s", (id, from, to) => {
    expect(normalizeFieldValue(id, from)).toBe(to);
  });
});
