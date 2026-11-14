// D28 새 직무 4 「가맹점 주변 경쟁 변화 조기 알림」 — "크게 오름" 기준안 + 지난 기록 되돌려 보기(읽기만, 알림·쓰기 없음).
//
// 자료: pingMonitorStores 문서의 days.{날짜}={a,t,n} (일별 합계). 시간별 pingMonitorDaily는 안 읽는다.
//   - 기본: .local-tools/d28/pingStores.json(fetchPingStores.mjs가 Firebase에서 뜬 사본 — 11-04 07시까지).
//   - --live : PING_STORE_URL·SECRET이 있으면(회사 PC) 사내 저장소에서 바로 읽는다(11-04 이후 기록 포함).
//
// 하루 가동률 = a÷t, n ≥ 20회차이고 1% 이상인 날만(summary.ts FULL_DAY_MIN_SAMPLES·MEASURE_FAIL_MAX_UTIL과 같은 기준).
//
// 기준안(날짜 D 마감 때 경쟁점마다):
//   최근  R = D-4~D 5일 평균(다 찬 날 4일 이상)
//   기준선 B = D-14~D-5 10일의 중앙값(다 찬 날 6일 이상) — 평균이 아니라 중앙값이라 휴업 하루가 기준선을 끌어내리지 못함
//   울림 = R − B ≥ 5%p 그리고 R ÷ B ≥ 1.25   (같은 경쟁점은 처음 한 번만)
//   거름(울리지 않음):
//     a) 계산 제외·IP 재확인 표시 매장
//     b) 측정 방식 바뀜: 그 사이 1688/5040 포트 추가·중지(portSwitchDate, 그리고 전 매장 공통 전환일 10-08·10-09·11-03)
//     c) 대역·대수 바뀜: 회차당 대수(t÷n)가 창 안에서 5% 넘게 달라짐
//     d) 휴업 되살아남: 기준선 창에 그 매장 중앙값의 40% 미만인 날이 있음
//     e) 전체 쏠림: 같은 날 울린 경쟁점이 측정 중인 경쟁점의 10% 넘음(서버·측정 쪽 문제로 봄)
//   (참고) 측정 빠짐·서버 멈춤 날은 애초에 "다 찬 날"이 아니라 계산에서 빠진다 — 거름 없이 n을 안 따지면 어떻게 되는지 --naive로 보여 준다.
//
// 맞혔나: 울린 뒤 우리 매장(같은 ownCode의 isOwnStore) 가동률
//   전 = D-6~D 평균, 후 = D+1~D+7 평균(다 찬 날 각 4일 이상)
//   같은 기간 우리 매장 전체의 (후÷전) 중앙값으로 나눠 계절·요일·연휴를 뺀 값이 0.95 이하이면 "떨어짐".
//   비교용 바탕 비율: 울리지 않은 (경쟁점, 날짜) 짝에서 같은 셈을 한 "떨어짐" 비율.
//
// 쓰는 법: node scripts/d28/rivalSurge.mjs [--live] [--naive] [--grid] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import "./env.mjs";

const flag = (k) => process.argv.includes(k);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

let docs;
if (flag("--live")) {
  const { istore } = await import("../pingMonitor/store/client.mjs");
  docs = (await istore.list("pingMonitorStores")).map((x) => ({ id: x.id, ...x.data }));
} else {
  docs = JSON.parse(readFileSync(new URL("../../.local-tools/d28/pingStores.json", import.meta.url), "utf8")).docs;
}

const MIN_N = 20, FAIL = 0.01;
const SYSTEM_SWITCH_DATES = ["2026-10-08", "2026-10-09", "2026-11-03"]; // 1688 추가·5040 추가·둘 다 중지(위키 측정기 절)
const addDays = (s, k) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const range = (from, to) => { const out = []; for (let x = from; x <= to; x = addDays(x, 1)) out.push(x); return out; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const allDates = [...new Set(docs.flatMap((x) => Object.keys(x.days || {})))].sort();
const lastFull = allDates.at(-2); // 마지막 날은 진행 중일 수 있음
const firstDate = allDates[0];

function util(store, date, naive = false) {
  const v = store.days?.[date];
  if (!v || !v.t) return null;
  const u = v.a / v.t;
  if (naive) return u;
  if (v.n < MIN_N || u < FAIL) return null;
  return u;
}
const vals = (s, dates, naive) => dates.map((d) => util(s, d, naive)).filter((x) => x != null);

const own = new Map(docs.filter((x) => x.isOwnStore).map((x) => [x.ownCode, x]));
const rivals = docs.filter((x) => !x.isOwnStore && x.days && Object.keys(x.days).length);

// 우리 매장: "경쟁점이 오르기 전"(D-13~D-7)을 기준으로 뒤 7일(D+1~D+7)을 본다.
// (울리기 직전 7일을 기준으로 하면, 상권 전체가 같이 오른 주가 기준이 돼 "평소로 돌아온 것"까지 떨어짐으로 셈 — 부경대 10-26에서 확인)
function ownChange(o, D, naive) {
  if (!o) return null;
  const before = vals(o, range(addDays(D, -13), addDays(D, -7)), naive);
  const after = vals(o, range(addDays(D, 1), addDays(D, 7)).filter((d) => d <= lastFull), naive);
  if (before.length < 4 || after.length < 4) return null;
  return mean(after) / mean(before);
}
function ownRise(o, D) {
  if (!o) return null;
  const b = vals(o, range(addDays(D, -13), addDays(D, -7))), r = vals(o, range(addDays(D, -6), D));
  return b.length >= 4 && r.length >= 4 ? mean(r) / mean(b) : null;
}
const peerCache = new Map();
function peerChange(D) {
  if (!peerCache.has(D)) peerCache.set(D, median([...own.values()].map((o) => ownChange(o, D)).filter((x) => x != null)));
  return peerCache.get(D);
}

// 창: 최근 7일(D-6~D) vs 바로 앞 7일(D-13~D-7) — 둘 다 요일이 한 바퀴라 주말 치우침이 없다.
// 시장 보정: 그날 측정된 경쟁점 전체의 (최근÷앞) 중앙값으로 나눈다 → 연휴·날씨·새 게임처럼 다 같이 오른 건 빠진다.
const storeMed = new Map(rivals.map((s) => [s.id, median(vals(s, allDates))]));
function windows(s, D, naive) {
  const med = storeMed.get(s.id);
  const keep = (xs) => (naive ? xs : xs.filter((x) => !(med && x < 0.4 * med)));
  const Rall = vals(s, range(addDays(D, -6), D), naive), Ball = vals(s, range(addDays(D, -13), addDays(D, -7)), naive);
  return { R: Rall, B: keep(Ball), Ball };
}
const marketCache = new Map();
function market(D, naive) {
  const k = D + naive;
  if (!marketCache.has(k)) {
    const ratios = [];
    for (const s of rivals) { const { R, B } = windows(s, D, naive); if (R.length >= 5 && B.length >= 5) ratios.push(mean(R) / mean(B)); }
    marketCache.set(k, median(ratios));
  }
  return marketCache.get(k);
}
function evaluate({ dAbs = 0.04, dRel = 1.25, naive = false, guards = true, adjust = true }) {
  const alarms = [], suppressed = [], pairs = [];
  const fired = new Set();
  const days = allDates.filter((d) => d >= addDays(firstDate, 14) && d <= lastFull);
  for (const D of days) {
    const today = [];
    const m = adjust ? market(D, naive) : 1;
    for (const s of rivals) {
      const { R, B: Bv, Ball } = windows(s, D, naive);
      if (R.length < 5 || Bv.length < 5) continue;
      const r = mean(R), b = mean(Bv);
      const expect = b * m; // 시장만큼 올랐을 때 기대값
      const hit = b > 0 && r - expect >= dAbs && r / expect >= dRel;
      const o = own.get(s.ownCode);
      const oc = ownChange(o, D, naive), pc = peerChange(D);
      const rel = oc != null && pc ? oc / pc : null;
      if (!hit) { if (!fired.has(s.id)) pairs.push({ rel }); continue; }
      if (fired.has(s.id)) continue;
      const reasons = [];
      if (guards) {
        if (s.excludeFromStats) reasons.push("계산 제외 매장");
        if (s.ipCheck) reasons.push("IP 재확인 표시");
        const winFrom = addDays(D, -13);
        const sw = [s.portSwitchDate, ...SYSTEM_SWITCH_DATES].filter((x) => x && x > winFrom && x <= D);
        if (sw.length) reasons.push(`측정 방식 바뀜(${sw.join(",")})`);
        const per = range(winFrom, D).map((d) => s.days?.[d]).filter((v) => v && v.n).map((v) => v.t / v.n);
        if (per.length && Math.max(...per) / Math.min(...per) > 1.05) reasons.push(`대역·대수 바뀜(회차당 ${Math.round(Math.min(...per))}→${Math.round(Math.max(...per))})`);
        if (Ball.length > Bv.length) reasons.push(`앞 7일에 휴업 의심 날 ${Ball.length - Bv.length}일(평소의 40% 미만)`);
      }
      const or = ownRise(o, D);
      const together = or != null && or / (m || 1) >= 1.1; // 우리 매장도 같은 창에서 시장보다 10% 넘게 오름 → 경쟁이 아니라 상권 손님이 는 쪽
      today.push({ s, D, r, b, m, rel, oc, pc, or, together, reasons });
      fired.add(s.id);
    }
    const measured = rivals.filter((s) => util(s, D, naive) != null).length;
    const sys = guards && today.filter((x) => !x.reasons.length).length > Math.max(3, measured * 0.1);
    for (const x of today) {
      if (sys) x.reasons.push(`전체 쏠림(그날 ${today.length}곳 동시)`);
      (x.reasons.length ? suppressed : alarms).push(x);
    }
  }
  const judged = alarms.filter((a) => a.rel != null);
  const hits = judged.filter((a) => a.rel <= 0.95);
  const base = pairs.filter((p) => p.rel != null);
  const baseHit = base.filter((p) => p.rel <= 0.95);
  // 사건 = 같은 우리 매장 주변에서 7일 안에 울린 것 묶음
  const events = [];
  for (const a of [...alarms].sort((x, y) => x.D.localeCompare(y.D))) {
    const ev = events.find((e) => e.ownCode === a.s.ownCode && a.D <= addDays(e.first, 6));
    if (ev) ev.list.push(a); else events.push({ ownCode: a.s.ownCode, ownName: a.s.ownName, first: a.D, list: [a] });
  }
  return { alarms, suppressed, events, judged: judged.length, hits: hits.length, baseRate: base.length ? baseHit.length / base.length : null, baseN: base.length };
}

const pct = (x) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);
const row = (x) => `| ${x.D} | ${x.s.name.slice(0, 18)} | ${x.s.ownName ?? x.s.ownCode} | ${x.s.distanceM ?? "-"}m | ${pct(x.b)} → ${pct(x.r)} (시장 ×${x.m.toFixed(2)}) | ${x.rel == null ? "판정 불가(뒤 기록 부족·우리 매장 미측정)" : `${((x.rel - 1) * 100).toFixed(0)}% ${x.rel <= 0.95 ? "떨어짐" : "안 떨어짐"}`} | ${x.or == null ? "-" : `${((x.or - 1) * 100).toFixed(0)}%${x.together ? " 같이 오름" : ""}`} | ${x.reasons.join(" · ") || ""} |`;

console.log(`자료: ${flag("--live") ? "사내 저장소" : "Firebase 사본(pingStores.json)"} · ${firstDate} ~ ${lastFull} · 경쟁점 ${rivals.length}곳 · 우리 매장 ${own.size}곳`);
const main = evaluate({});
console.log(`\n[기준안] 최근 7일 vs 앞 7일, 시장 보정 뒤 +4%p 이상 그리고 1.25배 이상 · 거름 켬`);
console.log(`사건(같은 매장 주변 7일 안 묶음) ${main.events.length}건 · ` + `울림 ${main.alarms.length}건 · 거름에 걸려 안 울림 ${main.suppressed.length}건 · 맞혔나 판정 가능 ${main.judged}건 중 우리 매장 떨어짐 ${main.hits}건 (${main.judged ? pct(main.hits / main.judged) : "-"}) · 안 울린 때 바탕 비율 ${pct(main.baseRate)} (${main.baseN}짝)`);
const HEAD = "| 날짜 | 경쟁점 | 우리 매장 | 거리 | 경쟁점 앞 7일 → 최근 7일 | 뒤 7일 우리 매장(오르기 전 대비·동료 보정) | 울린 주 우리 매장 | 거른 이유 |\n|---|---|---|---|---|---|---|---|";
console.log(HEAD);
for (const x of main.alarms) console.log(row(x));
console.log("\n[거름에 걸린 것 = 잘못 울릴 뻔한 예]");
for (const x of main.suppressed) console.log(row(x));

if (flag("--naive")) {
  const nv = evaluate({ naive: true, guards: false, adjust: false });
  console.log(`\n[거름·시장 보정 없이 · 측정 덜 찬 날도 그대로 셈] 울림 ${nv.alarms.length}건 · 판정 ${nv.judged}건 중 떨어짐 ${nv.hits}건 (${nv.judged ? pct(nv.hits / nv.judged) : "-"})`);
  const mainIds = new Set([...main.alarms, ...main.suppressed].map((x) => x.s.id));
  for (const x of nv.alarms.filter((x) => !mainIds.has(x.s.id))) {
    const win = range(addDays(x.D, -14), x.D).map((d) => [d, x.s.days?.[d]]).filter(([, v]) => v && v.n < MIN_N).map(([d, v]) => `${d.slice(5)} ${v.n}회`);
    console.log(row(x) + ` 덜 찬 날: ${win.join(", ") || "없음"}`);
  }
}
if (flag("--grid")) {
  console.log("\n[문턱 바꿔 보기] (거름 켬)\n| %p | 배 | 울림 | 판정 | 떨어짐 | 맞힌 비율 |\n|---|---|---|---|---|---|");
  for (const dAbs of [0.03, 0.04, 0.06]) for (const dRel of [1.15, 1.25, 1.4]) {
    const g = evaluate({ dAbs, dRel });
    console.log(`| ${dAbs * 100} | ${dRel} | ${g.alarms.length} | ${g.judged} | ${g.hits} | ${g.judged ? pct(g.hits / g.judged) : "-"} |`);
  }
  console.log(`바탕 비율(안 울린 때 우연히 떨어짐) ${pct(main.baseRate)}`);
}
const out = arg("--json");
if (out) writeFileSync(out, JSON.stringify({ alarms: main.alarms.map((x) => ({ ...x, s: { id: x.s.id, name: x.s.name, ownCode: x.s.ownCode } })), suppressed: main.suppressed.map((x) => ({ ...x, s: { id: x.s.id, name: x.s.name } })) }, null, 2));
