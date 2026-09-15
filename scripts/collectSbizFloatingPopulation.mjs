// 소상공인365(bigdata.sbiz.or.kr) 상권분석 리포트에서 **반경별 월별 일평균 유동인구**를 모은다.
//
// 왜: 교과서식 산식이 지금 자료로는 MAPE 29%가 한계라는 게 조합 50,400개 전수로 확인됐고
// (docs/textbook-model-handoff-2026-09-15.md 5~6절), 밀집도 보정도 역효과였다. 새 자료 없이
// 넘을 벽이 아니라는 결론이라, 지금 없는 **100~400m 반경 유동인구**를 받아온다.
// 500m·1km는 이미 갖고 있으므로 겹쳐 보면 단조성 검증까지 된다.
//
// 경로 전문과 발견 과정은 같은 문서 8절에 있다. 요약하면 지점당 3단계다:
//   1) POST /gis/com/report/capture.json      -> analyNo 발급 (radius가 자유 파라미터)
//   2) GET  /gis/bizonAnls/report/sg/sang_gwon1.sg -> 응답 HTML의 aACd/aANm(행정동) 확보
//   3) GET  /gis/bizonAnls/report/sg/sang_gwon4.sg -> flowPopCnt "선택 영역" 13개월 값
// 2단계는 위치에만 달려 있어 지점당 한 번만 한다(반경마다 다시 하지 않는다).
//
// 사용법:
//   node scripts/collectSbizFloatingPopulation.mjs --selftest   # 좌표변환만 검산(네트워크 안 씀)
//   node scripts/collectSbizFloatingPopulation.mjs --limit 3     # 3곳만 시험
//   node scripts/collectSbizFloatingPopulation.mjs               # 전체
//
// 산출물: .local-tools/sbiz-floating-population.json (운영 자료라 git 제외)
// **이어받기 가능하다** — 지점 하나 끝날 때마다 저장하고, 다시 돌리면 이미 받은 건 건너뛴다.
//
// ⚠️ 남의 공개 사이트를 여러 번 부른다. 기본 간격 1.2초를 줄이지 말 것.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/sbiz-floating-population.json";
// 500·1000은 2026-09-15에 추가했다. 기존 floating500Avg는 출처가 달라(시트 경유) 앞뒤가
// 안 맞는 곳이 있었다 — 호구포역점은 400m 96,280인데 500m가 35,105로 **반경이 커졌는데 인구가
// 줄어드는** 모순이었다. 같은 출처로 다시 받아 비교하려는 것이며, 기존 필드는 덮어쓰지 않는다
// (writeFloatingPopulationToFirestore.mjs가 100~400만 쓴다).
const RADII = [100, 200, 300, 400, 500, 1000];
const PCBANG_UPJONG = "R10406"; // 예술·스포츠 > 유원지·오락 > PC방
const BASE = "https://bigdata.sbiz.or.kr";
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS || 1200);

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : null;

/* ---------------------------------------------------------------- 좌표변환
 * EPSG:4326 -> EPSG:5181 (중부원점 TM, GRS80, lat_0=38 lon_0=127 k=1 x_0=200000 y_0=500000).
 * proj4를 새 의존성으로 들이지 않으려고 Snyder 급수식을 그대로 옮겼다. towgs84가 전부 0이라
 * WGS84와 GRS80을 같은 것으로 봐도 되므로 데이텀 변환은 없다.
 * 검산값 두 개를 --selftest로 항상 확인할 수 있게 해뒀다. */
const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);
const K0 = 1;
const LAT0 = (38 * Math.PI) / 180;
const LON0 = (127 * Math.PI) / 180;
const X0 = 200000;
const Y0 = 500000;

function meridionalArc(phi) {
  return (
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * phi))
  );
}
const M0 = meridionalArc(LAT0);

export function toTM(lng, lat) {
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
    X0 +
    K0 *
      N *
      (AA +
        ((1 - T + C) * AA ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * AA ** 5) / 120);
  const y =
    Y0 +
    K0 *
      (M -
        M0 +
        N *
          tanPhi *
          ((AA * AA) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * AA ** 4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * AA ** 6) / 720));

  return { x: Math.floor(x), y: Math.floor(y) };
}

function selftest() {
  const cases = [
    { name: "영월 N014", lng: 128.4617, lat: 37.1836, x: 329798, y: 410389 },
    { name: "서울시청", lng: 126.978, lat: 37.5665, x: 198056, y: 451885 },
  ];
  let ok = true;
  for (const c of cases) {
    const got = toTM(c.lng, c.lat);
    const dx = Math.abs(got.x - c.x);
    const dy = Math.abs(got.y - c.y);
    const pass = dx <= 1 && dy <= 1;
    ok &&= pass;
    console.log(`${pass ? "✅" : "❌"} ${c.name}: ${got.x},${got.y} (기대 ${c.x},${c.y}, 차이 ${dx},${dy})`);
  }
  return ok;
}

/* ---------------------------------------------------------------- 호출부 */
const HEADERS = {
  Referer: `${BASE}/gis/locAnls`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function issueAnalyNo({ lat, lng, tm, radius }) {
  const res = await fetch(`${BASE}/gis/com/report/capture.json`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify({
      type: "circleRadius",
      analyType: "bizonAnls",
      centerX: lat, // 이름과 달리 centerX가 위도다 (원본 앱이 그렇게 보낸다)
      centerY: lng,
      transformX: tm.x,
      transformY: tm.y,
      upjongCd: PCBANG_UPJONG,
      kakaoPathStr: "",
      pathStr: "",
      radius,
      mapLevelDecision: radius,
      apiLogin: "N",
      sprNo: 0,
    }),
  });
  if (!res.ok) throw new Error(`capture.json HTTP ${res.status}`);
  const json = await res.json();
  if (!json.analyNo) throw new Error(`analyNo 없음: ${JSON.stringify(json).slice(0, 120)}`);
  return json;
}

async function fetchTab(tab, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/gis/bizonAnls/report/sg/sang_gwon${tab}.sg?${qs}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`sang_gwon${tab} HTTP ${res.status}`);
  return res.text();
}

/** 탭1 HTML에서 행정동코드/이름을 캔다. 탭2~8이 이걸 요구한다(없으면 전부 500). */
function parseAdmin(html) {
  const cd = html.match(/var\s+aACd\s*=\s*"([^"]*)"/);
  const nm = html.match(/var\s+aANm\s*=\s*"([^"]*)"/);
  if (!cd?.[1]) throw new Error("aACd를 못 찾았다 — 응답 구조가 바뀌었을 수 있다");
  return { admiCd: cd[1], admiNm: nm?.[1] ?? "" };
}

/**
 * 탭4 HTML의 "성별/연령대별 일평균 유동인구" 표에서 선택 영역 행을 캔다.
 *
 * ⚠️ 같은 모양의 표가 주거인구·직장인구에도 있다. 그래서 `<dt>성별/연령대별 일평균 유동인구</dt>`
 * 를 앵커로 잡고 그 뒤 첫 표만 본다 — 앵커 없이 첫 표를 집으면 조용히 엉뚱한 값이 들어온다.
 *
 * 스키마의 floating{R}Male / floating{R}_10s~_60plus 를 그대로 채우는 값이다.
 */
function parseDemographics(html) {
  const anchor = html.indexOf("성별/연령대별 일평균 유동인구");
  if (anchor === -1) return null;
  const section = html.slice(anchor, anchor + 20000);
  const row = section.match(
    /<th[^>]*rowspan="2"[^>]*>\s*선택 영역\s*<\/th>[\s\S]{0,200}?<td[^>]*rowspan="2"[^>]*>([\d,]+)<\/td>((?:[\s\S]{0,40}?<td[^>]*>[\d,.]+<\/td>){8})/,
  );
  if (!row) return null;
  const num = (s) => Number(String(s).replace(/,/g, ""));
  const cells = [...row[2].matchAll(/<td[^>]*>([\d,.]+)<\/td>/g)].map((m) => num(m[1]));
  if (cells.length < 8) return null;
  return {
    total: num(row[1]),
    male: cells[0],
    female: cells[1],
    age10s: cells[2],
    age20s: cells[3],
    age30s: cells[4],
    age40s: cells[5],
    age50s: cells[6],
    age60plus: cells[7],
  };
}

/** 탭4 HTML에서 월 라벨과 계열별 값을 캔다. "선택 영역"이 우리가 준 반경 원이다. */
function parseFlowPopulation(html) {
  const months = [...html.matchAll(/flowByMnth\.push\("([^"]*)"\)/g)].map((m) => m[1]);
  const series = {};
  const blocks = html.matchAll(/flowPopCnt\.push\(\{\s*name\s*:\s*"([^"]*)"\s*,\s*data\s*:\s*\[([\s\S]*?)\]/g);
  for (const b of blocks) {
    const values = [...b[2].matchAll(/Number\("([^"]*)"\)/g)].map((m) => Number(m[1]));
    series[b[1]] = values;
  }
  return { months, selected: series["선택 영역"] ?? null, series };
}

/* ---------------------------------------------------------------- 대상
 * 좌표는 두 곳에서 온다:
 *   1) 운영 스냅샷의 lat/lng — 후보지는 대체로 채워져 있다
 *   2) .local-tools/geocoded-sites.json — 기존점 41곳은 운영 DB에 좌표가 아예 없어서
 *      scripts/geocodeExistingStores.mjs 로 주소를 변환해 만든 파일 (운영 DB는 안 건드린다)
 * 둘 다 없으면 그 지점은 건너뛴다. 좌표를 지어내지 않는다. */
const GEOCODED = ".local-tools/geocoded-sites.json";

function loadTargets() {
  if (!existsSync(SNAPSHOT)) {
    console.error(`${SNAPSHOT}이 없다. 먼저 node scripts/dumpValidationSnapshot.mjs 를 돌린다.`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const geo = existsSync(GEOCODED) ? JSON.parse(readFileSync(GEOCODED, "utf8")).sites ?? {} : {};

  const targets = [];
  const noCoord = [];
  const add = (kind, code, name, lat, lng) => {
    const key = `${kind}:${code}`;
    const fromGeo = geo[key];
    const finalLat = lat ?? fromGeo?.lat ?? null;
    const finalLng = lng ?? fromGeo?.lng ?? null;
    if (finalLat && finalLng) {
      targets.push({ kind, code, name, lat: finalLat, lng: finalLng, coordSource: lat ? "운영DB" : "주소변환" });
    } else {
      noCoord.push(`${code} ${name}`);
    }
  };

  for (const c of snap.candidates ?? []) add("candidate", c.code ?? c.id, c.name ?? "", c.lat, c.lng);
  for (const e of snap.existingStores ?? []) add("existing", e.storeCode ?? e.id, e.storeName ?? "", e.lat, e.lng);

  if (noCoord.length) {
    console.log(`\n⚠️ 좌표가 없어 제외한 ${noCoord.length}곳: ${noCoord.slice(0, 5).join(", ")}${noCoord.length > 5 ? " …" : ""}`);
    console.log("   node scripts/geocodeExistingStores.mjs 를 먼저 돌리면 대부분 채워진다.");
  }
  return { targets, missing: noCoord.length };
}

/* ---------------------------------------------------------------- 본체 */
if (args.includes("--selftest")) {
  process.exit(selftest() ? 0 : 1);
}

if (!selftest()) {
  console.error("좌표변환 검산 실패 — 수집을 시작하지 않는다.");
  process.exit(1);
}

const { targets: allTargets, missing } = loadTargets();
const targets = LIMIT ? allTargets.slice(0, LIMIT) : allTargets;
console.log(`\n대상 ${targets.length}곳 (좌표 없어 제외 ${missing}곳) · 반경 ${RADII.join("/")}m · 간격 ${DELAY_MS}ms`);

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { collectedAt: null, sites: {} };
let done = 0;
let skipped = 0;
let failed = 0;

for (const t of targets) {
  const key = `${t.kind}:${t.code}`;
  // 연령·성별 표는 2026-09-15에 나중에 추가했다. 그 전에 받은 지점은 selected만 있고
  // demographics가 없으므로 다시 받는다 — 저장해둔 analyNo를 그대로 쓰니 캡처는 다시 안 한다.
  const already = out.sites[key];
  if (already && RADII.every((r) => already.radii?.[r]?.selected && already.radii?.[r]?.demographics)) {
    skipped++;
    continue;
  }

  const tm = toTM(t.lng, t.lat);
  const record = already ?? { kind: t.kind, code: t.code, name: t.name, lat: t.lat, lng: t.lng, tm, radii: {} };

  try {
    // 행정동코드는 위치에만 달려 있다 — 지점당 한 번만 캔다.
    if (!record.admiCd) {
      const first = await issueAnalyNo({ lat: t.lat, lng: t.lng, tm, radius: RADII[0] });
      await sleep(DELAY_MS);
      const tab1 = await fetchTab(1, {
        analyNo: first.analyNo,
        kmAnalyNo: "",
        upjongCd: PCBANG_UPJONG,
        xcnts: tm.x,
        ydnts: tm.y,
        center_x: tm.x,
        center_y: tm.y,
        analyDate: first.analyDate,
        a: "01",
        b: "01",
        c: "01",
        apiLogin: "",
        lKey: "",
        xtLoginId: "",
      });
      Object.assign(record, parseAdmin(tab1));
      record.radii[RADII[0]] = { analyNo: first.analyNo, analyDate: first.analyDate };
      await sleep(DELAY_MS);
    }

    for (const radius of RADII) {
      if (record.radii[radius]?.selected && record.radii[radius]?.demographics) continue;
      let entry = record.radii[radius];
      if (!entry?.analyNo) {
        entry = await issueAnalyNo({ lat: t.lat, lng: t.lng, tm, radius });
        record.radii[radius] = entry;
        await sleep(DELAY_MS);
      }
      const tab4 = await fetchTab(4, {
        analyNo: entry.analyNo,
        analyDate: entry.analyDate,
        upjongCd: PCBANG_UPJONG,
        admiCd: record.admiCd,
        admiNm: record.admiNm,
        kmAnalyNo: "",
        xtLoginId: "",
      });
      const parsed = parseFlowPopulation(tab4);
      const demographics = parseDemographics(tab4);
      record.radii[radius] = { ...entry, ...parsed, demographics };
      await sleep(DELAY_MS);
    }

    out.sites[key] = record;
    out.collectedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
    done++;

    const v = RADII.map((r) => record.radii[r]?.selected?.at(-1) ?? "?").join(" / ");
    console.log(`  ${key} ${t.name} — 최근월 ${v} 명 (${done}/${targets.length - skipped})`);
  } catch (err) {
    failed++;
    console.error(`  ✖ ${key} ${t.name}: ${err.message}`);
  }
}

console.log(`\n완료 ${done}곳 · 건너뜀 ${skipped}곳 · 실패 ${failed}곳 -> ${OUT}`);
console.log("실패가 있으면 그냥 다시 돌리면 된다 — 끝난 지점은 건너뛴다.");
