// 입지 재설계 — 무엇을 버리고 무엇으로 다시 세울지 먼저 잰다 (2026-09-17). 일회성 분석용.
//
// 사용자 방향(2026-09-17): "입지부분은 전체교체필요함 항목이랑 평가값까지 전체개념 재수립필요"
//
//   npx vitest run src/lib/storeEval/_locationRebuild.test.ts --reporter=verbose
//
// ── 왜 이 검사가 먼저인가 ────────────────────────────────────────────────
// 새 경쟁 항(2026-09-17 채택)은 **자사 품질과 경쟁점 품질을 직접 나눈다**:
//
//   점유율 = 자사PC ÷ (자사PC + Σ[R 안] 경쟁PC x (경쟁품질÷자사품질)^θ)
//
// 그래서 입지를 여기 넣으려면 **자사와 경쟁점을 같은 자로 재야 한다.** 지금은 아니다:
//
//   자사   computeOwnLocationScore       = 상권위치·동선 x0.6 + 선점경쟁 x0.25 + 접근가시성 x0.15
//   경쟁점 computeLocationScoreFromFacts = 층수 + 엘리베이터
//
// 자가 다르면 나눗셈이 뜻을 잃는다. 2026-09-15에 자를 맞추려다 정확도가 악화돼(A 9.67% ->
// B 11.54%) "의도된 상태로 둔다"고 결론냈는데, **그건 경쟁 항이 격차^4이던 시절 이야기다.**
// 지금 구조에서는 자가 다른 걸 그냥 둘 수 없다.
//
// 그래서 이 검사가 답할 것은 셋이다:
//   ① 지금 입지 3항목은 실제로 무엇을 재고 있나 (분포·변별력·실측 점유율과의 관계)
//   ② 자사·경쟁점 **양쪽에 다 있는** 입지 원자료가 무엇인가 (채움률)
//   ③ 같은 자로 잰 입지를 품질에 넣으면 순서가 좋아지나 (새 항의 판정 기준은 r이다)
//
// ── 결과 (2026-09-17) ───────────────────────────────────────────────────
//
// **한 줄: 입지는 경쟁력점수 안에서 빼고, 층수 기반 "접근성"을 독립 곱셈 항으로 둔다.**
//
// ① **주관 3항목은 전부 유의선(0.371) 미달이고, 값이 3~4개밖에 안 쓰인다.**
//      상권위치·동선  값 3개 (29곳 중 19곳이 5점)  r=0.075  시점통제 0.111
//      선점경쟁       값 3개 (29곳 중 17곳이 3점)  r=0.220  시점통제 0.246
//      접근가시성     값 4개                      r=0.181  시점통제 0.200
//      **층수자 점수  값 5개 전부 쓰임            r=0.329  시점통제 0.389 ***  <- 유일하게 유의
//    사람이 1~5로 매긴 셋보다 **층수에서 기계적으로 나온 값이 낫다.**
//
// ② **양쪽에 다 있는 입지 원자료는 층수·지상지하·엘리베이터 셋뿐이다.**
//      층수 자사 41/41 · 경쟁 200/225(89%) / 지상지하 88% / 엘베 92%
//      좌표는 자사도 스냅샷에 0/41이고 경쟁점엔 아예 없다. 주관 3항목은 경쟁점에 없다.
//    새 항은 자사÷경쟁을 나누므로 **자사에만 있는 항목은 그대로는 못 넣는다.**
//
// ③ **품질에 섞으면 소용없다.** 유효거리 300m·θ=3 고정, 입지 없음 r=0.554 기준:
//      층수자 입지 17%   r 0.562 (+0.008)  한 곳 빼면 0.323~0.730  <- 하한이 유의선 아래
//      층수자 입지 8.5%  r 0.565 (+0.011)  한 곳 빼면 0.354~0.716  <- 역시 아래
//      자가 다른 채로 17% r 0.519 (-0.035)                        <- 지금 운영방식, 더 나쁘다
//    MAPE·편향은 전부 악화한다(-5.5% -> -21.9%).
//
// ④ **독립 곱셈 항으로 두면 완전히 다르다.** 점유율 x (자사 층수자 점수 ÷ 4)^κ:
//      κ=0     편향 -5.5%  MAPE 30.9%  r 0.554  한 곳 빼면 0.383~0.676
//      κ=0.25  편향 -10.0% MAPE 28.7%  r 0.632  한 곳 빼면 0.453~0.769
//      κ=0.5   편향 -13.2% MAPE 29.6%  r 0.657  한 곳 빼면 0.476~0.781
//    품질 점유율이 남긴 오차와 층수자 점수의 상관이 r=0.400*(시점통제 0.374*)다.
//    **접근성은 "경쟁점보다 낮은 층인가"가 아니라 "올라오기 얼마나 번거로운가"다.**
//    6층 매장은 경쟁점이 없어도 덜 온다 — 그래서 비율이 아니라 곱셈이 맞다.
//
// ⑤ **관문 통과 — 그것도 MAPE 기준으로.** (경쟁 항은 MAPE 기준을 못 넘었다)
//      LOO      28.66% -> 28.66%  **벌어짐 0.00%p** (훈련겹 100%가 κ=0.25를 고른다)
//      5겹 100회 κ=0.25 88%       안정
//      대조군    MAPE p=0.046 ✅ · r p=0.048 ✅
//    ⚠️ **여유가 없다.** 두 p값이 0.05에 간신히 걸쳐 있고(실제 2.27%p vs 95퍼센타일 2.06%p),
//       평가창 시점을 통제하면 잔차 상관이 0.400 -> 0.374로 유의선 0.371에 거의 붙는다.
//       코호트 교란 가능성이 남아 있다(memory: project_cohort_effect_confound).
//    ⚠️ **r 기준으로 고르면 과적합한다** — κ=0.75가 LOO에서 33.0% -> 42.1%로 무너지고
//       5겹에서 κ=2를 54% 고른다. **여기서는 MAPE 기준이 맞다**(경쟁 항과 반대다).
//
// ⑥ **"경쟁점 대비 층수"는 아니다 — "우리가 몇 층인가"만 작용한다.** (사용자 항목 ②)
//    경쟁점 층수를 아는 27곳에서 품질 점유율 잔차와의 상관:
//      자사 절대 층수   r=0.443 * (시점통제 0.413 *)   <- 이것만 걸린다
//      자사 − 경쟁      r=0.410 * (시점통제 0.382)     <- 자사가 들어있어서 따라 올라간 값
//      **경쟁 층수만    r=-0.004** (시점통제 -0.038)   <- 아무것도 아니다
//    상대항 μ를 같이 넣으면 전부 나빠진다(κ=0.25·μ=0에서 MAPE 24.4%가 최선, μ를 올리면 28~35%).
//    -> **"올라오기 번거롭다"가 맞고 "경쟁점과 비교당한다"는 아니다.** 경쟁점 층수는 안 봐도 된다.
//    ⚠️ 표본 27곳이고 자사가 층수에서 불리한 곳이 14곳뿐이다. 표본이 늘면 다시 본다.
//
// ⚠️ 이건 **측정이지 채택이 아니다.** 입지 개념 재수립은 사용자 결정 사항이다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSpecScore, computeOwnZoneComposition, computeCompetitorZoneComposition, computeLocationScoreFromFacts } from "./calc";
import { defaultModelSettings } from "./settings";
import { computeQualityScore, DEFAULT_TEXTBOOK_PARAMS, type QualityParts } from "./textbookModel";

const SNAP = ".local-tools/validation-snapshot.json";
const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = [SNAP, FLOAT_FILE, RESI_FILE, UTIL_FILE].every((f) => existsSync(f));
const describeIf = ready ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
function pear(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : NaN;
}
/** 평가창 시점을 통제한 편상관 — 코호트 교란을 걷어낸다(2026-09-16의 교훈). */
function partial(x: number[], y: number[], z: number[]) {
  const rxy = pear(x, y), rxz = pear(x, z), ryz = pear(y, z);
  return (rxy - rxz * ryz) / Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
}
const RM = { t: 0.39, tw: 0.42, th: 0.17, f: 0.1 }, RF = { t: 0.13, tw: 0.15, th: 0.045, f: 0.02 };
const bl = (m: number) => ({ t: m * RM.t + (1 - m) * RF.t, tw: m * RM.tw + (1 - m) * RF.tw, th: m * RM.th + (1 - m) * RF.th, f: m * RM.f + (1 - m) * RF.f });

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("입지 재설계 — 먼저 잰다", () => {
  const S = JSON.parse(readFileSync(SNAP, "utf8"));
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const U = JSON.parse(readFileSync(UTIL_FILE, "utf8"));
  const F = fl.sites ?? fl, R = re.sites ?? re, set = defaultModelSettings();
  const W = DEFAULT_TEXTBOOK_PARAMS.qualityWeights;

  const compsBy = new Map<string, any[]>();
  for (const c of S.competitors as any[]) {
    if (!compsBy.has(c.candidateCode)) compsBy.set(c.candidateCode, []);
    compsBy.get(c.candidateCode)!.push(c);
  }
  const locBy = new Map((S.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));

  const ownParts = (s: any, pc: number): QualityParts => ({
    spec: computeSpecScore({
      vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
      cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
      ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
      monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
    }, set),
    food: s.ownFoodScore ?? null,
    zone: computeOwnZoneComposition({
      counts: { singleSeatCount: s.ownSingleSeatCount ?? null, room1: s.ownRoom1 ?? null, room2: s.ownRoom2 ?? null,
        teamRoom: s.ownTeamRoom ?? null, coupleZone: s.ownCoupleZone ?? null, vipZone: s.ownVipZone ?? null,
        friendsZone: s.ownFriendsZone ?? null, firstClassZone: s.ownFirstClassZone ?? null },
      teamRoomTotalSeats: s.ownTeamRoomTotalSeats ?? null, totalPcCount: pc,
    }).composition,
    interior: s.ownInteriorScore ?? null,
    management: s.ownManagementScore ?? null,
  });
  const rivalParts = (c: any): QualityParts => ({
    spec: computeSpecScore({
      vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
      cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
      ram: c.ram ?? null, ramTop: c.ramTop ?? null,
      monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
    }, set),
    food: c.foodScore ?? null,
    zone: computeCompetitorZoneComposition({
      counts: { singleSeatCount: c.singleSeatCount ?? null, room1: c.room1 ?? null, room2: c.room2 ?? null,
        teamRoom: c.teamRoom ?? null, coupleZone: c.coupleZone ?? null, vipZone: c.vipZone ?? null,
        friendsZone: c.friendsZone ?? null, firstClassZone: c.firstClassZone ?? null },
      regularCoupleSeatCount: c.regularCoupleSeatCount ?? null,
      teamRoomTotalSeats: c.teamRoomTotalSeats ?? null,
      totalPcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
    } as any).composition,
    interior: c.interiorScore ?? null,
    management: c.managementScore ?? null,
  });

  type Row = {
    n: string; pc: number; loc: any; store: any;
    parts: QualityParts; floorScore: number | null;
    rivals: { ip: number; d: number; parts: QualityParts; floorScore: number | null }[];
    demand: number; util: number; t: number; shareObs: number;
  };
  const rows: Row[] = [];
  for (const s of S.existingStores as any[]) {
    const pc = s.evaluationPcCount ?? s.pcCount; if (!pc) continue;
    const g = U[s.storeName]; if (!g?.rows?.length) continue;
    const k = `existing:${s.storeCode}`, fv = F[k], rv = R[k]; if (!fv || !rv) continue;
    const p = rv.radii?.["1000"]?.pops; if (p?.age_2_cnt == null) continue;
    const rm = p.woman_cnt != null && Number(p.tot_ppltn_cnt) > 0 ? 1 - Number(p.woman_cnt) / Number(p.tot_ppltn_cnt) : 0.5;
    const RR = bl(rm);
    const pop = Number(p.age_2_cnt) * RR.t + Number(p.age_3_cnt) * RR.tw + Number(p.age_4_cnt) * RR.th + Number(p.age_5_cnt) * RR.f;
    const f4 = fv.radii?.["400"]; if (!f4?.selected?.length || !f4.demographics) continue;
    const last = f4.selected[f4.selected.length - 1];
    const sc = last > 0 ? mean(f4.selected.slice(-12)) / last : 1;
    const d = f4.demographics, FR = bl(d.total > 0 ? d.male / d.total : 0.5);
    const env = ((d.age10s ?? 0) * FR.t + (d.age20s ?? 0) * FR.tw + (d.age30s ?? 0) * FR.th + (d.age40s ?? 0) * FR.f) * sc;
    const win = g.rows.map((r: any) => r.yearMonth).sort();
    const mid = win[Math.floor(win.length / 2)];
    rows.push({
      n: s.storeName, pc, loc: locBy.get(s.storeCode) ?? {}, store: s,
      parts: ownParts(s, pc),
      floorScore: computeLocationScoreFromFacts(s.floor ?? null, s.groundLevel ?? null, s.hasElevator ?? null),
      rivals: (compsBy.get(s.storeCode) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음")
        .map((c) => ({
          ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0), d: Number(c.distanceM ?? 0),
          parts: rivalParts(c),
          floorScore: computeLocationScoreFromFacts(c.floor ?? null, c.groundLevel ?? null, c.hasElevator ?? null),
        }))
        .filter((r) => r.ip > 0),
      demand: pop + env * 0.15, util: mean(g.rows.map((r: any) => r.monthlyRate)),
      t: Number(mid.slice(0, 4)) * 12 + Number(mid.slice(5, 7)), shareObs: 0,
    });
  }
  const mono = rows.filter((r) => !r.rivals.length);
  const A = med(mono.map((r) => r.util / (r.demand / (r.pc * 720))));
  for (const r of rows) r.shareObs = r.util / (A * r.demand / (r.pc * 720));
  const cmp = rows.filter((r) => r.rivals.length);

  it("① 지금 입지 3항목은 실제로 무엇을 재고 있나", () => {
    const n = cmp.length, sig = 2 / Math.sqrt(n);
    console.log(`\n기존점 ${rows.length}곳 · 경쟁상권 ${n}곳 · 유의선 ${sig.toFixed(3)}`);
    console.log(`${"항목".padEnd(20)}${"결측".padStart(6)}${"쓰인값".padStart(8)}${"분포".padStart(22)}${"실측점유율 r".padStart(13)}${"시점통제".padStart(10)}`);
    const items: [string, (r: Row) => unknown][] = [
      ["상권위치·동선", (r) => r.loc.locationScore],
      ["선점경쟁", (r) => r.loc.preemptionScore],
      ["접근가시성", (r) => r.loc.visibilityScore],
      ["(참고) 층수자 점수", (r) => r.floorScore],
    ];
    for (const [label, get] of items) {
      const ok = cmp.filter((r) => { const v = get(r); return v != null && Number.isFinite(Number(v)); });
      const v = ok.map((r) => Number(get(r)));
      if (v.length < 10) { console.log(`${label.padEnd(20)}${String(n - v.length).padStart(6)}  결측이 너무 많다`); continue; }
      const tally = [...new Set(v)].sort((a, b) => a - b).map((x) => `${x}:${v.filter((y) => y === x).length}`).join(" ");
      const y = ok.map((r) => r.shareObs), t = ok.map((r) => r.t);
      const r1 = pear(v, y), r2 = partial(v, y, t);
      console.log(`${label.padEnd(20)}${String(n - v.length).padStart(6)}${String(new Set(v).size).padStart(8)}${tally.padStart(22)}${(r1.toFixed(3) + (Math.abs(r1) > sig ? "*" : " ")).padStart(13)}${(r2.toFixed(3) + (Math.abs(r2) > sig ? "*" : " ")).padStart(10)}`);
    }
    console.log(`  -> 1~5점인데 실제로 쓰이는 값이 몇 개인지가 핵심이다. 값이 3~4개뿐이면 배점을 바꿔도 소용없다.`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("② 자사·경쟁점 양쪽에 다 있는 입지 원자료는 무엇인가", () => {
    const comps = (S.competitors as any[]).filter((c) => c.investigationStatus !== "경쟁점없음");
    const fill = (arr: any[], get: (x: any) => unknown) => {
      const k = arr.filter((x) => { const v = get(x); return v != null && v !== ""; }).length;
      return `${k}/${arr.length} (${Math.round(k / arr.length * 100)}%)`;
    };
    console.log(`\n${"원자료".padEnd(22)}${"자사 41곳".padStart(16)}${"경쟁점".padStart(18)}   양쪽에 있나`);
    const both: [string, (s: any) => unknown, ((c: any) => unknown) | null][] = [
      ["층수 floor", (s) => s.floor, (c) => c.floor],
      ["지상/지하", (s) => s.groundLevel, (c) => c.groundLevel],
      ["엘리베이터", (s) => s.hasElevator, (c) => c.hasElevator],
      ["거리(자사로부터)", () => null, (c) => c.distanceM],
      ["좌표 lat/lng", (s) => s.lat, null],
      ["상권위치·동선(주관)", (s) => locBy.get(s.storeCode)?.locationScore, null],
      ["선점경쟁(주관)", (s) => locBy.get(s.storeCode)?.preemptionScore, null],
      ["접근가시성(주관)", (s) => locBy.get(s.storeCode)?.visibilityScore, null],
    ];
    for (const [label, gs, gc] of both) {
      const own = gs(S.existingStores[0]) === null && label.startsWith("거리") ? "— (자기자신)" : fill(S.existingStores as any[], gs);
      const riv = gc ? fill(comps, gc) : "없음";
      console.log(`${label.padEnd(22)}${own.padStart(16)}${riv.padStart(18)}   ${gc && !label.includes("주관") && !label.includes("좌표") && !label.startsWith("거리") ? "✅ 같은 자로 잴 수 있다" : gc ? "경쟁점만" : "❌ 자사만"}`);
    }
    console.log(`  -> 양쪽에 다 있는 건 층수·지상지하·엘리베이터 셋뿐이다. 새 항은 자사÷경쟁을 나누므로`);
    console.log(`     자사만 있는 주관 3항목은 그대로는 못 넣는다.`);
    expect(comps.length).toBeGreaterThan(100);
  });

  it("③ 같은 자로 잰 입지를 품질에 넣으면 순서가 좋아지나", () => {
    const P = DEFAULT_TEXTBOOK_PARAMS;
    // 입지를 품질 점수에 섞는다 — 실무 감각 비중에서 입지 몫은 17.0%였다.
    const scoreWith = (parts: QualityParts, loc: number | null, locW: number) => {
      const base = computeQualityScore(parts, W);
      if (base == null) return null;
      if (loc == null || locW <= 0) return base;
      const bw = W.spec + W.food + W.zone + W.interior + W.management;
      return (base * bw + loc * locW) / (bw + locW);
    };
    const shareOf = (r: Row, locW: number, ownLoc: (r: Row) => number | null) => {
      const oq = scoreWith(r.parts, ownLoc(r), locW);
      const own = r.pc;
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (scoreWith(x.parts, x.floorScore, locW) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return own / (own + riv);
    };
    const show = (label: string, locW: number, ownLoc: (r: Row) => number | null) => {
      const ps = cmp.map((r) => shareOf(r, locW, ownLoc));
      const e = cmp.map((r, i) => ps[i] / r.shareObs - 1);
      const jk = cmp.map((_, i) => pear(ps.filter((_, j) => j !== i), cmp.filter((_, j) => j !== i).map((r) => r.shareObs)));
      console.log(`${label.padEnd(34)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(ps, cmp.map((r) => r.shareObs)).toFixed(3).padStart(10)}${`${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)}`.padStart(16)}`);
    };
    console.log(`\n유효거리 ${P.effectiveRadiusM}m · θ=${P.qualityExponent} 고정. 판정 기준은 r이다(MAPE는 이 층에서 무력하다).`);
    console.log(`${"입지 처리".padEnd(34)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"실측과 r".padStart(10)}${"한 곳 빼면".padStart(16)}`);
    show("입지 없음 (지금 채택본)", 0, () => null);
    show("층수자 입지 17% (양쪽 같은 자)", 0.17, (r) => r.floorScore);
    show("  └ 비중 8.5%", 0.085, (r) => r.floorScore);
    show("  └ 비중 30%", 0.30, (r) => r.floorScore);
    // 지금 운영 방식 — 자사는 주관 3항목, 경쟁점은 층수자. 자가 다른 상태 그대로.
    const ownSubjective = (r: Row) => {
      const a = r.loc.locationScore, b = r.loc.preemptionScore, c = r.loc.visibilityScore;
      return a == null && b == null && c == null ? null
        : (Number(a ?? 3) * 0.6 + Number(b ?? 3) * 0.25 + Number(c ?? 3) * 0.15);
    };
    show("자가 다른 채로 17% (지금 운영방식)", 0.17, ownSubjective);
    console.log(`  -> "입지 없음"보다 r이 올라야 넣을 값어치가 있다. 한 곳 빼서 무너지면 한 매장이 만든 것이다.`);

    // 주관 항목이 층수 말고 무엇을 더 담고 있나 — 그게 새로 만들 항목의 재료다.
    const ok = cmp.filter((r) => r.floorScore != null && r.loc.visibilityScore != null);
    console.log(`\n[주관 항목 vs 층수자] n=${ok.length}`);
    console.log(`  접근가시성 ↔ 층수자 상관 r=${pear(ok.map((r) => Number(r.loc.visibilityScore)), ok.map((r) => r.floorScore!)).toFixed(3)}`);
    const resid = ok.map((r) => Number(r.loc.visibilityScore) - r.floorScore!);
    console.log(`  층수로 설명 안 되는 몫: 중앙 ${med(resid).toFixed(2)} · 표준편차 ${sd(resid).toFixed(2)} · 범위 ${Math.min(...resid)}~${Math.max(...resid)}`);
    console.log(`  그 몫과 실측 점유율 r=${pear(resid, ok.map((r) => r.shareObs)).toFixed(3)} (유의선 ${(2 / Math.sqrt(ok.length)).toFixed(3)})`);
    console.log(`  -> 이 잔차가 유의하면 "층수 밖의 무언가"(간판·코너·보행노출)가 실재한다는 뜻이고,`);
    console.log(`     그게 새 입지 항목이 담아야 할 내용이다. 유의하지 않으면 입지는 층수로 충분하다.`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("④ 입지를 경쟁력 안이 아니라 독립 항으로 두면", () => {
    // ③에서 층수를 **품질에 섞으면** 개선이 없었다. 그런데 ①에서 자사 층수자 점수 자체는
    // 실측 점유율과 r=0.329(시점통제 0.389*)로 **유일하게 유의선을 넘는 입지 지표**였다.
    //
    // 두 결과가 모순이 아니다. 품질에 섞으면 **경쟁점 층수와 나누게 되는데**, 접근성은
    // "경쟁점보다 높은 층인가"가 아니라 **"올라오기 얼마나 번거로운가"**일 수 있다.
    // 6층 매장은 경쟁점이 없어도 덜 온다. 그렇다면 비율이 아니라 **곱셈 항**이 맞다:
    //
    //   점유율 = [품질 점유율] x (자사 층수자 점수 ÷ 기준)^κ
    //
    // ⚠️ 독점 3곳으로 축척 A를 맞추므로, 그 3곳의 층수가 평균적이면 효과 일부가 A에 흡수된다.
    //    그래서 κ를 올렸을 때 **편향이 아니라 r이 좋아지는지**를 본다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    console.log(`\n층수자 점수 기준값(전 매장 중앙) = ${ref}`);
    console.log(`${"κ (접근성 지수)".padEnd(18)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"실측과 r".padStart(10)}${"한 곳 빼면".padStart(16)}`);
    for (const k of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
      const ps = cmp.map((r) => baseShare(r) * (r.floorScore == null ? 1 : Math.pow(r.floorScore / ref, k)));
      const e = cmp.map((r, i) => ps[i] / r.shareObs - 1);
      const jk = cmp.map((_, i) => pear(ps.filter((_, j) => j !== i), cmp.filter((_, j) => j !== i).map((r) => r.shareObs)));
      console.log(`${String(k).padEnd(18)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(ps, cmp.map((r) => r.shareObs)).toFixed(3).padStart(10)}${`${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)}`.padStart(16)}`);
    }
    console.log(`  κ=0이 "입지 없음"이다. r이 올라가야 값어치가 있다.`);

    // 층수자 점수를 잔차에 직접 대본다 — 곱셈 항이 맞다면 여기서 붙어야 한다.
    const ok = cmp.filter((r) => r.floorScore != null);
    const resid = ok.map((r) => Math.log(r.shareObs / baseShare(r)));
    const fs = ok.map((r) => r.floorScore!);
    const sig = 2 / Math.sqrt(ok.length);
    console.log(`\n[품질 점유율이 남긴 오차 vs 층수자 점수] n=${ok.length} · 유의선 ${sig.toFixed(3)}`);
    const rr = pear(fs, resid), rp = partial(fs, resid, ok.map((r) => r.t));
    console.log(`  단순 r=${rr.toFixed(3)}${Math.abs(rr) > sig ? " *" : ""} · 평가창 시점 통제 r=${rp.toFixed(3)}${Math.abs(rp) > sig ? " *" : ""}`);
    console.log(`  양수면 "층이 낮은데도 예측이 낮다 = 접근성을 덜 쳐줬다"는 뜻이다.`);
    console.log(`  ⚠️ 부호가 음수이거나 유의선 미달이면 층수는 이 층에서 더 쓸 게 없다.`);
    expect(ok.length).toBeGreaterThan(20);
  });

  it("⑤ 접근성 항 κ — 경쟁 항과 같은 관문을 통과하나", () => {
    // ④에서 r이 0.554 -> 0.657로 크게 올랐다. 하지만 κ는 **또 하나의 자유계수**다.
    // 이 저장소는 정확히 이렇게 두 번 속았다(2026-09-15 밀집도 r=0.660, 2026-09-16 gamma=4).
    // 그래서 경쟁 항에 쓴 관문을 그대로 통과시킨다: LOO · 5겹 · 무작위 대조군.
    //
    // ⚠️ 경고등이 하나 켜져 있다 — 평가창 시점을 통제하면 잔차 상관이 0.400 -> 0.374로
    //    유의선(0.371)에 거의 붙는다. 코호트 교란일 수 있다(project_cohort_effect_confound).
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    type P2 = { base: number; fs: number; obs: number };
    const base: P2[] = cmp.map((r) => ({ base: baseShare(r), fs: r.floorScore ?? ref, obs: r.shareObs }));
    const KS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
    const predK = (p: P2, k: number) => p.base * Math.pow(p.fs / ref, k);
    const mapeK = (s: P2[], k: number) => mean(s.map((p) => Math.abs(predK(p, k) / p.obs - 1)));
    const corrK = (s: P2[], k: number) => pear(s.map((p) => predK(p, k)), s.map((p) => p.obs));
    const pickK = (s: P2[], crit: "mape" | "r") => {
      let best = { k: KS[0], v: Infinity };
      for (const k of KS) { const v = crit === "mape" ? mapeK(s, k) : -corrK(s, k); if (v < best.v) best = { k, v }; }
      return best;
    };

    console.log(`\n══ LOO 홀드아웃 — 한 곳 빼고 κ 고른 뒤 뺀 곳에서 채점 ══`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: number[] = [];
      for (let i = 0; i < base.length; i++) {
        const b = pickK(base.filter((_, j) => j !== i), crit);
        picks.push(b.k);
        const ph = predK(base[i], b.k);
        preds.push(ph); errs.push(Math.abs(ph / base[i].obs - 1));
      }
      const ins = pickK(base, crit);
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준] 표본 안 ${(mapeK(base, ins.k) * 100).toFixed(2)}% (κ=${ins.k}) → LOO ${(mean(errs) * 100).toFixed(2)}% · LOO r=${pear(preds, base.map((p) => p.obs)).toFixed(3)}`);
      console.log(`     훈련이 고른 κ: ${tally.map(([k, n]) => `${k} ${Math.round(n / base.length * 100)}%`).join(" · ")}`);
    }
    console.log(`  (비교) κ=0(입지 없음) LOO 기준선 r=${corrK(base, 0).toFixed(3)} · MAPE ${(mapeK(base, 0) * 100).toFixed(2)}%`);

    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n══ 5겹 교차검증 100회 — κ가 흔들리나 ══`);
    for (const crit of ["mape", "r"] as const) {
      const picks: number[] = [];
      for (let rep = 0; rep < 100; rep++) {
        const idx = shuffled(base.map((_, i) => i));
        for (let f = 0; f < 5; f++) picks.push(pickK(idx.filter((_, j) => j % 5 !== f).map((i) => base[i]), crit).k);
      }
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준] ${tally.slice(0, 4).map(([k, n]) => `κ=${k} ${(n / picks.length * 100).toFixed(0)}%`).join(" · ")}`);
    }

    console.log(`\n══ 무작위 대조군 500회 — 층수를 매장끼리 섞는다 ══`);
    for (const crit of ["mape", "r"] as const) {
      const sc = (s: P2[], k: number) => (crit === "mape" ? mapeK(s, k) : -corrK(s, k));
      const gainOf = (s: P2[]) => sc(s, 0) - sc(s, pickK(s, crit).k);
      const real = gainOf(base);
      const gains: number[] = [];
      for (let i = 0; i < 500; i++) {
        const pool = shuffled(base.map((p) => p.fs));
        gains.push(gainOf(base.map((p, j) => ({ ...p, fs: pool[j] }))));
      }
      gains.sort((a, b) => a - b);
      const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
      const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gains))} · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])} · p = ${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    expect(base.length).toBeGreaterThan(20);
  });

  it("⑥ 절대 층수인가 상대 층수인가 — 사용자 항목 ②", () => {
    // 사용자(2026-09-17): "경재점이 지하1층 2층 이렇게되어있는데 우리점포는 5층 7층
    // 이렇게되어있으면 이것도반영해야되고"
    //
    // ④~⑤에서 쓴 건 **자사 절대 층수**다. 사용자가 말한 건 **경쟁점 대비 상대 층수**다.
    // 둘은 다른 주장이고, 어느 쪽이 맞는지는 재보면 안다.
    //   절대 — 6층이면 경쟁점이 없어도 덜 온다 (올라오기 번거롭다)
    //   상대 — 경쟁점이 2층이고 우리가 6층이면 손님이 그쪽으로 간다 (비교당한다)
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    // 유효거리 안 경쟁점의 층수자 점수를 PC대수로 가중평균 — "이 상권 경쟁점들은 몇 층인가"
    const rivalFloor = (r: Row) => {
      let w = 0, s = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM || x.floorScore == null) continue;
        w += x.ip; s += x.ip * x.floorScore;
      }
      return w > 0 ? s / w : null;
    };
    const ok = cmp.filter((r) => r.floorScore != null && rivalFloor(r) != null);
    console.log(`\n경쟁상권 ${cmp.length}곳 중 경쟁점 층수를 아는 ${ok.length}곳 · 유의선 ${(2 / Math.sqrt(ok.length)).toFixed(3)}`);
    const own = ok.map((r) => r.floorScore!), riv = ok.map((r) => rivalFloor(r)!);
    console.log(`  자사 층수자 점수  중앙 ${med(own).toFixed(2)} · 범위 ${Math.min(...own)}~${Math.max(...own)}`);
    console.log(`  경쟁 층수자 점수  중앙 ${med(riv).toFixed(2)} · 범위 ${Math.min(...riv).toFixed(1)}~${Math.max(...riv).toFixed(1)}`);
    console.log(`  자사-경쟁 차이    중앙 ${med(own.map((v, i) => v - riv[i])).toFixed(2)} · 자사가 유리한 곳 ${own.filter((v, i) => v > riv[i]).length}곳 / 불리 ${own.filter((v, i) => v < riv[i]).length}곳`);
    console.log(`  두 값의 상관 r=${pear(own, riv).toFixed(3)} (높으면 "같은 상권은 다 비슷한 층"이라 상대가 무의미하다)`);

    const resid = ok.map((r) => Math.log(r.shareObs / baseShare(r)));
    const t = ok.map((r) => r.t);
    const sig = 2 / Math.sqrt(ok.length);
    const line = (label: string, v: number[]) => {
      const r1 = pear(v, resid), r2 = partial(v, resid, t);
      console.log(`  ${label.padEnd(30)} r=${(r1.toFixed(3) + (Math.abs(r1) > sig ? " *" : "  ")).padStart(9)}  시점통제 ${(r2.toFixed(3) + (Math.abs(r2) > sig ? " *" : "")).padStart(8)}`);
    };
    console.log(`\n[품질 점유율이 남긴 오차와의 상관]`);
    line("자사 절대 층수 (지금 κ 항)", own);
    line("자사 − 경쟁 (상대 층수)", own.map((v, i) => v - riv[i]));
    line("자사 ÷ 경쟁 (상대 비율)", own.map((v, i) => v / riv[i]));
    line("경쟁 층수만 (참고)", riv);

    console.log(`\n[두 항을 같이 넣으면] 점유율 x (자사÷${ref})^κ x (자사−경쟁+3)^μ 훑기`);
    console.log(`${"κ(절대)".padStart(8)}${"μ(상대)".padStart(9)}${"MAPE".padStart(9)}${"실측과 r".padStart(10)}`);
    for (const k of [0, 0.25, 0.5]) {
      for (const m of [0, 0.25, 0.5]) {
        const ps = ok.map((r) => baseShare(r) * Math.pow(r.floorScore! / ref, k) * Math.pow(Math.max(0.5, r.floorScore! - rivalFloor(r)! + 3) / 3, m));
        const e = ok.map((r, i) => ps[i] / r.shareObs - 1);
        console.log(`${String(k).padStart(8)}${String(m).padStart(9)}${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(ps, ok.map((r) => r.shareObs)).toFixed(3).padStart(10)}`);
      }
    }
    console.log(`  -> μ를 올려 좋아지면 "비교당한다"가 맞고, κ만 남으면 "올라오기 번거롭다"가 맞다.`);
    expect(ok.length).toBeGreaterThan(15);
  });
});
