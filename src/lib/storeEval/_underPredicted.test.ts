// 낮게 본 5곳이 왜 낮게 나오나 — **과장의 기전을 찾는다** (2026-09-23)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 산식은 '전부 평균'(4.82%p)에 1.03%p 진다. 원인은 "평균 맞추기"가 아니라 정반대다:
// 예측 퍼짐 8.21%p vs 실측 6.19%p — **자신 있게 틀린다.**
//
// 어제 눈에 띈 것: **낮게 본 5곳이 전부 실제로 27~31%였다.**
//   진주혁신도시본점 16.6%->27.5% · 양주덕정 17.0->29.8 · 광주첨단 18.7->30.0
//   청주대 19.3->30.2 · 문경시청 19.4->30.6
// 실측은 대부분 27~36%에 몰려 있는데 산식은 16~48%로 벌린다.
//
// ── 이 파일이 재는 것 ─────────────────────────────────────────────────────
// (A) 매장을 예측 순으로 늘어놓고 **층별 값을 그대로** 본다. 낮은 쪽이 어느 층 때문에
//     낮은지 눈으로 확인한다 — 수요가 적어서인가, 점유율을 뺏겨서인가.
// (B) 잔차 log(실측/예측)를 **각 층과 견준다.** 어느 층이 틀린 방향으로 움직이나.
// (C) 낮게 본 무리와 높게 본 무리의 **층별 평균을 갈라** 본다.
//
// ⚠️ 측정만 한다. 계수를 고르지 않는다. 채택 후보를 여기서 정하지 않는다.
//
// 실행: npx vitest run src/lib/storeEval/_underPredicted.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { existingSiteKey, rival2kmForWindow, rival2kmRecords } from "./rival2km";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  rivalDistanceWeight, computeQualityScore, type QualityParts,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
/** computeTextbook 안의 ratio()와 **같은 규칙**으로 품질점수를 낸다(비중도 같은 P를 쓴다). */
let qualityWeightsRef: Parameters<typeof computeQualityScore>[1];
const computeQualityScoreLocal = (parts: QualityParts) => computeQualityScore(parts, qualityWeightsRef);
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN;
};

describeIf("낮게 본 매장 — 과장의 기전", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const qscByStoreCode = new Map<string, number>();
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const sites: QscSite[] = (snap.labQscScores ?? []) as QscSite[];
  if (!sites.length && existsSync(QSC_FILE)) {
    const f = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(f)) sites.push({ ...v, storeCode: k.replace(/^existing:/, "") });
  }
  for (const d of sites) {
    const code = d.storeCode ?? d.id;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (code && avg != null) qscByStoreCode.set(code, avg);
  }
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
  qualityWeightsRef = P.qualityWeights;

  type Row = {
    name: string; act: number; pred: number;
    demandH: number; share: number; loc: number; pc: number;
    /** 수요시간 ÷ 자사 좌석시간 — "PC 한 대당 동네 수요가 몇 배인가" */
    demandPerSeat: number;
    rivalIp: number; rivalW: number; rivalN: number;
    pop1km: number | null; flow: number | null;
    capped: boolean;
  };
  const rows: Row[] = [];
  for (const r of base) {
    const act = r.input.actualUtilization;
    if (act == null || !(act > 0)) continue;
    const b = computeTextbook(r.input, P);
    if (b.utilization == null || !(b.utilization > 0)) continue;
    if (b.totalDemandHours == null || b.share == null || b.locationMultiplier == null) continue;
    const pc = r.input.pcCount ?? 0;
    if (!(pc > 0)) continue;
    // 경쟁점 무게 — 산식이 분모에 실제로 넣은 값(거리감쇠·품질 빼고 ip만)
    let rivalW = 0, rivalN = 0;
    for (const rv of r.input.rivals ?? []) {
      if (!(rv.ip > 0)) continue;
      const w = rivalDistanceWeight(rv.distanceM, P);
      if (w <= 0) continue;
      rivalW += rv.ip * w; rivalN += 1;
    }
    rows.push({
      name: r.input.storeName ?? r.input.storeCode, act, pred: b.utilization,
      demandH: b.totalDemandHours, share: b.share, loc: b.locationMultiplier, pc,
      demandPerSeat: b.totalDemandHours / (pc * 720),
      rivalIp: r.input.competitorIp ?? 0, rivalW, rivalN,
      pop1km: r.input.pop1km ?? null,
      flow: r.input.floatingByRadius?.[P.floatingRadius] ?? null,
      capped: b.capped,
    });
  }

  it("(A) 예측 순으로 늘어놓고 층별 값을 그대로 본다", () => {
    const sorted = [...rows].sort((a, b) => a.pred - b.pred);
    console.log(`\n[층별 값] n=${rows.length} · 예측 낮은 순 · 판정 기준은 가동률`);
    console.log(`  매장              예측     실측    오차     수요/좌석  점유율   입지    PC   경쟁무게 수`);
    for (const r of sorted) {
      console.log(
        `  ${r.name.padEnd(16)}${(r.pred * 100).toFixed(1).padStart(6)}%`
        + `${(r.act * 100).toFixed(1).padStart(8)}%`
        + `${((r.pred - r.act) * 100).toFixed(1).padStart(8)}%p`
        + `${r.demandPerSeat.toFixed(2).padStart(10)}`
        + `${(r.share * 100).toFixed(1).padStart(8)}%`
        + `${r.loc.toFixed(2).padStart(8)}`
        + `${String(r.pc).padStart(6)}`
        + `${r.rivalW.toFixed(0).padStart(9)}${String(r.rivalN).padStart(4)}`
        + (r.capped ? "  ⛔상한" : ""));
    }
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(B) ⭐ 잔차가 어느 층과 맞물리나 — 무엇을 틀리게 세고 있나", () => {
    // 잔차 = log(실측 ÷ 예측). 양수면 산식이 **낮게 봤다**는 뜻이다.
    const resid = rows.map((r) => Math.log(r.act / r.pred));
    const cands: { name: string; v: (r: Row) => number | null }[] = [
      { name: "log 수요/좌석", v: (r) => Math.log(r.demandPerSeat) },
      { name: "log 점유율", v: (r) => Math.log(r.share) },
      { name: "log 입지배율", v: (r) => Math.log(r.loc) },
      { name: "log PC대수", v: (r) => Math.log(r.pc) },
      { name: "log 경쟁무게+1", v: (r) => Math.log(1 + r.rivalW) },
      { name: "경쟁점 수", v: (r) => r.rivalN },
      { name: "log 1km인구", v: (r) => (r.pop1km && r.pop1km > 0 ? Math.log(r.pop1km) : null) },
      { name: "log 유동", v: (r) => (r.flow && r.flow > 0 ? Math.log(r.flow) : null) },
      { name: "log 예측(자기자신)", v: (r) => Math.log(r.pred) },
    ];
    console.log(`\n[잔차 대조] 잔차 = log(실측÷예측) · 양수 = 산식이 낮게 봤다`);
    console.log(`  유의선 ±0.31(n=40, 단독) / ±0.41(여러 개 훑을 때)`);
    console.log(`  후보                  n     잔차와 r`);
    for (const c of cands) {
      const pairs = rows.map((r, i) => [c.v(r), resid[i]] as const)
        .filter((p): p is readonly [number, number] => p[0] != null && Number.isFinite(p[0]));
      if (pairs.length < 10) continue;
      console.log(`  ${c.name.padEnd(20)}${String(pairs.length).padStart(3)}`
        + `${corr(pairs.map((p) => p[0]), pairs.map((p) => p[1])).toFixed(3).padStart(13)}`);
    }
    console.log(`\n  ⭐ "log 예측(자기자신)"이 **강한 음수**면 산식이 과장한다는 뜻이다`);
    console.log(`     (낮게 찍은 곳은 더 낮게, 높게 찍은 곳은 더 높게 틀린다).`);
    console.log(`     다른 층이 유의하게 나오면 **그 층이 잘못 계산되고 있다**.`);
    expect(resid.length).toBeGreaterThan(30);
  });

  it("(D) ⭐⭐ 층마다 **몇 제곱만큼** 과장하나 — 교과서는 둘 다 1제곱이다", () => {
    // 가동률 = (수요/좌석) x 점유율. 교과서식은 두 층 다 **1제곱**으로 들어간다.
    //   log(가동률) = log(수요/좌석) + log(점유율)
    // 실측에 맞춰 두 기울기를 재면, 1보다 **작은 층이 과장하는 층**이다.
    //
    // ⚠️ 이건 **진단**이다. 여기서 나온 기울기를 지수로 박으면 그게 "자료에 맞추기"다.
    //    (어제 눈금 보정 b를 껐던 이유가 그것이다.) 기울기는 **어디를 파야 하나**를 가리킨다.
    const y = rows.map((r) => Math.log(r.act));
    const x1 = rows.map((r) => Math.log(r.demandPerSeat));
    const x2 = rows.map((r) => Math.log(r.share));
    // 2변수 최소제곱 — 정규방정식을 직접 푼다(행렬 라이브러리 안 쓴다).
    const c = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); return mean(a.map((v, i) => (v - ma) * (b[i] - mb))); };
    const s11 = c(x1, x1), s22 = c(x2, x2), s12 = c(x1, x2), s1y = c(x1, y), s2y = c(x2, y);
    const det = s11 * s22 - s12 * s12;
    const b1 = (s22 * s1y - s12 * s2y) / det;
    const b2 = (s11 * s2y - s12 * s1y) / det;
    // 단독 기울기도 같이 — 두 층이 서로 엉켜 있어서(교란) 단독과 동시가 다르다.
    console.log(`\n[층 기울기] 실측 log(가동률)에 두 층을 동시에 회귀 · 교과서 값은 **둘 다 1.000**`);
    console.log(`  층              단독 기울기   동시 기울기   교과서와의 차이`);
    console.log(`  수요/좌석        ${(s1y / s11).toFixed(3).padStart(9)}${b1.toFixed(3).padStart(14)}`
      + `${(b1 - 1).toFixed(3).padStart(15)}`);
    console.log(`  점유율          ${(s2y / s22).toFixed(3).padStart(9)}${b2.toFixed(3).padStart(14)}`
      + `${(b2 - 1).toFixed(3).padStart(15)}`);
    console.log(`  두 층 상관 r = ${corr(x1, x2).toFixed(3)}  (강한 음수면 서로 상쇄하고 있다는 뜻)`);
    const fit = rows.map((_, i) => b1 * x1[i] + b2 * x2[i]);
    console.log(`  맞춘 뒤 설명력 R² = ${(corr(fit, y) ** 2).toFixed(3)} · 지금 산식의 R² = `
      + `${(corr(rows.map((r) => Math.log(r.pred)), y) ** 2).toFixed(3)}`);
    console.log(`\n  ⭐ 1보다 **작은** 층이 과장하는 층이다. 1에 가까우면 그 층은 제 눈금이다.`);
    console.log(`     ⚠️ 이 기울기를 지수로 박으면 자료 맞추기다 — **어디를 팔지**만 가리킨다.`);
    expect(Number.isFinite(b1)).toBe(true);
  });

  it("(E) ⭐ 수요를 주거/유동으로 갈라 본다 — 어느 쪽이 퍼짐만 넣고 있나", () => {
    // (D)에서 두 층이 **똑같이 0.39제곱**만큼 과장한다고 나왔다. 층에 국한된 버그가 아니라
    // **공통 원인**이라는 뜻이다. 수요층 안을 갈라서 어느 조각이 퍼짐만 넣는지 본다.
    //
    // 수요 = (주거 이용자 + 유동 이용자 x 0.15) x 특수수요 x 8.20h
    // 주거는 1km 총인구 x 연령가중, 유동은 400m 유동 x 연령가중이다. 둘은 **자료원이 다르다.**
    const y = rows.map((r) => Math.log(r.act));
    const parts: { name: string; v: (i: number) => number | null }[] = [];
    const bd = base.map((r) => ({ r, b: computeTextbook(r.input, P) }));
    const idxOf = new Map<string, number>();
    rows.forEach((r, i) => idxOf.set(r.name, i));
    const resU: (number | null)[] = new Array(rows.length).fill(null);
    const floU: (number | null)[] = new Array(rows.length).fill(null);
    const pcs: number[] = rows.map((r) => r.pc);
    for (const { r, b } of bd) {
      const i = idxOf.get(r.input.storeName ?? r.input.storeCode);
      if (i == null) continue;
      resU[i] = b.residentDemandUsers; floU[i] = b.floatingDemandUsers;
    }
    parts.push({ name: "주거 이용자/PC", v: (i) => (resU[i] && resU[i]! > 0 ? Math.log(resU[i]! / pcs[i]) : null) });
    parts.push({ name: "유동 이용자/PC", v: (i) => (floU[i] && floU[i]! > 0 ? Math.log(floU[i]! / pcs[i]) : null) });
    parts.push({ name: "유동 몫(비율)", v: (i) => {
      const a = resU[i] ?? 0, f = floU[i] ?? 0;
      return a + f > 0 ? f / (a + f) : null;
    } });
    console.log(`\n[수요 갈라 보기] n=${rows.length} · 유동은 이미 x${P.floatingFactor} 먹은 값이다`);
    console.log(`  조각               퍼짐(SD)   실측과 r   단독 기울기`);
    for (const p of parts) {
      const pr = rows.map((_, i) => p.v(i)).map((v, i) => [v, y[i]] as const)
        .filter((q): q is readonly [number, number] => q[0] != null && Number.isFinite(q[0]));
      const xs = pr.map((q) => q[0]), ys = pr.map((q) => q[1]);
      const ma = mean(xs), mb = mean(ys);
      const slope = mean(xs.map((v, i) => (v - ma) * (ys[i] - mb))) / (sdOf(xs) ** 2);
      console.log(`  ${p.name.padEnd(18)}${sdOf(xs).toFixed(3).padStart(8)}`
        + `${corr(xs, ys).toFixed(3).padStart(12)}${slope.toFixed(3).padStart(14)}`);
    }
    const shares = rows.map((_, i) => {
      const a = resU[i] ?? 0, f = floU[i] ?? 0;
      return a + f > 0 ? f / (a + f) : NaN;
    }).filter(Number.isFinite);
    console.log(`\n  유동이 수요에서 차지하는 몫: 중앙 ${(shares.sort((a, b) => a - b)[Math.floor(shares.length / 2)] * 100).toFixed(0)}%`
      + ` · 범위 ${(Math.min(...shares) * 100).toFixed(0)}~${(Math.max(...shares) * 100).toFixed(0)}%`);
    console.log(`\n  ⭐ 퍼짐이 크고 실측과 r이 0 근처인 조각이 **퍼짐만 넣는 조각**이다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(F) ⭐⭐ 유동을 켜고 끄며 잰다 — 날것 상관으로 판정하지 않는다", () => {
    // (E)에서 유동 조각이 **퍼짐 SD 0.725로 제일 큰데 실측과 r=-0.009**로 나왔다.
    // ⚠️ 그대로 믿으면 안 된다(`날것 상관으로 구조를 판정하지 말 것`): 유동이 큰 동네는
    //    경쟁점도 많아서 교란된다. **모델을 켜고 끄며 오차로** 판정한다.
    //
    // 두 가지를 같이 훑는다:
    //   (가) floatingFactor  — 유동을 몇 할이나 수요로 세나 (지금 0.15)
    //   (나) 오목하게        — 유동^α. 통행량이 많은 자리일수록 **전환율이 떨어진다**면
    //        α<1이 맞다. 역세권은 통행량이 크지만 지나가는 사람이다.
    //
    // ⛔ 여기서 값을 고르지 않는다. **재고 표**만 남긴다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    // 바닥 — LOO 전부 평균. **항상 같이 찍는다.**
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    const scoreOf = (preds: number[]) => {
      const errs = preds.map((v, i) => v - acts[i]);
      const abs = errs.map(Math.abs);
      const pl = preds.map(Math.log);
      // 수준 보정 MAE — 예측 전체에 상수를 곱해 log 편향을 0으로 맞춘 뒤의 오차.
      // 수준은 축척(8.20h)이 맡는 자리라, **퍼짐·분별력만** 따로 보려고 같이 찍는다.
      const k = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
      return {
        mae: mean(abs), worst: Math.max(...abs), bias: mean(errs),
        within5: abs.filter((v) => v <= 0.05).length,
        spread: sdOf(pl) / sdOf(actLog), r: corr(pl, actLog),
        maeLvl: mean(absL), worstLvl: Math.max(...absL),
        within5Lvl: absL.filter((v) => v <= 0.05).length,
      };
    };
    const predsWith = (ff: number, alpha: number) => {
      // 오목하게 = 유동을 기하평균 기준으로 정규화해 α제곱한다(기준점에서 값이 안 변한다).
      const REF = P.centralityResidual?.geoMeanFloating400 ?? 75093;
      const rows2 = use.map(({ r }) => {
        if (alpha === 1) return r.input;
        const fb = { ...r.input.floatingByRadius };
        const fa = { ...r.input.floatingAgesByRadius };
        const raw = fb[P.floatingRadius];
        if (raw != null && raw > 0) {
          const k = Math.pow(raw / REF, alpha - 1); // 값 -> 값 x (값/기준)^(α−1) = 기준^(1−α) x 값^α
          fb[P.floatingRadius] = raw * k;
          const ages = fa[P.floatingRadius];
          if (ages) {
            const scaled: Record<string, number> = {};
            for (const [key, v] of Object.entries(ages)) scaled[key] = (v as number) * k;
            fa[P.floatingRadius] = scaled as typeof ages;
          }
        }
        return { ...r.input, floatingByRadius: fb, floatingAgesByRadius: fa };
      });
      const P2 = { ...P, floatingFactor: ff };
      return rows2.map((inp) => computeTextbook(inp, P2).utilization ?? NaN);
    };

    console.log(`\n[재고 표 — 유동] n=${n} · ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  경우                  MAE      최악     편향    ±5%p  퍼짐   분별력 r | 수준보정 MAE  ±5%p`);
    const line = (label: string, preds: number[], mark = "") => {
      const s = scoreOf(preds);
      console.log(`  ${label.padEnd(20)}${(s.mae * 100).toFixed(2).padStart(6)}%p`
        + `${(s.worst * 100).toFixed(2).padStart(8)}%p${(s.bias * 100).toFixed(2).padStart(8)}%p`
        + `  ${String(s.within5).padStart(2)}/${n}`
        + `${s.spread.toFixed(2).padStart(6)}배${s.r.toFixed(3).padStart(9)} |`
        + `${(s.maeLvl * 100).toFixed(2).padStart(9)}%p  ${String(s.within5Lvl).padStart(2)}/${n}${mark}`);
    };
    for (const ff of [0, 0.05, 0.10, 0.15, 0.20, 0.30]) {
      line(`유동 x${ff.toFixed(2)}`, predsWith(ff, 1), ff === P.floatingFactor ? "  ← 지금" : "");
    }
    console.log(`  ${"-".repeat(96)}`);
    for (const a of [0.75, 0.5, 0.25, 0]) {
      line(`유동^${a.toFixed(2)} (x0.15)`, predsWith(0.15, a), a === 0 ? "  ← 유동을 상수로" : "");
    }
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · **수준보정 MAE**가 퍼짐·분별력만 본 성적이다(수준은 축척 8.20h가 맡는 자리다)`);
    console.log(`     · 분별력 r이 떨어지면서 MAE만 좋아지면 그건 **눌러 담은 것**이다 — 안 쓴다`);
    console.log(`     · 바닥(전부 평균)을 못 이기면 무슨 값이 나와도 값을 못 한다`);
    expect(n).toBeGreaterThan(30);
  });

  it("(G) ⭐⭐ 입력을 하나씩 **얼려** 본다 — 누가 퍼짐을 만들고 누가 신호를 주나", () => {
    // (F)에서 유동을 상수로 만들어도 퍼짐이 1.33배 그대로였다 — 유동은 범인이 아니다.
    // 그럼 누구인가. **입력을 하나씩 표본 평균으로 얼려** 놓고 성적이 어떻게 되는지 본다.
    //
    //   · 얼렸더니 **퍼짐이 크게 줄고 분별력 r은 그대로** -> 그 입력은 **잡음만** 넣는다
    //   · 얼렸더니 **분별력 r이 크게 떨어진다**        -> 그 입력은 **일을 하고 있다**
    //   · 얼려도 아무것도 안 바뀐다                     -> 그 입력은 **놀고 있다**
    //
    // ⚠️ 얼리는 건 기전이 아니라 **진단**이다(`_spreadLayers` (2)번과 같은 성격).
    //    채택 후보로 읽지 마라. "어디를 팔지"만 가리킨다.
    const useAll = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = useAll.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));
    const geo = (xs: number[]) => Math.exp(mean(xs.filter((v) => v > 0).map(Math.log)));

    // 얼릴 때 쓸 표본 기하평균들
    const gPc = geo(useAll.map((x) => x.r.input.pcCount ?? 0));
    const gRes = geo(useAll.map((x) => computeTextbook(x.r.input, P).residentDemandUsers ?? 0));
    const gRivalIp = geo(useAll.flatMap((x) => (x.r.input.rivals ?? []).map((rv) => rv.ip)).filter((v) => v > 0));
    const gRivalN = Math.round(mean(useAll.map((x) => (x.r.input.rivals ?? []).filter((rv) => rv.ip > 0).length)));
    const gDist = geo(useAll.flatMap((x) => (x.r.input.rivals ?? []).map((rv) => rv.distanceM ?? 0)).filter((v) => v > 0));

    type Inp = typeof useAll[number]["r"]["input"];
    const freezers: { name: string; f: (i: Inp) => Inp }[] = [
      { name: "얼린 것 없음(지금)", f: (i) => i },
      { name: "주거인구", f: (i) => {
        const cur = computeTextbook(i, P).residentDemandUsers;
        if (cur == null || !(cur > 0) || !i.residentAges) return i;
        const k = gRes / cur;
        const a: Record<string, number> = {};
        for (const [key, v] of Object.entries(i.residentAges)) a[key] = (v as number) * k;
        return { ...i, residentAges: a as typeof i.residentAges, pop1km: (i.pop1km ?? 0) * k };
      } },
      { name: "PC대수", f: (i) => ({ ...i, pcCount: gPc }) },
      { name: "경쟁점(대수·거리)", f: (i) => ({
        ...i,
        rivals: Array.from({ length: gRivalN }, () => ({ ip: gRivalIp, distanceM: gDist, parts: null })),
        competitorIp: gRivalIp * gRivalN,
      }) },
      { name: "경쟁점 품질만", f: (i) => ({
        ...i, rivals: (i.rivals ?? []).map((rv) => ({ ...rv, parts: null })),
      }) },
      { name: "자사 품질(QSC)", f: (i) => ({ ...i, ownQualityParts: null }) },
      { name: "입지", f: (i) => ({ ...i, location: null }) },
      { name: "특수수요", f: (i) => ({ ...i, specialDemandType: "없음" }) },
      { name: "유동", f: (i) => {
        const REF = P.centralityResidual?.geoMeanFloating400 ?? 75093;
        const fb = { ...i.floatingByRadius };
        const fa = { ...i.floatingAgesByRadius };
        const raw = fb[P.floatingRadius];
        if (raw != null && raw > 0) {
          const k = REF / raw;
          fb[P.floatingRadius] = REF;
          const ages = fa[P.floatingRadius];
          if (ages) {
            const s: Record<string, number> = {};
            for (const [key, v] of Object.entries(ages)) s[key] = (v as number) * k;
            fa[P.floatingRadius] = s as typeof ages;
          }
        }
        return { ...i, floatingByRadius: fb, floatingAgesByRadius: fa };
      } },
    ];

    console.log(`\n[입력 얼리기] n=${n} · ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  얼린 입력              MAE      최악     ±5%p  퍼짐   분별력 r | 수준보정 MAE  ±5%p`);
    for (const fz of freezers) {
      const preds = useAll.map(({ r }) => computeTextbook(fz.f(r.input), P).utilization ?? NaN);
      if (preds.some((v) => !Number.isFinite(v))) { console.log(`  ${fz.name.padEnd(20)}  (계산 불가 — 건너뜀)`); continue; }
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const k = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
      console.log(`  ${fz.name.padEnd(20)}${(mean(abs) * 100).toFixed(2).padStart(6)}%p`
        + `${(Math.max(...abs) * 100).toFixed(2).padStart(8)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배`
        + `${corr(pl, actLog).toFixed(3).padStart(9)} |`
        + `${(mean(absL) * 100).toFixed(2).padStart(9)}%p  ${String(absL.filter((v) => v <= 0.05).length).padStart(2)}/${n}`);
    }
    console.log(`\n  ⭐ **분별력 r을 안 떨어뜨리면서 퍼짐만 줄이는 입력**이 있으면 거기가 범인이다.`);
    console.log(`     r이 같이 떨어지면 그 입력은 일을 하고 있는 것이다 — 건드리면 안 된다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(H) ⭐⭐ 분별력 r의 **천장**은 얼마인가 — 실측 가동률 자체가 얼마나 안정적인가", () => {
    // (G)에서 잡음만 넣는 입력이 하나도 없었다. 전부 제 일을 한다. 그럼 남은 건 분별력이고,
    // **분별력에는 천장이 있다** — 실측값 자체에 달마다 흔들리는 잡음이 있기 때문이다.
    //
    // 재는 법: 평가창의 달을 **홀수번째/짝수번째로 반씩 갈라** 각각 평균 가동률을 낸 뒤
    // 두 반쪽이 매장 사이에서 얼마나 같은 순서인지 본다(반분신뢰도).
    // 스피어만-브라운으로 **전체 평균의 신뢰도**로 늘리면, 어떤 산식도 넘을 수 없는
    // 분별력 천장이 √신뢰도다.
    //
    // ⭐ 이게 중요한 이유: 천장이 0.6이면 r=0.516인 지금 산식은 **거의 다 온 것**이고,
    //    천장이 0.9면 아직 절반도 못 온 것이다. 어디를 얼마나 더 팔지가 여기서 갈린다.
    const sales = (snap.sales ?? []) as Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>;
    const codes = new Set(rows.map((r) => r.name));
    // 매장코드 -> 이름을 맞춰야 한다. base에서 코드·이름을 같이 꺼낸다.
    const nameByCode = new Map<string, string>();
    const openedByCode = new Map<string, string | null>();
    for (const r of base) {
      nameByCode.set(r.input.storeCode, r.input.storeName ?? r.input.storeCode);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openedByCode.set(r.input.storeCode, (r as any).store?.openedAt ?? null);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openedFromSnap = new Map<string, string>((snap.existingStores ?? []).map((s: any) => [s.storeCode, s.openedAt]));
    const monthsByCode = new Map<string, { ym: string; v: number }[]>();
    for (const s of sales) {
      const rate = s.utilizationRate;
      if (rate == null || !(rate > 0)) continue;
      const nm = nameByCode.get(s.storeCode);
      if (!nm || !codes.has(nm)) continue;
      monthsByCode.set(s.storeCode, [...(monthsByCode.get(s.storeCode) ?? []), { ym: s.yearMonth, v: rate }]);
    }
    // 평가창만 남긴다 — utilizationByStore와 같은 창을 써야 한다.
    const A: number[] = [], B: number[] = [], within: number[] = [];
    let usable = 0;
    for (const [code, ms] of monthsByCode) {
      const win = new Set(evaluationMonths(openedFromSnap.get(code) ?? null));
      const inWin = ms.filter((m) => win.has(m.ym)).sort((a, b) => a.ym.localeCompare(b.ym));
      if (inWin.length < 4) continue;
      usable += 1;
      const odd = inWin.filter((_, i) => i % 2 === 0).map((m) => m.v);
      const even = inWin.filter((_, i) => i % 2 === 1).map((m) => m.v);
      A.push(mean(odd)); B.push(mean(even));
      within.push(sdOf(inWin.map((m) => Math.log(m.v))));
    }
    const rHalf = corr(A.map(Math.log), B.map(Math.log));
    // 스피어만-브라운: 반쪽 신뢰도 -> 전체(반쪽 2개) 신뢰도
    const rel = (2 * rHalf) / (1 + rHalf);
    console.log(`\n[분별력 천장] 평가창 4달 이상인 매장 ${usable}곳 · 달을 홀/짝으로 반씩 갈라 비교`);
    console.log(`  반쪽끼리 상관 r      = ${rHalf.toFixed(3)}`);
    console.log(`  전체 평균의 신뢰도    = ${rel.toFixed(3)}  (스피어만-브라운)`);
    console.log(`  ⭐ **어떤 산식도 넘을 수 없는 분별력 천장 = √신뢰도 = ${Math.sqrt(Math.max(0, rel)).toFixed(3)}**`);
    console.log(`  지금 산식의 분별력 r  = ${corr(rows.map((r) => Math.log(r.pred)), rows.map((r) => Math.log(r.act))).toFixed(3)}`);
    console.log(`\n  매장 안 달별 흔들림(log SD) 중앙 ${(within.sort((a, b) => a - b)[Math.floor(within.length / 2)]).toFixed(3)}`
      + ` · 매장 사이 퍼짐(log SD) ${sdOf(rows.map((r) => Math.log(r.act))).toFixed(3)}`);
    // '전부 평균'을 이기려면 분별력이 얼마여야 하나 — 퍼짐 k배일 때 r > k/2 다.
    const k = sdOf(rows.map((r) => Math.log(r.pred))) / sdOf(rows.map((r) => Math.log(r.act)));
    console.log(`\n  ⭐ '전부 평균'을 이기는 조건(제곱오차 기준): 퍼짐 ${k.toFixed(2)}배에서는 **r > ${(k / 2).toFixed(3)}**`);
    console.log(`     · 길 하나 — 분별력을 ${(k / 2).toFixed(3)} 위로 올린다`);
    console.log(`     · 길 둘 — 퍼짐을 r(=${corr(rows.map((x) => Math.log(x.pred)), rows.map((x) => Math.log(x.act))).toFixed(2)})배까지 줄인다`);
    console.log(`       ⚠️ 길 둘을 **기전 없이** 하는 게 어제 끈 눈금 보정 b다. 같은 병을 되풀이하지 마라.`);
    expect(usable).toBeGreaterThan(20);
  });

  it("(I) ⭐⭐ 산식에 **안 들어간** 것들과 잔차를 댄다 — 남은 신호는 어디 있나", () => {
    // (H)에서 분별력 천장이 0.997로 나왔다 — 실측값은 거의 잡음이 없다. 지금 r=0.516이니
    // **못 잡은 신호가 아직 많이 남아 있다.** 어디 있나.
    //
    // 산식이 가동률을 낼 때 **안 쓰는** 것들부터 본다. 제일 눈에 띄는 건 **시간당 요금**이다 —
    // 지금 요금은 매출에만 걸리고 가동률에는 아무 영향이 없다. 비싸면 덜 온다는 게
    // 수요의 기본인데 그 항이 통째로 없다.
    const resid = rows.map((r) => Math.log(r.act / r.pred));
    const byName = new Map(rows.map((r, i) => [r.name, i]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = new Map<string, any>((snap.existingStores ?? []).map((s: any) => [s.storeCode, s]));
    const extra: { name: string; v: number | null }[][] = rows.map(() => []);
    for (const r of base) {
      const i = byName.get(r.input.storeName ?? r.input.storeCode);
      if (i == null) continue;
      const m = meta.get(r.input.storeCode);
      const opened = m?.openedAt ? new Date(m.openedAt).getTime() : null;
      const win = evaluationMonths(m?.openedAt ?? null);
      // 평가창 한가운데 달 — 코호트(개점 시점) 교란을 보는 자다.
      const midYm = win.length ? win[Math.floor(win.length / 2)] : null;
      const midT = midYm ? new Date(`${midYm}-15`).getTime() : null;
      extra[i] = [
        { name: "log 시간당요금", v: r.input.hourlyRate && r.input.hourlyRate > 0 ? Math.log(r.input.hourlyRate) : null },
        { name: "개점 시점(년)", v: opened ? opened / (365.25 * 864e5) : null },
        { name: "평가창 한가운데(년)", v: midT ? midT / (365.25 * 864e5) : null },
        { name: "자사 QSC 원점수", v: qscByStoreCode.get(r.input.storeCode) ?? null },
        { name: "경쟁력격차", v: r.input.competitivenessGap ?? null },
        { name: "500m/1km 인구비", v: r.input.pop500m && r.input.pop1km ? r.input.pop500m / r.input.pop1km : null },
        { name: "조사 경쟁점 수", v: r.input.competitorCount ?? null },
        { name: "log 500m 인구", v: r.input.pop500m && r.input.pop500m > 0 ? Math.log(r.input.pop500m) : null },
        { name: "접근성 점수", v: r.input.location?.access ?? null },
        { name: "중심도(날값)", v: r.input.location?.centrality ?? null },
        { name: "유동 편심도", v: r.input.location?.direction ?? null },
      ];
    }
    const labels = extra.find((e) => e.length)?.map((e) => e.name) ?? [];
    console.log(`\n[안 쓰는 것들과 잔차] 잔차 = log(실측÷예측) · 양수 = 산식이 낮게 봤다`);
    console.log(`  유의선 ±0.31(단독) / ±0.41(여러 개 훑을 때. 지금 ${labels.length}개를 훑는다)`);
    console.log(`  후보                    n     잔차와 r   실측과 r`);
    const hits: string[] = [];
    labels.forEach((lab, k) => {
      const pr = extra.map((e, i) => [e[k]?.v ?? null, resid[i], Math.log(rows[i].act)] as const)
        .filter((q): q is readonly [number, number, number] => q[0] != null && Number.isFinite(q[0]));
      if (pr.length < 15) { console.log(`  ${lab.padEnd(22)}${String(pr.length).padStart(3)}   (표본 부족)`); return; }
      const rr = corr(pr.map((q) => q[0]), pr.map((q) => q[1]));
      const ra = corr(pr.map((q) => q[0]), pr.map((q) => q[2]));
      const mark = Math.abs(rr) >= 0.41 ? "  ⭐" : Math.abs(rr) >= 0.31 ? "  ·" : "";
      if (Math.abs(rr) >= 0.41) hits.push(lab);
      console.log(`  ${lab.padEnd(22)}${String(pr.length).padStart(3)}${rr.toFixed(3).padStart(12)}${ra.toFixed(3).padStart(11)}${mark}`);
    });
    console.log(`\n  ⭐ 유의선을 넘은 것: ${hits.length ? hits.join(" · ") : "없음"}`);
    console.log(`     ⚠️ 넘었다고 바로 넣지 마라 — **기전이 있어야** 넣는다(\`항목은 뜻으로, 계수만 자료로\`).`);
    console.log(`     ⚠️ 코호트 교란 주의: 개점 시점이 여러 지표와 r=0.7~0.9로 얽혀 있다.`);
    expect(labels.length).toBeGreaterThan(5);
  });

  it("(J) ⭐⭐ 수요 반경과 경쟁 반경이 안 맞는다 — 거리띠별로 잔차를 본다", () => {
    // ── 의심 ───────────────────────────────────────────────────────────────
    // 수요는 **1km 주거 + 400m 유동**에서 온다. 그런데 경쟁은 감쇠(200m 평지 · 200m 척도)라
    // 실효 반경이 **400m 남짓**이다: 600m 경쟁점의 무게가 0.135, 1km는 0.02다.
    //
    // 그러면 **400m~1km 고리에 있는 경쟁점**은 우리 1km 주거 수요를 확실히 나눠 먹는데
    // 분모에는 거의 안 들어간다 -> 그런 매장은 **점유율을 후하게** 받는다.
    //
    // 기전이 있는 의심이다(반경 둘이 다른 건 설계상의 어긋남이지 계수 문제가 아니다).
    // 재는 법: 거리띠마다 경쟁점 IP를 더해서 **잔차와 대 본다.**
    //   · 지금 제대로 세는 띠(0~400m)는 잔차와 상관이 없어야 한다(이미 반영됐으니까)
    //   · **덜 세는 띠(400m~1km)가 음수**로 나오면 의심이 맞다(경쟁점 많을수록 과대예측)
    const resid = rows.map((r) => Math.log(r.act / r.pred));
    const byName = new Map(rows.map((r, i) => [r.name, i]));
    const BANDS: [number, number][] = [[0, 200], [200, 400], [400, 700], [700, 1200], [1200, 2000]];
    const ipIn: number[][] = rows.map(() => BANDS.map(() => 0));
    const nIn: number[][] = rows.map(() => BANDS.map(() => 0));
    const wSum: number[] = rows.map(() => 0);
    for (const r of base) {
      const i = byName.get(r.input.storeName ?? r.input.storeCode);
      if (i == null) continue;
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const d = rv.distanceM;
        if (d == null) continue;
        const k = BANDS.findIndex(([a, b]) => d >= a && d < b);
        if (k < 0) continue;
        ipIn[i][k] += rv.ip; nIn[i][k] += 1;
        wSum[i] += rv.ip * rivalDistanceWeight(d, P);
      }
    }
    console.log(`\n[거리띠별] 감쇠 곡선: 200m 100% · 400m 37% · 700m 8% · 1km 2% · 1.5km 0.2%`);
    console.log(`  거리띠          총 경쟁IP   매장당 평균   분모에 실제로 들어간 몫   잔차와 r`);
    BANDS.forEach(([a, b], k) => {
      const ips = rows.map((_, i) => ipIn[i][k]);
      const total = ips.reduce((p, q) => p + q, 0);
      // 그 띠가 분모에 실제로 기여한 무게(감쇠 먹인 뒤) ÷ 그 띠의 날 IP
      const mid = (a + b) / 2;
      const eff = rivalDistanceWeight(mid, P);
      const x = rows.map((_, i) => Math.log(1 + ipIn[i][k]));
      console.log(`  ${`${a}~${b}m`.padEnd(14)}${total.toFixed(0).padStart(9)}`
        + `${(total / rows.length).toFixed(1).padStart(13)}`
        + `${(eff * 100).toFixed(1).padStart(22)}%`
        + `${corr(x, resid).toFixed(3).padStart(12)}`
        + (Math.abs(corr(x, resid)) >= 0.31 ? "  ·" : ""));
    });
    // 덜 세는 띠를 통째로 묶어서도 본다 — 띠별로는 표본이 얇다.
    const under = rows.map((_, i) => Math.log(1 + ipIn[i][2] + ipIn[i][3] + ipIn[i][4]));
    const counted = rows.map((_, i) => Math.log(1 + ipIn[i][0] + ipIn[i][1]));
    console.log(`\n  묶어서 — 제대로 세는 0~400m : 잔차와 r = ${corr(counted, resid).toFixed(3)}`);
    console.log(`           덜 세는 400m~2km  : 잔차와 r = ${corr(under, resid).toFixed(3)}`);
    console.log(`\n  ⭐ 읽는 법: **덜 세는 띠가 음수**로 유의하면 의심이 맞다 —`);
    console.log(`     그 고리에 경쟁점이 많을수록 산식이 과대예측한다는 뜻이다.`);
    console.log(`     양쪽 다 0 근처면 거리 감쇠 모양은 문제가 아니다(갈래 하나가 닫힌다).`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(K) ⭐⭐ 감쇠 격자를 **2km 경쟁점이 들어온 뒤** 다시 훑는다 — 재고 표", () => {
    // ⚠️ 닫힌 갈래를 다시 파는 게 아니다. 감쇠 격자 42칸은 **2026-09-21**에 훑었고,
    //    2km 경쟁점은 **09-22**에 들어왔다. 그때는 400m 밖 경쟁점 자료가 **아예 없었다** —
    //    먼 띠가 비어 있는 상태에서 고른 폭이다. 자료가 바뀌었으니 다시 재는 게 맞다.
    //    (J)에서 덜 세는 띠(400m~2km)가 잔차와 r=-0.215로 방향이 맞았다. 유의선 아래지만
    //    날것 상관으로는 판정 안 한다 — **모델을 켜고 끄며 오차로** 본다.
    //
    // ⚠️ weightFactor는 (R, λ)마다 **다시 재야 한다** — 총량 정규화 상수다.
    //    Σ(ip x 계단300) ÷ Σ(ip x 날감쇠). 안 재면 폭 비교가 아니라 총량 비교가 된다.
    // ⛔ 여기서 값을 고르지 않는다. 재고 표만 남긴다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    /** (R, λ)에 맞는 총량 정규화 상수를 다시 잰다 — 계단300 총량에 맞춘다. */
    const refitWeight = (plateauM: number, scaleM: number) => {
      let step = 0, raw = 0;
      for (const { r } of use) {
        for (const rv of r.input.rivals ?? []) {
          if (!(rv.ip > 0)) continue;
          const d = rv.distanceM;
          step += rv.ip * (d == null || d <= 300 ? 1 : 0);
          raw += rv.ip * (d == null || d <= plateauM ? 1 : Math.exp(-(d - plateauM) / scaleM));
        }
      }
      return raw > 0 ? step / raw : 1;
    };
    const scoreGrid = (plateauM: number, scaleM: number) => {
      const wf = refitWeight(plateauM, scaleM);
      const P2 = { ...P, rivalDistanceDecay: { plateauM, scaleM, weightFactor: wf } };
      const preds = use.map(({ r }) => computeTextbook(r.input, P2).utilization ?? NaN);
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const k = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
      return {
        wf, mae: mean(abs), worst: Math.max(...abs), bias: mean(preds.map((v, i) => v - acts[i])),
        within5: abs.filter((v) => v <= 0.05).length, spread: sdOf(pl) / sdOf(actLog),
        r: corr(pl, actLog), maeLvl: mean(absL), worstLvl: Math.max(...absL),
        within5Lvl: absL.filter((v) => v <= 0.05).length,
      };
    };
    console.log(`\n[재고 표 — 감쇠 폭] n=${n} · ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  평지 R · 척도 λ      정규화     MAE      최악    편향   ±5%p  퍼짐  분별력 r | 수준보정 MAE ±5%p`);
    const GRID: [number, number][] = [
      [200, 200], [200, 300], [200, 400], [200, 600], [200, 900],
      [300, 300], [300, 500], [300, 800],
      [400, 400], [400, 700], [500, 500], [500, 1000],
    ];
    for (const [pl2, sc] of GRID) {
      const s = scoreGrid(pl2, sc);
      const cur = pl2 === P.rivalDistanceDecay!.plateauM && sc === P.rivalDistanceDecay!.scaleM;
      console.log(`  R${String(pl2).padStart(3)} λ${String(sc).padStart(4)}`
        + `${s.wf.toFixed(4).padStart(13)}${(s.mae * 100).toFixed(2).padStart(8)}%p`
        + `${(s.worst * 100).toFixed(1).padStart(7)}%p${(s.bias * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(s.within5).padStart(2)}/${n}${s.spread.toFixed(2).padStart(6)}배`
        + `${s.r.toFixed(3).padStart(9)} |${(s.maeLvl * 100).toFixed(2).padStart(9)}%p ${String(s.within5Lvl).padStart(2)}/${n}`
        + (cur ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐ **분별력 r이 올라가면서** 퍼짐이 줄면 진짜다. r이 그대로인데 퍼짐만 줄면`);
    console.log(`     그건 총량을 만진 것이라 눈금 보정 b와 같은 병이다.`);
    console.log(`  ⛔ 표본 안 성적으로 고르지 마라 — 고를 만한 칸이 보이면 **중첩 LOO**부터 돌린다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(L) ⭐⭐ 구간을 갈라 본다 — 경쟁이 센 데서 무너지나, 약한 데서 무너지나", () => {
    // `독점매장에선 수요식이 이미 맞다`(퍼짐 1.2048 vs 실측 1.1957)가 이미 확인돼 있다.
    // 그럼 과장은 **경쟁 항**에서 생기는 것일 수 있다. 경쟁 세기로 갈라서 각 무리 안에서
    // 분별력·퍼짐·바닥 대조를 따로 낸다.
    //
    // ⚠️ 무리를 가르면 표본이 20곳씩이라 유의선이 ±0.44로 벌어진다. 방향만 읽는다.
    const groupOf = (g: Row[], label: string) => {
      const a = g.map((r) => r.act), p = g.map((r) => r.pred);
      const al = a.map(Math.log), pl = p.map(Math.log);
      const loo = a.map((_, i) => mean(a.filter((__, j) => j !== i)));
      const mae = mean(p.map((v, i) => Math.abs(v - a[i])));
      const bmae = mean(loo.map((v, i) => Math.abs(v - a[i])));
      const k = sdOf(pl) / sdOf(al);
      const r = corr(pl, al);
      console.log(`  ${label.padEnd(22)}${String(g.length).padStart(3)}`
        + `${(mae * 100).toFixed(2).padStart(9)}%p${(bmae * 100).toFixed(2).padStart(9)}%p`
        + `${k.toFixed(2).padStart(8)}배${r.toFixed(3).padStart(10)}`
        + `${(r - k / 2 > 0 ? "  ✅ 이긴다" : "  ⛔ 진다")}`);
    };
    console.log(`\n[구간 가르기] '전부 평균'을 이기는 조건은 **분별력 r > 퍼짐÷2** 다`);
    console.log(`  무리                    n      산식 MAE   전부평균     퍼짐   분별력 r   판정`);
    const byRival = [...rows].sort((a, b) => a.rivalW - b.rivalW);
    const h = Math.floor(rows.length / 2);
    groupOf(rows, "전체");
    groupOf(byRival.slice(0, h), "경쟁 약한 절반");
    groupOf(byRival.slice(h), "경쟁 센 절반");
    const byDemand = [...rows].sort((a, b) => a.demandPerSeat - b.demandPerSeat);
    groupOf(byDemand.slice(0, h), "수요 적은 절반");
    groupOf(byDemand.slice(h), "수요 많은 절반");
    const byN = [...rows].sort((a, b) => a.rivalN - b.rivalN);
    groupOf(byN.slice(0, h), "경쟁점 적은 절반");
    groupOf(byN.slice(h), "경쟁점 많은 절반");
    console.log(`\n  ⭐ 한쪽 무리에서만 이기면 **그 무리에서는 산식이 이미 쓸 만하다**는 뜻이고,`);
    console.log(`     지는 쪽 무리가 다음에 팔 자리다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(M) ⭐⭐ 경쟁 센 절반이 무너지는 이유 — 2km 경쟁점은 전부 90대로 가정돼 있다", () => {
    // (L)에서 **경쟁 센 절반에서만** 산식이 무너진다고 나왔다(r 0.434 · 퍼짐 1.54배).
    // 그 절반의 분모에 뭐가 들어가 있나 보면:
    //   · 500m 안 = 사람이 조사한 경쟁점 (대수·품질 있음. 미조사는 90대 기본값)
    //   · 500m 밖 = **2km 경쟁점. 전부 90대 x 영업비율 · 품질 null**
    // 대수도 품질도 하나도 모르는 경쟁점이 분모에 들어간다. 경쟁이 셀수록 그 몫이 커진다.
    //
    // 인계문서 2절이 말한 그 막힌 자리다 — **기전은 있는데 자료가 계수를 못 고른다.**
    // 여기서는 "그게 정말 지금 성적을 갉아먹고 있나"를 잰다.
    const byName = new Map(rows.map((r, i) => [r.name, i]));
    const far2km: number[] = rows.map(() => 0);   // 2km 출신 경쟁점의 감쇠 무게 합
    const near: number[] = rows.map(() => 0);     // 조사 경쟁점의 감쇠 무게 합
    const far2kmN: number[] = rows.map(() => 0);
    for (const r of base) {
      const i = byName.get(r.input.storeName ?? r.input.storeCode);
      if (i == null) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (snap.existingStores ?? []).find((s: any) => s.storeCode === r.input.storeCode);
      const applied = rival2kmForWindow(existingSiteKey(r.input.storeCode), evaluationMonths(meta?.openedAt ?? null));
      const key = (nm: string | null | undefined, d: number | null | undefined) => `${nm ?? ""}|${d ?? ""}`;
      const set = new Set(applied.map((a) => key(a.name, a.distanceM)));
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const w = rv.ip * rivalDistanceWeight(rv.distanceM, P);
        if (set.has(key(rv.name, rv.distanceM))) { far2km[i] += w; far2kmN[i] += 1; }
        else near[i] += w;
      }
    }
    const frac = rows.map((_, i) => (far2km[i] + near[i] > 0 ? far2km[i] / (far2km[i] + near[i]) : 0));
    const resid = rows.map((r) => Math.log(r.act / r.pred));
    console.log(`\n[분모의 출처] 경쟁점 무게가 어디서 왔나`);
    console.log(`  2km 출신이 분모에서 차지하는 몫: 중앙 ${(([...frac].sort((a, b) => a - b))[Math.floor(rows.length / 2)] * 100).toFixed(0)}%`
      + ` · 범위 ${(Math.min(...frac) * 100).toFixed(0)}~${(Math.max(...frac) * 100).toFixed(0)}%`);
    console.log(`  그 몫과 잔차의 상관 r = ${corr(frac, resid).toFixed(3)}  (유의선 ±0.31)`);
    const byRival = [...rows].map((r, i) => ({ r, i })).sort((a, b) => a.r.rivalW - b.r.rivalW);
    const h = Math.floor(rows.length / 2);
    const fr = (g: typeof byRival) => mean(g.map((x) => frac[x.i]));
    console.log(`  경쟁 약한 절반의 2km 몫 ${(fr(byRival.slice(0, h)) * 100).toFixed(0)}%`
      + ` · 경쟁 센 절반 ${(fr(byRival.slice(h)) * 100).toFixed(0)}%`);

    // ── 재고 표 — 2km 경쟁점 대수 가정을 바꿔 본다 ──────────────────────────
    // ⛔ 값을 고르지 않는다. **자료를 구해야 하는 일**이고, 여기서는 "얼마나 민감한가"만 본다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));
    const withScale = (k: number) => use.map(({ r }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (snap.existingStores ?? []).find((s: any) => s.storeCode === r.input.storeCode);
      const applied = rival2kmForWindow(existingSiteKey(r.input.storeCode), evaluationMonths(meta?.openedAt ?? null));
      const key = (nm: string | null | undefined, d: number | null | undefined) => `${nm ?? ""}|${d ?? ""}`;
      const set = new Set(applied.map((a) => key(a.name, a.distanceM)));
      const rivals = (r.input.rivals ?? []).map((rv) =>
        set.has(key(rv.name, rv.distanceM)) ? { ...rv, ip: rv.ip * k } : rv);
      return computeTextbook({ ...r.input, rivals }, P).utilization ?? NaN;
    });
    console.log(`\n[재고 표 — 2km 경쟁점 대수] 지금은 전부 90대 x 영업비율 · n=${n}`);
    console.log(`  ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  가정 대수      MAE      최악    편향   ±5%p  퍼짐  분별력 r   경쟁 센 절반 MAE`);
    const rivalRank = [...use.map((_, i) => i)].sort((a, b) => rows[a]?.rivalW - rows[b]?.rivalW);
    for (const k of [1.5, 1.0, 0.8, 0.667, 0.5, 0.333]) {
      const preds = withScale(k);
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const hi = rivalRank.slice(Math.floor(n / 2));
      console.log(`  ${(90 * k).toFixed(0).padStart(4)}대`
        + `${(mean(abs) * 100).toFixed(2).padStart(10)}%p${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hi.map((i) => abs[i])) * 100).toFixed(2).padStart(15)}%p`
        + (k === 1 ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐ 읽는 법: 대수를 줄였더니 **분별력 r이 오르고** 경쟁 센 절반이 좋아지면,`);
    console.log(`     "소형 경쟁점을 90대로 세고 있다"가 진짜 범인이다.`);
    console.log(`     r이 안 움직이고 편향만 움직이면 그건 총량 문제고 대수 문제가 아니다.`);
    console.log(`  ⛔ 어느 쪽이든 **여기서 값을 고르지 않는다** — 소형 경쟁점을 조사해야 풀린다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(N) ⭐⭐ 품질 지수 θ가 경쟁점을 얼마나 지우나 — 경쟁 센 절반에서 특히", () => {
    // (M)에서 2km 경쟁점은 경쟁 센 절반의 분모에서 **4%뿐**이었다 — 범인이 아니다.
    // 그럼 조사된 500m 경쟁점 쪽이다. 거기서 제일 세게 작용하는 건 **품질 지수 θ=3**이다:
    //   분모 몫 = 경쟁PC x (경쟁품질 ÷ 자사품질)³ x 거리무게
    // 우리는 새 가맹점이라 품질이 늘 높다 -> 비가 1보다 작고, 세제곱하면 **확 작아진다.**
    // `θ=3은 확정`으로 메모돼 있지만 그건 **2km 경쟁점이 들어오기 전**의 재확인이다.
    //
    // ⛔ 값을 고르지 않는다. 얼마나 지우는지 + 재고 표만 남긴다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));
    const byName = new Map(rows.map((r, i) => [r.name, i]));
    const rivalRankHi = new Set([...rows].map((r, i) => ({ r, i }))
      .sort((a, b) => a.r.rivalW - b.r.rivalW).slice(Math.floor(rows.length / 2)).map((x) => x.r.name));

    // θ가 얼마나 지우는지 — 날 경쟁IP(거리무게만) 대비 품질 먹인 뒤
    const kept: number[] = [], keptHi: number[] = [];
    for (const { r } of use) {
      const nm = r.input.storeName ?? r.input.storeCode;
      if (byName.get(nm) == null) continue;
      const P0 = { ...P, qualityExponent: 0 };
      const w = (p: typeof P) => {
        const b = computeTextbook(r.input, p);
        void b;
        return 0;
      };
      void w;
      // 직접 계산한다 — computeTextbook은 분모를 안 내놓는다.
      const oq = r.input.ownQualityParts;
      let rawW = 0, qW = 0;
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const dw = rivalDistanceWeight(rv.distanceM, P);
        if (dw <= 0) continue;
        rawW += rv.ip * dw;
        // ratio는 computeTextbook과 같은 규칙 — 자사/경쟁 중 하나라도 없으면 1
        let ratio = 1;
        if (oq && rv.parts) {
          const o = computeQualityScoreLocal(oq), v = computeQualityScoreLocal(rv.parts);
          if (o != null && o > 0 && v != null && v > 0) ratio = v / o;
        }
        qW += rv.ip * Math.pow(ratio, P.qualityExponent) * dw;
      }
      void P0;
      if (rawW > 0) {
        kept.push(qW / rawW);
        if (rivalRankHi.has(nm)) keptHi.push(qW / rawW);
      }
    }
    console.log(`\n[θ가 지우는 양] 품질을 먹인 뒤 분모에 남는 경쟁량 (날 경쟁량 대비)`);
    console.log(`  전체 중앙 ${(([...kept].sort((a, b) => a - b))[Math.floor(kept.length / 2)] * 100).toFixed(0)}%`
      + ` · 범위 ${(Math.min(...kept) * 100).toFixed(0)}~${(Math.max(...kept) * 100).toFixed(0)}%`);
    console.log(`  경쟁 센 절반 중앙 ${(([...keptHi].sort((a, b) => a - b))[Math.floor(keptHi.length / 2)] * 100).toFixed(0)}%`
      + `  (여기서 많이 지울수록 점유율이 후해진다)`);

    console.log(`\n[재고 표 — 품질 지수 θ] ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    // ⚠️ θ는 **수준을 크게 흡수한다**(θ=0에서 편향 −16%p). 수준은 축척이 맡는 자리라,
    //    θ를 MAE로 고르면 `실험실 MAPE는 수준에 끌려다닌다`는 그 병에 걸린다.
    //    그래서 **수준보정 MAE**(예측 전체에 상수를 곱해 log 편향을 0으로 맞춘 뒤)를 같이 찍는다.
    console.log(`  θ       MAE      최악    편향   ±5%p  퍼짐  분별력 r   경쟁 센 절반 MAE  약한 절반 | 수준보정 MAE  ±5%p`);
    const hiIdx = use.map((_, i) => i).filter((i) => rivalRankHi.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const loIdx = use.map((_, i) => i).filter((i) => !rivalRankHi.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    for (const th of [0, 0.5, 1, 1.5, 2, 3, 4]) {
      const P2 = { ...P, qualityExponent: th };
      const preds = use.map(({ r }) => computeTextbook(r.input, P2).utilization ?? NaN);
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      console.log(`  ${th.toFixed(1).padStart(3)}${(mean(abs) * 100).toFixed(2).padStart(9)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(15)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p |`
        + (() => {
          const k = Math.exp(mean(actLog) - mean(pl));
          const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
          return `${(mean(absL) * 100).toFixed(2).padStart(9)}%p  ${String(absL.filter((v) => v <= 0.05).length).padStart(2)}/${n}`;
        })()
        + (th === P.qualityExponent ? "  ← 지금" : ""));
    }
    console.log(`\n  ⛔ 표본 안 성적으로 고르지 마라. 고를 만한 칸이 보이면 **중첩 LOO**부터다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(O) ⭐⭐⭐ 500m 조사 구멍 — 경쟁 센 절반의 분모는 96%가 이 구간이다", () => {
    // ── 왜 여기인가 ────────────────────────────────────────────────────────
    // (L) 산식이 무너지는 건 **경쟁 센 절반**이고, (M) 거기 분모의 **96%가 500m 안**이다.
    // 500m 안은 2km 자료가 일부러 비켜 간다(`rival2km.ts`: "같은 가게를 두 번 세면 안 된다").
    // 즉 그 구간은 **전적으로 사람이 조사한 DB**에 기대고 있는데, 인계문서 5절에
    // *"인허가 영업이고 지도에도 있는데 조사DB에 없는 게 104건"*이 열린 채 남아 있다.
    //
    // 빠진 경쟁점이 있으면 분모가 작아지고 -> 점유율이 후해지고 -> **과대예측**한다.
    // 경쟁 센 절반이 정확히 과대예측이다(시흥배곧 48->36 · 일산탄현 46->33 · 금촌역 46->37).
    //
    // ── 재는 법 ────────────────────────────────────────────────────────────
    // 카카오 원자료(`kakao-pcbangs-grid.json`)에는 **500m 안도 다 들어 있다.**
    // 조사DB와 이름·거리로 짝지어 보고, 짝 못 찾은 카카오 가게를 "구멍"으로 센다.
    //
    // ⚠️ 500m는 **운영 V62가 쓰는 구간**이다. 여기서는 **실험실 입력만** 고쳐서 재고,
    //    조사DB나 Firestore는 **건드리지 않는다**.
    const GRID = ".local-tools/kakao-pcbangs-grid.json";
    if (!existsSync(GRID)) { console.log(`\n[500m 조사 구멍] ${GRID}가 없다 — 건너뛴다`); return; }
    type Doc = { id: string; name: string; lat: number; lng: number; distanceM: number };
    const grid = JSON.parse(readFileSync(GRID, "utf8")) as {
      sites: Record<string, { code: string | null; name: string | null; pcRooms?: { docs?: Doc[] } }>;
    };
    // 생성기와 **같은 규칙**을 쓴다 — 잣대가 둘이면 비교가 뜻이 없어진다.
    const ARCADE = /게임랜드|게임장|오락|성인|스크린|멀티방|다트|보드게임|만화|플스|VR|사격|당구|노래/i;
    const SELF_M = 50, OFFICIAL_M = 500;
    const norm = (t: string | null | undefined) => String(t ?? "")
      .replace(/\(.*?\)/g, "").replace(/피씨|피시/gi, "PC")
      .replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();
    const sim = (a: string | null | undefined, b: string | null | undefined) => {
      const x = norm(a), y = norm(b);
      if (!x || !y) return 0;
      if (x === y) return 1;
      if (x.includes(y) || y.includes(x)) return 0.9;
      const n2 = Math.min(x.length, y.length);
      let c = 0;
      for (let i = 0; i < n2; i++) if (x[i] === y[i]) c++;
      return c / Math.max(x.length, y.length);
    };

    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    /** 매장별 — 조사DB가 못 담은 500m 안 카카오 가게들 */
    const holes: Doc[][] = use.map(({ r }) => {
      const site = grid.sites[`existing:${r.input.storeCode}`];
      const docs = (site?.pcRooms?.docs ?? [])
        .filter((d) => d.distanceM > SELF_M && d.distanceM <= OFFICIAL_M)
        .filter((d) => !ARCADE.test(d.name ?? ""));
      // 같은 가게가 여러 건으로 잡히는 걸 먼저 접는다(30m 안 + 이름 비슷).
      const uniq: Doc[] = [];
      for (const d of docs) {
        if (uniq.some((u) => sim(u.name, d.name) >= 0.6
          && Math.hypot(u.lat - d.lat, u.lng - d.lng) * 111000 <= 30)) continue;
        uniq.push(d);
      }
      // 조사된 500m 경쟁점과 짝짓는다 — 이름이 비슷하면 같은 가게로 본다.
      const surveyed = (r.input.rivals ?? [])
        .filter((rv) => rv.distanceM == null || rv.distanceM <= OFFICIAL_M);
      const used = new Set<number>();
      const missed: Doc[] = [];
      for (const d of uniq) {
        let bi = -1, bs = 0;
        surveyed.forEach((rv, k) => {
          if (used.has(k)) return;
          const s = sim(rv.name, d.name);
          if (s > bs) { bs = s; bi = k; }
        });
        if (bs >= 0.6 && bi >= 0) { used.add(bi); continue; }
        missed.push(d);
      }
      return missed;
    });

    const nSurveyed = use.map(({ r }) => (r.input.rivals ?? [])
      .filter((rv) => rv.distanceM == null || rv.distanceM <= OFFICIAL_M).length);
    const rowIdx = use.map(({ r }) => rows.findIndex((x) => x.name === (r.input.storeName ?? r.input.storeCode)));
    const resid = use.map((_, i) => (rowIdx[i] >= 0 ? Math.log(rows[rowIdx[i]].act / rows[rowIdx[i]].pred) : NaN));
    const hiSet = new Set([...rows].sort((a, b) => a.rivalW - b.rivalW).slice(Math.floor(rows.length / 2)).map((r) => r.name));
    const isHi = use.map(({ r }) => hiSet.has(r.input.storeName ?? r.input.storeCode));

    console.log(`\n[500m 조사 구멍] 카카오 500m 안 vs 조사DB · n=${n}`);
    console.log(`  조사된 500m 경쟁점 합계 ${nSurveyed.reduce((a, b) => a + b, 0)}곳`
      + ` · 카카오에만 있는 것 **${holes.reduce((a, b) => a + b.length, 0)}곳**`);
    console.log(`  매장당 구멍: 중앙 ${[...holes.map((h) => h.length)].sort((a, b) => a - b)[Math.floor(n / 2)]}곳`
      + ` · 범위 ${Math.min(...holes.map((h) => h.length))}~${Math.max(...holes.map((h) => h.length))}곳`);
    console.log(`  경쟁 약한 절반 평균 ${mean(holes.filter((_, i) => !isHi[i]).map((h) => h.length)).toFixed(1)}곳`
      + ` · 경쟁 센 절반 평균 ${mean(holes.filter((_, i) => isHi[i]).map((h) => h.length)).toFixed(1)}곳`);
    const hv = holes.map((h) => h.length);
    console.log(`  구멍 개수와 잔차의 상관 r = ${corr(hv, resid).toFixed(3)}  (음수면 의심이 맞다 — 구멍 많을수록 과대예측)`);
    console.log(`\n  구멍이 큰 5곳 (매장 · 조사 · 구멍 · 예측 -> 실측)`);
    const order = use.map((_, i) => i).sort((a, b) => hv[b] - hv[a]).slice(0, 5);
    for (const i of order) {
      const rr = rowIdx[i] >= 0 ? rows[rowIdx[i]] : null;
      console.log(`    ${(use[i].r.input.storeName ?? "").padEnd(14)}조사 ${String(nSurveyed[i]).padStart(2)}곳`
        + ` · 구멍 ${String(hv[i]).padStart(2)}곳`
        + (rr ? `  ${(rr.pred * 100).toFixed(1)}% -> ${(rr.act * 100).toFixed(1)}%` : ""));
      console.log(`      빠진 것: ${holes[i].slice(0, 4).map((d) => `${d.name}(${d.distanceM}m)`).join(" · ")}`);
    }

    // ── 메워 보기 — 실험실 입력에만 넣는다 ─────────────────────────────────
    // 대수는 500m 안 미조사와 **같은 기본대수**를 쓴다(잣대를 둘로 만들지 않는다).
    // 품질은 모른다 -> null(자사와 같은 품질로 본다). 2km 경쟁점과 같은 대우다.
    console.log(`\n[재고 표 — 구멍을 메우면] ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  가정 대수      MAE      최악    편향   ±5%p  퍼짐  분별력 r   경쟁 센 절반  약한 절반`);
    const hiIdx = use.map((_, i) => i).filter((i) => isHi[i]);
    const loIdx = use.map((_, i) => i).filter((i) => !isHi[i]);
    const scoreFill = (pcAssumed: number | null) => {
      const preds = use.map(({ r }, i) => {
        const add = pcAssumed == null ? [] : holes[i].map((d) => ({
          ip: pcAssumed, distanceM: d.distanceM, parts: null as QualityParts | null, name: d.name,
        }));
        return computeTextbook({ ...r.input, rivals: [...(r.input.rivals ?? []), ...add] }, P).utilization ?? NaN;
      });
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      return { abs, pl, preds };
    };
    for (const pcA of [null, 45, 60, 90]) {
      const { abs, pl, preds } = scoreFill(pcA);
      console.log(`  ${(pcA == null ? "안 메움" : `${pcA}대`).padStart(6)}`
        + `${(mean(abs) * 100).toFixed(2).padStart(10)}%p${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(13)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p`
        + (pcA == null ? "  ← 지금" : ""));
    }
    console.log(`\n  ⛔ **자동으로 채택하지 않는다.** 카카오가 실체는 99% 맞히지만 (1) 대수를 모르고`);
    console.log(`     (2) 그 가게가 평가창에 영업했는지도 여기선 안 따졌다(2km 쪽은 인허가로 따진다).`);
    console.log(`     성적이 좋아지면 **조사DB를 채우는 일**로 넘기는 게 맞다 — 500m는 운영 V62 구간이다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(P) ⭐⭐⭐ 구멍 메우기를 **공정하게** 다시 — 인허가로 영업 시점을 따진다", () => {
    // (O)의 메우기는 **불공정했다.** 카카오는 2026-09에 찍은 **지금** 목록인데, 평가창은
    // 매장마다 과거 12달이다. 2026년에 문 연 가게를 2023년 평가창에 넣으면 당연히
    // 경쟁이 과하게 잡힌다 — 2km 쪽은 그래서 **인허가로 영업 비중을 매긴다.**
    // 같은 잣대를 500m에도 대야 비교가 뜻이 있다.
    //
    // 그리고 θ도 같이 훑는다. (N)에서 θ=3이 **수준을 크게 흡수**하고 있었다
    // (θ=0이면 편향 −16%p). 경쟁점 수가 늘면 맞는 θ도 달라지는 게 당연하다 —
    // 경쟁점 목록과 θ를 **같이** 봐야 "목록이 틀렸나 θ가 틀렸나"를 가를 수 있다.
    const GRID = ".local-tools/kakao-pcbangs-grid.json";
    const PERMITS = ".local-tools/pcbang-permits.json";
    if (!existsSync(GRID) || !existsSync(PERMITS)) {
      console.log(`\n[공정한 구멍 메우기] 원자료가 없다 — 건너뛴다`); return;
    }
    type Doc = { id: string; name: string; lat: number; lng: number; distanceM: number };
    const grid = JSON.parse(readFileSync(GRID, "utf8")) as {
      sites: Record<string, { pcRooms?: { docs?: Doc[] } }>;
    };
    type Permit = { name: string; lat: number; lng: number; open?: string | null; close?: string | null };
    const permits = (JSON.parse(readFileSync(PERMITS, "utf8")).rows as Permit[])
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const ARCADE = /게임랜드|게임장|오락|성인|스크린|멀티방|다트|보드게임|만화|플스|VR|사격|당구|노래/i;
    const norm = (t: string | null | undefined) => String(t ?? "")
      .replace(/\(.*?\)/g, "").replace(/피씨|피시/gi, "PC")
      .replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();
    const sim = (a: string | null | undefined, b: string | null | undefined) => {
      const x = norm(a), y = norm(b);
      if (!x || !y) return 0;
      if (x === y) return 1;
      if (x.includes(y) || y.includes(x)) return 0.9;
      const n2 = Math.min(x.length, y.length);
      let c = 0;
      for (let i = 0; i < n2; i++) if (x[i] === y[i]) c++;
      return c / Math.max(x.length, y.length);
    };
    const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const R = 6371000, rad = Math.PI / 180;
      const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
      const s = Math.sin(dLat / 2) ** 2
        + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };
    const ymd = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    /** 매장별 구멍 + 평가창 영업 비중 */
    let joined = 0, unjoined = 0;
    const holes: { d: Doc; share: number }[][] = use.map(({ r }) => {
      const site = grid.sites[`existing:${r.input.storeCode}`];
      const docs = (site?.pcRooms?.docs ?? [])
        .filter((d) => d.distanceM > 50 && d.distanceM <= 500)
        .filter((d) => !ARCADE.test(d.name ?? ""));
      const uniq: Doc[] = [];
      for (const d of docs) {
        if (uniq.some((u) => sim(u.name, d.name) >= 0.6
          && distM(u.lat, u.lng, d.lat, d.lng) <= 30)) continue;
        uniq.push(d);
      }
      const surveyed = (r.input.rivals ?? []).filter((rv) => rv.distanceM == null || rv.distanceM <= 500);
      const used = new Set<number>();
      const out: { d: Doc; share: number }[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (snap.existingStores ?? []).find((s: any) => s.storeCode === r.input.storeCode);
      const months = evaluationMonths(meta?.openedAt ?? null);
      for (const d of uniq) {
        let bi = -1, bs = 0;
        surveyed.forEach((rv, k) => {
          if (used.has(k)) return;
          const s = sim(rv.name, d.name);
          if (s > bs) { bs = s; bi = k; }
        });
        if (bs >= 0.6 && bi >= 0) { used.add(bi); continue; }
        // 인허가 짝짓기 — 생성기와 같은 자(60m · 유사도 0.6)
        const cand = permits
          .map((p) => ({ p, dd: distM(d.lat, d.lng, p.lat, p.lng) }))
          .filter((x) => x.dd <= 60)
          .map((x) => ({ ...x, sc: sim(d.name, x.p.name) }))
          .sort((a, b) => b.sc - a.sc || a.dd - b.dd)[0];
        let share = 1;
        if (cand && cand.sc >= 0.6) {
          joined += 1;
          const open = ymd(cand.p.open), close = ymd(cand.p.close);
          // rival2km의 operatingShareInWindow와 같은 뜻 — 평가창 달 중 영업한 달의 비중
          const live = months.filter((m) => {
            const last = `${m}-31`, first = `${m}-01`;
            if (open && open > last) return false;
            if (close && close < first) return false;
            return true;
          }).length;
          share = months.length ? live / months.length : 1;
        } else {
          unjoined += 1; // 시점을 모르면 **세는 쪽**(=1). 2km 쪽과 같은 원칙
        }
        if (share > 0) out.push({ d, share });
      }
      return out;
    });

    const rawN = holes.reduce((a, b) => a + b.length, 0);
    const wSum = holes.reduce((a, b) => a + b.reduce((p, q) => p + q.share, 0), 0);
    console.log(`\n[공정한 구멍 메우기] 인허가로 평가창 영업 비중을 매긴 뒤`);
    console.log(`  구멍 ${rawN}곳 · 인허가 짝 ${joined}곳 / 못 찾음 ${unjoined}곳(=세는 쪽 1.0)`);
    console.log(`  영업 비중 합 ${wSum.toFixed(1)} — **${((1 - wSum / rawN) * 100).toFixed(0)}%가 평가창엔 없던 가게였다**`);

    const hiSet = new Set([...rows].sort((a, b) => a.rivalW - b.rivalW).slice(Math.floor(rows.length / 2)).map((r) => r.name));
    const hiIdx = use.map((_, i) => i).filter((i) => hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const loIdx = use.map((_, i) => i).filter((i) => !hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const line = (label: string, preds: number[], mark = "") => {
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const k = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
      console.log(`  ${label.padEnd(22)}${(mean(abs) * 100).toFixed(2).padStart(7)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(13)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p |`
        + `${(mean(absL) * 100).toFixed(2).padStart(9)}%p${mark}`);
    };
    const predsFor = (pcAssumed: number | null, theta: number) => {
      const P2 = { ...P, qualityExponent: theta };
      return use.map(({ r }, i) => {
        const add = pcAssumed == null ? [] : holes[i].map((h) => ({
          ip: pcAssumed * h.share, distanceM: h.d.distanceM,
          parts: null as QualityParts | null, name: h.d.name,
        }));
        return computeTextbook({ ...r.input, rivals: [...(r.input.rivals ?? []), ...add] }, P2).utilization ?? NaN;
      });
    };
    console.log(`\n[재고 표] ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p · n=${n}`);
    console.log(`  경우                    MAE     최악    편향   ±5%p  퍼짐  분별력 r   경쟁 센   약한 | 수준보정`);
    line("안 메움 · θ3", predsFor(null, 3), "  ← 지금");
    for (const pcA of [45, 60, 90]) {
      for (const th of [3, 4, 5, 6]) line(`메움 ${pcA}대 · θ${th}`, predsFor(pcA, th));
    }
    console.log(`\n  ⭐ 읽는 법: 목록을 채웠을 때 **어떤 θ에서도 지금보다 분별력 r이 안 오르면**`);
    console.log(`     그 구멍은 진짜 경쟁점이 아니거나(카카오 오분류) 실제로 안 겨루는 것이다.`);
    console.log(`     r이 오르는 칸이 있으면 **조사DB를 채우는 일**이 값어치가 있다는 뜻이다.`);
    console.log(`  ⛔ 여기서 값을 고르지 않는다. 500m는 운영 V62 구간이라 더더욱 그렇다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(Q) ⭐⭐⭐ 품질을 아는 경쟁점만 θ³로 줄어든다 — 조사가 잘 된 매장이 손해를 본다", () => {
    // ── 의심 ───────────────────────────────────────────────────────────────
    // 분모 몫 = 경쟁PC x (경쟁품질 ÷ 자사품질)³ x 거리무게. 그런데 **품질을 모르면 비를 1로
    // 둔다**("모른다 = 중립"). 우리는 새 가맹점이라 품질이 늘 높아서, 품질을 **아는** 경쟁점은
    // 비가 1보다 작고 세제곱되어 **평균 31%까지 쪼그라든다**((N)에서 쟀다).
    //
    // 그러면 이런 비대칭이 생긴다:
    //   · 경쟁점을 꼼꼼히 조사한 매장 -> 경쟁이 **작게** 세진다 -> 점유율 후함 -> **과대예측**
    //   · 조사가 덜 된 매장          -> 경쟁이 1배로 통째로 세진다 -> **과소예측**
    // 이건 상권의 성질이 아니라 **자료가 있고 없고**다. 기전 없는 편향이다.
    //
    // ⚠️ "모른다 = 중립"이라는 원칙 자체는 옳다. 문제는 **중립의 자리가 1이 아니라는 것**이다 —
    //    아는 경쟁점들의 평균 비가 1보다 한참 작으면, 모르는 경쟁점에도 그 평균을 줘야
    //    같은 자로 재는 것이 된다. 지금은 모르는 쪽만 유리하게(우리에게 불리하게) 센다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    // 매장별 — 품질을 아는 경쟁점이 날 경쟁량에서 차지하는 몫
    const knownFrac: number[] = [], ratios: number[] = [];
    for (const { r } of use) {
      const oq = r.input.ownQualityParts;
      let known = 0, all = 0;
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const dw = rivalDistanceWeight(rv.distanceM, P);
        if (dw <= 0) continue;
        all += rv.ip * dw;
        if (oq && rv.parts) {
          const o = computeQualityScoreLocal(oq), v = computeQualityScoreLocal(rv.parts);
          if (o != null && o > 0 && v != null && v > 0) { known += rv.ip * dw; ratios.push(v / o); }
        }
      }
      knownFrac.push(all > 0 ? known / all : 0);
    }
    const resid = use.map(({ r }) => {
      const b = computeTextbook(r.input, P);
      const i = use.findIndex((x) => x.r === r);
      return Math.log(acts[i] / (b.utilization ?? NaN));
    });
    const gRatio = Math.exp(mean(ratios.map(Math.log)));
    console.log(`\n[품질 자료의 비대칭] n=${n}`);
    console.log(`  품질을 아는 경쟁점 몫: 중앙 ${([...knownFrac].sort((a, b) => a - b)[Math.floor(n / 2)] * 100).toFixed(0)}%`
      + ` · 범위 ${(Math.min(...knownFrac) * 100).toFixed(0)}~${(Math.max(...knownFrac) * 100).toFixed(0)}%`);
    console.log(`  아는 경쟁점들의 품질비(경쟁÷자사) 기하평균 **${gRatio.toFixed(3)}** -> θ=3이면 x${Math.pow(gRatio, 3).toFixed(3)}`);
    console.log(`  모르는 경쟁점은 비를 **1.000**으로 둔다 -> x1.000. 같은 자가 아니다.`);
    console.log(`  아는 몫과 잔차의 상관 r = ${corr(knownFrac, resid).toFixed(3)}  (음수면 의심이 맞다 — 잘 조사할수록 과대예측)`);

    // ── 재고 표 — 모르는 경쟁점에 **아는 것들의 평균 비**를 준다 ────────────
    // ⛔ 값을 고르는 게 아니다. 자리를 1에서 "표본이 말해 주는 중립"으로 옮기는 것이다.
    //    쓰는 수는 **표본에서 잰 기하평균 하나**뿐이고 자유 계수가 아니다.
    const predsWithNeutral = (neutral: number | null, theta: number) => {
      const P2 = { ...P, qualityExponent: theta };
      return use.map(({ r }) => {
        if (neutral == null) return computeTextbook(r.input, P2).utilization ?? NaN;
        // 품질 모르는 경쟁점의 ip에 neutral^θ를 미리 곱해 넣는다 —
        // computeTextbook은 parts=null이면 비를 1로 두므로 결과가 같아진다.
        const rivals = (r.input.rivals ?? []).map((rv) => {
          const oq = r.input.ownQualityParts;
          const known = oq && rv.parts
            && (computeQualityScoreLocal(oq) ?? 0) > 0 && (computeQualityScoreLocal(rv.parts) ?? 0) > 0;
          return known ? rv : { ...rv, ip: rv.ip * Math.pow(neutral, theta) };
        });
        return computeTextbook({ ...r.input, rivals }, P2).utilization ?? NaN;
      });
    };
    const hiSet = new Set([...rows].sort((a, b) => a.rivalW - b.rivalW).slice(Math.floor(rows.length / 2)).map((r) => r.name));
    const hiIdx = use.map((_, i) => i).filter((i) => hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const loIdx = use.map((_, i) => i).filter((i) => !hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const line = (label: string, preds: number[], mark = "") => {
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const k = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
      console.log(`  ${label.padEnd(26)}${(mean(abs) * 100).toFixed(2).padStart(7)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(13)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p |`
        + `${(mean(absL) * 100).toFixed(2).padStart(9)}%p${mark}`);
    };
    console.log(`\n[재고 표 — 모르는 경쟁점의 중립값] ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  경우                        MAE     최악    편향   ±5%p  퍼짐  분별력 r   경쟁 센   약한 | 수준보정`);
    line("중립 1.000 (지금) · θ3", predsWithNeutral(null, 3), "  ← 지금");
    for (const th of [3, 4]) {
      line(`중립 ${gRatio.toFixed(3)}(표본) · θ${th}`, predsWithNeutral(gRatio, th));
    }
    console.log(`\n  ⭐ 읽는 법: **분별력 r이 오르면** 그건 진짜다 — 자료 있고 없고로 생기던`);
    console.log(`     비대칭을 없앤 것이지 성적을 누른 게 아니다.`);
    console.log(`     r이 그대로고 편향만 움직이면 수준을 만진 것이므로 채택 근거가 안 된다.`);
    console.log(`  ⛔ 값을 고르지 않는다. 좋아 보이면 **중첩 LOO**부터 돌리고 사용자에게 가져간다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(R) ⭐⭐⭐ 점유율 100% 잘림 — 누가 잘리고, 잘리면 무엇을 잃나", () => {
    // 사용자(2026-09-24): *"현재 문제로 보이는 건 산식 점유율 부분인 거 같아.
    //   구미산동점 점유율 100퍼 뜨는 거, 문경시청점 100퍼 뜨는 거 등 문제 있는 거 아닌가?"*
    //
    // ── 자름이 어디서 오나 ─────────────────────────────────────────────────
    // 본체(computeTextbook)의 한 줄이다:
    //     share = Math.min(1, rawShare x 입지배율^(입지지수 ÷ 눈금지수))
    // 그런데 `rawShare = 자사PC ÷ (자사PC + 경쟁점무게)`는 **구조상 1을 못 넘는다.**
    // 즉 저 min(1, ...)이 실제로 무는 건 **입지배율이 곱해질 때뿐**이다.
    // 자름은 경쟁 구조가 만든 게 아니라 **입지 항이 만든다.**
    //
    // ── 잘리면 무엇을 잃나 ─────────────────────────────────────────────────
    // 잘린 매장끼리는 점유율이 **전부 정확히 100%**가 된다. 그러면 그 매장들 사이에서
    // 산식이 쓸 수 있는 건 수요/좌석 하나뿐이고, **입지 정보는 통째로 버려진다.**
    // 후보지 평가에서는 "입지가 좋다"가 점수에 안 실린다는 뜻이다.
    const cal = P.indexCalibration;
    const locExpInShare = cal && cal.ratioExponent !== 0 ? cal.locationExponent / cal.ratioExponent : 1;
    console.log(`\n[자름 진단] 입지 지수 ${cal?.locationExponent} ÷ 눈금 지수 ${cal?.ratioExponent}`
      + ` = 점유율에 곱하는 지수 **${locExpInShare}**`);

    type Cut = {
      name: string; act: number; pred: number;
      rawShare: number; locPow: number; want: number; got: number; lost: number;
      demandPerSeat: number; rivalW: number; rivalN: number; loc: number;
    };
    const cuts: Cut[] = [];
    for (const r of base) {
      const act = r.input.actualUtilization;
      if (act == null || !(act > 0)) continue;
      const b = computeTextbook(r.input, P);
      if (b.utilization == null || !(b.utilization > 0) || b.share == null || b.locationMultiplier == null) continue;
      const pc = r.input.pcCount ?? 0;
      if (!(pc > 0) || b.totalDemandHours == null) continue;
      const locPow = Math.pow(b.locationMultiplier, locExpInShare);
      // rawShare를 되돌린다 — share가 안 잘렸으면 share÷locPow가 rawShare다.
      // 잘렸으면 되돌릴 수 없으니 경쟁 항을 직접 다시 센다.
      let rivalW = 0, rivalN = 0;
      const oq = r.input.ownQualityParts;
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const dw = rivalDistanceWeight(rv.distanceM, P);
        if (dw <= 0) continue;
        let ratio = 1;
        if (oq && rv.parts) {
          const o = computeQualityScoreLocal(oq), v = computeQualityScoreLocal(rv.parts);
          if (o != null && o > 0 && v != null && v > 0) ratio = v / o;
        }
        rivalW += rv.ip * Math.pow(ratio, P.qualityExponent) * dw;
        rivalN += 1;
      }
      const rawShare = pc / (pc + rivalW + P.outsideOptionIp);
      const want = rawShare * locPow;
      cuts.push({
        name: r.input.storeName ?? r.input.storeCode, act, pred: b.utilization,
        rawShare, locPow, want, got: b.share, lost: Math.max(0, want - 1),
        demandPerSeat: b.totalDemandHours / (pc * 720),
        rivalW, rivalN, loc: b.locationMultiplier,
      });
    }
    const clipped = cuts.filter((c) => c.want > 1.0005);
    const near = cuts.filter((c) => c.want > 0.9 && c.want <= 1.0005);
    console.log(`\n  잘린 매장 **${clipped.length}곳** · 자름 문턱 코앞(90~100%) ${near.length}곳 · 전체 ${cuts.length}곳`);
    console.log(`\n  매장            경쟁만의몫  x입지^${locExpInShare}   =원래값   ->잘린값  버린몫   예측 -> 실측`);
    for (const c of [...clipped, ...near].sort((a, b) => b.want - a.want)) {
      console.log(`  ${c.name.padEnd(14)}${(c.rawShare * 100).toFixed(1).padStart(8)}%`
        + `${c.locPow.toFixed(3).padStart(11)}`
        + `${(c.want * 100).toFixed(1).padStart(10)}%`
        + `${(c.got * 100).toFixed(1).padStart(9)}%`
        + `${(c.lost * 100).toFixed(1).padStart(8)}%p`
        + `${(c.pred * 100).toFixed(1).padStart(9)}% -> ${(c.act * 100).toFixed(1)}%`);
    }
    console.log(`\n  ⭐ **경쟁만의 몫(rawShare)은 아무도 1을 안 넘는다.** 자름은 전부 입지 항이 만든다.`);
    console.log(`     잘린 매장끼리는 점유율이 전부 100%로 같아져서 **입지 정보가 버려진다.**`);

    // 잘린 무리 안에서 산식이 무엇으로 매장을 가르고 있나 — 사실상 수요/좌석 하나뿐이다.
    if (clipped.length >= 2) {
      console.log(`\n  잘린 무리 안에서 — 산식이 남겨 둔 유일한 차이는 수요/좌석이다`);
      console.log(`    매장            수요/좌석   예측    실측   (순서가 맞나)`);
      for (const c of [...clipped].sort((a, b) => a.demandPerSeat - b.demandPerSeat)) {
        console.log(`    ${c.name.padEnd(14)}${c.demandPerSeat.toFixed(2).padStart(9)}`
          + `${(c.pred * 100).toFixed(1).padStart(8)}%${(c.act * 100).toFixed(1).padStart(8)}%`);
      }
    }

    // ── 자름을 실제로 풀면 어떻게 되나 ─────────────────────────────────────
    // 자름의 뜻: "동네 수요보다 많이 못 먹는다". 그런데 **수요를 1km 원으로 정의**한 건
    // 우리 편의지 손님의 사정이 아니다 — 지방은 그 원 밖에서도 온다. 그러니 1을 넘는 게
    // 개념상 틀렸다고 단정할 수 없다. 실제로 재 본다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts2 = use.map((x) => x.act);
    const actLog2 = acts2.map(Math.log);
    const n2 = acts2.length;
    const loo2 = acts2.map((_, i) => mean(acts2.filter((__, j) => j !== i)));
    const baseMae2 = mean(loo2.map((v, i) => Math.abs(v - acts2[i])));
    const wantByCode = new Map(cuts.map((c) => [c.name, c.want]));
    console.log(`\n[재고 표 — 점유율 자름을 풀면] ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae2 * 100).toFixed(2)}%p`);
    console.log(`  경우              MAE      최악    편향   ±5%p  퍼짐  분별력 r`);
    for (const uncap of [false, true]) {
      const preds = use.map(({ r }) => {
        const b = computeTextbook(r.input, P);
        const pc = r.input.pcCount ?? 0;
        if (b.share == null || b.totalDemandHours == null || !(pc > 0)) return NaN;
        const dps = b.totalDemandHours / (pc * 720);
        const want = wantByCode.get(r.input.storeName ?? r.input.storeCode);
        const sh = uncap && want != null ? want : b.share;
        // 좌석 상한(maxUtilization)은 **물리적 제약**이라 그대로 둔다
        return Math.min(P.maxUtilization, dps * sh);
      });
      if (preds.some((v) => !Number.isFinite(v))) continue;
      const abs = preds.map((v, i) => Math.abs(v - acts2[i]));
      const pl = preds.map(Math.log);
      console.log(`  ${(uncap ? "자름 없음" : "자름 있음(지금)").padEnd(16)}${(mean(abs) * 100).toFixed(2).padStart(6)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts2[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n2}`
        + `${(sdOf(pl) / sdOf(actLog2)).toFixed(2).padStart(6)}배${corr(pl, actLog2).toFixed(3).padStart(9)}`);
    }
    console.log(`\n  ⭐ 자름은 2곳에서 1.4~1.8%p만 깎는다 — **푼다고 성적이 달라지지 않는다.**`);
    console.log(`     자름은 병이 아니라 **표시등**이다: "이 매장은 동네 수요를 다 먹어야 겨우 맞는다".`);
    expect(cuts.length).toBeGreaterThan(30);
  });

  it("(S) ⭐⭐⭐ 필요 점유율 — 실측을 맞히려면 몇 %를 먹어야 하나", () => {
    // (R)에서 문경시청은 **점유율 100%인데도 예측 19.4%**, 실측 30.6%였다.
    // 점유율이 100%면 예측 가동률 = 수요/좌석이므로, 그 매장은 산식이 **무슨 값을 넣어도
    // 도달할 수 없다.** 실측이 동네 수요 전체보다 많다는 뜻이다.
    //
    // 그래서 매장마다 **필요 점유율 = 실측 가동률 ÷ (수요/좌석)** 을 낸다.
    // 이건 2026-09-16에 사용자가 설계한 `shareMode="off"` 진단과 같은 값이다 —
    // "이 매장이 실제로 먹은 몫". 이 값으로 **수요식을 2차 검증**할 수 있다.
    //
    //   · 필요 점유율 > 100%  -> 수요 추정이 **확실히 낮다**(구조적으로 못 맞힌다)
    //   · 필요 점유율이 90% 언저리에 몰림 -> 점유율 층이 **여유가 없다**
    //   · 필요 점유율과 산식 점유율의 상관 -> 점유율 층이 **제 일을 하나**
    type S = { name: string; act: number; dps: number; need: number; got: number; rivalW: number; rivalN: number };
    const ss: S[] = [];
    for (const r of base) {
      const act = r.input.actualUtilization;
      if (act == null || !(act > 0)) continue;
      const b = computeTextbook(r.input, P);
      if (b.utilization == null || b.share == null || b.totalDemandHours == null) continue;
      const pc = r.input.pcCount ?? 0;
      if (!(pc > 0)) continue;
      const dps = b.totalDemandHours / (pc * 720);
      if (!(dps > 0)) continue;
      let rivalW = 0, rivalN = 0;
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const dw = rivalDistanceWeight(rv.distanceM, P);
        if (dw > 0) { rivalW += rv.ip * dw; rivalN += 1; }
      }
      ss.push({ name: r.input.storeName ?? r.input.storeCode, act, dps, need: act / dps, got: b.share, rivalW, rivalN });
    }
    const impossible = ss.filter((x) => x.need > 1);
    const tight = ss.filter((x) => x.need > 0.85 && x.need <= 1);
    console.log(`\n[필요 점유율] 실측 ÷ (수요/좌석) · n=${ss.length}`);
    console.log(`  ⛔ **100%를 넘는 매장 ${impossible.length}곳** — 산식이 구조적으로 못 맞힌다`);
    console.log(`  ⚠️ 85~100%로 여유 없는 매장 ${tight.length}곳`);
    const needs = ss.map((x) => x.need).sort((a, b) => a - b);
    console.log(`  필요 점유율 분포: 중앙 ${(needs[Math.floor(ss.length / 2)] * 100).toFixed(0)}%`
      + ` · 범위 ${(needs[0] * 100).toFixed(0)}~${(needs[needs.length - 1] * 100).toFixed(0)}%`);

    console.log(`\n  필요 점유율이 높은 10곳 (수요 추정이 의심스러운 순서)`);
    console.log(`    매장            수요/좌석  필요 점유율  산식 점유율   실측    경쟁점`);
    for (const x of [...ss].sort((a, b) => b.need - a.need).slice(0, 10)) {
      console.log(`    ${x.name.padEnd(14)}${x.dps.toFixed(2).padStart(8)}`
        + `${(x.need * 100).toFixed(0).padStart(10)}%${(x.got * 100).toFixed(0).padStart(11)}%`
        + `${(x.act * 100).toFixed(1).padStart(8)}%${String(x.rivalN).padStart(8)}곳`
        + (x.need > 1 ? "  ⛔" : ""));
    }

    // ── 점유율 층이 제 일을 하나 ────────────────────────────────────────────
    const need = ss.map((x) => Math.log(x.need)), got = ss.map((x) => Math.log(x.got));
    const dps = ss.map((x) => Math.log(x.dps));
    console.log(`\n[점유율 층 검산] 전부 log`);
    console.log(`  산식 점유율 vs **필요 점유율**       r = ${corr(got, need).toFixed(3)}   ← 이게 점유율 층의 성적표다`);
    console.log(`  수요/좌석  vs **필요 점유율**       r = ${corr(dps, need).toFixed(3)}   ← 강한 음수면 수요 오차를 점유율이 뒤집어쓴다`);
    console.log(`  산식 점유율 퍼짐 ${sdOf(got).toFixed(3)} vs 필요 점유율 퍼짐 ${sdOf(need).toFixed(3)}`
      + ` · **과장 ${(sdOf(got) / sdOf(need)).toFixed(2)}배**`);
    const ma = mean(need), mb = mean(got);
    console.log(`  기울기(필요를 산식으로 회귀) = ${(mean(got.map((v, i) => (v - mb) * (need[i] - ma))) / (sdOf(need) ** 2)).toFixed(3)}  (교과서 값 1.000)`);
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 필요 점유율이 100%를 넘는 매장이 있으면 **수요층이 그 매장에서 낮다** —`);
    console.log(`       점유율을 아무리 고쳐도 못 맞힌다. 고칠 자리는 점유율이 아니라 수요다`);
    console.log(`     · 산식 점유율이 필요 점유율보다 **더 넓게 퍼져 있으면** 점유율 층이 과장한다`);
    expect(ss.length).toBeGreaterThan(30);
  });

  it("(T) ⭐⭐⭐ 왜 두 층이 다 멀쩡한데 합치면 지나 — 오차 예산을 맞춰 본다", () => {
    // (S)에서 점유율 층은 필요 점유율을 r=0.838로 따라가고 퍼짐도 0.95배(과장 아님)였다.
    // 그런데 산식 전체는 r=0.516이고 '전부 평균'에 진다. 모순처럼 보인다. 왜인가.
    //
    // ── 산수로 풀린다 ──────────────────────────────────────────────────────
    //   log(실측)  = log(수요/좌석) + log(필요 점유율)
    //   log(예측)  = log(수요/좌석) + log(산식 점유율)
    // **수요/좌석 항이 양쪽에 똑같이 들어 있다.** 그래서 오차는 정확히
    //   오차 = log(필요 점유율) − log(산식 점유율)
    // 이다. 문제는 **필요 점유율의 퍼짐이 실측 가동률의 퍼짐보다 훨씬 크다**는 것이다.
    // 필요 점유율은 수요/좌석이 만든 퍼짐을 **되돌려야** 하기 때문이다.
    //
    // 즉 산식은 **크고 서로 반대로 움직이는 두 수를 곱해서 작은 수를 만들려고** 한다.
    // 어느 한쪽의 오차가 작아도, 만들려는 답이 더 작아서 오차가 답을 덮는다.
    const A: number[] = [], D: number[] = [], G: number[] = [], N: number[] = [];
    for (const r of base) {
      const act = r.input.actualUtilization;
      if (act == null || !(act > 0)) continue;
      const b = computeTextbook(r.input, P);
      if (b.utilization == null || b.share == null || b.totalDemandHours == null) continue;
      const pc = r.input.pcCount ?? 0;
      if (!(pc > 0)) continue;
      const dps = b.totalDemandHours / (pc * 720);
      if (!(dps > 0)) continue;
      A.push(Math.log(act)); D.push(Math.log(dps)); G.push(Math.log(b.share)); N.push(Math.log(act / dps));
    }
    const resid = N.map((v, i) => v - G[i]);
    console.log(`\n[오차 예산] 전부 log 퍼짐(SD) · n=${A.length}`);
    console.log(`  맞히려는 것 — 실측 가동률        ${sdOf(A).toFixed(3)}`);
    console.log(`  수요/좌석 (양쪽에 공통)          ${sdOf(D).toFixed(3)}`);
    console.log(`  필요 점유율 (수요를 되돌려야 함)   ${sdOf(N).toFixed(3)}  ← 맞히려는 것보다 **${(sdOf(N) / sdOf(A)).toFixed(1)}배 크다**`);
    console.log(`  산식 점유율                     ${sdOf(G).toFixed(3)}`);
    console.log(`  남는 오차 = 필요 − 산식          ${sdOf(resid).toFixed(3)}  ← 실측 퍼짐 ${sdOf(A).toFixed(3)}보다 **크다**`);
    console.log(`\n  점유율 층이 필요 점유율의 분산을 얼마나 설명하나`
      + ` = ${((1 - (sdOf(resid) ** 2) / (sdOf(N) ** 2)) * 100).toFixed(0)}%`);
    console.log(`  그런데 그 나머지(${sdOf(resid).toFixed(3)})가 **답의 퍼짐(${sdOf(A).toFixed(3)})보다 커서** 바닥에 진다.`);

    // ── 그럼 수요/좌석의 퍼짐을 줄이면 어떻게 되나 — **천장만 잰다** ────────
    // ⚠️ 이건 채택 후보가 **아니다.** 지수를 붙이는 건 기전이 아니다(어제 끈 눈금 보정 b와 같다).
    //    다만 "수요 퍼짐이 진짜 병목인가"를 가르는 데는 이 천장이 답을 준다:
    //    · 줄여도 r이 안 오르면 -> 수요 퍼짐은 병목이 아니다. 딴 데를 파라
    //    · 크게 오르면 -> **상권 반경이 밀도에 따라 달라진다**는 기전을 진짜로 구현할 값이 있다
    //      (지방은 상권이 넓어 1km 원 밖에서도 오고, 도심은 좁다. 지금은 반경이 고정이다)
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
    const gD = Math.exp(mean(D));
    console.log(`\n[천장 재기 — 수요/좌석 퍼짐을 α제곱으로 줄이면] ⭐ 바닥: 전부 평균 ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  ⚠️ **채택 후보가 아니다.** 방향이 살아 있는지만 본다`);
    console.log(`  α        MAE      최악    편향   ±5%p  퍼짐  분별력 r   경쟁 센   약한`);
    for (const a of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      const preds = use.map(({ r }) => {
        const b = computeTextbook(r.input, P);
        const pc = r.input.pcCount ?? 0;
        if (b.share == null || b.totalDemandHours == null || !(pc > 0)) return NaN;
        const dps = b.totalDemandHours / (pc * 720);
        // 기하평균 기준으로 눌러서 **수준은 안 건드린다** — 퍼짐만 바꾼다
        const dps2 = gD * Math.pow(dps / gD, a);
        return Math.min(P.maxUtilization, dps2 * b.share);
      });
      if (preds.some((v) => !Number.isFinite(v))) continue;
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      console.log(`  ${a.toFixed(1).padStart(3)}${(mean(abs) * 100).toFixed(2).padStart(9)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(8)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(11)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(9)}%p`
        + (a === 1 ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐ α=0은 "수요/좌석을 전 매장 같은 값으로" — 점유율 층 혼자 맞히는 경우다.`);
    console.log(`     거기서 r이 지금보다 높으면 **수요 층이 순손해**라는 뜻이다.`);
    expect(A.length).toBeGreaterThan(30);
  });

  it("(V) ⭐ 자기검토 — 내가 한 말이 견디나 세 가지를 다시 잰다", () => {
    // 2026-09-24 사용자: *"나 흐름을 많이 놓쳐서 너가 한번 검토해봐"*
    // 오늘 내가 한 말 중 **과하게 말했을 수 있는 것** 셋을 다시 잰다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const preds0 = use.map(({ r }) => computeTextbook(r.input, P).utilization ?? NaN);

    // ── 검토 1. "오차는 점유율 층에 있다"는 말이 뜻이 있나 ──────────────────
    // (S)(T)에서 **필요 점유율 = 실측 ÷ (수요/좌석)** 으로 정의했다. 그러면
    //   필요 − 산식 = log(실측) − log(예측) = **산식 전체의 잔차**
    // 다. 정의상 그렇게 된다. 즉 "점유율 층 잔차"는 **전체 잔차와 같은 수**이고,
    // 오차가 점유율 층에 있다고 **국한한 게 아니다.** 수치로 확인한다.
    const residAll = preds0.map((v, i) => Math.log(acts[i]) - Math.log(v));
    const residShare: number[] = [];
    for (const { r } of use) {
      const b = computeTextbook(r.input, P);
      const pc = r.input.pcCount ?? 0;
      if (b.share == null || b.totalDemandHours == null || !(pc > 0)) { residShare.push(NaN); continue; }
      const dps = b.totalDemandHours / (pc * 720);
      const i = residShare.length;
      residShare.push(Math.log(acts[i] / dps) - Math.log(b.share));
    }
    console.log(`\n[검토 1] "점유율 층 잔차"와 "전체 잔차"가 같은 수인가`);
    console.log(`  전체 잔차 SD      ${sdOf(residAll).toFixed(4)}`);
    console.log(`  점유율 층 잔차 SD  ${sdOf(residShare.filter(Number.isFinite)).toFixed(4)}`);
    console.log(`  두 값의 상관 r = ${corr(residAll, residShare).toFixed(4)}`);
    console.log(`  ⚠️ 같은 수라면 **"오차가 점유율 층에 있다"는 건 국한이 아니라 항등식**이다.`);
    console.log(`     목표 숫자(0.250 -> 0.213)는 여전히 맞지만, 그게 "점유율을 고쳐라"를 뜻하진 않는다.`);
    console.log(`     상한 걸린 매장(자름·좌석상한) 때문에 아주 조금 어긋날 수 있다.`);

    // ── 검토 2. 경쟁 약한/센 절반 가르기가 견고한가 ────────────────────────
    // 걱정: 약한 절반은 **실측 자체가 더 퍼져 있어서** 바닥(전부 평균)이 원래 나쁠 수 있다.
    // 그러면 "산식이 이긴다"가 일부는 착시다. 실측 퍼짐을 같이 찍고, 분별력 r도 본다
    // (r은 수준·퍼짐에 안 끌려다닌다). 그리고 짝지은 부트스트랩으로 차이가 자료를 견디나 본다.
    const rowByName = new Map(rows.map((r) => [r.name, r]));
    const idx = use.map((_, i) => i);
    const rivalWOf = (i: number) => rowByName.get(use[i].r.input.storeName ?? use[i].r.input.storeCode)?.rivalW ?? 0;
    const sorted = [...idx].sort((a, b) => rivalWOf(a) - rivalWOf(b));
    const lo = sorted.slice(0, Math.floor(n / 2)), hi = sorted.slice(Math.floor(n / 2));
    console.log(`\n[검토 2] 경쟁 세기로 가른 게 착시가 아닌가`);
    console.log(`  무리          n   실측 퍼짐   바닥 MAE   산식 MAE   차이     분별력 r`);
    const show = (label: string, g: number[]) => {
      const a = g.map((i) => acts[i]);
      const loo = a.map((_, k) => mean(a.filter((__, j) => j !== k)));
      const bm = mean(loo.map((v, k) => Math.abs(v - a[k])));
      const mm = mean(g.map((i) => Math.abs(preds0[i] - acts[i])));
      console.log(`  ${label.padEnd(12)}${String(g.length).padStart(3)}`
        + `${(sdOf(a) * 100).toFixed(2).padStart(10)}%p${(bm * 100).toFixed(2).padStart(10)}%p`
        + `${(mm * 100).toFixed(2).padStart(10)}%p${((mm - bm) * 100).toFixed(2).padStart(8)}%p`
        + `${corr(g.map((i) => Math.log(preds0[i])), g.map((i) => actLog[i])).toFixed(3).padStart(11)}`);
      return mm - bm;
    };
    const dLo = show("경쟁 약한", lo);
    const dHi = show("경쟁 센", hi);
    // 짝지은 부트스트랩 — "약한 절반에서 이긴다"가 표본을 바꿔도 남나
    const B = 2000;
    let winLo = 0, winHi = 0;
    let seed = 20260924;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let b = 0; b < B; b++) {
      const pick = (g: number[]) => Array.from({ length: g.length }, () => g[Math.floor(rnd() * g.length)]);
      const dOf = (g: number[]) => {
        const s = pick(g);
        const a = s.map((i) => acts[i]);
        const loo = a.map((_, k) => mean(a.filter((__, j) => j !== k)));
        return mean(s.map((i) => Math.abs(preds0[i] - acts[i]))) - mean(loo.map((v, k) => Math.abs(v - a[k])));
      };
      if (dOf(lo) < 0) winLo++;
      if (dOf(hi) < 0) winHi++;
    }
    console.log(`  부트스트랩 ${B}회 — 약한 절반에서 산식이 이길 확률 **${(winLo / B * 100).toFixed(0)}%**`
      + ` · 센 절반 ${(winHi / B * 100).toFixed(0)}%`);
    console.log(`  ⚠️ 약한 절반은 실측이 더 퍼져 있어 바닥이 원래 나쁘다 — 그만큼은 착시다.`);
    console.log(`     그래도 **분별력 r**(수준·퍼짐에 안 끌림)이 ${corr(lo.map((i) => Math.log(preds0[i])), lo.map((i) => actLog[i])).toFixed(3)}`
      + ` vs ${corr(hi.map((i) => Math.log(preds0[i])), hi.map((i) => actLog[i])).toFixed(3)}로 갈린다.`);
    void dLo; void dHi;

    // ── 검토 3. 입지 지수 0.5는 기전인가 눌러 담기인가 ─────────────────────
    // (G)에서 입지를 얼려도 **분별력 r이 0.516 그대로**였다. 그러면 입지 항이 하는 일은
    // 퍼짐 축소뿐일 수 있다 — 그건 사용자가 어제 끈 눈금 보정 b와 **같은 성격**이다.
    // 지수를 훑으며 r과 **순위 분별력**을 같이 본다.
    const rankOf = (v: number[]) => {
      const o = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
      const rk = new Array(v.length).fill(0);
      o.forEach(([, i], k) => { rk[i] = k + 1; });
      return rk;
    };
    const actRank = rankOf(acts);
    console.log(`\n[검토 3] 입지 지수는 분별력을 주나, 퍼짐만 줄이나`);
    console.log(`  지수     MAE      퍼짐   분별력 r   순위 분별력`);
    for (const e of [0, 0.169, 0.3, 0.5, 0.75, 1.0]) {
      const P2 = { ...P, indexCalibration: { ...P.indexCalibration!, locationExponent: e } };
      const pr = use.map(({ r }) => computeTextbook(r.input, P2).utilization ?? NaN);
      const abs = pr.map((v, i) => Math.abs(v - acts[i]));
      console.log(`  ${e.toFixed(3).padStart(5)}${(mean(abs) * 100).toFixed(2).padStart(9)}%p`
        + `${(sdOf(pr.map(Math.log)) / sdOf(actLog)).toFixed(2).padStart(7)}배`
        + `${corr(pr.map(Math.log), actLog).toFixed(3).padStart(11)}`
        + `${corr(rankOf(pr), actRank).toFixed(3).padStart(13)}`
        + (e === P.indexCalibration!.locationExponent ? "  ← 지금" : ""));
    }
    console.log(`\n  ⚠️ 지수를 올려도 **분별력 r이 안 오르고 순위 분별력이 떨어지면**, 입지 항은`);
    console.log(`     "어느 매장이 더 잘 되나"를 못 가르고 **퍼짐만 줄이는** 것이다.`);
    console.log(`     그건 기전이 아니라 보정이다 — 사용자가 눈금 보정 b를 끈 이유와 같다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(W) ⭐⭐⭐ 경쟁력 항목 다섯을 하나씩 — 일괄 4점인 항목이 일을 하나", () => {
    // 사용자(2026-09-24): *"품질 의심할 만한 건 인테리어 평가랑 먹거리 평가 두 개가
    //   일괄 4점이니 이 부분 의심해볼 만하지."*
    //
    // 비중은 먹거리 7.5% · 인테리어 10.2% = **합쳐 17.7%**다. 자사가 일괄 4점이면
    // 그 몫은 **잰 값이 아니라 가정**이고, 경쟁점은 실제로 조사한 값이 들어간다.
    // 그러면 비대칭이 생긴다 — 우리는 "아마 4점", 경쟁점은 "실제 점수".
    // 품질은 (경쟁÷자사)³로 들어가므로 자사가 후하면 **경쟁점이 세제곱으로 쪼그라든다.**
    //
    // ⚠️ 이건 (Q)에서 본 "모르는 경쟁점" 비대칭과 **반대 방향**이다. 거기선 경쟁점 쪽이
    //    결측이었고, 여기선 **자사 쪽이 가정**이다.
    //
    // ⛔ 값을 고르지 않는다. 항목을 껐다 켜며 재고 표만 남긴다.
    //    끄는 건 자사·경쟁점 **양쪽 다** null로 두는 것이다 — computeQualityScore가
    //    "있는 항목의 합으로 나누"므로 비중이 알아서 재분배된다. 잣대가 한쪽만 바뀌지 않는다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    type Key = keyof QualityParts;
    const KEYS: Key[] = ["spec", "food", "zone", "interior", "management"];
    const KO: Record<Key, string> = {
      spec: "사양", food: "먹거리", zone: "존구성", interior: "인테리어", management: "관리(QSC)",
    };
    // ── 항목별 분포 — 자사 vs 경쟁점 ────────────────────────────────────────
    const ownVals: Record<Key, number[]> = { spec: [], food: [], zone: [], interior: [], management: [] };
    const rivVals: Record<Key, number[]> = { spec: [], food: [], zone: [], interior: [], management: [] };
    let ownMissing = 0, rivMissing = 0, rivTotal = 0;
    for (const { r } of use) {
      const o = r.input.ownQualityParts;
      for (const k of KEYS) {
        const v = o?.[k];
        if (v != null && Number.isFinite(v)) ownVals[k].push(v); else ownMissing += 1;
      }
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0) || rivalDistanceWeight(rv.distanceM, P) <= 0) continue;
        rivTotal += 1;
        if (!rv.parts) { rivMissing += 1; continue; }
        for (const k of KEYS) {
          const v = rv.parts[k];
          if (v != null && Number.isFinite(v)) rivVals[k].push(v);
        }
      }
    }
    const desc = (a: number[]) => a.length
      ? `평균 ${mean(a).toFixed(2)} · SD ${sdOf(a).toFixed(2)} · 범위 ${Math.min(...a).toFixed(1)}~${Math.max(...a).toFixed(1)}`
      : "값 없음";
    console.log(`\n[항목별 분포] 자사 ${use.length}곳 vs 경쟁점 ${rivTotal}곳(품질 없는 곳 ${rivMissing}곳)`);
    console.log(`  항목         비중     자사                                   경쟁점`);
    for (const k of KEYS) {
      const w = P.qualityWeights[k as keyof typeof P.qualityWeights] ?? 0;
      const flat = ownVals[k].length > 1 && sdOf(ownVals[k]) < 1e-9;
      console.log(`  ${KO[k].padEnd(10)}${(w * 100).toFixed(1).padStart(5)}%  `
        + `${desc(ownVals[k]).padEnd(38)}${desc(rivVals[k])}`
        + (flat ? "   ⛔ 자사 일괄" : ""));
    }
    void ownMissing;
    const flatKeys = KEYS.filter((k) => ownVals[k].length > 1 && sdOf(ownVals[k]) < 1e-9);
    const flatW = flatKeys.reduce((a, k) => a + (P.qualityWeights[k as keyof typeof P.qualityWeights] ?? 0), 0);
    const allW = KEYS.reduce((a, k) => a + (P.qualityWeights[k as keyof typeof P.qualityWeights] ?? 0), 0);
    console.log(`\n  ⛔ 자사가 일괄인 항목: ${flatKeys.map((k) => KO[k]).join(" · ") || "없음"}`
      + ` — 비중 합 ${(flatW * 100).toFixed(1)}% (전체 ${(allW * 100).toFixed(1)}% 중 **${(flatW / allW * 100).toFixed(0)}%**)`);
    console.log(`     그 항목들에서 자사 평균 ${flatKeys.map((k) => ownVals[k][0]?.toFixed(2)).join("/")}`
      + ` vs 경쟁점 평균 ${flatKeys.map((k) => (rivVals[k].length ? mean(rivVals[k]).toFixed(2) : "-")).join("/")}`);

    // ── 항목을 껐다 켜며 성적을 본다 ────────────────────────────────────────
    const strip = (keys: Key[]) => (p: QualityParts | null): QualityParts | null => {
      if (!p) return p;
      const out = { ...p };
      for (const k of keys) out[k] = null;
      return out;
    };
    const predsWithout = (keys: Key[], theta = P.qualityExponent) => {
      const f = strip(keys);
      const P2 = { ...P, qualityExponent: theta };
      return use.map(({ r }) => computeTextbook({
        ...r.input,
        ownQualityParts: f(r.input.ownQualityParts),
        rivals: (r.input.rivals ?? []).map((rv) => ({ ...rv, parts: f(rv.parts) })),
      }, P2).utilization ?? NaN);
    };
    /** 그 설정에서 경쟁점 한 곳이 분모에서 몇 배로 줄어드나(품질비^θ 기하평균). */
    const shrinkOf = (keys: Key[], theta = P.qualityExponent) => {
      const f = strip(keys);
      const rs: number[] = [];
      for (const { r } of use) {
        const oq = f(r.input.ownQualityParts);
        const o = oq ? computeQualityScoreLocal(oq) : null;
        if (o == null || !(o > 0)) continue;
        for (const rv of r.input.rivals ?? []) {
          if (!(rv.ip > 0) || rivalDistanceWeight(rv.distanceM, P) <= 0 || !rv.parts) continue;
          const pp = f(rv.parts);
          const v = pp ? computeQualityScoreLocal(pp) : null;
          if (v == null || !(v > 0)) continue;
          rs.push(v / o);
        }
      }
      const g = rs.length ? Math.exp(mean(rs.map(Math.log))) : NaN;
      return { ratio: g, shrink: Math.pow(g, theta) };
    };
    const hiSet = new Set([...rows].sort((a, b) => a.rivalW - b.rivalW).slice(Math.floor(rows.length / 2)).map((r) => r.name));
    const hiIdx = use.map((_, i) => i).filter((i) => hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const loIdx = use.map((_, i) => i).filter((i) => !hiSet.has(use[i].r.input.storeName ?? use[i].r.input.storeCode));
    const line = (label: string, keys: Key[], theta = P.qualityExponent, mark = "") => {
      const preds = predsWithout(keys, theta);
      if (preds.some((v) => !Number.isFinite(v))) { console.log(`  ${label.padEnd(24)}(계산 불가)`); return; }
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const k = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * k - acts[i]));
      const s = shrinkOf(keys, theta);
      console.log(`  ${label.padEnd(24)}${(mean(abs) * 100).toFixed(2).padStart(6)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(7)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${(sdOf(pl) / sdOf(actLog)).toFixed(2).padStart(6)}배${corr(pl, actLog).toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(11)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(9)}%p |`
        + `${(mean(absL) * 100).toFixed(2).padStart(8)}%p`
        + `${s.ratio.toFixed(3).padStart(8)}${s.shrink.toFixed(3).padStart(8)}${mark}`);
    };
    console.log(`\n[재고 표 — 항목을 끄면] ⭐ 바닥: 전부 평균(LOO) MAE ${(baseMae * 100).toFixed(2)}%p · n=${n}`);
    console.log(`  경우                      MAE     최악   편향   ±5%p  퍼짐  분별력 r   경쟁 센    약한 | 수준보정  품질비  ×배`);
    line("전부 켬(지금)", [], P.qualityExponent, "  ← 지금");
    for (const k of KEYS) line(`${KO[k]} 끔`, [k]);
    line("먹거리+인테리어 끔", ["food", "interior"]);
    console.log(`  ${"-".repeat(118)}`);
    console.log(`  먹거리+인테리어를 끄면 품질비가 올라간다 -> θ도 같이 봐야 공정하다`);
    for (const th of [3, 4, 5]) line(`먹거리+인테리어 끔 · θ${th}`, ["food", "interior"], th);
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 껐더니 **분별력 r이 오르면** 그 항목은 잡음이었다(자사가 가정이라 비대칭을 만들었다)`);
    console.log(`     · r이 떨어지면 그 항목은 **일을 하고 있었다** — 일괄 4점이어도 경쟁점 쪽이 갈라 준다`);
    console.log(`     · **품질비·×배** 칸을 꼭 봐라. 자사 가정이 후하면 경쟁점이 세제곱으로 쪼그라든다`);

    // ── 그 4.00이라는 가정이 얼마나 지렛대인가 ──────────────────────────────
    // 끄는 건 답이 아니다(위에서 MAE·퍼짐이 나빠진다). 진짜 물음은 **"4.00이 맞나"**다.
    // 자사 먹거리·인테리어를 다른 값으로 바꿔 보면 가정의 무게가 보인다.
    // 경쟁점 평균이 2.53/2.55니까 4.00은 **경쟁점보다 1.45점 위**라고 주장하는 셈이다.
    // ⛔ 여기서 값을 고르지 않는다. **자사를 실제로 채점해야** 풀리는 문제다.
    const predsOwnAt = (v: number, theta = P.qualityExponent) => {
      const P2 = { ...P, qualityExponent: theta };
      return use.map(({ r }) => computeTextbook({
        ...r.input,
        ownQualityParts: r.input.ownQualityParts
          ? { ...r.input.ownQualityParts, food: v, interior: v }
          : r.input.ownQualityParts,
      }, P2).utilization ?? NaN);
    };
    console.log(`\n[재고 표 — 자사 먹거리·인테리어 점수를 바꿔 보면] 경쟁점 평균은 ${mean(rivVals.food).toFixed(2)}/${mean(rivVals.interior).toFixed(2)}`);
    console.log(`  자사 점수     MAE     최악   편향   ±5%p  퍼짐  분별력 r   경쟁 센    약한 | 수준보정  이기는데 남은 거리`);
    for (const v of [5.0, 4.5, 4.0, 3.5, 3.0, 2.5]) {
      const preds = predsOwnAt(v);
      if (preds.some((x) => !Number.isFinite(x))) continue;
      const abs = preds.map((x, i) => Math.abs(x - acts[i]));
      const pl = preds.map(Math.log);
      const kk = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((x, i) => Math.abs(x * kk - acts[i]));
      const spread = sdOf(pl) / sdOf(actLog);
      const rr = corr(pl, actLog);
      console.log(`  ${v.toFixed(1).padStart(5)}점${(mean(abs) * 100).toFixed(2).padStart(9)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(7)}%p`
        + `${(mean(preds.map((x, i) => x - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((x) => x <= 0.05).length).padStart(2)}/${n}`
        + `${spread.toFixed(2).padStart(6)}배${rr.toFixed(3).padStart(9)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(11)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(9)}%p |`
        + `${(mean(absL) * 100).toFixed(2).padStart(8)}%p`
        + `${(rr - spread / 2).toFixed(3).padStart(16)}`
        + (v === 4 ? "  ← 지금" : ""));
    }
    console.log(`\n  ⭐ "이기는데 남은 거리" = 분별력 r − 퍼짐÷2. **0을 넘으면 '전부 평균'을 이긴다.**`);
    console.log(`  ⛔ 이 표로 점수를 고르면 그게 **자료에 맞추기**다 — 자사 점수는 현장에서 매기는 값이지`);
    console.log(`     오차가 작아지는 값이 아니다. 이 표는 "그 가정이 얼마나 무거운가"만 말해 준다.`);
    console.log(`  ⭐ **수준은 지렛대가 아니다.** 4.0->2.5로 내려도 r이 0.52 언저리에서 안 움직인다.`);
    console.log(`     문제는 점수가 높다는 게 아니라 **매장마다 같다(SD 0.00)**는 것이다.`);

    // ── 그럼 변동이 생기면 얼마나 좋아질 수 있나 — **천장만 잰다** ──────────
    // ⛔ 채택 후보가 **절대 아니다.** 실측과 일부러 맞춘 가짜 점수를 넣는 것이다.
    //    "자사를 실제로 채점하는 일"이 값어치가 있는지 판단할 **상한선**을 잰다:
    //    · 천장이 0.66(이기는 선)을 못 넘으면 -> 이 일만으로는 못 이긴다. 같이 할 게 더 필요하다
    //    · 넘으면 -> 채점이 제일 값싼 길이다
    const residNow = (() => {
      const pr = use.map(({ r }) => computeTextbook(r.input, P).utilization ?? NaN);
      const e = pr.map((v, i) => Math.log(acts[i]) - Math.log(v));
      const m = mean(e), s = sdOf(e);
      return e.map((v) => (v - m) / s); // 표준화한 잔차
    })();
    console.log(`\n[천장 재기 — 자사 먹거리·인테리어에 **실측과 딱 맞는** 변동을 넣으면]`);
    console.log(`  ⚠️ 채택 후보가 아니다. 현장 채점이 **완벽했을 때**의 상한선이다`);
    console.log(`  넣은 변동 SD   MAE     퍼짐  분별력 r   이기는데 남은 거리`);
    for (const sd of [0, 0.25, 0.53, 0.8]) {
      // 경쟁점 쪽 SD(0.53~0.56)나 QSC 쪽 SD(0.53)가 현실적인 크기다. 1~5점을 넘지 않게 자른다.
      const preds = use.map(({ r }, i) => {
        const v = Math.max(1, Math.min(5, 4.0 + sd * residNow[i]));
        return computeTextbook({
          ...r.input,
          ownQualityParts: r.input.ownQualityParts
            ? { ...r.input.ownQualityParts, food: v, interior: v }
            : r.input.ownQualityParts,
        }, P).utilization ?? NaN;
      });
      if (preds.some((x) => !Number.isFinite(x))) continue;
      const abs = preds.map((x, i) => Math.abs(x - acts[i]));
      const pl = preds.map(Math.log);
      const spread = sdOf(pl) / sdOf(actLog);
      const rr = corr(pl, actLog);
      console.log(`  ${sd.toFixed(2).padStart(9)}${(mean(abs) * 100).toFixed(2).padStart(10)}%p`
        + `${spread.toFixed(2).padStart(7)}배${rr.toFixed(3).padStart(10)}`
        + `${(rr - spread / 2).toFixed(3).padStart(18)}`
        + (sd === 0 ? "  ← 지금(변동 없음)" : sd === 0.53 ? "  ← 경쟁점·QSC와 같은 크기" : ""));
    }
    console.log(`\n  ⭐ 이 줄이 **채점이 완벽했을 때의 상한**이다. 실제 채점은 여기에 못 미친다.`);
    console.log(`     상한이 0을 못 넘으면 채점만으로는 '전부 평균'을 못 이긴다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(X) ⭐⭐⭐ 먹거리·인테리어 **기본값 수준**을 훑는다 — 매장별 채점이 아니다", () => {
    // 사용자(2026-09-24, (W)를 보고 정정): *"인테리어는 가맹점 평가는 똑같아야 함. 왜냐면
    //   똑같은 컨셉에 똑같은 도면으로 작업한 거니까. (...) 내가 말한 조정은 4점에서
    //   일괄적으로 좀 내린다 이런 걸 얘기한 거임. 먹거리도 마찬가지로 매장별 조정이 아니라
    //   **기본값 자체를 조정한다** 이런 의미로 얘기한 거임."*
    //
    // ⛔ **(W)의 "천장 재기"는 뜻이 없는 시험이었다.** 매장별 변동을 넣어 봤는데,
    //    인테리어는 같은 도면·같은 컨셉이라 **가맹점끼리 같은 게 맞다.** 먹거리도 같은
    //    프랜차이즈 메뉴다. 그 둘은 **매장을 가를 수 없는 항목**이다 — 그러니 분별력을
    //    올리는 데는 애초에 쓸 수 없다. 그 시험은 무시할 것.
    //
    // ── 그럼 기본값 수준은 무엇을 정하나 ───────────────────────────────────
    // 품질은 **비**로만 들어간다: 분모 몫 = 경쟁PC x (경쟁품질 ÷ 자사품질)^θ x 거리무게.
    // 자사 기본값을 내리면 **모든 경쟁점이 한꺼번에 세진다.** 그래서 이건
    //   · 분별력(어느 매장이 더 잘 되나) 손잡이가 **아니고**
    //   · **"경쟁점을 얼마나 세게 볼 것인가"** 손잡이다.
    // 다만 경쟁점이 세지면 경쟁점 수가 많은 매장이 더 크게 깎이므로, **퍼짐과 분별력에도
    // 간접 영향**이 있다. 그래서 둘 다 찍는다.
    //
    // ⚠️ θ와 **같은 자리를 만진다** — 실제로 작용하는 건 (품질비)^θ 하나다.
    //    그래서 그 값(×배)을 표에 같이 찍는다.
    // ⛔ 값은 사용자가 고른다. 여기서는 재고 표만 남긴다.
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

    /** 자사 먹거리=f, 인테리어=i로 두었을 때의 예측. 매장마다 같은 값이다(가맹점이니까). */
    const predsAt = (f: number | null, iv: number | null) => use.map(({ r }) => computeTextbook({
      ...r.input,
      ownQualityParts: r.input.ownQualityParts
        ? { ...r.input.ownQualityParts, ...(f == null ? {} : { food: f }), ...(iv == null ? {} : { interior: iv }) }
        : r.input.ownQualityParts,
    }, P).utilization ?? NaN);
    /** 그 설정에서 경쟁점 한 곳이 분모에서 몇 배로 줄어드나. */
    const shrinkAt = (f: number | null, iv: number | null) => {
      const rs: number[] = [];
      for (const { r } of use) {
        const oqRaw = r.input.ownQualityParts;
        if (!oqRaw) continue;
        const oq = { ...oqRaw, ...(f == null ? {} : { food: f }), ...(iv == null ? {} : { interior: iv }) };
        const o = computeQualityScoreLocal(oq);
        if (o == null || !(o > 0)) continue;
        for (const rv of r.input.rivals ?? []) {
          if (!(rv.ip > 0) || rivalDistanceWeight(rv.distanceM, P) <= 0 || !rv.parts) continue;
          const v = computeQualityScoreLocal(rv.parts);
          if (v == null || !(v > 0)) continue;
          rs.push(v / o);
        }
      }
      const g = rs.length ? Math.exp(mean(rs.map(Math.log))) : NaN;
      return { ratio: g, shrink: Math.pow(g, P.qualityExponent) };
    };
    const line = (label: string, f: number | null, iv: number | null, mark = "") => {
      const preds = predsAt(f, iv);
      if (preds.some((v) => !Number.isFinite(v))) { console.log(`  ${label.padEnd(18)}(계산 불가)`); return; }
      const abs = preds.map((v, i) => Math.abs(v - acts[i]));
      const pl = preds.map(Math.log);
      const kk = Math.exp(mean(actLog) - mean(pl));
      const absL = preds.map((v, i) => Math.abs(v * kk - acts[i]));
      const spread = sdOf(pl) / sdOf(actLog);
      const rr = corr(pl, actLog);
      const s = shrinkAt(f, iv);
      console.log(`  ${label.padEnd(18)}${(mean(abs) * 100).toFixed(2).padStart(6)}%p`
        + `${(Math.max(...abs) * 100).toFixed(1).padStart(7)}%p`
        + `${(mean(preds.map((v, i) => v - acts[i])) * 100).toFixed(1).padStart(7)}%p`
        + `  ${String(abs.filter((v) => v <= 0.05).length).padStart(2)}/${n}`
        + `${spread.toFixed(2).padStart(6)}배${rr.toFixed(3).padStart(8)}`
        + `${(mean(hiIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(10)}%p`
        + `${(mean(loIdx.map((i) => abs[i])) * 100).toFixed(2).padStart(9)}%p |`
        + `${(mean(absL) * 100).toFixed(2).padStart(8)}%p`
        + `${s.ratio.toFixed(3).padStart(8)}${s.shrink.toFixed(3).padStart(8)}`
        + `${(rr - spread / 2).toFixed(3).padStart(9)}${mark}`);
    };
    console.log(`\n[재고 표 — 둘 다 같이 내린다] ⭐ 바닥: 전부 평균(LOO) ${(baseMae * 100).toFixed(2)}%p · n=${n}`);
    console.log(`  경쟁점 평균은 먹거리 2.53 · 인테리어 2.55 다`);
    console.log(`  자사 점수           MAE     최악   편향   ±5%p  퍼짐 분별력r   경쟁 센   약한 | 수준보정  품질비  ×배  남은거리`);
    for (const v of [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0]) line(`먹거리=인테리어=${v.toFixed(1)}`, v, v, v === 4 ? "  ← 지금" : "");
    console.log(`\n[재고 표 — 하나씩 따로]`);
    console.log(`  자사 점수           MAE     최악   편향   ±5%p  퍼짐 분별력r   경쟁 센   약한 | 수준보정  품질비  ×배  남은거리`);
    for (const v of [4.0, 3.5, 3.0, 2.5]) line(`먹거리만 ${v.toFixed(1)}`, v, null, v === 4 ? "  ← 지금" : "");
    for (const v of [4.0, 3.5, 3.0, 2.5]) line(`인테리어만 ${v.toFixed(1)}`, null, v, v === 4 ? "  ← 지금" : "");

    // ── 자료가 이 값을 고를 수 있나 — 중첩 LOO ──────────────────────────────
    // 가정치를 자료로 고를 때의 잣대다(어제 눈금 보정 b가 여기서 탈락했고 입지 지수는 통과했다).
    const GRID = [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0];
    const predBy = new Map<number, number[]>(GRID.map((v) => [v, predsAt(v, v)]));
    const maeOn = (v: number, idx: number[]) => mean(idx.map((i) => Math.abs((predBy.get(v) as number[])[i] - acts[i])));
    const picked: number[] = [], looErr: number[] = [];
    for (let i = 0; i < n; i++) {
      const train = use.map((_, j) => j).filter((j) => j !== i);
      let bestV = GRID[0], bestS = Infinity;
      for (const v of GRID) { const s = maeOn(v, train); if (s < bestS) { bestS = s; bestV = v; } }
      picked.push(bestV);
      looErr.push(Math.abs((predBy.get(bestV) as number[])[i] - acts[i]));
    }
    const counts = new Map<number, number>();
    for (const v of picked) counts.set(v, (counts.get(v) ?? 0) + 1);
    console.log(`\n[중첩 LOO] 한 곳 빼고 ${n - 1}곳으로 기본값을 고른 뒤 안 본 그 곳을 맞힌다`);
    console.log(`  겹마다 고른 값: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v.toFixed(1)}(${c}회)`).join(" · ")}`);
    console.log(`  **자료가 고를 수 있나**: ${counts.size === 1 ? `✅ ${n}겹 전부 같은 값` : `겹마다 ${counts.size}가지로 갈린다`}`);
    console.log(`  중첩 LOO MAE = ${(mean(looErr) * 100).toFixed(2)}%p`);

    // ── ⭐ 핵심 확인 — 4.0이 **θ를 대신 맞추고 있는 건 아닌가** ─────────────
    // 자료가 4.0을 만장일치로 골랐다고 해서 "현장 기준으로 4.0이 맞다"는 뜻은 아니다.
    // 작용하는 건 (품질비)^θ 하나이므로, 기본값을 내리면 **θ를 내려서 되돌릴 수 있다.**
    // 그러면 기본값은 **현장 판단으로 정하고 θ는 자료가 맞추는** 분업이 가능하다.
    //   · 각 기본값에서 제일 좋은 θ를 찾았을 때 성적이 **4.0·θ3과 비슷하면**
    //     -> 둘은 서로 바꿔칠 수 있다. 기본값은 사용자가 뜻으로 정하면 된다
    //   · 4.0에서만 유독 좋으면 -> 4.0에 진짜 정보가 있는 것이다
    console.log(`\n[θ를 다시 맞추면 — 기본값을 내려도 되돌릴 수 있나]`);
    console.log(`  기본값   제일 좋은 θ    MAE     퍼짐  분별력r   ×배    남은거리`);
    for (const v of [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0]) {
      let best: { th: number; mae: number; sp: number; rr: number; sh: number } | null = null;
      for (let th = 1.0; th <= 6.01; th += 0.25) {
        const P2 = { ...P, qualityExponent: th };
        const preds = use.map(({ r }) => computeTextbook({
          ...r.input,
          ownQualityParts: r.input.ownQualityParts
            ? { ...r.input.ownQualityParts, food: v, interior: v } : r.input.ownQualityParts,
        }, P2).utilization ?? NaN);
        if (preds.some((x) => !Number.isFinite(x))) continue;
        const mae = mean(preds.map((x, i) => Math.abs(x - acts[i])));
        if (best && mae >= best.mae) continue;
        const pl = preds.map(Math.log);
        best = {
          th, mae, sp: sdOf(pl) / sdOf(actLog), rr: corr(pl, actLog),
          sh: Math.pow(shrinkAt(v, v).ratio, th),
        };
      }
      if (!best) continue;
      console.log(`  ${v.toFixed(1).padStart(5)}${best.th.toFixed(2).padStart(11)}`
        + `${(best.mae * 100).toFixed(2).padStart(10)}%p${best.sp.toFixed(2).padStart(7)}배`
        + `${best.rr.toFixed(3).padStart(9)}${best.sh.toFixed(3).padStart(8)}`
        + `${(best.rr - best.sp / 2).toFixed(3).padStart(11)}`
        + (v === 4 ? "  ← 지금 자리(θ=3)" : ""));
    }
    console.log(`\n  ⭐ **×배 칸이 어느 기본값에서나 비슷하면** 둘은 서로 바꿔칠 수 있다는 뜻이다 —`);
    console.log(`     기본값은 **현장 판단으로** 정하고, θ가 그 자리를 메우면 성적이 안 상한다.`);

    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 이건 **분별력 손잡이가 아니다.** 가맹점끼리 같은 값이라 매장을 못 가른다`);
    console.log(`     · 실제로 작용하는 건 **×배**(경쟁점 한 곳이 분모에서 줄어드는 배수) 하나다`);
    console.log(`     · 그래서 **θ와 같은 자리를 만진다** — 따로 고르면 두 번 맞추게 된다`);
    console.log(`  ⛔ 성적으로 고르지 마라. 이 점수는 **현장 채점 기준**이 정할 값이고,`);
    console.log(`     표는 "그 판단이 산식을 얼마나 움직이나"만 말해 준다.`);
    expect(n).toBeGreaterThan(30);
  });

  it("(Y) ⭐⭐⭐ 기본값을 **0.1 단위로** 훑는다 — 자료가 고르게 한다", () => {
    // 사용자(2026-09-24): *"맞는 거 같긴 해. 미세하게 높은 거 같기도 하고.
    //   애매하니까 **결과값에 맞추는 쪽**이 좋을 듯?"*
    //
    // ── 이건 규칙 위반이 아니다 ────────────────────────────────────────────
    // `항목은 뜻으로, 계수만 자료로` — **항목**(먹거리·인테리어가 경쟁력에 들어간다)은
    // 뜻으로 이미 정해져 있고, 여기서 정하는 건 **계수**(기본값 수준)다. 사용자가
    // 현장 감각으로 "애매하다"고 판정했으니 자료가 고르는 게 맞는 자리다.
    // 다만 이 저장소의 잣대를 그대로 댄다: **중첩 LOO로 "자료가 고를 수 있나"부터.**
    //
    // ── ⚠️ 먹거리와 인테리어는 **따로 못 고른다** ──────────────────────────
    // 둘 다 매장마다 같은 값이라, 자사 품질점수에 주는 영향이
    //     (0.075 x Δ먹거리 + 0.102 x Δ인테리어) ÷ 0.83
    // 한 덩어리로만 나타난다. **한 축밖에 없다** — 따로 고르면 같은 자리를 두 번 맞추는 것이다.
    // 그래서 **둘을 같은 값으로** 움직인다.
    //
    // ── ⚠️ θ도 같은 자리를 만진다 ──────────────────────────────────────────
    // (X)에서 봤듯 작용하는 건 (품질비)^θ 하나다. **θ는 3으로 고정하고** 기본값만 고른다.
    // 둘 다 자유롭게 두면 자료가 짝을 못 고른다(같은 ×배를 내는 조합이 무수히 많다).
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const baseMae = mean(looMean.map((v, i) => Math.abs(v - acts[i])));

    const GRID: number[] = [];
    for (let v = 3.0; v <= 5.001; v += 0.1) GRID.push(Math.round(v * 10) / 10);
    const predsAt = (v: number) => use.map(({ r }) => computeTextbook({
      ...r.input,
      ownQualityParts: r.input.ownQualityParts
        ? { ...r.input.ownQualityParts, food: v, interior: v } : r.input.ownQualityParts,
    }, P).utilization ?? NaN);
    const predBy = new Map<number, number[]>(GRID.map((v) => [v, predsAt(v)]));
    const maeOn = (v: number, idx: number[]) => mean(idx.map((i) => Math.abs((predBy.get(v) as number[])[i] - acts[i])));
    const all = use.map((_, i) => i);

    // ── 표본 안 최선 ────────────────────────────────────────────────────────
    let bestV = GRID[0], bestS = Infinity;
    for (const v of GRID) { const s = maeOn(v, all); if (s < bestS) { bestS = s; bestV = v; } }
    console.log(`\n[0.1 단위 훑기] n=${n} · θ=3 고정 · ⭐ 바닥: 전부 평균(LOO) ${(baseMae * 100).toFixed(2)}%p`);
    console.log(`  표본 안 최선 = **${bestV.toFixed(1)}점** (MAE ${(bestS * 100).toFixed(3)}%p)`);
    console.log(`\n  4.0 언저리를 펼쳐 본다 — 곡선이 평평하면 자료가 못 고르는 것이다`);
    console.log(`  점수     MAE       퍼짐  분별력r   편향     남은거리`);
    for (const v of [3.6, 3.7, 3.8, 3.9, 4.0, 4.1, 4.2, 4.3, 4.4]) {
      const pr = predBy.get(v) as number[];
      const abs = pr.map((x, i) => Math.abs(x - acts[i]));
      const pl = pr.map(Math.log);
      const sp = sdOf(pl) / sdOf(actLog), rr = corr(pl, actLog);
      console.log(`  ${v.toFixed(1).padStart(4)}${(mean(abs) * 100).toFixed(3).padStart(10)}%p`
        + `${sp.toFixed(3).padStart(8)}배${rr.toFixed(3).padStart(9)}`
        + `${(mean(pr.map((x, i) => x - acts[i])) * 100).toFixed(2).padStart(9)}%p`
        + `${(rr - sp / 2).toFixed(3).padStart(11)}`
        + (v === 4 ? "  ← 지금" : v === bestV ? "  ← 표본 안 최선" : ""));
    }

    // ── 중첩 LOO — 자료가 고를 수 있나 ──────────────────────────────────────
    const picked: number[] = [], looErr: number[] = [];
    for (let i = 0; i < n; i++) {
      const train = all.filter((j) => j !== i);
      let bv = GRID[0], bs = Infinity;
      for (const v of GRID) { const s = maeOn(v, train); if (s < bs) { bs = s; bv = v; } }
      picked.push(bv);
      looErr.push(Math.abs((predBy.get(bv) as number[])[i] - acts[i]));
    }
    const counts = new Map<number, number>();
    for (const v of picked) counts.set(v, (counts.get(v) ?? 0) + 1);
    const spread = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n[중첩 LOO] 한 곳 빼고 ${n - 1}곳으로 고른 뒤 안 본 그 곳을 맞힌다`);
    console.log(`  겹마다 고른 값: ${spread.map(([v, c]) => `${v.toFixed(1)}(${c}회)`).join(" · ")}`);
    console.log(`  **자료가 고를 수 있나**: ${counts.size === 1 ? `✅ ${n}겹 전부 같은 값` : counts.size <= 3 ? `✅ ${counts.size}가지로 좁다` : `⚠️ 겹마다 ${counts.size}가지로 갈린다`}`);
    console.log(`  중첩 LOO MAE = ${(mean(looErr) * 100).toFixed(3)}%p`
      + ` · 4.0 고정 = ${(maeOn(4.0, all) * 100).toFixed(3)}%p`
      + ` · ${bestV.toFixed(1)} 고정 = ${(maeOn(bestV, all) * 100).toFixed(3)}%p`);

    // ── 얼마까지 움직여도 자료가 못 가르나 — 사용자 판단의 여유 폭 ──────────
    // 표본 안 최선이 지금 값과 같으면 "바꿀 근거가 없다"로 끝난다. 더 쓸모 있는 물음은
    // **"뜻으로 얼마까지 옮겨도 자료가 반대하지 않나"**다. 그게 사용자가 자유롭게 정할 폭이다.
    const B = 2000;
    let seed = 20260924;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pRef = predBy.get(4.0) as number[];
    console.log(`\n[부트스트랩 ${B}회] 4.0점과 견주어 — 구간이 0을 품으면 **자료가 못 가른다**`);
    console.log(`  견줄 값   MAE 차이(vs 4.0)    95% 구간            판정`);
    for (const v of [3.0, 3.5, 3.8, 4.2, 4.5, 5.0]) {
      const pA = predBy.get(v) as number[];
      const diffs: number[] = [];
      for (let b = 0; b < B; b++) {
        let sa = 0, sb = 0;
        for (let k = 0; k < n; k++) {
          const i = Math.floor(rnd() * n);
          sa += Math.abs(pA[i] - acts[i]); sb += Math.abs(pRef[i] - acts[i]);
        }
        diffs.push((sa - sb) / n);
      }
      diffs.sort((a, b) => a - b);
      const lo2 = diffs[Math.floor(B * 0.025)], hi2 = diffs[Math.floor(B * 0.975)];
      const crosses = lo2 < 0 && hi2 > 0;
      console.log(`  ${v.toFixed(1).padStart(5)}점`
        + `${((maeOn(v, all) - maeOn(4.0, all)) * 100).toFixed(3).padStart(15)}%p`
        + `   [${(lo2 * 100).toFixed(3).padStart(6)}, ${(hi2 * 100).toFixed(3).padStart(6)}]%p`
        + `   ${crosses ? "⚠️ 못 가른다 — 뜻으로 정해도 된다" : "✅ 자료가 가른다(4.0이 낫다)"}`);
    }

    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 중첩 LOO가 좁게 모이고 부트스트랩이 0을 안 품으면 -> 자료가 고른 값을 쓴다`);
    console.log(`     · 곡선이 평평하고 구간이 0을 품으면 -> **바꿀 근거가 없다.** 지금 값을 둔다`);
    console.log(`  ⚠️ 어느 쪽이든 **표본이 늘면 다시 잰다**(지금 40곳).`);
    expect(n).toBeGreaterThan(30);
  });

  it("(Z) ⭐⭐⭐ 40곳으로 **애초에 뭘 가를 수 있나** — 판정력을 잰다", () => {
    // 사용자(2026-09-24): *"뭐해야 되냐. 실험실 산식 어떻게 개선해야 되지. 뭐가 문제야.
    //   뭐가 문제인지 모르는 게 문제지."*
    //
    // 오늘 손잡이 아홉 개를 돌렸는데 전부 안 됐다. 그런데 내가 **안 물어본 게 하나** 있다:
    // **표본 40곳으로 애초에 얼마만 한 차이를 가를 수 있나?**
    //
    // 오늘 손잡이들이 움직인 폭은 MAE 0.1~0.5%p였다. 그게 **잡음보다 작으면**,
    // 오늘 한 일은 전부 잡음을 쫓은 것이다. 그러면 "뭐가 문제인지 모르겠다"가 아니라
    // **"40곳으로는 알 수 없다"**가 정확한 진단이 된다. 둘은 전혀 다른 처방을 낳는다.
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const acts = use.map((x) => x.act);
    const actLog = acts.map(Math.log);
    const n = acts.length;
    const preds = use.map(({ r }) => computeTextbook(r.input, P).utilization ?? NaN);
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));

    const B = 4000;
    let seed = 20260925;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // ── (1) 산식이 바닥에 진다는 것 자체가 자료를 견디나 ────────────────────
    const dBase: number[] = [];
    for (let b = 0; b < B; b++) {
      let sm = 0, sb = 0;
      for (let k = 0; k < n; k++) {
        const i = Math.floor(rnd() * n);
        sm += Math.abs(preds[i] - acts[i]); sb += Math.abs(looMean[i] - acts[i]);
      }
      dBase.push((sm - sb) / n);
    }
    dBase.sort((a, b) => a - b);
    const lo95 = dBase[Math.floor(B * 0.025)], hi95 = dBase[Math.floor(B * 0.975)];
    console.log(`\n[판정력 1] "산식이 전부 평균에 진다"가 자료를 견디나 · n=${n} · 부트스트랩 ${B}회`);
    console.log(`  산식 MAE − 바닥 MAE = ${((mean(preds.map((v, i) => Math.abs(v - acts[i])))
      - mean(looMean.map((v, i) => Math.abs(v - acts[i])))) * 100).toFixed(2)}%p`);
    console.log(`  95% 구간 [${(lo95 * 100).toFixed(2)}, ${(hi95 * 100).toFixed(2)}]%p`);
    console.log(`  ${lo95 < 0 && hi95 > 0 ? "⚠️ **구간이 0을 품는다 — 진다는 것조차 단정 못 한다**"
      : "✅ 구간이 0을 안 품는다 — 진다는 건 확실하다"}`);

    // ── (2) 분별력 r의 구간 — 이기는 선 0.659를 품나 ────────────────────────
    const rs: number[] = [];
    const pl0 = preds.map(Math.log);
    for (let b = 0; b < B; b++) {
      const xs: number[] = [], ys: number[] = [];
      for (let k = 0; k < n; k++) { const i = Math.floor(rnd() * n); xs.push(pl0[i]); ys.push(actLog[i]); }
      const v = corr(xs, ys);
      if (Number.isFinite(v)) rs.push(v);
    }
    rs.sort((a, b) => a - b);
    const kNow = sdOf(pl0) / sdOf(actLog);
    console.log(`\n[판정력 2] 분별력 r의 95% 구간 — **이기는 선은 r > ${(kNow / 2).toFixed(3)}** 이다`);
    console.log(`  r = ${corr(pl0, actLog).toFixed(3)} · 95% 구간 [${rs[Math.floor(rs.length * 0.025)].toFixed(3)}, `
      + `${rs[Math.floor(rs.length * 0.975)].toFixed(3)}]`);
    console.log(`  ${rs[Math.floor(rs.length * 0.975)] > kNow / 2
      ? "⚠️ **구간이 이기는 선을 넘는다 — 지금 산식이 이미 이기고 있을 수도 있다**"
      : "✅ 구간 전체가 이기는 선 아래 — 확실히 못 이긴다"}`);

    // ── (3) 40곳으로 가를 수 있는 **최소 효과 크기** ────────────────────────
    // 같은 매장에 두 산식을 돌려 MAE 차이를 볼 때, 그 차이의 표준오차가 얼마인가.
    // 오늘 손잡이들이 움직인 폭(0.1~0.5%p)과 견준다.
    const absNow = preds.map((v, i) => Math.abs(v - acts[i]));
    const seOfDiff = (other: number[]) => {
      const d = other.map((v, i) => Math.abs(v - acts[i]) - absNow[i]);
      return sdOf(d) / Math.sqrt(n);
    };
    // 대표적인 "작은 변화" 몇 개로 표준오차를 잰다(값 자체가 아니라 **폭**을 본다)
    const variants: { name: string; p: number[] }[] = [
      { name: "기본값 3.5", p: use.map(({ r }) => computeTextbook({
        ...r.input,
        ownQualityParts: r.input.ownQualityParts
          ? { ...r.input.ownQualityParts, food: 3.5, interior: 3.5 } : r.input.ownQualityParts,
      }, P).utilization ?? NaN) },
      { name: "입지 지수 0.169", p: use.map(({ r }) => computeTextbook(r.input,
        { ...P, indexCalibration: { ...P.indexCalibration!, locationExponent: 0.169 } }).utilization ?? NaN) },
      { name: "θ = 2.5", p: use.map(({ r }) => computeTextbook(r.input, { ...P, qualityExponent: 2.5 }).utilization ?? NaN) },
      { name: "유동 x0.10", p: use.map(({ r }) => computeTextbook(r.input, { ...P, floatingFactor: 0.10 }).utilization ?? NaN) },
    ];
    console.log(`\n[판정력 3] 40곳으로 가를 수 있는 **최소 효과 크기**`);
    console.log(`  손잡이               MAE 변화    그 차이의 표준오차   가르려면 필요한 크기(2SE)`);
    let seSum = 0, seCnt = 0;
    for (const v of variants) {
      if (v.p.some((x) => !Number.isFinite(x))) continue;
      const dm = mean(v.p.map((x, i) => Math.abs(x - acts[i]))) - mean(absNow);
      const se = seOfDiff(v.p);
      seSum += se; seCnt += 1;
      console.log(`  ${v.name.padEnd(20)}${(dm * 100).toFixed(2).padStart(8)}%p`
        + `${(se * 100).toFixed(3).padStart(18)}%p`
        + `${(2 * se * 100).toFixed(2).padStart(22)}%p`
        + (Math.abs(dm) < 2 * se ? "   ⚠️ 잡음 안" : "   ✅ 잡음 밖"));
    }
    const seAvg = seCnt ? seSum / seCnt : NaN;
    console.log(`\n  ⭐ 지금 표본에서 **2SE ≈ ${(2 * seAvg * 100).toFixed(2)}%p** 보다 작은 변화는 못 가른다.`);
    console.log(`     오늘 돌린 손잡이 아홉 개가 움직인 폭은 대부분 **0.1~0.5%p**였다.`);

    // ── (4) 그럼 표본이 몇 곳이어야 하나 ────────────────────────────────────
    // ⚠️ **두 물음을 섞으면 안 된다.** 오차가 얼마나 닮았느냐에 따라 정밀도가 완전히 다르다:
    //   (가) **산식 vs 바닥** — 서로 아주 다른 예측이라 매장별 오차 차이가 크게 흔들린다
    //   (나) **산식 vs 산식+손잡이** — 거의 같은 예측이라 오차가 짝지어 움직여 훨씬 정밀하다
    // 그래서 "바닥을 이겼다고 말하려면"과 "손잡이가 먹혔다고 말하려면"의 필요 표본이 다르다.
    const sdKnob = seAvg * Math.sqrt(n);                 // (나) 손잡이 비교
    const dBaseArr = preds.map((v, i) => Math.abs(v - acts[i]) - Math.abs(looMean[i] - acts[i]));
    const sdBase = sdOf(dBaseArr);                        // (가) 바닥 비교
    const needFor = (sd: number, target: number) => Math.ceil(Math.pow((2 * sd) / target, 2));
    console.log(`\n[판정력 4] 표본이 몇 곳이어야 가르나 (2SE 기준)`);
    console.log(`  매장별 차이의 SD — 바닥 비교 ${(sdBase * 100).toFixed(2)}%p`
      + ` · 손잡이 비교 ${(sdKnob * 100).toFixed(2)}%p (오차가 짝지어 움직여 훨씬 작다)`);
    console.log(`\n  가르려는 MAE 차이    바닥과 견줄 때    손잡이끼리 견줄 때`);
    for (const target of [0.005, 0.01, 0.015, 0.02]) {
      const a = needFor(sdBase, target), b2 = needFor(sdKnob, target);
      console.log(`  ${(target * 100).toFixed(1).padStart(8)}%p${`${a}곳`.padStart(16)}${`${b2}곳`.padStart(20)}`);
    }
    console.log(`\n  ⭐ 지금 격차(산식이 바닥에 ${((mean(absNow) - mean(looMean.map((v, i) => Math.abs(v - acts[i])))) * 100).toFixed(2)}%p 뒤진다)를`);
    console.log(`     **"진짜 지는 것"이라고 말하려면 ${needFor(sdBase, Math.abs(mean(absNow) - mean(looMean.map((v, i) => Math.abs(v - acts[i])))))}곳**이 필요하다.`);
    console.log(`     반대로 **"이겼다"고 말하려면**도 같은 크기가 필요하다 — 지금은 어느 쪽도 못 한다.`);
    console.log(`\n  ⭐⭐ 읽는 법`);
    console.log(`     · (1)이 0을 품으면 **"지금 산식이 바닥에 진다"조차 단정 못 하는 것**이다`);
    console.log(`     · (3)(4)가 말하는 건 **"작은 개선은 40곳으론 영원히 확인 못 한다"**는 것이다`);
    console.log(`     · 그러면 처방이 바뀐다 — 산식을 더 돌리는 게 아니라 **표본·자료를 늘린다**`);
    expect(n).toBeGreaterThan(30);
  });

  it("(AB) 독점매장이 어디어디인가 — 축척을 여기서 맞춘다", () => {
    // 사용자(2026-09-24): *"잠시만 독점매장 어디어디였지?"*
    //
    // 산식에서 "독점"의 뜻은 하나뿐이다 — `calibrationTarget`이 쓰는 **competitorIp = 0**,
    // 즉 **500m 안 조사 경쟁점이 없는 매장**이다. 축척(hoursPerUserPerMonth)을 여기서만
    // 맞춘다("독점상권은 점유율이 1이라 수요식만 남는다").
    // ⚠️ **2km 안에는 경쟁점이 있다.** 이름만 독점이다 — 그래서 아래에 2km 경쟁도 같이 찍는다.
    type M = { name: string; act: number | null; pred: number | null; ip: number; n500: number; w2km: number; n2km: number; share: number | null };
    const all: M[] = [];
    for (const r of base) {
      const b = computeTextbook(r.input, P);
      let w = 0, cnt = 0;
      for (const rv of r.input.rivals ?? []) {
        if (!(rv.ip > 0)) continue;
        const dw = rivalDistanceWeight(rv.distanceM, P);
        if (dw > 0) { w += rv.ip * dw; cnt += 1; }
      }
      const n500 = (r.input.rivals ?? []).filter((rv) => rv.ip > 0 && (rv.distanceM == null || rv.distanceM <= 500)).length;
      all.push({
        name: r.input.storeName ?? r.input.storeCode,
        act: r.input.actualUtilization, pred: b.utilization,
        ip: r.input.competitorIp ?? 0, n500, w2km: w, n2km: cnt, share: b.share,
      });
    }
    const mono = all.filter((x) => !x.ip);
    console.log(`\n[독점매장] 정의 = **competitorIp 0**(500m 안 조사 경쟁점 없음) · 전체 ${all.length}곳 중 **${mono.length}곳**`);
    console.log(`  매장            실측     예측    점유율   500m조사  2km경쟁무게  2km수`);
    for (const x of mono.sort((a, b2) => (b2.act ?? 0) - (a.act ?? 0))) {
      console.log(`  ${x.name.padEnd(14)}${x.act == null ? "    —" : `${(x.act * 100).toFixed(1).padStart(6)}%`}`
        + `${x.pred == null ? "    —" : `${(x.pred * 100).toFixed(1).padStart(8)}%`}`
        + `${x.share == null ? "    —" : `${(x.share * 100).toFixed(1).padStart(8)}%`}`
        + `${String(x.n500).padStart(8)}곳${x.w2km.toFixed(0).padStart(11)}${String(x.n2km).padStart(7)}곳`);
    }
    console.log(`\n  ⚠️ **이름만 독점이다** — 2km 안에는 전부 경쟁점이 있다.`);
    console.log(`     "500m 안에 없을 뿐"이고, 그래서 2026-09-22에 외부옵션 20대를 뺐다.`);
    // 사실상 독점에 가까운 매장(점유율 90% 이상)도 같이 — 축척 얘기할 때 헷갈리는 자리다
    const near = all.filter((x) => x.ip && x.share != null && x.share >= 0.9);
    if (near.length) {
      console.log(`\n  [참고] competitorIp는 있지만 **점유율 90% 이상**인 매장 ${near.length}곳`);
      console.log(`  매장            실측     예측    점유율   500m조사  2km경쟁무게`);
      for (const x of near.sort((a, b2) => (b2.share ?? 0) - (a.share ?? 0))) {
        console.log(`  ${x.name.padEnd(14)}${x.act == null ? "    —" : `${(x.act * 100).toFixed(1).padStart(6)}%`}`
          + `${x.pred == null ? "    —" : `${(x.pred * 100).toFixed(1).padStart(8)}%`}`
          + `${(x.share! * 100).toFixed(1).padStart(8)}%${String(x.n500).padStart(8)}곳${x.w2km.toFixed(0).padStart(11)}`);
      }
    }
    expect(all.length).toBeGreaterThan(30);
  });

  it("(AC) ⭐⭐⭐ 자연실험이 몇 건이나 있나 — 경쟁점 개·폐업 전후", () => {
    // (Z)에서 나온 진단: **40곳으로는 판정이 안 된다.** 매장을 옆으로 비교하는 한
    // 바닥과의 1.02%p 격차를 가르려면 154곳이 필요하다.
    //
    // ── 그런데 옆으로만 볼 이유가 없다 ─────────────────────────────────────
    // 우리에겐 매장마다 **월별 가동률**이 있다(850건). 그리고 2km 경쟁점에는
    // **인허가 개업일·폐업일**이 붙어 있다(`rival2km.json`).
    //
    // 그러면 **자연실험**이 된다: 경쟁점이 문을 열면(닫으면) 우리 가동률이 얼마나
    // 움직이나. 이건 매장 고유 요인(입지·수요·운영)이 **전후로 그대로**라서 저절로
    // 통제된다 — 옆으로 비교할 때 우리를 괴롭히던 교란이 통째로 빠진다.
    //
    // 그리고 이건 **경쟁 항을 직접 겨냥한다** — 오늘 (L)에서 산식이 무너진다고 좁혀 놓은 자리다.
    // 전례도 있다: 탕정역점이 2026-03부터 급락했는데 competitorIp가 0이었다.
    //
    // ⚠️ 여기서는 **실현 가능한지(사건이 몇 건이나 되는지)만** 센다. 분석은 다음이다.
    const sales = (snap.sales ?? []) as Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>;
    const byCode = new Map<string, { ym: string; v: number }[]>();
    for (const s of sales) {
      const v = s.utilizationRate;
      if (v == null || !(v > 0)) continue;
      byCode.set(s.storeCode, [...(byCode.get(s.storeCode) ?? []), { ym: s.yearMonth, v }]);
    }
    const ymAdd = (ym: string, k: number) => {
      const [y, m] = ym.split("-").map(Number);
      const t = y * 12 + (m - 1) + k;
      return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
    };
    const WIN = 3; // 전후 몇 달을 볼 것인가
    let opens = 0, closes = 0, usableOpen = 0, usableClose = 0;
    const openDeltas: { store: string; rival: string; ym: string; before: number; after: number }[] = [];
    const closeDeltas: typeof openDeltas = [];
    for (const r of base) {
      const code = r.input.storeCode;
      const ms = (byCode.get(code) ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym));
      if (ms.length < 2 * WIN) continue;
      const have = new Map(ms.map((m) => [m.ym, m.v]));
      const span = { from: ms[0].ym, to: ms[ms.length - 1].ym };
      for (const rec of rival2kmRecords(existingSiteKey(code))) {
        const ev = (d: string | null, kind: "open" | "close") => {
          if (!d || !/^\d{4}-\d{2}/.test(d)) return;
          const ym = d.slice(0, 7);
          if (ym < span.from || ym > span.to) return;
          if (kind === "open") opens += 1; else closes += 1;
          const before: number[] = [], after: number[] = [];
          for (let k = 1; k <= WIN; k++) {
            const b = have.get(ymAdd(ym, -k)); if (b != null) before.push(b);
            const a = have.get(ymAdd(ym, k)); if (a != null) after.push(a);
          }
          if (before.length < WIN || after.length < WIN) return;
          const row = { store: r.input.storeName ?? code, rival: rec.name ?? "(이름없음)", ym, before: mean(before), after: mean(after) };
          if (kind === "open") { usableOpen += 1; openDeltas.push(row); }
          else { usableClose += 1; closeDeltas.push(row); }
        };
        ev(rec.open, "open");
        ev(rec.close, "close");
      }
    }
    console.log(`\n[자연실험 재고] 매장 월별 가동률 ${sales.length}건 · 전후 ${WIN}달씩 필요`);
    console.log(`  경쟁점 **개업** 사건 ${opens}건 중 전후 자료가 다 있는 건 **${usableOpen}건**`);
    console.log(`  경쟁점 **폐업** 사건 ${closes}건 중 전후 자료가 다 있는 건 **${usableClose}건**`);
    const show = (label: string, xs: typeof openDeltas, expect2: string) => {
      if (!xs.length) { console.log(`\n  ${label}: 사건 없음`); return; }
      const d = xs.map((x) => (x.after - x.before) * 100);
      console.log(`\n  ${label} ${xs.length}건 — 가동률 변화(뒤 − 앞) · 기대 방향: ${expect2}`);
      console.log(`    평균 ${mean(d).toFixed(2)}%p · 중앙 ${[...d].sort((a, b) => a - b)[Math.floor(d.length / 2)].toFixed(2)}%p`
        + ` · SD ${sdOf(d).toFixed(2)}%p · 내린 건 ${d.filter((v) => v < 0).length}/${d.length}건`);
      const se = sdOf(d) / Math.sqrt(d.length);
      console.log(`    표준오차 ${se.toFixed(2)}%p -> **2SE = ${(2 * se).toFixed(2)}%p** (이보다 큰 효과만 보인다)`);
      for (const x of xs.slice(0, 6)) {
        console.log(`      ${x.store.padEnd(14)}${x.ym}  ${x.rival.slice(0, 18).padEnd(20)}`
          + `${(x.before * 100).toFixed(1).padStart(6)}% -> ${(x.after * 100).toFixed(1)}%`
          + ` (${((x.after - x.before) * 100).toFixed(1)}%p)`);
      }
      if (xs.length > 6) console.log(`      ... 외 ${xs.length - 6}건`);
    };
    show("개업", openDeltas, "우리 가동률이 **내려간다**");
    show("폐업", closeDeltas, "우리 가동률이 **올라간다**");
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 사건이 30건을 넘으면 **매장 40곳보다 판정력이 좋을 수 있다** —`);
    console.log(`       매장 고유 요인(입지·수요·운영)이 전후로 같아서 저절로 통제되기 때문이다`);
    console.log(`     · 그리고 이건 **경쟁 항을 직접 겨냥한다** — 오늘 좁혀 놓은 그 자리다`);
    console.log(`  ⚠️ 여기서는 **셈만** 한다. 계절성·추세를 안 뺐으니 이 숫자로 판정하지 마라.`);
    expect(base.length).toBeGreaterThan(30);
  });

  it("(C) 낮게 본 무리 vs 높게 본 무리 — 층별 평균을 갈라 본다", () => {
    const sorted = [...rows].sort((a, b) => a.pred - b.pred);
    const lo = sorted.slice(0, 8), hi = sorted.slice(-8);
    const show = (label: string, g: Row[]) => {
      console.log(`  ${label.padEnd(14)}`
        + `${(mean(g.map((r) => r.pred)) * 100).toFixed(1).padStart(7)}%`
        + `${(mean(g.map((r) => r.act)) * 100).toFixed(1).padStart(8)}%`
        + `${mean(g.map((r) => r.demandPerSeat)).toFixed(2).padStart(10)}`
        + `${(mean(g.map((r) => r.share)) * 100).toFixed(1).padStart(9)}%`
        + `${mean(g.map((r) => r.loc)).toFixed(2).padStart(8)}`
        + `${mean(g.map((r) => r.pc)).toFixed(0).padStart(7)}`
        + `${mean(g.map((r) => r.rivalW)).toFixed(0).padStart(9)}`
        + `${mean(g.map((r) => r.rivalN)).toFixed(1).padStart(6)}`);
    };
    console.log(`\n[무리 비교] 예측 낮은 8곳 vs 높은 8곳 — 평균`);
    console.log(`  무리             예측     실측   수요/좌석   점유율    입지     PC  경쟁무게    수`);
    show("낮게 본 8곳", lo);
    show("높게 본 8곳", hi);
    show("전체", rows);
    console.log(`\n  ⭐ 실측 평균이 두 무리에서 **비슷한데** 예측만 갈리면, 가른 그 층이 헛것이다.`);
    // 실측 기준으로도 갈라 본다 — 실제로 잘 되는 곳과 안 되는 곳은 무엇이 다른가.
    const byAct = [...rows].sort((a, b) => a.act - b.act);
    console.log(`\n[대조] **실측** 낮은 8곳 vs 높은 8곳 — 진짜 차이는 어디서 오나`);
    console.log(`  무리             예측     실측   수요/좌석   점유율    입지     PC  경쟁무게    수`);
    show("실측 낮은 8곳", byAct.slice(0, 8));
    show("실측 높은 8곳", byAct.slice(-8));
    expect(rows.length).toBeGreaterThan(30);
  });
});
