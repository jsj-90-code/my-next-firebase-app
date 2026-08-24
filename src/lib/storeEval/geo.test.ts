import { describe, expect, it } from "vitest";
import { findNearbyCandidates, haversineDistanceMeters } from "./geo";

describe("haversineDistanceMeters", () => {
  it("같은 좌표는 거리 0", () => {
    expect(haversineDistanceMeters({ lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.0 })).toBe(0);
  });

  it("위도 1도 차이는 약 111km", () => {
    const d = haversineDistanceMeters({ lat: 37.0, lng: 127.0 }, { lat: 38.0, lng: 127.0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("서울시청-강남역 실제 거리(약 8.5km)와 근사한 값을 낸다", () => {
    const seoulCityHall = { lat: 37.5663, lng: 126.9779 };
    const gangnamStation = { lat: 37.4979, lng: 127.0276 };
    const d = haversineDistanceMeters(seoulCityHall, gangnamStation);
    expect(d).toBeGreaterThan(7500);
    expect(d).toBeLessThan(9500);
  });
});

describe("findNearbyCandidates", () => {
  const target = { code: "N010", lat: 37.5, lng: 127.0, roadAddress: "서울 강남구 테스트로 1" };

  it("도로명주소가 완전히 같으면 좌표와 무관하게 중복으로 본다", () => {
    const others = [{ code: "N001", lat: null, lng: null, roadAddress: "서울 강남구 테스트로 1" }];
    expect(findNearbyCandidates(target, others, 100)).toHaveLength(1);
  });

  it("반경 이내 좌표는 중복으로 본다", () => {
    const others = [{ code: "N002", lat: 37.5001, lng: 127.0001, roadAddress: "다른 주소" }];
    expect(findNearbyCandidates(target, others, 100).map((o) => o.code)).toEqual(["N002"]);
  });

  it("반경 밖 좌표는 중복이 아니다", () => {
    const others = [{ code: "N003", lat: 37.6, lng: 127.1, roadAddress: "다른 주소" }];
    expect(findNearbyCandidates(target, others, 100)).toHaveLength(0);
  });

  it("자기 자신(같은 code)은 제외한다", () => {
    const others = [{ code: "N010", lat: 37.5, lng: 127.0, roadAddress: "서울 강남구 테스트로 1" }];
    expect(findNearbyCandidates(target, others, 100)).toHaveLength(0);
  });

  it("좌표가 없는 둘을 비교할 땐 주소가 다르면 중복 아님", () => {
    const others = [{ code: "N004", lat: null, lng: null, roadAddress: "다른 주소" }];
    expect(findNearbyCandidates(target, others, 100)).toHaveLength(0);
  });
});
