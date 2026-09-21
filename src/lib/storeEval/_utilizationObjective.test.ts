// 2026-09-21 사용자 지시: 단가를 분리하고 가동률부터 맞춘다. 본체/운영 수정 없음.
// 사전 규칙: 주지표는 매장 동일가중 가동률 MAE(%p), MAPE/편향/±5%p는 보조.
// 매출 평가월(+2~12, 없으면+1~12)의 실측 가동률 평균을 목표로 고정.
// 매출은 완료월 식별/기존 대상38점 선정에만 사용. 조립 후 actualRevenue=0으로 지워
// 계수 선택/적합/채점에 실매출이 들어가지 않도록 한다. 단가 재적합도 하지 않는다.
// 독점 실측 가동률로 훈련겹마다 축척 적합. 홀드아웃 실제 가동률은 예측에 전달하지 않음.
// 후보: rho=[0,.05,.1,.15,.2,.3], nu=[1,.95,.9,.85,.8,.7]. 외부 LOO 안의 내부 LOO MAE로 선택.
// 점유율 하한 vs 거듭제곱은 이전 매출실험과 동일 범위: 목표 전환 효과만 검정한다.
// 중립 중첩/점유율 단조성 검사. 기준오차 Q1/Q2 고정, 각각 악화<=.5%p.
// 채택 근거: 기준/대조군 대비 MAE 개선 및 조건부 paired-bootstrap CI 하한>0.
// b/r은 보조 진단으로 출력하며 단독 채택 기준이 아니다. OOF bootstrap은 훈련겹 의존성을 미반영.
// 고정후보 전체 LOO는 선택 불안정성 진단용. 사후 최솟값을 검증 성적으로 쓰지 않는다.
// 수요/점유율은 가동률만으로도 식별되지 않는다. 문경 같은 수요하한 초과는 별도 과제.
// 실행: npx vitest run src/lib/storeEval/_utilizationObjective.test.ts --disable-console-intercept
// 첫 측정: snapshot 2026-09-21T02:17:08.861Z, n=38, 모두 같은 매출기간 가동률.
// 기준 LOO MAE6.5257%p/MAPE20.8225%, floor5.9270%p/18.9147%, power6.1848%p.
// floor rho=.1은 38/38 내부겹에서 선택. 개선 .5986%p, 조건부95%CI[-.4816,1.6417].
// 원래 잘 맞던 Q1은1.2407->2.8714%p: 가운데 보호 관문 미달, 아직 채택 근거 부족.
// 후속 단순 기준: 훈련평균4.3735%p/중앙값4.3961%p, ±5%p 26/38점.
// 현재 산식16/38, floor17/38. 이 표본에서 공통 가동률보다도 큰 오차가 남는다.
// 단순 평균을 모든 후보지에 적용한다는 결론이 아니라 상세 산식의 추가 설명력 검증 기준이다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fitHoursPerUser, rivalDistanceWeight } from "./textbookModel";
import { evaluationMonths } from "./evaluationSalesPeriod";
import type { Competitor, ExistingStoreMonthlySales } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Shape = { name: string; family: "floor" | "power"; value: number };
const FLOOR: Shape[] = [0, .05, .1, .15, .2, .3].map((value) => ({ name: `rho=${value}`, family: "floor", value }));
const POWER: Shape[] = [1, .95, .9, .85, .8, .7].map((value) => ({ name: `nu=${value}`, family: "power", value }));

it("가동률 전용: 동일기간, nested LOO MAE로 선택", () => {
  expect(hasValidationSnapshot(), "최신 validation-snapshot.json 필요").toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const P = structuredClone(DEFAULT_TEXTBOOK_PARAMS);
  // 2026-09-21 저녁 Claude 갱신 — 사용자가 판정 기준을 가동률로 바꿔 감쇠를 다시 골랐고
  // (R300 λ150 → R200 λ200 · wf 0.90 → 0.9593), 그 뒤 **지수 눈금 보정**도 채택했다
  // (indexCalibration b=0.327 · c=0.169). 이 잠금장치가 제 일을 해서 걸렸다.
  // ⚠️ 파일 머리에 적힌 Astra의 기준선 수치(LOO MAE 6.5257%p 등)는 **옛 산식에서 잰 것**이라
  //    지금 출력과 다르다. 다시 돌려 새로 적을 것.
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
  const rows = initialRows.map((row) => {
    const store = stores.find((s) => s.storeCode === row.input.storeCode)!;
    const window = evaluationMonths(store.openedAt);
    const complete = (snap.sales as ExistingStoreMonthlySales[]).filter((s) => s.storeCode === store.storeCode
      && window.includes(s.yearMonth) && (s.pcSales ?? 0) + (s.productSales ?? 0) > 0);
    const from2 = complete.filter((s) => window.indexOf(s.yearMonth) >= 1);
    const target = from2.length ? from2 : complete;
    expect(target.length).toBeGreaterThan(0);
    expect(target.every((s) => s.utilizationRate != null && s.utilizationRate > 0)).toBe(true);
    return { ...row, actualRevenue: 0, input: { ...row.input,
      actualUtilization: mean(target.map((s) => s.utilizationRate!)) } };
  });
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.every((r) => !r.excluded && (r.input.pcCount ?? 0) > 0)).toBe(true);
  for (const row of rows) {
    expect(computeTextbook(row.input, { ...P, productUnitPrice: 9999, referenceHourlyRate: 5000 }).utilization)
      .toEqual(computeTextbook(row.input, P).utilization);
  }
  const ids = rows.map((_, i) => i);
  const ratio = (row: LabRow) => {
    const own = row.input.ownQualityParts ? computeQualityScore(row.input.ownQualityParts, P.qualityWeights) : null;
    const mass = (row.input.rivals ?? []).reduce((sum, rival) => {
      const quality = rival.parts ? computeQualityScore(rival.parts, P.qualityWeights) : null;
      const q = own != null && own > 0 && quality != null && quality > 0 ? quality / own : 1;
      const decay = rivalDistanceWeight(rival.distanceM, P);
      return sum + rival.ip * q ** P.qualityExponent * decay;
    }, 0);
    return mass / row.input.pcCount!;
  };
  const competition = rows.map(ratio);
  const transformed = (shape: Shape) => rows.map((row, i) => {
    const C = competition[i];
    const factor = C === 0 ? 1 : shape.family === "floor"
      ? (1 - shape.value) / (1 + shape.value * C)
      : (Math.pow(1 + C, shape.value) - 1) / C;
    return { ...row, input: { ...row.input, rivals: (row.input.rivals ?? []).map((v) => ({ ...v, ip: v.ip * factor })) } };
  });
  const all = [...FLOOR, ...POWER];
  const data = new Map(all.map((shape) => [shape.name, transformed(shape)]));
  for (const shape of [FLOOR[0], POWER[0]]) {
    rows.forEach((row, i) => {
      const a = computeTextbook(row.input, P), b = computeTextbook(data.get(shape.name)![i].input, P);
      expect(b.monthlyRevenue).toBeCloseTo(a.monthlyRevenue!, 6);
      expect(b.share).toBeCloseTo(a.share!, 12);
    });
  }
  for (const shape of FLOOR) {
    const values = [0, .1, .5, 1, 5, 10, 100].map((c) => shape.value + (1 - shape.value) / (1 + c));
    expect(values[0]).toBe(1);
    expect(values.every((v, i) => v > shape.value && (i === 0 || v <= values[i - 1]))).toBe(true);
    // 입지 항을 잠시 끈 검증에서 원하는 rawShare와 실제 본체 결과가 맞는지 검사.
    data.get(shape.name)!.forEach((row, i) => {
      const actual = computeTextbook({ ...row.input, location: null }, P).share;
      expect(actual).toBeCloseTo(shape.value + (1 - shape.value) / (1 + competition[i]), 12);
    });
  }
  console.log("[재현]", JSON.stringify({ snapshot: snap.fetchedAt, n: rows.length,
    snapshotSha256: hash(".local-tools/validation-snapshot.json"), modelSha256: hash("src/lib/storeEval/textbookModel.ts"),
    params: P, affected: competition.filter((c) => c > 0).length }));
  // 예측 함수에는 held의 실제값을 전달하지 않는다. 채점은 반환 이후 별도로 수행.
  const predict = (shape: Shape, train: number[], held: number) => {
    const source = data.get(shape.name)!;
    const trainRows = train.map((i) => source[i]);
    expect(trainRows.some((r) => !(r.input.competitorIp ?? 0) && r.input.actualUtilization! > 0)).toBe(true);
    const p = { ...P, hoursPerUserPerMonth: fitHoursPerUser(trainRows, P) };
    const fitted = { ...p, productUnitPrice: 0 };
    const input = { ...source[held].input, actualUtilization: null };
    const out = computeTextbook(input, fitted);
    const noShare = computeTextbook(input, { ...fitted, shareMode: "off", maxUtilization: Infinity });
    expect(out.utilization).not.toBeNull();
    return { utilization: out.utilization!, share: out.share!, noShare: noShare.utilization! };
  };
  const cache = new Map<string, ReturnType<typeof predict>>();
  const cached = (shape: Shape, train: number[], held: number) => {
    const key = `${shape.name}|${held}|${train.join(",")}`;
    let value = cache.get(key);
    if (!value) { value = predict(shape, train, held); cache.set(key, value); }
    return value;
  };
  const choose = (shapes: Shape[], train: number[]) => {
    let best = shapes[0], bestError = Infinity;
    for (const shape of shapes) {
      const error = mean(train.map((held) => Math.abs(cached(shape, train.filter((i) => i !== held), held).utilization - rows[held].input.actualUtilization!)));
      if (error < bestError - 1e-12) { best = shape; bestError = error; }
    }
    return best;
  };
  const run = (shapes: Shape[], tune: boolean) => {
    const selected: string[] = [];
    const outputs = ids.map((held) => {
      const train = ids.filter((i) => i !== held);
      const shape = tune ? choose(shapes, train) : shapes[0];
      selected.push(shape.name);
      return cached(shape, train, held);
    });
    const errors = outputs.map((v, i) => Math.abs(v.utilization - rows[i].input.actualUtilization!));
    const pairs = outputs.map((v, i) => ({ x: Math.log(v.share), y: Math.log((rows[i].input.actualUtilization ?? 0) / v.noShare) }))
      .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    const mx = mean(pairs.map((v) => v.x)), my = mean(pairs.map((v) => v.y));
    const xx = pairs.reduce((s, v) => s + (v.x - mx) ** 2, 0), yy = pairs.reduce((s, v) => s + (v.y - my) ** 2, 0);
    const xy = pairs.reduce((s, v) => s + (v.x - mx) * (v.y - my), 0);
    return { predictions: outputs.map((v) => v.utilization), errors, mae: mean(errors), b: xy / xx, r: xy / Math.sqrt(xx * yy), selected };
  };
  const base = run(FLOOR, false), floor = run(FLOOR, true), power = run(POWER, true);
  // 목표 전환에 따른 진단용 단순 기준. 결과를 본 뒤 모형 후보를 더 탐색하지 않는다.
  // 각 홀드아웃은 훈련매장의 가동률 평균/중앙값만 사용한다. 실매출/자기 목표값 제외.
  const naive = (median: boolean) => {
    const predictions = ids.map((held) => {
      const values = rows.filter((_, i) => i !== held).map((r) => r.input.actualUtilization!).sort((a, b) => a - b);
      return median ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : mean(values);
    });
    const errors = predictions.map((v, i) => Math.abs(v - rows[i].input.actualUtilization!));
    return { ...base, predictions, errors, mae: mean(errors), b: NaN, r: NaN, selected: ids.map(() => median ? "훈련중앙값" : "훈련평균") };
  };
  const meanReference = naive(false), medianReference = naive(true);
  const ranked = [...ids].sort((a, b) => base.errors[a] - base.errors[b]);
  const groups = [0, 1, 2, 3].map((q) => ranked.slice(Math.floor(q * ids.length / 4), Math.floor((q + 1) * ids.length / 4)));
  const summary = (label: string, x: typeof base) => ({ label, MAEpp: 100 * x.mae, MAPE: 100 * mean(x.errors.map((v, i) => v / rows[i].input.actualUtilization!)), biasPp: 100 * mean(x.predictions.map((v, i) => v - rows[i].input.actualUtilization!)), within5pp: x.errors.filter((v) => v <= .05).length, b: x.b, r: x.r,
    quartiles: groups.map((g) => 100 * mean(g.map((i) => x.errors[i]))),
    selected: x.selected.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}) });
  console.log("[nested LOO]", JSON.stringify([summary("기준", base), summary("floor", floor), summary("power 대조", power)]));
  console.log("[단순 기준]", JSON.stringify([summary("훈련평균", meanReference), summary("훈련중앙값", medianReference)]));
  // 선택 불안정성 설명용 기술통계. 전 표본에서 좋은 상수를 고른 성적은 채택 근거로 쓰지 않는다.
  console.log("[고정 후보별 LOO: 사후 선택 금지]", JSON.stringify(all.map((s) => summary(s.name, run([s], false)))));
  let state = 20260921;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const compare = (reference: typeof base) => {
    const gains = reference.errors.map((v, i) => v - floor.errors[i]);
    const boot = Array.from({ length: 5000 }, () => mean(ids.map(() => gains[Math.floor(random() * ids.length)]))).sort((a, b) => a - b);
    return { gainPp: mean(gains) * 100, ciPp: [boot[124] * 100, boot[4874] * 100] };
  };
  const vsBase = compare(base), vsPower = compare(power);
  console.log("[단순 기준 대비 floor 개선]", JSON.stringify({ mean: compare(meanReference), median: compare(medianReference) }));
  const middle = groups.slice(0, 2).map((g) => mean(g.map((i) => floor.errors[i] - base.errors[i])) * 100);
  const gates = { loo: vsBase.gainPp > 0 && vsPower.gainPp > 0,
    middle: middle.every((v) => v <= .5), bootstrap: vsBase.ciPp[0] > 0 && vsPower.ciPp[0] > 0 };
  console.log("[판정]", JSON.stringify({ vsBase, vsPower, middleWorseningPp: middle, gates,
    conclusion: Object.values(gates).every(Boolean) ? "추가 검증 후보" : "채택 근거 부족" }));
  console.log("[매장별 가동률]", JSON.stringify(rows.map((row, i) => ({ name: row.input.storeName,
    actualPct: 100 * row.input.actualUtilization!, basePct: 100 * base.predictions[i],
    floorPct: 100 * floor.predictions[i], powerPct: 100 * power.predictions[i] }))));
}, 120000);
