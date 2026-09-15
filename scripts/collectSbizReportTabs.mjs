// 소상공인365 상권분석 리포트의 **나머지 탭**을 전부 긁는다.
//
// 배경: 분석번호(analyNo) 하나를 발급받으면 리포트 탭이 6개 딸려 오는데, 지금까지는 그중
// 유동인구(탭4의 차트 하나)만 빼 쓰고 나머지를 버리고 있었다. **분석번호는 이미 발급돼 있으므로**
// (collectSbizFloatingPopulation.mjs가 반경별로 저장해둠) 탭만 더 읽으면 추가 비용이 거의 없다.
//
// 딸려 오는 것:
//   sg2  업소수 추이 (PC방 업종)
//   sg3  업소당 월평균 매출액·매출건수 추이, 시기별 매출 특성   <- 우리가 맞히려는 값의 지역 기준선
//   sg4  유동인구(월별·성별연령·요일별·시간대별), 주거인구, 직장인구, 소득소비
//   sg6  세대수, 공동주택·아파트(단지규모·면적), 주요시설, 학교수/학생수, 지하철 이용
//   sg7  방문고객 분석, 라이프스타일, 연평균소득, 성별·연령별 소비매출액
//   sg8  빈 응답(쓸 것 없음)
//
// ── 왜 전용 파서를 안 쓰나 ────────────────────────────────────────────────
// 같은 모양의 표가 유동인구·주거인구·직장인구에 반복해서 나온다. 앵커 없이 "첫 번째 표"를 집으면
// **에러 없이 엉뚱한 값**이 들어온다(2026-09-15에 실제로 그럴 뻔했다). 차트가 20개가 넘는데
// 전용 파서를 20개 쓰면 그런 사고가 20번 날 자리가 생긴다.
//
// 그래서 `<dt>제목</dt>` 구간을 잘라 **제목을 열쇠로** 그 안의 값만 담는다. 무엇을 쓸지는
// 나중에 고르면 되고, 지금은 출처가 분명한 채로 모아두는 게 중요하다.
//
// 사용법:
//   node scripts/collectSbizReportTabs.mjs --limit 2          # 2곳만 시험
//   node scripts/collectSbizReportTabs.mjs --radius 400       # 특정 반경만
//   node scripts/collectSbizReportTabs.mjs                    # 전체
//
// 산출물: .local-tools/sbiz-report-tabs.json (이어받기 가능)

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE = ".local-tools/sbiz-floating-population.json";
const OUT = ".local-tools/sbiz-report-tabs.json";
const TABS = [2, 3, 4, 6, 7];
const BASE = "https://bigdata.sbiz.or.kr";
const PCBANG_UPJONG = "R10406";
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS || 1200);

const args = process.argv.slice(2);
const argValue = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1];
};
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : null;
const ONLY_RADIUS = argValue("--radius") ? Number(argValue("--radius")) : null;

const HEADERS = {
  Referer: `${BASE}/gis/locAnls`,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTab(tab, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/gis/bizonAnls/report/sg/sang_gwon${tab}.sg?${qs}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`sang_gwon${tab} HTTP ${res.status}`);
  return res.text();
}

const num = (s) => Number(String(s).replace(/,/g, ""));

/**
 * 차트 데이터는 `<dt>` 제목 구간 안이 아니라 **문서 맨 위 `<script>` 블록에 통째로** 선언된다
 * (2026-09-15에 이걸 몰라서 업소수·매출액 추이를 통째로 놓쳤다). 그래서 제목이 아니라
 * **변수명**을 열쇠로 긁는다 — `flowPopCnt.push({name:"선택 영역", data:[Number("419"),...]})` 꼴.
 *
 * 월·요일 같은 구간 라벨은 별도 배열로 선언된다(`var monthMap = [...]`, `flowByMnth.push("25.06")`).
 */
function parseCharts(html) {
  const head = html.slice(0, html.indexOf("<dt>") === -1 ? html.length : html.indexOf("<dt>"));
  const charts = {};

  for (const m of head.matchAll(/(\w+)\.push\(\{\s*name\s*:\s*"([^"]*)"\s*,\s*data\s*:\s*\[([\s\S]{0,4000}?)\]/g)) {
    const [, varName, seriesName, raw] = m;
    // 탭마다 감싸는 함수가 다르다 — sg4는 Number("419"), sg3은 Math.round("2495")를 쓴다.
    const values = [...raw.matchAll(/(?:Number|Math\.round)\("([^"]*)"\)/g)].map((v) => num(v[1]));
    if (!values.length) continue;
    // ⚠️ 같은 변수에 같은 이름으로 **두 번 밀어넣는 경우가 있다**(sg2의 업소수와 증감률).
    // 이름을 열쇠로 덮어쓰면 하나가 조용히 사라지므로 순서를 지켜 배열로 쌓는다.
    charts[varName] = charts[varName] ?? [];
    charts[varName].push({
      name: seriesName,
      key: seriesName.replace(/\s+/g, ""), // 사이트가 "선택 영역"과 "선택영역"을 섞어 쓴다
      values,
    });
  }

  // 구간 라벨 — 두 가지 선언 방식을 모두 받는다.
  const labels = {};
  for (const m of head.matchAll(/var\s+(\w+)\s*=\s*\[([\s\S]{0,1500}?)\]/g)) {
    const arr = [...m[2].matchAll(/"([^"]*)"/g)].map((v) => v[1]);
    if (arr.length > 1) labels[m[1]] = arr;
  }
  for (const m of head.matchAll(/(\w+)\.push\("([^"]*)"\)/g)) {
    labels[m[1]] = labels[m[1]] ?? [];
    labels[m[1]].push(m[2]);
  }
  if (Object.keys(labels).length) charts.__labels = labels;

  // sg7(방문고객 분석)은 값을 **JSON이 아니라 자바 toString 꼴 문자열**로 박아둔다.
  //   var maleVstCustMjrLife = "[{maleCustHbbNm=게임, maleCustCnt=4857, maleCustRate=20.2}, ...]";
  // 따옴표도 없고 콜론도 없어서 JSON.parse가 안 된다. 손으로 푼다.
  // (PC방과 직결되는 자료다 — 남성 방문고객 취미 1위가 "게임"으로 나온다.)
  const objects = {};
  for (const m of head.matchAll(/var\s+(\w+)\s*=\s*"\[(\{[\s\S]{0,4000}?\})\]"\s*;/g)) {
    const rows = m[2]
      .split(/\}\s*,\s*\{/)
      .map((chunk) => chunk.replace(/^\{|\}$/g, ""))
      .map((chunk) => {
        const obj = {};
        for (const pair of chunk.split(/,\s*/)) {
          const eq = pair.indexOf("=");
          if (eq === -1) continue;
          const k = pair.slice(0, eq).trim();
          const v = pair.slice(eq + 1).trim();
          const n = Number(v);
          obj[k] = v !== "" && Number.isFinite(n) ? n : v;
        }
        return obj;
      })
      .filter((o) => Object.keys(o).length);
    if (rows.length) objects[m[1]] = rows;
  }
  if (Object.keys(objects).length) charts.__objects = objects;

  return charts;
}

/**
 * `<dt>제목</dt>` 로 구간을 잘라, 각 구간 안의 "선택 영역" 표행을 담는다.
 * 제목이 열쇠이므로 어느 값이 어디서 왔는지가 산출물만 봐도 분명하다.
 */
function parseSections(html) {
  const titles = [...html.matchAll(/<dt>([^<]{2,60})<\/dt>/g)];
  const sections = {};

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i][1].trim();
    if (title === "분석결과") continue; // 서술형 문장이라 값이 없다
    const start = titles[i].index;
    const end = i + 1 < titles.length ? titles[i + 1].index : html.length;
    const body = html.slice(start, end);

    const section = {};

    // ① 차트 계열: name : "..." 뒤에 오는 data : [ Number("..") ... ]
    const series = {};
    for (const m of body.matchAll(/name\s*:\s*"([^"]*)"\s*,\s*data\s*:\s*\[([\s\S]{0,4000}?)\]/g)) {
      const values = [...m[2].matchAll(/Number\("([^"]*)"\)/g)].map((v) => num(v[1]));
      if (values.length) series[m[1]] = values;
    }
    if (Object.keys(series).length) section.series = series;

    // ② 카테고리 라벨(월·요일·시간대 등)
    const categories = [...body.matchAll(/categories\s*:\s*\[([\s\S]{0,2000}?)\]/g)]
      .map((m) => [...m[1].matchAll(/"([^"]*)"/g)].map((v) => v[1]))
      .find((arr) => arr.length > 1);
    if (categories) section.categories = categories;

    // ③ "선택 영역" 표행 — 우리가 준 반경 원의 값이다
    const row = body.match(
      /<th[^>]*>\s*선택 영역\s*<\/th>[\s\S]{0,200}?<td[^>]*>([\d,.-]+)<\/td>((?:[\s\S]{0,60}?<td[^>]*>[\d,.-]+<\/td>){0,12})/,
    );
    if (row) {
      const cells = [num(row[1]), ...[...row[2].matchAll(/<td[^>]*>([\d,.-]+)<\/td>/g)].map((m) => num(m[1]))];
      section.selectedRow = cells;
    }

    if (Object.keys(section).length) sections[title] = section;
  }
  return sections;
}

/* ---------------------------------------------------------------- 본체 */
if (!existsSync(SOURCE)) {
  console.error(`${SOURCE}이 없다. 먼저 node scripts/collectSbizFloatingPopulation.mjs 를 돌린다.`);
  process.exit(1);
}
const source = JSON.parse(readFileSync(SOURCE, "utf8"));
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { collectedAt: null, sites: {} };

const entries = Object.entries(source.sites ?? {});
const list = LIMIT ? entries.slice(0, LIMIT) : entries;
console.log(`대상 ${list.length}곳 · 탭 ${TABS.join("/")} · 간격 ${DELAY_MS}ms`);
if (ONLY_RADIUS) console.log(`반경 ${ONLY_RADIUS}m만 받는다.`);

let done = 0;
let skipped = 0;
let failed = 0;

for (const [key, site] of list) {
  if (!site.admiCd) {
    console.log(`  · ${site.name} — 행정동코드가 없다(유동인구 수집이 덜 끝난 지점). 건너뜀`);
    skipped++;
    continue;
  }
  const radii = Object.keys(site.radii ?? {})
    .map(Number)
    .filter((r) => (ONLY_RADIUS ? r === ONLY_RADIUS : true))
    .sort((a, b) => a - b);

  const record = out.sites[key] ?? { kind: site.kind, code: site.code, name: site.name, radii: {} };
  let fetched = 0;

  try {
    for (const radius of radii) {
      const entry = site.radii[radius];
      if (!entry?.analyNo) continue;
      record.radii[radius] = record.radii[radius] ?? {};
      for (const tab of TABS) {
        if (record.radii[radius][`sg${tab}`]) continue; // 이어받기
        const html = await fetchTab(tab, {
          analyNo: entry.analyNo,
          analyDate: entry.analyDate,
          upjongCd: PCBANG_UPJONG,
          admiCd: site.admiCd,
          admiNm: site.admiNm ?? "",
          kmAnalyNo: "",
          xtLoginId: "",
        });
        record.radii[radius][`sg${tab}`] = { charts: parseCharts(html), tables: parseSections(html) };
        fetched++;
        await sleep(DELAY_MS);
      }
    }
    if (fetched === 0) {
      skipped++;
      continue;
    }
    out.sites[key] = record;
    out.collectedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(out), "utf8");
    done++;
    const titles = new Set();
    for (const r of Object.values(record.radii)) for (const t of Object.values(r)) for (const k of Object.keys(t)) titles.add(k);
    console.log(`  ${site.name} — 요청 ${fetched}회 · 항목 ${titles.size}종 (${done}/${list.length})`);
  } catch (err) {
    failed++;
    console.error(`  ✖ ${site.name}: ${err.message}`);
  }
}

console.log(`\n완료 ${done}곳 · 건너뜀 ${skipped}곳 · 실패 ${failed}곳 -> ${OUT}`);
