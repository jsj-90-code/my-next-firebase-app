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
// ⚠️ 아직 홀드아웃·대조군 검정을 안 했다. d0와 θ 둘 다 자유계수라 과적합 확인이 필요하다.
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
  it("겹침 + 경쟁력", () => {
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
          return { ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0), d: Number(c.distanceM ?? 0), score: scoreOf(sp, c.foodScore ?? null, fac) };
        })
        .filter((r) => r.ip > 0);
      rows.push({ n: s.storeName, pc, ownScore: scoreOf(ownSpec, s.ownFoodScore ?? null, ownFac), rivals,
        demand: pop + env * 0.15, util: mean(g.rows.map((r: any) => r.monthlyRate)) });
    }
    const mono = rows.filter((r) => !r.rivals.length);
    const A = med(mono.map((r) => r.util / (r.demand / (r.pc * 720))));
    for (const r of rows) r.shareObs = r.util / (A * r.demand / (r.pc * 720));
    const cmp = rows.filter((r) => r.rivals.length);

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
    console.log(`  (비교) 지금 산식 격차^4: MAPE 32.0% · 실측 점유율 중앙 ${med(cmp.map((r: any) => r.shareObs)).toFixed(3)}`);
    expect(cmp.length).toBeGreaterThan(20);
  });
});
