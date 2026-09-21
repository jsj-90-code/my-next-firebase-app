// 2026-09-21 밤(3) — 눈금 보정 b=0.327을 **항별로 쪼갠다**. 읽기전용 진단.
// 본체/운영/Firestore 쓰기 없음. 계수를 고르지 않는다 — 재고 표만 낸다(사용자 규칙).
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// b=0.327이 왜 이렇게 작아야 하는지 두 갈래가 갈린다.
//   (A) 구조적 과장 — 수요·공급 지수가 진짜로 매장 차이를 부풀린다
//   (B) 잡음에 의한 희석 — 지수에 섞인 잡음이 기울기를 눌렀다(회귀 희석)
// (A)면 **어느 항이** 부풀리는지 찾아 거기를 고치는 게 실무적 형태다.
// (B)면 b<1은 오차를 줄이는 축소일 뿐이고 후보지 줄세우기는 원래 순위를 써야 한다.
// 지금은 수요항과 점유율항이 b 하나로 묶여 있어 구분이 안 된다. 그래서 쪼갠다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 대상·평가기간·실매출 삭제는 _utilizationObjective와 동일. 38점, 실매출 미사용.
// 2. 본체를 세 성분으로 분해한다. hoursPerUserPerMonth=1 · indexCalibration=null 기준:
//      D = 수요밀도   shareMode="off"·maxUtilization=Inf의 가동률 (= 수요시간÷(PC×720))
//      Sr = 날 점유율  location=null일 때의 share (경쟁만, 입지 없음)
//      L = 입지배율    본체 breakdown.locationMultiplier
// 3. 일반화식:  pred = min(cap, A · D^p · min(1, Sr·L^(r/q))^q)
//    p=q=b, r=c 일 때 본체와 **정확히 일치**해야 한다 → 되맞춤 관문으로 박는다.
//    (본체 pred = ref^(1-b)·(H·D·share)^b 이므로 A = ref^(1-b)·H^b 로 대응한다.)
// 4. A는 겹마다 훈련 **독점 앵커**에서 기하평균 일치로 적합 — 본체 fitHoursPerUser와
//    같은 원칙이다(사용자: "독점매장이 무조건 맞아야 돼"). 홀드아웃 실측은 안 넘긴다.
// 5. 격자 p,q ∈ .10~1.00 step .05, r은 현재 채택 c=.169 고정. LOO 38겹.
//    ⚠️ 격자 최솟값은 **사후선택**이므로 검증 성적이 아니다. nested LOO(안쪽 37겹으로
//    고르고 바깥에서 채점)를 같이 내서 "자료가 고르면 어디로 가는가"만 본다.
// 6. 단위를 섞지 않는다 — MAE·최악·SD 전부 **%p**. MAPE만 상대%로 따로 적는다.
// 7. 희석 진단: 주거수요와 유동수요는 같은 수요를 재려는 두 자료다. 서로를 도구변수로
//    써서 희석 보정 기울기를 낸다(Wald 추정). 날 OLS 기울기와 나란히 적는다.
// 8. 자료/본체가 실행 중 바뀌었으면 같은 결과로 보지 않도록 해시를 앞뒤로 검사한다.
// 실행: npx vitest run src/lib/storeEval/_calibrationSplit.test.ts --disable-console-intercept
//
// ── 첫 측정 (snapshot 2026-09-21T06:26:52.452Z, n=38) ─────────────────────
// 채택 b=c 묶음: MAE 3.874%p · 최악 12.89%p · 예측SD 3.05%p · ±5%p 29/38 · r .5495
//   ⚠️ 인계문의 4.03%p와 다르다. 산식이 아니라 **스냅샷이 갱신됐다**(값이 좋아진 쪽).
// 훈련평균: 4.3735%p · 최악 15.65%p · ±5%p 26/38
//
// 1. **쪼갤 이유가 없다.** 격자 최적이 대각선 위(p=q=.25, 3.7279%p)에 있다. q만 따로
//    움직여 얻는 이득은 .003%p — 수요항과 점유율항이 **같은 정도로** 눌린다.
// 2. **미세조정도 자료가 못 고른다.** nested LOO 4.3171%p로 훈련평균(4.3735)과 사실상
//    같다. 고정 격자의 3.73%p는 사후선택 값이다. 겹별 항등식은 통과(mismatch 0) —
//    구현 버그가 아니라 진짜 역선택이다. → **b=0.327을 그대로 두는 게 맞다.**
// 3. **b가 작아야 하는 이유**: 날 가동률 로그SD .3785 vs 실측 .1844 = **퍼짐 2.05배**.
//    상관이 완벽했어도 기울기 상한은 .4871이고, r=.5339를 곱하면 OLS .2601이 된다.
//    절반은 퍼짐 과장, 절반은 설명력 부족이다.
// 4. **희석(잡음) 가설은 기각.** 유동 IV .1933이 OLS .0414의 4.7배로 보이지만 부트스트랩
//    CI [-.0223, .6518]이 0을 품는다. 반경 100~500m를 기하평균해 잡음을 줄여도 기울기가
//    .0194로 **되레 준다** — 반경끼리 r=.90이라 독립 반복측정이 아니기 때문이다.
//    측정은 정확한데 가동률과 관련이 약한 것이다(인구 자료에 신호 없음과 일치).
// 5. 수요 퍼짐의 주범은 수요시간 자체(로그SD .4334)다. PC대수는 .1208로 균일하고
//    수요와 무관하다(r=.0545) — "수요 보고 PC를 깐다"가 아니다.
// 6. ⚠️ **입지배율의 날 상관이 음수다**(기울기 -.1778, r=-.2632). 산식은 c=+.169로 쓴다.
//    소도시일수록 배율이 커서 생긴 교란일 수 있다(구미산동 1.89·문경 1.66·증평 1.49).
//    기존점 **2곳**(구미산동·문경시청)이 이미 입지 때문에 점유율 100%로 잘려 있다.
//    → 인계문 4절(영월 2.054·호구포역)과 같은 병이 기존점에도 있다. 오늘은 안 건드린다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fitHoursPerUser } from "./textbookModel";
import { evaluationMonths } from "./evaluationSalesPeriod";
import type { Competitor, ExistingStoreMonthlySales } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((v) => (v - mean(xs)) ** 2)));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** 최소제곱 기울기와 상관. x·y는 이미 로그를 취한 값으로 넘긴다. */
const fit = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  const xx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const yy = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const xy = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  return { slope: xx > 0 ? xy / xx : NaN, r: xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : NaN };
};

it("눈금 보정을 수요항·점유율항으로 쪼갠다", () => {
  expect(hasValidationSnapshot(), "최신 validation-snapshot.json 필요").toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const snapshotHash = hash(".local-tools/validation-snapshot.json");
  const modelHash = hash("src/lib/storeEval/textbookModel.ts");
  const P = structuredClone(DEFAULT_TEXTBOOK_PARAMS);
  // 산식이 바뀌면 아래 수치가 낡으므로 잠금장치를 건다.
  expect(P.rivalDistanceDecay).toEqual({ plateauM: 200, scaleM: 200, weightFactor: .9593 });
  // ⚠️ 위 기록은 **b=0.327** 시절 값이다. 2026-09-21 저녁에 **0.45로 올렸다** — 자료가 아니라
  //    변별력(용도)으로 고른 값이다(`_spreadChoice.test.ts`). 여기 2절의 "b=0.327을 그대로
  //    두는 게 맞다"는 **자료가 못 고른다**는 뜻이었고, 그 판정은 그대로다.
  // ⛔ 2026-09-21 밤에 **b를 아예 껐다**(b=1). 이 하네스가 재던 "b를 어떻게 쪼갤까"는
  //    그래서 지금 산식에는 해당이 없다 — 되살릴 때 참고하라고 기록만 남긴다.
  expect(P.indexCalibration).toEqual({ ratioExponent: 1, locationExponent: .169, referenceUtilization: .3011 });
  expect(P.shareMode).toBe("quality");
  // 2026-09-22 — "안 가는 몫"을 다시 0으로 뺐다(점 3개 적합이었고 정체가 반경 밖 경쟁점이다).
  // 위 기록은 0일 때 잰 값이라 지금 산식과 다시 맞다. 하루 동안만 20이었다.
  expect(P.outsideOptionIp).toBe(0);
  const B = P.indexCalibration!.ratioExponent, C = P.indexCalibration!.locationExponent;
  const REF = P.indexCalibration!.referenceUtilization;

  // ── 자료 조립 — _utilizationObjective와 같은 경로 ────────────────────────
  const settings = mergeModelSettings(snap.settings);
  const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of competitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, competitors, snap.locationEvaluations, settings);
  const qscByStoreCode = new Map<string, number>();
  for (const site of snap.labQscScores as { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] }[]) {
    const code = site.storeCode ?? site.id;
    const value = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (code && value != null) qscByStoreCode.set(code, value);
  }
  const initialRows = buildLabRows({ stores, compsByCode, settings, qscByStoreCode,
    utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores) });
  const rows = initialRows.map((row) => {
    const store = stores.find((s) => s.storeCode === row.input.storeCode)!;
    const window = evaluationMonths(store.openedAt);
    const complete = (snap.sales as ExistingStoreMonthlySales[]).filter((s) => s.storeCode === store.storeCode
      && window.includes(s.yearMonth) && (s.pcSales ?? 0) + (s.productSales ?? 0) > 0);
    const from2 = complete.filter((s) => window.indexOf(s.yearMonth) >= 1);
    const target = from2.length ? from2 : complete;
    expect(target.length).toBeGreaterThan(0);
    expect(target.every((s) => s.utilizationRate != null && s.utilizationRate > 0)).toBe(true);
    // 실매출은 대상 선정에만 쓰고 지운다 — 계수 선택에 매출이 못 들어가게.
    return { ...row, actualRevenue: 0, input: { ...row.input,
      actualUtilization: mean(target.map((s) => s.utilizationRate!)) } };
  });
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.every((r) => !r.excluded && (r.input.pcCount ?? 0) > 0)).toBe(true);
  expect(new Set(rows.map((r) => r.input.storeCode)).size).toBe(rows.length);
  const ids = rows.map((_, i) => i);
  const actual = rows.map((r) => r.input.actualUtilization!);
  const cap = P.maxUtilization;

  // ── 성분 분해 ────────────────────────────────────────────────────────────
  const bare = { ...P, hoursPerUserPerMonth: 1, indexCalibration: null, maxUtilization: Infinity };
  const parts = rows.map((row) => {
    const input = { ...row.input, actualUtilization: null };
    // D: 점유율·입지를 통째로 끈 순수 수요밀도.
    const d = computeTextbook(input, { ...bare, shareMode: "off" }).utilization;
    // Sr: 입지만 뺀 날 점유율(경쟁만).
    const sr = computeTextbook({ ...input, location: null }, bare).share;
    // L: 입지배율. 본체 그대로 뽑는다(보정은 지수만 바꾸므로 배율 자체는 같다).
    const l = computeTextbook(input, P).locationMultiplier;
    expect(d).not.toBeNull(); expect(sr).not.toBeNull(); expect(l).not.toBeNull();
    return { d: d!, sr: sr!, l: l! };
  });
  expect(parts.every((p) => p.d > 0 && p.sr > 0 && p.sr <= 1 && p.l > 0)).toBe(true);

  /** 일반화식의 우리 몫. 본체와 같은 자리에서 상한을 먹인다. */
  const shareOf = (i: number, q: number, r: number) =>
    Math.min(1, parts[i].sr * Math.pow(parts[i].l, q !== 0 ? r / q : 0));
  /** 일반화식의 모양(축척 A 제외). */
  const shapeOf = (i: number, p: number, q: number, r: number) =>
    Math.pow(parts[i].d, p) * Math.pow(shareOf(i, q, r), q);

  // ── 되맞춤 관문 — p=q=b, r=c 가 본체와 같은가 ────────────────────────────
  // 본체 pred = ref^(1-b)·(H·D·share)^b = [ref^(1-b)·H^b] · D^b · share^b
  for (const [i, row] of rows.entries()) {
    const H = 7.3;  // 임의의 축척 하나로 항등식만 확인한다
    const native = computeTextbook({ ...row.input, actualUtilization: null },
      { ...P, hoursPerUserPerMonth: H }).utilization!;
    const A = Math.pow(REF, 1 - B) * Math.pow(H, B);
    expect(Math.min(cap, A * shapeOf(i, B, B, C))).toBeCloseTo(native, 12);
  }
  // 상한이 실제로 몇 곳에 걸리는지 — 분해 해석의 전제다.
  const shareCapped = ids.filter((i) => parts[i].sr * Math.pow(parts[i].l, C / B) > 1);
  const utilCapped = ids.filter((i) => {
    const H = fitHoursPerUser(rows, P);
    return computeTextbook({ ...rows[i].input, actualUtilization: null }, { ...P, hoursPerUserPerMonth: H }).capped;
  });

  // ── LOO 채점 ─────────────────────────────────────────────────────────────
  /** 훈련 독점 앵커에서 기하평균을 맞춘다 — 본체 fitHoursPerUser와 같은 원칙. */
  const fitA = (train: number[], p: number, q: number, r: number) => {
    const anchors = train.filter((i) => !(rows[i].input.competitorIp ?? 0));
    expect(anchors.length).toBeGreaterThan(0);
    return Math.exp(mean(anchors.map((i) => Math.log(actual[i]) - Math.log(shapeOf(i, p, q, r)))));
  };
  const loo = (p: number, q: number, r: number) => {
    const predictions = ids.map((held) =>
      Math.min(cap, fitA(ids.filter((i) => i !== held), p, q, r) * shapeOf(held, p, q, r)));
    const errors = predictions.map((v, i) => Math.abs(v - actual[i]));
    return { p, q, r, predictions, errors,
      maePp: mean(errors) * 100,
      worstPp: Math.max(...errors) * 100,
      predSdPp: sd(predictions) * 100,
      within5: errors.filter((v) => v <= .05).length,
      biasPp: mean(predictions.map((v, i) => v - actual[i])) * 100,
      mape: mean(errors.map((v, i) => v / actual[i])) * 100,
      rankR: fit(predictions, actual).r };
  };
  type Fold = ReturnType<typeof loo>;
  const brief = (label: string, f: Fold) => ({ label, p: f.p, q: f.q, r: f.r,
    maePp: +f.maePp.toFixed(4), worstPp: +f.worstPp.toFixed(4), predSdPp: +f.predSdPp.toFixed(4),
    within5: f.within5, biasPp: +f.biasPp.toFixed(4), mape: +f.mape.toFixed(3), rankR: +f.rankR.toFixed(4) });

  // 본체 재현 확인 — 채택값이 인계문의 4.03%p를 다시 내는가.
  const adopted = loo(B, B, C);

  // 단순 기준 (훈련평균) — 넘어야 할 선.
  const naive = (() => {
    const predictions = ids.map((held) => mean(ids.filter((i) => i !== held).map((i) => actual[i])));
    const errors = predictions.map((v, i) => Math.abs(v - actual[i]));
    return { p: NaN, q: NaN, r: NaN, predictions, errors, maePp: mean(errors) * 100,
      worstPp: Math.max(...errors) * 100, predSdPp: sd(predictions) * 100,
      within5: errors.filter((v) => v <= .05).length,
      biasPp: mean(predictions.map((v, i) => v - actual[i])) * 100,
      mape: mean(errors.map((v, i) => v / actual[i])) * 100, rankR: NaN } as Fold;
  })();

  const GRID = Array.from({ length: 19 }, (_, i) => +(0.10 + 0.05 * i).toFixed(2));
  const all: Fold[] = [];
  for (const p of GRID) for (const q of GRID) all.push(loo(p, q, C));
  const ranked = [...all].sort((a, b) => a.maePp - b.maePp);

  // 한쪽만 자유롭게 — 다른 쪽은 채택값 b에 묶어 둔다.
  const pOnly = GRID.map((p) => loo(p, B, C)).sort((a, b) => a.maePp - b.maePp);
  const qOnly = GRID.map((q) => loo(B, q, C)).sort((a, b) => a.maePp - b.maePp);
  // 대각선(p=q) — 지금 구조. 한 지수로 묶었을 때의 최적점.
  const diag = GRID.map((v) => loo(v, v, C)).sort((a, b) => a.maePp - b.maePp);

  // nested LOO — 사후선택이 아닌 정직한 성적. 안쪽 37겹으로 (p,q)를 고르고 바깥에서 채점.
  const nested = (() => {
    const picks: string[] = [];
    const predictions = ids.map((held) => {
      const train = ids.filter((i) => i !== held);
      let best = { p: B, q: B, err: Infinity };
      for (const p of GRID) for (const q of GRID) {
        const err = mean(train.map((inner) => {
          const innerTrain = train.filter((i) => i !== inner);
          return Math.abs(Math.min(cap, fitA(innerTrain, p, q, C) * shapeOf(inner, p, q, C)) - actual[inner]);
        }));
        if (err < best.err - 1e-12) best = { p, q, err };
      }
      picks.push(`${best.p}/${best.q}`);
      return Math.min(cap, fitA(train, best.p, best.q, C) * shapeOf(held, best.p, best.q, C));
    });
    const errors = predictions.map((v, i) => Math.abs(v - actual[i]));
    return { picks, fold: { p: NaN, q: NaN, r: C, predictions, errors, maePp: mean(errors) * 100,
      worstPp: Math.max(...errors) * 100, predSdPp: sd(predictions) * 100,
      within5: errors.filter((v) => v <= .05).length,
      biasPp: mean(predictions.map((v, i) => v - actual[i])) * 100,
      mape: mean(errors.map((v, i) => v / actual[i])) * 100,
      rankR: fit(predictions, actual).r } as Fold };
  })();

  // ── 희석 진단 ────────────────────────────────────────────────────────────
  // 날 OLS 기울기: log(실측) ~ log(성분). 잡음이 있으면 아래로 눌린다.
  const logA = actual.map(Math.log);
  const rawSlopes = {
    demand: fit(parts.map((x) => Math.log(x.d)), logA),
    share: fit(parts.map((x) => Math.log(x.sr)), logA),
    location: fit(parts.map((x) => Math.log(x.l)), logA),
    // 날 가동률 전체(축척 없이) — 이게 b가 잡으려는 기울기다.
    rawUtil: fit(parts.map((x) => Math.log(x.d * Math.min(1, x.sr))), logA),
  };
  // 도구변수(Wald): 주거수요와 유동수요를 서로의 도구로 쓴다. 두 자료의 잡음이 서로
  // 독립이라면 희석이 상쇄된다. ⚠️ 둘이 같은 오차원(반경·이용률표)을 공유하면 과소보정된다.
  const demandSplit = rows.map((row) => {
    const b = computeTextbook({ ...row.input, actualUtilization: null }, { ...bare, shareMode: "off" });
    return { res: b.residentDemandUsers, flo: b.floatingDemandUsers };
  });
  const ivRows = ids.filter((i) => (demandSplit[i].res ?? 0) > 0 && (demandSplit[i].flo ?? 0) > 0);
  const iv = (() => {
    if (ivRows.length < 10) return null;
    const lr = ivRows.map((i) => Math.log(demandSplit[i].res!));
    const lf = ivRows.map((i) => Math.log(demandSplit[i].flo!));
    const ly = ivRows.map((i) => logA[i]);
    // Wald: beta_IV = cov(z,y) / cov(z,x). 주거를 도구로 유동 기울기, 그리고 반대로.
    const cov = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b);
      return a.reduce((s, v, k) => s + (v - ma) * (b[k] - mb), 0); };
    return {
      n: ivRows.length,
      floatingOls: +fit(lf, ly).slope.toFixed(4),
      floatingIv: +(cov(lr, ly) / cov(lr, lf)).toFixed(4),
      residentOls: +fit(lr, ly).slope.toFixed(4),
      residentIv: +(cov(lf, ly) / cov(lf, lr)).toFixed(4),
      corrBetweenInstruments: +fit(lr, lf).r.toFixed(4),
    };
  })();

  // IV는 도구가 약하면(상관 .41) 불안정하다 — 부트스트랩 CI와 무작위 도구 대조군을 붙인다.
  // 무작위 도구가 같은 크기의 보정을 내면 그 보정은 잡음이 만든 허상이다.
  let seed = 20260921;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const cov = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b);
    return a.reduce((s, v, k) => s + (v - ma) * (b[k] - mb), 0) / a.length; };
  const ivBoot = (() => {
    if (ivRows.length < 10) return null;
    const lr = ivRows.map((i) => Math.log(demandSplit[i].res!));
    const lf = ivRows.map((i) => Math.log(demandSplit[i].flo!));
    const ly = ivRows.map((i) => logA[i]);
    const wald = (z: number[], x: number[], y: number[], pick: number[]) => {
      const zz = pick.map((k) => z[k]), xx = pick.map((k) => x[k]), yy = pick.map((k) => y[k]);
      const d = cov(zz, xx);
      return Math.abs(d) < 1e-12 ? NaN : cov(zz, yy) / d;
    };
    const idx = lr.map((_, k) => k);
    const draw = () => idx.map(() => Math.floor(random() * idx.length));
    const quantiles = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
      return s.length < 100 ? [NaN, NaN] : [+s[Math.floor(s.length * .025)].toFixed(4), +s[Math.floor(s.length * .975)].toFixed(4)]; };
    const flo: number[] = [], res: number[] = [], shamFlo: number[] = [];
    for (let t = 0; t < 4000; t++) {
      const pick = draw();
      flo.push(wald(lr, lf, ly, pick));
      res.push(wald(lf, lr, ly, pick));
    }
    // 무작위 도구 대조군 — 주거수요를 섞어서 도구로 쓴다. 참이면 보정이 사라져야 한다.
    for (let t = 0; t < 4000; t++) {
      const shuffled = [...lr];
      for (let k = shuffled.length - 1; k > 0; k--) { const j = Math.floor(random() * (k + 1)); [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]]; }
      shamFlo.push(wald(shuffled, lf, ly, idx));
    }
    return { floatingIvCi: quantiles(flo), residentIvCi: quantiles(res),
      shamFloatingIvCi: quantiles(shamFlo), shamFinite: shamFlo.filter(Number.isFinite).length };
  })();

  // ── 유동인구 잡음: 반경을 바꿔 가며 신호 세기를 잰다 ─────────────────────
  // 반경 100~500m는 같은 "동네 유동"을 재려는 여러 측정이다. 기울기는 축척 불변이라
  // floatingFactor와 무관하게 비교할 수 있다. 잡음이 주범이면 **여러 반경을 기하평균**해서
  // 잡음을 줄였을 때 기울기가 개별 반경보다 올라가야 한다.
  const RADII = [100, 200, 300, 400, 500] as const;
  const flowByRadius = RADII.map((R) => ({ R, v: rows.map((row) => row.input.floatingByRadius[R] ?? null) }));
  const radiusRows = ids.filter((i) => flowByRadius.every((f) => (f.v[i] ?? 0) > 0));
  const radiusScan = flowByRadius.map(({ R, v }) => {
    const use = ids.filter((i) => (v[i] ?? 0) > 0);
    const f = fit(use.map((i) => Math.log(v[i]!)), use.map((i) => logA[i]));
    return { R, n: use.length, slope: +f.slope.toFixed(4), r: +f.r.toFixed(4) };
  });
  const pooled = (() => {
    if (radiusRows.length < 10) return null;
    const gm = radiusRows.map((i) => mean(flowByRadius.map((f) => Math.log(f.v[i]!))));
    const f = fit(gm, radiusRows.map((i) => logA[i]));
    // 같은 표본에서 개별 반경도 다시 재야 공정한 비교다.
    const each = flowByRadius.map(({ R, v }) => {
      const g = fit(radiusRows.map((i) => Math.log(v[i]!)), radiusRows.map((i) => logA[i]));
      return { R, slope: +g.slope.toFixed(4), r: +g.r.toFixed(4) };
    });
    // 반경끼리 얼마나 닮았나 — 낮을수록 그 안에 매장 고유 신호보다 잡음이 많다는 뜻.
    const pairR: number[] = [];
    for (let a = 0; a < RADII.length; a++) for (let b = a + 1; b < RADII.length; b++)
      pairR.push(fit(radiusRows.map((i) => Math.log(flowByRadius[a].v[i]!)),
        radiusRows.map((i) => Math.log(flowByRadius[b].v[i]!))).r);
    return { n: radiusRows.length, pooledSlope: +f.slope.toFixed(4), pooledR: +f.r.toFixed(4),
      each, meanPairR: +mean(pairR).toFixed(4), minPairR: +Math.min(...pairR).toFixed(4) };
  })();

  // ── 수요항을 더 쪼갠다 ───────────────────────────────────────────────────
  // D = 수요시간 ÷ (PC×720) 이라 **PC대수**가 분모로 들어가 있다. 퍼짐이 어디서 오는지
  // 분자·분모로 갈라 본다. 기울기는 축척 불변이라 단위 걱정 없이 비교할 수 있다.
  const demandParts = rows.map((row, i) => {
    const b = computeTextbook({ ...row.input, actualUtilization: null }, { ...bare, shareMode: "off" });
    return { hours: b.totalDemandHours!, pc: row.input.pcCount!, res: b.residentDemandUsers,
      flo: b.floatingDemandUsers, d: parts[i].d };
  });
  const demandScan = {
    // 분자와 분모를 따로. log D = log(수요시간) - log(PC)이므로 둘의 기울기 합이 D 기울기다.
    hours: fit(demandParts.map((x) => Math.log(x.hours)), logA),
    pcCount: fit(demandParts.map((x) => Math.log(x.pc)), logA),
    resident: fit(demandParts.filter((x) => (x.res ?? 0) > 0).map((x) => Math.log(x.res!)),
      demandParts.map((x, i) => ({ x, i })).filter((p) => (p.x.res ?? 0) > 0).map((p) => logA[p.i])),
    // 주거·유동을 PC로 나눈 형태 — 실제로 D에 들어가는 모양이다.
    residentPerPc: fit(demandParts.filter((x) => (x.res ?? 0) > 0).map((x) => Math.log(x.res! / x.pc)),
      demandParts.map((x, i) => ({ x, i })).filter((p) => (p.x.res ?? 0) > 0).map((p) => logA[p.i])),
    floatingPerPc: fit(demandParts.filter((x) => (x.flo ?? 0) > 0).map((x) => Math.log(x.flo! / x.pc)),
      demandParts.map((x, i) => ({ x, i })).filter((p) => (p.x.flo ?? 0) > 0).map((p) => logA[p.i])),
  };
  // PC대수는 **수요를 보고 정한 값**이다 — 큰 수요를 본 자리에 PC를 많이 깐다. 그렇다면
  // 수요÷PC는 이미 서로 상쇄된 비이고, 산식이 그 조정을 모른 채 나누면 퍼짐을 지어낸다.
  const pcVsDemand = (() => {
    const lh = demandParts.map((x) => Math.log(x.hours)), lp = demandParts.map((x) => Math.log(x.pc));
    return { demandVsPcR: +fit(lp, lh).r.toFixed(4), demandVsPcSlope: +fit(lp, lh).slope.toFixed(4),
      hoursLogSd: +sd(lh).toFixed(4), pcLogSd: +sd(lp).toFixed(4),
      dLogSd: +sd(demandParts.map((x) => Math.log(x.d))).toFixed(4),
      // 수요와 PC가 완전히 같이 움직이면(기울기 1) D의 퍼짐은 0이 된다. 실제 기울기가
      // 1보다 작으면 나눌수록 퍼짐이 남고, 그 남은 퍼짐이 가동률과 맞는지가 관건이다.
      pcCountVsActualR: +fit(lp, logA).r.toFixed(4) };
  })();
  const spreadRatio = {
    // 예측변수가 실측보다 몇 배 넓게 퍼져 있나. b가 작아야 하는 직접적 이유다.
    // OLS 기울기 = r × (실측로그SD ÷ 예측변수로그SD) 이므로 이 비가 곧 b의 상한을 정한다.
    rawUtilLogSd: +sd(parts.map((x) => Math.log(x.d * Math.min(1, x.sr)))).toFixed(4),
    actualLogSd: +sd(logA).toFixed(4),
    ratio: +(sd(parts.map((x) => Math.log(x.d * Math.min(1, x.sr)))) / sd(logA)).toFixed(4),
    // r이 완벽(=1)이었다면 쓸 수 있었을 기울기. 지금 b와의 차이가 "상관이 낮아서 낸 세금"이다.
    slopeIfPerfectR: +(sd(logA) / sd(parts.map((x) => Math.log(x.d * Math.min(1, x.sr))))).toFixed(4),
  };

  // ── 독점매장만 따로 — 점유율이 1로 확정이라 **수요식만 남는다** ──────────
  // 2026-09-21 밤(3). 원장으로 1인당 이용시간이 실측되면서(오픈 1년 8.06h vs 산식 8.39h,
  // 차이 4%) 축척이 옳다는 게 확인됐다. 그러면 가동률 오차 = **이용자 수 오차**이고,
  // 독점매장은 점유율이 1이니 그 오차가 통째로 **수요식 오차**다. 원장 없이도 잴 수 있다.
  const monopoly = ids.filter((i) => !(rows[i].input.competitorIp ?? 0));
  const monopolyScan = (() => {
    if (monopoly.length < 3) return null;
    const d = monopoly.map((i) => parts[i].d), a = monopoly.map((i) => actual[i]);
    // 축척만 기하평균으로 맞추고 지수 b를 바꿔 가며 독점 3곳 안에서 채점한다.
    // (LOO가 아니다 — 3곳뿐이라 수준은 못 가르고 **퍼짐이 맞는지**만 본다.)
    const score = (b: number) => {
      const A = Math.exp(mean(monopoly.map((i, k) => Math.log(a[k]) - b * Math.log(d[k]))));
      const pred = d.map((v) => A * Math.pow(v, b));
      return { b, maePp: mean(pred.map((v, k) => Math.abs(v - a[k]))) * 100,
        predRange: Math.max(...pred) / Math.min(...pred), pred };
    };
    return {
      매장: monopoly.map((i) => rows[i].input.storeName),
      실측: a.map((v) => +(v * 100).toFixed(2)),
      "실측 최대÷최소": +(Math.max(...a) / Math.min(...a)).toFixed(4),
      수요밀도: d.map((v) => +v.toFixed(4)),
      "수요 최대÷최소": +(Math.max(...d) / Math.min(...d)).toFixed(4),
      // ⭐ 이 둘이 같으면 수요식이 매장 간 차이를 **정확히** 맞히고 있다는 뜻이다.
      "순위 일치": monopoly.map((_, k) => k).sort((x, y) => d[y] - d[x]).join(",")
        === monopoly.map((_, k) => k).sort((x, y) => a[y] - a[x]).join(","),
      후보: [1, .8, .6, .5, .4, B, .25].map(score).map((s) => ({
        b: +s.b.toFixed(3), maePp: +s.maePp.toFixed(3), "예측 최대÷최소": +s.predRange.toFixed(4),
        예측: s.pred.map((v) => +(v * 100).toFixed(2)) })),
    };
  })();

  // ── 출력 ─────────────────────────────────────────────────────────────────
  console.log("[재현]", JSON.stringify({ snapshot: snap.fetchedAt, n: rows.length,
    snapshotSha256: snapshotHash, modelSha256: modelHash,
    adoptedBc: { b: B, c: C, ref: REF }, grid: [GRID[0], GRID[GRID.length - 1], 0.05] }));
  console.log("[성분 퍼짐: 로그SD]", JSON.stringify({
    demandLogSd: +sd(parts.map((x) => Math.log(x.d))).toFixed(4),
    shareLogSd: +sd(parts.map((x) => Math.log(x.sr))).toFixed(4),
    locationLogSd: +sd(parts.map((x) => Math.log(x.l))).toFixed(4),
    actualLogSd: +sd(logA).toFixed(4),
    actualSdPp: +(sd(actual) * 100).toFixed(4),
    shareCappedN: shareCapped.length, shareCapped: shareCapped.map((i) => rows[i].input.storeName),
    utilCappedN: utilCapped.length, utilCapped: utilCapped.map((i) => rows[i].input.storeName) }));
  console.log("[날 기울기 vs 실측]", JSON.stringify(Object.fromEntries(
    Object.entries(rawSlopes).map(([k, v]) => [k, { slope: +v.slope.toFixed(4), r: +v.r.toFixed(4) }]))));
  console.log("[도구변수 희석보정]", JSON.stringify(iv));
  console.log("[IV 부트스트랩·무작위 대조군]", JSON.stringify(ivBoot));
  console.log("[수요항 분해]", JSON.stringify(Object.fromEntries(
    Object.entries(demandScan).map(([k, v]) => [k, { slope: +v.slope.toFixed(4), r: +v.r.toFixed(4) }]))));
  console.log("[⭐ 독점매장만: 점유율=1이라 수요식만 남는다]", JSON.stringify(monopolyScan));
  console.log("[퍼짐 비: b가 작아야 하는 이유]", JSON.stringify(spreadRatio));
  console.log("[PC대수와 수요의 관계]", JSON.stringify(pcVsDemand));
  console.log("[유동 반경별 신호]", JSON.stringify(radiusScan));
  console.log("[반경 기하평균: 잡음 줄이기]", JSON.stringify(pooled));
  console.log("[기준선]", JSON.stringify([brief("채택 b=c 묶음", adopted), brief("훈련평균", naive)]));
  console.log("[격자 상위10: 사후선택 금지]", JSON.stringify(ranked.slice(0, 10).map((f) => brief(`p${f.p}/q${f.q}`, f))));
  console.log("[p만 자유(q=b) 상위5]", JSON.stringify(pOnly.slice(0, 5).map((f) => brief(`p${f.p}`, f))));
  console.log("[q만 자유(p=b) 상위5]", JSON.stringify(qOnly.slice(0, 5).map((f) => brief(`q${f.q}`, f))));
  console.log("[대각선 p=q 상위5]", JSON.stringify(diag.slice(0, 5).map((f) => brief(`p=q=${f.p}`, f))));
  console.log("[nested LOO: 정직한 성적]", JSON.stringify({ summary: brief("nested", nested.fold),
    picks: nested.picks.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}) }));
  // nested가 고정격자보다 나쁘면 선택잡음인지 버그인지 갈라야 한다. 겹별로 나란히 찍는다.
  {
    const fixed = loo(.25, .25, C);
    const gap = ids.map((i) => ({ name: rows[i].input.storeName, pick: nested.picks[i],
      fixedPp: +(fixed.errors[i] * 100).toFixed(3), nestedPp: +(nested.fold.errors[i] * 100).toFixed(3),
      diffPp: +((nested.fold.errors[i] - fixed.errors[i]) * 100).toFixed(3) }))
      .sort((a, b) => b.diffPp - a.diffPp);
    console.log("[nested 대 고정0.25: 나빠진 순]", JSON.stringify(gap.slice(0, 6)));
    console.log("[nested 대 고정0.25: 합계]", JSON.stringify({
      fixedMaePp: +fixed.maePp.toFixed(4), nestedMaePp: +nested.fold.maePp.toFixed(4),
      worseN: gap.filter((g) => g.diffPp > 1e-9).length, betterN: gap.filter((g) => g.diffPp < -1e-9).length }));
    // 항등식 검사: nested의 겹 오차는 그 겹이 고른 (p,q)의 고정 LOO 오차와 **같아야** 한다.
    // 어긋나면 nested 구현 버그다(선택잡음이 아니다).
    // ⚠️ 여기 키 넷을 글자로 박아 뒀다가 2026-09-21 밤에 깨졌다 — b를 끄니 겹들이 다른 칸을
    //    고르는데 지도에 그 칸이 없어서 터졌다. **실제로 고른 칸**에서 만든다.
    const fixedBy = new Map([...new Set(nested.picks)].map((k) => {
      const [p, q] = k.split("/").map(Number);
      return [k, loo(p, q, C)];
    }));
    const mismatch = ids.filter((i) => Math.abs(fixedBy.get(nested.picks[i])!.errors[i] - nested.fold.errors[i]) > 1e-12);
    console.log("[nested 항등식]", JSON.stringify({ mismatchN: mismatch.length,
      sample: mismatch.slice(0, 3).map((i) => ({ name: rows[i].input.storeName, pick: nested.picks[i],
        fixedPp: +(fixedBy.get(nested.picks[i])!.errors[i] * 100).toFixed(4),
        nestedPp: +(nested.fold.errors[i] * 100).toFixed(4) })) }));
  }
  // 수요가 실제로 어떻게 쌓이는지 — 설명용. 축척 1 기준이라 "사람 수"로 읽으면 된다.
  console.log("[수요 쌓이는 과정]", JSON.stringify(rows.map((row, i) => ({
    name: row.input.storeName,
    주거인구1km: row.input.pop1km, 유동인구400m: row.input.floatingByRadius[400],
    주거수요: demandParts[i].res == null ? null : +demandParts[i].res!.toFixed(1),
    유동수요: demandParts[i].flo == null ? null : +demandParts[i].flo!.toFixed(1),
    특수수요: row.input.specialDemandType ?? "없음",
    합계수요: +(demandParts[i].hours).toFixed(1), PC: demandParts[i].pc,
    실측가동률: +(actual[i] * 100).toFixed(1) }))));
  console.log("[매장별]", JSON.stringify(rows.map((row, i) => ({ name: row.input.storeName,
    actualPct: +(actual[i] * 100).toFixed(2), adoptedPct: +(adopted.predictions[i] * 100).toFixed(2),
    nestedPct: +(nested.fold.predictions[i] * 100).toFixed(2),
    d: +parts[i].d.toFixed(4), sr: +parts[i].sr.toFixed(4), l: +parts[i].l.toFixed(4) }))));

  // 실행 중 자료/본체가 바뀌지 않았는지.
  expect(DEFAULT_TEXTBOOK_PARAMS).toEqual(P);
  expect(hash(".local-tools/validation-snapshot.json")).toBe(snapshotHash);
  expect(hash("src/lib/storeEval/textbookModel.ts")).toBe(modelHash);
}, 600000);
