// 상권 분리(길 건너) 눈가림 판정 페이지를 만든다 — 2026-09-18.
//
//   node scripts/buildMarketSplitJudgePage.mjs
//   -> .local-tools/market-split-judge.html
//
// ── 왜 페이지를 따로 만드나 ────────────────────────────────────────────────
// 판정 대상이 153쌍이다. CSV에 붙은 카카오 링크를 쌍마다 셋씩 열면 459번을 클릭해야 한다.
// 실제로 그러면 끝까지 안 간다. 지도를 페이지 안에 띄우고 키보드로 넘기면 한 쌍에 한 번이다.
//
// ── 눈가림이 성립하는 이유 ────────────────────────────────────────────────
// 1. 이 페이지에는 **잔차·예상매출·실매출·적중률이 한 글자도 없다.** 판정이 성적을 보고
//    움직이면 시험이 아니라 사후설명이 된다.
// 2. 자동 판정은 **OSM 도로 자료**로 하고, 사람은 **카카오 지도**를 본다. 자료원이 갈려 있어야
//    "둘이 맞다"가 의미를 갖는다. (그래서 OSM 타일을 쓰면 안 된다 — 같은 걸 두 번 보는 셈이다.)
// 3. 순서는 CSV 그대로다. CSV가 시드 20260918로 섞여 있어 매장별로 뭉치지 않는다 —
//    한 매장을 연달아 보면 앞 판정에 끌려간다.
//
// ── 키는 이 스크립트가 읽는다 ─────────────────────────────────────────────
// `.env.local`의 NEXT_PUBLIC_KAKAO_MAP_JS_KEY를 여기서 읽어 페이지에 넣는다
// (scripts/roadview/README.md의 2)번과 같은 방식). 산출물은 .local-tools 안이라 git에 안 올라간다.
import { readFileSync, writeFileSync } from "node:fs";

const CSV = new URL("../.local-tools/market-split-judgment.csv", import.meta.url);
const OUT = new URL("../.local-tools/market-split-judge.html", import.meta.url);

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();
const APPKEY = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
if (!APPKEY) {
  console.error("NEXT_PUBLIC_KAKAO_MAP_JS_KEY가 .env.local에 없다. 변수 이름을 확인해야 한다.");
  process.exit(1);
}

/** 따옴표 안의 쉼표를 지키는 최소 CSV 파서. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}

const raw = readFileSync(CSV, "utf8").replace(/^﻿/, "");
const rows = parseCsv(raw);
const noteLine = rows[0][0].startsWith("#") ? rows.shift()[0] : "";
const header = rows.shift();
const col = (name) => header.indexOf(name);
const need = ["매장명", "경쟁점명", "거리m", "방위", "자사위도", "자사경도", "경쟁점위도", "경쟁점경도"];
for (const n of need) {
  if (col(n) === -1) { console.error(`CSV에 '${n}' 칸이 없다. dumpMarketSplitJudgment.mjs를 먼저 돌렸나?`); process.exit(1); }
}

const pairs = rows.map((r, i) => ({
  i,
  store: r[col("매장명")],
  rival: r[col("경쟁점명")],
  dist: Number(r[col("거리m")]),
  dir: r[col("방위")],
  sLat: Number(r[col("자사위도")]), sLng: Number(r[col("자사경도")]),
  rLat: Number(r[col("경쟁점위도")]), rLng: Number(r[col("경쟁점경도")]),
  rv: r[col("로드뷰_경쟁점")] ?? "",
})).filter((p) => Number.isFinite(p.sLat) && Number.isFinite(p.rLat));

console.log(`판정 대상 ${pairs.length}쌍 · 매장 ${new Set(pairs.map((p) => p.store)).size}곳`);
if (noteLine) console.log(`  (CSV 머리글: ${noteLine.slice(0, 60)}…)`);

const html = String.raw`<!doctype html>
<html lang="ko"><meta charset="utf-8">
<title>상권 분리 판정 — 눈가림</title>
<style>
  :root{
    --bg:#14110e; --panel:#1d1915; --line:#3a322a; --ink:#f0e9df; --dim:#a89b8a;
    --same:#5b8c5a; --across:#c1663f; --unsure:#6b6257; --accent:#d98b5f;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
    font:14px/1.5 "Malgun Gothic","Apple SD Gothic Neo",sans-serif}
  #app{display:flex;flex-direction:column;height:100%}
  header{padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);
    display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .prog{font-variant-numeric:tabular-nums;color:var(--dim)}
  .bar{flex:1;min-width:120px;height:6px;background:#2a241e;border-radius:3px;overflow:hidden}
  .bar>i{display:block;height:100%;background:var(--accent);width:0}
  .who{font-size:17px;font-weight:700}
  .meta{color:var(--dim);font-size:13px}
  #map{flex:1;min-height:0;background:#000}
  footer{padding:10px 16px;background:var(--panel);border-top:1px solid var(--line);
    display:flex;flex-direction:column;align-items:flex-start;flex-wrap:wrap}
  button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid var(--line);
    background:#272119;color:var(--ink);cursor:pointer}
  button:hover{border-color:var(--accent)}
  button.same{background:var(--same);border-color:var(--same);color:#fff;font-weight:700}
  button.across{background:var(--across);border-color:var(--across);color:#fff;font-weight:700}
  button.unsure{background:var(--unsure);border-color:var(--unsure);color:#fff;font-weight:700}
  button.ours{background:#2b6cb0;border-color:#2b6cb0;color:#fff;font-weight:700}
  button.theirs{background:var(--across);border-color:var(--across);color:#fff;font-weight:700}
  button.both{background:#7a6aa8;border-color:#7a6aa8;color:#fff;font-weight:700}
  .qrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%}
  .qrow+.qrow{margin-top:8px}
  .qlabel{font-weight:700;color:var(--accent);min-width:190px}
  .key{opacity:.7;font-size:12px;margin-left:6px}
  .verdict{padding:4px 10px;border-radius:6px;font-weight:700}
  input[type=text]{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--line);
    background:#272119;color:var(--ink);min-width:200px}
  a{color:var(--accent)}
  .hint{color:var(--dim);font-size:12px}
  @media (max-width:640px){ header,footer{padding:8px 10px} button{padding:9px 12px} }
</style>
<div id="app">
  <header>
    <span class="prog" id="prog">0 / 0</span>
    <span class="bar"><i id="barfill"></i></span>
    <span class="who" id="who">—</span>
    <span class="meta" id="meta"></span>
    <span class="verdict" id="verdict"></span>
  </header>
  <div id="map"></div>
  <footer>
    <div class="qrow">
      <span class="qlabel" id="qlabel">1. 둘 사이에 뭐가 있나</span>
      <span id="btns1">
        <button class="same" onclick="ans(1,'같은편')">같은편<span class="key">1</span></button>
        <button class="across" onclick="ans(1,'길건너')">길건너<span class="key">2</span></button>
        <button class="unsure" onclick="ans(1,'모르겠음')">모르겠음<span class="key">3</span></button>
      </span>
      <span id="btns2" hidden>
        <button class="ours" onclick="ans(2,'우리편')">우리 편<span class="key">1</span></button>
        <button class="theirs" onclick="ans(2,'경쟁점편')">경쟁점 편<span class="key">2</span></button>
        <button class="both" onclick="ans(2,'양쪽')">양쪽 다<span class="key">3</span></button>
        <button class="unsure" onclick="ans(2,'모르겠음')">모르겠음<span class="key">4</span></button>
      </span>
    </div>
    <div class="qrow">
      <button onclick="move(-1)">← 이전 쌍</button>
      <button onclick="move(1)">다음 쌍 →</button>
      <input type="text" id="memo" placeholder="메모 (선택)">
      <a id="rvlink" href="#" target="_blank" rel="noopener">로드뷰 열기</a>
      <button onclick="downloadCsv()">CSV 내려받기</button>
      <span class="hint">확신 없으면 <b>모르겠음</b>이 정답입니다. 자동 저장됩니다.</span>
    </div>
  </footer>
</div>
<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=__APPKEY__&autoload=false"></script>
<script>
const PAIRS = __PAIRS__;
const KEY = 'market-split-judgment-v2';
let verdicts = {};
try { verdicts = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { verdicts = {}; }
// v1(문항 하나)로 누르다 만 게 있으면 1번 답만 이어받는다.
try {
  const old = JSON.parse(localStorage.getItem('market-split-judgment-v1') || '{}');
  for (const k of Object.keys(old)) {
    if (!verdicts[k] && old[k] && old[k].v) verdicts[k] = { v: old[k].v, d: '', m: old[k].m || '' };
  }
} catch (e) {}

const doneAt = (i) => { const c = verdicts[i]; return !!(c && c.v && c.d); };
const hasQ = (i, q) => { const c = verdicts[i]; return !!(c && (q === 1 ? c.v : c.d)); };

// ── 한 번에 한 문항만 묻는다 ────────────────────────────────────────────
// 153쌍을 1번·2번 번갈아 물으면 앞 답에 끌려간다(닻내림). 그리고 실제로 2026-09-18에
// 1번만 46쌍까지 누르던 중에 2번 문항이 추가됐다. 그래서 **1번을 153쌍 다 끝낸 뒤
// 2번 한 바퀴**를 돈다. 남은 문항이 뭔지는 저장된 답을 보고 페이지가 알아서 정한다.
let stage = 1;
for (let i = 0; i < PAIRS.length; i++) { if (!hasQ(i, 1)) { stage = 1; break; } if (i === PAIRS.length - 1) stage = 2; }
let idx = 0;
for (let i = 0; i < PAIRS.length; i++) { if (!hasQ(i, stage)) { idx = i; break; } }

let map, markers = [], line = null, overlays = [];

function save() { try { localStorage.setItem(KEY, JSON.stringify(verdicts)); } catch (e) {} }

function render() {
  const p = PAIRS[idx];
  let n1 = 0, n2 = 0, done = 0;
  for (let i = 0; i < PAIRS.length; i++) { if (hasQ(i, 1)) n1++; if (hasQ(i, 2)) n2++; if (doneAt(i)) done++; }
  const cnt = stage === 1 ? n1 : n2;
  document.getElementById('prog').textContent =
    (idx + 1) + ' / ' + PAIRS.length + '   [' + stage + '번 문항 ' + cnt + '개]';
  document.getElementById('barfill').style.width = (cnt / PAIRS.length * 100) + '%';
  void done;
  document.getElementById('who').textContent = p.store + '  ↔  ' + p.rival;
  document.getElementById('meta').textContent = p.dist + 'm · ' + p.dir + '쪽';

  const cur = verdicts[idx] || {};
  const vEl = document.getElementById('verdict');
  const bits = [];
  if (cur.v) bits.push(cur.v);
  if (cur.d) bits.push('수요: ' + cur.d);
  vEl.textContent = bits.join(' · ');
  vEl.style.background = bits.length ? '#2a241e' : 'transparent';
  document.getElementById('memo').value = cur.m || '';
  document.getElementById('rvlink').href = p.rv || '#';

  document.getElementById('qlabel').textContent = stage === 1
    ? '1. 둘 사이에 뭐가 있나' : '2. 사람 많은 쪽은 어느 편인가';
  document.getElementById('btns1').hidden = stage !== 1;
  document.getElementById('btns2').hidden = stage !== 2;

  const a = new kakao.maps.LatLng(p.sLat, p.sLng);
  const b = new kakao.maps.LatLng(p.rLat, p.rLng);
  markers.forEach(m => m.setMap(null)); markers = [];
  overlays.forEach(o => o.setMap(null)); overlays = [];
  if (line) { line.setMap(null); line = null; }

  markers = [new kakao.maps.Marker({ position: a, map }), new kakao.maps.Marker({ position: b, map })];
  overlays = [
    new kakao.maps.CustomOverlay({ position: a, map, yAnchor: 2.1,
      content: '<div style="background:#2b6cb0;color:#fff;padding:2px 7px;border-radius:5px;font:12px sans-serif;white-space:nowrap">자사</div>' }),
    new kakao.maps.CustomOverlay({ position: b, map, yAnchor: 2.1,
      content: '<div style="background:#c1663f;color:#fff;padding:2px 7px;border-radius:5px;font:12px sans-serif;white-space:nowrap">경쟁점</div>' }),
  ];
  // 밝은 지도 위라 흰 선은 묻힌다(2026-09-18 화면 확인). 진한 색 + 굵게.
  line = new kakao.maps.Polyline({ path: [a, b], strokeWeight: 5, strokeColor: '#1a1a1a',
    strokeOpacity: 0.9, strokeStyle: 'shortdash', map });

  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(a); bounds.extend(b);
  map.setBounds(bounds, 80, 80, 80, 80);
}

/** 지금 문항에 답하고 다음 쌍으로. 한 바퀴를 다 돌면 다음 문항으로 넘어간다. */
function ans(q, val) {
  const cur = verdicts[idx] || { v: '', d: '', m: '' };
  cur.m = document.getElementById('memo').value;
  if (q === 1) cur.v = val; else cur.d = val;
  verdicts[idx] = cur; save();

  // 이 문항이 아직 빈 다음 쌍으로. 없으면 다음 문항 첫 쌍으로.
  for (let i = idx + 1; i < PAIRS.length; i++) { if (!hasQ(i, stage)) { idx = i; render(); return; } }
  for (let i = 0; i < PAIRS.length; i++) { if (!hasQ(i, stage)) { idx = i; render(); return; } }
  if (stage === 1) {
    stage = 2;
    for (let i = 0; i < PAIRS.length; i++) { if (!hasQ(i, 2)) { idx = i; render(); return; } }
  }
  render();
}
function move(d) {
  const cur = verdicts[idx];
  if (cur) { cur.m = document.getElementById('memo').value; save(); }
  idx = Math.max(0, Math.min(PAIRS.length - 1, idx + d));
  render();
}
/** 문항을 손으로 바꾼다 — 1번 답을 고치고 싶을 때. */
function setStage(s) { stage = s; render(); }
function csvCell(s) {
  s = String(s == null ? '' : s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv() {
  const head = ['매장명','경쟁점명','거리m','방위','자사위도','자사경도','경쟁점위도','경쟁점경도','판정','수요편','메모'];
  const lines = [head.join(',')];
  PAIRS.forEach((p, i) => {
    const c = verdicts[i] || {};
    lines.push([p.store,p.rival,p.dist,p.dir,p.sLat,p.sLng,p.rLat,p.rLng,c.v||'',c.d||'',c.m||''].map(csvCell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'market-split-judgment-filled.csv';
  a.click();
}
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') e.target.blur(); return; }
  const m1 = { '1': '같은편', '2': '길건너', '3': '모르겠음' };
  const m2 = { '1': '우리편', '2': '경쟁점편', '3': '양쪽', '4': '모르겠음' };
  const pick = stage === 1 ? m1[e.key] : m2[e.key];
  if (pick) { ans(stage, pick); return; }
  if (e.key === 'ArrowLeft') move(-1);
  else if (e.key === 'ArrowRight') move(1);
  else if (e.key === 'Backspace') { setStage(stage === 1 ? 2 : 1); }  // 문항 바꾸기
});

kakao.maps.load(function () {
  map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(PAIRS[0].sLat, PAIRS[0].sLng), level: 4,
  });
  map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
  map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  render();
});
</script>
</html>`;

writeFileSync(
  OUT,
  html.replace("__APPKEY__", APPKEY).replace("__PAIRS__", JSON.stringify(pairs)),
  "utf8",
);
console.log(`-> ${OUT.pathname.replace(/^\//, "")}`);
console.log("  브라우저로 열어 1(같은편) · 2(길건너) · 3(모르겠음)로 넘긴다. 자동 저장된다.");
console.log("  다 하면 [CSV 내려받기] -> .local-tools/market-split-judgment-filled.csv 로 옮긴다.");
