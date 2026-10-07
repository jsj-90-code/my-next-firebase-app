// 배후지 나눠 갖기(허프) 재료 1-세밀 — 자리 주변 **500m 칸별 점포 수**(상가업소) (2026-10-07 신설)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 공식 1km 사업체 격자(buildBusinessGrid1km.mjs)만으론 "우리 상권"과 "바로 옆 상권"이 안 갈린다 —
// 김포구래는 구래역 상권(사실상 우리 상권)이 옆 칸이라 "빠지는 곳 27%"로 나왔다(2026-10-07).
// 그래서 자리 주변 3km는 500m 칸마다 상가업소 수를 직접 센다. 3km 밖은 1km 격자로 보완한다.
//
// 칸은 collectResidentGrid.mjs와 **같은 EPSG:5179 500m 격자**(키 "x_y" = 칸 중심)라 두 자료가 칸끼리 맞물린다.
// 자료원: 소상공인 상가(상권)정보 API storeListInRectangle — 칸 네 귀퉁이를 위경도로 바꿔 사각형으로 묻는다.
// ⚠️ 시점은 "지금"뿐이다. 업종 구분 없이 전체 점포 수(호출 수를 아끼려고).
//
// 실행:
//   node scripts/collectStoreGrid500m.mjs --limit 1
//   node scripts/collectStoreGrid500m.mjs            (이어받기 됨, data.go.kr 일일 한도에 걸리면 다음 날 다시)
// 산출물: .local-tools/store-grid-500m.json  { cells: { "x_y": { x, y, stores } } }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { to5179 } from "./lib/tm.mjs";
import { from5179, loadEnvLocal, loadHuffSites } from "./lib/huffSites.mjs";

loadEnvLocal();
const KEY = process.env.PUBLICDATA_SERVICE_KEY;
if (!KEY) {
  console.error("PUBLICDATA_SERVICE_KEY가 .env.local에 필요하다.");
  process.exit(1);
}
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const OUT = ".local-tools/store-grid-500m.json";
const CELL_M = 500;
const RADIUS_M = Number(process.env.GRID_RADIUS_M ?? 3000);
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS ?? 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

async function countRect(sw, ne, tries = 3) {
  const q = new URLSearchParams({
    serviceKey: KEY, type: "json", numOfRows: "1", pageNo: "1",
    minx: String(sw.lng), miny: String(sw.lat), maxx: String(ne.lng), maxy: String(ne.lat),
  });
  for (let t = 1; t <= tries; t++) {
    try {
      const body = JSON.parse(await (await fetch(`${BASE}/storeListInRectangle?${q}`, { signal: AbortSignal.timeout(30000) })).text());
      const code = body.header?.resultCode;
      if (code === "03") return 0; // 데이터 없음
      if (code !== "00") throw new Error(`resultCode=${code} ${body.header?.resultMsg ?? ""}`);
      return Number(body.body?.totalCount ?? 0);
    } catch (e) {
      if (t === tries) throw e;
      await sleep(1500 * t);
    }
  }
}

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { cellM: CELL_M, cells: {} };
const save = () => writeFileSync(OUT, JSON.stringify(out), "utf8");

const sites = loadHuffSites().slice(0, LIMIT);
const want = new Map();
for (const s of sites) {
  const tm = to5179(s.lng, s.lat);
  const span = Math.ceil(RADIUS_M / CELL_M) + 1;
  const bx = Math.floor(tm.x / CELL_M) * CELL_M + CELL_M / 2;
  const by = Math.floor(tm.y / CELL_M) * CELL_M + CELL_M / 2;
  for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) {
    const cx = bx + i * CELL_M, cy = by + j * CELL_M;
    if (Math.hypot(cx - tm.x, cy - tm.y) <= RADIUS_M) want.set(`${cx}_${cy}`, { x: cx, y: cy, guess: { lat: s.lat, lng: s.lng } });
  }
}
const todo = [...want.entries()].filter(([k]) => out.cells[k] == null);
console.log(`자리 ${sites.length}곳 · 칸 ${want.size}개 · 남은 칸 ${todo.length}개`);
let n = 0;
for (const [k, c] of todo) {
  const h = CELL_M / 2;
  const sw = from5179(to5179, c.x - h, c.y - h, c.guess);
  const ne = from5179(to5179, c.x + h, c.y + h, c.guess);
  out.cells[k] = { x: c.x, y: c.y, stores: await countRect(sw, ne) };
  if (++n % 200 === 0) { save(); console.log(`  ${n}/${todo.length}`); }
  await sleep(DELAY_MS);
}
save();
console.log(`끝 — 칸 ${Object.keys(out.cells).length}개 → ${OUT}`);
