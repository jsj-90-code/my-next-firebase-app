// 외부옵션("PC방 안 가는 몫")을 빼면 어떻게 되나 — 재고 표 (2026-09-22)
//
// ── 왜 뺐나 ───────────────────────────────────────────────────────────────
// 2026-09-21 밤에 20대를 채택했다. 근거는 "독점 3곳에서 수요식이 일제히 19% 과대이고,
// 점유율이 1인 곳이라 그 초과분이 곧 안 가는 몫"이었다. 사용자가 바로 물었다:
//   *"독점매장만 넣었구나. 그건 결과맞추기 아니냐? 근거가 너무 얼토당토없는 거 아니냐?"*
// 맞는 지적이다. **계수 하나를 점 3개에 맞춘 것**이다. 그리고 2km 목록을 열어 보니
// 그 3곳은 독점이 아니다 — 500m 안에 없을 뿐이고, 2km 안에 영업 중인 경쟁점이 있다
// (남악 6곳 · 탕정역 3곳 · 광주각화 27건 미판정). 필요한 몫도 매장마다 달라서
// 남악 10.4대 vs 광주각화 51.9대다. → 상수가 아니라 **반경 밖 경쟁점**이다.
//
// 2026-09-22 사용자 결정: **뺀다(20 → 0).**
//
// ── 이 하네스가 하는 일 ───────────────────────────────────────────────────
// 빼면서 치르는 값을 가리지 않고 적는다. 판정 기준은 **가동률**이다(매출 MAPE 아니다).
// MAE만 보지 않는다 — 최악·SD·편향을 같이 본다(사용자 규칙).
//
// ⚠️ **측정만 한다.** 여기서 좋게 나온 값을 채택하지 않는다. 0과 20은 사용자가 이미 정했고,
//    나머지 눈금은 "얼마나 민감한가"를 보려고 같이 찍을 뿐이다.
// ⚠️ 잠금장치에 계수를 글자로 박지 않는다 — 산식이 바뀌면 이 파일은 **새 값으로 다시 찍는다**.
//
// 실행:
//   npx vitest run src/lib/storeEval/_outsideOptionRemoval.test.ts --disable-console-intercept
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
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
  type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;

type Card = {
  n: number; mae: number; sd: number; worst: number; worstName: string;
  bias: number; within5: number; spread: number; capped: number; cappedNames: string[];
};

describeIf("외부옵션 제거 — 재고 표", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
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
  /**
   * 채점 대상 — 실측 가동률이 있는 매장 전부.
   * ⚠️ **`excluded`로 거르면 안 된다.** 송도·동탄북광장은 실험실 표본에 들어가 있는데도
   *    `LabRow.excluded`는 true 그대로다(운영에서 빠졌다는 사실이라 화면이 그 값을 쓴다 —
   *    `labInput.ts` LAB_ONLY_INCLUDED_STORE_CODES 주석). 여기서 걸렀다가 표본이 40 -> 38로
   *    줄어 성적이 다르게 나왔다(2026-09-22). 실험실 표본 판정은 `buildLabRows`가 이미 했다.
   */
  const rows = base.filter((r) => (r.input.actualUtilization ?? 0) > 0);

  const withOO = (oo: number): TextbookParams => ({ ...DEFAULT_TEXTBOOK_PARAMS, outsideOptionIp: oo });

  /** 축척은 파라미터마다 다시 맞춘다 — 지금은 고정값이라 안 움직이지만 경로를 같게 둔다. */
  const card = (oo: number): Card => {
    const P = fittedParams(withOO(oo), scoreTextbook(base, withOO(oo)));
    const errs: { name: string; e: number; pred: number; act: number; share: number | null }[] = [];
    for (const r of rows) {
      const b = computeTextbook(r.input, P);
      const act = r.input.actualUtilization as number;
      if (b.utilization == null || !(b.utilization > 0)) continue;
      errs.push({
        name: r.input.storeName ?? r.input.storeCode,
        e: b.utilization - act, pred: b.utilization, act, share: b.share,
      });
    }
    const abs = errs.map((x) => Math.abs(x.e));
    const worstIdx = abs.indexOf(Math.max(...abs));
    const capped = errs.filter((x) => x.share != null && x.share >= 0.9999);
    return {
      n: errs.length,
      mae: mean(abs),
      sd: sdOf(errs.map((x) => x.e)),
      worst: abs[worstIdx],
      worstName: errs[worstIdx].name,
      bias: mean(errs.map((x) => x.e)),
      within5: abs.filter((v) => v <= 0.05).length,
      spread: sdOf(errs.map((x) => x.pred)) / sdOf(errs.map((x) => x.act)),
      capped: capped.length,
      cappedNames: capped.map((x) => x.name),
    };
  };

  /** 반경 안에 유효 경쟁점이 없는 매장 — 어제 "독점 3곳"이라고 부르던 자리다. */
  const noRivalInRadius = (r: LabRow, P: TextbookParams) => {
    let w = 0;
    for (const v of r.input.rivals ?? []) {
      if (!(v.ip > 0)) continue;
      w += v.ip * rivalDistanceWeight(v.distanceM, P);
    }
    return w <= 0;
  };

  it("(1) 성적표 — 0(지금) vs 20(어제)", () => {
    const P0 = DEFAULT_TEXTBOOK_PARAMS;
    expect(P0.outsideOptionIp, "2026-09-22 결정: 외부옵션은 0이다").toBe(0);
    console.log(`\n[성적표] 판정 기준 = **가동률**(2026-09-21 사용자 결정) · 표본 ${rows.length}곳`);
    console.log(`  외부옵션      MAE       SD      최악            편향      ±5%p   퍼짐(예측÷실측)  점유율100%`);
    for (const oo of [0, 10, 20, 30, 50]) {
      const c = card(oo);
      const tag = oo === 0 ? " ← 지금" : oo === 20 ? " ← 어제" : "";
      console.log(
        `  ${String(oo).padStart(4)}대   ${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}` +
        ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}` +
        `  ${String(c.within5).padStart(2)}/${c.n}   ${c.spread.toFixed(2)}배` +
        `        ${String(c.capped).padStart(2)}곳${tag}`,
      );
    }
    console.log(`\n  ⚠️ MAE만 보지 않는다 — 최악·SD를 같이 본다. 단위는 전부 %p다.`);
    const c0 = card(0), c20 = card(20);
    console.log(`  치른 값: MAE ${pp(c20.mae)} -> ${pp(c0.mae)} · 최악 ${pp(c20.worst)} -> ${pp(c0.worst)}` +
      ` · ±5%p ${c20.within5} -> ${c0.within5}곳 · 편향 ${pp(c20.bias)} -> ${pp(c0.bias)}`);
    console.log(`  퍼짐 과장: ${c20.spread.toFixed(2)}배 -> ${c0.spread.toFixed(2)}배 (실측 퍼짐 대비 예측 퍼짐)`);
  });

  it("(2) 점유율이 100%로 잘리는 매장 — 빼면 다시 생긴다던 자리", () => {
    const c0 = card(0), c20 = card(20);
    console.log(`\n[점유율 100% 잘림] 외부옵션 20대 -> ${c20.capped}곳 · 0대(지금) -> ${c0.capped}곳`);
    for (const n of c0.cappedNames) console.log(`  · ${n}`);
    console.log(`  ⚠️ 잘린다는 건 "이 매장은 동네 수요를 통째로 먹는다"고 산식이 말하는 것이다.`);
    console.log(`     반경 밖 경쟁점을 아직 안 세고 있다는 표시다 — 2km 판정 뒤에 다시 잰다.`);
  });

  it("(2-나) 후보지 쪽 잘림 — 인계문이 '기존점 5곳'이라 적은 자리", () => {
    // ⚠️ 인계문(2026-09-22) 6절이 "입지배율이 점유율을 100%로 자르던 **기존점** 5곳
    //    (호구포역·영월)"이라고 적었는데, 호구포역점·영월점은 **기존점이 아니라 후보지**다.
    //    그래서 기존점만 세면 그 예고가 재현되지 않는다. 후보지도 같이 센다.
    const locByCode = new Map((snap.locationEvaluations ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => [l.candidateCode ?? l.code ?? l.id, l],
    ));
    const franchiseManagement = franchiseManagementFromRows(base);
    const candRows = buildLabCandidateRows({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      candidates: (snap.candidates ?? []) as any, compsByCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      locByCode: locByCode as any, settings, franchiseManagement,
    });
    console.log(`\n[후보지 점유율 100% 잘림] 후보지 ${candRows.length}곳`);
    for (const oo of [20, 0]) {
      const P = fittedParams(withOO(oo), scoreTextbook(base, withOO(oo)));
      const hit: string[] = [];
      for (const c of candRows) {
        const b = computeTextbook(c.input, P);
        if (b.share != null && b.share >= 0.9999) hit.push(c.input.storeName ?? c.input.storeCode);
      }
      console.log(`  외부옵션 ${String(oo).padStart(2)}대 -> ${hit.length}곳${hit.length ? "  " + hit.join(" · ") : ""}`);
    }
  });

  it("(3) 반경 안 경쟁점이 없는 매장은 지금 얼마나 어긋나나", () => {
    const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
    console.log(`\n[반경 안 경쟁 0곳] 어제 "독점 3곳"이라 부르던 자리 · 외부옵션 ${P.outsideOptionIp}대`);
    console.log(`  매장                예측      실측     어긋남(예측÷실측)`);
    const ratios: number[] = [];
    for (const r of rows) {
      if (!noRivalInRadius(r, P)) continue;
      const b = computeTextbook(r.input, P);
      const act = r.input.actualUtilization as number;
      if (b.utilization == null || !(b.utilization > 0)) continue;
      ratios.push(b.utilization / act);
      console.log(`  ${(r.input.storeName ?? r.input.storeCode).padEnd(16)}` +
        `${(b.utilization * 100).toFixed(1).padStart(7)}%${(act * 100).toFixed(1).padStart(9)}%` +
        `${(b.utilization / act).toFixed(3).padStart(12)}배`);
    }
    if (ratios.length) {
      const geo = Math.exp(mean(ratios.map(Math.log)));
      console.log(`  기하평균 ${geo.toFixed(3)}배`);
      console.log(`  ⚠️ 이 과대분을 상수로 메우지 않는다. 정체는 **아직 안 세고 있는 반경 밖 경쟁점**이다`);
      console.log(`     (거칠게 재면 남악 10.4대 · 광주각화 51.9대 — 매장마다 다르다).`);
    }
  });
});
