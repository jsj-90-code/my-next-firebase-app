// Astra 2026-09-21, 사용자 요청: 단계별 원인 분해 후 결과 보고. 본체/운영/Firestore 쓰기 없음.
// 사전 설계 (결과 확인 전에 고정):
// 1. 대상/평가기간은 _utilizationObjective와 동일. 실매출은 완료월 판정 후 0으로 삭제.
// 2. D=현재 수요/PC, C=품질·채택감쇠 경쟁, L=현재 입지. 2^3 조합 모두 출력.
//    D를 끄면 단위PC당 잠재 이용시간을 공통값으로 둔다. C/L은 본체에서 따로 꺼서 계산.
//    shareMode=off는 입지까지 함께 끄므로 C만 끌 때 쓰지 않는다. rivals=[]만 사용.
// 3. 주비교 D=on 네 조합: 매장 하나씩 제외, 수요축척은 훈련 독점점에서 본체 방식으로 적합.
//    경쟁을 끄더라도 독점 기준은 원래 competitorIp=0인 집합 그대로 유지.
// 4. 수준과 모양을 구분하는 대조: 각 고정 조합의 공통배율을 훈련 전체 MAE로 별도 적합.
//    임의 그리드가 아니라 min(cap,a*x)의 구간선형 꼭짓점에서 최적 상수를 찾는다.
//    이 대조는 독점 앵커 제약을 해제한 진단이며 본체 채택 후보로 자동 해석하지 않는다.
// 5. 평균/중앙값도 훈련점만 사용. MAE%p, MAPE, 편향, ±5%p, 상한, 매장별 오차 보고.
//    각 대비의 고정 OOF 오차에 paired bootstrap 5000회. 다중 비교/훈련겹 의존 미보정:
//    기술적 분해용 구간이지 여러 대비 중 좋은 것만 채택하는 검정이 아니다.
// 6. 현 식의 기존 고정 계수는 과거 이 표본으로 정해졌다. 이번 LOO는 독립 신규표본 검증 아님.
//    입지 잔차화 상수는 훈련점만 재적합한 민감도도 별도 출력한다.
// 7. 초기38점·본체 해시를 기록. 결측/전부skip을 성공으로 보지 않음. 중첩/항등식 검사.
// 8. 6개월 이상 관측군 지표도 함께 보고(재선택/재적합 없는 OOF 하위집단 진단).
// 실행: npx vitest run src/lib/storeEval/_utilizationAblation.test.ts --disable-console-intercept
//
// 첫 측정: snapshot=2026-09-21T02:48:29.557Z,
// SHA256=e54305df1e8172ce09d1513f3fdc9b0da975e4d2677084dd91ce461a544e34d0, n=38.
// 독점축척 MAE%p: 수요16.3909, 수요+입지14.6485, 수요+경쟁7.4087, 전체6.5257.
// 훈련평균4.3735(±5%p 26/38) vs 전체6.5257(16/38).
// 전체훈련점으로 배율을 다시 고른 전체식6.9962: 공통수준만 올려도 해결되지 않는다.
// 6개월 이상31점도 평균4.3488 vs 전체6.1345. 초기 관측1개월 매장만의 문제 아님.
// 입지잔차를 매겹 재적합한 전체식6.5704: 고정 잔차화 상수 때문에만 나온 결론 아님.
// 경쟁 추가(수요->수요+경쟁) 이득8.9822%p, 조건부CI[5.7308,12.1887].
// 입지 추가 이득.8831%p, CI[-.7598,2.7495]: 평균은 개선하나 확실성은 낮다.
// 전체식의 평균 대비 손해2.1522%p, 조건부CI[.3390,3.8801].
// 예: 청주지웰시티 실제43.91, 경쟁까지47.64, 입지까지33.50%.
// 증평 실제18.29, 경쟁까지16.81, 입지까지25.03%; 입지가 망치는 사례.
// 문경 실제30.64, 수요100%16.27%; 여전히 수요하한 문제.
// 주의: 수요만=모든 수요를 독식하는 반사실이므로16.39라는 수치만으로 수요식을 기각하지 않음.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fitHoursPerUser, type TextbookParams } from "./textbookModel";
import { evaluationMonths } from "./evaluationSalesPeriod";
import type { Competitor, ExistingStoreMonthlySales } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
it("가동률 구성요소 제거: 수요·경쟁·입지와 축척의 역할", () => {
  expect(hasValidationSnapshot(), "최신 validation-snapshot.json 필요").toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const snapshotHash = hash(".local-tools/validation-snapshot.json");
  const modelHash = hash("src/lib/storeEval/textbookModel.ts");
  const P = structuredClone(DEFAULT_TEXTBOOK_PARAMS);
  // 2026-09-21 저녁 Claude 갱신 — 사용자가 판정 기준을 가동률로 바꿔 감쇠를 다시 골랐다
  // (R300 λ150 -> R200 λ200 · wf 0.90 -> 0.9593). 이 잠금장치가 제 일을 해서 걸렸다.
  // ⚠️ 파일 머리에 적힌 Astra의 기준선 수치는 **옛 감쇠에서 잰 것**이라 아래 출력과 다르다.
  expect(P.rivalDistanceDecay).toEqual({ plateauM: 200, scaleM: 200, weightFactor: .9593 });
  expect(P.shareMode).toBe("quality");
  // 2026-09-22 — "안 가는 몫"을 다시 0으로 뺐다(하루만 20이었다. 정체가 반경 밖 경쟁점이다).
  expect(P.outsideOptionIp).toBe(0);
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
  const monthsByCode = new Map<string, number>();
  const rows = initialRows.map((row) => {
    const store = stores.find((s) => s.storeCode === row.input.storeCode)!;
    const window = evaluationMonths(store.openedAt);
    const complete = (snap.sales as ExistingStoreMonthlySales[]).filter((s) => s.storeCode === store.storeCode
      && window.includes(s.yearMonth) && (s.pcSales ?? 0) + (s.productSales ?? 0) > 0);
    const from2 = complete.filter((s) => window.indexOf(s.yearMonth) >= 1);
    const target = from2.length ? from2 : complete;
    expect(target.length).toBeGreaterThan(0);
    expect(target.every((s) => s.utilizationRate != null && s.utilizationRate > 0)).toBe(true);
    monthsByCode.set(row.input.storeCode, target.length);
    return { ...row, actualRevenue: 0, input: { ...row.input,
      actualUtilization: mean(target.map((s) => s.utilizationRate!)) } };
  });
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.every((r) => !r.excluded && (r.input.pcCount ?? 0) > 0)).toBe(true);
  expect(new Set(rows.map((r) => r.input.storeCode)).size).toBe(rows.length);
  const ids = rows.map((_, i) => i);
  const actual = rows.map((r) => r.input.actualUtilization!);
  const cap = P.maxUtilization;
  const stages = [false, true].flatMap((demand) => [false, true].flatMap((competition) =>
    [false, true].map((location) => ({ demand, competition, location,
      name: `${demand ? "수요" : "공통"}${competition ? "+경쟁" : ""}${location ? "+입지" : ""}` }))));
  type Stage = (typeof stages)[number];
  const full = stages.find((s) => s.demand && s.competition && s.location)!;
  const variants = (stage: Stage) => rows.map((r) => ({ ...r, input: { ...r.input,
    rivals: stage.competition ? r.input.rivals : [], location: stage.location ? r.input.location : null } }));
  const shapes = (stage: Stage, p: TextbookParams) => variants(stage).map((r) => {
    const b = computeTextbook({ ...r.input, actualUtilization: null }, { ...p, hoursPerUserPerMonth: 1, maxUtilization: Infinity });
    expect(b.utilization).not.toBeNull();
    expect(b.share).not.toBeNull();
    return stage.demand ? b.utilization! : b.share!;
  });
  const fitCentrality = (train: number[]): TextbookParams => {
    const pairs = train.map((i) => ({ c: rows[i].input.location?.centrality, f: rows[i].input.floatingByRadius[400] }))
      .filter((x): x is { c: number; f: number } => x.c != null && x.c > 0 && x.f != null && x.f > 0);
    expect(pairs.length).toBeGreaterThan(2);
    const mx = mean(pairs.map((x) => Math.log(x.f))), my = mean(pairs.map((x) => Math.log(x.c)));
    const xx = pairs.reduce((sum, x) => sum + (Math.log(x.f) - mx) ** 2, 0);
    const xy = pairs.reduce((sum, x) => sum + (Math.log(x.f) - mx) * (Math.log(x.c) - my), 0);
    return { ...P, centralityResidual: { slope: xx > 0 ? xy / xx : 0,
      geoMeanCentrality: Math.exp(my), geoMeanFloating400: Math.exp(mx) } };
  };
  const optimalScale = (x: number[], train: number[]) => {
    // 0, 실제 가동률과의 교점, 상한과의 교점: 구간선형 MAE가 꺾이는 모든 지점.
    const candidates = [0, ...train.flatMap((i) => [actual[i] / x[i], cap / x[i]])].filter(Number.isFinite).sort((a, b) => a - b);
    let best = candidates[0], error = Infinity;
    for (const a of candidates) {
      const loss = mean(train.map((i) => Math.abs(Math.min(cap, a * x[i]) - actual[i])));
      if (loss < error - 1e-12) { error = loss; best = a; }
    }
    return best;
  };
  const evaluate = (stage: Stage, calibration: "monopoly" | "all", refitResidual = false) => {
    const frozen = shapes(stage, P);
    const scales: number[] = [];
    const predictions = ids.map((held) => {
      const train = ids.filter((i) => i !== held);
      const p = refitResidual ? fitCentrality(train) : P;
      const x = refitResidual ? shapes(stage, p) : frozen;
      expect(x.every((v) => v > 0 && Number.isFinite(v))).toBe(true);
      const anchors = train.filter((i) => !(rows[i].input.competitorIp ?? 0));
      expect(anchors.length).toBeGreaterThan(0);
      const scale = calibration === "all" ? optimalScale(x, train)
        : Math.exp(mean(anchors.map((i) => Math.log(actual[i] / x[i]))));
      if (stage.demand && calibration === "monopoly") {
        // ⚠️ 2026-09-21 저녁 — 축척이 **원장 실측으로 못 박혔다**(hoursPerUserFixed). 이 줄은
        //    "내 앵커 적합이 본체의 적합과 같은가"를 보는 자리라 **옛 적합 경로**를 일부러 켠다.
        //    안 켜면 본체가 겹마다 같은 상수(8.20)를 돌려주므로 비교가 사라진다.
        const native = fitHoursPerUser(train.map((i) => variants(stage)[i]), { ...p, hoursPerUserFixed: false });
        // ⚠️ 2026-09-21 밤(3) Claude 수정 — 지수 눈금 보정을 켠 뒤 이 단언이 낡았다.
        // `fitHoursPerUser`가 돌려주는 건 **수요축척 H**이고, 여기 `scale`은 모양 x에
        // 곱하는 배율이다. 예측이 x ∝ (H·D·S)^b 이므로 배율은 H가 아니라 **H^b**다.
        // (실측: scale 2.0044 · native 8.3854 · 8.3854^0.327 = 2.0045.)
        // 바로 아래 예측값 항등식은 원래부터 통과했다 — 본체는 멀쩡하고 이 줄만 틀렸었다.
        const bExp = p.indexCalibration?.ratioExponent ?? 1;
        expect(scale).toBeCloseTo(Math.pow(native, bExp), 12);
        const nativePrediction = computeTextbook({ ...variants(stage)[held].input, actualUtilization: null }, { ...p, hoursPerUserPerMonth: native }).utilization;
        expect(Math.min(cap, x[held] * scale)).toBeCloseTo(nativePrediction!, 12);
      }
      scales.push(scale);
      return Math.min(cap, x[held] * scale);
    });
    const errors = predictions.map((v, i) => Math.abs(v - actual[i]));
    return { name: stage.name, calibration, refitResidual, predictions, errors, scales };
  };
  const anchored = stages.map((s) => evaluate(s, "monopoly"));
  const rescaled = stages.map((s) => evaluate(s, "all"));
  const reference = anchored.find((s) => s.name === full.name)!;
  type Result = typeof reference;
  const naive = (median: boolean): Result => {
    const predictions = ids.map((held) => {
      const pool = actual.filter((_, i) => i !== held).sort((a, b) => a - b);
      return median ? (pool[Math.floor(pool.length / 2)] + pool[Math.floor((pool.length - 1) / 2)]) / 2 : mean(pool);
    });
    return { name: median ? "훈련중앙값" : "훈련평균", calibration: "all", refitResidual: false,
      predictions, errors: predictions.map((v, i) => Math.abs(v - actual[i])), scales: [] };
  };
  const average = naive(false), median = naive(true);
  const ranked = [...ids].sort((a, b) => reference.errors[a] - reference.errors[b]);
  const quartiles = [0, 1, 2, 3].map((q) => ranked.slice(Math.floor(q * ids.length / 4), Math.floor((q + 1) * ids.length / 4)));
  const stable = ids.filter((i) => monthsByCode.get(rows[i].input.storeCode)! >= 6);
  const summary = (result: Result) => ({ name: result.name, calibration: result.calibration, refitResidual: result.refitResidual,
    MAEpp: mean(result.errors) * 100, MAPE: mean(result.errors.map((v, i) => v / actual[i])) * 100,
    biasPp: mean(result.predictions.map((v, i) => v - actual[i])) * 100,
    within5pp: result.errors.filter((v) => v <= .05).length, capped: result.predictions.filter((v) => v >= cap).length,
    quartileMAEpp: quartiles.map((g) => mean(g.map((i) => result.errors[i])) * 100),
    stableN: stable.length, stableMAEpp: mean(stable.map((i) => result.errors[i])) * 100,
    scaleRange: result.scales.length ? [Math.min(...result.scales), Math.max(...result.scales)] : [] });
  let seed = 20260921;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const contrast = (before: Result, after: Result) => {
    const diff = before.errors.map((v, i) => v - after.errors[i]);
    const bootstrap = Array.from({ length: 5000 }, () => mean(ids.map(() => diff[Math.floor(random() * ids.length)])))
      .sort((a, b) => a - b);
    return { before: before.name, after: after.name, calibration: before.calibration,
      gainPp: mean(diff) * 100, ciPp: [bootstrap[124] * 100, bootstrap[4874] * 100],
      better: diff.filter((v) => v > 1e-10).length, worse: diff.filter((v) => v < -1e-10).length };
  };
  const pairs = (results: Result[]) => [
    ["수요", "수요+경쟁"], ["수요", "수요+입지"], ["수요+경쟁", "수요+경쟁+입지"], ["수요+입지", "수요+경쟁+입지"],
  ].map(([a, b]) => contrast(results.find((r) => r.name === a)!, results.find((r) => r.name === b)!));
  console.log("[재현]", JSON.stringify({ snapshot: snap.fetchedAt, snapshotSha256: hash(".local-tools/validation-snapshot.json"),
    modelSha256: hash("src/lib/storeEval/textbookModel.ts"), n: rows.length, params: P,
    missingQsc: rows.filter((r) => !qscByStoreCode.has(r.input.storeCode)).map((r) => r.input.storeCode) }));
  console.log("[독점축척]", JSON.stringify(anchored.map(summary)));
  console.log("[전체훈련 축척: 진단용]", JSON.stringify(rescaled.map(summary)));
  console.log("[단순 기준]", JSON.stringify([summary(average), summary(median)]));
  console.log("[단계별 대비]", JSON.stringify([...pairs(anchored), ...pairs(rescaled), contrast(average, reference)]));
  console.log("[입지잔차 훈련재적합]", JSON.stringify([summary(evaluate(full, "monopoly", true)), summary(evaluate(full, "all", true))]));
  console.log("[매장별]", JSON.stringify(rows.map((row, i) => ({ name: row.input.storeName,
    actualPct: actual[i] * 100, months: monthsByCode.get(row.input.storeCode), meanPct: average.predictions[i] * 100,
    predictionsPct: Object.fromEntries(anchored.filter((r) => r.name.startsWith("수요")).map((r) => [r.name, r.predictions[i] * 100])) }))));
  // 자료/본체가 실행 중 바뀌었으면 같은 결과로 간주하지 않도록 검사.
  expect(DEFAULT_TEXTBOOK_PARAMS).toEqual(P);
  expect(hash(".local-tools/validation-snapshot.json")).toBe(snapshotHash);
  expect(hash("src/lib/storeEval/textbookModel.ts")).toBe(modelHash);
});
