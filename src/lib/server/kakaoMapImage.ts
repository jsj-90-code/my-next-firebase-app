import "server-only";

const KAKAO_MAP_HOST = "spi.map.kakao.com";
const KAKAO_MAP_PATH = "/map2/map/imageservice";
const MAX_MAP_IMAGE_BYTES = 5 * 1024 * 1024;
const MAP_IMAGE_TIMEOUT_MS = 10_000;
type AllowedMapImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type FetchedKakaoMapImage = {
  buffer: Buffer;
  mimeType: AllowedMapImageMimeType;
};

export function isAllowedKakaoMapImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === KAKAO_MAP_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === KAKAO_MAP_PATH
    );
  } catch {
    return false;
  }
}

export async function fetchKakaoMapImage(rawUrl: string): Promise<FetchedKakaoMapImage> {
  if (!isAllowedKakaoMapImageUrl(rawUrl)) {
    throw new Error("허용되지 않은 지도 이미지 주소입니다.");
  }

  const response = await fetch(rawUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(MAP_IMAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
    throw new Error("지도 응답이 이미지 형식이 아닙니다.");
  }
  const mimeType = contentType as AllowedMapImageMimeType;

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MAP_IMAGE_BYTES) {
    throw new Error("지도 이미지 용량이 5MB를 초과합니다.");
  }

  if (!response.body) throw new Error("지도 이미지 본문이 비어 있습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MAP_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("지도 이미지 용량이 5MB를 초과합니다.");
    }
    chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes), mimeType };
}
