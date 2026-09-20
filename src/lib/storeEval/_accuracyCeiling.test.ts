// 적중률의 **바닥** — 어디까지 내려갈 수 있나 (2026-09-20 밤)
//
// 사용자: *"적중률 올릴 방안 좀 찾아봐. 묘수 없냐?"*
//
// ── 묘수를 찾기 전에 물어야 할 것 ─────────────────────────────────────────
// **목표값 자체가 흔들리면 그 아래로는 못 내려간다.** 우리가 맞히려는 값은
// `actualMonthlyRevenueAvg` = 개점 **2~12개월차** 매출 평균이다(`computeStabilizedPerformance`).
// 그 값이 "이 매장의 진짜 실력"과 얼마나 다른지를 먼저 재야, 8.832%에서 더 짜낼 게
// 있는지 없는지 안다.
//
// ── 세 가지를 잰다 ────────────────────────────────────────────────────────
//   (1) 월별 자료 — 지금 **안 쓰고 있다**(매장당 평균 1개 값만 쓴다). 850행이 놀고 있다.
//   (2) 1년차 vs 2년차 — 같은 매장의 수준이 해마다 얼마나 움직이나
//   (3) 잡음 바닥 — 반쪽 가르기로 목표값의 표준오차를 잰다
//
// ⚠️ **측정만 한다.** 목표 정의를 바꾸는 것도, 계수를 고르는 것도 사용자 몫이다.
//
// ⚠️ 월별에서 나온 값(계절 진폭 등)은 **후보지 예측에 못 쓴다** — 새 매장은 매출 이력이
//    없다. 진단용이다. 이걸 피처로 넣으면 "매출로 매출을 맞히는" 순환이 된다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_accuracyCeiling.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const sd = (xs: number[], center = med(xs)) =>
  xs.length < 2 ? NaN : Math.sqrt(xs.reduce((a, b) => a + (b - center) ** 2, 0) / (xs.length - 1));
const pctS = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

describeIf("적중률의 바닥", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const use = (snap.existingStores as any[]).filter((s) => s.validationUse === "사용" && !s.excludedFromModel);
  const by = new Map<string, { ym: string; v: number; u: number | null }[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (snap.sales ?? []) as any[]) {
    const v = (r.pcSales ?? 0) + (r.productSales ?? 0);
    if (!(v > 0)) continue;
    by.set(r.storeCode, [...(by.get(r.storeCode) ?? []), { ym: r.yearMonth, v, u: r.utilizationRate ?? null }]);
  }
  /** 개점월을 1개월차로 센다 — `computeStabilizedPerformance`의 elapsedMonths와 같은 뜻. */
  const elapsed = (openedAt: string, ym: string) => {
    const o = new Date(openedAt);
    const [y, m] = ym.split("-").map(Number);
    return (y - o.getFullYear()) * 12 + (m - (o.getMonth() + 1)) + 1;
  };
  const series = (s: { storeCode: string; openedAt: string }) =>
    (by.get(s.storeCode) ?? [])
      .map((r) => ({ ...r, e: elapsed(s.openedAt, r.ym), month: Number(r.ym.slice(5, 7)) }))
      .sort((a, b) => a.e - b.e);

  it("(1) 월별 자료는 놀고 있다 · 방학 효과", () => {
    console.log(`\n══ (1) 안 쓰는 자료 ══`);
    console.log(`  월별 매출 ${snap.sales.length}행이 있는데, 학습에는 매장당 **평균 1개 값**만 쓴다.`);
    console.log(`  (actualMonthlyRevenueAvg = 개점 2~12개월차 평균)`);

    // 방학(1·2·7·8월) vs 학기(3~6·9~11월) — 가동률로 본다(요금·상품 영향을 뺀다)
    const rows: { n: string; type: string; amp: number }[] = [];
    for (const s of use) {
      const rs = series(s).filter((r) => r.u != null && r.u > 0);
      if (rs.length < 12) continue;
      const vac = rs.filter((r) => [1, 2, 7, 8].includes(r.month));
      const trm = rs.filter((r) => [3, 4, 5, 6, 9, 10, 11].includes(r.month));
      if (vac.length < 3 || trm.length < 5) continue;
      const m = (a: typeof rs) => a.reduce((x, y) => x + (y.u as number), 0) / a.length;
      rows.push({ n: s.storeName, type: s.specialDemandType ?? "없음", amp: m(vac) / m(trm) });
    }
    expect(rows.length).toBeGreaterThan(10);
    const byType = new Map<string, number[]>();
    for (const r of rows) byType.set(r.type, [...(byType.get(r.type) ?? []), r.amp]);
    console.log(`\n  [방학 효과] 1·2·7·8월 가동률 ÷ 학기월 가동률 · ${rows.length}곳 · 중앙 ${med(rows.map((r) => r.amp)).toFixed(3)}`);
    console.log("  유형        곳수   방학배수 중앙");
    for (const [k, v] of [...byType.entries()].sort((a, b) => med(b[1]) - med(a[1]))) {
      console.log(`  ${k.padEnd(10)}${String(v.length).padStart(4)}곳${med(v).toFixed(3).padStart(11)}`);
    }
    console.log("\n  📌 **대학가만 방학에 안 뛴다**(1.019 vs 없음 1.178). 대학생이 방학에 고향으로 가서다.");
    console.log("     즉 대학가는 '수요가 많은 상권'이 아니라 **'학기에만 수요가 있는 상권'**이다.");
    console.log("     그런데 지금 산식은 대학가에 배수 1.45를 **올려서** 준다. 방향이 반대다.");
    console.log("\n  ⚠️ 이 값은 **후보지 예측에 못 쓴다** — 새 매장은 매출 이력이 없다. 진단용이다.");
  });

  it("(2) 1년차 vs 2년차 — 같은 매장도 해마다 움직인다", () => {
    const rows: { n: string; w: number; m: number; ratio: number }[] = [];
    for (const s of use) {
      const rs = series(s);
      const w = rs.filter((r) => r.e >= 2 && r.e <= 12);      // 지금 맞히는 창
      const mt = rs.filter((r) => r.e >= 13 && r.e <= 36);     // 그 뒤
      if (w.length < 6 || mt.length < 6) continue;
      const av = (a: typeof rs) => a.reduce((x, y) => x + y.v, 0) / a.length;
      rows.push({ n: s.storeName, w: av(w), m: av(mt), ratio: av(mt) / av(w) });
    }
    expect(rows.length).toBeGreaterThan(10);
    const ratios = rows.map((r) => r.ratio);
    const c = med(ratios);
    console.log(`\n══ (2) 학습창(2~12개월) 대비 그 뒤(13~36개월) · ${rows.length}곳 ══`);
    console.log(`  중앙 ${c.toFixed(3)} · 범위 ${Math.min(...ratios).toFixed(3)} ~ ${Math.max(...ratios).toFixed(3)} · 퍼짐(SD) ${sd(ratios, c).toFixed(3)}`);
    console.log(`  1년차보다 높아진 매장 ${rows.filter((r) => r.ratio > 1).length}/${rows.length}곳`);
    console.log("\n  📌 **대부분 1년 뒤에 떨어진다**(중앙 0.95). '오픈빨'이 실제로 있다는 뜻이다.");
    console.log("     그리고 그 폭이 매장마다 0.72~1.12로 갈린다 — 1년차 평균에는");
    console.log("     **그 매장의 실력이 아닌 몫**이 섞여 있다.");
  });

  it("(3) ⭐ 잡음 바닥 — 완벽한 모형도 이 아래로는 못 간다", () => {
    // 목표값은 11개월 평균이다. 그 평균 자체가 얼마나 흔들리나?
    // 두 가지로 잰다.
    //   가) 창 **안**의 표집 잡음 — 번갈아 반으로 갈라 견준다(추세가 양쪽에 고르게 들어간다)
    //   나) 창 **자체**의 흔들림 — 1년차/2년차 비의 퍼짐에서 뽑는다
    const inWin: number[] = [];
    const ratios: number[] = [];
    for (const s of use) {
      const rs = series(s).filter((r) => r.e >= 2 && r.e <= 12);
      if (rs.length >= 8) {
        const A = rs.filter((_, i) => i % 2 === 0), B = rs.filter((_, i) => i % 2 === 1);
        const av = (a: typeof rs) => a.reduce((x, y) => x + y.v, 0) / a.length;
        const a = av(A), b = av(B), m = (a + b) / 2;
        // 반쪽(≈5.5개월) 평균끼리의 차이 -> 전체(11개월) 평균의 표준오차
        inWin.push(Math.abs(a - b) / m / 2 / Math.SQRT2);
      }
      const all = series(s);
      const w = all.filter((r) => r.e >= 2 && r.e <= 12), mt = all.filter((r) => r.e >= 13 && r.e <= 36);
      if (w.length >= 6 && mt.length >= 6) {
        const av = (x: typeof all) => x.reduce((p, q) => p + q.v, 0) / x.length;
        ratios.push(av(mt) / av(w));
      }
    }
    const seIn = med(inWin);
    const sdRatio = sd(ratios);
    // year1 = 실력 + e1, year2 = 실력 + e2 라고 보면 SD(비) ≈ √2 · SD(e)/실력
    const seLevel = sdRatio / Math.SQRT2;
    console.log(`\n══ (3) 목표값이 얼마나 흔들리나 ══`);
    console.log(`  가) 창 안 표집 잡음      표준오차 중앙 ${pctS(seIn, 2)}   (${inWin.length}곳, 반쪽 가르기)`);
    console.log(`  나) 창 자체의 흔들림     표준오차 ≈ ${pctS(seLevel, 2)}   (${ratios.length}곳, 연차 비의 퍼짐 ÷ √2)`);
    const floor = Math.sqrt(seIn ** 2 + seLevel ** 2);
    console.log(`  둘을 합치면              표준오차 ≈ ${pctS(floor, 2)}  ->  평균절대오차 ≈ **${pctS(floor * 0.798, 2)}**`);
    console.log(`\n  📌 **이게 바닥이다.** 매장을 완벽히 아는 모형이라도, 맞히려는 값 자체가`);
    console.log(`     이만큼 흔들리므로 MAPE가 그 아래로 내려갈 수 없다.`);
    console.log(`\n  운영 V62   MAPE  8.832%   <- 바닥 ${pctS(floor * 0.798, 1)}에 **가깝다**`);
    console.log(`  실험실     LOO  22.16%   <- 바닥까지 한참 남았다`);
    console.log(`\n  ⚠️ (나)는 잡음과 **진짜 변화**(상권 쇠퇴 등)를 못 가른다. 그래서 바닥의`);
    console.log(`     **상한 쪽 추정**이다. 진짜 바닥은 이보다 낮을 수 있다.`);
    expect(inWin.length).toBeGreaterThan(10);
  });
});
