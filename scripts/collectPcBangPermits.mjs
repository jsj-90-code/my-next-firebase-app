// 전국 PC방 인허가 자료 수집 — 공공데이터포털 (2026-09-22 신설)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 산식이 필요한 건 "지금 영업 중"이 아니라 **평가창 당시 영업 여부**다. 지도(카카오)는
// "지금"만 알려주고 폐업도 섞여 있다. 인허가 자료에는 `인허가일자`와 `폐업일자`가 있어
// **임의 시점의 영업 여부**를 정확히 낼 수 있다. 사람 판정보다 정확하고(시점까지 맞다)
// 매장이 늘어도 자동으로 따라온다.
//
// ── ⚠️ localdata.go.kr은 없어졌다 ─────────────────────────────────────────
// 2026-04-16에 지방행정인허가데이터개방 시스템이 **폐쇄**됐다. 공공데이터포털의
// "행정안전부_문화_인터넷컴퓨터게임시설제공업 조회서비스"가 그 자리를 대신한다.
// data.go.kr의 옛 파일데이터 페이지(15045073)는 아직 죽은 localdata 주소를 가리키므로
// 그쪽으로 가면 안 된다.
//   신청: https://www.data.go.kr/data/15154951/openapi.do  (무료·자동승인·개발계정 일 1만건)
//
// ── 자료에 대해 알아 둘 것 ────────────────────────────────────────────────
// · 좌표는 **EPSG:5174**(보정계수 미적용 Bessel 중부원점TM)다. 우리 좌표(WGS84)와 그냥
//   섞으면 수백 m씩 어긋난다 — 여기서 변환해서 저장한다.
// · `TOTAL_GMCON_CNT`(총게임기수)는 **PC 대수가 아니다.** 채움률 71%에 중앙값이 7대다
//   (60대로 적은 곳도 있어 기준이 제각각이다). 대수로 쓰면 안 된다.
// · `FCAR`(시설면적)는 100% 채워져 있다. 대수 추정 기전의 후보이지 아직 쓰는 값이 아니다.
// · 한 페이지 최대 100건이라 전국 8만여 건에 800페이지쯤 든다(일 한도 1만건 안).
//
// 실행:
//   node scripts/collectPcBangPermits.mjs
//   node scripts/collectPcBangPermits.mjs --limit 5      # 맛보기(5페이지만)
// 필요한 환경변수: PUBLICDATA_SERVICE_KEY (.env.local)
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import proj4 from "proj4";

/** 다른 수집기(collectKakao*·collectSbiz*)와 **같은 방식**이다. 잣대를 둘로 만들지 않는다. */
function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = v;
  }
}
loadEnvLocal();

const KEY = process.env.PUBLICDATA_SERVICE_KEY;
if (!KEY) {
  console.error("PUBLICDATA_SERVICE_KEY가 없다. .env.local에 넣어라.");
  console.error("  발급: https://www.data.go.kr/data/15154951/openapi.do 의 [활용신청](자동승인)");
  console.error("  마이페이지 > 오픈API > 개발계정 > 일반 인증키(Decoding)");
  process.exit(1);
}

const BASE = "https://apis.data.go.kr/1741000/pc_bangs/info";
const OUT = ".local-tools/pcbang-permits.json";
const PER_PAGE = 100;                                   // API 상한
const CONCURRENCY = Number(process.env.PERMIT_CONCURRENCY ?? 5);
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

// 보정계수 미적용 Bessel 중부원점TM. false origin이 (200000, 500000)이다.
proj4.defs("EPSG:5174",
  "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000"
  + " +ellps=bessel +units=m +no_defs"
  + " +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43");

/** EPSG:5174 -> WGS84. 값이 이상하면 null(우리 좌표와 섞이면 조용히 틀린다). */
function toWgs84(xRaw, yRaw) {
  const x = Number(xRaw), y = Number(yRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;
  const [lng, lat] = proj4("EPSG:5174", "EPSG:4326", [x, y]);
  // 대한민국 밖으로 나오면 변환이 깨진 것이다 — 지어내지 말고 버린다.
  if (!(lat > 32 && lat < 40 && lng > 124 && lng < 132)) return null;
  return { lat, lng };
}

/** 날짜는 "2026-09-19"로도 "20260919"로도 온다. YYYY-MM-DD로 통일하고, 없으면 null. */
function ymd(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function fetchPage(pageNo, tries = 3) {
  const url = `${BASE}?serviceKey=${encodeURIComponent(KEY)}&pageNo=${pageNo}`
    + `&numOfRows=${PER_PAGE}&returnType=json`;
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const body = j?.response?.body;
      if (!body) throw new Error(`본문 없음: ${JSON.stringify(j).slice(0, 200)}`);
      return body;
    } catch (e) {
      if (t === tries) throw new Error(`${pageNo}쪽 실패: ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * t));
    }
  }
}

const main = async () => {
  const first = await fetchPage(1);
  const total = Number(first.totalCount);
  const pages = Math.min(Math.ceil(total / PER_PAGE), LIMIT);
  console.log(`전국 인터넷컴퓨터게임시설제공업 ${total.toLocaleString()}건 · ${pages}쪽 (쪽당 ${PER_PAGE}건)`);

  const rows = [];
  let dropped = 0;
  const take = (items) => {
    for (const x of items ?? []) {
      const c = toWgs84(x.CRD_INFO_X, x.CRD_INFO_Y);
      if (!c) { dropped++; continue; }
      rows.push({
        // 관리번호+자치단체코드가 이 자료의 열쇠다(같은 상호가 전국에 널려 있다).
        id: `${x.OPN_ATMY_GRP_CD}-${x.MNG_NO}`,
        name: String(x.BPLC_NM ?? "").trim(),
        lat: +c.lat.toFixed(7), lng: +c.lng.toFixed(7),
        open: ymd(x.LCPMT_YMD),            // 인허가일자
        close: ymd(x.CLSBIZ_YMD),          // 폐업일자 — 없으면 null
        status: String(x.SALS_STTS_NM ?? "").trim(),        // 영업/정상 · 폐업 …
        detail: String(x.DTL_SALS_STTS_NM ?? "").trim(),    // 영업중 · 폐업 · 휴업 …
        // 휴업 구간도 "그때 영업했나"에 걸린다 — 있으면 같이 싣는다.
        restFrom: ymd(x.TCBIZ_BGNG_YMD), restTo: ymd(x.TCBIZ_END_YMD),
        addr: String(x.ROAD_NM_ADDR ?? x.LOTNO_ADDR ?? "").trim(),
        // ⚠️ 대수가 아니다. 대수로 쓰지 마라(파일 머리 주석). 진단용으로만 싣는다.
        area: x.FCAR ? Number(x.FCAR) : null,
        gameCount: x.TOTAL_GMCON_CNT ? Number(x.TOTAL_GMCON_CNT) : null,
      });
    }
  };
  take(first.items?.item);

  // 남은 쪽을 몇 개씩 묶어 받는다. 공공 API라 과하게 때리지 않는다.
  const queue = [];
  for (let p = 2; p <= pages; p++) queue.push(p);
  let done = 1;
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      const body = await fetchPage(p);
      take(body.items?.item);
      done++;
      if (done % 50 === 0) process.stdout.write(`  ${done}/${pages}쪽 · ${rows.length.toLocaleString()}건\n`);
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const open = rows.filter((r) => !r.close).length;
  mkdirSync(".local-tools", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    collectedAt: new Date().toISOString(),
    source: "공공데이터포털 행정안전부_문화_인터넷컴퓨터게임시설제공업 조회서비스(15154951)",
    crs: "원본 EPSG:5174 -> 저장은 WGS84",
    totalCount: total, saved: rows.length, droppedNoCoord: dropped,
    rows,
  }, null, 0));
  console.log(`\n저장 ${OUT}`);
  console.log(`  받은 건 ${rows.length.toLocaleString()} · 좌표 없어 버린 건 ${dropped.toLocaleString()}`);
  console.log(`  폐업일자 없는 건(=아직 영업) ${open.toLocaleString()} · 폐업 ${(rows.length - open).toLocaleString()}`);
  console.log(`  ⚠️ 이 파일은 좌표가 WGS84로 이미 변환돼 있다. 다시 변환하지 마라.`);
};

main().catch((e) => { console.error(e); process.exit(1); });
