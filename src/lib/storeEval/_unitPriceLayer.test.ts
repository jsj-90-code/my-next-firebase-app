// 단가층만 떼어내 매장별로 찍는다 — 정액 요금표를 받기 전 준비표 (2026-09-25). 읽기전용.
// 본체/운영/Firestore 미변경. **계수를 고르지 않는다.**
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 인계(docs/handoff-20260929.md 최종 블록) 다음 할 일 1번:
//   "정액 요금표를 받으면 자사 실효 단가를 정액제 이용 비중으로 다시 계산해
//    '실측 PC매출 ÷ 실측 PC시간'(원장 실효단가)과 대조. 가동률 오차와 매출 오차를 따로 찍는 표 먼저."
//
// 가동률·단가·매출 세 오차를 나란히 놓는 표는 `_utilizationVsRevenueView`에 이미 있다(항등식 확인 포함).
// 여기서는 그 **단가 오차 한 칸을 다시 둘로 가른다** — 매출DB에 PC매출과 상품매출이 따로 있기 때문이다.
//
//   실측 PC시간(월)     = 자사PC × 720 × 그 달 실측 가동률
//   실측 PC실효단가     = Σ PC매출 ÷ Σ PC시간          ← 원장 실효단가와 같은 정의 (매출DB 월합계로)
//   실측 상품단가       = Σ 상품매출 ÷ Σ PC시간
//   산식 PC몫           = 1,343 × (정가 ÷ 1,343)^0.546  ← textbookModel computeTextbook 끝(effRate)
//   산식 상품몫         = 1,493 (상수)
//
// **실효÷정가**가 이 표의 핵심 칸이다. 정가에서 정액제 할인이 빼고 좌석 추가요금이 더한 순효과라서,
// 정액 요금표를 받으면 "정액제 이용 비중 × 할인율"로 이 칸을 **설명**할 수 있어야 한다.
// 지금 β=0.546은 그 순효과를 정가 하나로 뭉뚱그려 맞춘 값이다(types.ts tariffEffectiveExponent 주석:
// 정가 1,000원 매장은 정가의 112%를 받고 1,800원 매장은 83%만 받는다).
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 창은 **개점 2~12개월차**(평가창 `evaluationMonths` 12달 중 첫 달을 뺀 11달)다.
//    저장된 `actualMonthlyRevenueAvg`가 그 창이다(calc.ts computeStabilizedPerformance: CUMULATIVE_AVERAGE_FROM_MONTH=2,
//    1개월차는 오픈 효과로 제외). 성적표의 실매출과 같은 창에서 단가를 재야 "단가 오차"가 같은 뜻이 된다.
//    ⚠️ `utilizationByStore`(가동률 평균)는 12달 전부를 쓴다 — 실매출(11달)과 창이 한 달 다르다. 여기서 고치지 않고 적어만 둔다.
//    처음엔 12달로 짰다가 관문에서 25곳이 1~14% 어긋나(송도 −14%: 첫 달이 낮다) 창을 맞췄다(2026-09-25).
// 2. 관문: 그 창 월합계(PC+상품)의 평균이 Firestore `actualMonthlyRevenueAvg`와 1% 안에서 맞아야 한다.
//    안 맞으면 창이 다른 것이니 아래 표를 믿지 않는다.
// 3. 가동률이 없거나 0인 달은 PC시간을 못 세니 그 달은 분자·분모 모두에서 뺀다(같은 달끼리).
// 4. 시간 가중(Σ÷Σ)이다 — 달별 단가의 단순평균이 아니다. 가동률이 낮은 개점 첫 달이 표를 흔들지 않게.
// 5. 판정 잣대는 두지 않는다. 이 표는 "무엇이 얼마나 틀렸나"를 요금표 받기 전에 찍어 두는 것이다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_unitPriceLayer.test.ts --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS } from "./textbookModel";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const MONTH_HOURS = 720;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

type Sale = { storeCode: string; yearMonth: string; pcSales?: number | null; productSales?: number | null; utilizationRate?: number | null };
type Store = {
  storeCode: string; storeName?: string | null; pcCount?: number | null; evaluationPcCount?: number | null;
  hourlyRate?: number | null; openedAt?: string | null; actualMonthlyRevenueAvg?: number | null;
  excludedFromModel?: boolean | null; excludedReason?: string | null;
};

type Row = {
  code: string; name: string; pc: number; rate: number; months: number;
  actU: number;              // 평가창 평균 가동률(단순평균 — utilizationByStore와 같은 정의)
  pcHours: number;           // Σ PC시간
  pcUnit: number;            // 실측 PC실효단가 = ΣPC매출 ÷ ΣPC시간
  prodUnit: number;          // 실측 상품단가
  totalUnit: number;         // 실측 총단가
  effOverList: number;       // 실효 ÷ 정가
  modelPc: number;           // 산식 PC몫
  modelProd: number;         // 산식 상품몫(1,493)
  pcErr: number;             // 산식PC몫 ÷ 실측PC단가 − 1
  prodErr: number;           // 1,493 ÷ 실측상품단가 − 1
  totalErr: number;          // 산식총단가 ÷ 실측총단가 − 1  (= _utilizationVsRevenueView의 단가 오차와 같은 뜻)
  pcShareOfErr: number;      // 총단가 오차(원) 중 PC몫이 차지하는 비중
  excluded: boolean;
  gateGap: number | null;    // 관문: 월합계 평균 ÷ actualMonthlyRevenueAvg − 1
};

describeIf("단가층 — PC몫·상품몫을 매장별로 실측과 대조 (요금표 전 준비표)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const sales: Sale[] = snap.sales ?? [];
  const stores: Store[] = snap.existingStores ?? [];
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const byCode = new Map<string, Sale[]>();
  for (const s of sales) byCode.set(s.storeCode, [...(byCode.get(s.storeCode) ?? []), s]);

  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const s of stores) {
    const pc = s.evaluationPcCount ?? s.pcCount ?? null;
    const rate = s.hourlyRate ?? null;
    const name = s.storeName ?? s.storeCode;
    // 개점 2~12개월차 = 평가창 첫 달을 뺀 11달. 2개월차 이후 자료가 하나도 없으면 저장 로직처럼 1개월차라도 쓴다.
    const evalMonths = evaluationMonths(s.openedAt ?? null);
    const all = (byCode.get(s.storeCode) ?? []);
    const from2 = new Set(evalMonths.slice(1));
    let ms = all.filter((m) => from2.has(m.yearMonth) && ((m.pcSales ?? 0) + (m.productSales ?? 0)) > 0);
    if (!ms.length) { const w = new Set(evalMonths); ms = all.filter((m) => w.has(m.yearMonth)); }
    if (!pc || !(pc > 0) || rate == null || !(rate > 0) || !ms.length) { skipped.push(`${name}(${!pc ? "PC수" : rate == null ? "정가" : "매출월"} 없음)`); continue; }
    // 관문용: 평가창 월합계(PC+상품) 평균 — utilizationRate 유무와 무관하게 전 달
    const totals = ms.map((m) => (m.pcSales ?? 0) + (m.productSales ?? 0)).filter((v) => v > 0);
    const gateGap = totals.length && s.actualMonthlyRevenueAvg ? mean(totals) / s.actualMonthlyRevenueAvg - 1 : null;
    // 단가용: 가동률 있는 달만, 분자·분모 같은 달
    let pcSum = 0, prodSum = 0, hours = 0; const us: number[] = [];
    for (const m of ms) {
      const u = m.utilizationRate;
      if (u == null || !(u > 0)) continue;
      if (!((m.pcSales ?? 0) > 0)) continue;
      pcSum += m.pcSales ?? 0; prodSum += m.productSales ?? 0; hours += pc * MONTH_HOURS * u; us.push(u);
    }
    if (!(hours > 0)) { skipped.push(`${name}(가동률 있는 달 없음)`); continue; }
    const pcUnit = pcSum / hours, prodUnit = prodSum / hours, totalUnit = pcUnit + prodUnit;
    const modelPc = P.referenceHourlyRate * Math.pow(rate / P.referenceHourlyRate, P.rateElasticity);
    const modelProd = P.productUnitPrice;
    const dPc = modelPc - pcUnit, dProd = modelProd - prodUnit;
    rows.push({
      code: s.storeCode, name, pc, rate, months: us.length, actU: mean(us), pcHours: hours,
      pcUnit, prodUnit, totalUnit, effOverList: pcUnit / rate,
      modelPc, modelProd, pcErr: modelPc / pcUnit - 1, prodErr: modelProd / prodUnit - 1,
      totalErr: (modelPc + modelProd) / totalUnit - 1,
      pcShareOfErr: Math.abs(dPc) + Math.abs(dProd) > 0 ? Math.abs(dPc) / (Math.abs(dPc) + Math.abs(dProd)) : 0,
      excluded: s.excludedFromModel === true, gateGap,
    });
  }
  const inc = rows.filter((r) => !r.excluded);

  it("(0) 관문 — 평가창 월합계 평균이 저장된 월평균 매출과 맞나", () => {
    const gaps = rows.filter((r) => r.gateGap != null).map((r) => ({ n: r.name, g: r.gateGap as number }));
    const worst = gaps.reduce((a, b) => (Math.abs(b.g) > Math.abs(a.g) ? b : a), gaps[0]);
    console.log(`\n[관문] 개점 2~12개월차 월합계 평균 ÷ actualMonthlyRevenueAvg − 1`);
    console.log(`  n=${gaps.length} · 최대 어긋남 ${pct(worst.g, 2)} (${worst.n}) · 1% 넘는 곳 ${gaps.filter((g) => Math.abs(g.g) > 0.01).length}곳`);
    for (const g of gaps.filter((g) => Math.abs(g.g) > 0.01)) console.log(`    ${pad(g.n, 12)} ${pct(g.g, 2)}`);
    if (skipped.length) console.log(`  뺀 매장: ${skipped.join(" · ")}`);
    console.log(`  → 1% 안이면 아래 표의 실측 단가가 화면·성적표와 **같은 창**에서 나온 것이다.`);
    expect(Math.abs(worst.g)).toBeLessThan(0.01);
  });

  it("(1) 매장별 단가층 표 — 정가 · 실효÷정가 · PC몫 오차 · 상품몫 오차", () => {
    const sorted = [...rows].sort((a, b) => a.rate - b.rate || a.effOverList - b.effOverList);
    console.log(`\n[매장별 단가층] 실측 = 평가창 Σ매출 ÷ Σ(PC×720×가동률). 산식 PC몫 = 1,343×(정가/1,343)^0.546 · 상품몫 1,493 상수. 오차 = 산식÷실측 − 1 (+면 산식이 높다)`);
    console.log(`  ${pad("매장", 12)} ${padL("PC", 4)} ${padL("정가", 6)} ${padL("달", 3)} ${padL("가동률", 6)} | ${padL("실측PC", 7)} ${padL("실효÷정가", 8)} ${padL("산식PC", 7)} ${padL("PC오차", 7)} | ${padL("실측상품", 8)} ${padL("상품오차", 8)} | ${padL("총단가", 7)} ${padL("총오차", 7)} ${padL("PC몫비중", 8)}`);
    for (const r of sorted) {
      const tag = r.excluded ? " (모델 제외·참고)" : "";
      console.log(`  ${pad(r.name, 12)} ${padL(String(r.pc), 4)} ${padL(won(r.rate), 6)} ${padL(String(r.months), 3)} ${padL((r.actU * 100).toFixed(1) + "%", 6)} | ${padL(won(r.pcUnit), 7)} ${padL((r.effOverList * 100).toFixed(0) + "%", 8)} ${padL(won(r.modelPc), 7)} ${padL(pct(r.pcErr), 7)} | ${padL(won(r.prodUnit), 8)} ${padL(pct(r.prodErr), 8)} | ${padL(won(r.totalUnit), 7)} ${padL(pct(r.totalErr), 7)} ${padL((r.pcShareOfErr * 100).toFixed(0) + "%", 8)}${tag}`);
    }
    console.log(`  ⭐ 읽는 법 — "실효÷정가"가 정액 요금표로 설명해야 하는 칸이다. 같은 정가에서 이 비율이 크게 다르면 정가가 아닌 것(정액제 비중·좌석 추가요금)이 단가를 움직이고 있다.`);
    console.log(`     "PC몫비중"은 총단가 오차(원) 중 PC몫이 차지하는 몫 — 높으면 요금표가 고칠 수 있는 오차, 낮으면 상품몫(상수 1,493) 쪽 문제다.`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(2) 요약 — 두 층의 오차 크기와 정가와의 관계", () => {
    const rates = inc.map((r) => r.rate);
    const eff = inc.map((r) => r.effOverList);
    console.log(`\n[요약 — 모델 포함 ${inc.length}곳]`);
    console.log(`  실측 PC실효단가  중앙 ${won(median(inc.map((r) => r.pcUnit)))}원 · 범위 ${won(Math.min(...inc.map((r) => r.pcUnit)))}~${won(Math.max(...inc.map((r) => r.pcUnit)))}`);
    console.log(`  실측 상품단가    중앙 ${won(median(inc.map((r) => r.prodUnit)))}원 · 범위 ${won(Math.min(...inc.map((r) => r.prodUnit)))}~${won(Math.max(...inc.map((r) => r.prodUnit)))}  (산식 상수 1,493)`);
    console.log(`  실측 총단가      중앙 ${won(median(inc.map((r) => r.totalUnit)))}원`);
    console.log(`  실효÷정가        중앙 ${(median(eff) * 100).toFixed(0)}% · 범위 ${(Math.min(...eff) * 100).toFixed(0)}~${(Math.max(...eff) * 100).toFixed(0)}% · 정가와 r=${corr(rates, eff).toFixed(3)}`);
    const absPc = inc.map((r) => Math.abs(r.pcErr)), absProd = inc.map((r) => Math.abs(r.prodErr)), absTot = inc.map((r) => Math.abs(r.totalErr));
    console.log(`\n  |오차| 평균   PC몫 ${pct(mean(absPc))} · 상품몫 ${pct(mean(absProd))} · 총단가 ${pct(mean(absTot))}`);
    console.log(`  편향(평균)     PC몫 ${pct(mean(inc.map((r) => r.pcErr)))} · 상품몫 ${pct(mean(inc.map((r) => r.prodErr)))} · 총단가 ${pct(mean(inc.map((r) => r.totalErr)))}`);
    console.log(`  총단가 오차(원) 중 PC몫 비중  평균 ${(mean(inc.map((r) => r.pcShareOfErr)) * 100).toFixed(0)}%`);
    console.log(`  PC몫 오차 vs 정가   r=${corr(rates, inc.map((r) => r.pcErr)).toFixed(3)}   ← 0에 가까우면 β가 정가 기울기는 맞췄고 남은 건 매장별 사정(정액제 비중)`);
    console.log(`  상품몫 오차 vs 정가 r=${corr(rates, inc.map((r) => r.prodErr)).toFixed(3)}`);
    console.log(`  상품몫 오차 vs 가동률 r=${corr(inc.map((r) => r.actU), inc.map((r) => r.prodErr)).toFixed(3)}   ← 음수면 바쁜 매장이 시간당 먹거리를 더 판다(상수가 놓치는 것)`);
    console.log(`  PC몫 오차 vs 상품몫 오차 r=${corr(inc.map((r) => r.pcErr), inc.map((r) => r.prodErr)).toFixed(3)}`);
    // 정가 묶음별 실효÷정가 — 같은 정가 안에서 얼마나 흩어지나
    const groups = new Map<number, Row[]>();
    for (const r of inc) groups.set(r.rate, [...(groups.get(r.rate) ?? []), r]);
    console.log(`\n  [정가별 실효÷정가] 같은 정가 안의 흩어짐이 곧 "정가로는 못 설명하는 몫"`);
    for (const [rate, rs] of [...groups].sort((a, b) => a[0] - b[0])) {
      const e = rs.map((r) => r.effOverList);
      console.log(`    ${padL(won(rate), 6)}원  ${padL(String(rs.length), 2)}곳  실효÷정가 중앙 ${(median(e) * 100).toFixed(0)}% · 범위 ${(Math.min(...e) * 100).toFixed(0)}~${(Math.max(...e) * 100).toFixed(0)}%  · 산식 PC몫 ${won(rs[0].modelPc)} vs 실측 중앙 ${won(median(rs.map((r) => r.pcUnit)))}`);
    }
    // 진단: 정가→실측PC단가 로그-로그 기울기(참고값 — 채택 아님)
    const lx = inc.map((r) => Math.log(r.rate)), ly = inc.map((r) => Math.log(r.pcUnit));
    const mx = mean(lx), my = mean(ly);
    const slope = lx.reduce((a, x, i) => a + (x - mx) * (ly[i] - my), 0) / lx.reduce((a, x) => a + (x - mx) ** 2, 0);
    const refImplied = Math.exp(my - slope * mx) ** (1 / (1 - slope)); // ref × (rate/ref)^β 형태로 환산한 기준점
    console.log(`\n  [참고 — 채택 아님] 정가→실측 PC단가 로그-로그 기울기 β̂=${slope.toFixed(3)} (지금 0.546) · 기준점 ${won(refImplied)}원 (지금 1,343)`);
    console.log(`  ⭐ 읽는 법 — 지금 β는 정가 하나로 정액제·좌석요금의 순효과를 뭉뚱그린 값이다. 요금표를 받으면 "정액제 이용 비중 × 할인율"이 실효÷정가를 매장별로 설명하는지가 다음 질문이다.`);
    console.log(`     그게 설명되면 β는 계수가 아니라 자료(요금표)에서 나오는 값이 된다. 판정은 가동률이지 이 층이 아니다 — 여기서 성적 좋은 변형을 고르지 말 것.`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(3) 요금표 받으면 채울 칸 — 매장별 실효÷정가 목록(정가 순)", () => {
    const sorted = [...inc].sort((a, b) => a.rate - b.rate || b.effOverList - a.effOverList);
    console.log(`\n[요금표 대조용 빈 칸] 매장 · 정가 · 실측 실효단가 · 실효÷정가 · [정액제 비중 ?] · [요금표 환산 실효단가 ?]`);
    for (const r of sorted) console.log(`  ${pad(r.name, 12)} ${padL(won(r.rate), 6)}  ${padL(won(r.pcUnit), 6)}  ${padL((r.effOverList * 100).toFixed(0) + "%", 5)}   ?      ?`);
    console.log(`  ⭐ 요금표가 오면 이 두 칸을 채우고 "요금표 환산 실효단가 ÷ 실측 실효단가"의 흩어짐이 지금 산식(PC오차 |평균| ${pct(mean(inc.map((r) => Math.abs(r.pcErr))))})보다 작은지 본다.`);
    expect(sorted.length).toBe(inc.length);
  });
});
