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
import { existingSiteKey, rival2kmForWindow } from "./rival2km";
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
