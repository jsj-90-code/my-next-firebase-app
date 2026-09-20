// 잔차화 중심도를 본체로 옮겨도 되나 — 옮기기 전 확인 (2026-09-20)
//
// ── 무엇을 확인하나 ────────────────────────────────────────────────────────
// 인계 문서(`handoff-20260921-lab-underprediction.md` 3절)는 잔차화 중심도 ν=0.5를
// **"관문 통과 완료 · 새로 고를 계수가 없어서 제일 안전한 건"**으로 적어 뒀다.
// 옮기기 전에 그 두 마디를 각각 재본다.
//
//   (1) "새로 고를 계수가 없다" — 정말 없나?
//       잔차화는 log(중심도)를 log(유동400m)에 회귀시킨 **잔차**를 쓴다. 본체는 후보지
//       한 곳씩 계산하므로 회귀를 그 자리에서 못 한다. 그러면 기울기를 **상수로 굳혀야**
//       한다. 굳혀야 하는 값이 셋이다:
//           fixed = 기준 x (중심도/G_c) x (G_f/유동400m)^기울기
//         · 기울기   log-log OLS 기울기 (표본에서 적합)
//         · G_c      중심도의 기하평균   (표본에서 적합)
//         · G_f      유동400m의 기하평균 (표본에서 적합)
//       그리고 ν 자체도 0.25 -> 0.5로 **바뀐다**. "고를 게 없다"가 아니다.
//       ⚠️ 다만 기울기·기하평균은 MAPE로 고른 값이 아니라 **정규화**다(자유계수와 다르다).
//          locationReferences 주석의 논리가 그대로 적용되는지는 아래 숫자로 판단한다.
//
//   (2) "관문 통과" — LOO가 정직한가?
//       `_textbookFull.test.ts`의 LOO는 **잔차화를 38곳 전부로 한 번 해두고** 그 위에서
//       ν만 겹으로 갈랐다. 기울기가 홀드아웃 매장을 이미 본 것이다(누수). 여기서는
//       **겹마다 기울기를 다시 적합**해서 벌어짐이 유지되는지 본다.
//       축척도 훈련겹에서만 맞춘다(`fittedParams`) — 그쪽도 같이 새던 구멍이다.
//
// ⚠️ **측정만 한다. 본체는 안 고친다.** 옮길지는 이 숫자를 보고 사용자가 정한다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_residualCentralityPort.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS,
  computeTextbook,
  fittedParams,
  scoreTextbook,
  type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("잔차화 중심도 — 본체로 옮기기 전 확인", () => {
  // 조립은 화면과 **같은 함수**(buildLabRows)를 쓴다 — _textbookFull.test.ts와 같다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  const fromSnapshot = (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[];
  for (const doc of fromSnapshot) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [key, site] of Object.entries(sites)) {
      qscSites.set(key.startsWith("existing:") ? key.slice("existing:".length) : key, site);
    }
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const withNu = (nu: number): TextbookParams =>
    ({ ...P, locationExponents: { ...P.locationExponents, centrality: nu } });

  /**
   * 잔차화에 필요한 상수 셋을 **주어진 행에서만** 적합한다.
   * 겹마다 다시 부르면 누수가 없고, 전체로 한 번 부르면 지금 하네스와 같은 값이 나온다.
   */
  function fitResidual(fit: LabRow[]) {
    const xs: number[] = [], ys: number[] = [];
    for (const r of fit) {
      const c = r.input.location?.centrality ?? null;
      const f = r.input.floatingByRadius[400] ?? null;
      if (c != null && c > 0 && f != null && f > 0) { xs.push(Math.log(f)); ys.push(Math.log(c)); }
    }
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    return { slope: sxx > 0 ? sxy / sxx : 0, logGc: my, logGf: mx, n };
  }

  /** 적합된 상수로 **아무 행에나** 잔차화를 적용한다 — 본체가 후보지에 할 일과 같은 모양이다. */
  function applyResidual(rs: LabRow[], k: NonNullable<ReturnType<typeof fitResidual>>): LabRow[] {
    const ref = Math.log(P.locationReferences.centrality);
    return rs.map((r) => {
      const c = r.input.location?.centrality ?? null;
      const f = r.input.floatingByRadius[400] ?? null;
      if (!r.input.location || c == null || !(c > 0) || f == null || !(f > 0)) return r;
      const resid = Math.log(c) - (k.logGc + k.slope * (Math.log(f) - k.logGf));
      return {
        actualRevenue: r.actualRevenue,
        input: { ...r.input, location: { ...r.input.location, centrality: Math.exp(resid + ref) } },
      };
    });
  }

  const NU_GRID = [0, 0.1, 0.25, 0.5, 0.75, 1];

  it("(1) 본체로 옮기려면 굳혀야 하는 상수가 무엇인가", () => {
    const k = fitResidual(rows);
    expect(k).not.toBeNull();
    if (!k) return;
    console.log(`\n[굳혀야 하는 상수] 표본 ${k.n}곳에서 적합`);
    console.log(`  기울기(log-log)      ${k.slope.toFixed(4)}`);
    console.log(`  G_c 중심도 기하평균    ${Math.exp(k.logGc).toFixed(4)}`);
    console.log(`  G_f 유동400m 기하평균  ${Math.exp(k.logGf).toFixed(1)}`);
    console.log(`  기준값 locationReferences.centrality  ${P.locationReferences.centrality}`);
    console.log(`  => 잔차화 중심도 = 기준 x (중심도/G_c) x (G_f/유동400m)^기울기`);
    console.log(`\n  ⚠️ G_c(${Math.exp(k.logGc).toFixed(2)})와 기준값(${P.locationReferences.centrality})이 다르면` +
      ` 잔차화가 **수준까지 같이 옮긴다**.`);
    console.log(`     그 차이는 ${(Math.exp(k.logGc) / P.locationReferences.centrality).toFixed(3)}배다` +
      ` — 1에서 멀면 ν를 바꾼 효과에 수준 이동이 섞여 있다는 뜻이다.`);
  });

  it("(2) 겹마다 기울기를 다시 적합하면 LOO가 유지되나", () => {
    const full = fitResidual(rows);
    if (!full) return;

    /** 훈련겹에서 (잔차화 상수 + 축척)을 전부 맞춘 뒤 홀드아웃 한 곳을 예측한다. */
    const holdout = (i: number, nu: number, refitSlope: boolean): number | null => {
      const trainRaw = rows.filter((_, k2) => k2 !== i);
      const k = refitSlope ? fitResidual(trainRaw) : full;
      if (!k) return null;
      const train = applyResidual(trainRaw, k);
      const sc = scoreTextbook(train, withNu(nu));
      const one = applyResidual([rows[i]], k)[0];
      const b = computeTextbook(one.input, fittedParams(withNu(nu), sc));
      const a = rows[i].actualRevenue;
      return b.monthlyRevenue != null && a > 0 ? Math.abs(b.monthlyRevenue - a) / a : null;
    };

    const looAt = (nu: number, refitSlope: boolean) => {
      const errs: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const e = holdout(i, nu, refitSlope);
        if (e != null) errs.push(e);
      }
      return errs.reduce((a, b) => a + b, 0) / errs.length;
    };

    const residualRows = applyResidual(rows, full);
    console.log(`\n[ν 곡선] 표본 안 vs 홀드아웃 (홀드아웃은 축척까지 훈련겹에서만)`);
    console.log("     ν    표본 안   홀드아웃(기울기 고정)  홀드아웃(겹마다 재적합)");
    for (const nu of NU_GRID) {
      const inS = scoreTextbook(residualRows, withNu(nu)).mape ?? NaN;
      const fixedSlope = looAt(nu, false);
      const refit = looAt(nu, true);
      console.log(`  ${nu.toFixed(2)}   ${(inS * 100).toFixed(2).padStart(6)}%   ` +
        `${(fixedSlope * 100).toFixed(2).padStart(12)}%   ${(refit * 100).toFixed(2).padStart(16)}%`);
    }

    // 견줄 기준 — 지금 본체(손 안 댄 중심도 ν=0.25)를 같은 잣대로 잰다.
    const baseHoldout = (() => {
      const errs: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const train = rows.filter((_, k2) => k2 !== i);
        const sc = scoreTextbook(train, withNu(0.25));
        const b = computeTextbook(rows[i].input, fittedParams(withNu(0.25), sc));
        const a = rows[i].actualRevenue;
        if (b.monthlyRevenue != null && a > 0) errs.push(Math.abs(b.monthlyRevenue - a) / a);
      }
      return errs.reduce((a, b) => a + b, 0) / errs.length;
    })();
    const baseIn = scoreTextbook(rows, withNu(0.25)).mape ?? NaN;
    console.log(`\n  (견줄 기준) 지금 본체 — 손 안 댄 중심도 ν=0.25`);
    console.log(`     표본 안 ${(baseIn * 100).toFixed(2)}%  ·  홀드아웃 ${(baseHoldout * 100).toFixed(2)}%`);
    console.log("\n  ⚠️ 볼 것은 **홀드아웃 두 열의 차이**다. 겹마다 재적합했을 때 크게 나빠지면");
    console.log("     지금 기록된 '벌어짐 −0.05%p'는 기울기가 홀드아웃을 봐서 나온 값이다.");
    expect(rows.length).toBeGreaterThan(30);
  });
});
