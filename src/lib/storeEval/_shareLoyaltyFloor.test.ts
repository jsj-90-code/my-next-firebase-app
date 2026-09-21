// Astra 독립 함수형 실험, 2026-09-21. 본체 수정 없이 입력 복제만 사용.
// 사전 관문: 매출을 보기 전에 아래 후보·판정 규칙을 고정한다.
// 가설: 기존 rawShare=s의 일부 rho는 경쟁과 무관한 선호수요이다.
//   s' = rho + (1-rho)*s. 수요/품질/거리/입지/상한/단가는 기존 그대로.
//   C=품질·거리 반영 경쟁무게/자사PC, s=1/(1+C),
//   C'=C*(1-rho)/(1+rho*C). 따라서 경쟁IP만 동일 비율로 바꾸면 본체를 재사용한다.
// 0. rho=0/nu=1 중첩 일치, 경쟁강도 증가 시 점유율 단조감소 확인.
// 1. 후보 rho=[0,.05,.10,.15,.20,.30]. 매장별 상수/예외 없음.
// 2. 기존 기각된 s^nu는 재채택 탐색이 아니라 같은 1자유도 양성 대조군:
//    nu=[1,.95,.90,.85,.80,.70]. 후보 수를 동일하게 맞춘다.
// 3. 바깥 LOO 각 훈련겹 안의 inner LOO MAPE로 후보 선택(동률은 중립).
//    모든 inner/outer 겹에서 수요축척·상품몫을 훈련점만으로 재적합.
// 4. 기준 LOO 절대오차로 고정한 Q1/Q2 각각 악화 <=1%p.
// 5. 기준 및 거듭제곱 대조군보다 MAPE 개선, b의 1과의 거리 감소, r 비감소.
// 6. 두 비교 각각 짝지은 매장 bootstrap 5000회 CI 하한>0.
//    선택은 nested LOO지만 bootstrap은 고정된 OOF 오차를 재표집한 조건부 구간:
//    겹치는 훈련겹 의존성을 반영하지 않는다. 새 표본의 독립 재현이 필요하다.
// 방향 같은 독립 정보가 없는 함수형이므로 매장 내 방향 섞기를 적용하지 않는다.
// 3독점 적합이 수요 전반의 타당성을 증명하지는 않는다. 이 파일은 수요를 고정한 비교다.
// 자료 없으면 skip하지 않고 실패한다. 원자료/설정/본체 해시로 결과 버전을 남긴다.
// 실행: npx vitest run src/lib/storeEval/_shareLoyaltyFloor.test.ts --disable-console-intercept
//
// 2026-09-21 첫 측정 (관문 유지): snapshot=2026-09-21T02:06:11.653Z,
// SHA256=f75b4050954f5b04ad87dd2d6f061e09213d681ac2ce77498e6bcd6a03fe3a9e, n=38.
// 기준 21.1084%, nested floor 24.3856%, nested power 22.4175%.
// floor 개선(대 기준) -3.2772%p, 95% CI [-5.9283,-1.0902];
// 대 power -1.9681%p, CI [-3.6531,-.4757]. Q1/Q2 악화 +3.5719/+4.2132%p.
// floor 선택 rho .05=20겹 / .10=12겹 / 0=6겹: 고정 상수보다 선택 자체가 불안정.
// 기술통계: 고정 rho=.05 LOO=20.9812%, b=.8360, r=.8130으로 좋아 보이나
// Q1 5.1731->6.5696%, Q2 12.9843->14.1505%로 두 가운데 관문 모두 미달.
// rho=.15는 b=.9672로 1에 가까워져도 MAPE=21.6187%, r=.8043으로 악화.
// 결론: 기울기만 1에 가는 것은 개선 증거가 아니다. 본체 반영 근거 없음.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fitHoursPerUser, fitProductUnitPrice, rivalDistanceWeight } from "./textbookModel";
import type { Competitor } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Shape = { name: string; family: "floor" | "power"; value: number };
const FLOOR: Shape[] = [0, .05, .1, .15, .2, .3].map((value) => ({ name: `rho=${value}`, family: "floor", value }));
const POWER: Shape[] = [1, .95, .9, .85, .8, .7].map((value) => ({ name: `nu=${value}`, family: "power", value }));

it("점유율 하한 vs 거듭제곱: nested LOO로 함수형을 비교한다", () => {
  expect(hasValidationSnapshot(), "최신 validation-snapshot.json 필요").toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const P = structuredClone(DEFAULT_TEXTBOOK_PARAMS);
  // 2026-09-21 저녁 Claude 갱신 — 감쇠가 R300 λ150 → R200 λ200(wf 0.9593)로 바뀌고
  // 지수 눈금 보정(indexCalibration)도 채택됐다. 이 잠금장치가 그 변화를 잡아 걸렸다.
  // ⚠️ 이 파일이 기록해 둔 기준선 수치는 옛 산식 것이라 지금 출력과 다르다.
  expect(P.rivalDistanceDecay).toEqual({ plateauM: 200, scaleM: 200, weightFactor: .9593 });
  expect(P.shareMode).toBe("quality");
  // 2026-09-21 밤 채택 — 독점매장에서 관측한 "안 가는 몫" 20대(그전엔 0). 아래 기록은 0일 때 값이다.
  expect(P.outsideOptionIp).toBe(20);
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
  const rows = buildLabRows({ stores, compsByCode, settings, qscByStoreCode,
    utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores) });
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.every((r) => !r.excluded && r.actualRevenue > 0 && (r.input.pcCount ?? 0) > 0)).toBe(true);
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
    const p = { ...P, hoursPerUserPerMonth: fitHoursPerUser(trainRows, P) };
    const fitted = { ...p, productUnitPrice: fitProductUnitPrice(trainRows, p) };
    const input = { ...source[held].input, actualUtilization: null };
    const out = computeTextbook(input, fitted);
    const noShare = computeTextbook(input, { ...fitted, shareMode: "off", maxUtilization: Infinity });
    expect(out.monthlyRevenue).not.toBeNull();
    return { revenue: out.monthlyRevenue!, share: out.share!, noShare: noShare.utilization! };
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
      const error = mean(train.map((held) => Math.abs(cached(shape, train.filter((i) => i !== held), held).revenue / rows[held].actualRevenue - 1)));
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
    const errors = outputs.map((v, i) => Math.abs(v.revenue / rows[i].actualRevenue - 1));
    const pairs = outputs.map((v, i) => ({ x: Math.log(v.share), y: Math.log((rows[i].input.actualUtilization ?? 0) / v.noShare) }))
      .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    const mx = mean(pairs.map((v) => v.x)), my = mean(pairs.map((v) => v.y));
    const xx = pairs.reduce((s, v) => s + (v.x - mx) ** 2, 0), yy = pairs.reduce((s, v) => s + (v.y - my) ** 2, 0);
    const xy = pairs.reduce((s, v) => s + (v.x - mx) * (v.y - my), 0);
    return { errors, mape: mean(errors), b: xy / xx, r: xy / Math.sqrt(xx * yy), selected };
  };
  const base = run(FLOOR, false), floor = run(FLOOR, true), power = run(POWER, true);
  const ranked = [...ids].sort((a, b) => base.errors[a] - base.errors[b]);
  const groups = [0, 1, 2, 3].map((q) => ranked.slice(Math.floor(q * ids.length / 4), Math.floor((q + 1) * ids.length / 4)));
  const summary = (label: string, x: typeof base) => ({ label, MAPE: 100 * x.mape, b: x.b, r: x.r,
    quartiles: groups.map((g) => 100 * mean(g.map((i) => x.errors[i]))),
    selected: x.selected.reduce<Record<string, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}) });
  console.log("[nested LOO]", JSON.stringify([summary("기준", base), summary("floor", floor), summary("power 대조", power)]));
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
  const middle = groups.slice(0, 2).map((g) => mean(g.map((i) => floor.errors[i] - base.errors[i])) * 100);
  const gates = { loo: vsBase.gainPp > 0 && vsPower.gainPp > 0,
    structure: Math.abs(floor.b - 1) < Math.abs(base.b - 1) && floor.r >= base.r,
    middle: middle.every((v) => v <= 1), bootstrap: vsBase.ciPp[0] > 0 && vsPower.ciPp[0] > 0 };
  console.log("[판정]", JSON.stringify({ vsBase, vsPower, middleWorseningPp: middle, gates,
    conclusion: Object.values(gates).every(Boolean) ? "추가 검증 후보" : "채택 근거 부족" }));
}, 120000);
