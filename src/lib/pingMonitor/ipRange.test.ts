import { describe, expect, it } from "vitest";
import { parseIpRanges } from "./ipRange";

describe("parseIpRanges", () => {
  it("끝이 숫자 하나인 대역", () => {
    const r = parseIpRanges("118.128.168.1~110");
    expect(r.errors).toEqual([]);
    expect(r.ips).toHaveLength(110);
    expect(r.ips[0]).toBe("118.128.168.1");
    expect(r.ips[109]).toBe("118.128.168.110");
  });

  it("공백·하이픈·전체 IP 끝·여러 대역·중복", () => {
    const r = parseIpRanges("1.2.3.1 ~ 3\n1.2.3.3-1.2.3.4, 9.9.9.9");
    expect(r.errors).toEqual([]);
    expect(r.ips).toEqual(["1.2.3.1", "1.2.3.2", "1.2.3.3", "1.2.3.4", "9.9.9.9"]);
  });

  it("마지막 자리를 넘는 대역", () => {
    const r = parseIpRanges("1.2.3.250-1.2.4.2");
    expect(r.ips).toHaveLength(9);
    expect(r.ips.at(-1)).toBe("1.2.4.2");
  });

  it("잘못된 입력은 오류로 알린다", () => {
    expect(parseIpRanges("1.2.3").errors).toHaveLength(1);
    expect(parseIpRanges("1.2.3.10~5").errors).toHaveLength(1);
    expect(parseIpRanges("1.2.3.1~300").errors).toHaveLength(1);
    expect(parseIpRanges("1.0.0.0-1.0.255.255").errors).toHaveLength(1);
  });
});
