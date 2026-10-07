// 배후지 나눠 갖기(허프) 재료 2-정본 — SGIS **공식 1km 격자 인구**를 우리 자리 주변만 잘라 둔다
// (2026-10-07 신설)
//
// ── 왜 이 파일이 따로 있나 ─────────────────────────────────────────────────
// `collectResidentGrid.mjs`(SGIS 다각형 API, 500m 칸)는 **더해지지 않는다** — 같은 2km 정사각형을
// 500m 16칸으로 물으면 합이 큰 칸 한 번보다 38% 많고, 1km 4칸이면 12% 많다(2026-10-07 시흥능곡 검산).
// 칸에 걸친 집계구를 통째로 세는 것으로 보인다. 그래서 총량은 이 공식 격자를 정본으로 쓰고,
// 500m 값은 1km 칸 안에서 4칸으로 나누는 **비율**로만 쓴다.
//
// 자료: 공공데이터포털 15141768 "국가데이터처_SGIS 격자 통계 및 경계" (전국, 2024, 이용허락 제한 없음).
//   ⚠️ 무료 공개분은 1km 칸뿐이다. 100m·500m는 SGIS 포털 "자료제공" 신청이 필요하다.
//   받는 법(로그인 불필요):
//     POST https://www.data.go.kr/tcs/dss/selectFileDataDownload.do
//          publicDataPk=15141768&publicDataDetailPk=uddi:2d720442-85fd-4ab6-b23c-a924da535c58&fileDetailSn=1
//       → atchFileId
//     GET  https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=<id>&fileDetailSn=1   (zip 약 98MB)
//   CSV는 CP949, 열: 기준연도, 격자코드("다사3644"), 항목코드, 값.
//   항목: to_in_001 = 총인구, in_age_001~021 = 5세 단위(남녀 합). 값이 작은 칸은 비어 있다(비공개).
//
// 격자코드 → EPSG:5179 좌하단: 첫 글자 x(가=700km … 사=1300km), 둘째 글자 y(가=1300km … 아=2000km),
//   숫자 앞 2자리 = x km, 뒤 2자리 = y km.  예) 다사3644 → x 936000, y 1944000.
//
// 실행: node scripts/buildResidentGrid1km.mjs "<압축 푼 폴더>/1. 통계/1. 2024년 격자 통계(인구)"
// 산출물: .local-tools/resident-grid-1km.json  { cells: { "다사3644": { x, y, pop, age5[21] } } }
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { to5179 } from "./lib/tm.mjs";
import { gridCodeToXY, loadHuffSites } from "./lib/huffSites.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("인구 CSV 폴더 경로가 필요하다.");
  process.exit(1);
}
const KEEP_M = Number(process.env.GRID_KEEP_M ?? 8000); // 자리에서 이 거리 안 칸만 남긴다
const OUT = ".local-tools/resident-grid-1km.json";


const sites = loadHuffSites().map((s) => ({ ...s, tm: to5179(s.lng, s.lat) }));
const near = (cx, cy) => sites.some((s) => Math.hypot(cx - s.tm.x, cy - s.tm.y) <= KEEP_M);

const dec = new TextDecoder("euc-kr");
const cells = {};
for (const f of readdirSync(dir).filter((n) => n.endsWith(".csv"))) {
  const text = dec.decode(readFileSync(join(dir, f)));
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [, rawCode, rawItem, rawVal] = line.split(",");
    const code = rawCode.replaceAll('"', "");
    const item = rawItem.replaceAll('"', "");
    const xy = gridCodeToXY(code);
    if (!xy) continue;
    // 칸 중심으로 거리 판정
    if (!near(xy.x + 500, xy.y + 500)) continue;
    const c = (cells[code] ??= { x: xy.x + 500, y: xy.y + 500, pop: null, age5: Array(21).fill(0) });
    const v = Number(rawVal);
    if (item === "to_in_001") c.pop = v;
    const m = /^in_age_0(\d\d)$/.exec(item);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 21) c.age5[Number(m[1]) - 1] = v;
  }
}
// 총인구가 비공개인 칸은 연령 합으로 채운다(그것도 0이면 0).
for (const c of Object.values(cells)) if (c.pop == null) c.pop = c.age5.reduce((a, b) => a + b, 0);
writeFileSync(OUT, JSON.stringify({ source: "data.go.kr 15141768 (2024, 1km)", keepM: KEEP_M, cells }), "utf8");
console.log(`칸 ${Object.keys(cells).length}개 → ${OUT}`);
