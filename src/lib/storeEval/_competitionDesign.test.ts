// 경쟁 항 설계 후보 — 상권 겹침(거리 감쇠) + 경쟁력 지수 (2026-09-16 밤). 일회성 분석용.
//
// 사용자 방향: "경쟁력으로가자. 여기가 이제 큰문제다. 설계 디테일이 필요하다" ·
// "사양/시설/먹거리는 기존 데이터 활용해서 산식완성하도록하고, 입지는 아예 손을 다시봐야된다"
//
//   npx vitest run src/lib/storeEval/_competitionDesign.test.ts --reporter=verbose
//
// ── 두 가지를 새로 했다 ─────────────────────────────────────────────────
// 1) **경쟁점 경쟁력점수를 원자료에서 계산했다.** 스냅샷의 competitivenessScore는 0/228이라
//    "비어 있다"고 봤는데, 자사 사양과 마찬가지로 **파생값**이었다. 원자료는 있다 —
//    cpu 163/225 · vga 163 · 먹거리 204 · 인테리어 202 · 관리 190 · 좌석구성 158~188.
//    운영 산식과 같은 함수(computeSpecScore / computeCompetitorZoneComposition /
//    computeFacilityScore)로 계산했고, **입지는 뺐다**(사용자 방향: 입지는 다시 만든다).
//    사양25% + 먹거리5% + 시설55%를 재정규화해 쓴다.
//
//      자사  32곳 중앙 3.56 · 변동계수  6.3%
//      경쟁 125곳 중앙 2.03 · 변동계수 19.1%   <- 변별력이 경쟁점 쪽에 있다
//      -> 자사가 1.75배 높다. 저장된 competitivenessGap 중앙 1.49와 다르다.
//
// 2) **상권 겹침을 넣었다.** 이게 지금 산식에 없던 것이고, gamma=4가 대신 떠맡고 있던 일이다.
//    경쟁점 거리는 225/225 전수로 있다(중앙 135m, 최대 1500m).
//
//    겹침 형태는 **유효거리 계단**을 쓴다 — 유효거리 안에서는 거리가 작용하지 않고 품질이
//    가른다. 2026-09-16 사용자 실무 의견: "거리는 유효거리안에있으면 거리가 크게작용안한다는게
//    실무의견이고, 매장의 품질이 (점수)가 작용되어야함". **자료도 이쪽을 지지한다.**
//
//      점유율 = 자사PC x 품질^θ ÷ (자사PC x 품질^θ + Σ[유효거리 안] 경쟁PC x 품질_i^θ)
//
// ── 결과 (경쟁상권 실측 점유율 대비) ────────────────────────────────────
//   겹침             θ    편향      MAPE     실측과 r
//   없음(지금 gamma=4) 4   +10.4%   33.8%    0.372
//   없음              0   -64.7%   64.7%    0.157   <- 구조의 민낯
//   exp 감쇠 d0=150   2    +7.3%   30.2%    0.510
//   **반경 300m       3    -3.3%   30.5%    0.560**  <- 최선
//   반경 300m         2   -22.6%   35.4%    0.549
//   반경 150m         2    -4.9%   31.9%    0.469
//   반경 500m/800m    4   +10.5%   33.6%    0.421   <- 사실상 "겹침 없음"과 같다
//
// **유효거리 ~300m가 뚜렷하다.** 150·200m는 너무 좁아 r이 0.43~0.48로 떨어지고, 500m 이상은
// 경쟁점 대부분이 그 안에 있어 겹침이 사라진다. 그 안에서 품질 지수 θ=3이 가른다.
// r이 0.372 -> 0.560으로 오르고 편향이 +10.4% -> -3.3%로 거의 사라진다 — gamma=4 반창고가
// 필요 없어진다. **유효거리 계단이 지수 감쇠(최선 r=0.510)보다도 낫다.**
//
// 3) **비중은 정확도로 못 가른다.** 세 벌을 돌려도 r이 0.553~0.561로 차이가 0.008이다:
//      현재(튜닝)  사양25·먹거리5·존구성27.5·인테리어16.5·관리11   θ=3  편향 -3.4%  r=0.561
//      실무감각    사양26.4·먹거리7.5·존구성23.8·인테리어10.2·관리15.1 θ=3 편향 -5.5% r=0.554
//      실무감각-존구성↑                                        θ=3  편향 +0.3%  r=0.553
//    자사는 먹거리·인테리어·관리가 전부 4점 상수라 비중을 바꿔도 상대 위치가 안 변하고,
//    경쟁점은 구성요소끼리 같이 움직인다(좋은 매장은 다 좋다).
//
//    **그래서 정확도 비용 없이 뜻이 있는 비중을 쓸 수 있다.** 사용자 지적대로 현재 비중은
//    적중률 튜닝 산물이다("지금 적용한값을 적중률 맞출려고 조정하다보니 저래된고고",
//    settings.ts에도 그리드서치 기록이 있다). 교과서식은 회귀로 덮지 않는 게 목적이므로
//    **실무 감각 비중을 쓴다.** θ=3은 세 비중 모두에서 최선이라 안정적이다.
//
// ── 홀드아웃·대조군 검정 결과 (2026-09-17) ─────────────────────────────
// **조건부 통과 — 순서는 맞히지만 오차 크기는 못 줄인다.** 두 기준이 정반대로 갈린다.
//
//   검정                        r 기준            MAPE 기준
//   LOO 홀드아웃                30.5% -> 31.1%    30.1% -> 34.9%   (gamma는 +7%p였다)
//   5겹 교차검증 100회           300m 76%          400m 41%/500m 26% — R을 못 고른다
//   대조군 품질 순열 500회       p=0.016 ✅        p=0.098 ❌
//   대조군 거리 순열 500회       p=0.016 ✅        p=0.385 ❌
//
// **MAPE 기준이 이 층에서 무력하다는 게 수치로 나왔다.** 상수 배율 λ=5 하나(품질도 겹침도
// 없이)로 MAPE 31.9%가 나오는데, 350개 조합을 다 훑은 최선이 30.1%다. 실측 점유율에
// 수요식 오차가 그대로 섞여 있어서다(`_shareAudit.test.ts` §5). 크기로는 아무것도 못 가른다.
//
// **그래서 gamma와 결정적으로 다른 지점은 순서다.** gamma는 격차와 실측 점유율의 상관이
// r=0.025로 순서조차 못 맞혔다. 새 항은 r=0.223(상수배율) -> 0.560으로 오르고,
// **두 자유계수가 각자 따로 대조군을 통과한다**(품질 p=0.016 · 거리 p=0.016).
// 한 곳씩 빼도 r=0.403~0.677로 유의선(0.378) 아래로 안 내려가고 스피어만 0.572로 같다.
//
// ⚠️ **300m 계단만 떼면(θ=0) 한 곳에 휘둘린다** — r=0.488인데 한 곳 빼면 0.100~0.706이다.
//    θ=3과 함께일 때만 튼튼하다. 둘을 갈라 쓰면 안 된다.
// ⚠️ θ=3은 흔들리지 않지만(5겹 86%) **R은 300~500m가 MAPE로 구별되지 않는다**(30.1~30.5%).
//    300m을 고른 근거는 r(0.560 vs 400m 0.434)과 실무 의견뿐이다.
// ⚠️ 입지는 의도적으로 뺐다. 사용자 방향대로 개념부터 다시 만든 뒤 넣는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeSpecScore, computeOwnZoneComposition, computeCompetitorZoneComposition, computeFacilityScore } from "@/lib/storeEval/calc";
import { defaultModelSettings } from "@/lib/storeEval/settings";
/* eslint-disable @typescript-eslint/no-explicit-any */
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
function pear(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return a / Math.sqrt(b * c);
}
const RM = { t: 0.39, tw: 0.42, th: 0.17, f: 0.1 }, RF = { t: 0.13, tw: 0.15, th: 0.045, f: 0.02 };
const bl = (m: number) => ({ t: m * RM.t + (1 - m) * RF.t, tw: m * RM.tw + (1 - m) * RF.tw, th: m * RM.th + (1 - m) * RF.th, f: m * RM.f + (1 - m) * RF.f });

describe("Huff 설계 후보", () => {
  // 자료 준비는 describe 자리로 올렸다 — 아래 두 it(설계 훑기 · 홀드아웃 검정)가 같은 rows/cmp/A를 쓴다.
    const S = JSON.parse(readFileSync(".local-tools/validation-snapshot.json", "utf8"));
    const fl = JSON.parse(readFileSync(".local-tools/sbiz-floating-population.json", "utf8"));
    const re = JSON.parse(readFileSync(".local-tools/sgis-resident-population.json", "utf8"));
    const U = JSON.parse(readFileSync(".local-tools/geto-utilization.json", "utf8"));
    const F = fl.sites ?? fl, R = re.sites ?? re, set = defaultModelSettings();
    // 경쟁력점수 — 입지 빼고 재정규화. 격차는 시설·사양·먹거리만 비교하는 게 맞다.
    const W = { spec: 0.25, food: 0.05, fac: 0.55 };
    const scoreOf = (spec: number | null, food: number | null, fac: number | null) => {
      const it = ([[spec, W.spec], [food, W.food], [fac, W.fac]] as [number | null, number][])
        .filter((x): x is [number, number] => x[0] != null);
      if (!it.length) return null;
      return it.reduce((a, [v, w]) => a + v * w, 0) / it.reduce((a, [, w]) => a + w, 0);
    };
    const compsBy = new Map<string, any[]>();
    for (const c of S.competitors as any[]) {
      if (!compsBy.has(c.candidateCode)) compsBy.set(c.candidateCode, []);
      compsBy.get(c.candidateCode)!.push(c);
    }
    const rows: any[] = [];
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
      const ownZone = computeOwnZoneComposition({
        counts: { singleSeatCount: s.ownSingleSeatCount ?? null, room1: s.ownRoom1 ?? null, room2: s.ownRoom2 ?? null,
          teamRoom: s.ownTeamRoom ?? null, coupleZone: s.ownCoupleZone ?? null, vipZone: s.ownVipZone ?? null,
          friendsZone: s.ownFriendsZone ?? null, firstClassZone: s.ownFirstClassZone ?? null },
        teamRoomTotalSeats: s.ownTeamRoomTotalSeats ?? null, totalPcCount: pc,
      });
      const ownSpec = computeSpecScore({
        vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
        cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
        ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
        monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
      }, set);
      const ownFac = computeFacilityScore({ zoneComposition: ownZone.composition, interiorScore: s.ownInteriorScore ?? null, managementScore: s.ownManagementScore ?? null }, set);
      const rivals = (compsBy.get(s.storeCode) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음")
        .map((c) => {
          const z = computeCompetitorZoneComposition({
            counts: { singleSeatCount: c.singleSeatCount ?? null, room1: c.room1 ?? null, room2: c.room2 ?? null,
              teamRoom: c.teamRoom ?? null, coupleZone: c.coupleZone ?? null, vipZone: c.vipZone ?? null,
              friendsZone: c.friendsZone ?? null, firstClassZone: c.firstClassZone ?? null },
            regularCoupleSeatCount: c.regularCoupleSeatCount ?? null,
            teamRoomTotalSeats: c.teamRoomTotalSeats ?? null,
            totalPcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
          } as any);
          const sp = computeSpecScore({
            vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
            cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
            ram: c.ram ?? null, ramTop: c.ramTop ?? null,
            monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
          }, set);
          const fac = computeFacilityScore({ zoneComposition: z.composition, interiorScore: c.interiorScore ?? null, managementScore: c.managementScore ?? null }, set);
          return { ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0), d: Number(c.distanceM ?? 0),
            score: scoreOf(sp, c.foodScore ?? null, fac),
            parts: { spec: sp, food: c.foodScore ?? null, zone: z.composition, interior: c.interiorScore ?? null, mgmt: c.managementScore ?? null } };
        })
        .filter((r) => r.ip > 0);
      rows.push({ n: s.storeName, pc, ownScore: scoreOf(ownSpec, s.ownFoodScore ?? null, ownFac), rivals,
        ownParts: { spec: ownSpec, food: s.ownFoodScore ?? null, zone: ownZone.composition, interior: s.ownInteriorScore ?? null, mgmt: s.ownManagementScore ?? null },
        demand: pop + env * 0.15, util: mean(g.rows.map((r: any) => r.monthlyRate)) });
    }
    const mono = rows.filter((r) => !r.rivals.length);
    const A = med(mono.map((r) => r.util / (r.demand / (r.pc * 720))));
    for (const r of rows) r.shareObs = r.util / (A * r.demand / (r.pc * 720));
    const cmp = rows.filter((r) => r.rivals.length);

  it("겹침 + 경쟁력", () => {
    const sN = rows.map((r) => r.ownScore).filter((v) => v != null) as number[];
    const rN = rows.flatMap((r) => r.rivals.map((x: any) => x.score)).filter((v: any) => v != null) as number[];
    console.log(`\n[경쟁력점수 — 원자료에서 파생 계산] 입지 빼고 사양25%+먹거리5%+시설55% 재정규화`);
    console.log(`  자사 ${sN.length}곳 중앙 ${med(sN).toFixed(2)} · 범위 ${Math.min(...sN).toFixed(2)}~${Math.max(...sN).toFixed(2)} · 변동계수 ${(sd(sN) / mean(sN) * 100).toFixed(1)}%`);
    console.log(`  경쟁 ${rN.length}곳 중앙 ${med(rN).toFixed(2)} · 범위 ${Math.min(...rN).toFixed(2)}~${Math.max(...rN).toFixed(2)} · 변동계수 ${(sd(rN) / mean(rN) * 100).toFixed(1)}%`);
    console.log(`  -> 자사가 경쟁점보다 ${(med(sN) / med(rN)).toFixed(2)}배 높다. 이게 진짜 격차다.`);

    console.log(`\n[Huff 구조 훑기] 점유율 = 자사PC x 점수^θ ÷ (자사PC x 점수^θ + Σ 경쟁PC x 점수^θ x 겹침)`);
    console.log(`겹침 w(d) = exp(-거리 / d0).  d0="없음"이면 겹침 100%(지금 구조)\n`);
    console.log(`${"겹침".padStart(14)}${"θ".padStart(5)}${"점유율중앙".padStart(11)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"실측과 r".padStart(10)}`);
    const DEF = med(rN);
    // 겹침 함수 두 형태를 비교한다.
    //  (가) 지수 감쇠 exp(-d/d0) — 거리가 계속 작용한다
    //  (나) **유효거리 계단** d<=R ? 1 : 0 — 유효거리 안에서는 거리가 작용 안 하고 품질이 가른다
    //      (2026-09-16 사용자 실무 의견: "거리는 유효거리안에있으면 거리가 크게작용안한다는게
    //       실무의견이고, 매장의 품질이 (점수)가 작용되어야함")
    const run = (label: string, w: (d: number) => number, th: number) => {
      const sh = (r: any) => {
        const own = r.pc * Math.pow((r.ownScore ?? DEF) / DEF, th);
        const riv = r.rivals.reduce((a: number, x: any) => a + x.ip * Math.pow((x.score ?? DEF) / DEF, th) * w(x.d), 0);
        return own / (own + riv);
      };
      const e = cmp.map((r) => sh(r) / r.shareObs - 1);
      const m = mean(e.map(Math.abs));
      const rr = pear(cmp.map(sh), cmp.map((r) => r.shareObs));
      console.log(`${label.padStart(14)}${String(th).padStart(5)}${med(cmp.map(sh)).toFixed(3).padStart(11)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(m * 100).toFixed(1).padStart(7)}%${rr.toFixed(3).padStart(10)}`);
      return { label, th, m, rr };
    };
    const all: { label: string; th: number; m: number; rr: number }[] = [];
    console.log(`-- (나) 유효거리 계단: 안에서는 거리 무관, 품질이 가른다 --`);
    for (const R2 of [150, 200, 300, 400, 500, 800]) {
      for (const th of [0, 1, 2, 3, 4]) all.push(run(`반경${R2}m`, (d) => (d <= R2 ? 1 : 0), th));
    }
    console.log(`-- (가) 지수 감쇠 (참고) --`);
    for (const d0 of [150, 250, 400]) for (const th of [0, 2]) all.push(run(`exp${d0}`, (d) => Math.exp(-d / d0), th));
    console.log(`-- 겹침 없음 (지금 구조) --`);
    for (const th of [0, 2, 4]) all.push(run("없음", () => 1, th));
    const best = all.reduce((x, y) => (y.m < x.m ? y : x));
    const bestR = all.reduce((x, y) => (y.rr > x.rr ? y : x));
    console.log(`\n  MAPE 최선: ${best.label} θ=${best.th} · MAPE ${(best.m * 100).toFixed(1)}% · r=${best.rr.toFixed(3)}`);
    console.log(`  상관 최선: ${bestR.label} θ=${bestR.th} · MAPE ${(bestR.m * 100).toFixed(1)}% · r=${bestR.rr.toFixed(3)}`);

    // ── 비중 두 벌 비교 (2026-09-16) ────────────────────────────────────
    // 사용자: "지금 적용한값을 적중률 맞출려고 조정하다보니 저래된고고" — 현재 비중은
    // 그리드서치 산물이지 실무 근거가 아니다. 실무 감각 비중과 나란히 놓고 본다.
    // 입지는 뺀 상태라 나머지 넷을 재정규화해서 쓴다.
    const SETS: [string, { spec: number; food: number; zone: number; interior: number; mgmt: number }][] = [
      ["현재(튜닝)", { spec: .25, food: .05, zone: .275, interior: .165, mgmt: .11 }],
      ["실무감각", { spec: .264, food: .075, zone: .238, interior: .102, mgmt: .151 }],
      ["실무감각-존구성↑", { spec: .22, food: .075, zone: .32, interior: .08, mgmt: .151 }],
    ];
    const mk = (P: any, w: any) => {
      const it = ([[P.spec, w.spec], [P.food, w.food], [P.zone, w.zone], [P.interior, w.interior], [P.mgmt, w.mgmt]] as [number | null, number][])
        .filter((x): x is [number, number] => x[0] != null);
      return it.length ? it.reduce((a, [v, ww]) => a + v * ww, 0) / it.reduce((a, [, ww]) => a + ww, 0) : null;
    };
    console.log(`
[비중 두 벌 비교] 유효거리 300m 계단 고정, θ 훑기`);
    console.log(`${"비중".padStart(18)}${"θ".padStart(4)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"실측과 r".padStart(10)}`);
    for (const [nm, w] of SETS) {
      const D2 = med(rows.flatMap((r: any) => r.rivals.map((x: any) => mk(x.parts, w))).filter((v: any) => v != null) as number[]);
      for (const th of [2, 3, 4]) {
        const sh = (r: any) => {
          const os = mk(r.ownParts, w) ?? D2;
          const own = r.pc * Math.pow(os / D2, th);
          const riv = r.rivals.reduce((a: number, x: any) => a + (x.d <= 300 ? x.ip * Math.pow((mk(x.parts, w) ?? D2) / D2, th) : 0), 0);
          return own / (own + riv);
        };
        const e = cmp.map((r) => sh(r) / r.shareObs - 1);
        console.log(`${nm.padStart(18)}${String(th).padStart(4)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(7)}%${pear(cmp.map(sh), cmp.map((r) => r.shareObs)).toFixed(3).padStart(10)}`);
      }
    }
    console.log(`  (비교) 지금 산식 격차^4: MAPE 32.0% · 실측 점유율 중앙 ${med(cmp.map((r: any) => r.shareObs)).toFixed(3)}`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 홀드아웃·대조군 검정 (2026-09-16 밤 인계 §1)
  //
  // 자유계수가 둘이다 — 유효거리 R, 품질 지수 θ. 표본 29곳에 계수 2개면 과적합이 가능하다.
  // gamma=4가 바로 이 관문에서 기각됐다: 표본 안 MAPE는 좋아지는데 LOO에서 7%p 벌어지고,
  // 알고 보니 "쏠림"이 아니라 상수 배율과 구별이 안 되는 **수준 보정**이었다.
  //
  // ⚠️ 축척 A는 독점 3곳에 고정한다(산식이 실제로 쓰는 설정). 32곳 전체에 재적합하면
  //    수준이 흡수돼 p값이 뒤집힌다 — gamma 때 0.004 ↔ 0.072로 갈렸다.
  //    여기서는 shareObs 자체가 그 A로 만들어져 있으므로 자동으로 고정 설정이다.
  //    (점유율 MAPE = 가동률 MAPE — 같은 상수로 나눈 값이라 오차비가 같다)
  // ══════════════════════════════════════════════════════════════════════
  it("홀드아웃·대조군 — R·θ가 표본 밖에서 버티나", () => {
    const DEF = med(rows.flatMap((r: any) => r.rivals.map((x: any) => x.score)).filter((v: any) => v != null) as number[]);
    const INF = Number.POSITIVE_INFINITY;
    // 순열 검정에서 품질·거리만 갈아끼우기 쉽게 납작하게 편다.
    type P = { name: string; pc: number; own: number; riv: { ip: number; q: number; d: number }[]; obs: number };
    const base: P[] = cmp.map((r: any) => ({
      name: r.n, pc: r.pc, own: (r.ownScore ?? DEF) / DEF, obs: r.shareObs,
      riv: r.rivals.map((x: any) => ({ ip: x.ip, q: (x.score ?? DEF) / DEF, d: x.d })),
    }));
    const GR = [150, 200, 300, 400, 500, 800, INF];
    const GT = [0, 1, 2, 3, 4];
    const pred = (p: P, R: number, t: number) => {
      const own = p.pc * Math.pow(p.own, t);
      let riv = 0;
      for (const x of p.riv) if (x.d <= R) riv += x.ip * Math.pow(x.q, t);
      return own / (own + riv);
    };
    const mapeOf = (set: P[], R: number, t: number) => mean(set.map((p) => Math.abs(pred(p, R, t) / p.obs - 1)));
    const corrOf = (set: P[], R: number, t: number) => pear(set.map((p) => pred(p, R, t)), set.map((p) => p.obs));
    /** 격자에서 최선을 고른다. crit="mape"면 작을수록, "r"이면 클수록 좋다. */
    const pick = (set: P[], crit: "mape" | "r", Rs = GR, Ts = GT) => {
      let best = { R: Rs[0], t: Ts[0], v: Infinity };
      for (const R of Rs) for (const t of Ts) {
        const v = crit === "mape" ? mapeOf(set, R, t) : -corrOf(set, R, t);
        if (v < best.v) best = { R, t, v };
      }
      return best;
    };
    const lab = (R: number) => (R === INF ? "겹침없음" : `${R}m`);

    // ── 검정 0. 층별 분해 — 이게 그냥 수준 보정인가? ──────────────────────
    // gamma의 사인(死因)이 여기였다. 두 자유계수가 각자 무슨 일을 하는지 떼어 본다.
    console.log(`\n══ 검정 0. 층별 분해 — 새 항이 하는 일이 "수준 보정"뿐인가 ══`);
    console.log(`경쟁상권 ${base.length}곳 · 축척 A는 독점 3곳 고정`);
    console.log(`${"구조".padEnd(30)}${"고른 값".padStart(14)}${"MAPE".padStart(9)}${"실측과 r".padStart(10)}`);
    const showFixed = (label: string, f: (p: P) => number, note: string) => {
      const e = base.map((p) => f(p) / p.obs - 1);
      console.log(`${label.padEnd(30)}${note.padStart(14)}${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(base.map(f), base.map((p) => p.obs)).toFixed(3).padStart(10)}`);
    };
    showFixed("① 민낯 (겹침·품질 없음)", (p) => pred(p, INF, 0), "—");
    // ② 상수 배율 lambda만 — gamma가 실제로 하고 있던 일. 이걸 못 이기면 새 항도 똑같다.
    let bestL = { L: 1, m: Infinity };
    for (const L of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      const f = (p: P) => (L * p.pc) / (L * p.pc + p.riv.reduce((a, x) => a + x.ip, 0));
      const m = mean(base.map((p) => Math.abs(f(p) / p.obs - 1)));
      if (m < bestL.m) bestL = { L, m };
    }
    showFixed("② 상수배율 λ만 (품질·겹침 없음)", (p) => (bestL.L * p.pc) / (bestL.L * p.pc + p.riv.reduce((a, x) => a + x.ip, 0)), `λ=${bestL.L}`);
    const bOverlap = pick(base, "mape", GR, [0]);
    showFixed("③ 겹침만 (θ=0)", (p) => pred(p, bOverlap.R, 0), lab(bOverlap.R));
    const bQual = pick(base, "mape", [INF], GT);
    showFixed("④ 품질만 (겹침 없음)", (p) => pred(p, INF, bQual.t), `θ=${bQual.t}`);
    const bBoth = pick(base, "mape");
    showFixed("⑤ 겹침+품질 (MAPE 기준)", (p) => pred(p, bBoth.R, bBoth.t), `${lab(bBoth.R)}·θ=${bBoth.t}`);
    const bBothR = pick(base, "r");
    showFixed("⑥ 겹침+품질 (r 기준)", (p) => pred(p, bBothR.R, bBothR.t), `${lab(bBothR.R)}·θ=${bBothR.t}`);
    console.log(`  → ②를 크게 못 이기면 gamma와 같은 운명이다(수준 보정일 뿐).`);

    // ── 검정 1. LOO 홀드아웃 ─────────────────────────────────────────────
    console.log(`\n══ 검정 1. LOO 홀드아웃 — 한 곳 빼고 (R,θ) 고른 뒤 뺀 곳에서 채점 ══`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], picks: string[] = [], preds: number[] = [];
      for (let i = 0; i < base.length; i++) {
        const tr = base.filter((_, j) => j !== i);
        const b = pick(tr, crit);
        picks.push(`${lab(b.R)}/θ${b.t}`);
        const ph = pred(base[i], b.R, b.t);
        preds.push(ph);
        errs.push(Math.abs(ph / base[i].obs - 1));
      }
      const inS = pick(base, crit);
      const inM = mapeOf(base, inS.R, inS.t);
      const looM = mean(errs);
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE 기준" : "r 기준"}] 표본 안 ${(inM * 100).toFixed(2)}% (${lab(inS.R)}·θ=${inS.t}) → LOO ${(looM * 100).toFixed(2)}%  벌어짐 ${((looM - inM) * 100).toFixed(2)}%p`);
      console.log(`     LOO 상관 r=${pear(preds, base.map((p) => p.obs)).toFixed(3)} · 훈련이 고른 값: ${tally.map(([k, n]) => `${k} ${Math.round(n / base.length * 100)}%`).join(" · ")}`);
    }
    console.log(`  (gamma는 여기서 29.08% → 36.20%로 7%p 벌어져 기각됐다)`);

    // ── 검정 2. 5겹 교차검증 100회 ───────────────────────────────────────
    // 재현 가능한 난수 — 돌릴 때마다 결론이 흔들리면 안 된다.
    let seed = 20260917 >>> 0;
    const rng = () => {
      seed += 0x6d2b79f5;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };
    console.log(`\n══ 검정 2. 5겹 교차검증 100회 — 훈련겹이 고르는 (R,θ)가 흔들리나 ══`);
    for (const crit of ["mape", "r"] as const) {
      const picks: string[] = [], testErr: number[] = [];
      for (let rep = 0; rep < 100; rep++) {
        const idx = shuffled(base.map((_, i) => i));
        for (let k = 0; k < 5; k++) {
          const te = idx.filter((_, j) => j % 5 === k), tr = idx.filter((_, j) => j % 5 !== k);
          const b = pick(tr.map((i) => base[i]), crit);
          picks.push(`${lab(b.R)}/θ${b.t}`);
          testErr.push(mean(te.map((i) => Math.abs(pred(base[i], b.R, b.t) / base[i].obs - 1))));
        }
      }
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE 기준" : "r 기준"}] 검증겹 MAPE 평균 ${(mean(testErr) * 100).toFixed(2)}%`);
      console.log(`     고른 값: ${tally.slice(0, 5).map(([k, n]) => `${k} ${(n / picks.length * 100).toFixed(0)}%`).join(" · ")}`);
    }
    console.log(`  (gamma는 3.5=42% / 4.5=40% / 4=17%로 불안정했다 — 최빈값이 70%는 넘어야 안정이다)`);

    // ── 검정 3. 무작위 대조군 500회 ──────────────────────────────────────
    // 자유계수가 둘이라 **하나씩 떼어** 검정한다. 둘을 같이 섞으면 어느 쪽이 일했는지 모른다.
    //   (가) 품질 순열 — 품질 점수를 매장끼리 섞는다. 기준선은 "품질 없음(θ=0)에서 최선의 R".
    //   (나) 거리 순열 — 경쟁점 거리를 섞는다. 기준선은 "겹침 없음(R=∞)에서 최선의 θ".
    // 섞어도 같은 개선이 나온다면, 그 개선은 자료가 아니라 **자유도 하나**가 만든 것이다.
    console.log(`\n══ 검정 3. 무작위 대조군 500회 — 섞어도 같은 개선이 나오나 ══`);
    const clone = (s: P[]): P[] => s.map((p) => ({ ...p, riv: p.riv.map((x) => ({ ...x })) }));
    const permQuality = () => {
      const s = clone(base);
      const pool = shuffled(s.flatMap((p) => p.riv.map((x) => x.q)));
      const owns = shuffled(s.map((p) => p.own));
      let i = 0;
      s.forEach((p, k) => { p.own = owns[k]; p.riv.forEach((x) => { x.q = pool[i++]; }); });
      return s;
    };
    const permDistance = () => {
      const s = clone(base);
      const pool = shuffled(s.flatMap((p) => p.riv.map((x) => x.d)));
      let i = 0;
      for (const p of s) for (const x of p.riv) x.d = pool[i++];
      return s;
    };
    const runControl = (title: string, perm: () => P[], baseRs: number[], baseTs: number[]) => {
      for (const crit of ["mape", "r"] as const) {
        const sc = (set: P[], R: number, t: number) => (crit === "mape" ? mapeOf(set, R, t) : -corrOf(set, R, t));
        const gainOf = (set: P[]) => {
          const b0 = pick(set, crit, baseRs, baseTs);     // 기준선 — 검정 대상 자유계수를 뺀 최선
          const b1 = pick(set, crit);                      // 둘 다 자유
          return sc(set, b0.R, b0.t) - sc(set, b1.R, b1.t);
        };
        const real = gainOf(base);
        const gains: number[] = [];
        for (let i = 0; i < 500; i++) gains.push(gainOf(perm()));
        gains.sort((a, b) => a - b);
        const p95 = gains[Math.floor(gains.length * 0.95)];
        const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
        const unit = crit === "mape" ? "%p" : "";
        const f = (v: number) => (crit === "mape" ? (v * 100).toFixed(2) : v.toFixed(3));
        console.log(`  ${title} [${crit === "mape" ? "MAPE" : "r"} 기준] 실제 개선 ${f(real)}${unit} · 섞었을 때 중앙 ${f(med(gains))}${unit} · 95퍼센타일 ${f(p95)}${unit}`);
        console.log(`     p = ${pv.toFixed(3)} → ${pv < 0.05 ? "✅ 잡음으로 설명 안 됨" : "❌ 잡음과 구별 안 됨"}`);
      }
    };
    runControl("(가) 품질 순열", permQuality, GR, [0]);
    runControl("(나) 거리 순열", permDistance, [INF], GT);

    // ── 검정 4. 수준(λ)을 자유로 풀어놓고 다시 ───────────────────────────
    // 검정 0에서 λ=5가 MAPE 31.9%를 냈다. 그런데 자사/경쟁 품질비가 1.75이고 1.75³=5.36이다.
    // 즉 **θ의 MAPE 몫은 사실상 상수 배율**이다 — gamma를 죽인 바로 그 정체다.
    // 공정하게 재려면 λ를 모든 모형에 넣고(잡음 계수), 그 위에서 θ·R이 남기는 게 있는지 본다.
    //   점유율 = λ·자사PC·품질^θ ÷ (λ·자사PC·품질^θ + Σ[d≤R] 경쟁PC·품질ᵢ^θ)
    const GL = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const predL = (p: P, L: number, R: number, t: number) => {
      const own = L * p.pc * Math.pow(p.own, t);
      let riv = 0;
      for (const x of p.riv) if (x.d <= R) riv += x.ip * Math.pow(x.q, t);
      return own / (own + riv);
    };
    const scoreL = (set: P[], crit: "mape" | "r", L: number, R: number, t: number) => {
      const ps = set.map((p) => predL(p, L, R, t));
      return crit === "mape" ? mean(set.map((p, i) => Math.abs(ps[i] / p.obs - 1))) : -pear(ps, set.map((p) => p.obs));
    };
    const pickL = (set: P[], crit: "mape" | "r", Rs = GR, Ts = GT) => {
      let best = { L: GL[0], R: Rs[0], t: Ts[0], v: Infinity };
      for (const R of Rs) for (const t of Ts) for (const L of GL) {
        const v = scoreL(set, crit, L, R, t);
        if (v < best.v) best = { L, R, t, v };
      }
      return best;
    };
    console.log(`\n══ 검정 4. 수준 λ를 자유로 풀고 다시 — 수준 말고 남기는 게 있나 ══`);
    console.log(`${"구조".padEnd(30)}${"고른 값".padStart(18)}${"MAPE".padStart(9)}${"실측과 r".padStart(10)}`);
    const showL = (label: string, b: { L: number; R: number; t: number }) => {
      const f = (p: P) => predL(p, b.L, b.R, b.t);
      const e = base.map((p) => f(p) / p.obs - 1);
      console.log(`${label.padEnd(30)}${`λ=${b.L}·${lab(b.R)}·θ=${b.t}`.padStart(18)}${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(base.map(f), base.map((p) => p.obs)).toFixed(3).padStart(10)}`);
    };
    const lBase = pickL(base, "mape", [INF], [0]);
    showL("기준선 — λ만", lBase);
    showL("λ + 품질θ + 겹침R (MAPE)", pickL(base, "mape"));
    showL("λ + 품질θ + 겹침R (r)", pickL(base, "r"));
    // 변별력이 자사 쪽인가 경쟁점 쪽인가 — 한쪽씩 중앙값으로 눌러 본다.
    const flatten = (which: "own" | "riv") => {
      const s = clone(base);
      if (which === "own") { const m = med(s.map((p) => p.own)); for (const p of s) p.own = m; }
      else { const m = med(s.flatMap((p) => p.riv.map((x) => x.q))); for (const p of s) for (const x of p.riv) x.q = m; }
      return s;
    };
    for (const [nm, set] of [["  └ 자사 품질을 중앙 고정", flatten("own")], ["  └ 경쟁 품질을 중앙 고정", flatten("riv")]] as [string, P[]][]) {
      const b = pickL(set, "r");
      const ps = set.map((p) => predL(p, b.L, b.R, b.t));
      console.log(`${nm.padEnd(30)}${`λ=${b.L}·${lab(b.R)}·θ=${b.t}`.padStart(18)}${(mean(set.map((p, i) => Math.abs(ps[i] / p.obs - 1))) * 100).toFixed(1).padStart(8)}%${pear(ps, set.map((p) => p.obs)).toFixed(3).padStart(10)}`);
    }
    // λ를 깐 상태에서 대조군을 다시 돌린다. 여기서 살아남아야 "수준 보정이 아니다".
    const runControlL = (title: string, perm: () => P[], baseRs: number[], baseTs: number[]) => {
      for (const crit of ["mape", "r"] as const) {
        const gainOf = (set: P[]) => {
          const b0 = pickL(set, crit, baseRs, baseTs), b1 = pickL(set, crit);
          return scoreL(set, crit, b0.L, b0.R, b0.t) - scoreL(set, crit, b1.L, b1.R, b1.t);
        };
        const real = gainOf(base);
        const gains: number[] = [];
        for (let i = 0; i < 500; i++) gains.push(gainOf(perm()));
        gains.sort((a, b) => a - b);
        const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
        const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
        console.log(`  ${title} [${crit === "mape" ? "MAPE" : "r"} 기준] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gains))} · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])} · p = ${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
      }
    };
    console.log(`  — λ를 깐 대조군 500회 (여기서 살아남아야 "수준 보정이 아니다") —`);
    runControlL("(가) 품질 순열", permQuality, GR, [0]);
    runControlL("(나) 거리 순열", permDistance, [INF], GT);
    // LOO도 λ를 깐 채로 다시
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: string[] = [];
      for (let i = 0; i < base.length; i++) {
        const b = pickL(base.filter((_, j) => j !== i), crit);
        picks.push(`λ${b.L}/${lab(b.R)}/θ${b.t}`);
        const ph = predL(base[i], b.L, b.R, b.t);
        preds.push(ph); errs.push(Math.abs(ph / base[i].obs - 1));
      }
      const inb = pickL(base, crit);
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  LOO [${crit === "mape" ? "MAPE" : "r"} 기준] 표본 안 ${(scoreL(base, "mape", inb.L, inb.R, inb.t) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}% · LOO r=${pear(preds, base.map((p) => p.obs)).toFixed(3)} · 고른 값 ${tally.slice(0, 3).map(([k, n]) => `${k} ${Math.round(n / base.length * 100)}%`).join(" · ")}`);
    }
    console.log(`  (유의선 r = ${(2 / Math.sqrt(base.length)).toFixed(3)} · λ만 쓸 때 r = ${(-scoreL(base, "r", lBase.L, INF, 0)).toFixed(3)})`);

    // ── 검정 5. r이 몇 곳에 휘둘리나 ─────────────────────────────────────
    // 판정이 전부 r 하나에 걸려 있다. n=29에 계단 함수면 한두 곳이 r을 만들어낼 수 있다.
    // 순위상관(스피어만)과 한 곳씩 빼본 r 폭을 같이 본다.
    const rank = (a: number[]) => {
      const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
      const rk = new Array(a.length).fill(0);
      idx.forEach(([, i], k) => { rk[i] = k + 1; });
      return rk;
    };
    console.log(`\n══ 검정 5. r이 몇 곳에 휘둘리나 (판정이 r 하나에 걸려 있다) ══`);
    console.log(`${"구조".padEnd(26)}${"피어슨 r".padStart(10)}${"스피어만".padStart(10)}${"한 곳 빼면".padStart(16)}`);
    for (const [nm, R, t] of [["λ=5만 (품질·겹침 없음)", INF, 0], ["300m 계단만 (θ=0)", 300, 0], ["300m·θ=3 (채택 후보)", 300, 3], ["400m·θ=3 (MAPE 최선)", 400, 3]] as [string, number, number][]) {
      const L = t === 0 && R === INF ? bestL.L : 1;
      const ps = base.map((p) => predL(p, L, R, t)), ob = base.map((p) => p.obs);
      const jk = base.map((_, i) => pear(ps.filter((_, j) => j !== i), ob.filter((_, j) => j !== i)));
      console.log(`${nm.padEnd(26)}${pear(ps, ob).toFixed(3).padStart(10)}${pear(rank(ps), rank(ob)).toFixed(3).padStart(10)}${`${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)}`.padStart(16)}`);
    }
    console.log(`  → 한 곳 빼서 유의선(${(2 / Math.sqrt(base.length - 1)).toFixed(3)}) 아래로 내려가면 그 r은 한 매장이 만든 것이다.`);

    expect(base.length).toBeGreaterThan(20);
  });
});
