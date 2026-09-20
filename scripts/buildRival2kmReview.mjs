// 2km 경쟁점(대체 PC방) 폐업 대조표를 만든다 — 2026-09-20.
//
//   node scripts/buildRival2kmReview.mjs
//   -> docs/review-needed/2km-경쟁점-대조.html   (사람이 체크하는 표)
//   -> docs/review-needed/2km-경쟁점-대조.csv    (표계산기로 볼 사람용 · 같은 내용)
//
// ── 왜 만드나 ─────────────────────────────────────────────────────────────
// `.local-tools/kakao-neighborhood.json`(2km 안 PC방 좌표, 54곳)에 **폐업이 섞여 있다.**
// 사용자가 문경시청점을 지도로 대조해서 드러났다 — 7곳 중 3곳(43%)이 폐업이었다.
// 카카오 장소 API는 폐업 표시를 따로 주지 않는다.
//
// 이 자료가 `_catchment.test.ts`("2km 안에 대체 PC방이 없다" 가설)의 유일한 근거다.
// 그래서 그 **기각 결론이 흔들린다.** 폐업 여부는 사람이 지도를 봐야만 안다.
//
// ── 눈가림 ────────────────────────────────────────────────────────────────
// 이 페이지에는 **잔차·예상매출·실매출·적중률이 한 글자도 없다.**
// `buildMarketSplitJudgePage.mjs`와 같은 규율이다. 판정이 성적을 보고 움직이면
// 시험이 아니라 사후설명이 된다.
//
// ── 사람 품을 줄이는 방법 (문서 1절에 근거를 적었다) ──────────────────────
// 검정이 쓰는 변수는 둘뿐이고 **둘 다 500m 밖만 센다.**
//   outside          = 500m~2km 안 PC방 수
//   nearestOutsideM  = 그중 최단거리
// 그래서 500m 안쪽(387행)은 볼 필요가 없다. 게다가 순위 기반 검정이라
// 조밀한 매장은 몇 곳 폐업해도 순위가 안 움직인다. 등급을 셋으로 나눈다.
//
//   A등급  out<=10인 매장의 500m 밖 전부   — 가설이 사는 구간. 여기가 본 작업이다
//   B등급  out>10인 매장의 최단 3곳        — nearestOutsideM만 확정하면 되는 구간
//   C등급  나머지                          — 판정해도 순위가 안 바뀐다. 안 봐도 된다
//
// ⚠️ 등급은 **품을 줄이려는 것이지 결론이 아니다.** C를 다 폐업으로 놓는 최악을
//    가정하면 순위는 뒤집힌다. 관측된 폐업률(43%)에서 안 뒤집힌다는 뜻이다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NBR = new URL("../.local-tools/kakao-neighborhood.json", import.meta.url);
const SNAP = new URL("../.local-tools/validation-snapshot.json", import.meta.url);
const OUT_DIR = new URL("../docs/review-needed/", import.meta.url);
const OUT_HTML = new URL("./2km-경쟁점-대조.html", OUT_DIR);
const OUT_CSV = new URL("./2km-경쟁점-대조.csv", OUT_DIR);

/** 우리 '상권 뭉치'의 반경. 이 안은 같은 상권, 밖은 대체재. `_catchment.test.ts`와 같은 값. */
const CLUSTER_M = 500;
/** A등급 문턱 — 500m 밖 개수가 이 이하인 매장은 전부 본다. */
const SPARSE_MAX = 10;
/** B등급에서 매장당 보는 최단 개수. */
const NEAREST_N = 3;
/** 이 거리 안이면 카카오가 우리 매장 자신을 잡은 것으로 본다. `_catchment.test.ts`와 같은 값. */
const SELF_M = 30;
/** 공식 경쟁점 DB와 같은 곳으로 볼 거리. 한 경쟁점은 한 행에만 붙는다(아래 일대일 매칭). */
const MATCH_M = 60;
/** 같은 자리로 볼 거리 — 상호가 다르면 한쪽이 폐업했을 수 있다. */
const DUP_M = 25;

const OWN_BRAND = /아이센스|블랙라벨/i;

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const nbr = JSON.parse(readFileSync(NBR, "utf8"));
const snap = JSON.parse(readFileSync(SNAP, "utf8"));

/** 공식 경쟁점 DB(500m까지) — 매장 코드별. 좌표가 있는 것만 대조에 쓴다. */
const compsByCode = new Map();
for (const c of snap.competitors ?? []) {
  if (c.lat == null || c.lng == null) continue;
  const list = compsByCode.get(c.candidateCode) ?? [];
  list.push(c);
  compsByCode.set(c.candidateCode, list);
}

const isPcRoom = (d) => (d.category ?? "").includes("PC방");

/** 매장 하나를 표 한 덩어리로 만든다. */
function buildSite(site) {
  const code = String(site.code ?? "");
  const officials = compsByCode.get(code) ?? [];
  const docs = (site.pcRooms?.docs ?? [])
    .filter(isPcRoom)
    .map((d) => ({ ...d, distanceM: d.distanceM ?? Math.round(haversine(site.lat, site.lng, d.lat, d.lng)) }))
    .sort((a, b) => a.distanceM - b.distanceM);

  const rows = docs.map((d) => ({
    name: d.name ?? "(이름없음)",
    address: d.address ?? "",
    lat: d.lat,
    lng: d.lng,
    distanceM: d.distanceM,
    isSelf: d.distanceM <= SELF_M,
    isOwnBrand: OWN_BRAND.test(d.name ?? ""),
    official: null,
    dupWith: [],
  }));

  // 공식 DB에 이미 있나 — 있으면 조사된 곳이라 다시 볼 필요가 없다.
  // ⚠️ **일대일로 붙인다.** 그냥 반경 안을 집으면 한 경쟁점이 이웃한 여러 가게에 다 붙어서
  //    서로 다른 가게가 전부 '조사됨'으로 보인다(2026-09-20에 진주혁신도시에서 셋이 붙었다).
  //    가까운 쌍부터 차례로 짝지어 각자 한 번씩만 쓰이게 한다.
  const pairs = [];
  for (const c of officials) {
    for (let i = 0; i < rows.length; i++) {
      const m = haversine(rows[i].lat, rows[i].lng, c.lat, c.lng);
      if (m <= MATCH_M) pairs.push({ m, i, c });
    }
  }
  pairs.sort((a, b) => a.m - b.m);
  const usedComp = new Set();
  for (const p of pairs) {
    if (rows[p.i].official || usedComp.has(p.c.id)) continue;
    rows[p.i].official = p.c.name ?? "";
    usedComp.add(p.c.id);
  }

  // 같은 자리에 상호가 둘 — 한쪽이 폐업했을 가능성이 높다. 사람에게 표시해 준다.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const sameSpot = haversine(rows[i].lat, rows[i].lng, rows[j].lat, rows[j].lng) <= DUP_M;
      const sameAddr = rows[i].address && rows[i].address === rows[j].address;
      if (!sameSpot && !sameAddr) continue;
      rows[i].dupWith.push(rows[j].name);
      rows[j].dupWith.push(rows[i].name);
    }
  }

  const outside = rows.filter((r) => !r.isSelf && r.distanceM > CLUSTER_M);
  const inside = rows.filter((r) => !r.isSelf && r.distanceM <= CLUSTER_M);
  const self = rows.filter((r) => r.isSelf);

  const sparse = outside.length <= SPARSE_MAX;
  outside.forEach((r, i) => {
    r.tier = sparse ? "A" : i < NEAREST_N ? "B" : "C";
  });
  inside.forEach((r) => { r.tier = "-"; });

  return {
    key: `${site.kind}:${code}`,
    code,
    kind: site.kind,
    name: site.name ?? code,
    lat: site.lat,
    lng: site.lng,
    truncated: !!site.pcRooms?.truncated,
    kakaoTotal: site.pcRooms?.total ?? null,
    outside,
    inside,
    self,
    outsideCount: outside.length,
    nearestOutsideM: outside.length ? outside[0].distanceM : 2000,
    officialCount: officials.length,
  };
}

const sites = Object.values(nbr.sites).map(buildSite);
// 볼 게 많은 순서가 아니라 **희소한 순서**로 — 가설이 사는 쪽부터 본다
sites.sort((a, b) => a.outsideCount - b.outsideCount || a.name.localeCompare(b.name, "ko"));

const tierCount = (t) => sites.reduce((n, s) => n + s.outside.filter((r) => r.tier === t).length, 0);
const stats = {
  sites: sites.length,
  totalRows: sites.reduce((n, s) => n + s.outside.length + s.inside.length + s.self.length, 0),
  insideRows: sites.reduce((n, s) => n + s.inside.length, 0),
  selfRows: sites.reduce((n, s) => n + s.self.length, 0),
  outsideRows: sites.reduce((n, s) => n + s.outside.length, 0),
  A: tierCount("A"),
  B: tierCount("B"),
  C: tierCount("C"),
  sparseSites: sites.filter((s) => s.outsideCount <= SPARSE_MAX).length,
  dupRows: sites.reduce((n, s) => n + s.outside.filter((r) => r.dupWith.length).length, 0),
  truncatedSites: sites.filter((s) => s.truncated).length,
  officialMatchedOutside: sites.reduce((n, s) => n + s.outside.filter((r) => r.official).length, 0),
};

// ── CSV ────────────────────────────────────────────────────────────────────
const csvEsc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLines = [
  "# 2km 경쟁점 폐업 대조 — 판정칸(영업/폐업/모름)은 비어 있다. 채우지 않은 칸은 '모름'이다.",
  ["등급", "매장명", "매장코드", "구분", "거리m", "상호", "주소", "위도", "경도", "공식DB", "같은자리의심", "카카오맵링크", "판정", "메모"]
    .map(csvEsc)
    .join(","),
];
for (const s of sites) {
  for (const r of [...s.outside, ...s.inside]) {
    csvLines.push(
      [
        r.tier,
        s.name,
        s.code,
        r.distanceM > CLUSTER_M ? "500m밖" : "500m안",
        r.distanceM,
        r.name,
        r.address,
        r.lat.toFixed(6),
        r.lng.toFixed(6),
        r.official ?? "",
        r.dupWith.join(" / "),
        `https://map.kakao.com/link/map/${encodeURIComponent(r.name)},${r.lat},${r.lng}`,
        "",
        "",
      ]
        .map(csvEsc)
        .join(","),
    );
  }
}

// ── HTML ───────────────────────────────────────────────────────────────────
const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kakaoLink = (name, lat, lng) => `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;

function rowHtml(s, r) {
  const id = `${s.code}|${r.lat.toFixed(6)},${r.lng.toFixed(6)}`;
  const badges = [];
  if (r.tier === "A") badges.push('<span class="b b-a">A</span>');
  if (r.tier === "B") badges.push('<span class="b b-b">B</span>');
  if (r.tier === "C") badges.push('<span class="b b-c">C</span>');
  if (r.official) badges.push(`<span class="b b-ok" title="공식 경쟁점 DB: ${esc(r.official)}">조사됨</span>`);
  if (r.dupWith.length) badges.push(`<span class="b b-dup" title="같은 자리: ${esc(r.dupWith.join(" / "))}">같은자리</span>`);
  if (r.isOwnBrand) badges.push('<span class="b b-own">자사</span>');
  return `<tr class="row tier-${r.tier}" data-id="${esc(id)}" data-tier="${r.tier}">
  <td class="dist">${r.distanceM}m</td>
  <td class="nm"><a href="${esc(kakaoLink(r.name, r.lat, r.lng))}" target="_blank" rel="noopener">${esc(r.name)}</a> ${badges.join(" ")}
    <div class="addr">${esc(r.address)}</div></td>
  <td class="judge">
    <label><input type="radio" name="j-${esc(id)}" value="영업"><span class="j j-open">영업</span></label>
    <label><input type="radio" name="j-${esc(id)}" value="폐업"><span class="j j-closed">폐업</span></label>
    <label><input type="radio" name="j-${esc(id)}" value="모름"><span class="j j-unk">모름</span></label>
  </td>
  <td class="memo"><input type="text" class="memo-in" placeholder="메모"></td>
</tr>`;
}

function siteHtml(s) {
  const need = s.outside.filter((r) => r.tier === "A" || r.tier === "B").length;
  const cls = s.outsideCount <= SPARSE_MAX ? "sparse" : "dense";
  const outRows = s.outside.map((r) => rowHtml(s, r)).join("\n");
  const inRows = s.inside.map((r) => rowHtml(s, r)).join("\n");
  return `<details class="site ${cls}" data-site="${esc(s.code)}" data-need="${need}" open>
  <summary>
    <span class="sname">${esc(s.name)}</span>
    <span class="smeta">500m 밖 <b>${s.outsideCount}</b>곳 · 최단 <b>${s.nearestOutsideM}m</b> · 볼 것 <b class="need">${need}</b>곳</span>
    <span class="prog" data-prog="${esc(s.code)}">0 / ${need}</span>
    ${s.truncated ? '<span class="b b-warn" title="카카오가 목록을 잘랐다 — 실제로는 더 많다">잘림</span>' : ""}
    ${s.kind === "candidate" ? '<span class="b b-cand">후보지</span>' : ""}
  </summary>
  <div class="sbody">
    <p class="links">
      <a href="${esc(kakaoLink(s.name, s.lat, s.lng))}" target="_blank" rel="noopener">지도에서 이 매장 열기</a>
      <span class="hint">— 지도를 한 번 열고 그 화면에서 'PC방'을 검색하면, 아래 목록과 한꺼번에 대조할 수 있다.</span>
    </p>
    <table class="rows"><tbody>
${outRows || '<tr><td colspan="4" class="none">500m 밖에 카카오가 잡은 PC방이 없다.</td></tr>'}
    </tbody></table>
    ${
      inRows
        ? `<details class="inside"><summary>500m 안 ${s.inside.length}곳 — 이미 조사된 구간이다(검정이 안 쓴다). 펼치기</summary>
    <table class="rows"><tbody>
${inRows}
    </tbody></table></details>`
        : ""
    }
  </div>
</details>`;
}

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>2km 경쟁점 대조</title>
<style>
  :root {
    --bg: #faf6ef; --panel: #fffdf9; --line: #e4d9c6; --ink: #2f2a24; --dim: #7a6f60;
    --accent: #b5502f; --ok: #2f7a4f; --warn: #b07d18; --shadow: 0 1px 2px rgba(47,42,36,.07);
  }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #1c1917; --panel: #24201d; --line: #3a332d; --ink: #ece5da; --dim: #a1968a;
      --accent: #e0805c; --ok: #6fbd8c; --warn: #d9ae53; --shadow: none;
    }
  }
  :root[data-theme="dark"] {
    --bg: #1c1917; --panel: #24201d; --line: #3a332d; --ink: #ece5da; --dim: #a1968a;
    --accent: #e0805c; --ok: #6fbd8c; --warn: #d9ae53; --shadow: none;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.6 -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
    padding: 0 16px 80px;
  }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 24px 0 4px; }
  .sub { color: var(--dim); margin: 0 0 18px; font-size: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 0 0 16px; box-shadow: var(--shadow); }
  .card h2 { font-size: 15px; margin: 0 0 8px; }
  .card p { margin: 6px 0; font-size: 14px; }
  .nums { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 14px; margin: 8px 0 0; }
  .nums b { font-size: 17px; color: var(--accent); }
  .bar { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); padding: 10px 0; margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  button, select { font: inherit; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 7px; padding: 6px 12px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  .total { margin-left: auto; font-size: 14px; color: var(--dim); }
  .total b { color: var(--accent); font-size: 16px; }
  details.site { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; margin: 0 0 10px; box-shadow: var(--shadow); }
  details.site > summary { cursor: pointer; padding: 11px 14px; display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; list-style: none; }
  details.site > summary::-webkit-details-marker { display: none; }
  details.site > summary::before { content: "▸"; color: var(--dim); margin-right: 2px; }
  details.site[open] > summary::before { content: "▾"; }
  .sname { font-weight: 700; }
  .smeta, .prog { color: var(--dim); font-size: 13px; }
  .prog { margin-left: auto; font-variant-numeric: tabular-nums; }
  .prog.done { color: var(--ok); font-weight: 700; }
  .sbody { padding: 0 14px 12px; border-top: 1px solid var(--line); }
  .links { font-size: 13px; margin: 10px 0; }
  .links a { color: var(--accent); }
  .hint { color: var(--dim); }
  table.rows { width: 100%; border-collapse: collapse; }
  table.rows td { border-top: 1px solid var(--line); padding: 7px 6px; vertical-align: top; }
  td.dist { width: 62px; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.nm a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line); }
  td.nm a:hover { color: var(--accent); }
  .addr { color: var(--dim); font-size: 12px; }
  td.judge { width: 210px; white-space: nowrap; }
  td.judge label { cursor: pointer; }
  td.judge input { position: absolute; opacity: 0; pointer-events: none; }
  .j { display: inline-block; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; margin-right: 3px; }
  input:checked + .j-open { background: var(--ok); border-color: var(--ok); color: #fff; }
  input:checked + .j-closed { background: var(--accent); border-color: var(--accent); color: #fff; }
  input:checked + .j-unk { background: var(--dim); border-color: var(--dim); color: #fff; }
  input:focus-visible + .j { outline: 2px solid var(--accent); outline-offset: 2px; }
  td.memo { width: 150px; }
  .memo-in { width: 100%; font: inherit; font-size: 13px; background: transparent; color: var(--ink); border: 1px solid transparent; border-bottom-color: var(--line); padding: 3px 4px; }
  .memo-in:focus { border-color: var(--accent); outline: none; border-radius: 5px; }
  .b { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); vertical-align: 1px; }
  .b-a { background: var(--accent); border-color: var(--accent); color: #fff; }
  .b-b { border-color: var(--accent); color: var(--accent); }
  .b-ok { border-color: var(--ok); color: var(--ok); }
  .b-dup { border-color: var(--warn); color: var(--warn); }
  .b-warn { border-color: var(--warn); color: var(--warn); }
  .none { color: var(--dim); font-size: 14px; }
  details.inside { margin-top: 10px; }
  details.inside > summary { cursor: pointer; color: var(--dim); font-size: 13px; padding: 6px 0; }
  body.only-need tr.tier-C, body.only-need details.inside { display: none; }
  body.only-need tr.tier-C.seen { display: table-row; }
  @media (max-width: 640px) {
    td.judge { width: auto; }
    td.memo { display: none; }
    .prog { margin-left: 0; }
  }
</style>
</head>
<body class="only-need">
<div class="wrap">
<h1>2km 경쟁점 대조 — 폐업 체크</h1>
<p class="sub">만든 때 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ")} KST · 자료 수집 ${esc((nbr.collectedAt ?? "").slice(0, 10))} · 매장 ${stats.sites}곳</p>

<div class="card">
  <h2>무엇을 하는 표인가</h2>
  <p>카카오 장소 자료에 <b>폐업한 PC방이 섞여 있다</b>(문경시청점 7곳 중 3곳). 카카오는 폐업 표시를 주지 않아서
     지도를 사람이 봐야만 안다. 이 판정이 <code>_catchment.test.ts</code>(“2km 안에 대체 PC방이 없다”) 결론을 좌우한다.</p>
  <p><b>500m 안은 볼 필요가 없다.</b> 그 검정은 500m 밖만 센다. 그래서 아래는 기본으로 <b>500m 밖</b>만 보여준다.</p>
  <p>등급 <b>A</b>는 꼭 봐야 하는 것, <b>B</b>는 최단거리만 확정하면 되는 것, <b>C</b>는 판정해도 순위가 안 바뀌는 것이다.
     (<code>C</code>는 기본으로 숨겨져 있다.)</p>
  <div class="nums">
    <span>전체 행 <b>${stats.totalRows}</b></span>
    <span>500m 밖 <b>${stats.outsideRows}</b></span>
    <span>A등급 <b>${stats.A}</b></span>
    <span>B등급 <b>${stats.B}</b></span>
    <span>숨긴 C등급 <b>${stats.C}</b></span>
    <span>같은자리 의심 <b>${stats.dupRows}</b></span>
  </div>
</div>

<div class="card">
  <h2>어떻게 보나</h2>
  <p>1. 매장 줄의 <b>“지도에서 이 매장 열기”</b>를 눌러 카카오맵을 연다. 그 화면에서 <b>PC방</b>을 검색하면 주변 목록이 뜬다.</p>
  <p>2. 아래 목록과 대조해서 <b>영업 / 폐업 / 모름</b>을 누른다. <b>모르면 비워 둬라</b> — 추측해서 채우면 자료가 더 나빠진다.</p>
  <p>3. 다 하면 <b>CSV 내보내기</b>를 눌러 파일을 저장한다. 그 파일을 주면 검정을 다시 돌린다.</p>
  <p class="sub" style="margin-top:10px">기록은 브라우저에 자동 저장된다. 다만 파일을 직접 여는 방식(<code>file://</code>)에서는
     브라우저가 저장을 막을 수 있다 — 그러면 맨 위에 빨간 경고가 뜬다. 그때는 <b>중간중간 CSV로 내보내라.</b></p>
</div>

<div class="card" id="storage-warn" style="display:none;border-color:var(--accent)">
  <h2 style="color:var(--accent)">⚠ 자동 저장이 막혀 있다</h2>
  <p>이 브라우저가 <code>file://</code>에서 저장을 막는다. 창을 닫으면 판정이 사라진다.
     <b>중간중간 “CSV 내보내기”를 눌러라.</b> 또는 <code>npm run dev</code>로 띄운 주소에서 열면 저장이 된다.</p>
</div>

<div class="bar">
  <button id="toggle-c">C등급도 보기</button>
  <button id="expand">모두 펼치기</button>
  <button id="collapse">모두 접기</button>
  <button id="export">CSV 내보내기</button>
  <button id="theme">밝게/어둡게</button>
  <span class="total">판정 <b id="done">0</b> / ${stats.A + stats.B}</span>
</div>

${sites.map(siteHtml).join("\n")}

<div class="card" style="margin-top:20px">
  <h2>알아 둘 것</h2>
  <p><b>잘림</b> 배지가 붙은 ${stats.truncatedSites}곳은 카카오가 목록을 잘라서 준 매장이다 — 실제로는 더 많다.
     그 매장의 개수는 <b>하한</b>으로만 써야 한다.</p>
  <p><b>같은자리</b> 배지는 같은 주소(또는 ${DUP_M}m 안)에 상호가 둘인 곳이다. <b>한쪽이 폐업했을 가능성이 높다.</b>
     ${stats.dupRows}행이 걸렸다 — 먼저 보면 이득이 크다.</p>
  <p>이 표에는 <b>예상매출·실매출·오차가 한 글자도 없다.</b> 일부러 뺐다. 판정이 성적을 보고 움직이면
     시험이 아니라 사후설명이 된다.</p>
</div>
</div>

<script>
(function () {
  var KEY = "rival2km.v1";
  var store = {};
  var canSave = true;
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) store = JSON.parse(raw) || {};
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    canSave = false;
    var w = document.getElementById("storage-warn");
    if (w) w.style.display = "";
  }
  function save() {
    if (!canSave) return;
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { canSave = false; }
  }

  var rows = Array.prototype.slice.call(document.querySelectorAll("tr.row"));

  function restore() {
    rows.forEach(function (tr) {
      var rec = store[tr.dataset.id];
      if (!rec) return;
      if (rec.j) {
        var hit = tr.querySelector('input[value="' + rec.j + '"]');
        if (hit) hit.checked = true;
      }
      var memo = tr.querySelector(".memo-in");
      if (memo && rec.m) memo.value = rec.m;
      if (rec.j || rec.m) tr.classList.add("seen");
    });
  }

  function countDone() {
    var done = 0;
    rows.forEach(function (tr) {
      if (tr.dataset.tier === "C" || tr.dataset.tier === "-") return;
      if (tr.querySelector("input:checked")) done++;
    });
    document.getElementById("done").textContent = done;
    document.querySelectorAll("details.site").forEach(function (d) {
      var need = Number(d.dataset.need || 0);
      var n = 0;
      d.querySelectorAll("tr.row").forEach(function (tr) {
        if (tr.dataset.tier === "C" || tr.dataset.tier === "-") return;
        if (tr.querySelector("input:checked")) n++;
      });
      var p = d.querySelector(".prog");
      if (p) {
        p.textContent = n + " / " + need;
        p.classList.toggle("done", need > 0 && n >= need);
      }
    });
  }

  document.addEventListener("change", function (ev) {
    var tr = ev.target.closest && ev.target.closest("tr.row");
    if (!tr) return;
    var rec = store[tr.dataset.id] || (store[tr.dataset.id] = {});
    var checked = tr.querySelector("input:checked");
    rec.j = checked ? checked.value : "";
    var memo = tr.querySelector(".memo-in");
    rec.m = memo ? memo.value : "";
    tr.classList.add("seen");
    save();
    countDone();
  });
  document.addEventListener("input", function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains("memo-in")) return;
    var tr = ev.target.closest("tr.row");
    var rec = store[tr.dataset.id] || (store[tr.dataset.id] = {});
    rec.m = ev.target.value;
    save();
  });

  document.getElementById("toggle-c").addEventListener("click", function () {
    var on = document.body.classList.toggle("only-need");
    this.textContent = on ? "C등급도 보기" : "A·B등급만 보기";
  });
  document.getElementById("expand").addEventListener("click", function () {
    document.querySelectorAll("details.site").forEach(function (d) { d.open = true; });
  });
  document.getElementById("collapse").addEventListener("click", function () {
    document.querySelectorAll("details.site").forEach(function (d) { d.open = false; });
  });
  document.getElementById("theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    var dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
  });

  document.getElementById("export").addEventListener("click", function () {
    var esc = function (v) {
      var s = String(v == null ? "" : v);
      return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var out = ["매장명,매장코드,거리m,상호,주소,위도,경도,등급,판정,메모"];
    document.querySelectorAll("details.site").forEach(function (d) {
      var sname = d.querySelector(".sname").textContent;
      var scode = d.dataset.site;
      d.querySelectorAll("tr.row").forEach(function (tr) {
        var parts = tr.dataset.id.split("|")[1].split(",");
        var checked = tr.querySelector("input:checked");
        var memo = tr.querySelector(".memo-in");
        out.push([
          sname, scode,
          tr.querySelector(".dist").textContent.replace("m", ""),
          tr.querySelector(".nm a").textContent,
          tr.querySelector(".addr").textContent,
          parts[0], parts[1],
          tr.dataset.tier,
          checked ? checked.value : "",
          memo ? memo.value : ""
        ].map(esc).join(","));
      });
    });
    var blob = new Blob(["\\ufeff" + out.join("\\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "2km-경쟁점-판정.csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  restore();
  countDone();
})();
</script>
</body>
</html>
`;

mkdirSync(fileURLToPath(OUT_DIR), { recursive: true });
writeFileSync(OUT_HTML, html, "utf8");
writeFileSync(OUT_CSV, "﻿" + csvLines.join("\n") + "\n", "utf8");

console.log(`매장 ${stats.sites}곳 · 전체 ${stats.totalRows}행`);
console.log(`  500m 안(볼 필요 없음)  ${stats.insideRows}행   · 자기자신 ${stats.selfRows}행`);
console.log(`  500m 밖                ${stats.outsideRows}행`);
console.log(`    A등급(희소 ${stats.sparseSites}곳 전부)  ${stats.A}행`);
console.log(`    B등급(조밀 매장 최단 ${NEAREST_N})  ${stats.B}행`);
console.log(`    C등급(안 봐도 됨)          ${stats.C}행`);
console.log(`  => 사람이 볼 것 ${stats.A + stats.B}행 (전체의 ${((100 * (stats.A + stats.B)) / stats.totalRows).toFixed(0)}%)`);
console.log(`  같은자리 의심 ${stats.dupRows}행 · 목록 잘린 매장 ${stats.truncatedSites}곳 · 500m밖인데 공식DB에 있는 것 ${stats.officialMatchedOutside}행`);
console.log(`\n-> ${fileURLToPath(OUT_HTML)}`);
console.log(`-> ${fileURLToPath(OUT_CSV)}`);
