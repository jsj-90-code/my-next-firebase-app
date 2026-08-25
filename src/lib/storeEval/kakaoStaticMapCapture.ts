"use client";

// 입지동선평가 AI 초안(3단계)에 지도 이미지를 멀티모달로 함께 주기 위한 캡처 유틸.
// 카카오맵 JS SDK는 인터랙티브 지도(kakao.maps.Map)를 타일 이미지+DOM으로 그려서 canvas로
// 픽셀을 못 읽는다(카카오 CDN이 CORS 헤더를 안 줘서 canvas가 tainted됨). 대신 카카오는
// kakao.maps.StaticMap이라는 별도 위젯을 제공하는데, 실제로 렌더링해보면(2026-08-25 Playwright로
// 확인) 컨테이너 안에 <img src="https://spi.map.kakao.com/map2/map/imageservice?...">가 그대로
// 들어간다 — 이 URL은 인증/Referer 없이도 바로 fetch 가능한 정적 PNG였다(curl로 확인). 그래서
// 여기서는 픽셀을 직접 만들지 않고 그 img src만 뽑아서 서버(ai-location-eval 라우트)에 넘기고,
// 서버가 직접 fetch해서 Gemini에 이미지로 전달한다(브라우저 fetch/canvas의 CORS 제약을 우회).
//
// 실패해도(SDK 로드 실패, StaticMap이 이번 버전에서 다른 구조로 렌더 등) null을 반환할 뿐 예외를
// 던지지 않는다 — 지도 이미지는 "있으면 좋은" 부가 컨텍스트고, 없어도 텍스트 컨텍스트만으로
// AI 초안 생성 전체 흐름이 막히면 안 된다.

declare global {
  interface Window {
    kakao?: any;
  }
}

const SDK_SCRIPT_ID = "kakao-maps-sdk-script";
const IMG_POLL_INTERVAL_MS = 100;
const IMG_POLL_TIMEOUT_MS = 3000;

function loadKakaoSdk(jsKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.kakao?.maps) {
      resolve(true);
      return;
    }
    let script = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SDK_SCRIPT_ID;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false&libraries=services`;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => {
      if (!window.kakao?.maps) {
        resolve(false);
        return;
      }
      window.kakao.maps.load(() => resolve(true));
    });
    script.addEventListener("error", () => resolve(false));
  });
}

function waitForImageSrc(container: HTMLDivElement): Promise<string | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const img = container.querySelector("img");
      if (img?.src) {
        resolve(img.src);
        return;
      }
      if (Date.now() - start > IMG_POLL_TIMEOUT_MS) {
        resolve(null);
        return;
      }
      setTimeout(poll, IMG_POLL_INTERVAL_MS);
    };
    poll();
  });
}

/** 후보지 좌표 주변의 카카오 정적 지도 이미지 URL을 뽑아낸다. 실패 시 null. */
export async function captureKakaoStaticMapUrl(lat: number, lng: number, level = 4): Promise<string | null> {
  const jsKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  if (!jsKey) return null;

  try {
    const loaded = await loadKakaoSdk(jsKey);
    if (!loaded || !window.kakao?.maps?.StaticMap) return null;

    const container = document.createElement("div");
    container.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:640px;height:400px;";
    document.body.appendChild(container);

    try {
      const kakao = window.kakao;
      new kakao.maps.StaticMap(container, {
        center: new kakao.maps.LatLng(lat, lng),
        level,
      });
      return await waitForImageSrc(container);
    } finally {
      container.remove();
    }
  } catch {
    return null;
  }
}
