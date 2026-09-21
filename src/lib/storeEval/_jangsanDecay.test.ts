// 장산점은 왜 감쇠를 켜면 2.2% -> 40.5%로 무너지나 (2026-09-21)
//
// ── 배경 ──────────────────────────────────────────────────────────────────
// 2026-09-21에 거리 감쇠를 채택했다(`R=300 · λ=150 · weightFactor 0.90`, 커밋 27caaf2).
// 전체로는 **최악 오차가 54.7 -> 51.9%로 줄었지만** 매장 33곳 중 19곳이 나빠졌고,
// 그중 장산점이 압도적이다 — **2.2% -> 40.5%, 38%p.** 사용자 지시:
//   *"장산점 — 왜 그런지 개별로 파라."*
//
// ── 무엇을 알아내려는가 ───────────────────────────────────────────────────
// "감쇠를 켜니 경쟁이 늘어서 예측이 내려갔다"는 **설명이 아니라 동어반복**이다.
// 알아내야 하는 건 셋이다.
//
//   묻기 1  장산점이 **얼마나 극단적인가.** 감쇠가 새로 세는 경쟁량이 다른 매장 대비
//           몇 배인가. 장산이 특이점인지, 아니면 같은 성질의 매장이 여럿인지.
//   묻기 2  **누가 범인인가.** 경쟁점 10곳 중 어느 하나인가, 아니면 합인가.
//           하나면 그 매장의 자료(거리·대수)를 의심해야 하고, 합이면 산식 문제다.
//   묻기 3  **계단이 맞았던 건 우연인가.** 계단에서 2.2%가 나온 게 "300m 밖 경쟁점이
//           진짜로 경쟁을 안 한다"는 증거인지, 아니면 **두 오차가 상쇄된 것**인지.
//           후자라면 장산의 2.2%는 애초에 신뢰할 숫자가 아니었다.
//
// ── ⚠️ 이 파일이 안 하는 것 ───────────────────────────────────────────────
// **계수를 안 고른다.** `textbookModel.ts`를 안 건드린다. 재고 표만 만든다
// (사용자 규칙: *"계수·점수를 내 확인 없이 고르지 마라. 재고 표로 남겨라"*).
// 그리고 MAPE만 보지 않는다 — 최악·SD를 같이 찍는다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_jangsanDecay.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const won = (v: number | null) => (v == null ? "-" : `${Math.round(v / 1e4).toLocaleString()}만`);
const pct = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(d)}%`);

describeIf("장산점 — 감쇠를 켜면 왜 무너지나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;
  const JANGSAN = "장산점";

  /** 지금 채택된 산식(감쇠 켬)과, 그 직전(계단 300m). 둘 다 DEFAULT에서 파생한다. */
  const P_DECAY: TextbookParams = DEFAULT_TEXTBOOK_PARAMS;
  const P_STEP: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, rivalDistanceDecay: null };
  const D = P_DECAY.rivalDistanceDecay!;

  /** 감쇠 무게(정규화 포함) · 계단 무게. 산식과 **같은 식**을 쓴다. */
  const wDecay = (d: number | null) =>
    (d == null || d <= D.plateauM ? 1 : Math.exp(-(d - D.plateauM) / D.scaleM)) * (D.weightFactor ?? 1);
  const wStep = (d: number | null) => (d == null || d <= P_STEP.effectiveRadiusM ? 1 : 0);

  /** 한 매장의 경쟁 무게 합(품질비는 뺀 날 ip 기준 — 거리 효과만 보려는 것이다). */
  const rivalMass = (r: LabRow, w: (d: number | null) => number) =>
    (r.input.rivals ?? []).reduce((s, v) => s + (v.ip > 0 ? v.ip * w(v.distanceM) : 0), 0);

  /** LOO 오차 — 자기 자신을 빼고 축척을 맞춘 뒤 자기를 맞힌다. 표에 쓰는 정식 성적이다. */
  const loo = (p: TextbookParams) => {
    const out = new Map<string, number>();
    for (let i = 0; i < base.length; i++) {
      const full = fittedParams(p, scoreTextbook(base.filter((_, k) => k !== i), p));
      const b = computeTextbook(base[i].input, full);
      const a = base[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) out.set(nameOf(base[i]), (b.monthlyRevenue - a) / a); // 부호 있는 오차
    }
    return out;
  };
  const absMape = (m: Map<string, number>) => mean([...m.values()].map(Math.abs));
  const absWorst = (m: Map<string, number>) => Math.max(...[...m.values()].map(Math.abs));

  const LOO_STEP = loo(P_STEP);
  const LOO_DECAY = loo(P_DECAY);

  it("(1) 장산점 카드 — 경쟁점 10곳이 각각 얼마로 세지나", () => {
    const row = base.find((r) => nameOf(r) === JANGSAN);
    expect(row, "장산점이 표본에 있어야 한다").toBeTruthy();
    const r = row!;
    const rivals = [...(r.input.rivals ?? [])].sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
    console.log(`\n[장산점] 자사 PC ${r.input.pcCount}대 · 시급 ${r.input.hourlyRate}원 · 실측가동률 ${pct(r.input.actualUtilization)}`);
    console.log(`  실매출 ${won(r.actualRevenue)}/월 · 경쟁점 ${rivals.length}곳`);
    console.log(`\n  경쟁점            거리     PC수   계단   감쇠    계단 기여   감쇠 기여`);
    let mStep = 0, mDecay = 0;
    for (const v of rivals) {
      const d = v.distanceM;
      const ws = wStep(d), wd = wDecay(d);
      mStep += v.ip * ws; mDecay += v.ip * wd;
      const flag = ws === 0 && wd > 0.3 ? "  <- 감쇠가 새로 센다" : "";
      console.log(`  ${(v.name ?? "?").padEnd(18)}${(d == null ? "?" : Math.round(d) + "m").padStart(6)}${String(v.ip).padStart(7)}` +
        `${(ws * 100).toFixed(0).padStart(7)}%${(wd * 100).toFixed(0).padStart(6)}%` +
        `${(v.ip * ws).toFixed(0).padStart(11)}${(v.ip * wd).toFixed(0).padStart(12)}${flag}`);
    }
    console.log(`  ${"합".padEnd(18)}${"".padStart(13)}${"".padStart(14)}${mStep.toFixed(0).padStart(11)}${mDecay.toFixed(0).padStart(12)}`);
    console.log(`\n  ⚠️ 경쟁량이 ${mStep.toFixed(0)} -> ${mDecay.toFixed(0)}  (**${((mDecay / mStep - 1) * 100).toFixed(0)}% 증가**)`);
    console.log(`     자사 ${r.input.pcCount}대 대비 경쟁 배수: 계단 ${(mStep / (r.input.pcCount ?? 1)).toFixed(1)}배 -> 감쇠 ${(mDecay / (r.input.pcCount ?? 1)).toFixed(1)}배`);

    // 예측 분해 — 무엇이 얼마나 움직였나
    console.log(`\n  [예측 분해] (전 매장 적합 · LOO 아님)`);
    console.log(`  단계                         계단300          감쇠 R300 λ150`);
    const fitS = fittedParams(P_STEP, scoreTextbook(base, P_STEP));
    const fitD = fittedParams(P_DECAY, scoreTextbook(base, P_DECAY));
    const bS = computeTextbook(r.input, fitS), bD = computeTextbook(r.input, fitD);
    const line = (k: string, a: string, b: string) => console.log(`  ${k.padEnd(24)}${a.padStart(16)}${b.padStart(24)}`);
    line("총수요 시간", won(bS.totalDemandHours), won(bD.totalDemandHours));
    line("점유율", pct(bS.share, 2), pct(bD.share, 2));
    line("입지 배율", bS.locationMultiplier?.toFixed(3) ?? "-", bD.locationMultiplier?.toFixed(3) ?? "-");
    line("예측 가동률", pct(bS.utilization, 1), pct(bD.utilization, 1));
    line("실측 가동률", pct(r.input.actualUtilization), pct(r.input.actualUtilization));
    line("예측 매출", won(bS.monthlyRevenue), won(bD.monthlyRevenue));
    line("실매출", won(r.actualRevenue), won(r.actualRevenue));
    line("오차(부호)", pct((bS.monthlyRevenue! - r.actualRevenue) / r.actualRevenue), pct((bD.monthlyRevenue! - r.actualRevenue) / r.actualRevenue));
    console.log(`\n  LOO 오차:  계단 ${pct(LOO_STEP.get(JANGSAN) ?? null)}  ->  감쇠 ${pct(LOO_DECAY.get(JANGSAN) ?? null)}`);
    console.log(`  ⚠️ 부호를 보라 — 감쇠 쪽이 **음수(과소예측)**면 "경쟁을 과하게 셌다"는 뜻이다.`);
    expect(mDecay).toBeGreaterThan(mStep);
  });

  it("(2) 묻기 1 — 장산점이 얼마나 극단적인가 (전 매장 순위)", () => {
    const rows = base.map((r) => {
      const ms = rivalMass(r, wStep), md = rivalMass(r, wDecay);
      const pc = r.input.pcCount ?? 1;
      return {
        n: nameOf(r), ms, md,
        grow: ms > 0 ? md / ms - 1 : md > 0 ? Infinity : 0,
        addPerOwn: (md - ms) / pc,          // 자사 PC 1대당 새로 세진 경쟁 대수
        eS: LOO_STEP.get(nameOf(r)) ?? null,
        eD: LOO_DECAY.get(nameOf(r)) ?? null,
      };
    }).filter((x) => x.eS != null && x.eD != null);
    const ranked = [...rows].sort((a, b) => b.addPerOwn - a.addPerOwn);
    console.log(`\n[누가 새 경쟁을 제일 많이 먹나] 기준: (감쇠 경쟁량 − 계단 경쟁량) ÷ 자사 PC수`);
    console.log(`  매장              계단경쟁  감쇠경쟁   증가율   자사1대당 추가   계단오차   감쇠오차    변화`);
    for (const x of ranked.slice(0, 12)) {
      const dd = Math.abs(x.eD!) - Math.abs(x.eS!);
      console.log(`  ${x.n.padEnd(16)}${x.ms.toFixed(0).padStart(8)}${x.md.toFixed(0).padStart(10)}` +
        `${(x.grow * 100).toFixed(0).padStart(8)}%${x.addPerOwn.toFixed(2).padStart(15)}` +
        `${pct(x.eS).padStart(11)}${pct(x.eD).padStart(11)}${(dd >= 0 ? "  +" : "  ") + (dd * 100).toFixed(1) + "%p"}` +
        (x.n === JANGSAN ? "  <- 장산" : ""));
    }
    const jr = ranked.findIndex((x) => x.n === JANGSAN);
    const j = ranked[jr];
    console.log(`\n  장산점 순위 ${jr + 1}위 / ${ranked.length}곳 · 자사1대당 추가 ${j.addPerOwn.toFixed(2)}대`);
    console.log(`  (2위 ${ranked[jr === 0 ? 1 : 0].n} ${ranked[jr === 0 ? 1 : 0].addPerOwn.toFixed(2)}대 · 중앙값 ${[...ranked].sort((a, b) => a.addPerOwn - b.addPerOwn)[Math.floor(ranked.length / 2)].addPerOwn.toFixed(2)}대)`);
    console.log(`\n  ⚠️ 여기서 보려는 것 — 장산이 **홀로 튀는 특이점**이면 이 매장의 자료를 의심하고,`);
    console.log(`     같은 성질의 매장이 여럿인데 장산만 오차가 크면 **산식**을 의심한다.`);
    expect(ranked.length).toBeGreaterThan(20);
  });

  it("(3) 묻기 2 — 범인이 하나인가 합인가 (경쟁점 한 곳씩 빼본다)", () => {
    const r = base.find((x) => nameOf(x) === JANGSAN)!;
    const fitD = fittedParams(P_DECAY, scoreTextbook(base, P_DECAY));
    const full = computeTextbook(r.input, fitD);
    console.log(`\n[한 곳씩 빼기] 감쇠를 켠 상태에서 경쟁점을 하나씩 제거하면 장산 예측이 어디로 가나`);
    console.log(`  전부 있을 때 예측 ${won(full.monthlyRevenue)} · 실매출 ${won(r.actualRevenue)} · 오차 ${pct((full.monthlyRevenue! - r.actualRevenue) / r.actualRevenue)}`);
    console.log(`\n  뺀 경쟁점          거리    PC수    예측매출     오차      오차개선`);
    const rivals = [...(r.input.rivals ?? [])].sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
    const e0 = Math.abs((full.monthlyRevenue! - r.actualRevenue) / r.actualRevenue);
    for (const v of rivals) {
      const input = { ...r.input, rivals: (r.input.rivals ?? []).filter((x) => x !== v) };
      const b = computeTextbook(input, fitD);
      const e = (b.monthlyRevenue! - r.actualRevenue) / r.actualRevenue;
      console.log(`  ${(v.name ?? "?").padEnd(18)}${(Math.round(v.distanceM ?? 0) + "m").padStart(6)}${String(v.ip).padStart(7)}` +
        `${won(b.monthlyRevenue).padStart(12)}${pct(e).padStart(10)}${((e0 - Math.abs(e)) * 100).toFixed(1).padStart(10)}%p`);
    }
    // 300m 밖 넷을 통째로 빼면 = 계단과 같은 세계(단, 정규화 0.90은 남는다)
    const inside = (r.input.rivals ?? []).filter((v) => (v.distanceM ?? 0) <= D.plateauM);
    const bIn = computeTextbook({ ...r.input, rivals: inside }, fitD);
    console.log(`\n  300m 밖 ${(r.input.rivals ?? []).length - inside.length}곳 통째로 빼면  ${won(bIn.monthlyRevenue)}` +
      `  오차 ${pct((bIn.monthlyRevenue! - r.actualRevenue) / r.actualRevenue)}`);
    console.log(`  ⚠️ 한 곳을 빼서 오차가 확 줄면 **그 경쟁점 자료(거리·대수)를 의심**해야 하고,`);
    console.log(`     넷을 다 빼야 줄면 **거리 구조 자체**가 장산에서 안 맞는 것이다.`);
    expect(rivals.length).toBeGreaterThan(5);
  });

  it("(4) 묻기 3 — 계단의 2.2%는 실력인가 상쇄인가", () => {
    // 계단에서 장산이 잘 맞은 게 "300m 밖이 경쟁을 안 한다"는 증거라면,
    // **경쟁 항을 끈(shareMode=off) 세계에서 필요 점유율이 1에 가까워야** 앞뒤가 맞는다.
    // 필요 점유율이 낮으면 장산은 원래 "경쟁에 많이 먹히는 매장"이고,
    // 계단이 그걸 우연히 맞춘 것이다.
    const r = base.find((x) => nameOf(x) === JANGSAN)!;
    const sS = scoreTextbook(base, P_STEP), sD = scoreTextbook(base, P_DECAY);
    const rowS = sS.rows.find((x) => (x.storeName ?? x.storeCode) === JANGSAN);
    const rowD = sD.rows.find((x) => (x.storeName ?? x.storeCode) === JANGSAN);
    console.log(`\n[필요 점유율] "경쟁이 없다고 치면 이 매장은 동네 수요의 몇 %를 먹은 셈인가"`);
    console.log(`  장산  필요 점유율 ${pct(rowS?.requiredShare ?? null, 1)}  ·  예측 점유율 계단 ${pct(rowS?.share ?? null, 1)} / 감쇠 ${pct(rowD?.share ?? null, 1)}`);
    const need = rowS?.requiredShare ?? null;
    console.log(`  필요÷예측:  계단 ${need && rowS?.share ? (need / rowS.share).toFixed(2) : "-"}배  ·  감쇠 ${need && rowD?.share ? (need / rowD.share).toFixed(2) : "-"}배`);
    // 표본 전체와 견줘야 크기를 안다
    const all = sS.rows.filter((x) => x.requiredShare != null && x.share != null && x.share > 0);
    const ratios = all.map((x) => x.requiredShare! / x.share!).sort((a, b) => a - b);
    console.log(`\n  표본 ${all.length}곳의 필요÷예측(계단): 중앙 ${ratios[Math.floor(ratios.length / 2)].toFixed(2)} · 최소 ${ratios[0].toFixed(2)} · 최대 ${ratios[ratios.length - 1].toFixed(2)}`);
    const reqs = all.map((x) => x.requiredShare!).sort((a, b) => a - b);
    console.log(`  필요 점유율 중앙 ${pct(reqs[Math.floor(reqs.length / 2)])} · 장산 ${pct(need)}` +
      ` (아래에서 ${all.filter((x) => x.requiredShare! < (need ?? 0)).length + 1}번째 / ${all.length})`);
    console.log(`\n  ⚠️ 장산의 필요 점유율이 표본에서 **낮은 쪽**이면 "경쟁에 많이 먹히는 자리"가 맞고,`);
    console.log(`     그러면 감쇠가 경쟁을 더 세는 방향 자체는 옳다 — 틀린 건 **양**이다.`);
    console.log(`     반대로 높은 쪽이면 장산은 경쟁을 잘 버틴 매장이고, 감쇠가 헛다리를 짚은 것이다.`);
    expect(rowS && rowD).toBeTruthy();
  });

  it("(5) 장산을 빼면 감쇠 채택 판정이 바뀌나", () => {
    // 감쇠 채택의 근거는 "최악이 54.7 -> 51.9%로 준다"였다. 장산이 그 최악을 만들었다면
    // 판정 자체가 장산 한 곳에 달려 있었던 셈이다. 빼고 다시 잰다.
    const names = [...LOO_STEP.keys()].filter((n) => LOO_DECAY.has(n));
    const show = (label: string, keep: (n: string) => boolean) => {
      const A = new Map([...LOO_STEP].filter(([n]) => names.includes(n) && keep(n)));
      const B = new Map([...LOO_DECAY].filter(([n]) => names.includes(n) && keep(n)));
      const aV = [...A.values()].map(Math.abs), bV = [...B.values()].map(Math.abs);
      console.log(`  ${label.padEnd(22)}n=${A.size}` +
        `   MAPE ${pct(mean(aV), 2)} -> ${pct(mean(bV), 2)}` +
        `   최악 ${pct(absWorst(A), 1)} -> ${pct(absWorst(B), 1)}` +
        `   SD ${(sd(aV) * 100).toFixed(1)} -> ${(sd(bV) * 100).toFixed(1)}%p`);
    };
    console.log(`\n[장산 민감도] 계단300 -> 감쇠 R300 λ150`);
    show("전부", () => true);
    show("장산 빼고", (n) => n !== JANGSAN);
    console.log(`\n  최악 오차를 만든 매장:  계단 ${[...LOO_STEP].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0]}` +
      `  ·  감쇠 ${[...LOO_DECAY].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0]}`);
    console.log(`  ⚠️ '장산 빼고'에서도 최악이 줄면 채택 근거는 장산과 무관하게 선다.`);
    console.log(`     안 줄면 **채택 근거가 장산 한 곳에 얹혀 있었다**는 뜻이라 다시 봐야 한다.`);
    expect(names.length).toBeGreaterThan(20);
  });

  it("(6) 재고 표 — 장산을 살리는 손잡이들 (고르지 않는다, 재기만 한다)", () => {
    // ⚠️ 사용자 규칙: 계수를 확인 없이 고르지 않는다. 여기서는 **후보를 늘어놓고 값만 찍는다.**
    // 전 매장 성적과 장산 오차를 **같이** 본다 — 장산만 좋아지는 손잡이는 과적합이다.
    // ⚠️ 여기서 한 번 틀릴 뻔했다 — `weightFactor 0.90`은 **R300 λ150에 맞춰 잰 값**이다.
    //    다른 (R, λ)에 그대로 쓰면 총량이 안 맞아서 "거리 구조"가 아니라 "총량 차이"를
    //    재게 된다. 채택 때와 **같은 식**으로 조합마다 다시 잰다:
    //        wf = Σ(ip x 계단300) ÷ Σ(ip x 감쇠)      ← 전 매장 합, 전역 상수 하나
    const totalWith = (w: (d: number | null) => number) =>
      base.reduce((s, r) => s + (r.input.rivals ?? []).reduce((t, v) => t + (v.ip > 0 ? v.ip * w(v.distanceM) : 0), 0), 0);
    const stepTotal = totalWith(wStep);
    /** 정규화된 감쇠 파라미터를 만든다. wf는 여기서 **측정**한다 — 손으로 안 고른다. */
    const mk = (plateauM: number, scaleM: number): { p: TextbookParams; wf: number } => {
      const raw = (d: number | null) => (d == null || d <= plateauM ? 1 : Math.exp(-(d - plateauM) / scaleM));
      const wf = stepTotal / Math.max(1e-9, totalWith(raw));
      return { p: { ...DEFAULT_TEXTBOOK_PARAMS, rivalDistanceDecay: { plateauM, scaleM, weightFactor: wf } }, wf };
    };
    type Knob = { key: string; p: TextbookParams; wf: number };
    const knobs: Knob[] = [
      { key: "계단300(채택 전)", p: P_STEP, wf: 1 },
      { key: "R300 λ150 (지금)", p: P_DECAY, wf: D.weightFactor ?? 1 },
      ...([[300, 100], [300, 75], [300, 50], [250, 150], [200, 200], [150, 250], [0, 300]] as [number, number][])
        .map(([R, L]) => { const m = mk(R, L); return { key: `R${R} λ${L}${R === 0 ? "(전구간)" : ""}`, p: m.p, wf: m.wf }; }),
    ];
    // 되짚기 — 채택된 0.90이 이 식으로 재현되는지 먼저 확인한다(안 되면 표 전체를 못 믿는다).
    const check = mk(D.plateauM, D.scaleM).wf;
    console.log(`\n  [정규화 되짚기] R300 λ150을 다시 재면 wf = ${check.toFixed(3)} · 산식에 박힌 값 ${(D.weightFactor ?? 1).toFixed(2)}` +
      `  ${Math.abs(check - (D.weightFactor ?? 1)) < 0.01 ? "**일치**" : "❌ 어긋난다"}`);
    console.log(`\n[재고 표] ⚠️ 고르지 않는다. 사용자가 고른다. wf는 조합마다 다시 쟀다.`);
    console.log(`  손잡이                  wf    전체MAPE    최악     SD     장산오차   302m무게 345m무게`);
    for (const k of knobs) {
      const L = loo(k.p);
      const dd = k.p.rivalDistanceDecay;
      const w = (d: number) => dd
        ? (d <= dd.plateauM ? 1 : Math.exp(-(d - dd.plateauM) / dd.scaleM)) * (dd.weightFactor ?? 1)
        : (d <= k.p.effectiveRadiusM ? 1 : 0);
      console.log(`  ${k.key.padEnd(18)}${k.wf.toFixed(2).padStart(6)}${pct(absMape(L), 2).padStart(11)}${pct(absWorst(L), 1).padStart(9)}` +
        `${(sd([...L.values()].map(Math.abs)) * 100).toFixed(1).padStart(7)}%p${pct(L.get(JANGSAN) ?? null).padStart(11)}` +
        `${(w(302) * 100).toFixed(0).padStart(9)}%${(w(345) * 100).toFixed(0).padStart(9)}%`);
    }
    console.log(`\n  ⚠️ 장산만 좋아지고 전체 MAPE·최악이 나빠지는 손잡이는 **장산 과적합**이다.`);
    console.log(`     셋(MAPE·최악·장산)이 같이 좋아지는 칸이 있는지가 볼 것이다.`);
    expect(knobs.length).toBe(9);
  });
});
