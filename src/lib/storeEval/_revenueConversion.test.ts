// 매출 환산층 — 가동률을 매출로 바꾸는 층만 떼어내 잰다 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16): "독점매장 예상 가동률 맞춰놨는데 예상 매출이 안맞는다고, 이걸 수정해야함"
//
// ── 왜 이 하네스가 따로 필요한가 ────────────────────────────────────────
// _draftFormula.test.ts는 수요 -> 가동률을 잰다. 거기서 독점 3곳이 2% 안에 들어오는데도
// 화면의 예상매출은 크게 틀렸다. 원인은 수요식이 아니라 **환산층**이었다.
//
// 이 하네스는 **실측 가동률을 그대로 집어넣고** 매출만 계산한다. 그러면 남는 오차가 전부
// 환산층 책임이 된다 — 수요식 오차가 한 방울도 안 섞인다.
//
//   npx vitest run src/lib/storeEval/_revenueConversion.test.ts --reporter=verbose
//
// ── 2026-09-16에 여기서 밝혀진 것 ───────────────────────────────────────
// 1) 축척 하나가 두 일을 겸하고 있었다. fitHoursPerUser가 축척을 **실매출**에 맞추는 바람에
//    환산층이 틀린 만큼(-12.7%~+19.2%)이 가동률로 되밀려, 독점 3곳 가동률이 화면에서
//    -3.2~-5.3% 어긋나 보였다. 축척을 둘로 나눠 고쳤다(fitHoursPerUser / fitProductUnitPrice).
// 2) 환산층이 필요로 하는 값은 **총단가**(PC 1대·1시간당 총매출)다.
//    실측 32곳: 중앙 2,778원 · 범위 2,246~3,606원 · 변동계수 13.4%.
//    그리고 총단가는 **PC몫 + 상품몫**으로 갈라야 한다(저녁(3) 결정). 정가는 PC몫에만 걸린다 —
//    총단가 전체에 곱하면 요금을 올릴 때 라면 값도 같이 오르는 꼴이 된다.
//    독점 3곳 총단가가 16.8% 벌어지는데 **그 차이의 75%가 상품몫**이다(탕정역 1,591원 vs 남악 1,247원).
// 3) 건별 원장(바탕화면 `좌석가동률_7월`)으로 독립 검증했다. 광주첨단점 2026-08 기준
//    원장 가동률 29.8% vs 매출DB 30.0%, 원장 총단가 2,682원 vs DB기준 2,857원.
//    객단가는 6,909~10,844원, 평균 체류 2.37~3.16시간이었다.
// 4) 정액권 손님은 시간당 296~663원으로 일반(1,021~1,450원)의 1/3만 낸다. 시간 기준 비중이
//    매장마다 2.1~9.1%로 4배 차이 나고, 이게 실효단가 편차의 실체다. **매장 운영 정책이지
//    입지 특성이 아니라서** 신규 후보지에는 평균을 쓰는 게 맞다(사용자 판단과 일치).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = hasValidationSnapshot() && existsSync(UTIL_FILE);
const describeIf = ready ? describe : describe.skip;

const MONTH_HOURS = 24 * 30;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const gmean = (a: number[]) => Math.exp(mean(a.map(Math.log)));

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("매출 환산층 — 실측 가동률을 넣고 매출만 잰다", () => {
  const snap = loadValidationSnapshot<any>();
  const util = JSON.parse(readFileSync(UTIL_FILE, "utf8"));

  // 매장 x 월 색인. 평가창(게토가 잘라 준 12개월)과 같은 달만 쓴다.
  const salesBy = new Map<string, Map<string, any>>();
  for (const r of snap.sales as any[]) {
    if (!salesBy.has(r.storeCode)) salesBy.set(r.storeCode, new Map());
    salesBy.get(r.storeCode)!.set(r.yearMonth, r);
  }

  type Row = {
    name: string; pc: number; listRate: number; rival: number;
    /** 게토 실측 월평균 가동률(평가창 12개월) */
    util: number;
    /** 매출DB 실측 월평균 가동률 — 출처가 다른 같은 값. 대조용이다. */
    dbUtil: number | null;
    total: number; prodRatio: number;
    /** PC매출 ÷ (PC x 720 x 실측가동률) */
    effRate: number;
    /** 총매출 ÷ (PC x 720 x 실측가동률) — 환산층이 필요로 하는 유일한 숫자 */
    unitPrice: number;
    /** 그중 PC몫. 정가가 여기에만 걸린다. */
    pcUnitPrice: number;
    /** 그중 상품몫. 독점 3곳 총단가 차이의 75%가 여기서 난다. */
    productUnitPrice: number;
  };
  const rows: Row[] = [];
  for (const st of snap.existingStores as any[]) {
    const g = util[st.storeName];
    if (!g?.rows?.length) continue;
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc || st.hourlyRate == null) continue;
    const ms = salesBy.get(st.storeCode);
    if (!ms) continue;
    const recs = g.rows.map((r: any) => ms.get(r.yearMonth)).filter(Boolean);
    if (recs.length < 6) continue;
    const u = mean(g.rows.map((r: any) => r.monthlyRate));
    const pcSales = mean(recs.map((r: any) => r.pcSales ?? 0));
    const prodSales = mean(recs.map((r: any) => r.productSales ?? 0));
    const total = pcSales + prodSales;
    if (!(total > 0) || !(pcSales > 0) || !(u > 0)) continue;
    const dbUs = recs.map((r: any) => r.utilizationRate).filter((v: any) => v != null && v > 0);
    rows.push({
      name: st.storeName, pc, listRate: st.hourlyRate, rival: st.competitorIp ?? 0,
      util: u, dbUtil: dbUs.length ? mean(dbUs) : null,
      total, prodRatio: prodSales / total,
      effRate: pcSales / (pc * MONTH_HOURS * u),
      unitPrice: total / (pc * MONTH_HOURS * u),
      pcUnitPrice: pcSales / (pc * MONTH_HOURS * u),
      productUnitPrice: prodSales / (pc * MONTH_HOURS * u),
    });
  }
  const mono = rows.filter((r) => r.rival === 0);

  it("표본과 두 출처 대조", () => {
    const both = rows.filter((r) => r.dbUtil != null);
    const diff = both.map((r) => Math.abs(r.util - r.dbUtil!) / r.dbUtil!);
    console.log(`\n표본 ${rows.length}곳 (게토 실측 가동률 + 평가창 월매출 6개월 이상) · 독점 ${mono.length}곳: ${mono.map((r) => r.name).join(", ")}`);
    console.log(`가동률 두 출처(게토 vs 매출DB) 대조 n=${both.length}: 평균차 ${(mean(diff) * 100).toFixed(2)}% · 중앙 ${(median(diff) * 100).toFixed(2)}%`);
    console.log(`  -> 사실상 같은 값이라 화면(실험실)은 파이어스토어에 이미 있는 매출DB 쪽을 쓴다.`);
    expect(rows.length).toBeGreaterThan(25);
    // 두 출처가 5% 넘게 벌어지면 둘 중 하나가 깨진 것이다.
    expect(mean(diff)).toBeLessThan(0.05);
  });

  it("총단가 — 환산층이 필요로 하는 유일한 숫자", () => {
    const u = rows.map((r) => r.unitPrice);
    const sd = Math.sqrt(mean(u.map((v) => (v - mean(u)) ** 2)));
    console.log(`\n총단가 = 총매출 ÷ (PC x 720 x 실측가동률)`);
    console.log(`  중앙 ${median(u).toFixed(0)}원 · 기하평균 ${gmean(u).toFixed(0)}원 · 범위 ${Math.min(...u).toFixed(0)}~${Math.max(...u).toFixed(0)} · 변동계수 ${(sd / mean(u) * 100).toFixed(1)}%`);
    console.log(`  (건별 원장 독립 검증 2026-09-16: 광주첨단 2,682원 · 발산역 2,984원 — 같은 범위다)`);
    console.log(`\n독점 3곳 — 여기가 서로 벌어진 만큼이 환산층 오차의 바닥이다`);
    for (const r of mono) console.log(`  ${r.name.padEnd(12)} 총단가 ${r.unitPrice.toFixed(0).padStart(6)}원 · 정가 ${String(r.listRate).padStart(5)}원 · 실효단가 ${r.effRate.toFixed(0).padStart(5)}원 (정가의 ${(r.effRate / r.listRate * 100).toFixed(0)}%)`);
    const g = gmean(mono.map((r) => r.unitPrice));
    console.log(`  독점 기하평균 ${g.toFixed(0)}원 -> 상수로 쓰면 최대오차 ${(Math.max(...mono.map((r) => Math.abs(g / r.unitPrice - 1))) * 100).toFixed(1)}%`);
    expect(u.length).toBeGreaterThan(25);
  });

  it("덧셈 구조 — 정가는 PC몫에만 걸린다", () => {
    // 2026-09-16 저녁(3) 채택 구조:
    //   총단가 = PC몫 + 상품몫,  PC몫 = 기준정가 x (정가/기준정가)^β,  상품몫 = 상수
    // 상품몫은 독점 실매출에서 PC몫을 **빼서** 구한다(화면 fitProductUnitPrice와 같은 방식).
    const REF = 1343, BETA = 0.546;   // 운영 산식 usageRevenue.ts effectiveHourlyRate와 같은 값
    const pcUnit = (r: Row, b = BETA) => REF * Math.pow(r.listRate / REF, b);
    const k = gmean(rows.map((r) => r.pcUnitPrice / pcUnit(r)));
    console.log(`\nPC몫 = ${REF} x (정가/${REF})^${BETA} — 운영 산식 effectiveHourlyRate와 같은 식`);
    console.log(`  실측 PC몫 ÷ 이 식 = ${k.toFixed(3)} (기하평균) -> 축척을 따로 둘 필요가 없다`);
    console.log(`  이 식이 실측 PC몫을 맞히는 정도: MAPE ${(mean(rows.map((r) => Math.abs(pcUnit(r) / r.pcUnitPrice - 1))) * 100).toFixed(2)}%`);

    function score(label: string, unit: (r: Row) => number) {
      const err = rows.map((r) => Math.abs(unit(r) / r.unitPrice - 1));
      const me = mono.map((r) => Math.abs(unit(r) / r.unitPrice - 1));
      const s = [...err].sort((x, y) => x - y);
      console.log(`  ${label.padEnd(40)} 환산층 ${(mean(err) * 100).toFixed(2).padStart(6)}% · 중앙 ${(s[Math.floor(s.length / 2)] * 100).toFixed(1).padStart(5)}% · 최대 ${(s[s.length - 1] * 100).toFixed(0).padStart(3)}% · 독점최대 ${(Math.max(...me) * 100).toFixed(1).padStart(5)}%`);
    }
    console.log(`\n[구조 비교 — 축척은 전부 독점 실매출에 맞춘다]`);
    const S = mean(mono.map((r) => r.unitPrice - pcUnit(r)));
    score(`덧셈(채택): PC몫 + 상품몫 ${S.toFixed(0)}원`, (r) => pcUnit(r) + S);
    const ref2 = median(rows.map((r) => r.listRate));
    const T0 = gmean(mono.map((r) => r.unitPrice / Math.pow(r.listRate / ref2, BETA)));
    score(`곱셈(옛것): ${T0.toFixed(0)} x (정가/${ref2})^${BETA}`, (r) => T0 * Math.pow(r.listRate / ref2, BETA));
    const C = gmean(mono.map((r) => r.unitPrice));
    score(`요금 무시: 총단가 ${C.toFixed(0)}원 상수`, () => C);

    console.log(`\n[요금을 올리면 총단가가 얼마나 오르나 — 구조가 여기서 갈린다]`);
    console.log(`${"정가".padStart(8)}${"덧셈(채택)".padStart(13)}${"곱셈(옛것)".padStart(13)}`);
    for (const p of [1000, 1400, 1800]) {
      const add = REF * Math.pow(p / REF, BETA) + S;
      const mul = T0 * Math.pow(p / ref2, BETA);
      console.log(`${(p + "원").padStart(8)}${(Math.round(add).toLocaleString() + "원").padStart(13)}${(Math.round(mul).toLocaleString() + "원").padStart(13)}`);
    }
    const a = (REF * Math.pow(1800 / REF, BETA) + S) / (REF * Math.pow(1000 / REF, BETA) + S) - 1;
    const m = Math.pow(1800 / 1000, BETA) - 1;
    console.log(`  정가 1,000 -> 1,800원(+80%)일 때 총단가 상승: 덧셈 +${(a * 100).toFixed(0)}% · 곱셈 +${(m * 100).toFixed(0)}%`);
    console.log(`  곱셈은 상품매출까지 정가를 따라 올린다 — 라면 값은 PC요금을 안 따라가므로 틀린 동작이다.`);
    console.log(`  덧셈이 전체 MAPE는 조금 나쁘지만(정가가 상품몫과도 약하게 붙어 곱셈이 반칙 이득을 본다)`);
    console.log(`  구조가 옳고 독점 오차도 낮다. 2026-09-16 사용자 결정.`);
    expect(rows.length).toBeGreaterThan(25);
  });

  it("상품비율은 후보지에서 알 수 있는 값으로 설명되지 않는다", () => {
    const pr = rows.map((r) => r.prodRatio);
    const sd = Math.sqrt(mean(pr.map((v) => (v - mean(pr)) ** 2)));
    const sig = 2 / Math.sqrt(rows.length);
    const pearson = (xs: number[], ys: number[]) => {
      const mx = mean(xs), my = mean(ys);
      let a = 0, b = 0, c = 0;
      for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
      return a / Math.sqrt(b * c);
    };
    console.log(`\n상품비율 — 실측 중앙 ${median(pr).toFixed(3)} · 평균 ${mean(pr).toFixed(3)} · 변동계수 ${(sd / mean(pr) * 100).toFixed(1)}%`);
    console.log(`유의선 ${sig.toFixed(3)} (n=${rows.length})`);
    for (const [label, get] of [
      ["PC대수", (r: Row) => r.pc], ["정가요금", (r: Row) => r.listRate],
      ["가동률", (r: Row) => r.util], ["총매출", (r: Row) => r.total],
    ] as const) {
      const rr = pearson(rows.map(get), pr);
      console.log(`  ${label.padEnd(10)} r = ${rr.toFixed(3)}${Math.abs(rr) > sig ? " *" : ""}`);
    }
    console.log(`  -> 못 설명한다. 그래서 상품몫은 전 매장 같은 상수를 쓴다(상품비율은 이제 결과값이다).`);
    console.log(`  -> 건별 원장으로 본 실체: 정액권 손님이 시간당 296~663원(일반의 1/3)을 내고,`);
    console.log(`     그 시간 비중이 매장마다 2.1~9.1%다. 매장 운영 정책이라 후보지에선 알 수 없다.`);
    expect(pr.length).toBeGreaterThan(25);
  });
});
