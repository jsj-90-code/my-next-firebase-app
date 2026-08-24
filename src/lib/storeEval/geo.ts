// 순수 좌표 계산 유틸 — Firebase/외부 API에 의존하지 않아 유닛테스트로 검증 가능하다.

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 두 좌표 사이의 직선거리(m) — 하버사인 공식. */
export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 후보지 후보 목록 중 같은 주소이거나(도로명주소 완전일치) 반경 thresholdM 이내인 항목을 찾는다.
 * 중복 후보지 경고용 — 실제로 지우거나 막지는 않고 사용자에게 알려주기만 한다.
 */
export function findNearbyCandidates<
  T extends { code: string; lat: number | null; lng: number | null; roadAddress: string | null },
>(target: { code: string; lat: number | null; lng: number | null; roadAddress: string | null }, others: T[], thresholdM: number): T[] {
  return others.filter((o) => {
    if (o.code === target.code) return false;
    if (target.roadAddress && o.roadAddress && target.roadAddress === o.roadAddress) return true;
    if (target.lat == null || target.lng == null || o.lat == null || o.lng == null) return false;
    return haversineDistanceMeters({ lat: target.lat, lng: target.lng }, { lat: o.lat, lng: o.lng }) <= thresholdM;
  });
}
