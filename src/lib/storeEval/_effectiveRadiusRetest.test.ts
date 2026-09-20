// 유효거리 R — **자료가 R을 고를 수 있나** (2026-09-21)
//
// ── 왜 다시 재나 ───────────────────────────────────────────────────────────
// 사용자: *"오송점 경쟁매장 300미터 조금 넘어서 포함 안 되는데, 얘 포함해서
// 실험실 산식 적용하는 걸로 해야 할 듯?"*
//
// 오송점의 유일한 경쟁점 팀플PC가 **342m**다. R=300 계단 밖이라 통째로 안 세지고
// 점유율이 100%(완전 독점)가 된다. 342m면 걸어서 5분이라 상식에 어긋난다.
//
// ⚠️ **오송점은 이 판정에 안 들어간다.** 후보지라 실측 매출이 없다. R은 기존점 38곳으로만
//    고른다 — 안 그러면 "오송점 하나 맞추려고 자를 옮겼다"가 된다.
//
// ── 묻는 것을 바로 적는다 ──────────────────────────────────────────────────
// 흔한 함정은 "R=400이 MAPE를 올리나?"를 묻는 것이다. 그건 질문이 아니다. 어제 이미
// 표본 안 숫자로 19.0% vs 20.4%가 나와 있는데, 표본 안 숫자는 판정 근거가 못 된다.
//
// 진짜 질문은 이거다:  **R=300과 R=400의 차이가 잡음보다 큰가?**
//   크다   -> 자료가 300을 골랐다. 342m 경쟁점은 빼는 게 맞다.
//   작다   -> 자료는 아무 말도 안 했다. 그러면 실무 판단(걸어서 5분이면 경쟁이다)이 이긴다.
//
// ── 관문 (먼저 박는다. 결과를 보고 고치지 않는다) ──────────────────────────
//
//   관문 0  **검정력이 있나** — 300~400m 구간에 경쟁점을 가진 기존점이 몇 곳인가.
//           5곳 미만이면 이 검정은 아무것도 못 가른다. 그러면 그 자리에서 멈춘다.
//   관문 1  **짝지은 부트스트랩** — LOO 절대오차의 매장별 차(|e300|−|e400|)를 매장 단위로
//           재표집한다. 95% 구간이 0을 품으면 **자료가 R을 못 골랐다.**
//   관문 2  **부호검정** — 38곳 중 R=300이 더 정확한 매장 수. 움직이는 매장만 따로 본다
//           (안 움직이는 매장은 차가 정확히 0이라 넣으면 검정이 희석된다).
//   관문 3  **가짜 반경 대조군** — R=400이 나쁘다면 그게 '거리를 잘못 봐서'인가
//           '그냥 경쟁을 더 세서'인가. 300m 안 경쟁점의 무게만 R=400과 **같은 양**으로
//           부풀린 판을 만든다(거리 정보 0). 가짜도 똑같이 나빠지면 R=400의 손해는
//           거리와 무관하고, 자료는 R에 대해 아무 말도 안 한 것이다.
//
// ⚠️ **측정만 한다.** 본체 기본값 `effectiveRadiusM: 300`은 이 파일이 안 건드린다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_effectiveRadiusRetest.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  computeQualityScore, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("유효거리 R 재검정", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
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

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;
  const withR = (R: number): TextbookParams => ({ ...P, effectiveRadiusM: R });

  /** 유효거리 R에서의 경쟁무게 — textbookModel의 품질 모드와 같은 식이다. */
  const rivalWeight = (r: LabRow, R: number) => {
    const i = r.input;
    const oq = i.ownQualityParts ? computeQualityScore(i.ownQualityParts, P.qualityWeights) : null;
    let w = 0;
    for (const v of i.rivals ?? []) {
      if (!(v.ip > 0)) continue;
      if (v.distanceM != null && v.distanceM > R) continue;
      const q = v.parts ? computeQualityScore(v.parts, P.qualityWeights) : null;
      const ratio = oq == null || !(oq > 0) || q == null || !(q > 0) ? 1 : q / oq;
      w += v.ip * Math.pow(ratio, P.qualityExponent);
    }
    return w;
  };

  /** LOO — 축척(상품몫)까지 훈련겹에서만 맞춘다. 매장별 절대오차를 그대로 돌려준다. */
  const looErrors = (p: TextbookParams, src: LabRow[] = rows) => {
    const out = new Map<string, number>();
    for (let i = 0; i < src.length; i++) {
      const train = src.filter((_, k) => k !== i);
      const full = fittedParams(p, scoreTextbook(train, p));
      const b = computeTextbook(src[i].input, full);
      const a = src[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) out.set(nameOf(src[i]), Math.abs(b.monthlyRevenue - a) / a);
    }
    return out;
  };
  const mape = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0) / m.size;

  /** 300~400m 구간에 경쟁점이 있는 매장 = R을 바꾸면 실제로 움직이는 매장. */
  const movers = rows.filter((r) => (r.input.rivals ?? [])
    .some((v) => v.ip > 0 && v.distanceM != null && v.distanceM > 300 && v.distanceM <= 400));

  it("(0) 검정력이 있나 — 300~400m 구간에 경쟁점을 가진 매장", () => {
    console.log(`\n[관문 0] R을 300 -> 400으로 옮기면 실제로 움직이는 매장`);
    console.log("  매장              300m안무게  400m안무게   늘어남   구간 경쟁점(거리·PC)");
    for (const r of movers) {
      const band = (r.input.rivals ?? [])
        .filter((v) => v.ip > 0 && v.distanceM != null && v.distanceM > 300 && v.distanceM <= 400)
        .map((v) => `${v.name ?? "-"} ${Math.round(v.distanceM as number)}m·${v.ip}대`);
      const w3 = rivalWeight(r, 300), w4 = rivalWeight(r, 400);
      console.log(`  ${nameOf(r).padEnd(16)}${w3.toFixed(0).padStart(9)}${w4.toFixed(0).padStart(11)}` +
        `  ${w3 > 0 ? ((w4 / w3 - 1) * 100).toFixed(0).padStart(6) + "%" : "   신규"}  ${band.join(" / ")}`);
    }
    console.log(`\n  움직이는 매장 ${movers.length}곳 / 전체 ${rows.length}곳`);
    console.log(`  ⚠️ 관문 0 — 5곳 미만이면 이 검정은 아무것도 못 가른다.`);
    console.log(`     나머지 ${rows.length - movers.length}곳은 차가 **정확히 0**이라 전체 평균을 희석시킨다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(1)(2) 짝지은 부트스트랩과 부호검정 — 자료가 R을 골랐나", () => {
    const RS = [300, 343, 400, 500];
    const errs = new Map<number, Map<string, number>>();
    for (const R of RS) errs.set(R, looErrors(withR(R)));

    console.log(`\n[LOO 홀드아웃] 축척까지 훈련겹에서만 · n=${rows.length}`);
    console.log("     R(m)     MAPE     중앙    ±20%    ±30%");
    for (const R of RS) {
      const m = errs.get(R)!;
      const v = [...m.values()].sort((a, b) => a - b);
      console.log(`  ${String(R).padStart(7)}  ${(mape(m) * 100).toFixed(2).padStart(6)}%  ` +
        `${(v[Math.floor(v.length / 2)] * 100).toFixed(1).padStart(5)}%  ` +
        `${((v.filter((x) => x <= 0.2).length / v.length) * 100).toFixed(0).padStart(4)}%  ` +
        `${((v.filter((x) => x <= 0.3).length / v.length) * 100).toFixed(0).padStart(4)}%${R === 300 ? "  <- 지금" : ""}`);
    }

    const e300 = errs.get(300)!, e400 = errs.get(400)!;
    const names = [...e300.keys()].filter((n) => e400.has(n));
    const diff = names.map((n) => e300.get(n)! - e400.get(n)!); // 음수면 R=300이 더 정확

    // ── 관문 1 — 짝지은 부트스트랩 (매장 단위 재표집, 2000회) ──────────────
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const boot: number[] = [];
    for (let b = 0; b < 2000; b++) {
      let s = 0;
      for (let k = 0; k < diff.length; k++) s += diff[Math.floor(rnd() * diff.length)];
      boot.push(s / diff.length);
    }
    boot.sort((a, b) => a - b);
    const lo = boot[Math.floor(boot.length * 0.025)], hi = boot[Math.floor(boot.length * 0.975)];
    const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
    console.log(`\n[관문 1] 짝지은 부트스트랩 — 평균(|오차300| − |오차400|) · 음수면 R=300이 낫다`);
    console.log(`  전체 ${diff.length}곳   평균 ${(mean * 100).toFixed(2)}%p` +
      `   95% 구간 [${(lo * 100).toFixed(2)}, ${(hi * 100).toFixed(2)}]%p` +
      `   ${lo > 0 || hi < 0 ? "0을 안 품음 -> **자료가 골랐다**" : "**0을 품는다 -> 자료가 R을 못 골랐다**"}`);

    // 움직이는 매장만 — 검정력이 제일 높은 자리
    const mv = movers.map(nameOf).filter((n) => e300.has(n) && e400.has(n));
    const dmv = mv.map((n) => e300.get(n)! - e400.get(n)!);
    if (dmv.length) {
      const b2: number[] = [];
      for (let b = 0; b < 2000; b++) {
        let s = 0;
        for (let k = 0; k < dmv.length; k++) s += dmv[Math.floor(rnd() * dmv.length)];
        b2.push(s / dmv.length);
      }
      b2.sort((a, b) => a - b);
      const l2 = b2[Math.floor(b2.length * 0.025)], h2 = b2[Math.floor(b2.length * 0.975)];
      const m2 = dmv.reduce((a, b) => a + b, 0) / dmv.length;
      console.log(`  움직이는 ${dmv.length}곳  평균 ${(m2 * 100).toFixed(2)}%p` +
        `   95% 구간 [${(l2 * 100).toFixed(2)}, ${(h2 * 100).toFixed(2)}]%p` +
        `   ${l2 > 0 || h2 < 0 ? "0을 안 품음" : "**0을 품는다**"}`);
    }

    // ── 관문 2 — 부호검정 ────────────────────────────────────────────────
    const moved = names.map((n) => ({ n, d: e300.get(n)! - e400.get(n)! })).filter((x) => Math.abs(x.d) > 1e-9);
    const win300 = moved.filter((x) => x.d < 0).length;
    // 양측 이항검정 p — 정확검정.
    const C = (n: number, k: number) => { let v = 1; for (let i = 0; i < k; i++) v = (v * (n - i)) / (i + 1); return v; };
    const nm = moved.length;
    let p = 0;
    for (let k = 0; k <= nm; k++) {
      const pk = C(nm, k) * Math.pow(0.5, nm);
      if (pk <= C(nm, win300) * Math.pow(0.5, nm) + 1e-12) p += pk;
    }
    console.log(`\n[관문 2] 부호검정 — 차가 0이 아닌 ${nm}곳 중 R=300이 더 정확한 곳 ${win300}곳`);
    console.log(`  양측 이항검정 p = ${p.toFixed(3)}  ${p < 0.05 ? "**유의**" : "미달 — 못 고른다"}`);
    console.log("\n  낱개 (차가 0이 아닌 곳만) · 음수면 R=300이 낫다");
    for (const x of [...moved].sort((a, b) => a.d - b.d)) {
      console.log(`    ${x.n.padEnd(16)}오차300 ${(e300.get(x.n)! * 100).toFixed(1).padStart(6)}%  ` +
        `오차400 ${(e400.get(x.n)! * 100).toFixed(1).padStart(6)}%   차 ${(x.d * 100).toFixed(2).padStart(7)}%p`);
    }
    expect(names.length).toBeGreaterThan(30);
  });

  it("(3) 가짜 반경 대조군 — 거리가 한 일인가, 그냥 더 센 것인가", () => {
    // R=400의 손해가 '거리를 잘못 봐서'라면, **같은 양을 거리 정보 없이** 더 셌을 때는
    // 손해가 달라야 한다. 300m 안 경쟁점의 무게만 W400/W300 배로 부풀린 판을 만든다.
    // 분모에 들어가는 경쟁무게 총량은 R=400과 **정확히 같고**, 거리 정보만 없다.
    const fakeRows: LabRow[] = rows.map((r) => {
      const w3 = rivalWeight(r, 300), w4 = rivalWeight(r, 400);
      if (!(w3 > 0) || !(w4 > w3)) return r; // 부풀릴 게 없거나 안 움직이는 매장은 그대로
      const k = w4 / w3;
      return {
        ...r,
        input: {
          ...r.input,
          rivals: (r.input.rivals ?? [])
            .filter((v) => v.distanceM == null || v.distanceM <= 300)
            .map((v) => ({ ...v, ip: v.ip * k })),
        },
      };
    });
    const scaled = rows.filter((r) => rivalWeight(r, 300) > 0 && rivalWeight(r, 400) > rivalWeight(r, 300));
    const onlyNew = movers.filter((r) => !(rivalWeight(r, 300) > 0));

    const e300 = looErrors(withR(300));
    const e400 = looErrors(withR(400));
    const eFake = looErrors(withR(300), fakeRows);

    console.log(`\n[관문 3] 가짜 반경 대조군 · 부풀린 매장 ${scaled.length}곳` +
      `${onlyNew.length ? ` (300m 안이 비어 부풀릴 수 없는 ${onlyNew.length}곳은 제외됐다: ${onlyNew.map(nameOf).join(", ")})` : ""}`);
    console.log("   판                                   LOO MAPE    R=300 대비");
    const b300 = mape(e300);
    for (const [label, m] of [["R=300 (지금)", e300], ["R=400 (거리 정보 있음)", e400], ["가짜 (같은 양, 거리 정보 없음)", eFake]] as [string, Map<string, number>][]) {
      console.log(`  ${label.padEnd(34)}${(mape(m) * 100).toFixed(2).padStart(7)}%` +
        `${label.startsWith("R=300") ? "         -" : ((mape(m) - b300) * 100).toFixed(2).padStart(10) + "%p"}`);
    }
    console.log(`\n  ⚠️ 읽는 법 — R=400과 가짜가 **비슷하게** 나빠지면, R=400의 손해는 거리와 무관하다`);
    console.log(`     (그냥 경쟁을 더 센 것). 그러면 **자료는 R에 대해 아무 말도 안 한 것**이고,`);
    console.log(`     342m 경쟁점을 셀지 말지는 실무 판단이 정한다.`);
    console.log(`     R=400만 유독 더 나쁘면 그건 거리를 잘못 본 것이고, 300을 지켜야 한다.`);
    expect(fakeRows.length).toBe(rows.length);
  });
});
