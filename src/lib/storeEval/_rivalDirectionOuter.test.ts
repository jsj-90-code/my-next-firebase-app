// Astra 독립 실험, 2026-09-21. 산식 본체/운영/Firestore 쓰기 없음.
// 사전 관문 (최초 실행 전에 고정):
// 0. 300m < 거리 <= 800m, 좌표/8방위 자료가 있는 영향 매장 >= 5.
// 1. 방향은 음식점·카페 수의 대리지표이지 실측 유동/보행 동선이 아니다.
//    실매출·가동률은 방향 생성/선택에 쓰지 않는다. 입지 방향 지수는 0이어야 한다.
// 2. alpha=0이면 채택된 {300,150,0.90} 산식과 완전히 일치.
// 3. 주가설 alpha=0.5 고정: ip *= 1 + alpha*(방향 업소수/8방위 평균 - 1).
//    가까운/800m 밖/결측 경쟁점은 그대로. 품질·감쇠 반영 외곽 경쟁총량을
//    훈련겹의 전역 k 하나로 보존한다. 축척·상품몫도 훈련겹만 사용.
//    alpha=-0.5는 부호 반전 진단만: 좋은 쪽을 사후 채택하지 않는다.
// 4. 기준 LOO 절대오차 순서로 고정한 Q1/Q2 모두 악화 <= 1%p.
// 5. 매장마다 8방위 지도를 무작위 회전(499회). 경쟁 1곳도 대조 가능.
//    거리·품질·경쟁점끼리 상대방향 보존. 한쪽 permutation p <= .05.
// 6. 고정 모형의 짝지은 매장 bootstrap 5000회, MAPE 개선 95% CI 하한 > 0.
//    겹치는 LOO 훈련겹의 의존성은 이 구간이 반영하지 않으므로 조건부 진단이다.
//    b의 1과의 거리 감소 + r 비감소도 필요. 하나라도 미달이면 채택 근거 아님.
// 로컬 원자료가 없으면 명시적으로 실패한다(조용한 skip 금지).
// 실행: npx vitest run src/lib/storeEval/_rivalDirectionOuter.test.ts --disable-console-intercept
//
// 2026-09-21 첫 측정 (아래 관문/가설은 결과에 맞춰 변경하지 않음):
// snapshot=2026-09-21T02:06:11.653Z, SHA256=f75b4050954f5b04ad87dd2d6f061e09213d681ac2ce77498e6bcd6a03fe3a9e
// 38점, 영향 15점, 외곽 28경쟁점 모두 방향 연결 가능, 좌표 불일치 0.
// 기준 LOO 21.1084%, 방향 21.2690%; 개선 -0.1606%p, 회전 대조 p=.852,
// 짝지은 개선 95% CI [-.5142,+.1345]%p. b .7632->.7614, r .8123->.8111.
// Q1/Q2 악화 +.0293/+.5553%p. 결론: 이 대리지표/고정 강도는 채택 근거 부족.
// 반대 부호 20.7675%는 사후 선택 대상이 아니며 독립 검증 전 채택하지 않는다.
// 업소수 원자료는 2026-09-18 수집, 중심을 300m 이동한 반경300m 원 8개.
// 600~800m 경쟁점 방향은 관측 범위 밖 외삽이고, 진짜 보행 동선을 검정한 것은 아니다.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { loadValidationSnapshot, hasValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, rivalDistanceM, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation, existingStoreSourceCode } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fitHoursPerUser, fitProductUnitPrice, rivalDistanceWeight } from "./textbookModel";
import { computeCompetitorAppliedPcCount } from "./calc";
import type { Competitor } from "./types";

const DIR_FILE = ".local-tools/kakao-directional.json";
const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const rng = (initial: number) => {
  let state = initial >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
};
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Direction = { lat: number; lng: number; byDir: Record<string, number | null> };
type Rival = NonNullable<LabRow["input"]["rivals"]>[number];
type Evidence = { weights: number[]; sector: number } | null;

it("300~800m 경쟁 방향: 사전 고정 가설, LOO, 회전 대조군, 짝지은 구간", () => {
  expect(hasValidationSnapshot(), "node scripts/dumpValidationSnapshot.mjs 먼저 실행").toBe(true);
  expect(existsSync(DIR_FILE), "방향 원자료가 필요합니다").toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const direction = JSON.parse(readFileSync(DIR_FILE, "utf8")) as {
    collectedAt: string; radiusM: number; stepM: number; categories: string[]; sites: Record<string, Direction>;
  };
  const P = structuredClone(DEFAULT_TEXTBOOK_PARAMS);
  // 2026-09-21 저녁 Claude 갱신 — 감쇠가 R300 λ150 → R200 λ200(wf 0.9593)로 바뀌고
  // 지수 눈금 보정(indexCalibration)도 채택됐다. 이 잠금장치가 그 변화를 잡아 걸렸다.
  // ⚠️ 이 파일이 기록해 둔 기준선 수치는 옛 산식 것이라 지금 출력과 다르다.
  expect(P.rivalDistanceDecay).toEqual({ plateauM: 200, scaleM: 200, weightFactor: 0.9593 });
  expect(P.shareMode).toBe("quality");
  expect(P.locationExponents.direction).toBe(0);
  const settings = mergeModelSettings(snap.settings);
  const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of competitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, competitors, snap.locationEvaluations, settings);
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const qscByStoreCode = new Map<string, number>();
  for (const site of (snap.labQscScores ?? []) as QscSite[]) {
    const code = site.storeCode ?? site.id;
    const value = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (code && value != null) qscByStoreCode.set(code, value);
  }
  expect(qscByStoreCode.size, "현재 스냅샷 QSC를 사용하며 낡은 별도 파일로 대체하지 않음").toBeGreaterThan(0);
  const rows = buildLabRows({ stores, compsByCode, settings, qscByStoreCode,
    utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores) });
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.every((r) => !r.excluded && r.actualRevenue > 0)).toBe(true);
  expect(new Set(rows.map((r) => r.input.storeCode)).size).toBe(rows.length);
  const n = rows.length;
  const ids = rows.map((_, i) => i);
  const evidence: Evidence[][] = [];
  let ring = 0, covered = 0, coordinateMismatch = 0;
  for (const row of rows) {
    const store = stores.find((s) => s.storeCode === row.input.storeCode)!;
    // ⚠️ 2026-09-21 저녁 Claude 갱신 — `labInput`이 대수 결측을 운영과 같은 함수
    //    `computeCompetitorAppliedPcCount`로 채우게 바뀌었다(간략·노후저경쟁력미조사 = 90대).
    //    여기서 옛 필터(appliedPcCount ?? totalPcCount)를 쓰면 `rivals`보다 적게 잡혀
    //    아래 개수 대조가 깨진다. 산식과 **같은 함수**를 쓴다.
    const cs = (compsByCode.get(existingStoreSourceCode(store)) ?? [])
      .filter((c) => c.investigationStatus !== "경쟁점없음" && (computeCompetitorAppliedPcCount(c) ?? 0) > 0);
    const rivals = row.input.rivals ?? [];
    expect(cs.length).toBe(rivals.length);
    const d = direction.sites[`existing:${store.storeCode}`];
    const counts = d ? DIRS.map((dir) => d.byDir[dir]) : [];
    const valid = counts.length === 8 && counts.every((v) => v != null && Number.isFinite(v) && v >= 0)
      && mean(counts as number[]) > 0;
    const sameCenter = d && store.lat != null && store.lng != null
      && Math.abs(d.lat - store.lat) < 0.0001 && Math.abs(d.lng - store.lng) < 0.0001;
    if (d && !sameCenter) coordinateMismatch++;
    evidence.push(rivals.map((v, j) => {
      const c = cs[j];
      expect(v.distanceM).toEqual(rivalDistanceM(store, c));
      expect(v.name).toEqual(c.name ?? null);
      if (v.distanceM == null || v.distanceM <= 300 || v.distanceM > 800) return null;
      ring++;
      if (!valid || !sameCenter || c.lat == null || c.lng == null) return null;
      const angle = Math.atan2((c.lng - store.lng!) * Math.cos(store.lat! * Math.PI / 180), c.lat - store.lat!);
      const sector = Math.round(((angle * 180 / Math.PI + 360) % 360) / 45) % 8;
      covered++;
      return { sector, weights: (counts as number[]).map((v) => v / mean(counts as number[]) - 1) };
    }));
  }
  const mass = (row: LabRow, v: Rival) => {
    const own = row.input.ownQualityParts ? computeQualityScore(row.input.ownQualityParts, P.qualityWeights) : null;
    const rival = v.parts ? computeQualityScore(v.parts, P.qualityWeights) : null;
    const ratio = own != null && own > 0 && rival != null && rival > 0 ? rival / own : 1;
    return v.ip * ratio ** P.qualityExponent * rivalDistanceWeight(v.distanceM, P);
  };
  const masses = rows.map((row) => (row.input.rivals ?? []).map((v) => mass(row, v)));
  const factors = (alpha: number, rotations: number[]) => evidence.map((es, i) =>
    es.map((e) => e ? 1 + alpha * e.weights[(e.sector + rotations[i]) % 8] : 1));
  const normalized = (fs: number[][], train: number[]) => {
    let before = 0, after = 0;
    for (const i of train) for (let j = 0; j < fs[i].length; j++) {
      if (!evidence[i][j]) continue;
      before += masses[i][j]; after += masses[i][j] * fs[i][j];
    }
    const k = after > 0 ? before / after : 1;
    return { k, transformed: rows.map((row, i) => ({ ...row, input: { ...row.input,
      rivals: (row.input.rivals ?? []).map((v, j) => evidence[i][j] ? { ...v, ip: v.ip * fs[i][j] * k } : v),
    } })) };
  };
  const neutral = factors(0, ids.map(() => 0));
  const neutralRows = normalized(neutral, ids).transformed;
  rows.forEach((row, i) => expect(computeTextbook(neutralRows[i].input, P)).toEqual(computeTextbook(row.input, P)));
  const affected = evidence.filter((es) => es.some((e) => e && Math.abs(e.weights[e.sector]) > 1e-9)).length;
  console.log(JSON.stringify({ snapshot: snap.fetchedAt, directionCollectedAt: direction.collectedAt,
    snapshotSha256: hash(".local-tools/validation-snapshot.json"), directionSha256: hash(DIR_FILE),
    modelSha256: hash("src/lib/storeEval/textbookModel.ts"), params: P,
    n, affected, ring, covered, coordinateMismatch, proxy: { stepM: direction.stepM, radiusM: direction.radiusM, categories: direction.categories } }));
  if (affected < 5) { console.log("관문0 미달: 영향 매장 5곳 미만, 검정력 부족으로 판정 보류"); return; }
  // QSC는 예측 시 관측 가능한 설명변수. 아래 축척 및 상품몫은 목표값에 적합하므로 반드시 LOO.
  const evaluate = (fs: number[][]) => {
    const errors: number[] = [], logShare: number[] = [], logRequired: number[] = [], ks: number[] = [];
    for (const held of ids) {
      const train = ids.filter((i) => i !== held);
      const { k, transformed } = normalized(fs, train);
      const fitRows = train.map((i) => transformed[i]);
      const scale = fitHoursPerUser(fitRows, P);
      const scaled = { ...P, hoursPerUserPerMonth: scale };
      const fitted = { ...scaled, productUnitPrice: fitProductUnitPrice(fitRows, scaled) };
      const result = computeTextbook(transformed[held].input, fitted);
      expect(result.monthlyRevenue).not.toBeNull();
      errors.push(Math.abs(result.monthlyRevenue! / rows[held].actualRevenue - 1));
      const without = computeTextbook(transformed[held].input, { ...fitted, shareMode: "off", maxUtilization: Infinity });
      const actual = rows[held].input.actualUtilization;
      if (actual != null && actual > 0 && without.utilization != null && without.utilization > 0 && result.share != null && result.share > 0) {
        logShare.push(Math.log(result.share)); logRequired.push(Math.log(actual / without.utilization));
      }
      ks.push(k);
    }
    const mx = mean(logShare), my = mean(logRequired);
    const xx = logShare.reduce((sum, x) => sum + (x - mx) ** 2, 0);
    const yy = logRequired.reduce((sum, y) => sum + (y - my) ** 2, 0);
    const xy = logShare.reduce((sum, x, i) => sum + (x - mx) * (logRequired[i] - my), 0);
    return { errors, mape: mean(errors), b: xy / xx, r: xy / Math.sqrt(xx * yy), ks, structureN: logShare.length };
  };
  const base = evaluate(neutral);
  const realFactors = factors(.5, ids.map(() => 0));
  expect(realFactors.flat().every((v) => v > 0)).toBe(true);
  const real = evaluate(realFactors);
  const normalizedAll = normalized(realFactors, ids);
  const total = (source: LabRow[]) => source.reduce((s, row) => s + (row.input.rivals ?? []).reduce((t, v) => t + mass(row, v), 0), 0);
  expect(total(normalizedAll.transformed)).toBeCloseTo(total(rows), 8);
  const ranking = [...ids].sort((a, b) => base.errors[a] - base.errors[b]);
  const groups = [0, 1, 2, 3].map((q) => ranking.slice(Math.floor(q * n / 4), Math.floor((q + 1) * n / 4)));
  const summary = (label: string, result: ReturnType<typeof evaluate>) => ({ label,
    MAPE: result.mape * 100, b: result.b, r: result.r, structureN: result.structureN,
    quartiles: groups.map((g) => mean(g.map((i) => result.errors[i])) * 100),
    kRange: [Math.min(...result.ks), Math.max(...result.ks)] });
  console.log("[주가설]", JSON.stringify([summary("채택 감쇠 기준", base), summary("방향 alpha=0.5", real)]));
  const improvement = base.errors.map((v, i) => v - real.errors[i]);
  const random = rng(20260921);
  const nullGains: number[] = [];
  for (let b = 0; b < 499; b++) {
    const rotated = evaluate(factors(.5, ids.map(() => Math.floor(random() * 8))));
    nullGains.push(base.mape - rotated.mape);
  }
  const gain = mean(improvement);
  const p = (1 + nullGains.filter((v) => v >= gain).length) / (nullGains.length + 1);
  const bootRandom = rng(21092026);
  const boot = Array.from({ length: 5000 }, () => mean(ids.map(() => improvement[Math.floor(bootRandom() * n)])))
    .sort((a, b) => a - b);
  const ci = [boot[124], boot[4874]];
  const middle = groups.slice(0, 2).map((g) => mean(g.map((i) => real.errors[i] - base.errors[i])));
  const gates = { power: affected >= 5, nesting: true, loo: gain > 0,
    structure: Math.abs(real.b - 1) < Math.abs(base.b - 1) && real.r >= base.r,
    middle: middle.every((v) => v <= .01), permutation: p <= .05, bootstrap: ci[0] > 0 };
  console.log("[판정]", JSON.stringify({ gainPp: gain * 100, p, ciPp: ci.map((v) => v * 100),
    middleWorseningPp: middle.map((v) => v * 100), gates,
    conclusion: Object.values(gates).every(Boolean) ? "추가 검증 후보 (본체 반영 아님)" : "채택 근거 부족" }));
  // 부호 반전은 독립 채택 가설이 아니다. 1-alpha*x가 음수가 될 수 있어 0.1로 하한을 둔다.
  const reverse = factors(-.5, ids.map(() => 0)).map((fs) => fs.map((v) => Math.max(.1, v)));
  console.log("[사후 선택 금지: 반대 방향 진단]", JSON.stringify(summary("alpha=-0.5, 하한0.1", evaluate(reverse))));
  console.log("[영향: 코드, 개선%p]", JSON.stringify(ids.filter((i) => evidence[i].some(Boolean))
    .map((i) => ({ code: rows[i].input.storeCode, improvementPp: improvement[i] * 100 }))));
}, 120000);
