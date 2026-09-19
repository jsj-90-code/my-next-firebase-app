// 수요 축척 A 자체를 잰다 (2026-09-19)
//
// 인계 문서 3절: *"수요 축척(A)이 틀어져 있다. A는 독점매장 3곳에서 정하는데 그중 2곳이 이미
// 특수수요를 갖고 있다. 그래서 배수를 켜면 기준점인 광주각화점이 119.5%가 된다 — 자기가
// 기준인데 자기를 못 맞춘다."*
//
// ── 먼저 정리해야 할 것 ────────────────────────────────────────────────────
// `_specialDemand.test.ts`가 제안한 고치는 법은 **독점 기하평균 정규화**다. 그런데 그걸 켜면
// 성적이 지금 배수와 한 글자도 안 다르다(MAPE 22.51% · 중앙 14.3% · ±20% 63% · 100%초과 6곳).
// 정규화는 배수를 g로 나누고 A를 g배 하는 건데, **A는 그 뒤에 어차피 다시 맞춰진다.**
// 매장별로 들어가는 건 A x 배수 곱 하나뿐이라 그 곱이 안 변한다 — **항등변환이다.**
// (1)이 그걸 굳혀 둔다. 여기서 헛돌지 말 것.
//
// ── 그럼 진짜 문제는 무엇인가 ──────────────────────────────────────────────
// A는 독점 3곳에서 log(실측가동률 ÷ A=1일 때 예측가동률)의 **기하평균**이다(중앙값이 아니다 —
// `fitHoursPerUser`). 기하평균이라 3곳의 필요 점유율은 곱이 1이 되게 맞춰질 뿐, 개별로는
// 안 맞는다. 그래서 물어야 할 것은 "각화가 100%냐"가 아니라 이것이다:
//
//     배수를 켜면 축척 표본 **안쪽**의 흩어짐이 줄어드나 늘어나나?
//
//   줄어들면 -> 배수가 진짜 수요원을 잡은 것이다. 각화 119.5%는 딴 데 원인이 있다.
//   늘어나면 -> 배수가 축척 표본을 **찢고 있다**. 그게 고장이다.
//
// (2)가 그걸 잰다. (3)은 3곳이라는 표본이 얼마나 얇은지(잭나이프), (4)는 표본을 넓히면
// 어떻게 되는지다.
//
// ⚠️ 여기서 나온 숫자로 계수를 고르지 말 것. 어제 열 번 기각한 자리다.
//    MAPE 하나만 보지 않는다(중앙·±20%를 같이 본다). 필요 점유율 ↔ 수요 상관은 나눗셈이다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_demandScale.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, qscInWindowAverage, utilizationByStore, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fitProductUnitPrice, scoreTextbook,
  type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "    -" : `${(v * 100).toFixed(d)}%`);

describeIf("수요 축척 A", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id; if (code) qscSites.set(code, doc);
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

  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, locationEvaluations, settings);
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  type Row = (typeof rows)[number];
  const typeOf = (r: Row) => r.input.specialDemandType ?? "없음";
  const nameOf = (r: Row) => r.input.storeName ?? r.input.storeCode;
  // `fitHoursPerUser`의 `calibrationTarget`과 같은 자다 — competitorIp가 0이면 독점.
  const isMonopoly = (r: Row) => !(r.input.competitorIp ?? 0);
  const monopoly = rows.filter(isMonopoly);

  const OFF: Record<string, number> = {};
  for (const k of Object.keys(DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers)) OFF[k] = 1;
  const NOW = DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers;

  /** 독점 3곳에서 기하평균이 1이 되게 배수를 정규화한다. 유형 간 비는 안 바뀐다. */
  const normalized = (mul: Record<string, number>) => {
    const ms = monopoly.map((r) => mul[typeOf(r)] ?? 1).filter((v) => v > 0);
    const g = Math.exp(ms.reduce((a, b) => a + Math.log(b), 0) / ms.length);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(mul)) out[k] = v / g;
    return out;
  };

  const logMean = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + b, 0) / xs.length);

  /**
   * `fitHoursPerUser`의 실측가동률 갈래를 그대로 옮긴 것 — **다만 축척 표본을 밖에서 준다.**
   * (4)에서 독점 말고 다른 표본으로도 맞춰 보려면 이게 필요하다. 본체는 독점으로 고정돼 있다.
   */
  const fitA = (calib: Row[], p: TextbookParams) => {
    const xs: number[] = [];
    for (const r of calib) {
      const actual = r.input.actualUtilization;
      if (actual == null || !(actual > 0)) continue;
      const b = computeTextbook(r.input, { ...p, hoursPerUserPerMonth: 1, maxUtilization: Number.POSITIVE_INFINITY });
      if (b.utilization == null || b.utilization <= 0) continue;
      xs.push(Math.log(actual / b.utilization));
    }
    return xs.length ? logMean(xs) : null;
  };

  /** A를 밖에서 고정하고 38곳을 채점한다. `scoreTextbook`과 같은 순서다(A -> 상품몫 -> 채점). */
  const scoreWithA = (p: TextbookParams, A: number) => {
    const withFit: TextbookParams = { ...p, hoursPerUserPerMonth: A };
    const full: TextbookParams = { ...withFit, productUnitPrice: fitProductUnitPrice(rows, withFit) };
    const errs: number[] = [];
    const req = new Map<string, number>();
    for (const r of rows) {
      const b = computeTextbook(r.input, full);
      if (b.monthlyRevenue != null && r.actualRevenue > 0) {
        errs.push(Math.abs(b.monthlyRevenue - r.actualRevenue) / r.actualRevenue);
      }
      const au = r.input.actualUtilization;
      const bNo = computeTextbook(r.input, { ...full, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY });
      if (bNo.utilization != null && bNo.utilization > 0 && au != null && au > 0) {
        req.set(r.input.storeCode, au / bNo.utilization);
      }
    }
    const sorted = [...errs].sort((a, b) => a - b);
    return {
      A,
      mape: errs.reduce((a, b) => a + b, 0) / errs.length,
      median: sorted[Math.floor(sorted.length / 2)],
      within20: errs.filter((v) => v <= 0.2).length / errs.length,
      max: sorted[sorted.length - 1],
      overOne: [...req.values()].filter((v) => v > 1).length,
      req,
    };
  };

  const run = (mul: Record<string, number>) => scoreTextbook(rows, { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul });

  // ────────────────────────────────────────────────────────────────────────
  it("(1) '독점 기하평균 정규화'는 항등변환이다 — 여기서 헛돌지 말 것", () => {
    const now = run(NOW);
    const norm = run(normalized(NOW));
    const g = Math.exp(monopoly.map((r) => Math.log(NOW[typeOf(r)] ?? 1)).reduce((a, b) => a + b, 0) / monopoly.length);

    console.log(`\n══ (1) 정규화 상수 g = ${g.toFixed(4)} (독점 ${monopoly.length}곳의 배수 기하평균) ══`);
    console.log(`  A          지금 ${now.fittedHoursPerUser.toFixed(4)}  ->  정규화 ${norm.fittedHoursPerUser.toFixed(4)}` +
      `   (비 ${(norm.fittedHoursPerUser / now.fittedHoursPerUser).toFixed(4)} = g)`);
    console.log(`  배수(없음)   지금 ${(NOW["없음"] ?? 1).toFixed(4)}  ->  정규화 ${(normalized(NOW)["없음"] ?? 1).toFixed(4)}` +
      `   (비 ${(1 / g).toFixed(4)} = 1/g)`);

    let worst = 0;
    for (const a of now.rows) {
      const b = norm.rows.find((x) => x.storeCode === a.storeCode);
      if (!b || a.predicted == null || b.predicted == null) continue;
      worst = Math.max(worst, Math.abs(a.predicted - b.predicted) / Math.max(1, a.predicted));
    }
    console.log(`\n  38곳 예측 매출 최대 차이: ${(worst * 100).toFixed(6)}%`);
    console.log(`  MAPE ${pct(now.mape, 2)} -> ${pct(norm.mape, 2)} · 중앙 ${pct(now.medianAbsErr)} -> ${pct(norm.medianAbsErr)}` +
      ` · ±20% ${pct(now.within20, 0)} -> ${pct(norm.within20, 0)} · 100%초과 ${now.requiredShare?.overOne} -> ${norm.requiredShare?.overOne}`);
    console.log(`\n  => 매장에 들어가는 건 **A x 배수 곱 하나**뿐이고 A는 뒤에 다시 맞춰진다.`);
    console.log(`     배수를 g로 나누면 A가 g배 되어 곱이 그대로다. **정규화로는 아무것도 안 고쳐진다.**`);
    console.log(`     각화 119.5%도 그대로 남는다. 고치려면 A의 **표본**이나 **배수 자체**를 건드려야 한다.`);

    // 항등변환임을 굳혀 둔다. 다음 세션에서 또 시도하지 않게.
    expect(worst).toBeLessThan(1e-9);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(2) 배수가 축척 표본 안쪽을 모으나 찢나", () => {
    console.log(`\n══ (2) 축척을 정하는 독점 ${monopoly.length}곳의 필요 점유율 ══`);
    console.log(`  (A는 이 3곳의 기하평균이 1이 되게 맞춰진다 — 개별로는 안 맞는다)\n`);

    const cases = [["배수 끔", OFF], ["지금 배수", NOW]] as const;
    const table: Record<string, number[]> = {};
    for (const [label, mul] of cases) {
      const s = run(mul);
      const vals: number[] = [];
      const lines: string[] = [];
      for (const m of monopoly) {
        const row = s.rows.find((x) => x.storeCode === m.input.storeCode);
        const v = row?.requiredShare ?? null;
        if (v == null) continue;
        vals.push(v);
        lines.push(`    ${nameOf(m).padEnd(12)} ${typeOf(m).padEnd(6)} 배수 ${(mul[typeOf(m)] ?? 1).toFixed(2)}` +
          `   필요 점유율 ${pct(v)}`);
      }
      const logs = vals.map((v) => Math.log(v));
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
      const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
      table[label] = vals;
      console.log(`  [${label}]  A=${s.fittedHoursPerUser.toFixed(3)}`);
      for (const l of lines) console.log(l);
      console.log(`    -> 최대÷최소 ${(Math.max(...vals) / Math.min(...vals)).toFixed(3)}배` +
        `  ·  로그표준편차 ${sd.toFixed(4)}  ·  기하평균 ${pct(Math.exp(mean))}\n`);
    }

    const spread = (vs: number[]) => Math.max(...vs) / Math.min(...vs);
    const a = spread(table["배수 끔"]), b = spread(table["지금 배수"]);
    console.log(`  판정: 축척 표본 안쪽 흩어짐 ${a.toFixed(3)}배 -> ${b.toFixed(3)}배` +
      `  (${b > a ? "**늘었다 — 배수가 축척 표본을 찢고 있다**" : "줄었다 — 배수가 수요원을 잡았다"})`);
    console.log(`\n  읽는 법: 탕정역·남악이 진짜로 특수수요를 갖고 있다면, 배수 끔에서 그 둘의`);
    console.log(`  필요 점유율이 각화보다 **높게** 나와야 한다(수요를 과소평가했으니 더 먹어야 한다).`);
    console.log(`  그래야 배수가 셋을 한 줄로 모은다. 반대로 나오면 배수는 없는 차이를 만든 것이다.`);
    expect(monopoly.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(3) 3곳이라는 표본이 얼마나 얇은가 — 잭나이프", () => {
    console.log(`\n══ (3) 독점 3곳 중 하나씩 빼고 A를 잡으면 ══`);
    for (const [label, mul] of [["배수 끔", OFF], ["지금 배수", NOW]] as const) {
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      const base = fitA(monopoly, P);
      if (base == null) continue;
      console.log(`\n  [${label}]  3곳 전부: A=${base.toFixed(3)}`);
      const full = scoreWithA(P, base);
      console.log(`    ${"(기준)".padEnd(16)} A=${base.toFixed(3)} (  0.0%)` +
        `  MAPE ${pct(full.mape, 2)}  중앙 ${pct(full.median)}  ±20% ${pct(full.within20, 0)}  100%초과 ${full.overOne}곳`);
      const As: number[] = [];
      for (const drop of monopoly) {
        const sub = monopoly.filter((r) => r.input.storeCode !== drop.input.storeCode);
        const A = fitA(sub, P);
        if (A == null) continue;
        As.push(A);
        const s = scoreWithA(P, A);
        console.log(`    ${(nameOf(drop) + " 뺌").padEnd(16)} A=${A.toFixed(3)} (${((A / base - 1) * 100).toFixed(1).padStart(6)}%)` +
          `  MAPE ${pct(s.mape, 2)}  중앙 ${pct(s.median)}  ±20% ${pct(s.within20, 0)}  100%초과 ${s.overOne}곳`);
      }
      console.log(`    -> A 흔들림 폭 ${((Math.max(...As) / Math.min(...As) - 1) * 100).toFixed(1)}%` +
        ` (한 곳 빼는 것만으로)`);
    }
    console.log(`\n  38곳 전부가 이 3곳에 걸려 있다. 한 곳이 틀리면 전부 그만큼 밀린다.`);
    expect(true).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(4) 축척 표본을 넓히면 — 경쟁이 약한 매장까지", () => {
    // 독점도 = 자사PC / (자사PC + 경쟁IP). 1이면 독점이다.
    // ⚠️ 문턱을 낮출수록 경쟁 항의 오차가 축척으로 스며든다. 2026-09-16에 전체로 맞췄다가
    //    광주각화점이 90.9% 과대예측된 자리다. 여기서는 **어디서부터 무너지는지**만 본다.
    const dominance = (r: Row) => {
      const pc = r.input.pcCount ?? 0;
      const ip = r.input.competitorIp ?? 0;
      return pc + ip > 0 ? pc / (pc + ip) : null;
    };
    const withDom = rows
      .map((r) => ({ r, d: dominance(r) }))
      .filter((x) => x.d != null && (x.r.input.actualUtilization ?? 0) > 0)
      .sort((a, b) => (b.d as number) - (a.d as number));

    console.log(`\n══ (4) 독점도 상위 매장 ══`);
    for (const x of withDom.slice(0, 10)) {
      console.log(`  ${nameOf(x.r).padEnd(14)} 독점도 ${((x.d as number) * 100).toFixed(1).padStart(5)}%` +
        `  자사PC ${String(x.r.input.pcCount ?? 0).padStart(3)}  경쟁IP ${String(x.r.input.competitorIp ?? 0).padStart(4)}  ${typeOf(x.r)}`);
    }

    for (const [label, mul] of [["배수 끔", OFF], ["지금 배수", NOW]] as const) {
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      console.log(`\n  [${label}] 축척 표본을 넓혀가며`);
      console.log(`    ${"문턱".padEnd(10)} ${"곳수".padStart(4)}  ${"A".padStart(7)}   MAPE    중앙   ±20%   100%초과   각화 필요점유율`);
      for (const th of [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.0]) {
        const calib = withDom.filter((x) => (x.d as number) >= th).map((x) => x.r);
        if (calib.length < 3) continue;
        const A = fitA(calib, P);
        if (A == null) continue;
        const s = scoreWithA(P, A);
        const gak = monopoly.find((m) => typeOf(m) === "없음");
        const gakReq = gak ? s.req.get(gak.input.storeCode) : null;
        console.log(`    독점도>=${th.toFixed(2)}  ${String(calib.length).padStart(4)}  ${A.toFixed(3).padStart(7)}` +
          `  ${pct(s.mape, 2)}  ${pct(s.median)}  ${pct(s.within20, 0)}   ${String(s.overOne).padStart(2)}곳` +
          `      ${pct(gakReq)}`);
      }
    }
    console.log(`\n  ⚠️ MAPE가 낮은 문턱을 고르지 말 것. 표본을 넓히면 경쟁 항의 오차가 축척으로`);
    console.log(`     들어와 "수요가 맞는지"를 영영 못 가리게 된다(설계 주석 · 2026-09-16 실패).`);
    expect(withDom.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(5) 배수가 준 이득은 유형 차이인가, 그냥 수준인가", () => {
    // (2)에서 배수가 축척 표본을 찢는 게 드러났다. 그런데 38곳 성적은 배수를 켤 때가 낫다
    // (MAPE 22.93 -> 22.51 · 중앙 20.6 -> 14.3 · ±20% 50 -> 63). 둘을 어떻게 화해시키나?
    //
    // 배수가 하는 일은 딱 둘로 갈린다:
    //   (가) **수준** — 축척 표본의 배수 기하평균이 1이 아니라서 A가 통째로 밀린다(-16.8%)
    //   (나) **유형 차이** — 유형끼리의 상대비
    // (1)에서 봤듯 정규화는 항등변환이라 둘을 "정규화로" 못 가른다. 대신 **(가)만 따로
    // 재현해서** 성적을 본다 — 배수는 전부 끄고 A만 배수 켤 때와 같은 값으로 강제한다.
    //
    //   배수 끔 + A 강제 ≈ 지금 배수  ->  이득은 **전부 수준**이다. 유형은 한 일이 없다.
    //   지금 배수가 더 낫다        ->  유형 차이가 진짜로 일을 했다.
    const POFF: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: OFF };
    const PNOW: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: NOW };
    const Aoff = fitA(monopoly, POFF) as number;
    const Anow = fitA(monopoly, PNOW) as number;

    console.log(`\n══ (5) 수준이냐 유형이냐 ══`);
    const line = (label: string, s: ReturnType<typeof scoreWithA>) =>
      console.log(`  ${label.padEnd(26)} A=${s.A.toFixed(3)}  MAPE ${pct(s.mape, 2)}  중앙 ${pct(s.median)}` +
        `  ±20% ${pct(s.within20, 0)}  최대 ${pct(s.max, 0)}  100%초과 ${s.overOne}곳`);
    line("배수 끔 (A 자유)", scoreWithA(POFF, Aoff));
    line("배수 끔 + A를 배수값으로", scoreWithA(POFF, Anow));
    line("지금 배수", scoreWithA(PNOW, Anow));

    console.log(`\n  [참고] 배수 끔에서 A만 훑으면 (유형 차이 0, 수준 하나로만)`);
    console.log(`    ${"A".padStart(7)}  ${"수준비".padStart(6)}   MAPE    중앙   ±20%   100%초과`);
    for (const f of [1.0, 0.95, 0.9, 0.85, 0.832, 0.8, 0.75, 0.7]) {
      const s = scoreWithA(POFF, Aoff * f);
      console.log(`    ${s.A.toFixed(3).padStart(7)}  ${f.toFixed(3).padStart(6)}  ${pct(s.mape, 2)}  ${pct(s.median)}` +
        `  ${pct(s.within20, 0)}    ${String(s.overOne).padStart(2)}곳${Math.abs(f - Anow / Aoff) < 1e-6 ? "   <- 지금 배수와 같은 수준" : ""}`);
    }
    console.log(`\n  ⚠️ 이 표로 A를 고르지 말 것 — 이건 "성적이 수준 하나에 얼마나 민감한가"를`);
    console.log(`     재는 자다. MAPE가 제일 낮은 A를 고르면 그게 바로 어제 두 번 밟은 눈금 옮기기다.`);
    expect(Aoff).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(6) 유형을 하나씩 끄면 — 누가 이득을 내고 누가 축척을 찢나", () => {
    // (5)에서 유형 차이가 진짜 일을 한다는 게 나왔다. 그런데 (2)에서는 축척 표본을 찢는다.
    // **찢는 놈과 이득 내는 놈이 같은 놈인가?** 축척 표본에 든 유형은 둘뿐이다
    // (탕정역=산업단지 · 남악=기타). 나머지 유형은 축척을 건드릴 수 없다.
    const spreadOf = (mul: Record<string, number>) => {
      const s = run(mul);
      const vs = monopoly.map((m) => s.rows.find((x) => x.storeCode === m.input.storeCode)?.requiredShare)
        .filter((v): v is number => v != null);
      const gak = monopoly.find((m) => typeOf(m) === "없음");
      return {
        spread: Math.max(...vs) / Math.min(...vs),
        gak: gak ? s.rows.find((x) => x.storeCode === gak.input.storeCode)?.requiredShare ?? null : null,
        s,
      };
    };
    const inCalib = new Set(monopoly.map((m) => typeOf(m)));
    console.log(`\n══ (6) 배수를 유형별로 1.00으로 되돌리면 ══`);
    console.log(`  축척 표본에 든 유형: ${[...inCalib].join(" · ")}  (이 둘만 A를 움직일 수 있다)\n`);
    console.log(`  ${"되돌린 유형".padEnd(22)} ${"A".padStart(6)}   MAPE    중앙   ±20%   100%초과  독점흩어짐  각화`);
    const show = (label: string, mul: Record<string, number>) => {
      const { spread, gak, s } = spreadOf(mul);
      console.log(`  ${label.padEnd(22)} ${s.fittedHoursPerUser.toFixed(3).padStart(6)}  ${pct(s.mape, 2)}  ${pct(s.medianAbsErr)}` +
        `  ${pct(s.within20, 0)}    ${String(s.requiredShare?.overOne ?? 0).padStart(2)}곳    ${spread.toFixed(3)}배   ${pct(gak)}`);
    };
    show("(없음 — 지금 배수)", NOW);
    for (const t of Object.keys(NOW).filter((k) => (NOW[k] ?? 1) !== 1)) {
      show(`${t}${inCalib.has(t) ? " *축척표본*" : ""}`, { ...NOW, [t]: 1 });
    }
    const offCalib = { ...NOW };
    for (const t of inCalib) offCalib[t] = 1;
    show("축척표본 유형 전부", offCalib);
    show("(전부 끔)", OFF);

    console.log(`\n  읽는 법: 독점흩어짐이 1.0에 가까우면 축척 표본이 한 줄로 선다(고장 없음).`);
    console.log(`  어떤 유형을 되돌렸을 때 흩어짐이 잡히면서 38곳 성적이 안 무너지면, 그 배수가 범인이다.`);
    expect(inCalib.size).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(7) 관문 — 배수를 '유도하는 절차' 자체를 홀드아웃한다", () => {
    // 지금 배수는 38곳 전부를 보고 유도했다. 그래서 38곳 성적이 좋은 건 당연하다 —
    // **표본 안 성적이다.** 절차가 진짜인지 보려면 한 곳을 빼고 배수를 **다시 유도**한 뒤
    // 뺀 곳을 맞혀야 한다. 계수 하나를 홀드아웃하는 게 아니라 **유도 규칙**을 홀드아웃한다.
    //
    // 유도 규칙(2026-09-16에 쓴 것 그대로):
    //   배수 끔 상태의 유형별 필요 점유율 중앙 ÷ "없음" 중앙.  표본 2곳 미만 유형은 1.00.
    const POFF: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: OFF };

    const derive = (train: Row[], pinTourism: boolean) => {
      const A = fitA(train.filter(isMonopoly), POFF);
      if (A == null) return null;
      const full: TextbookParams = { ...POFF, hoursPerUserPerMonth: A };
      const byType = new Map<string, number[]>();
      for (const r of train) {
        const au = r.input.actualUtilization;
        const b = computeTextbook(r.input, { ...full, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY });
        if (b.utilization == null || b.utilization <= 0 || au == null || !(au > 0)) continue;
        const t = typeOf(r);
        byType.set(t, [...(byType.get(t) ?? []), au / b.utilization]);
      }
      const medOf = (vs: number[] | undefined) => {
        if (!vs?.length) return null;
        const s = [...vs].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      const base = medOf(byType.get("없음"));
      if (!base || base <= 0) return null;
      const out: Record<string, number> = {};
      for (const t of Object.keys(NOW)) {
        const vs = byType.get(t);
        const m = medOf(vs);
        out[t] = vs && vs.length >= 2 && m != null ? m / base : 1;
      }
      out["없음"] = 1;
      if (pinTourism) out["관광·유흥"] = 1;
      return out;
    };

    /** 학습 표본으로 축척·상품몫을 맞춘 뒤 **뺀 한 곳**을 채점한다. */
    const holdOutErr = (train: Row[], test: Row, mul: Record<string, number>) => {
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      const A = fitA(train.filter(isMonopoly), P);
      if (A == null) return null;
      const withFit: TextbookParams = { ...P, hoursPerUserPerMonth: A };
      const full: TextbookParams = { ...withFit, productUnitPrice: fitProductUnitPrice(train, withFit) };
      const b = computeTextbook(test.input, full);
      if (b.monthlyRevenue == null || !(test.actualRevenue > 0)) return null;
      return Math.abs(b.monthlyRevenue - test.actualRevenue) / test.actualRevenue;
    };

    const looOf = (label: string, mulFor: (train: Row[]) => Record<string, number> | null) => {
      const errs: number[] = [];
      for (const test of rows) {
        const train = rows.filter((r) => r.input.storeCode !== test.input.storeCode);
        const mul = mulFor(train);
        if (!mul) continue;
        const e = holdOutErr(train, test, mul);
        if (e != null) errs.push(e);
      }
      const s = [...errs].sort((a, b) => a - b);
      console.log(`  ${label.padEnd(30)} n=${String(errs.length).padStart(2)}  LOO MAPE ${pct(s.reduce((a, b) => a + b, 0) / s.length, 2)}` +
        `  중앙 ${pct(s[Math.floor(s.length / 2)])}  ±20% ${pct(s.filter((v) => v <= 0.2).length / s.length, 0)}`);
      return s;
    };

    console.log(`\n══ (7) LOO — 한 곳 빼고 배수를 다시 유도한 뒤 그 곳을 맞힌다 ══`);
    looOf("배수 끔", () => OFF);
    looOf("지금 배수 (고정 · 표본 안 유리)", () => NOW);
    looOf("매번 다시 유도 (관광·유흥 1.00 고정)", (t) => derive(t, true));
    looOf("매번 다시 유도 (규칙 그대로)", (t) => derive(t, false));

    // 유도된 배수가 얼마나 흔들리는지도 같이 본다 — 값이 매번 크게 바뀌면 절차가 불안정한 것이다.
    const spreadByType = new Map<string, number[]>();
    for (const test of rows) {
      const train = rows.filter((r) => r.input.storeCode !== test.input.storeCode);
      const mul = derive(train, true);
      if (!mul) continue;
      for (const [t, v] of Object.entries(mul)) spreadByType.set(t, [...(spreadByType.get(t) ?? []), v]);
    }
    console.log(`\n  유도된 배수가 한 곳 뺄 때마다 얼마나 흔들리나 (지금 값과 견줘서)`);
    for (const [t, vs] of [...spreadByType.entries()].filter(([t]) => t !== "없음")) {
      console.log(`    ${t.padEnd(8)} 최소 ${Math.min(...vs).toFixed(2)} ~ 최대 ${Math.max(...vs).toFixed(2)}` +
        `   (지금 값 ${(NOW[t] ?? 1).toFixed(2)})`);
    }
    expect(rows.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(8) 17% 수준 차이는 어디에 사나 — 독점↔경쟁인가, 유형 간인가", () => {
    // 여기까지의 그림: 독점 3곳은 A=6.885를 원하고(셋이 2% 안에 든다), 경쟁상권 매장들은
    // A≈5.7을 원한다. 특수수요 배수는 그 17%를 "산업단지·기타가 특수수요를 갖고 있다"로
    // 흡수했다 — 그런데 독점 안에서 보면 그 설명이 안 맞는다.
    //
    // 그럼 17%는 **수요식**의 문제가 아니라 **경쟁 항**의 문제일 수 있다. 가르는 법:
    //   배수 끔(A=6.885)에서 **부호 있는** 오차를 독점/경쟁으로 갈라 본다.
    //     독점 ≈ 0, 경쟁만 + (과대예측)  -> 경쟁 항이 덜 깎는다. **수요가 아니다**
    //     유형별로 갈리면                -> 특수수요가 맞다
    const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: OFF };
    const A = fitA(monopoly, P) as number;
    const withFit: TextbookParams = { ...P, hoursPerUserPerMonth: A };
    const full: TextbookParams = { ...withFit, productUnitPrice: fitProductUnitPrice(rows, withFit) };

    type Probe = { r: Row; signed: number; req: number | null };
    const probes: Probe[] = [];
    for (const r of rows) {
      const b = computeTextbook(r.input, full);
      if (b.monthlyRevenue == null || !(r.actualRevenue > 0)) continue;
      const bNo = computeTextbook(r.input, { ...full, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY });
      const au = r.input.actualUtilization;
      const req = bNo.utilization != null && bNo.utilization > 0 && au != null && au > 0 ? au / bNo.utilization : null;
      probes.push({ r, signed: (b.monthlyRevenue - r.actualRevenue) / r.actualRevenue, req });
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const report = (label: string, ps: Probe[]) => {
      if (!ps.length) return;
      const over = ps.filter((p) => p.signed > 0).length;
      console.log(`  ${label.padEnd(18)} n=${String(ps.length).padStart(2)}  부호오차 중앙 ${pct(med(ps.map((p) => p.signed)), 1)}` +
        `  과대예측 ${over}/${ps.length}  필요점유율 중앙 ${pct(med(ps.map((p) => p.req).filter((v): v is number => v != null)))}`);
    };

    console.log(`\n══ (8) 배수 끔 · A=${A.toFixed(3)} 에서 부호 있는 오차 ══`);
    console.log(`  (+ 면 과대예측 — 산식이 실제보다 크게 부른다)\n`);
    report("독점 3곳", probes.filter((p) => isMonopoly(p.r)));
    report("경쟁상권", probes.filter((p) => !isMonopoly(p.r)));
    console.log("");
    for (const t of [...new Set(probes.map((p) => typeOf(p.r)))]) {
      report(t, probes.filter((p) => typeOf(p.r) === t));
    }
    console.log(`\n  경쟁상권만 따로 — 유형별`);
    for (const t of [...new Set(probes.map((p) => typeOf(p.r)))]) {
      report(`  ${t}`, probes.filter((p) => !isMonopoly(p.r) && typeOf(p.r) === t));
    }

    const comp = probes.filter((p) => !isMonopoly(p.r));
    const compNone = comp.filter((p) => typeOf(p.r) === "없음");
    console.log(`\n  판정용 두 숫자`);
    console.log(`    독점 3곳 부호오차 중앙      ${pct(med(probes.filter((p) => isMonopoly(p.r)).map((p) => p.signed)), 1)}`);
    console.log(`    경쟁 '없음' 부호오차 중앙   ${pct(med(compNone.map((p) => p.signed)), 1)}  (n=${compNone.length})`);
    console.log(`\n  둘이 크게 갈리면 17%는 **경쟁 항**에 산다 — 특수수요 배수가 그걸 대신 흡수한 것이다.`);
    console.log(`  비슷하면 수요식의 수준 자체가 문제고, 독점 3곳이 대표성이 없다는 뜻이 된다.`);
    expect(probes.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(9) 진짜 순환 — 축척을 정한 매장으로 배수까지 정하고 있다", () => {
    // (8)에서 드러난 것: **독점매장의 필요 점유율은 자유로운 측정값이 아니다.** A가 바로
    // 그 값들의 기하평균이 1이 되게 맞춰지니까 셋은 100% 언저리에 **박혀 있다**
    // (97.6 · 99.4 · 99.2). 그런데 배수 유도 규칙은 유형별 필요 점유율 중앙을 쓰면서
    // **그 박힌 값들을 같이 넣는다.**
    //
    //   기타   전체 4곳 중앙 63.8%  ->  배수 1.26
    //          경쟁 3곳 중앙 47.6%  ->  배수 0.94      <- 남악(박힌 값 99.2%)이 중앙을 끌어올렸다
    //   산업단지 전체 3곳 중앙 70.2%  ->  배수 1.39
    //          경쟁 2곳 중앙 70.2%  ->  배수 1.39      <- 탕정역은 중앙이 아니라 영향 없음
    //
    // 즉 **축척을 정한 매장이 배수도 정하고 있다.** 이게 인계 문서가 말한 순환의 실체다.
    // 정규화가 아니라 **유도 표본에서 독점을 빼는 것**이 고치는 자리다.
    const POFF: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: OFF };
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

    const derive = (train: Row[], excludeMonopoly: boolean) => {
      const A = fitA(train.filter(isMonopoly), POFF);
      if (A == null) return null;
      const full: TextbookParams = { ...POFF, hoursPerUserPerMonth: A };
      const src = excludeMonopoly ? train.filter((r) => !isMonopoly(r)) : train;
      const byType = new Map<string, number[]>();
      for (const r of src) {
        const au = r.input.actualUtilization;
        const b = computeTextbook(r.input, { ...full, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY });
        if (b.utilization == null || b.utilization <= 0 || au == null || !(au > 0)) continue;
        byType.set(typeOf(r), [...(byType.get(typeOf(r)) ?? []), au / b.utilization]);
      }
      const base = med(byType.get("없음") ?? []);
      if (!base || base <= 0) return null;
      const out: Record<string, number> = {};
      for (const t of Object.keys(NOW)) {
        const vs = byType.get(t); const m = med(vs ?? []);
        out[t] = vs && vs.length >= 2 && m != null ? m / base : 1;
      }
      out["없음"] = 1;
      out["관광·유흥"] = 1; // n=2라 근거 부족 — 지금 규칙 그대로 1.00에 고정한다
      return out;
    };

    const DERIVED_ALL = derive(rows, false) as Record<string, number>;
    const DERIVED_COMP = derive(rows, true) as Record<string, number>;
    console.log(`\n══ (9) 유도 표본에서 독점을 빼면 배수가 어떻게 바뀌나 ══`);
    console.log(`  ${"유형".padEnd(10)} ${"지금 값".padStart(7)} ${"전체로 유도".padStart(10)} ${"경쟁만으로 유도".padStart(12)}`);
    for (const t of Object.keys(NOW)) {
      if (t === "없음") continue;
      console.log(`  ${t.padEnd(10)} ${(NOW[t] ?? 1).toFixed(2).padStart(7)} ${DERIVED_ALL[t].toFixed(2).padStart(10)}` +
        ` ${DERIVED_COMP[t].toFixed(2).padStart(12)}`);
    }

    const gOf = (mul: Record<string, number>) =>
      Math.exp(monopoly.map((r) => Math.log(mul[typeOf(r)] ?? 1)).reduce((a, b) => a + b, 0) / monopoly.length);
    console.log(`\n  축척 표본(독점 3곳)의 배수 기하평균 — 1.00이어야 A가 안 밀린다`);
    console.log(`    지금 값 ${gOf(NOW).toFixed(4)} · 전체로 유도 ${gOf(DERIVED_ALL).toFixed(4)} · 경쟁만으로 유도 ${gOf(DERIVED_COMP).toFixed(4)}`);

    console.log(`\n  38곳 성적 (표본 안)`);
    console.log(`  ${"".padEnd(22)} ${"A".padStart(6)}   MAPE    중앙   ±20%   최대  100%초과  독점흩어짐  각화`);
    for (const [label, mul] of [["배수 끔", OFF], ["지금 배수", NOW], ["경쟁만으로 유도", DERIVED_COMP]] as const) {
      const s = run(mul);
      const vs = monopoly.map((m) => s.rows.find((x) => x.storeCode === m.input.storeCode)?.requiredShare)
        .filter((v): v is number => v != null);
      const gak = monopoly.find((m) => typeOf(m) === "없음");
      const gakReq = gak ? s.rows.find((x) => x.storeCode === gak.input.storeCode)?.requiredShare ?? null : null;
      console.log(`  ${label.padEnd(22)} ${s.fittedHoursPerUser.toFixed(3).padStart(6)}  ${pct(s.mape, 2)}  ${pct(s.medianAbsErr)}` +
        `  ${pct(s.within20, 0)}  ${pct(s.maxAbsErr, 0)}   ${String(s.requiredShare?.overOne ?? 0).padStart(2)}곳    ` +
        `${(Math.max(...vs) / Math.min(...vs)).toFixed(3)}배   ${pct(gakReq)}`);
    }

    // ── 관문: LOO ──────────────────────────────────────────────────────────
    const holdOutErr = (train: Row[], test: Row, mul: Record<string, number>) => {
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      const A = fitA(train.filter(isMonopoly), P);
      if (A == null) return null;
      const withFit: TextbookParams = { ...P, hoursPerUserPerMonth: A };
      const full: TextbookParams = { ...withFit, productUnitPrice: fitProductUnitPrice(train, withFit) };
      const b = computeTextbook(test.input, full);
      if (b.monthlyRevenue == null || !(test.actualRevenue > 0)) return null;
      return Math.abs(b.monthlyRevenue - test.actualRevenue) / test.actualRevenue;
    };
    console.log(`\n  LOO — 한 곳 빼고 배수를 다시 유도한 뒤 그 곳을 맞힌다`);
    for (const [label, mulFor] of [
      ["배수 끔", () => OFF],
      ["지금 배수 (고정 · 표본 안 유리)", () => NOW],
      ["매번 유도 — 전체로", (t: Row[]) => derive(t, false)],
      ["매번 유도 — 경쟁만으로", (t: Row[]) => derive(t, true)],
    ] as const) {
      const errs: number[] = [];
      for (const test of rows) {
        const train = rows.filter((r) => r.input.storeCode !== test.input.storeCode);
        const mul = mulFor(train);
        if (!mul) continue;
        const e = holdOutErr(train, test, mul);
        if (e != null) errs.push(e);
      }
      const s = [...errs].sort((a, b) => a - b);
      console.log(`    ${label.padEnd(30)} LOO MAPE ${pct(s.reduce((a, b) => a + b, 0) / s.length, 2)}` +
        `  중앙 ${pct(s[Math.floor(s.length / 2)])}  ±20% ${pct(s.filter((v) => v <= 0.2).length / s.length, 0)}`);
    }
    console.log(`\n  ⚠️ 세 자(MAPE·중앙·±20%)가 같이 움직이는지 볼 것. 하나만 좋아지면 눈금 옮기기다.`);
    expect(DERIVED_COMP["기타"]).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(10) 무작위 대조군 — 유형 이름표를 섞어도 같은 이득이 나오나", () => {
    // 이 프로젝트의 표준 관문이다(2026-09-10). 배수를 켜면 중앙 20.6->14.3%, ±20% 50->63%로
    // 좋아진다. 그게 **진짜 유형 신호**인지, 아니면 "38곳 중 16곳에 1보다 큰 수를 곱하면
    // 아무렇게나 붙여도 좋아지는" 것인지 가른다.
    //
    // 섞는 법: 유형 **이름표만** 매장들 사이에서 섞는다. 배수 값도, 유형별 곳수도 그대로다.
    //   ⚠️ 축척 표본(독점 3곳)도 같이 섞인다 — 거기 어떤 이름표가 앉느냐가 A를 정하니까
    //      그것까지 포함해서 대조해야 공정하다.
    const TRIALS = 500;
    const labels = rows.map((r) => typeOf(r));
    const realScore = run(NOW);
    const offScore = run(OFF);

    // 섞은 이름표로 채점한다. buildLabRows를 다시 안 돌리려고 input을 갈아끼운다.
    const scoreShuffled = (perm: string[]) => {
      const shuffled = rows.map((r, i) => ({
        ...r,
        input: { ...r.input, specialDemandType: perm[i] } as TextbookInput,
      }));
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: NOW };
      return scoreTextbook(shuffled, P);
    };

    // 재현 가능한 난수 (mulberry32)
    let seed = 20260919;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const mapes: number[] = [], medians: number[] = [], w20s: number[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const perm = [...labels];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      const s = scoreShuffled(perm);
      if (s.mape != null) mapes.push(s.mape);
      if (s.medianAbsErr != null) medians.push(s.medianAbsErr);
      if (s.within20 != null) w20s.push(s.within20);
    }

    const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
    const better = (a: number[], v: number, lowerIsBetter: boolean) =>
      (lowerIsBetter ? a.filter((x) => x <= v).length : a.filter((x) => x >= v).length) / a.length;

    console.log(`\n══ (10) 유형 이름표 무작위 섞기 ${TRIALS}회 ══`);
    console.log(`  (배수 값·유형별 곳수는 그대로. 어느 매장이 어느 유형인지만 섞는다)\n`);
    console.log(`  ${"".padEnd(10)} ${"배수 끔".padStart(8)} ${"섞음 5%".padStart(9)} ${"섞음 중앙".padStart(9)} ${"섞음 95%".padStart(9)} ${"진짜 배정".padStart(9)}   p값`);
    console.log(`  ${"MAPE".padEnd(10)} ${pct(offScore.mape, 2).padStart(8)} ${pct(q(mapes, 0.05), 2).padStart(9)} ${pct(q(mapes, 0.5), 2).padStart(9)}` +
      ` ${pct(q(mapes, 0.95), 2).padStart(9)} ${pct(realScore.mape, 2).padStart(9)}   ${better(mapes, realScore.mape as number, true).toFixed(3)}`);
    console.log(`  ${"중앙".padEnd(10)} ${pct(offScore.medianAbsErr).padStart(8)} ${pct(q(medians, 0.05)).padStart(9)} ${pct(q(medians, 0.5)).padStart(9)}` +
      ` ${pct(q(medians, 0.95)).padStart(9)} ${pct(realScore.medianAbsErr).padStart(9)}   ${better(medians, realScore.medianAbsErr as number, true).toFixed(3)}`);
    console.log(`  ${"±20%".padEnd(10)} ${pct(offScore.within20, 0).padStart(8)} ${pct(q(w20s, 0.05), 0).padStart(9)} ${pct(q(w20s, 0.5), 0).padStart(9)}` +
      ` ${pct(q(w20s, 0.95), 0).padStart(9)} ${pct(realScore.within20, 0).padStart(9)}   ${better(w20s, realScore.within20 as number, false).toFixed(3)}`);
    console.log(`\n  p값 = 섞은 배정이 진짜 배정만큼 좋게 나온 비율. 0.05 아래여야 "진짜 신호"다.`);
    console.log(`  섞음 중앙이 배수 끔보다 좋으면 — **아무 데나 붙여도 좋아진다**는 뜻이고,`);
    console.log(`  그 이득은 유형이 아니라 "16곳에 1보다 큰 수를 곱한 것" 자체에서 나온 것이다.`);
    expect(mapes.length).toBe(TRIALS);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(11) 후보 — 축척 표본을 '배수가 1인 독점매장'으로 한정하면", () => {
    // 여기까지: 배수는 진짜 신호다(10). 그런데 축척 표본을 찢는다(2). 둘 다 참이다.
    // 정규화도(1) 유도표본 바꾸기도(9) 못 풀었다. 남은 자리는 **축척 표본 자체**다.
    //
    // 사용자 설계를 글자 그대로 따르면 답이 하나 나온다 — *"배수가 1인 순수 기준점은
    // 광주각화점 하나뿐이다."* 축척을 **그 한 곳**에 걸면:
    //   · 배수가 무엇이든 A가 안 밀린다 (각화 배수는 언제나 1.00)
    //   · 각화 필요 점유율이 **정의상 100.0%** — "기준점이 자기를 못 맞춘다"가 사라진다
    //   · 탕정역·남악의 필요 점유율이 **자유로운 측정값**이 된다 (더 이상 A에 박히지 않는다)
    //     -> "산업단지·기타가 진짜 특수수요를 갖고 있나"를 처음으로 직접 물을 수 있다
    //
    // ⚠️ 대가: 표본이 1곳이다. (3)의 잭나이프가 보여준 대로 각화 한 곳이 틀리면 38곳이 다 밀린다.
    //    이건 측정이 아니라 **설계 선택**이다 — 사용자 확인 없이 바꾸지 않는다.
    const pure = monopoly.filter((r) => (NOW[typeOf(r)] ?? 1) === 1);
    console.log(`\n══ (11) 축척 표본 = 배수 1.00인 독점매장 ${pure.length}곳 (${pure.map(nameOf).join(", ")}) ══`);

    console.log(`\n  [배수 끔] 이 A로 재면 독점 3곳의 필요 점유율 (각화는 정의상 100.0%)`);
    for (const [label, mul] of [["배수 끔", OFF], ["지금 배수", NOW]] as const) {
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      const A = fitA(pure, P);
      if (A == null) continue;
      const s = scoreWithA(P, A);
      console.log(`\n  [${label}]  A=${A.toFixed(3)}`);
      for (const m of monopoly) {
        const v = s.req.get(m.input.storeCode);
        console.log(`    ${nameOf(m).padEnd(12)} ${typeOf(m).padEnd(6)} 배수 ${(mul[typeOf(m)] ?? 1).toFixed(2)}   필요 점유율 ${pct(v)}`);
      }
      console.log(`    38곳:  MAPE ${pct(s.mape, 2)}  중앙 ${pct(s.median)}  ±20% ${pct(s.within20, 0)}` +
        `  최대 ${pct(s.max, 0)}  100%초과 ${s.overOne}곳`);
    }

    console.log(`\n  견줌 — 지금 구조(독점 3곳으로 A)`);
    for (const [label, mul] of [["배수 끔", OFF], ["지금 배수", NOW]] as const) {
      const s = run(mul);
      console.log(`    ${label.padEnd(10)} A=${s.fittedHoursPerUser.toFixed(3)}  MAPE ${pct(s.mape, 2)}  중앙 ${pct(s.medianAbsErr)}` +
        `  ±20% ${pct(s.within20, 0)}  최대 ${pct(s.maxAbsErr, 0)}  100%초과 ${s.requiredShare?.overOne}곳`);
    }

    // ── 관문: LOO ──────────────────────────────────────────────────────────
    const holdOutErr = (train: Row[], test: Row, mul: Record<string, number>, calib: Row[]) => {
      const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      const A = fitA(calib, P);
      if (A == null) return null;
      const withFit: TextbookParams = { ...P, hoursPerUserPerMonth: A };
      const full: TextbookParams = { ...withFit, productUnitPrice: fitProductUnitPrice(train, withFit) };
      const b = computeTextbook(test.input, full);
      if (b.monthlyRevenue == null || !(test.actualRevenue > 0)) return null;
      return Math.abs(b.monthlyRevenue - test.actualRevenue) / test.actualRevenue;
    };
    console.log(`\n  LOO (배수는 지금 값 고정 — 축척 표본만 바꿔서 견준다)`);
    for (const [label, pick] of [
      ["독점 3곳으로 A", (t: Row[]) => t.filter(isMonopoly)],
      ["배수 1.00인 독점만으로 A", (t: Row[]) => t.filter((r) => isMonopoly(r) && (NOW[typeOf(r)] ?? 1) === 1)],
    ] as const) {
      for (const [mlabel, mul] of [["배수 끔", OFF], ["지금 배수", NOW]] as const) {
        const errs: number[] = [];
        for (const test of rows) {
          const train = rows.filter((r) => r.input.storeCode !== test.input.storeCode);
          const calib = pick(train);
          if (!calib.length) continue;
          const e = holdOutErr(train, test, mul, calib);
          if (e != null) errs.push(e);
        }
        if (!errs.length) continue;
        const s = [...errs].sort((a, b) => a - b);
        console.log(`    ${label.padEnd(24)} ${mlabel.padEnd(10)} n=${String(errs.length).padStart(2)}` +
          `  LOO MAPE ${pct(s.reduce((a, b) => a + b, 0) / s.length, 2)}  중앙 ${pct(s[Math.floor(s.length / 2)])}` +
          `  ±20% ${pct(s.filter((v) => v <= 0.2).length / s.length, 0)}`);
      }
    }
    console.log(`\n  ⚠️ 각화가 빠지는 LOO 회차에서는 축척 표본이 0곳이 된다 — 그 회차는 빠진다.`);
    console.log(`     n이 38보다 작으면 그 뜻이고, **그게 바로 이 설계의 약점**이다.`);
    expect(pure.length).toBeGreaterThan(0);
  });
});
