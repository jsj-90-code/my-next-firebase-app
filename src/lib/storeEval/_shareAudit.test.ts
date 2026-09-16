// 점유율 환산층 점검 — 실측 점유율을 역산해서 적용 항목을 하나씩 대본다 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16): "점유율환산하는게 전체적으로 교정이필요할거같다. (...) 우선 그럴러면
// 적용항목부터 점검해서 충분히 적합한지 검토해야하지않을까"
//
// ── 핵심 도구: 실측 점유율 ──────────────────────────────────────────────
// 독점상권(경쟁IP=0)은 점유율이 1이라 축척 A가 정해진다. 그러면 경쟁상권 매장이 실제로 얼마를
// 먹었는지 역산할 수 있다:
//
//   실측 점유율 = 실측가동률 ÷ (A x 수요 ÷ 자사PC)
//
// 이러면 수요층을 걷어내고 **점유율만** 볼 수 있다. 경쟁력·입지 항목은 여기에 대야 한다.
//
//   npx vitest run src/lib/storeEval/_shareAudit.test.ts --reporter=verbose
//
// ── 2026-09-16에 밝혀진 것 ──────────────────────────────────────────────
// 1) **gamma=4는 "쏠림"이 아니라 순수 수준 보정이다.** 격차를 아예 빼고 상수 배율 lambda=4만
//    써도 점유율 MAPE가 32.6%로, gamma=4의 32.0%와 사실상 같다. 격차의 기여가 없다 —
//    격차와 실측 점유율의 상관이 r=0.025다.
// 2) **홀드아웃에서 무너진다.** 가동률 MAPE 표본 안 29.08% -> LOO 36.20%. 5겹 교차검증에서
//    훈련겹이 고르는 gamma가 3.5(42%)/4.5(40%)/4(17%)로 불안정하고, 무작위 대조군 p=0.072다.
//    ⚠️ 인계 문서의 p=0.004는 **다른 설정**이었다 — `_monopolyCalibration.test.ts`는 축척 A를
//       매번 32곳 전체에 다시 맞춰 수준을 흡수시킨다. 지금 산식은 A를 독점 3곳에 고정하므로
//       gamma가 수준 보정까지 떠맡고, 격차를 섞어도 같은 개선(중앙 15.09%p)이 나온다.
// 3) **구조 자체가 수준을 못 맞춘다.** 실측 점유율 중앙 0.519인데 자사PC/(자사PC+경쟁IP)는
//    0.186이다(2.8배). 경쟁IP 중앙 458대 vs 자사PC 100대 안팎인데 실제로는 절반을 먹는다.
//    거리로 잘라도 안 된다 — 200m로 좁히면 편향은 -47.7%로 줄지만 MAPE가 58.4%로 나빠진다.
//    추정 원인: 수요는 우리 반경(주거1km·유동400m)으로 쟀는데 경쟁IP는 그 반경 전부를 센다.
//    경쟁점은 자기 상권이 따로 있어 우리 수요를 100% 놓고 겨루지 않는다.
// 4) **적용 항목 중 실측 점유율을 설명하는 게 하나도 없다** (경쟁상권 29곳, 유의선 0.371).
//    파생 점수를 원자료에서 제대로 계산해서 다시 재도 결론이 같다:
//      사양(하드웨어) -0.062 · 존구성 0.135 · 시설종합 0.135 · 저장 경쟁력점수 0.094
//      경쟁력격차 0.025 · 입지 상권위치·동선 0.075 · 선점경쟁 0.220 · 접근가시성 0.181
//    "자료가 없어서"가 아니라 **"관계가 없어서"**다.
//
//    ⚠️ 2026-09-16에 여기서 한 번 잘못 읽었다 — `ownSpecScore`가 스냅샷에 0/41이라 "사양 결측"
//       이라고 보고했는데, 그건 **저장 필드가 아니라 파생값**이다. 원자료(ownCpu/ownVgaBase/
//       ownRam/ownMonitorBase)는 40/41로 멀쩡히 있고, `computeSpecScore`로 계산하면 19개 값 ·
//       범위 2.64~4.00 · 변동계수 12.2%로 변별력이 있다. **파생 점수는 계산해서 봐야 한다.**
//
//    상수인 항목도 있는데 이건 설계 의도다(2026-09-16 사용자 확인):
//      먹거리 — 프랜차이즈라 메뉴·판매 상품이 동일해서 평가 구분이 없다(맛 차이는 평가 불가)
//      인테리어·관리 — 평가 시점이 오픈 후 12개월이라 전 매장 상급 4점
//    다만 의도했든 아니든 **변별력이 0이면 점유율을 설명하는 데는 못 쓴다.** 그리고 이것들이
//    종합점수를 희석시킨다 — 사양 12.2%·존구성 12.7%가 합쳐지면 경쟁력점수 6.3%로 반토막난다.
//
//    경쟁점 쪽은 실제로 비어 있다: competitivenessScore 0/228 · specScore 0/228.
//    격차는 저장된 값을 쓰는데 그 격차가 실측 점유율과 r=0.025다.
//
// 5) ⚠️ **이 점검의 한계** — 실측 점유율 = 실측가동률 ÷ (A x 수요 ÷ 자사PC)이므로 **수요식 오차가
//    그대로 섞인다.** 수요식은 독점 3곳에서만 검증됐고 경쟁상권에서 얼마나 틀리는지는 모른다
//    (점유율과 분리가 안 된다). 실측 점유율 변동계수 53.6%에는 그 오차가 들어 있다. 그래서
//    "항목이 설명 못 한다"가 "항목이 쓸모없다"를 뜻하지는 않는다 — 잡음에 묻혔을 수도 있다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
// 파생 점수는 저장 필드가 아니라 원자료에서 계산해야 한다 — 운영 산식과 같은 함수를 그대로 쓴다.
import { computeSpecScore, computeOwnZoneComposition, computeFacilityScore } from "./calc";
import { defaultModelSettings } from "./settings";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE) && existsSync(UTIL_FILE);
const describeIf = ready ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return a / Math.sqrt(b * c);
}
/** z를 통제한 x,y 편상관 — 평가창 시점 교란을 걷어내는 데 쓴다(오늘의 교훈) */
function partial(x: number[], y: number[], z: number[]): number {
  const rxy = pearson(x, y), rxz = pearson(x, z), ryz = pearson(y, z);
  return (rxy - rxz * ryz) / Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
}
const RATE_M = { t: 0.39, tw: 0.42, th: 0.17, f: 0.1 };
const RATE_F = { t: 0.13, tw: 0.15, th: 0.045, f: 0.02 };
const blend = (m: number) => ({
  t: m * RATE_M.t + (1 - m) * RATE_F.t, tw: m * RATE_M.tw + (1 - m) * RATE_F.tw,
  th: m * RATE_M.th + (1 - m) * RATE_F.th, f: m * RATE_M.f + (1 - m) * RATE_F.f,
});
const ALPHA = 0.15;

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 존구성은 좌석 칸 8개에서 계산된다 — 운영 산식과 같은 함수를 쓴다. */
const zoneOf = (st: any, pc: number) => computeOwnZoneComposition({
  counts: {
    singleSeatCount: st.ownSingleSeatCount ?? null, room1: st.ownRoom1 ?? null, room2: st.ownRoom2 ?? null,
    teamRoom: st.ownTeamRoom ?? null, coupleZone: st.ownCoupleZone ?? null, vipZone: st.ownVipZone ?? null,
    friendsZone: st.ownFriendsZone ?? null, firstClassZone: st.ownFirstClassZone ?? null,
  },
  teamRoomTotalSeats: st.ownTeamRoomTotalSeats ?? null, totalPcCount: pc,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("점유율 환산층 점검 — 실측 점유율에 항목을 대본다", () => {
  const snap = loadValidationSnapshot<any>();
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const util = JSON.parse(readFileSync(UTIL_FILE, "utf8"));
  const floSites = fl.sites ?? fl, resSites = re.sites ?? re;

  const compsBy = new Map<string, any[]>();
  for (const c of snap.competitors as any[]) {
    if (!compsBy.has(c.candidateCode)) compsBy.set(c.candidateCode, []);
    compsBy.get(c.candidateCode)!.push(c);
  }
  const locBy = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));
  const settings = defaultModelSettings();

  type Row = {
    st: any; loc: any; name: string; pc: number; rivalIp: number; rivalCount: number;
    gap: number | null; comp: number | null; demand: number; util: number; t: number; shareObs: number;
    specScore: number | null; zoneScore: number | null; facilityScore: number | null;
  };
  const rows: Row[] = [];
  for (const st of snap.existingStores as any[]) {
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const g = util[st.storeName];
    if (!g?.rows?.length) continue;
    const key = `existing:${st.storeCode}`;
    const fv = floSites[key], rv = resSites[key];
    if (!fv || !rv) continue;
    const p = rv.radii?.["1000"]?.pops;
    if (p?.age_2_cnt == null) continue;
    const rm = p.woman_cnt != null && Number(p.tot_ppltn_cnt) > 0 ? 1 - Number(p.woman_cnt) / Number(p.tot_ppltn_cnt) : 0.5;
    const RR = blend(rm);
    const pop = Number(p.age_2_cnt) * RR.t + Number(p.age_3_cnt) * RR.tw + Number(p.age_4_cnt) * RR.th + Number(p.age_5_cnt) * RR.f;
    const f4 = fv.radii?.["400"];
    if (!f4?.selected?.length || !f4.demographics) continue;
    const last = f4.selected[f4.selected.length - 1];
    const sc = last > 0 ? mean(f4.selected.slice(-12)) / last : 1;
    const d = f4.demographics, FR = blend(d.total > 0 ? d.male / d.total : 0.5);
    const env = ((d.age10s ?? 0) * FR.t + (d.age20s ?? 0) * FR.tw + (d.age30s ?? 0) * FR.th + (d.age40s ?? 0) * FR.f) * sc;
    const cs = (compsBy.get(st.storeCode) ?? []).filter((c) => c.investigationStatus !== "경쟁점없음");
    const win = g.rows.map((r: any) => r.yearMonth).sort();
    const mid = win[Math.floor(win.length / 2)];
    rows.push({
      st, loc: locBy.get(st.storeCode) ?? {}, name: st.storeName, pc,
      rivalIp: cs.reduce((a: number, c: any) => a + Number(c.appliedPcCount ?? c.totalPcCount ?? 0), 0),
      rivalCount: cs.length, gap: st.competitivenessGap ?? null, comp: st.competitivenessScore ?? null,
      demand: pop + env * ALPHA, util: mean(g.rows.map((r: any) => r.monthlyRate)),
      t: Number(mid.slice(0, 4)) * 12 + Number(mid.slice(5, 7)), shareObs: 0,
      specScore: computeSpecScore({
        vgaBase: st.ownVgaBase ?? null, vgaTop: st.ownVgaTop ?? null, vgaTop2: st.ownVgaTop2 ?? null,
        cpu: st.ownCpu ?? null, cpuTop1: st.ownCpuTop1 ?? null, cpuTop2: st.ownCpuTop2 ?? null,
        ram: st.ownRam ?? null, ramTop: st.ownRamTop ?? null,
        monitorBase: st.ownMonitorBase ?? null, monitorTop: st.ownMonitorTop ?? null,
      }, settings),
      zoneScore: zoneOf(st, pc).composition,
      facilityScore: computeFacilityScore({ zoneComposition: zoneOf(st, pc).composition,
        interiorScore: st.ownInteriorScore ?? null, managementScore: st.ownManagementScore ?? null }, settings),
    });
  }
  const mono = rows.filter((r) => r.rivalIp === 0);
  // 독점에서 점유율=1 -> 축척 A가 정해진다
  const A = median(mono.map((r) => r.util / (r.demand / r.pc)));
  for (const r of rows) r.shareObs = r.util / (A * r.demand / r.pc);
  const comp = rows.filter((r) => r.rivalIp > 0);

  it("실측 점유율 — 지금 구조가 수준을 못 맞춘다", () => {
    const so = comp.map((r) => r.shareObs);
    console.log(`\n축척 A = ${A.toExponential(3)} (독점 ${mono.length}곳) · 경쟁상권 ${comp.length}곳`);
    console.log(`실측 점유율 = 실측가동률 ÷ (A x 수요 ÷ 자사PC)`);
    console.log(`  중앙 ${median(so).toFixed(3)} · 범위 ${Math.min(...so).toFixed(3)}~${Math.max(...so).toFixed(3)} · 변동계수 ${(sd(so) / mean(so) * 100).toFixed(1)}%`);
    console.log(`  경쟁IP 중앙 ${median(comp.map((r) => r.rivalIp)).toFixed(0)}대 vs 자사PC 중앙 ${median(comp.map((r) => r.pc)).toFixed(0)}대`);
    console.log(`\n${"  구조".padEnd(34)}${"점유율중앙".padStart(11)}${"편향".padStart(9)}${"MAPE".padStart(9)}`);
    const show = (label: string, f: (r: Row) => number) => {
      const e = comp.map((r) => f(r) / r.shareObs - 1);
      console.log(`  ${label.padEnd(32)}${median(comp.map(f)).toFixed(3).padStart(11)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%`);
    };
    show("자사PC / (자사PC + 경쟁IP)", (r) => r.pc / (r.pc + r.rivalIp));
    show("격차^1", (r) => { const G = r.gap ?? 1; return (r.pc * G) / (r.pc * G + r.rivalIp); });
    show("격차^4 (지금 기본값)", (r) => { const G = Math.pow(r.gap ?? 1, 4); return (r.pc * G) / (r.pc * G + r.rivalIp); });
    show("격차 없이 상수배율 lambda=4", (r) => (4 * r.pc) / (4 * r.pc + r.rivalIp));
    console.log(`  -> 격차를 아예 빼고 상수 배율만 써도 성적이 같다. gamma는 쏠림이 아니라 수준 보정이다.`);
    expect(comp.length).toBeGreaterThan(20);
  });

  it("적용 항목 점검 — 무엇이 실측 점유율을 설명하나", () => {
    const n = comp.length, sig = 2 / Math.sqrt(n);
    console.log(`\n경쟁상권 ${n}곳 · 유의선 ${sig.toFixed(3)} · 평가창 시점 통제 전/후를 같이 본다`);
    console.log(`${"항목".padEnd(22)}${"결측".padStart(6)}${"다른값".padStart(8)}${"변동계수".padStart(9)}${"단순r".padStart(9)}${"시점통제".padStart(9)}`);
    const items: [string, (r: Row) => unknown][] = [
      ["자사 경쟁력점수", (r) => r.comp],
      ["  └ 사양(파생계산)", (r) => r.specScore],
      ["  └ 존구성(파생계산)", (r) => r.zoneScore],
      ["  └ 시설종합(파생계산)", (r) => r.facilityScore],
      ["  └ 먹거리(상수·설계의도)", (r) => r.st.ownFoodScore],
      ["  └ 인테리어(상수·설계의도)", (r) => r.st.ownInteriorScore],
      ["  └ 관리(상수·설계의도)", (r) => r.st.ownManagementScore],
      ["경쟁력격차", (r) => r.gap],
      ["경쟁IP", (r) => r.rivalIp],
      ["경쟁점 수", (r) => r.rivalCount],
      ["경쟁IP ÷ 자사PC", (r) => r.rivalIp / r.pc],
      ["입지 상권위치·동선", (r) => r.loc.locationScore],
      ["입지 선점경쟁", (r) => r.loc.preemptionScore],
      ["입지 접근가시성", (r) => r.loc.visibilityScore],
      ["자사PC", (r) => r.pc],
    ];
    for (const [label, get] of items) {
      const ok = comp.filter((r) => { const raw = get(r); return raw != null && Number.isFinite(Number(raw)); });
      const v = ok.map((r) => Number(get(r)));
      if (v.length < 10 || new Set(v).size < 2) {
        const why = v.length < 10 ? `결측 ${n - v.length}곳` : `전부 같은 값(${v[0]})`;
        console.log(`${label.padEnd(22)}${String(n - v.length).padStart(6)}${String(new Set(v).size).padStart(8)}   ${why}`);
        continue;
      }
      const y = ok.map((r) => r.shareObs), t = ok.map((r) => r.t);
      const r1 = pearson(v, y), r2 = partial(v, y, t);
      console.log(`${label.padEnd(22)}${String(n - v.length).padStart(6)}${String(new Set(v).size).padStart(8)}${(sd(v) / mean(v) * 100).toFixed(1).padStart(8)}%${(r1.toFixed(3) + (Math.abs(r1) > sig ? "*" : " ")).padStart(9)}${(r2.toFixed(3) + (Math.abs(r2) > sig ? "*" : " ")).padStart(9)}`);
    }
    console.log(`  -> 유의선을 넘는 항목이 없다. 배점을 바꿀 게 아니라 항목과 자료를 다시 만들어야 한다.`);
    expect(comp.length).toBeGreaterThan(20);
  });
});
