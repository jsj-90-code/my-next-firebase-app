// SGIS는 실패해도 HTTP 200을 준다. 그래서 "요청이 성공했는가"가 아니라 "본문 errCd가 0인가"로
// 판정해야 한다. 이걸 놓치면 인증 만료가 "그 주소엔 행정구역이 없다"나 "인구 null"로 둔갑하고,
// 수집 화면엔 "자동수집 완료"가 뜬다 — 틀린 값을 사실로 저장하는 가장 조용한 사고다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const AUTH_OK = { errCd: 0, result: { accessToken: "tok-1", accessTimeout: Date.now() + 3_600_000 } };

let fetchMock: ReturnType<typeof vi.fn>;

async function freshModule() {
  vi.resetModules(); // 토큰 캐시가 테스트 사이에 새지 않게 한다.
  return import("./sgis");
}

beforeEach(() => {
  process.env.SGIS_SERVICE_ID = "id";
  process.env.SGIS_SECURITY_KEY = "key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geocodeToAdminDong", () => {
  it("정상 응답에서 행정구역코드를 꺼낸다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockResolvedValueOnce(ok({ errCd: 0, result: { resultdata: [{ adm_cd: "1111051500", full_addr: "서울 종로구 청운효자동" }] } }));
    const { geocodeToAdminDong } = await freshModule();
    expect(await geocodeToAdminDong("서울 종로구")).toEqual({
      admCd: "1111051500",
      admName: "서울 종로구 청운효자동",
    });
  });

  // 핵심 — errCd가 0이 아니면 "결과 없음(null)"이 아니라 오류여야 한다.
  it("errCd가 0이 아니면 던진다 (null로 삼키지 않는다)", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockResolvedValueOnce(ok({ errCd: -300, errMsg: "요청 한도 초과" }))
      .mockImplementation(async () => ok({ errCd: -300, errMsg: "요청 한도 초과" }));
    const { geocodeToAdminDong } = await freshModule();
    await expect(geocodeToAdminDong("서울")).rejects.toThrow("요청 한도 초과");
  });

  it("errCd 0인데 결과가 비면 정말 못 찾은 것으로 보고 null을 준다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockResolvedValueOnce(ok({ errCd: 0, result: { resultdata: [] } }));
    const { geocodeToAdminDong } = await freshModule();
    expect(await geocodeToAdminDong("없는주소")).toBeNull();
  });

  it("점검 페이지(HTML)가 200으로 와도 파싱 오류를 그대로 알린다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockImplementation(async () => new Response("<html><title>점검중</title></html>", { status: 200 }));
    const { geocodeToAdminDong } = await freshModule();
    await expect(geocodeToAdminDong("서울")).rejects.toThrow("해석하지 못했습니다");
  });

  // 만료시각을 못 믿는 경우가 있어서, 인증 오류는 토큰을 새로 받아 한 번 재시도한다.
  it("인증 오류(errCd -401)면 토큰을 새로 받아 한 번 재시도한다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockResolvedValueOnce(ok({ errCd: -401, errMsg: "인증 타임아웃" }))
      .mockResolvedValueOnce(ok({ errCd: 0, result: { accessToken: "tok-2", accessTimeout: Date.now() + 3_600_000 } }))
      .mockResolvedValueOnce(ok({ errCd: 0, result: { resultdata: [{ adm_cd: "1111051500", adm_nm: "청운효자동" }] } }));
    const { geocodeToAdminDong } = await freshModule();
    expect(await geocodeToAdminDong("서울")).toEqual({ admCd: "1111051500", admName: "청운효자동" });
    // 인증 2번 + 지오코딩 2번
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain("accessToken=tok-2");
  });
});

describe("fetchAdminDongPopulation", () => {
  it("정상 응답에서 인구를 숫자로 준다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockResolvedValueOnce(ok({ errCd: 0, result: [{ tot_ppltn: "12345", male_ppltn: "6000", female_ppltn: "6345" }] }));
    const { fetchAdminDongPopulation } = await freshModule();
    const pop = await fetchAdminDongPopulation("1111051500", 2025);
    expect(pop).toEqual({ totalPopulation: 12345, malePopulation: 6000, femalePopulation: 6345, year: 2025 });
  });

  // 이게 가장 나빴던 경로 — 실패가 "인구 null"이 되고 화면엔 "자동수집 완료"가 떴다.
  it("errCd가 0이 아니면 null 인구가 아니라 오류를 던진다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockImplementation(async () => ok({ errCd: -300, errMsg: "서비스 점검" }));
    const { fetchAdminDongPopulation } = await freshModule();
    await expect(fetchAdminDongPopulation("1111051500", 2025)).rejects.toThrow("서비스 점검");
  });

  it("숫자가 아닌 값은 지어내지 않고 null로 둔다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockResolvedValueOnce(ok({ errCd: 0, result: [{ tot_ppltn: "12345", male_ppltn: "-" }] }));
    const { fetchAdminDongPopulation } = await freshModule();
    const pop = await fetchAdminDongPopulation("1111051500", 2025);
    expect(pop.totalPopulation).toBe(12345);
    expect(pop.malePopulation).toBeNull();
    expect(pop.femalePopulation).toBeNull();
  });

  it("HTTP 오류는 상태코드를 담아 던진다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      .mockImplementation(async () => new Response("bad gateway", { status: 502 }));
    const { fetchAdminDongPopulation } = await freshModule();
    await expect(fetchAdminDongPopulation("1111051500", 2025)).rejects.toThrow("502");
  });
});

describe("인증", () => {
  it("환경변수가 없으면 바로 알려준다", async () => {
    delete process.env.SGIS_SERVICE_ID;
    const { geocodeToAdminDong } = await freshModule();
    await expect(geocodeToAdminDong("서울")).rejects.toThrow("SGIS_SERVICE_ID");
  });

  it("토큰은 한 번만 받아서 재사용한다", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(AUTH_OK))
      // Response는 한 번만 읽을 수 있으니 호출마다 새로 만든다.
      .mockImplementation(async () => ok({ errCd: 0, result: { resultdata: [{ adm_cd: "1", full_addr: "a" }] } }));
    const { geocodeToAdminDong } = await freshModule();
    await geocodeToAdminDong("서울");
    await geocodeToAdminDong("부산");
    // 인증 1번 + 지오코딩 2번
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
