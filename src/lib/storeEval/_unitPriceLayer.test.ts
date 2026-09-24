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

import { readFileSync } from "node:fs";
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

  // ── (3)(4) 정액 요금표 대조 (2026-09-25 새벽, 사용자가 키오스크 사진 37장 전달) ─────────────
  //
  // 요금표는 "충전 금액 → 이용시간"이다. 구간별 시간당 단가 = 금액 ÷ 시간. 큰 권종이 싸다.
  // 매장의 실효단가는 손님이 어느 권종을 얼마나 사느냐(정액제 이용 비중)로 정해지는데 **그 비중은 자료에 없다.**
  // 그래서 요금표만으로는 실효단가가 [가장 싼 권종 단가, 가장 비싼 권종 단가] 사이 어딘가라는 것까지만 말할 수 있다.
  //
  // 사전 설계:
  //  a. 실측 PC실효단가가 그 구간 **안**이면 요금표가 설명 가능한 범위. **위**면 요금표 밖의 것(좌석 추가요금·상품권 매출 섞임 등),
  //     **아래**면 요금표 밖의 할인(이벤트·쿠폰·학생요금)이 있다는 뜻. 셋을 센다.
  //  b. 구간 안이면 "큰 권종 비중" s = (최고단가 − 실측) ÷ (최고단가 − 최저단가)를 **역산**해 찍는다 — 이건 계수가 아니라
  //     자료 간 정합성 확인용 수치다. 원장(권종별 결제)이 오면 그 값과 대조해야 한다.
  //  c. 매장 간 흩어짐을 요금표가 설명하나: 실측 PC단가와 (정가 · 10,000원권 단가 · 최저 권종 단가 · 권종 단가 평균)의 상관을 나란히 찍는다.
  //     정가보다 요금표 대표단가의 상관이 높으면 "실효÷정가의 흩어짐은 요금표 설계 차이"이고, 비슷하면 요금표가 아니라 **이용 비중**이 다른 것이다.
  //  d. 판정·채택 없음. 사실만.

  type Tier = { won: number; minutes: number; bonusMinutes?: number };
  type TariffStore = { code: string | null; name: string; listRate: number | null; tiers: Tier[]; student?: Tier[]; notes?: string; omitted?: string };
  const tariffPath = "src/lib/storeEval/data/tariffTables.json";
  type Surcharge = { name: string; paidGame: number | null; seatNote?: string };
  const tariff: { stores: TariffStore[]; surcharges?: Record<string, Surcharge> } = JSON.parse(readFileSync(tariffPath, "utf8"));
  const tariffByCode = new Map<string, TariffStore>();
  for (const t of tariff.stores) if (t.code && t.tiers.length) tariffByCode.set(t.code, t);
  // 유료게임 과금(원/시간) — 유료게임 이용 시간에만 정액권 위에 더 차감된다. 좌석과금은 사용자 지시로 분석에서 뺀다(기록만).
  const paidGameOf = (code: string): number | null | undefined => tariff.surcharges?.[code]?.paidGame;
  const tierRate = (t: Tier) => t.won / ((t.minutes + (t.bonusMinutes ?? 0)) / 60);

  type TRow = Row & {
    tiers: { won: number; rate: number }[];
    rMin: number; rMax: number; rMean: number; r10k: number | null; rBig: number; // rBig = 가장 큰 권종 단가
    where: "안" | "위" | "아래"; bigShare: number | null; // 역산 큰 권종 비중(구간 안일 때만)
    paidGame: number | null | undefined; // 유료게임 과금 원/시간 (0=없음·null=모름·undefined=표에 없음)
    gapAbove: number | null; // 위일 때 실측 − 최고 권종 단가(원/시간)
  };
  const trows: TRow[] = [];
  for (const r of inc) {
    const t = tariffByCode.get(r.code);
    if (!t || !t.tiers.length) continue;
    const tiers = [...t.tiers].sort((a, b) => a.won - b.won).map((x) => ({ won: x.won, rate: tierRate(x) }));
    const rates = tiers.map((x) => x.rate);
    const rMin = Math.min(...rates), rMax = Math.max(...rates), rMean = mean(rates);
    const r10k = tiers.find((x) => x.won === 10000)?.rate ?? null;
    const rBig = tiers[tiers.length - 1].rate;
    const where: TRow["where"] = r.pcUnit > rMax * 1.005 ? "위" : r.pcUnit < rMin * 0.995 ? "아래" : "안";
    const bigShare = where === "안" && rMax > rMin ? (rMax - r.pcUnit) / (rMax - rMin) : null;
    trows.push({ ...r, tiers, rMin, rMax, rMean, r10k, rBig, where, bigShare, paidGame: paidGameOf(r.code), gapAbove: where === "위" ? r.pcUnit - rMax : null });
  }

  it("(3) 요금표 — 매장별 권종 단가와 실측 실효단가의 위치", () => {
    console.log(`\n[정액 요금표 대조] 권종 단가 = 금액 ÷ 표시 시간(탕정역은 보너스 포함). 실측 = 평가창 ΣPC매출 ÷ ΣPC시간. n=${trows.length} (요금표 있는 모델 포함 매장)`);
    console.log(`  ${pad("매장", 12)} ${padL("정가", 5)} | ${padL("최소권", 6)} ${padL("1만권", 6)} ${padL("최대권", 6)} ${padL("최저", 5)}~${pad("최고", 5)} | ${padL("실측PC", 6)} ${padL("실효÷정가", 8)} ${pad("위치", 3)} ${padL("큰권종비중", 8)} ${padL("유료게임", 6)} | 비고`);
    for (const r of [...trows].sort((a, b) => a.rate - b.rate || a.effOverList - b.effOverList)) {
      const small = r.tiers[0], big = r.tiers[r.tiers.length - 1];
      const t = tariffByCode.get(r.code)!;
      const note = [t.notes, t.omitted ? `(누락: ${t.omitted})` : null].filter(Boolean).join(" · ");
      console.log(`  ${pad(r.name, 12)} ${padL(won(r.rate), 5)} | ${padL(`${won(small.won / 1000)}천→${won(small.rate)}`, 6)} ${padL(r.r10k != null ? won(r.r10k) : "-", 6)} ${padL(`${won(big.won / 10000)}만→${won(big.rate)}`, 6)} ${padL(won(r.rMin), 5)}~${pad(won(r.rMax), 5)} | ${padL(won(r.pcUnit), 6)} ${padL((r.effOverList * 100).toFixed(0) + "%", 8)} ${pad(r.where, 3)} ${padL(r.bigShare != null ? (r.bigShare * 100).toFixed(0) + "%" : "-", 8)} ${padL(r.paidGame == null ? "-" : won(r.paidGame), 6)} | ${note}`);
    }
    const cnt = (w: TRow["where"]) => trows.filter((r) => r.where === w).length;
    console.log(`  위치 — 구간 안 ${cnt("안")}곳 · 요금표 위(최고 권종 단가보다 높다) ${cnt("위")}곳 · 요금표 아래(최저 권종보다 낮다) ${cnt("아래")}곳`);
    // 위 매장 — 초과분을 유료게임 과금으로 덮을 수 있나. 유료게임은 이용 시간의 일부에만 붙으니 "전 시간 유료게임"이 상한이다.
    const above = trows.filter((r) => r.where === "위").sort((a, b) => (b.gapAbove ?? 0) - (a.gapAbove ?? 0));
    console.log(`\n  [요금표 위 ${above.length}곳 — 초과분(실측 − 최고 권종 단가) vs 유료게임 과금(원/시간)] 유료게임은 유료게임 시간에만 붙으니 과금액이 초과분의 **상한**이다. 초과분 > 과금이면 유료게임으로는 못 덮는다`);
    console.log(`  ${pad("매장", 12)} ${padL("정가", 5)} ${padL("최고권종", 7)} ${padL("실측", 6)} ${padL("초과", 5)} ${padL("유료게임", 7)}  판정`);
    for (const r of above) {
      const pg = r.paidGame;
      const verdict = pg == null ? (pg === null ? "유료게임 모름(칸 비어 있음)" : "표에 없음")
        : pg === 0 ? "유료게임 없음 → 요금표·유료게임 밖(좌석과금·비회원·pcSales 정의)"
        : (r.gapAbove ?? 0) <= pg ? `유료게임 전 시간이면 덮임(필요 비중 ${(((r.gapAbove ?? 0) / pg) * 100).toFixed(0)}%)` : `유료게임 100%여도 ${won((r.gapAbove ?? 0) - pg)}원 남음`;
      console.log(`  ${pad(r.name, 12)} ${padL(won(r.rate), 5)} ${padL(won(r.rMax), 7)} ${padL(won(r.pcUnit), 6)} ${padL("+" + won(r.gapAbove ?? 0), 5)} ${padL(pg == null ? "-" : won(pg), 7)}  ${verdict}`);
    }
    const noPg = above.filter((r) => r.paidGame === 0).length, unkPg = above.filter((r) => r.paidGame == null).length;
    console.log(`  → 위 ${above.length}곳 중 유료게임 없음 ${noPg}곳 · 모름 ${unkPg}곳. 유료게임 없음인데 위인 매장은 요금표와 유료게임 둘 다로 설명이 안 된다 — 좌석과금(분석 제외)·비회원 요금·pcSales 정의 중 하나다.`);
    console.log(`  ⭐ 읽는 법 — "최고"는 보통 가장 작은 권종(≈정가)이고 "최저"는 가장 큰 권종이다. 실측이 구간 안이면 요금표로 설명되는 범위이고, 큰권종비중은 그 위치를 역산한 값(원장 권종별 결제로 검증할 것).`);
    console.log(`     "위"는 요금표의 어떤 권종보다도 시간당 더 받았다는 뜻 — 좌석 추가요금(VIP·팀룸)이나 PC매출에 상품권(넥슨캐시 등) 매출이 섞였을 가능성. 매출DB pcSales의 정의를 확인해야 한다.`);
    expect(trows.length).toBeGreaterThan(20);
  });

  it("(4) 요금표 — 매장 간 실효단가 흩어짐을 요금표가 설명하나 (상관 나란히)", () => {
    const y = trows.map((r) => r.pcUnit);
    const withTen = trows.filter((r) => r.r10k != null);
    console.log(`\n[실측 PC실효단가와의 상관 — n=${trows.length}]`);
    console.log(`  정가(hourlyRate)              r=${corr(trows.map((r) => r.rate), y).toFixed(3)}`);
    console.log(`  산식 PC몫(정가^β)             r=${corr(trows.map((r) => r.modelPc), y).toFixed(3)}`);
    console.log(`  요금표 최고 권종 단가(최소권)   r=${corr(trows.map((r) => r.rMax), y).toFixed(3)}`);
    console.log(`  요금표 10,000원권 단가         r=${corr(withTen.map((r) => r.r10k as number), withTen.map((r) => r.pcUnit)).toFixed(3)}  (n=${withTen.length})`);
    console.log(`  요금표 최저 권종 단가(최대권)   r=${corr(trows.map((r) => r.rMin), y).toFixed(3)}`);
    console.log(`  요금표 권종 단가 평균           r=${corr(trows.map((r) => r.rMean), y).toFixed(3)}`);
    // 정가 대비 요금표가 얼마나 깎이나 — 매장별 할인 설계의 차이
    const disc10 = withTen.map((r) => (r.r10k as number) / r.rate), discBig = trows.map((r) => r.rMin / r.rate);
    console.log(`\n[요금표 설계 — 정가 대비 권종 단가] 10,000원권÷정가 중앙 ${(median(disc10) * 100).toFixed(0)}% (범위 ${(Math.min(...disc10) * 100).toFixed(0)}~${(Math.max(...disc10) * 100).toFixed(0)}%) · 최대권÷정가 중앙 ${(median(discBig) * 100).toFixed(0)}% (범위 ${(Math.min(...discBig) * 100).toFixed(0)}~${(Math.max(...discBig) * 100).toFixed(0)}%)`);
    console.log(`  실측 실효÷정가 중앙 ${(median(trows.map((r) => r.effOverList)) * 100).toFixed(0)}% — 이 값이 10,000원권÷정가(중앙 ${(median(disc10) * 100).toFixed(0)}%) 근처면 "손님 평균은 1만원권 근처를 산다"는 뜻`);
    // 실효÷정가 흩어짐(매장별) vs 요금표 할인 설계(10,000원권÷정가)
    console.log(`  실효÷정가 vs 10,000원권÷정가   r=${corr(withTen.map((r) => r.effOverList), disc10).toFixed(3)}   ← 높으면 실효÷정가의 흩어짐이 요금표 설계 차이, 낮으면 이용 비중 차이`);
    console.log(`  실효÷정가 vs 최대권÷정가       r=${corr(trows.map((r) => r.effOverList), discBig).toFixed(3)}`);
    // 정가 묶음 안에서 요금표가 갈라 주나 — 1,500원 매장
    const g1500 = trows.filter((r) => r.rate === 1500).sort((a, b) => a.effOverList - b.effOverList);
    if (g1500.length >= 4) {
      console.log(`\n[정가 1,500원 ${g1500.length}곳 — 실효÷정가 순] 요금표가 같은 정가 안의 흩어짐을 가르나`);
      for (const r of g1500) console.log(`    ${pad(r.name, 12)} 실효÷정가 ${(r.effOverList * 100).toFixed(0)}% · 실측 ${won(r.pcUnit)} | 1만권 ${r.r10k != null ? won(r.r10k) : "-"} · 최대권 ${won(r.rMin)} · 위치 ${r.where}${r.bigShare != null ? ` · 큰권종비중 ${(r.bigShare * 100).toFixed(0)}%` : ""}`);
      console.log(`    1,500원 안에서 실효÷정가 vs 1만권 단가 r=${corr(g1500.filter((r) => r.r10k != null).map((r) => r.effOverList), g1500.filter((r) => r.r10k != null).map((r) => r.r10k as number)).toFixed(3)}`);
    }
    console.log(`  ⭐ 읽는 법 — 요금표는 '정가 → 실효단가'의 **틀**(할인 구간)을 주고, 손님이 그 틀 안 어디에 앉는지(권종 비중)는 원장이 준다. 둘 중 무엇이 매장 차이를 만드는지가 이 절의 질문이다.`);
    console.log(`     β 0.546은 이 둘을 정가 하나로 뭉뚱그린 값이다. 요금표 상관이 정가 상관과 다르지 않으면 "요금표를 산식에 넣어도 정가와 같은 정보"라는 뜻이니 넣을 이유가 없다.`);
    expect(trows.length).toBeGreaterThan(20);
  });

  // ── (5) 재고 표 — 단가층 입력을 정가에서 요금표 값으로 바꾸면 (2026-09-25 새벽, 사용자 답 뒤) ─────────
  //
  // 사용자 답(2026-09-25): 권종별 결제 건수 **없음**(큰권종비중 검증 불가) · pcSales에 상품권 판매 **들어가지만 거의 영향 없음** ·
  // hourlyRate("요금표_시간당원" 칸)가 무엇을 적은 값인지는 사용자도 특정 못 함.
  //
  // 그래서 여기서는 **자료가 있는 것만으로** 단가층 입력 변형을 나란히 잰다. 가동률은 한 글자도 안 움직인다 — PC몫만 바뀐다.
  //   지금   PC몫 = 1,343 × (정가 ÷ 1,343)^0.546                      ← 정가 + 계수 둘(β·기준점)
  //   A      PC몫 = 요금표 10,000원권 단가 그대로                        ← 계수 0 (자료가 곧 값)
  //   B      PC몫 = 요금표 권종 단가 평균 그대로                          ← 계수 0
  //   C      PC몫 = 1,343 × (회원 기본요금(최소권 단가) ÷ 1,343)^0.546   ← hourlyRate를 키오스크 값으로 정정했을 때의 효과. 계수는 지금 것
  //   D      PC몫 = 10,000원권 단가 × k, k = 실측÷1만권 중앙값(LOO)     ← 계수 하나. 수준만 맞추는 것 — A와 비교해 "수준 오차"와 "순서 오차"를 가른다
  // 성적: PC몫 |오차| 평균 · 편향 · 최악 | 총단가(PC몫+1,493) |오차| 평균 | 실측 가동률에서의 매출 |오차| 평균(환산층만의 MAPE).
  // 채택은 여기서 안 한다 — 재고 표 + 추천 후 사용자 결정. **A가 지금보다 좋으면 "요금표 값을 정가 대신 넣자"가 추천이 된다.**

  it("(5) 재고 표 — 정가 vs 요금표 값을 PC몫 입력으로 (가동률 무변경)", () => {
    const withTen = trows.filter((r) => r.r10k != null);
    type Variant = { name: string; pc: (r: TRow, i: number) => number | null; coefs: string };
    const kLoo = (i: number) => median(withTen.filter((_, k) => k !== i).map((r) => r.pcUnit / (r.r10k as number)));
    const variants: Variant[] = [
      { name: "지금 (정가^β)", pc: (r) => r.modelPc, coefs: "β 0.546 · 기준 1,343" },
      { name: "A 1만원권 단가", pc: (r) => r.r10k, coefs: "0" },
      { name: "B 권종 단가 평균", pc: (r) => r.rMean, coefs: "0" },
      { name: "C 회원기본요금^β", pc: (r) => P.referenceHourlyRate * Math.pow(r.rMax / P.referenceHourlyRate, P.rateElasticity), coefs: "β 0.546 · 기준 1,343 (정가만 교체)" },
      { name: "D 1만원권 × k(LOO)", pc: (r, i) => (r.r10k as number) * kLoo(i), coefs: "k 하나 (중앙값)" },
    ];
    console.log(`\n[재고 표 — PC몫 입력 변형, 요금표 있는 ${withTen.length}곳에서 같은 매장끼리] 오차 = 산식÷실측 − 1. 가동률은 무변경(이 층은 매출 환산만)`);
    console.log(`  ${pad("변형", 20)} ${padL("PC몫|오차|", 9)} ${padL("편향", 6)} ${padL("최악", 6)} ${padL("±10%안", 6)} | ${padL("총단가|오차|", 10)} | ${padL("매출|오차|", 9)} ${padL("(실측가동률)", 10)} | 계수`);
    const perStore = new Map<string, Record<string, number>>();
    for (const v of variants) {
      const pcErr: number[] = [], totErr: number[] = [], revErr: number[] = [];
      withTen.forEach((r, i) => {
        const pc = v.pc(r, i);
        if (pc == null) return;
        const e = pc / r.pcUnit - 1; pcErr.push(e);
        const tot = (pc + P.productUnitPrice) / r.totalUnit - 1; totErr.push(tot);
        revErr.push(tot); // 실측 가동률에서 매출 오차 = 총단가 오차 (PC시간이 같으니)
        perStore.set(r.name, { ...(perStore.get(r.name) ?? {}), [v.name]: e });
      });
      const worst = pcErr.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
      console.log(`  ${pad(v.name, 20)} ${padL(pct(mean(pcErr.map(Math.abs))), 9)} ${padL(pct(mean(pcErr)), 6)} ${padL(pct(worst), 6)} ${padL(`${pcErr.filter((e) => Math.abs(e) <= 0.10).length}/${pcErr.length}`, 6)} | ${padL(pct(mean(totErr.map(Math.abs))), 10)} | ${padL(pct(mean(revErr.map(Math.abs))), 9)} ${padL("", 10)} | ${v.coefs}`);
    }
    console.log(`\n  [매장별 PC몫 오차 — 지금 vs A(1만원권) vs D(1만원권×k)] 실효÷정가 순. 지금보다 |오차| 작으면 ✓`);
    let betterA = 0, betterD = 0;
    for (const r of [...withTen].sort((a, b) => a.effOverList - b.effOverList)) {
      const e = perStore.get(r.name)!; const now = e["지금 (정가^β)"], a = e["A 1만원권 단가"], d = e["D 1만원권 × k(LOO)"];
      const okA = Math.abs(a) < Math.abs(now); if (okA) betterA++;
      const okD = Math.abs(d) < Math.abs(now); if (okD) betterD++;
      console.log(`    ${pad(r.name, 12)} 실효÷정가 ${padL((r.effOverList * 100).toFixed(0) + "%", 4)} · 실측 ${padL(won(r.pcUnit), 5)} | 지금 ${padL(won(r.modelPc), 5)} ${padL(pct(now), 7)} | A ${padL(won(r.r10k as number), 5)} ${padL(pct(a), 7)}${okA ? "✓" : " "} | D ${padL(pct(d), 7)}${okD ? "✓" : " "}  위치 ${r.where}`);
    }
    console.log(`  지금보다 좋아진 매장 — A ${betterA}/${withTen.length} · D ${betterD}/${withTen.length}`);
    console.log(`  ⚠️ 총단가 |오차|가 A·B에서 지금보다 낮아 보이는 것은 **상쇄**다 — A의 PC몫 편향(−15.8%)이 상품몫 편향(+4.4%)과 반대여서 합이 덜 틀려 보인다. 층별로는 PC몫 |오차| 열을 봐야 한다(_utilizationVsRevenueView의 교훈과 같다).`);
    console.log(`  ⭐ 읽는 법 — A·B는 계수가 0이다(요금표 값이 곧 PC몫). 지금(계수 둘)보다 |오차|가 작으면 "정가 대신 요금표 값을 넣자"가 추천이 된다. D는 수준만 맞춘 것이라 A와의 차이가 곧 '수준 오차'다 —`);
    console.log(`     A의 편향이 크게 음수면 손님이 1만원권보다 비싼 권종을 산다는 뜻(요금표 위 매장이 절반이니 그럴 것). 그 편향까지 자료로 잡으려면 권종별 결제가 필요한데 **없다**(사용자 답) — 그러면 k 하나는 남는다.`);
    console.log(`     C는 hourlyRate를 키오스크 회원 기본요금으로 고쳤을 때 지금 산식이 얼마나 달라지나 — 정정 자체의 값어치.`);
    expect(withTen.length).toBeGreaterThan(20);
  });
});
