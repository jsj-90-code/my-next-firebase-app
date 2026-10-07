// 배후지 나눠 갖기(허프) 재료 1 — 자리 주변 **상권 목록과 크기**를 모은다 (2026-10-07 신설)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 후보지 근처에 상권이 여럿 있어 배후지가 겹칠 때, 배후 주민이 우리 상권으로 오는지 옆 상권으로
// 가는지 알고 싶다(사용자 2026-10-07). 무료 OD 이동 자료는 서울만 행정동이라 못 쓴다
// (`docs/od-mobility-sources-20261007.md`). 대신 상권 분석 표준인 허프 모델 — "주민은 크고
// 가까운 상권으로 간다" — 으로 배후 주민을 상권별로 나눈다. 이 스크립트는 그 "상권" 쪽 재료다.
//
// 자료원: 소상공인 상가(상권)정보 API(data.go.kr 15012005) — 인허가·상가업소 수집기와 같은 키.
//   storeZoneInRadius : 반경 안 **주요상권**(소상공인진흥공단 지정) 목록 + 경계 다각형
//   storeListInArea   : 상권 번호로 그 안 점포 수(전체 · PC방 R10406)
//   storeListInRadius : 상권 중심·우리 자리에서 반경 500m 점포 수(같은 잣대)
// ⚠️ 반경 상한이 2000m라 자리 중심 + 둘레 2km 6곳에서 불러 반경 약 4km를 덮는다.
// ⚠️ 시점은 "지금"뿐이다(상가업소와 같다).
//
// 실행:
//   node scripts/collectTradeZones.mjs --limit 2   # 2곳만 시험
//   node scripts/collectTradeZones.mjs             # 전부 (이미 받은 상권·자리는 건너뜀)
//
// 산출물: .local-tools/trade-zones.json  { sites: {code: {zoneNos[]}}, zones: {trarNo: {...}} }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvLocal, loadHuffSites, offsetLatLng } from "./lib/huffSites.mjs";

loadEnvLocal();
const KEY = process.env.PUBLICDATA_SERVICE_KEY;
if (!KEY) {
  console.error("PUBLICDATA_SERVICE_KEY가 .env.local에 필요하다.");
  process.exit(1);
}
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const OUT = ".local-tools/trade-zones.json";
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS ?? 200);
const RING_M = 2000; // 둘레 조회점까지 거리
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const argValue = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : Infinity;

async function call(op, params, tries = 3) {
  const q = new URLSearchParams({ serviceKey: KEY, type: "json", ...params });
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(`${BASE}/${op}?${q}`, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      const body = JSON.parse(text);
      const code = body.header?.resultCode;
      // 03 = 데이터 없음(정상). 그 밖의 코드는 실패로 본다.
      if (code === "03") return { items: [], totalCount: 0 };
      if (code !== "00") throw new Error(`${op} resultCode=${code} ${body.header?.resultMsg ?? ""}`);
      return { items: body.body?.items ?? [], totalCount: Number(body.body?.totalCount ?? 0) };
    } catch (e) {
      if (t === tries) throw e;
      await sleep(1000 * t);
    }
  }
}

/** POLYGON((x y, ...)) / MULTIPOLYGON → 꼭짓점 평균 중심(작은 상권엔 충분). */
function centroid(wkt) {
  const nums = String(wkt).match(/-?\d+\.\d+\s+-?\d+\.\d+/g) ?? [];
  let sx = 0, sy = 0;
  for (const p of nums) {
    const [x, y] = p.split(/\s+/).map(Number);
    sx += x; sy += y;
  }
  return nums.length ? { lng: sx / nums.length, lat: sy / nums.length } : null;
}

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { sites: {}, zones: {} };
const save = () => writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");

const sites = loadHuffSites().slice(0, LIMIT);
console.log(`자리 ${sites.length}곳`);

for (const s of sites) {
  if (out.sites[s.code]?.zoneNos) continue;
  const points = [{ lat: s.lat, lng: s.lng }];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    points.push(offsetLatLng(s.lat, s.lng, RING_M * Math.cos(a), RING_M * Math.sin(a)));
  }
  const zoneNos = new Set();
  for (const p of points) {
    const { items } = await call("storeZoneInRadius", { radius: "2000", cx: String(p.lng), cy: String(p.lat) });
    for (const it of items) {
      zoneNos.add(String(it.trarNo));
      if (!out.zones[it.trarNo]) {
        out.zones[it.trarNo] = {
          trarNo: String(it.trarNo),
          name: it.mainTrarNm,
          sido: it.ctprvnNm,
          sigungu: it.signguNm,
          areaM2: Number(it.trarArea),
          center: centroid(it.coords),
          stdrDt: it.stdrDt,
        };
      }
    }
    await sleep(DELAY_MS);
  }
  out.sites[s.code] = { name: s.name, kind: s.kind, lat: s.lat, lng: s.lng, zoneNos: [...zoneNos] };
  console.log(`${s.code} ${s.name}: 상권 ${zoneNos.size}곳`);
  save();
}

// 상권별 점포 수 — 전체·음식·여가·PC방. 이미 받은 칸은 건너뛴다.
// 호출 수를 아끼려고 음식·여가 분해는 뺐다(data.go.kr 일일 한도).
const COUNTS = [
  ["stores", {}],
  ["pcbang", { indsSclsCd: "R10406" }],
];
const todo = Object.values(out.zones).filter((z) => COUNTS.some(([k]) => z[k] == null));
console.log(`점포 수 받을 상권 ${todo.length}곳`);
let n = 0;
for (const z of todo) {
  for (const [k, extra] of COUNTS) {
    if (z[k] != null) continue;
    const { totalCount } = await call("storeListInArea", { key: z.trarNo, numOfRows: "1", pageNo: "1", ...extra });
    z[k] = totalCount;
    await sleep(DELAY_MS);
  }
  if (++n % 20 === 0) {
    console.log(`  ${n}/${todo.length}`);
    save();
  }
}
save();

// 같은 잣대 — 상권 중심과 우리 자리에서 반경 500m 안 점포 수. 지정 상권은 넓이가 제각각이고
// 우리 매장이 지정 상권 밖에 있는 경우도 있어서(시흥능곡 주변 4km에 지정 상권 2곳), 끌어당기는
// 힘을 비교할 땐 이 값을 기준으로 쓴다.
const R500 = { radius: "500", numOfRows: "1", pageNo: "1" };
for (const z of Object.values(out.zones)) {
  if (z.stores500m != null || !z.center) continue;
  z.stores500m = (await call("storeListInRadius", { ...R500, cx: String(z.center.lng), cy: String(z.center.lat) })).totalCount;
  await sleep(DELAY_MS);
}
for (const s of Object.values(out.sites)) {
  if (s.stores500m != null) continue;
  s.stores500m = (await call("storeListInRadius", { ...R500, cx: String(s.lng), cy: String(s.lat) })).totalCount;
  await sleep(DELAY_MS);
}
save();
console.log(`끝 — 자리 ${Object.keys(out.sites).length} · 상권 ${Object.keys(out.zones).length} → ${OUT}`);
