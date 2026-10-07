// 옆 상권 중심(봉우리) 고르기 — 실측 유동인구로 "겹친 상권 중 어디에 사람이 쏠리나"를 재기 위한 지점 목록
// (2026-10-07 신설)
//
// 허프 표(computeHuffShare.mjs)는 점포 수·거리로 **추정**한 몫이라, 사람이 실제로 어디 있는지는 모른다.
// 사용자 의도는 "겹친 상권 중 어디에 인구가 쏠려 있는지 데이터로 확인"이었다. 그래서 옆 상권 중심에서도
// 소상공인365 유동인구(통신 기반 실측)를 받아 우리 자리와 같은 반경으로 비교한다.
//
// 상권 중심 = 500m 점포 칸(store-grid-500m.json)에서 이웃 8칸보다 점포가 많은 칸(봉우리).
// 지정 상권 목록은 전국을 안 덮어서(김포구래 등 0곳) 쓰지 않는다.
// 자리마다 우리 창(중심 600m 안)을 뺀 3km 안 봉우리를 점포 수 순으로 TOP_N개.
//
// 실행: node scripts/buildHubPoints.mjs
// 산출물: .local-tools/hub-points.json  { points: [{ kind:"hub", code:"x_y", name, lat, lng, stores, sites:[code] }] }
//   → node scripts/collectSbizFloatingPopulation.mjs --points .local-tools/hub-points.json --radii 300
import { readFileSync, writeFileSync } from "node:fs";
import { to5179 } from "./lib/tm.mjs";
import { from5179, loadHuffSites } from "./lib/huffSites.mjs";

const TOP_N = Number(process.env.HUB_TOP_N ?? 6);
const MIN_STORES = Number(process.env.HUB_MIN_STORES ?? 80);
const cells = JSON.parse(readFileSync(".local-tools/store-grid-500m.json", "utf8")).cells;
const at = (x, y) => cells[`${x}_${y}`]?.stores;

const isPeak = (c) => {
  for (const dx of [-500, 0, 500]) for (const dy of [-500, 0, 500]) {
    if (!dx && !dy) continue;
    const v = at(c.x + dx, c.y + dy);
    if (v != null && v > c.stores) return false;
  }
  return true;
};

const points = new Map();
for (const s of loadHuffSites()) {
  const tm = to5179(s.lng, s.lat);
  const peaks = Object.values(cells)
    .filter((c) => {
      const d = Math.hypot(c.x - tm.x, c.y - tm.y);
      return d > 600 && d <= 3000 && c.stores >= MIN_STORES && isPeak(c);
    })
    .sort((a, b) => b.stores - a.stores)
    .slice(0, TOP_N);
  for (const c of peaks) {
    const key = `${c.x}_${c.y}`;
    if (!points.has(key)) {
      const ll = from5179(to5179, c.x, c.y, { lat: s.lat, lng: s.lng });
      points.set(key, { kind: "hub", code: key, name: `봉우리 ${key}`, lat: ll.lat, lng: ll.lng, stores: c.stores, sites: [] });
    }
    points.get(key).sites.push(s.code);
  }
}
writeFileSync(".local-tools/hub-points.json", JSON.stringify({ topN: TOP_N, minStores: MIN_STORES, points: [...points.values()] }, null, 1), "utf8");
console.log(`봉우리 ${points.size}곳 → .local-tools/hub-points.json`);
