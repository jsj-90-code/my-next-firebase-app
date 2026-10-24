import { describe, expect, it } from "vitest";
import { addressKey, findDuplicates, findExistingOverlaps, newAddressKeys, normalizeName, similarGroupName } from "./duplicate";

const store = (id: string, address: string, ipRanges = "", extra: Partial<{ isOwnStore: boolean }> = {}) => ({ id, name: id, address, ipRanges, ownCode: null, ownName: null, ...extra });

describe("addressKey", () => {
  it("도로명 건물번호와 층·호수를 가른다", () => {
    expect(addressKey("경남 창원시 성산구 대암로 36 한성상가 305호")).toEqual({ building: "경남창원시성산구대암로|36", detail: "305호" });
    expect(addressKey("경남 창원시 성산구 가음로15번길 38 지하1층 101,102호")).toEqual({ building: "경남창원시성산구가음로15번길|38", detail: "지하1층|101,102호" });
  });
  it("시·도 이름을 줄임말로 맞춘다", () => {
    expect(addressKey("경상남도 창원시 성산구 대암로 36")?.building).toBe(addressKey("경남 창원시 성산구 대암로 36")?.building);
    expect(addressKey("부산광역시 남구 용소로13번길 6")?.building).toBe("부산남구용소로13번길|6");
  });
  it("지번 주소도 읽는다", () => {
    expect(addressKey("울산 남구 삼산동 1476-2")).toEqual({ building: "울산남구삼산동|1476-2", detail: null });
  });
  it("'종로1가'를 도로명으로 잘못 읽지 않는다", () => {
    expect(addressKey("서울 종로구 종로1가 12")?.building).toBe("서울종로구종로1가|12");
  });
  it("건물을 못 읽으면 null", () => {
    expect(addressKey("")).toBeNull();
    expect(addressKey("부평역 앞")).toBeNull();
  });
});

describe("findDuplicates", () => {
  const stores = [store("a", "경남 창원시 성산구 대암로 36 한성상가 305호", "10.0.0.1~10"), store("b", "울산 남구 삼산동 1476-2", "10.0.1.1~5")];
  it("IP가 하나라도 겹치면 잡는다", () => {
    const hits = findDuplicates({ ipRanges: "10.0.0.8~20", keys: [] }, stores);
    expect(hits).toMatchObject([{ kind: "ip", store: { id: "a" }, overlap: 3 }]);
  });
  it("같은 건물·같은 호수면 주소 겹침", () => {
    const hits = findDuplicates({ ipRanges: "", keys: newAddressKeys("경상남도 창원시 성산구 대암로 36 305호") }, stores);
    expect(hits).toMatchObject([{ kind: "address", store: { id: "a" } }]);
  });
  it("한쪽에 호수가 없으면 겹침으로 본다", () => {
    const hits = findDuplicates({ ipRanges: "", keys: newAddressKeys("경남 창원시 성산구 대암로 36") }, stores);
    expect(hits[0].kind).toBe("address");
  });
  it("같은 건물 다른 호수는 알림만", () => {
    const hits = findDuplicates({ ipRanges: "", keys: newAddressKeys("경남 창원시 성산구 대암로 36 401호") }, stores);
    expect(hits).toMatchObject([{ kind: "building" }]);
  });
  it("도로명으로 적어도 카카오 지번으로 맞춘다", () => {
    const keys = newAddressKeys("울산 남구 삼산로 100", { roadAddress: "울산 남구 삼산로 100", jibunAddress: "울산 남구 삼산동 1476-2" });
    expect(findDuplicates({ ipRanges: "", keys }, stores)).toMatchObject([{ kind: "address", store: { id: "b" } }]);
  });
  it("수정 중인 자기 자신은 뺀다", () => {
    expect(findDuplicates({ ipRanges: "10.0.0.1~10", keys: [] }, stores, "a")).toEqual([]);
  });
});

describe("findExistingOverlaps", () => {
  it("이미 겹치는 쌍을 찾는다(IP·주소)", () => {
    const rows = [store("a", "경남 창원시 성산구 대암로 36 305호", "10.0.0.1~10"), store("b", "경남 창원시 성산구 대암로 36 305호"), store("c", "", "10.0.0.5~6"), store("d", "경남 창원시 성산구 대암로 36 401호")];
    const out = findExistingOverlaps(rows);
    expect(out).toContainEqual(expect.objectContaining({ kind: "ip", overlap: 2 }));
    expect(out.filter((o) => o.kind === "address").map((o) => [o.a.id, o.b.id])).toEqual([["a", "b"]]);
  });
  it("우리 매장 등록은 주소 비교에서 뺀다", () => {
    const out = findExistingOverlaps([store("own", "울산 남구 삼산동 1", "", { isOwnStore: true }), store("x", "울산 남구 삼산동 1")]);
    expect(out).toEqual([]);
  });
});

describe("이름", () => {
  it("피시↔PC·띄어쓰기를 무시한다", () => {
    expect(normalizeName("레벨업 피시방")).toBe(normalizeName("레벨업PC방"));
  });
  it("묶음 이름은 한쪽이 품으면 비슷하다", () => {
    expect(similarGroupName("구로점", "구로디지털단지점")).toBe(true);
    expect(similarGroupName("구로디지털점", "부평역점")).toBe(false);
    expect(similarGroupName("점", "구로점")).toBe(false);
  });
});
