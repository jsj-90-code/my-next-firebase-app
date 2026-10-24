// 측정기 지도(/api/ping-monitor/nearby) 공용 상수·타입 — 화면과 라우트가 같이 쓴다.
export const PING_MAP_RADIUS_M = 1000; // 사용자 2026-10-16 "반경 1km"

export type NearbyPlace = { id: string; name: string; address: string; category: string; lat: number; lng: number; distanceM: number };
export type NearbyResponse = {
  geocoded?: Record<string, { lat: number; lng: number; roadAddress: string | null; jibunAddress?: string | null } | null>;
  pcBangs?: NearbyPlace[];
  demandPoints?: NearbyPlace[];
};

/** 두 좌표 사이 직선거리(m). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
