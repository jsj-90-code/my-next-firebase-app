// θ(경쟁점 품질 제곱수)를 **내려서** 재본다 (2026-09-21)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 사용자가 후보지 표를 보고 짚었다 — *"호구포역점 점유율 왜 100%임? 경쟁점 있는데"*,
// *"영월점도"*. 파보니 산식이 경쟁점을 이렇게 센다:
//
//     경쟁점 무게 = 경쟁점 PC대수 x (경쟁점 품질 ÷ 우리 품질)^θ,   θ = 3
//
// 우리는 신규라 품질이 높고 경쟁점은 낮아서 **품질비가 거의 항상 1보다 작다**
// (이 저장소가 이미 아는 사실). 1보다 작은 수를 3제곱하면 폭발적으로 작아져서,
// 호구포역은 **123대짜리 경쟁점이 18대처럼** 취급되고 점유율이 100%로 잘린다.
// 사용자: *"경쟁점수 환산하는 부분을 조정한다는 거지?"* — 그렇다.
//
// ⚠️ **θ는 올려보기만 했다.** 기록에 3 → 4·5·6·8이 전부 기각됐다고만 있고
//    **3보다 아래는 한 번도 안 쟀다.** 게다가 그때 판정 기준은 **매출**이었다.
//    지금은 가동률이 기준이다(2026-09-21 사용자 결정).
//
// ── 판정 기준 (먼저 박는다) ───────────────────────────────────────────────
//   주지표  가동률 LOO MAE(%p)
//   보조    오차 SD · 최악(%p와 상대% **둘 다** — 단위를 섞지 않는다)
//   구조    **점유율 100%로 잘리는 매장 수** (θ가 클수록 는다)
//   안정성  38겹 재적합에서 흔들리나
//
// ⚠️ 혼선 하나를 미리 밝힌다 — 눈금 보정 계수(b=0.327·c=0.169)는 **θ=3에서 잰 값**이다.
//    θ를 바꾸면 그 값도 달라져야 맞다. 그래서 두 가지를 다 찍는다:
//      (가) b·c를 지금 값으로 **고정**하고 θ만 바꾼 성적  ← 산식에 바로 넣었을 때
//      (나) θ마다 b·c를 **다시 잰** 값                    ← 공정한 비교
//
// ⚠️ 측정만 한다. 계수는 사용자가 고른다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_qualityExponentDown.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, rivalDistanceWeight,
  fittedParams, scoreTextbook, type TextbookParams,
} from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const varOf = (a: number[]) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };
const sdOf = (a: number[]) => Math.sqrt(varOf(a));
const cov = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  return mean(a.map((_, i) => (a[i] - ma) * (b[i] - mb)));
};
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const THETAS = [0, 0.5, 1, 1.5, 2, 2.5, 3];

describeIf("경쟁점 품질 제곱수 θ를 내려본다", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const locByCode = new Map(locationEvaluations.map((l) => [l.candidateCode, l]));
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P0 = DEFAULT_TEXTBOOK_PARAMS;
  const franchiseManagement = franchiseManagementFromRows(base, qscByStoreCode);
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement });
  const withTheta = (t: number): TextbookParams => ({ ...P0, qualityExponent: t });

  /** LOO — θ마다 축척을 훈련겹에서 다시 맞춘다. */
  const loo = (p: TextbookParams) => {
    const out: { n: string; pred: number; act: number }[] = [];
    for (let i = 0; i < base.length; i++) {
      const rest = base.filter((_, k) => k !== i);
      const f = fittedParams(p, scoreTextbook(rest, p));
      const b = computeTextbook(base[i].input, f);
      const a = base[i].input.actualUtilization;
      if (b.utilization != null && a != null && a > 0) out.push({ n: base[i].input.storeName ?? "", pred: b.utilization, act: a });
    }
    return out;
  };
  type Out = ReturnType<typeof loo>;
  const mae = (v: Out) => mean(v.map((x) => Math.abs(x.pred - x.act)));
  const sdE = (v: Out) => sdOf(v.map((x) => Math.abs(x.pred - x.act)));
  const wstPp = (v: Out) => Math.max(...v.map((x) => Math.abs(x.pred - x.act)));
  const wstRel = (v: Out) => Math.max(...v.map((x) => Math.abs(x.pred - x.act) / x.act));
  const w5 = (v: Out) => v.filter((x) => Math.abs(x.pred - x.act) <= 0.05).length;

  /** 경쟁 무게와 날점유율 — 산식과 같은 식으로 뽑는다. */
  const rivalWeightOf = (input: LabRow["input"], t: number) => {
    const oq = input.ownQualityParts ? computeQualityScore(input.ownQualityParts, P0.qualityWeights) : null;
    let w = 0;
    for (const v of input.rivals ?? []) {
      if (!(v.ip > 0)) continue;
      const q = v.parts ? computeQualityScore(v.parts, P0.qualityWeights) : null;
      const ratio = oq != null && oq > 0 && q != null && q > 0 ? q / oq : 1;
      w += v.ip * Math.pow(ratio, t) * rivalDistanceWeight(v.distanceM, P0);
    }
    return w;
  };
  /** 점유율이 1로 잘리는가 — 경쟁점에서 **직접** 만들어야 한다(되나누면 순환이라 영영 안 걸린다). */
  const cappedCount = (rows: { input: LabRow["input"] }[], t: number, p: TextbookParams) => {
    const cal = p.indexCalibration;
    const locExp = cal && cal.ratioExponent !== 0 ? cal.locationExponent / cal.ratioExponent : 1;
    let n = 0;
    for (const r of rows) {
      const b = computeTextbook(r.input, p);
      const pc = r.input.pcCount;
      if (!pc || b.locationMultiplier == null) continue;
      const raw = pc / (pc + rivalWeightOf(r.input, t) + p.outsideOptionIp);
      if (raw * Math.pow(b.locationMultiplier, locExp) > 1 - 1e-12) n++;
    }
    return n;
  };

  it("(1) ⭐ θ 훑기 — 가동률 성적과 '100%로 잘리는 매장 수'", () => {
    console.log(`\n[θ 훑기] 경쟁점 무게 = PC대수 x (경쟁점품질÷우리품질)^θ x 거리무게`);
    console.log(`  ⚠️ 눈금 보정(b=${P0.indexCalibration?.ratioExponent} · c=${P0.indexCalibration?.locationExponent})은 θ=3에서 잰 값이라 고정해 둔 것이다((나)절에서 다시 잰다).`);
    console.log(`\n   θ      MAE      SD    최악(%p)  최악(상대)  ±5%p   점유율100% 잘림(기존점/후보지)`);
    for (const t of THETAS) {
      const p = withTheta(t);
      const v = loo(p);
      console.log(`  ${t.toFixed(1)}${pp(mae(v)).padStart(10)}${pp(sdE(v)).padStart(9)}${pp(wstPp(v), 1).padStart(10)}` +
        `${pct(wstRel(v)).padStart(11)}${(w5(v) + "/" + v.length).padStart(8)}` +
        `${(cappedCount(base, t, p) + "곳").padStart(12)} / ${cappedCount(candRows, t, p)}곳` +
        (t === P0.qualityExponent ? "   <- 지금" : ""));
    }
    console.log(`\n  ⚠️ θ가 클수록 경쟁점이 지워져 **점유율 100%로 잘리는 매장이 는다.**`);
    console.log(`     잘리면 그 매장은 "동네 수요를 전부 먹는다"가 되고 경쟁점 정보가 통째로 버려진다.`);
    expect(THETAS.length).toBe(7);
  });

  it("(2) 호구포역·영월 — θ에 따라 몇 대 몇으로 나뉘나", () => {
    for (const key of ["호구포", "영월"]) {
      const c = candidates.find((x) => (x.name ?? "").includes(key));
      const row = candRows.find((r) => r.input.storeCode === c?.code);
      if (!c || !row) { console.log(`\n[${key}] 없음`); continue; }
      const pc = row.input.pcCount ?? 0;
      const rivals = (row.input.rivals ?? []).filter((v) => v.ip > 0);
      console.log(`\n[${(c.name ?? "").trim()}] 자사 ${pc}대 · 경쟁점 ${rivals.map((v) => `${v.name} ${v.ip}대 ${Math.round(v.distanceM ?? 0)}m`).join(" · ")}`);
      const oq = row.input.ownQualityParts ? computeQualityScore(row.input.ownQualityParts, P0.qualityWeights) : null;
      for (const v of rivals) {
        const q = v.parts ? computeQualityScore(v.parts, P0.qualityWeights) : null;
        console.log(`  품질: 우리 ${oq?.toFixed(2) ?? "-"} · ${v.name} ${q?.toFixed(2) ?? "-"}` +
          `  → 품질비 ${oq && q ? (q / oq).toFixed(3) : "-"}`);
      }
      console.log(`\n   θ    경쟁 무게    우리:경쟁     날점유율   입지곱한뒤   최종 점유율   가동률`);
      for (const t of THETAS) {
        const p = withTheta(t);
        const f = fittedParams(p, scoreTextbook(base, p));
        const b = computeTextbook(row.input, f);
        const rw = rivalWeightOf(row.input, t);
        const raw = pc / (pc + rw + p.outsideOptionIp);
        const cal = p.indexCalibration;
        const locExp = cal && cal.ratioExponent !== 0 ? cal.locationExponent / cal.ratioExponent : 1;
        const withLoc = raw * Math.pow(b.locationMultiplier ?? 1, locExp);
        console.log(`  ${t.toFixed(1)}${rw.toFixed(0).padStart(10)}대` +
          `${(`${Math.round(pc / (pc + rw) * 100)}:${Math.round(rw / (pc + rw) * 100)}`).padStart(11)}` +
          `${pct(raw).padStart(11)}${pct(withLoc).padStart(13)}${pct(b.share ?? 0).padStart(13)}${pct(b.utilization ?? 0).padStart(9)}` +
          (withLoc > 1 ? "  🔴 잘림" : ""));
      }
    }
    expect(candidates.length).toBeGreaterThan(5);
  });

  it("(3) θ마다 눈금 보정을 다시 재면 — 공정한 비교", () => {
    console.log(`\n[θ마다 b·c 재적합] 눈금 보정은 θ에 딸린 값이라 같이 다시 재야 공정하다`);
    console.log(`   θ       b       c     (참고) 이 b·c로 LOO MAE`);
    for (const t of THETAS) {
      const p = withTheta(t);
      const f = fittedParams(p, scoreTextbook(base, p));
      // 지수 보정을 끈 상태의 날 가동률에서 b·c를 다시 잰다.
      const off: TextbookParams = { ...p, indexCalibration: null };
      const fOff = fittedParams(off, scoreTextbook(base, off));
      const X: number[] = [], L: number[] = [], A: number[] = [];
      for (const r of base) {
        const b = computeTextbook(r.input, fOff);
        const act = r.input.actualUtilization;
        if (act == null || !(act > 0) || b.utilization == null || !(b.utilization > 0) || b.capped) continue;
        if (b.locationMultiplier == null) continue;
        const pc = r.input.pcCount ?? 0;
        if (!pc) continue;
        const raw = pc / (pc + rivalWeightOf(r.input, t) + p.outsideOptionIp);
        if (raw * b.locationMultiplier > 1 - 1e-12) continue; // 상한 걸린 곳은 로그 덧셈이 깨진다
        X.push(Math.log(b.utilization) - Math.log(b.locationMultiplier));
        L.push(Math.log(b.locationMultiplier));
        A.push(Math.log(act));
      }
      if (X.length < 15) { console.log(`  ${t.toFixed(1)}   표본 ${X.length}곳 — 부족`); continue; }
      const sxx = varOf(X), sll = varOf(L), sxl = cov(X, L);
      const det = sxx * sll - sxl * sxl;
      const bb = (sll * cov(X, A) - sxl * cov(L, A)) / det;
      const cc = (sxx * cov(L, A) - sxl * cov(X, A)) / det;
      const refit: TextbookParams = {
        ...p,
        indexCalibration: { ratioExponent: bb, locationExponent: cc, referenceUtilization: P0.indexCalibration?.referenceUtilization ?? 0.3011 },
      };
      const v = loo(refit);
      console.log(`  ${t.toFixed(1)}${bb.toFixed(3).padStart(9)}${cc.toFixed(3).padStart(8)}` +
        `${pp(mae(v)).padStart(14)}  (최악 ${pp(wstPp(v), 1)} · ±5%p ${w5(v)}/${v.length} · n=${X.length})` +
        (t === P0.qualityExponent ? "   <- 지금" : ""));
      void f;
    }
    console.log(`\n  ⚠️ b·c까지 다시 잰 뒤에도 θ가 낮은 쪽이 나으면 — **θ=3은 틀린 값**이다.`);
    expect(THETAS.length).toBe(7);
  });

  it("(4) 고른 θ가 흔들리나 — 38겹에서 다시 고른다", () => {
    const picked: number[] = [];
    for (let i = 0; i < base.length; i++) {
      const rest = base.filter((_, k) => k !== i);
      let bestT = 0, best = Infinity;
      for (const t of THETAS) {
        const p = withTheta(t);
        const errs: number[] = [];
        for (let j = 0; j < rest.length; j++) {
          const rest2 = rest.filter((_, k) => k !== j);
          const f = fittedParams(p, scoreTextbook(rest2, p));
          const b = computeTextbook(rest[j].input, f);
          const a = rest[j].input.actualUtilization;
          if (b.utilization != null && a != null && a > 0) errs.push(Math.abs(b.utilization - a));
        }
        const m = mean(errs);
        if (m < best) { best = m; bestT = t; }
      }
      picked.push(bestT);
    }
    const tally = new Map<number, number>();
    for (const t of picked) tally.set(t, (tally.get(t) ?? 0) + 1);
    console.log(`\n[안정성] 매장 하나를 빼고 나머지에서 θ를 다시 고른다 (38번)`);
    for (const [t, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  θ=${t.toFixed(1)}  ${n}번`);
    console.log(`  중앙 θ = ${med(picked).toFixed(1)}`);
    console.log(`  ⚠️ 한 값이 거의 다 뽑히면 표본에 안 휘둘린다. 갈리면 못 미덥다.`);
    expect(picked.length).toBeGreaterThan(30);
  }, 300_000);
});
