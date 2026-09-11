// 카카오 응답을 그대로 믿으면 NaN 좌표가 Firestore에 저장된다(Firestore는 NaN을 받는다).
// 그러면 거리·수요 계산이 전부 조용히 NaN이 되고 화면엔 빈칸으로만 보인다 — 그래서 여기서 막는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

async function freshModule() {
  vi.resetModules();
  return import("./kakao");
}

beforeEach(() => {
  process.env.KAKAO_REST_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geocodeAddress", () => {
  it("정상 결과에서 좌표와 주소를 꺼낸다", async () => {
    fetchMock.mockImplementation(async () =>
      ok({
        documents: [
          {
            x: "127.001",
            y: "37.501",
            address: { address_name: "서울 강남구 역삼동 1" },
            road_address: { address_name: "서울 강남구 테헤란로 1", building_name: "테스트빌딩" },
          },
        ],
      }),
    );
    const { geocodeAddress } = await freshModule();
    expect(await geocodeAddress("서울 강남구 테헤란로 1")).toEqual({
      roadAddress: "서울 강남구 테헤란로 1",
      jibunAddress: "서울 강남구 역삼동 1",
      lat: 37.501,
      lng: 127.001,
      buildingName: "테스트빌딩",
    });
  });

  it("좌표가 없는 결과는 찾은 것으로 치지 않는다", async () => {
    fetchMock.mockImplementation(async () => ok({ documents: [{ address: { address_name: "어딘가" } }] }));
    const { geocodeAddress } = await freshModule();
    expect(await geocodeAddress("서울")).toBeNull();
  });

  // 실제로 겪은 경우 — "221~223호"처럼 복수 호실이 붙으면 카카오가 매칭에 실패한다.
  it("쉼표 뒤 상세정보를 떼고 한 번 더 시도한다", async () => {
    fetchMock
      .mockImplementationOnce(async () => ok({ documents: [] }))
      .mockImplementationOnce(async () =>
        ok({ documents: [{ x: "127", y: "37", road_address: { address_name: "서울 강남구 테헤란로 1" } }] }),
      );
    const { geocodeAddress } = await freshModule();
    const result = await geocodeAddress("서울 강남구 테헤란로 1, 221~223호");
    expect(result?.lat).toBe(37);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // URLSearchParams는 공백을 +로 인코딩한다.
    expect(String(fetchMock.mock.calls[1][0])).toContain("query=" + encodeURIComponent("서울 강남구 테헤란로 1").replace(/%20/g, "+"));
  });

  it("쉼표가 없으면 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => ok({ documents: [] }));
    const { geocodeAddress } = await freshModule();
    expect(await geocodeAddress("없는주소")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("빈 주소는 요청조차 하지 않는다", async () => {
    const { geocodeAddress } = await freshModule();
    expect(await geocodeAddress("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API 키가 없으면 바로 알려준다", async () => {
    delete process.env.KAKAO_REST_API_KEY;
    const { geocodeAddress } = await freshModule();
    await expect(geocodeAddress("서울")).rejects.toThrow("KAKAO_REST_API_KEY");
  });

  it("HTTP 오류는 상태코드와 본문 일부를 담아 던진다", async () => {
    fetchMock.mockImplementation(async () => new Response("quota exceeded", { status: 429 }));
    const { geocodeAddress } = await freshModule();
    await expect(geocodeAddress("서울")).rejects.toThrow("429");
  });
});

describe("searchByKeyword", () => {
  const place = (over: Record<string, unknown> = {}) => ({
    id: "1",
    place_name: "테스트PC방",
    category_group_code: "CT1",
    x: "127",
    y: "37",
    distance: "120",
    ...over,
  });

  // Number("")는 0이다 — 빈 좌표를 그냥 Number()로 바꾸면 "위도 0, 경도 0"이 저장된다.
  it("좌표가 깨지거나 빈 문서는 버린다 (NaN·0,0을 저장하지 않는다)", async () => {
    fetchMock.mockImplementation(async () =>
      ok({ documents: [place(), place({ id: "2", x: "", y: "" }), place({ id: "3", x: "abc", y: "37" })], meta: { is_end: true } }),
    );
    const { searchByKeyword } = await freshModule();
    const places = await searchByKeyword(37, 127, "PC방", 500);
    expect(places.map((p) => p.id)).toEqual(["1"]);
    expect(places.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))).toBe(true);
  });

  it("id가 없는 문서는 버린다 (중복제거 키가 뭉개진다)", async () => {
    fetchMock.mockImplementation(async () => ok({ documents: [place({ id: undefined }), place({ id: "9" })], meta: { is_end: true } }));
    const { searchByKeyword } = await freshModule();
    expect((await searchByKeyword(37, 127, "PC방", 500)).map((p) => p.id)).toEqual(["9"]);
  });

  // 같은 건물이면 카카오가 "0"을 준다 — 예전 코드는 이걸 null로 버렸다.
  it("거리 0을 null로 버리지 않는다", async () => {
    fetchMock.mockImplementation(async () => ok({ documents: [place({ distance: "0" })], meta: { is_end: true } }));
    const { searchByKeyword } = await freshModule();
    expect((await searchByKeyword(37, 127, "PC방", 500))[0].distanceM).toBe(0);
  });

  it("거리 값이 없으면 null로 둔다", async () => {
    fetchMock.mockImplementation(async () => ok({ documents: [place({ distance: undefined })], meta: { is_end: true } }));
    const { searchByKeyword } = await freshModule();
    expect((await searchByKeyword(37, 127, "PC방", 500))[0].distanceM).toBeNull();
  });

  it("is_end가 false면 최대 3페이지까지 모은다", async () => {
    let page = 0;
    fetchMock.mockImplementation(async () => {
      page += 1;
      return ok({ documents: [place({ id: String(page) })], meta: { is_end: false } });
    });
    const { searchByKeyword } = await freshModule();
    const places = await searchByKeyword(37, 127, "PC방", 500);
    expect(places.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("반경은 카카오 상한(20km)으로 자른다", async () => {
    fetchMock.mockImplementation(async () => ok({ documents: [], meta: { is_end: true } }));
    const { searchByKeyword } = await freshModule();
    await searchByKeyword(37, 127, "PC방", 99999);
    expect(String(fetchMock.mock.calls[0][0])).toContain("radius=20000");
  });
});
