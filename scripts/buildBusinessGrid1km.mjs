// 배후지 나눠 갖기(허프) 재료 1-정본 — SGIS **공식 1km 격자 사업체 수**(소비자가 찾아가는 업종)
// (2026-10-07 신설)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 처음엔 목적지를 소상공인진흥공단 **지정 상권**(collectTradeZones.mjs)으로 잡았는데, 지정 상권이 전국을
// 다 덮지 않는다 — 김포구래·증평·문산·영월·천안풍세는 4km 안에 0곳이라 "우리 몫 100%"가 나왔다
// (2026-10-07 첫 표). 그래서 빈틈 없는 공식 격자의 사업체 수를 상권 크기(끌어당기는 힘)로 쓴다.
//
// 자료: buildResidentGrid1km.mjs와 같은 zip(data.go.kr 15141768) 안 "사업체(중분류)" CSV.
//   항목 cp2_bnu_NN = 산업 중분류 NN의 사업체 수. 쓰는 것: 47 소매 · 56 음식점·주점 · 91 스포츠·오락(PC방 포함).
//
// 실행: node scripts/buildBusinessGrid1km.mjs "<압축 푼 폴더>/1. 통계/4. 2024년 격자통계(사업체, 종사자)/사업체(중분류)"
// 산출물: .local-tools/business-grid-1km.json  { cells: { "다사3644": { x, y, retail, food, leisure } } }
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { to5179 } from "./lib/tm.mjs";
import { gridCodeToXY, loadHuffSites } from "./lib/huffSites.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("사업체(중분류) CSV 폴더 경로가 필요하다.");
  process.exit(1);
}
const KEEP_M = Number(process.env.GRID_KEEP_M ?? 8000);
const OUT = ".local-tools/business-grid-1km.json";
const FIELD = { cp2_bnu_47: "retail", cp2_bnu_56: "food", cp2_bnu_91: "leisure" };

const sites = loadHuffSites().map((s) => ({ ...s, tm: to5179(s.lng, s.lat) }));
const near = (cx, cy) => sites.some((s) => Math.hypot(cx - s.tm.x, cy - s.tm.y) <= KEEP_M);
const dec = new TextDecoder("euc-kr");
const cells = {};
for (const f of readdirSync(dir).filter((n) => n.endsWith(".csv"))) {
  for (const line of dec.decode(readFileSync(join(dir, f))).split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [, rawCode, rawItem, rawVal] = line.split(",");
    const field = FIELD[rawItem.replaceAll('"', "")];
    if (!field) continue;
    const code = rawCode.replaceAll('"', "");
    const xy = gridCodeToXY(code);
    if (!xy || !near(xy.x + 500, xy.y + 500)) continue;
    const c = (cells[code] ??= { x: xy.x + 500, y: xy.y + 500, retail: 0, food: 0, leisure: 0 });
    c[field] = Number(rawVal) || 0;
  }
}
writeFileSync(OUT, JSON.stringify({ source: "data.go.kr 15141768 (2024, 1km, 사업체 중분류 47·56·91)", keepM: KEEP_M, cells }), "utf8");
console.log(`칸 ${Object.keys(cells).length}개 → ${OUT}`);
