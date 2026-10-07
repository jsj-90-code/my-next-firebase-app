// 배후지 나눠 갖기(허프) 재료 2 — 자리 주변 **500m 격자 칸별 주거인구** (2026-10-07 신설)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 허프 계산의 출발점은 "주민이 어디 사는가"다. 지금 가진 SGIS 값은 자리 중심 반경 고리
// (100m~5km, `collectSgisResidentPopulation.mjs`)라 **방향**이 없다 — 옆 상권 쪽에 사는 사람과
// 반대편에 사는 사람을 못 가른다. 그래서 같은 SGIS 조회를 다각형(srvAreaType=1)으로 바꿔
// 500m 정사각형 칸마다 받는다.
//
// ⚠️ 2026-10-07 검산: 이 다각형 조회는 **더해지지 않는다**(500m 16칸 합이 2km 한 번보다 38% 많음).
// 그래서 이 값은 총량으로 쓰지 않는다 — 총량은 `buildResidentGrid1km.mjs`(공식 1km 격자)가 정본이고,
// 여기 값은 1km 칸 하나를 500m 4칸으로 나누는 **비율**로만 쓴다(중복이 4칸에 비슷하게 끼어 상쇄된다).
//
// 칸은 EPSG:5179 좌표의 500m 배수에 맞춘 **전국 공통 격자**라, 자리끼리 겹치는 칸은 한 번만 받는다.
// 자리 중심에서 RADIUS_M 안에 칸 중심이 드는 칸만 받는다.
//
// 실행:
//   node scripts/collectResidentGrid.mjs --limit 1   # 1곳만 시험
//   node scripts/collectResidentGrid.mjs             # 전부 (이미 받은 칸은 건너뜀, 중간 저장)
//
// 산출물: .local-tools/resident-grid-500m.json
//   { baseYear, cellM, cells: { "x_y": { x, y, pop, age: [age_1..age_9] } } }  (x,y = 칸 중심, EPSG:5179)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { to5179 } from "./lib/tm.mjs";
import { loadEnvLocal, loadHuffSites } from "./lib/huffSites.mjs";

loadEnvLocal();
const serviceId = process.env.SGIS_SERVICE_ID;
const securityKey = process.env.SGIS_SECURITY_KEY;
if (!serviceId || !securityKey) {
  console.error("SGIS_SERVICE_ID / SGIS_SECURITY_KEY가 .env.local에 필요하다.");
  process.exit(1);
}
const AUTH = "https://sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json";
const STATS = "https://sgis.mods.go.kr/ServiceAPI/OpenAPI3/catchmentArea/serviceAreaStatistics.json";
const OUT = ".local-tools/resident-grid-500m.json";
const BASE_YEAR = process.env.SGIS_BASE_YEAR || "2024";
const CELL_M = 500;
const RADIUS_M = Number(process.env.GRID_RADIUS_M ?? 3000);
const DELAY_MS = Number(process.env.SGIS_DELAY_MS ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const argValue = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : Infinity;

let token = null;
let tokenAt = 0;
async function getToken() {
  // 토큰은 몇 시간 간다. 오래 도는 수집이라 30분마다 새로 받는다.
  if (token && Date.now() - tokenAt < 30 * 60 * 1000) return token;
  const url = `${AUTH}?consumer_key=${encodeURIComponent(serviceId)}&consumer_secret=${encodeURIComponent(securityKey)}`;
  const body = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json();
  if (String(body.errCd) !== "0" || !body?.result?.accessToken) throw new Error(`인증 실패 errCd=${body.errCd} ${body.errMsg ?? ""}`);
  token = body.result.accessToken;
  tokenAt = Date.now();
  return token;
}

async function fetchCell(cx, cy, tries = 3) {
  const h = CELL_M / 2;
  const poly = `POLYGON((${cx - h} ${cy - h},${cx + h} ${cy - h},${cx + h} ${cy + h},${cx - h} ${cy + h},${cx - h} ${cy - h}))`;
  for (let t = 1; t <= tries; t++) {
    try {
      const params = new URLSearchParams({
        accessToken: await getToken(),
        area: poly,
        srvAreaType: "1", // 1=임의 폴리곤
        workGb: "all",
        classDeg: "1",
        base_year: BASE_YEAR,
        copr_base_year: BASE_YEAR,
      });
      const res = await fetch(STATS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.json();
      // -401 = 토큰 만료. 새로 받고 다시.
      if (String(body.errCd) === "-401") {
        token = null;
        throw new Error("토큰 만료");
      }
      if (String(body.errCd) !== "0") throw new Error(`errCd=${body.errCd} ${body.errMsg ?? ""}`);
      const p = body.result?.pops?.[0] ?? {};
      return {
        pop: Number(p.tot_ppltn_cnt ?? 0),
        age: Array.from({ length: 9 }, (_, i) => Number(p[`age_${i + 1}_cnt`] ?? 0)),
      };
    } catch (e) {
      if (t === tries) throw e;
      await sleep(1500 * t);
    }
  }
}

const out = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : { baseYear: BASE_YEAR, cellM: CELL_M, cells: {} };
const save = () => writeFileSync(OUT, JSON.stringify(out), "utf8");

// 받을 칸 목록 — 자리마다 반경 안 칸 중심을 모아 중복 제거.
const sites = loadHuffSites().slice(0, LIMIT);
const want = new Map();
for (const s of sites) {
  const tm = to5179(s.lng, s.lat);
  const span = Math.ceil(RADIUS_M / CELL_M) + 1;
  const bx = Math.floor(tm.x / CELL_M) * CELL_M + CELL_M / 2;
  const by = Math.floor(tm.y / CELL_M) * CELL_M + CELL_M / 2;
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const cx = bx + i * CELL_M;
      const cy = by + j * CELL_M;
      if (Math.hypot(cx - tm.x, cy - tm.y) > RADIUS_M) continue;
      want.set(`${cx}_${cy}`, { x: cx, y: cy });
    }
  }
}
const todo = [...want.entries()].filter(([k]) => !out.cells[k]);
console.log(`자리 ${sites.length}곳 · 칸 ${want.size}개 · 남은 칸 ${todo.length}개`);

let n = 0;
for (const [k, c] of todo) {
  const r = await fetchCell(c.x, c.y);
  out.cells[k] = { x: c.x, y: c.y, ...r };
  if (++n % 100 === 0) {
    save();
    console.log(`  ${n}/${todo.length}`);
  }
  await sleep(DELAY_MS);
}
save();
console.log(`끝 — 칸 ${Object.keys(out.cells).length}개 → ${OUT}`);
