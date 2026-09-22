// 횡메르카토르(TM) 좌표변환 — WGS84 경위도를 국내 투영좌표로. (주소만 초기평가 도구 전용)
//
// `scripts/lib/tm.mjs`를 TypeScript로 옮긴 것이다. **값이 달라지면 안 되므로 급수식과
// 상수를 한 글자도 바꾸지 않았고, 같은 검산점을 테스트로 박아 뒀다**(_quickEval.test.ts).
// 스크립트(.mjs)를 Next 번들에서 바로 import할 수 없어 옮긴 것이지, 새로 만든 게 아니다.
//
// 왜 두 좌표계가 필요한가: 우리가 부르는 두 사이트가 서로 다른 좌표계를 쓴다. 하나를 다른
// 쪽에 넣으면 **에러가 아니라 엉뚱한 자리의 값이 조용히 온다.** SGIS는 빈 결과를 줘서
// "그 지점은 자료가 없다"로 오판하기 딱 좋다.
//
//   소상공인365(bigdata.sbiz.or.kr)  -> EPSG:5181 (중부원점 TM)
//   SGIS 생활권역(sgis.mods.go.kr)   -> EPSG:5179 (UTM-K)

const A = 6378137.0; // GRS80 장반경
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);

type TmParams = { lat0: number; lon0: number; k0: number; x0: number; y0: number };

function makeTM({ lat0, lon0, k0, x0, y0 }: TmParams): (lng: number, lat: number) => { x: number; y: number } {
  const LAT0 = (lat0 * Math.PI) / 180;
  const LON0 = (lon0 * Math.PI) / 180;

  const meridionalArc = (phi: number) =>
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));

  const M0 = meridionalArc(LAT0);

  return (lng: number, lat: number) => {
    const phi = (lat * Math.PI) / 180;
    const lam = (lng * Math.PI) / 180;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const tanPhi = Math.tan(phi);

    const N = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
    const T = tanPhi * tanPhi;
    const C = EP2 * cosPhi * cosPhi;
    const AA = (lam - LON0) * cosPhi;
    const M = meridionalArc(phi);

    const x =
      x0 + k0 * N * (AA + ((1 - T + C) * AA ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * AA ** 5) / 120);
    const y =
      y0 +
      k0 *
        (M -
          M0 +
          N *
            tanPhi *
            ((AA * AA) / 2 +
              ((5 - T + 9 * C + 4 * C * C) * AA ** 4) / 24 +
              ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * AA ** 6) / 720));

    return { x, y };
  };
}

const raw5181 = makeTM({ lat0: 38, lon0: 127, k0: 1, x0: 200000, y0: 500000 });
const raw5179 = makeTM({ lat0: 38, lon0: 127.5, k0: 0.9996, x0: 1000000, y0: 2000000 });

/** 소상공인365가 쓰는 좌표. 원본 앱이 Math.floor를 쓰므로 그대로 맞춘다. */
export function to5181(lng: number, lat: number): { x: number; y: number } {
  const { x, y } = raw5181(lng, lat);
  return { x: Math.floor(x), y: Math.floor(y) };
}

/** SGIS 생활권역이 쓰는 좌표(UTM-K). */
export function to5179(lng: number, lat: number): { x: number; y: number } {
  const { x, y } = raw5179(lng, lat);
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 검산점 — `scripts/lib/tm.mjs`의 selfTest가 쓰는 것과 **같은 값**이다.
 * 5181 기대값은 소상공인365 원본 앱(OpenLayers)이 실제로 만든 값과 맞춘 것이고,
 * 5179는 SGIS가 그 좌표로 정상 응답을 준 값이다. 급수식을 건드리면 여기서 바로 깨진다.
 */
export const TM_SELFTEST_CASES = [
  { name: "영월 (5181)", crs: 5181 as const, lng: 128.4617, lat: 37.1836, x: 329798, y: 410389, tol: 1 },
  { name: "서울시청 (5181)", crs: 5181 as const, lng: 126.978, lat: 37.5665, x: 198056, y: 451885, tol: 1 },
  { name: "서울시청 (5179)", crs: 5179 as const, lng: 126.978, lat: 37.5665, x: 953901, y: 1952032, tol: 2 },
] as const;

/** 수집을 시작하기 전에 부른다. 좌표가 틀리면 "자료 없는 지점"처럼 보여서 한참 뒤에야 안다. */
export function tmSelfTestFailures(): string[] {
  const failures: string[] = [];
  for (const c of TM_SELFTEST_CASES) {
    const got = c.crs === 5179 ? to5179(c.lng, c.lat) : to5181(c.lng, c.lat);
    if (Math.abs(got.x - c.x) > c.tol || Math.abs(got.y - c.y) > c.tol) {
      failures.push(`${c.name}: ${got.x},${got.y} (기대 ${c.x},${c.y})`);
    }
  }
  return failures;
}
