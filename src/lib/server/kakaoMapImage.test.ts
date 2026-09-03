import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchKakaoMapImage, isAllowedKakaoMapImageUrl } from "./kakaoMapImage";

const allowedUrl = "https://spi.map.kakao.com/map2/map/imageservice?x=1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAllowedKakaoMapImageUrl", () => {
  it("카카오 정적 지도 HTTPS URL만 허용한다", () => {
    expect(isAllowedKakaoMapImageUrl("https://spi.map.kakao.com/map2/map/imageservice?x=1")).toBe(true);
    expect(isAllowedKakaoMapImageUrl("http://spi.map.kakao.com/map2/map/imageservice?x=1")).toBe(false);
    expect(isAllowedKakaoMapImageUrl("https://evil.example/map2/map/imageservice")).toBe(false);
    expect(isAllowedKakaoMapImageUrl("https://spi.map.kakao.com.evil.example/map2/map/imageservice")).toBe(false);
    expect(isAllowedKakaoMapImageUrl("https://spi.map.kakao.com/map2/map/imageservice.evil")).toBe(false);
    expect(isAllowedKakaoMapImageUrl("https://spi.map.kakao.com:444/map2/map/imageservice")).toBe(false);
    expect(isAllowedKakaoMapImageUrl("https://user:pass@spi.map.kakao.com/map2/map/imageservice")).toBe(false);
    expect(isAllowedKakaoMapImageUrl("not-a-url")).toBe(false);
  });

  it("허용된 이미지 응답만 Buffer로 읽고 리디렉션을 금지한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchKakaoMapImage(allowedUrl)).resolves.toEqual({
      buffer: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      allowedUrl,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("이미지가 아닌 응답과 선언된 5MB 초과 응답을 거부한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("html", { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": String(5 * 1024 * 1024 + 1) },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchKakaoMapImage(allowedUrl)).rejects.toThrow("지도 응답이 이미지 형식이 아닙니다.");
    await expect(fetchKakaoMapImage(allowedUrl)).rejects.toThrow("지도 이미지 용량이 5MB를 초과합니다.");
  });

  it("content-length가 없어도 실제 스트림이 5MB를 넘으면 중단한다", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(oversized, { status: 200, headers: { "content-type": "image/webp" } })),
    );

    await expect(fetchKakaoMapImage(allowedUrl)).rejects.toThrow("지도 이미지 용량이 5MB를 초과합니다.");
  });
});
