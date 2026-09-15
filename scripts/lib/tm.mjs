// 횡메르카토르(TM) 좌표변환 — WGS84 경위도를 국내 투영좌표로.
//
// 왜 공용으로 뺐나: 우리가 쓰는 두 사이트가 **서로 다른 좌표계**를 쓴다. 원점과 축척이 달라서
// 하나를 다른 쪽에 넣으면 에러가 나는 게 아니라 **엉뚱한 자리의 값이 조용히 온다.**
// SGIS는 아예 에러 없이 빈 결과를 줘서 "그 지점은 자료가 없다"로 오판하기 딱 좋다.
//
//   소상공인365(bigdata.sbiz.or.kr)  -> EPSG:5181 (중부원점)
//   SGIS 생활권역(sgis.mods.go.kr)   -> EPSG:5179 (UTM-K)
//
// proj4를 의존성으로 들이지 않으려고 Snyder 급수식을 옮겼다. 두 좌표계 모두 아는 점으로
// 검산이 되므로(selfTest) 값이 틀어지면 바로 드러난다.

const A = 6378137.0; // GRS80 장반경
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);

function makeTM({ lat0, lon0, k0, x0, y0 }) {
  const LAT0 = (lat0 * Math.PI) / 180;
  const LON0 = (lon0 * Math.PI) / 180;

  const meridionalArc = (phi) =>
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));

  const M0 = meridionalArc(LAT0);

  return (lng, lat) => {
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
export function to5181(lng, lat) {
  const { x, y } = raw5181(lng, lat);
  return { x: Math.floor(x), y: Math.floor(y) };
}

/** SGIS 생활권역이 쓰는 좌표(UTM-K). */
export function to5179(lng, lat) {
  const { x, y } = raw5179(lng, lat);
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 아는 점으로 검산한다. 수집을 시작하기 전에 반드시 부른다 —
 * 좌표가 틀리면 "자료가 없는 지점"처럼 보여서 한참 뒤에야 알게 된다.
 * 5181 기대값은 소상공인365 원본 앱(OpenLayers)이 실제로 만든 값과 맞춘 것이다.
 */
export function selfTest(log = console.log) {
  const cases = [
    { name: "영월 (5181)", fn: to5181, lng: 128.4617, lat: 37.1836, x: 329798, y: 410389, tol: 1 },
    { name: "서울시청 (5181)", fn: to5181, lng: 126.978, lat: 37.5665, x: 198056, y: 451885, tol: 1 },
    { name: "서울시청 (5179)", fn: to5179, lng: 126.978, lat: 37.5665, x: 953901, y: 1952032, tol: 2 },
  ];
  let ok = true;
  for (const c of cases) {
    const got = c.fn(c.lng, c.lat);
    const dx = Math.abs(got.x - c.x);
    const dy = Math.abs(got.y - c.y);
    const pass = dx <= c.tol && dy <= c.tol;
    ok &&= pass;
    log(`${pass ? "✅" : "❌"} ${c.name}: ${got.x},${got.y} (기대 ${c.x},${c.y})`);
  }
  return ok;
}
