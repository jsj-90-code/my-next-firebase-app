// 먹거리 몫이 상권 유형마다 다른가 (2026-09-21)
//
// ── 어디서 나왔나 ─────────────────────────────────────────────────────────
// 야당점(-45.4%)·수원인계점(-38.5%)을 개별로 파다가 나왔다. 둘 다 단가층에서 산식이 낮게
// 보고 있었고(-14.9% / -8.1%), 그 대부분이 **상품몫**이었다(-23.5% / -9.6%).
// 유형별로 모아 보니 갈린다:
//
//   군부대 2,076 · 관광·유흥 1,953 · 기타 1,726 · 산업단지 1,495 · 없음 1,415 · 대학가 1,199
//   (원/PC·시간. 산식은 **상수 1,493원**이다)
//
// 뜻이 통한다 — 대학생은 먹거리를 덜 사고, 군인·유흥가 손님은 많이 산다.
// 그리고 **특수수요 유형은 후보지에도 있는 값**이라, QSC처럼 "후보지엔 없어서 못 쓴다"가
// 아니다. 채택되면 후보지 예측이 실제로 움직인다.
//
// ── 과녁을 무엇으로 두나 (여기가 설계의 핵심) ─────────────────────────────
// ⚠️ 상품몫(원/PC·시간)은 **가동률로 나눈 값**이다. 가동률이 틀리면 같이 틀린다. 그리고
//    가동률 오차는 지금 꼬리 매장에서 30~50%다. 그걸 과녁으로 쓰면 가동률 오차를 재게 된다.
//
// 그래서 **상품비중**(상품매출 ÷ 총매출)을 쓴다. 분자·분모가 같은 달 같은 매장이라
// **가동률이 약분된다.** PC수도, 영업시간도 약분된다. 순수한 구성비다.
//
// ⚠️ 다만 상품비중은 **정가에 딸려 온다** — PC요금이 비싸면 같은 먹거리를 팔아도 비중이
//    내려간다. 그래서 정가를 반드시 통제한다.
//
// ── 순환 확인 ─────────────────────────────────────────────────────────────
//   특수수요 유형 -> 단가 산식에 **안 들어간다**. 단가는 정가 하나로만 만든다
//   (pcUnitPrice = 기준정가 x (정가/기준정가)^β, 상품몫은 상수). 순환 없음.
//   특수수요 유형 -> 수요 배수에는 들어간다. 하지만 상품비중은 수요와 무관하다(구성비).
//
// ── 관문 (먼저 박는다. 결과를 보고 고치지 않는다) ─────────────────────────
//   관문 0  검정력 — 유형별 표본이 5곳 미만이면 그 유형은 **판정하지 않는다.**
//           지금 셀 수 있는 건 '대학가 5곳' vs '없음 22곳' 둘뿐이다.
//           군부대(2)·관광유흥(2)·산업단지(3)·기타(4)는 **표에만 찍고 판정 안 한다.**
//   관문 1  대학가 상품비중이 '없음'보다 낮나 — 순위합검정(Mann-Whitney) p<0.05.
//   관문 2  정가를 통제해도 남나 — 정가로 회귀한 잔차에서 다시 본다.
//   관문 3  무작위 대조군 — 유형 라벨을 섞어 같은 크기 무리를 2000번 뽑는다.
//           실제 차이가 섞은 분포의 5% 바깥이어야 한다.
//   관문 4  한 곳을 빼도 버티나 — 대학가 5곳을 하나씩 빼며 p를 다시 본다.
//
// ⚠️ **측정만 한다.** `productUnitPrice` 상수도 `specialDemandMultipliers`도 안 바꾼다.
//    채택하려면 LOO 홀드아웃이 따로 필요하다(이 파일은 안 한다).
//
// 실행:
//   npx vitest run src/lib/storeEval/_productShareByType.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** 개점 다음 달부터 12개월 — evaluationSalesPeriod와 같은 규칙. */
function evalMonths(openedAt: string | null): string[] {
  const m = openedAt?.match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (!m) return [];
  const start = Number(m[1]) * 12 + Number(m[2]) - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const mm = start + i + 1;
    return `${Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, "0")}`;
  });
}
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };

/** Mann-Whitney U 순위합검정 — 정규분포를 가정하지 않는다(n이 작아서). 양측 p를 정규근사로. */
function mannWhitney(a: number[], b: number[]) {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((p, q) => p.v - q.v);
  // 동순위는 평균 순위로
  const ranks = new Array(all.length).fill(0);
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let ra = 0;
  all.forEach((x, k) => { if (x.g === 0) ra += ranks[k]; });
  const na = a.length, nb = b.length;
  const ua = ra - (na * (na + 1)) / 2;
  const mu = (na * nb) / 2;
  const sd = Math.sqrt((na * nb * (na + nb + 1)) / 12);
  const z = sd > 0 ? (ua - mu) / sd : 0;
  // 양측 p — 표준정규 꼬리(Abramowitz-Stegun 근사)
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return { u: ua, z, p: Math.min(1, 2 * p) };
}

describeIf("먹거리 몫이 상권 유형마다 다른가", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const salesBy = new Map<string, Map<string, { pc: number; prod: number; util: number | null }>>();
  for (const r of (snap.sales ?? []) as Record<string, unknown>[]) {
    const code = r.storeCode as string, ym = r.yearMonth as string;
    if (!code || !ym) continue;
    const pc = (r.pcSales as number) ?? 0, prod = (r.productSales as number) ?? 0;
    if (!(pc + prod > 0)) continue;
    if (!salesBy.has(code)) salesBy.set(code, new Map());
    salesBy.get(code)!.set(ym, { pc, prod, util: (r.utilizationRate as number) ?? null });
  }

  type S = { name: string; type: string; rate: number; share: number; prodUnit: number | null; months: number };
  const xs: S[] = [];
  for (const st of (snap.existingStores ?? []) as Record<string, unknown>[]) {
    if (st.excludedFromModel === true) continue;
    const code = st.storeCode as string;
    const sv = salesBy.get(code);
    const rate = (st.hourlyRate as number) ?? 0;
    if (!sv || !(rate > 0)) continue;
    const ms = evalMonths((st.openedAt as string) ?? null).map((m) => sv.get(m)).filter((v): v is NonNullable<typeof v> => v != null);
    if (!ms.length) continue;
    const pc = ms.reduce((a, b) => a + b.pc, 0), prod = ms.reduce((a, b) => a + b.prod, 0);
    if (!(pc + prod > 0)) continue;
    const n = (st.evaluationPcCount as number) ?? (st.pcCount as number) ?? 0;
    const hrs = ms.reduce((a, b) => a + (b.util != null && b.util > 0 ? n * 720 * b.util : 0), 0);
    xs.push({
      name: (st.storeName as string) ?? code,
      type: (st.specialDemandType as string) ?? "없음",
      rate, share: prod / (pc + prod),
      prodUnit: hrs > 0 ? prod / hrs : null,
      months: ms.length,
    });
  }

  const byType = new Map<string, S[]>();
  for (const x of xs) byType.set(x.type, [...(byType.get(x.type) ?? []), x]);

  it("(0) 유형별 상품비중 — 판정 가능한 무리는 어디까지인가", () => {
    console.log(`\n[상품비중] 상품매출 ÷ 총매출 · 평가창 12개월 합계 · 가동률이 약분된다 · n=${xs.length}`);
    console.log("  유형        표본   비중중앙   비중평균   정가중앙   상품몫중앙   판정");
    for (const [t, v] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const pu = v.map((x) => x.prodUnit).filter((x): x is number => x != null);
      console.log(`  ${t.padEnd(10)}${String(v.length).padStart(4)}곳  ${(med(v.map((x) => x.share)) * 100).toFixed(1).padStart(7)}%  ` +
        `${(mean(v.map((x) => x.share)) * 100).toFixed(1).padStart(7)}%  ${med(v.map((x) => x.rate)).toLocaleString().padStart(7)}원  ` +
        `${pu.length ? Math.round(med(pu)).toLocaleString().padStart(8) + "원" : "       -"}   ${v.length >= 5 ? "가능" : "**표본 부족 — 판정 안 함**"}`);
    }
    console.log(`\n  관문 0 — 5곳 이상인 유형만 판정한다. 나머지는 표에만 남긴다.`);
    expect(xs.length).toBeGreaterThan(30);
  });

  it("(1)(2) 대학가 vs 없음 — 정가를 통제해도 남나", () => {
    const uni = byType.get("대학가") ?? [], non = byType.get("없음") ?? [];
    console.log(`\n[대학가 ${uni.length}곳 vs 없음 ${non.length}곳]`);
    console.log("  매장              유형     정가   상품비중");
    for (const x of [...uni, ...non].sort((a, b) => a.share - b.share)) {
      console.log(`  ${x.name.padEnd(16)}${x.type.padEnd(7)}${String(x.rate).padStart(6)}  ${(x.share * 100).toFixed(1).padStart(6)}%${x.type === "대학가" ? "  <<<" : ""}`);
    }
    const w = mannWhitney(uni.map((x) => x.share), non.map((x) => x.share));
    console.log(`\n  관문 1  날값     대학가 중앙 ${(med(uni.map((x) => x.share)) * 100).toFixed(1)}%  vs  없음 ${(med(non.map((x) => x.share)) * 100).toFixed(1)}%` +
      `   순위합 z=${w.z.toFixed(2)} p=${w.p.toFixed(4)}  ${w.p < 0.05 ? "**유의**" : "미달"}`);

    // 정가 통제 — 둘을 합친 판에서 상품비중을 정가로 회귀하고 잔차를 본다.
    const both = [...uni, ...non];
    const mx = mean(both.map((x) => x.rate)), my = mean(both.map((x) => x.share));
    let sxy = 0, sxx = 0;
    for (const x of both) { sxy += (x.rate - mx) * (x.share - my); sxx += (x.rate - mx) ** 2; }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const resid = (x: S) => x.share - (my + slope * (x.rate - mx));
    const w2 = mannWhitney(uni.map(resid), non.map(resid));
    console.log(`  관문 2  정가통제 기울기 ${(slope * 1e5).toFixed(2)}%p/1000원  ·  잔차 중앙 대학가 ${(med(uni.map(resid)) * 100).toFixed(2)}%p vs 없음 ${(med(non.map(resid)) * 100).toFixed(2)}%p` +
      `   z=${w2.z.toFixed(2)} p=${w2.p.toFixed(4)}  ${w2.p < 0.05 ? "**유의**" : "미달"}`);
    expect(uni.length).toBeGreaterThan(3);
  });

  it("(3) 무작위 대조군 — 라벨을 섞어도 같은 차이가 나오나", () => {
    const uni = byType.get("대학가") ?? [], non = byType.get("없음") ?? [];
    const pool = [...uni, ...non].map((x) => x.share);
    const k = uni.length;
    const obs = med(non.map((x) => x.share)) - med(uni.map((x) => x.share)); // 양수면 대학가가 낮다
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let ge = 0;
    const draws: number[] = [];
    for (let b = 0; b < 2000; b++) {
      const idx = [...pool.keys()];
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const g1 = idx.slice(0, k).map((i) => pool[i]), g2 = idx.slice(k).map((i) => pool[i]);
      const d = med(g2) - med(g1);
      draws.push(d);
      if (d >= obs) ge++;
    }
    draws.sort((a, b) => a - b);
    console.log(`\n[관문 3] 무작위 대조군 2000회 — 같은 크기(${k}곳) 무리를 섞어 뽑는다`);
    console.log(`  실제 차이 ${(obs * 100).toFixed(2)}%p  ·  섞으면 중앙 ${(draws[1000] * 100).toFixed(2)}%p · 95퍼센타일 ${(draws[1900] * 100).toFixed(2)}%p`);
    console.log(`  p(단측) = ${(ge / 2000).toFixed(4)}  ${ge / 2000 < 0.05 ? "**유의**" : "미달"}`);
    expect(pool.length).toBeGreaterThan(20);
  });

  it("(4) 한 곳을 빼도 버티나", () => {
    const uni = byType.get("대학가") ?? [], non = byType.get("없음") ?? [];
    console.log(`\n[관문 4] 대학가에서 한 곳씩 빼며 다시 본다`);
    console.log("  뺀 매장            남은수   대학가중앙   p");
    const base = mannWhitney(uni.map((x) => x.share), non.map((x) => x.share));
    console.log(`  ${"(안 뺌)".padEnd(18)}${String(uni.length).padStart(5)}   ${(med(uni.map((x) => x.share)) * 100).toFixed(1).padStart(7)}%   ${base.p.toFixed(4)}`);
    let worst = 0;
    for (const drop of uni) {
      const rest = uni.filter((x) => x !== drop);
      const w = mannWhitney(rest.map((x) => x.share), non.map((x) => x.share));
      worst = Math.max(worst, w.p);
      console.log(`  ${drop.name.padEnd(18)}${String(rest.length).padStart(5)}   ${(med(rest.map((x) => x.share)) * 100).toFixed(1).padStart(7)}%   ${w.p.toFixed(4)}${w.p >= 0.05 ? "  <- 무너짐" : ""}`);
    }
    console.log(`\n  최악 p = ${worst.toFixed(4)}  ${worst < 0.05 ? "**한 곳을 빼도 버틴다**" : "한 곳에 기대고 있다"}`);
    expect(uni.length).toBeGreaterThan(3);
  });
});
