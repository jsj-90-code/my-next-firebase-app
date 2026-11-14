import "server-only";

import proj4 from "proj4";

import { fetchKakaoMapImage } from "@/lib/server/kakaoMapImage";

// 측정기 아티팩트(claude.ai)의 「주변 1km」 지도 바탕 그림.
// 아티팩트는 카카오 지도 프로그램(dapi.kakao.com)을 불러올 수 없어서, 서버가 카카오 정적 지도 그림을 받아
// data URL로 넘기고 화면은 그 위에 점을 얹는다. 그림 주소(spi.map.kakao.com imageservice)는 카카오 지도 SDK의
// StaticMap이 내부에서 쓰는 주소다(공개 API 아님 — 바뀌면 map:null로 떨어지고 화면은 거리 그림으로 돌아간다).
// 좌표: 카카오 WCONGNAMUL = EPSG:5181(GRS80 TM, 중부원점 127°, x_0 200000, y_0 500000) × 2.5.
// 2026-11-15 서울시청 좌표로 그림 한가운데가 시청에 오는 것을 눈으로 확인. SCALE = 그림 1px당 WCONGNAMUL 단위
// (2.5 = 1m/px).

const EPSG5181 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";
const SIZE_PX = 1000;

export type NearbyMap = {
  image: string;
  width: number;
  height: number;
  metersPerPx: number;
  /** 위경도 → 그림 픽셀 */
  toPx: (p: { lat: number; lng: number }) => { px: number; py: number };
};

function wcong(lat: number, lng: number): [number, number] {
  const [x, y] = proj4("EPSG:4326", EPSG5181, [lng, lat]);
  return [x * 2.5, y * 2.5];
}

export async function kakaoNearbyMap(center: { lat: number; lng: number }, radiusM: number): Promise<NearbyMap> {
  // 반경의 2.2배가 그림 한 변에 들어가게(가장자리 점·글자 여유).
  const metersPerPx = Math.max(1, Math.round(((radiusM * 2.2) / SIZE_PX) * 10) / 10);
  const scale = metersPerPx * 2.5;
  const [cx, cy] = wcong(center.lat, center.lng);
  const url = `https://spi.map.kakao.com/map2/map/imageservice?IW=${SIZE_PX}&IH=${SIZE_PX}&MX=${Math.round(cx)}&MY=${Math.round(cy)}&SCALE=${scale}&service=open`;
  const img = await fetchKakaoMapImage(url);
  const half = SIZE_PX / 2;
  return {
    image: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
    width: SIZE_PX,
    height: SIZE_PX,
    metersPerPx,
    toPx: (p) => {
      const [x, y] = wcong(p.lat, p.lng);
      return { px: Math.round((half + (x - Math.round(cx)) / scale) * 10) / 10, py: Math.round((half - (y - Math.round(cy)) / scale) * 10) / 10 };
    },
  };
}
