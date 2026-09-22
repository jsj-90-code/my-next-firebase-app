// 경쟁점도 좌석 천장이 있다 — 포화도에 따라 잠식이 달라지나 (2026-09-24)
//
// ── 사용자 설명 (2026-09-24) ──────────────────────────────────────────────
// *"덜 빠지는 경우는 이런 거지. 상권 수요가 되게 많아서 2순위 3순위 PC방도 가동률이
//   되게 잘 나와. 이러면 신규가 들어와도 좀 덜 빠지지. 왜냐면 **신규 매장에서 소화할 수
//   있는 수요가 천장이 있잖아.** 이런 경우가 있고, 아니면 신규라도 관리나 시설 뭐 이런
//   복합적인 부분에서 미비한 게 있는 등 기존 매장에서 메리트가 유지가 되면 좀 덜 빠지고."*
//
// ── 지금 산식은 이걸 모른다 ───────────────────────────────────────────────
//     점유율 = 자사PC ÷ (자사PC + 경쟁PC·품질·거리)
// 이 식은 수요를 **비율대로 쪼갠다.** 경쟁점이 그 수요를 물리적으로 소화할 수 있는지는
// 안 따진다. 그런데 경쟁점도 좌석이 유한하다 — `경쟁PC x 720 x 가동률 상한`까지가 끝이다.
//
// 수요가 총용량을 넘는 상권(포화 상권)에서는:
//   · 모두가 천장 가까이 돌아간다 -> 신규가 들어와도 자기 용량만큼만 가져간다
//   · 즉 **잠식이 비율보다 훨씬 작다** (탕정역에서 본 그 현상)
// 수요가 총용량보다 적은 상권에서는 비율 배분이 맞다.
//
// ── 이 파일이 재는 것 ─────────────────────────────────────────────────────
// (1) 포화도 = 동네 총수요 ÷ (자사+경쟁 총용량) 을 매장마다 낸다
// (2) 포화도가 높은 매장에서 산식이 **과소예측**하나 (그 기전이 맞다면 그래야 한다)
// (3) 천장을 넣은 대안 식이 지금보다 나은가 — ⛔ 재고 표만, 채택은 사용자 몫
//
// ⚠️ 측정만 한다. 운영 V62는 안 건드린다.
//
// 실행: npx vitest run src/lib/storeEval/_saturationShare.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
} from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN;
};
const MONTH_HOURS = 720;

describeIf("포화도 — 경쟁점도 좌석 천장이 있다", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  type Row = {
    name: string; act: number; pred: number;
    demandH: number; pc: number; rivalPc: number; rivalW: number;
    /** 포화도 = 동네 총수요 ÷ (자사+경쟁 총용량). 1을 넘으면 다 같이 꽉 찬다는 뜻. */
    sat: number;
    share: number;
  };
  const rows: Row[] = [];
  for (const r of base) {
    const act = r.input.actualUtilization;
    if (act == null || !(act > 0)) continue;
    const b = computeTextbook(r.input, P);
    const pc = r.input.pcCount ?? 0;
    if (b.utilization == null || !(b.utilization > 0) || b.totalDemandHours == null || b.share == null) continue;
    if (!(pc > 0)) continue;
    // 경쟁점 대수 — 거리무게로 깎아서 "우리 상권에 실제로 걸치는 용량"으로 본다.
    // (품질은 안 곱한다. 좌석 천장은 품질과 무관한 물리 제약이다.)
    let rivalPc = 0, rivalW = 0;
    for (const rv of r.input.rivals ?? []) {
      if (!(rv.ip > 0)) continue;
      const w = rivalDistanceWeight(rv.distanceM, P);
      if (w <= 0) continue;
      rivalPc += rv.ip * w;
      rivalW += rv.ip * w;
    }
    const capacity = (pc + rivalPc) * MONTH_HOURS;
    rows.push({
      name: r.input.storeName ?? r.input.storeCode, act, pred: b.utilization,
      demandH: b.totalDemandHours, pc, rivalPc, rivalW,
      sat: capacity > 0 ? b.totalDemandHours / capacity : NaN,
      share: b.share,
    });
  }

  it("(1) 포화도가 매장마다 얼마나 다른가", () => {
    const sats = rows.map((r) => r.sat).sort((a, b) => a - b);
    console.log(`\n[포화도] = 동네 총수요 ÷ (자사+경쟁 총용량) · n=${rows.length}`);
    console.log(`  1을 넘으면 "수요가 총좌석보다 많다"는 뜻 — 다 같이 꽉 찬다`);
    console.log(`  중앙 ${sats[Math.floor(sats.length / 2)].toFixed(3)}`
      + ` · 범위 ${sats[0].toFixed(3)}~${sats[sats.length - 1].toFixed(3)}`
      + ` · 1을 넘는 매장 ${rows.filter((r) => r.sat > 1).length}곳`);
    console.log(`\n  포화도 높은 5곳 / 낮은 5곳 (포화도 · 실측 · 예측 · 자사PC · 경쟁PC)`);
    const s = [...rows].sort((a, b) => b.sat - a.sat);
    for (const r of [...s.slice(0, 5), null, ...s.slice(-5)]) {
      if (!r) { console.log(`    ...`); continue; }
      console.log(`    ${r.name.padEnd(14)}${r.sat.toFixed(3).padStart(7)}`
        + `${(r.act * 100).toFixed(1).padStart(8)}%${(r.pred * 100).toFixed(1).padStart(8)}%`
        + `${String(r.pc).padStart(7)}${r.rivalPc.toFixed(0).padStart(8)}`);
    }
    console.log(`\n  ⚠️ 이 포화도는 **거친 값**이다 — 수요는 1km 원으로, 용량은 거리무게로 쟀다.`);
    console.log(`     두 자가 달라서 절대 수준보다 **매장 간 순서**를 보는 게 맞다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(2) ⭐⭐ 포화 상권에서 산식이 과소예측하나 — 사용자 기전의 검증", () => {
    // 기전이 맞다면: 포화도가 높을수록(수요가 좌석보다 많을수록) 실제로는 덜 빠지는데
    // 산식은 비율대로 깎으므로 **과소예측**해야 한다 -> 잔차 log(실측/예측)가 **양수**.
    const resid = rows.map((r) => Math.log(r.act / r.pred));
    const sat = rows.map((r) => Math.log(r.sat));
    console.log(`\n[검증] 잔차 = log(실측 ÷ 예측) · 양수 = 산식이 낮게 봤다(과소예측)`);
    console.log(`  포화도와 잔차의 상관 r = ${corr(sat, resid).toFixed(3)}   (유의선 ±0.31)`);
    console.log(`  ⭐ 기전이 맞다면 **양수**여야 한다 — 수요가 넘치는 곳에서 덜 빠지니까`);
    // 경쟁이 있는 매장만 — 독점에선 잠식 자체가 없어 기전이 작동할 자리가 아니다
    const withRiv = rows.map((r, i) => ({ r, i })).filter((x) => x.r.rivalPc > 0);
    if (withRiv.length > 10) {
      const s2 = withRiv.map((x) => Math.log(x.r.sat)), e2 = withRiv.map((x) => resid[x.i]);
      console.log(`  경쟁점이 있는 ${withRiv.length}곳만: r = ${corr(s2, e2).toFixed(3)}`);
    }
    // 무리로 갈라 본다 — 상관 하나보다 눈에 잘 들어온다
    const sorted = [...rows].map((r, i) => ({ r, e: resid[i] })).sort((a, b) => a.r.sat - b.r.sat);
    const h = Math.floor(rows.length / 3);
    const show = (label: string, g: typeof sorted) => {
      console.log(`  ${label.padEnd(16)}n=${String(g.length).padStart(2)}`
        + `  포화도 ${mean(g.map((x) => x.r.sat)).toFixed(3)}`
        + `  잔차 평균 ${(mean(g.map((x) => x.e)) * 100).toFixed(1).padStart(6)}%`
        + `  경쟁PC ${mean(g.map((x) => x.r.rivalPc)).toFixed(0).padStart(4)}`
        + `  실측 ${(mean(g.map((x) => x.r.act)) * 100).toFixed(1)}%`);
    };
    console.log(`\n  포화도 3등분`);
    show("낮은 1/3", sorted.slice(0, h));
    show("가운데", sorted.slice(h, 2 * h));
    show("높은 1/3", sorted.slice(2 * h));
    console.log(`\n  ⚠️ 포화도는 경쟁PC와 얽혀 있다(분모에 들어가니까) — 상관 하나로 판정하지 마라.`);
    console.log(`     진짜 판정은 (3)번, **천장을 넣은 식을 켜고 끄며 오차를 보는 것**이다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(3) ⭐⭐⭐ 천장을 넣은 점유율 식 — 재고 표", () => {
    // ── 기전을 식으로 ──────────────────────────────────────────────────────
    // 지금:   우리시간 = 총수요 x [자사 ÷ (자사+경쟁)]
    // 대안:   경쟁점이 가져갈 수 있는 시간에 **천장**을 둔다.
    //           경쟁 흡수 가능량 = 경쟁PC x 720 x κ      (κ = 경쟁점 가동률 상한)
    //           경쟁이 실제로 가져가는 양 = min(비율 몫, 흡수 가능량)
    //           우리 시간 = 총수요 − 경쟁이 가져간 양   (자사 좌석 상한은 그대로 적용)
    //
    // κ는 **새 자유 계수가 아니다** — 우리 매장의 상한(maxUtilization 0.55)과 같은 뜻이고,
    // 실측 최대 가동률이 46.5%인 것과도 맞는다. 그래도 값에 성적이 얼마나 끌리는지 훑는다.
    //
    // ⛔ 채택 후보로 내놓는 게 아니다. **기전이 자료에서 값을 하는지**만 본다.
    const acts = rows.map((r) => r.act);
    const actLog = acts.map(Math.log);
    const n = rows.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));
    const hiSet = new Set([...rows].sort((a, b) => a.rivalW - b.rivalW).slice(Math.floor(n / 2)).map((r) => r.name));
    const hiIdx = rows.map((_, i) => i).filter((i) => hiSet.has(rows[i].name));
    const loIdx = rows.map((_, i) => i).filter((i) => !hiSet.has(rows[i].name));

    /** κ를 넣은 예측. κ=∞면 지금 식과 같다. */
    const predsAt = (kappa: number) => rows.map((r) => {
      const D = r.demandH;
      const ourCap = r.pc * MONTH_HOURS;
      // 비율 몫 — 지금 식 그대로(품질·거리·입지가 이미 들어간 share를 쓴다)
      const ourByShare = D * r.share;
      const rivalByShare = D - ourByShare;
      // 경쟁이 물리적으로 소화할 수 있는 양
      const rivalCap = r.rivalPc * MONTH_HOURS * kappa;
      const rivalTakes = Math.min(rivalByShare, rivalCap);
      const ours = Math.min(D - rivalTakes, ourCap * P.maxUtilization);
      return ours / ourCap;
    });
    const line = (label: string, preds: number[], mark = "") => {
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const sp = sdOf(pl) / sdOf(actLog), rr = corr(pl, actLog);
      console.log(`  ${label.padEnd(16)}${(mean(abs) * 100).toFixed(2).padStart(6)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(7)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${sp.toFixed(2).padStart(6)}배${rr.toFixed(3).padStart(8)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(9)}%p`
        + `${(rr - sp / 2).toFixed(3).padStart(10)}${mark}`);
    };
    console.log(`\n[재고 표 — 경쟁점 좌석 천장 κ] ⭐ 바닥: 전부 평균(LOO) ${(baseMae * 100).toFixed(2)}%p · n=${n}`);
    console.log(`  경우              MAE     최악   편향   ±5%p  퍼짐 분별력r   경쟁 센   약한   남은거리`);
    line("천장 없음(지금)", rows.map((r) => r.pred), "  ← 지금");
    for (const k of [0.55, 0.45, 0.40, 0.35, 0.30, 0.25]) line(`κ = ${k.toFixed(2)}`, predsAt(k));
    // 천장이 실제로 무는 매장이 몇 곳인가 — 안 물면 식이 안 바뀐 것이다
    for (const k of [0.45, 0.35, 0.25]) {
      const bites = rows.filter((r) => {
        const D = r.demandH;
        return D * (1 - r.share) > r.rivalPc * MONTH_HOURS * k;
      }).length;
      console.log(`    κ=${k.toFixed(2)}에서 천장이 실제로 무는 매장 ${bites}/${n}곳`);
    }
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · **분별력 r이 오르면** 진짜다 — 기전이 매장을 더 잘 가른다는 뜻이다`);
    console.log(`     · r은 그대로인데 편향만 움직이면 수준을 만진 것이라 채택 근거가 안 된다`);
    console.log(`     · 천장이 무는 매장이 0곳이면 이 기전은 **지금 표본에서 작동할 자리가 없다**`);
    console.log(`  ⛔ 여기서 κ를 고르지 않는다. 좋아 보이면 중첩 LOO부터 돌리고 사용자에게 간다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(4) ⭐⭐⭐ 포화도가 12%라는 게 말이 되나 — 수요 추정이 너무 작다", () => {
    // (1)에서 포화도 중앙이 **0.122**로 나왔다. 뜻을 풀면:
    //   "동네 수요가 (자사+경쟁) 총 좌석시간의 12%밖에 안 된다"
    // 그런데 우리는 30% 안팎으로 돈다. 그러면 나머지 좌석들은 얼마로 도는 셈인가?
    // 그걸 직접 계산해서 **말이 되는 수인지** 본다. 이게 수요층을 겨누는 가장 단순한 검산이다.
    console.log(`\n[검산] 산식의 수요를 믿으면 **경쟁점들은 몇 %로 도는 셈인가**`);
    console.log(`  경쟁점 몫 = (총수요 − 우리가 실제 쓴 시간) ÷ (경쟁PC x 720)`);
    console.log(`\n  매장            경쟁PC   총수요(천시간)  우리사용  경쟁 몫 -> 경쟁 가동률`);
    const impl: number[] = [];
    for (const r of [...rows].sort((a, b) => b.rivalPc - a.rivalPc).slice(0, 10)) {
      const ourHours = r.pc * MONTH_HOURS * r.act;
      const rest = r.demandH - ourHours;
      const rivalUtil = r.rivalPc > 0 ? rest / (r.rivalPc * MONTH_HOURS) : NaN;
      impl.push(rivalUtil);
      console.log(`  ${r.name.padEnd(14)}${r.rivalPc.toFixed(0).padStart(7)}`
        + `${(r.demandH / 1000).toFixed(0).padStart(13)}`
        + `${(ourHours / 1000).toFixed(0).padStart(10)}`
        + `${(rest / 1000).toFixed(0).padStart(9)}`
        + `${(rivalUtil * 100).toFixed(1).padStart(11)}%`);
    }
    const allImpl = rows.filter((r) => r.rivalPc > 20).map((r) => {
      const ourHours = r.pc * MONTH_HOURS * r.act;
      return (r.demandH - ourHours) / (r.rivalPc * MONTH_HOURS);
    });
    const sorted = [...allImpl].sort((a, b) => a - b);
    console.log(`\n  경쟁점 20대 이상인 ${allImpl.length}곳 — 산식이 함의하는 **경쟁점 가동률**`);
    console.log(`    중앙 ${(sorted[Math.floor(sorted.length / 2)] * 100).toFixed(1)}%`
      + ` · 범위 ${(sorted[0] * 100).toFixed(1)}~${(sorted[sorted.length - 1] * 100).toFixed(1)}%`
      + ` · 음수인 곳 ${allImpl.filter((v) => v < 0).length}곳`);
    console.log(`    우리 매장 실측 가동률은 ${(mean(rows.map((r) => r.act)) * 100).toFixed(1)}%다.`);
    console.log(`\n  ⭐ 경쟁점 가동률이 우리보다 **터무니없이 낮게** 나오면(또는 음수면),`);
    console.log(`     그건 **수요 추정이 너무 작다**는 뜻이다. 경쟁점들도 장사하고 있으니까.`);
    console.log(`  ⚠️ 경쟁점 대수가 과대할 가능성도 같이 있다 — 둘을 이 자료로는 못 가른다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(5) ⭐⭐⭐ 상권 흡인력을 켜 본다 — \"경쟁점이 많다 = 수요가 많다\"", () => {
    // 사용자 기전의 앞쪽 절반이다: *"상권 수요가 되게 많아서 2순위 3순위 PC방도 가동률이
    // 되게 잘 나와."* 뒤집으면 **PC방이 많이 모인 자리는 수요가 많다**는 뜻이다.
    //
    // 산식에 그 항이 **이미 있다** — `agglomerationFactor`. 지금은 **0(꺼짐)**이다:
    //     수요 배율 = 1 + a x ln(1 + 경쟁점 수)
    // 이건 새로 만드는 게 아니라 **꺼 둔 걸 켜는 것**이고, 기전은 사용자가 방금 설명했다.
    //
    // ⚠️ 조심할 자리: 경쟁점 수가 분모(점유율)에도 들어간다. 켜면 같은 값이 분자·분모에
    //    같이 작용해서 **서로 상쇄될 수 있다.** 그래서 분별력 r을 꼭 같이 본다.
    // ⛔ 값을 고르지 않는다. 재고 표만 남긴다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));
    const hiSet = new Set([...rows].sort((a, b) => a.rivalW - b.rivalW).slice(Math.floor(rows.length / 2)).map((r) => r.name));
    const hiIdx = use.map((_, i) => i).filter((i) => hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const loIdx = use.map((_, i) => i).filter((i) => !hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    console.log(`\n[재고 표 — 상권 흡인력 a] 수요 배율 = 1 + a x ln(1 + 경쟁점 수)`);
    console.log(`  ⭐ 바닥: 전부 평균(LOO) ${(baseMae * 100).toFixed(2)}%p · n=${n}`);
    // ⚠️ 수요를 키우면 **수준이 통째로 올라간다.** 축척(8.20h)이 고정이라 그 수준을 못
    //    흡수하므로 MAE가 나빠진다. 그건 이 항의 잘못이 아니다 — `실험실 MAPE는 수준에
    //    끌려다닌다`. 그래서 **수준보정 MAE**(예측 전체에 상수를 곱해 log 편향을 0으로)를
    //    같이 찍는다. 판정은 **분별력 r과 수준보정 MAE**로 한다.
    console.log(`  a         MAE     최악   편향   ±5%p  퍼짐 분별력r   경쟁 센   약한   남은거리 | 수준보정`);
    for (const a of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4]) {
      const P2 = { ...P, agglomerationFactor: a };
      const preds = use.map(({ r }) => computeTextbook(r.input, P2).utilization ?? NaN);
      if (preds.some((v) => !Number.isFinite(v))) continue;
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const sp = sdOf(pl) / sdOf(actLog), rr = corr(pl, actLog);
      console.log(`  ${a.toFixed(2).padStart(4)}${(mean(abs) * 100).toFixed(2).padStart(10)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(7)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${sp.toFixed(2).padStart(6)}배${rr.toFixed(3).padStart(8)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(9)}%p`
        + `${(rr - sp / 2).toFixed(3).padStart(10)} |`
        + (() => {
          const k = Math.exp(mean(actLog) - mean(pl));
          return `${(mean(preds.map((v, i) => Math.abs(v * k - acts[i]))) * 100).toFixed(2).padStart(8)}%p`;
        })()
        + (a === 0 ? "  ← 지금(꺼짐)" : ""));
    }
    console.log(`\n  ⭐ **분별력 r이 오르면 진짜다.** 경쟁점 수가 분자·분모에 같이 들어가므로`);
    console.log(`     상쇄될 수 있는데, r이 오른다면 상쇄를 넘어 신호가 남는다는 뜻이다.`);
    console.log(`  ⛔ 좋아 보여도 여기서 고르지 마라 — 중첩 LOO부터다.`);
    expect(n).toBeGreaterThan(30);
  });
});
