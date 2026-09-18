// 특수수요 2차 가공 — 축척 순환부터 푼다 (2026-09-18)
//
// 사용자(2026-09-16): *"지금 이 특수수요를 정하는 게 정확하지 않으니까, 경쟁력점수 작업 끝나면
// 2차 가공하는 것도 좋을 거 같다. 1차는 우선 최대한 예측해서 넣고"* — 그 2차다.
//
// ── 풀어야 할 순환 ────────────────────────────────────────────────────────
// 수요 축척 A(hoursPerUserPerMonth)는 **독점매장**에서 정한다(경쟁 항이 약분돼 수요식만 남으니까).
// 그런데 독점 3곳 중 2곳이 이미 특수수요를 갖고 있다:
//     탕정역 = 산업단지 · 남악 = 기타 · 광주각화 = 없음
//
// 배수를 켜면 그 2곳의 수요가 커진다 -> 같은 실측 가동률을 맞추려고 A가 작아진다
//   -> 배수가 1인 "없음" 매장은 수요가 그대로인데 A만 작아져 **예측이 통째로 내려간다**
//   -> 필요 점유율(실측÷예측)이 올라가 100%를 넘는 곳이 늘어난다
// 실제로 1차 적용 때 100% 초과가 4곳 -> 5곳으로 늘었고, 늘어난 3곳이 전부 "없음"이었다.
//
// **배수가 유형 간 차이를 주는 게 아니라 전체 수준을 흔들고 있다.** 이걸 먼저 끊어야
// "군부대가 대학가보다 센가" 같은 질문이 뜻을 갖는다.
//
// ── 고치는 법 (이 저장소가 이미 쓰는 방법) ─────────────────────────────────
// `locationReferences` 주석에 같은 문제와 해법이 적혀 있다: 곱셈 보정은 **표본 전체에서
// 평균적으로 1배**여야 중립이고, 그러려면 기준을 기하평균으로 잡아야 한다. 여기서는
// **축척을 정하는 매장들(독점 3곳)에서 기하평균이 1이 되게** 배수를 정규화하면 된다.
// 그러면 배수는 A를 못 건드리고 유형 간 **차이만** 남는다.
//   ⚠️ 이건 자유계수가 아니라 정규화다. 유형 간 비는 한 글자도 안 바뀐다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_specialDemand.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, qscInWindowAverage, utilizationByStore, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeQualityScore, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "    -" : `${(v * 100).toFixed(d)}%`);

describeIf("특수수요 2차 가공", () => {
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
  const typeOf = (r: (typeof rows)[number]) => r.input.specialDemandType ?? "없음";
  const monopoly = rows.filter((r) => !(r.input.rivals ?? []).some((x) => x.ip > 0));

  const OFF: Record<string, number> = {};
  for (const k of Object.keys(DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers)) OFF[k] = 1;
  const NOW = DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers;

  /** 독점매장에서 기하평균이 1이 되게 정규화한다. 유형 간 비는 안 바뀐다. */
  const normalized = (mul: Record<string, number>) => {
    const ms = monopoly.map((r) => mul[typeOf(r)] ?? 1).filter((v) => v > 0);
    if (!ms.length) return { ...mul };
    const g = Math.exp(ms.reduce((a, b) => a + Math.log(b), 0) / ms.length);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(mul)) out[k] = v / g;
    return out;
  };

  const run = (mul: Record<string, number>) => {
    const P = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
    const s = scoreTextbook(rows, P);
    return { s, full: fittedParams(P, s) };
  };

  // 사용자(2026-09-18): *"양주덕정 문경시청 부경대 문산점 이런 데 예상매출이 너무 낮잖아.
  // 이런 애들 오차 확 줄이려고 하는 거거든. 수요가 문제야 경쟁점이 문제야 뭔 문제냐 쟤네들,
  // 매출 40퍼 이상 차이나는 애들"*
  //
  // ── 가르는 자 ─────────────────────────────────────────────────────────────
  // **필요 점유율** = 실측 가동률 ÷ (경쟁이 없다고 볼 때의 예측 가동률)
  //   1을 넘으면  -> 경쟁을 아무리 잘 맞춰도 못 따라간다. **수요식이 작다**
  //   1 아래인데 예측 점유율이 그보다 훨씬 낮으면 -> **경쟁 항이 과하다**
  // 둘 다 아닌데 매출이 틀리면 -> **단가층**(정가·상품몫) 문제다.
  it("(0) 크게 틀리는 매장 — 수요냐 경쟁이냐 단가냐", () => {
    const { s } = run(NOW);
    const bad = s.rows
      .filter((r) => r.absErrPct != null && Math.abs(r.absErrPct) >= 0.3)
      .sort((a, b) => Math.abs(b.absErrPct ?? 0) - Math.abs(a.absErrPct ?? 0));
    console.log(`\n══ (0) 오차 30% 이상 ${bad.length}곳 — 어느 층이 문제인가 ══`);
    console.log(
      `  ${"매장".padEnd(14)}${"오차".padStart(8)}${"필요점유율".padStart(10)}${"예측점유율".padStart(10)}` +
        `${"경쟁IP".padStart(7)}  특수수요   판정`,
    );
    for (const r of bad) {
      const row = rows.find((x) => x.input.storeCode === r.storeCode);
      const rivIp = (row?.input.rivals ?? []).reduce((a, x) => a + (x.ip > 0 ? x.ip : 0), 0);
      const req = r.requiredShare;
      // ⚠️ 부호가 중요하다 — 과소예측과 과대예측은 완전히 다른 문제다.
      const signed = r.predicted != null && r.actual > 0 ? r.predicted / r.actual - 1 : null;
      let verdict: string;
      if (signed != null && signed > 0) {
        // 과대예측 — 필요 점유율이 낮다는 건 "이 매장은 동네 수요를 조금만 먹었다"는 뜻이다.
        verdict = req != null && req < 0.4 ? "과대 — 수요식이 크다(동네 대비 실적 낮음)" : "과대 — 경쟁을 덜 봤거나 단가층";
      } else if (req == null) verdict = "실측 가동률 없음";
      else if (req > 1) verdict = "과소 — 수요식이 작다 (경쟁으로 못 푼다)";
      else if (rivIp === 0) verdict = "과소 — 경쟁 없음. 수요/단가 문제";
      else if (r.share != null && r.share < req * 0.8) verdict = "과소 — 경쟁 항이 과하다";
      else verdict = "과소 — 수요·경쟁은 맞음. 단가층 의심";
      console.log(
        `  ${(r.storeName ?? "").slice(0, 13).padEnd(14)}` +
          `${(signed == null ? "-" : `${signed >= 0 ? "+" : ""}${(signed * 100).toFixed(0)}%`).padStart(8)}` +
          `${pct(req).padStart(10)}${pct(r.share).padStart(10)}${String(rivIp).padStart(7)}  ` +
          `${(row ? typeOf(row) : "?").padEnd(8)} ${verdict}`,
      );
    }
    const under = bad.filter((r) => r.predicted != null && r.predicted < r.actual);
    const overDemand = under.filter((r) => r.requiredShare != null && r.requiredShare > 1).length;
    console.log(`\n  -> 크게 틀리는 ${bad.length}곳 중 과소예측 ${under.length}곳 · 과대예측 ${bad.length - under.length}곳`);
    console.log(`     과소예측 중 ${overDemand}곳은 **필요 점유율 100% 초과** — 경쟁 항을 어떻게 고쳐도 못 맞힌다.`);
    expect(bad.length).toBeGreaterThan(0);
  });

  // 어느 쪽을 팔지 정하는 시험이다. "경쟁 항이 과하다"가 **그 7곳만의 일이냐, 경쟁상권
  // 전체의 일이냐**. 전체면 계수 하나로 잡히는 계통편향이고 29곳으로 검정할 수 있다.
  // 7곳만의 일이면 매장별 사정이라 계수로 못 잡는다.
  it("(0-B) 경쟁상권 전체에서 산식이 경쟁점에 과하게 내주나", () => {
    const { s } = run(NOW);
    const pairs = s.rows
      .map((r) => ({ r, req: r.requiredShare, sh: r.share }))
      .filter((x): x is { r: typeof x.r; req: number; sh: number } => x.req != null && x.sh != null);
    const comp = pairs.filter((x) => {
      const row = rows.find((y) => y.input.storeCode === x.r.storeCode);
      return (row?.input.rivals ?? []).some((v) => v.ip > 0);
    });
    const mono = pairs.filter((x) => !comp.includes(x));

    const stat = (label: string, arr: typeof pairs) => {
      if (!arr.length) { console.log(`  ${label}: 없음`); return; }
      const gaps = arr.map((x) => x.sh - x.req).sort((a, b) => a - b);
      const ratios = arr.map((x) => x.sh / x.req).sort((a, b) => a - b);
      const lower = arr.filter((x) => x.sh < x.req).length;
      console.log(
        `  ${label.padEnd(16)} n=${String(arr.length).padStart(2)}` +
          `  산식<실제인 곳 ${String(lower).padStart(2)}/${arr.length}` +
          `  격차 중앙 ${(gaps[Math.floor(gaps.length / 2)] * 100).toFixed(1)}%p` +
          `  비 중앙 ${ratios[Math.floor(ratios.length / 2)].toFixed(2)}`,
      );
    };
    console.log(`\n══ (0-B) 산식 점유율 vs 실제 먹은 몫 ══`);
    stat("경쟁상권", comp);
    stat("독점상권", mono);
    console.log(
      `\n  '산식<실제'가 경쟁상권에서만 쏠려 있으면 **경쟁 항의 계통편향**이다 —` +
        `\n  매장별 사정이 아니라 계수 하나로 잡히는 문제고, 29곳으로 검정할 수 있다.` +
        `\n  독점상권까지 같이 쏠려 있으면 경쟁이 아니라 **수요·축척** 문제다.`,
    );
    expect(pairs.length).toBeGreaterThan(0);
  });

  // (0-B)에서 "경쟁상권에서만 산식이 실제보다 적게 준다"가 나왔다(23/35 · 비 0.84).
  // 점유율은 **세 단계**를 거쳐 만들어진다. 어느 단계가 깎는지 단계별로 본다.
  //
  //   1단계 대수만      자사PC ÷ (자사PC + 경쟁PC)              품질도 거리도 안 봄
  //   2단계 품질 반영    자사PC ÷ (자사PC + Σ 경쟁PC x (경쟁품질/자사품질)^θ)   유효거리 안만
  //   3단계 입지 곱셈    x 입지배율(중심도·접근성), 1을 넘으면 자른다
  it("(0-C) 점유율이 어느 단계에서 깎이나", () => {
    const { s, full } = run(NOW);
    const W = full.qualityWeights;
    const rowsWithReq = s.rows.filter((r) => r.requiredShare != null);
    type Step = { name: string; v: number };
    const per: { store: string; req: number; steps: Step[] }[] = [];
    for (const r of rowsWithReq) {
      const row = rows.find((x) => x.input.storeCode === r.storeCode);
      if (!row) continue;
      const rivals = (row.input.rivals ?? []).filter((x) => x.ip > 0);
      if (!rivals.length) continue;  // 독점은 여기서 볼 게 없다
      const pc = row.input.pcCount ?? 0;
      if (!pc) continue;
      const allIp = rivals.reduce((a, x) => a + x.ip, 0);
      const inIp = rivals.filter((x) => (x.distanceM ?? 0) <= full.effectiveRadiusM).reduce((a, x) => a + x.ip, 0);
      const oq = computeQualityScore(row.input.ownQualityParts ?? null, W);
      let qw = 0;
      for (const x of rivals) {
        if ((x.distanceM ?? 0) > full.effectiveRadiusM) continue;
        const v = computeQualityScore(x.parts ?? null, W);
        const ratio = oq == null || !(oq > 0) || v == null || !(v > 0) ? 1 : v / oq;
        qw += x.ip * Math.pow(ratio, full.qualityExponent);
      }
      const b = computeTextbook(row.input, full);
      per.push({
        store: r.storeName ?? r.storeCode,
        req: r.requiredShare as number,
        steps: [
          { name: "대수만(전부)", v: pc / (pc + allIp) },
          { name: "유효거리 안만", v: pc / (pc + inIp) },
          { name: "품질 반영", v: pc / (pc + qw) },
          { name: "입지 곱한 최종", v: b.share ?? 0 },
        ],
      });
    }
    const med = (a: number[]) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
    console.log(`\n══ (0-C) 점유율 만드는 단계 — 경쟁상권 ${per.length}곳 중앙값 ══`);
    const reqMed = med(per.map((p) => p.req));
    for (let i = 0; i < 4; i++) {
      const v = med(per.map((p) => p.steps[i].v));
      console.log(`  ${per[0].steps[i].name.padEnd(14)} ${pct(v)}   (실제 먹은 몫 ${pct(reqMed)} 대비 ${(v / reqMed).toFixed(2)}배)`);
    }
    console.log(`  ${"실제 먹은 몫".padEnd(14)} ${pct(reqMed)}   <- 맞춰야 할 값`);
    console.log(
      `\n  읽는 법: 어느 줄에서 '실제 먹은 몫'보다 내려가는지가 범인이다.` +
        `\n  1->2에서 내려가면 유효거리, 2->3이면 품질지수 θ, 3->4면 입지 배율이다.`,
    );

    // 입지 배율이 평균 1배가 아니면 그 자체가 계통편향이다.
    const locs = per.map((p) => (p.steps[2].v > 0 ? p.steps[3].v / p.steps[2].v : 1));
    console.log(`\n  입지 배율(최종÷품질반영) 중앙 ${med(locs).toFixed(3)}` +
      `  — 1.000이어야 중립이다. 1보다 작으면 입지 항이 전체를 깎고 있다.`);
    expect(per.length).toBeGreaterThan(10);
  });

  it("(1) 축척을 정하는 매장이 이미 특수수요를 갖고 있다", () => {
    console.log(`\n══ 축척(A)을 정하는 독점매장 ${monopoly.length}곳 ══`);
    for (const r of monopoly) {
      console.log(`  ${(r.input.storeName ?? r.input.storeCode).padEnd(14)} 특수수요 ${typeOf(r).padEnd(6)}` +
        ` 배수 ${(NOW[typeOf(r)] ?? 1).toFixed(2)}`);
    }
    const pure = monopoly.filter((r) => typeOf(r) === "없음");
    console.log(`  -> 배수가 1인 순수 기준점은 ${pure.length}곳뿐이다` +
      `${pure.length ? ` (${pure.map((r) => r.input.storeName).join(", ")})` : ""}`);
    expect(monopoly.length).toBeGreaterThan(0);
  });

  it("(2) 배수를 켜면 축척이 얼마나 밀리나", () => {
    const off = run(OFF), now = run(NOW), norm = run(normalized(NOW));
    console.log(`\n══ 축척 A(1인 월 이용시간)와 성적 ══`);
    const line = (label: string, x: ReturnType<typeof run>) => {
      const over = x.s.requiredShare?.overOne ?? 0;
      console.log(`  ${label.padEnd(22)} A=${x.full.hoursPerUserPerMonth.toFixed(3)}` +
        `  MAPE ${pct(x.s.mape, 2)}  중앙 ${pct(x.s.medianAbsErr)}  ±20% ${pct(x.s.within20, 0)}` +
        `  필요점유율 100%초과 ${over}곳`);
    };
    line("배수 끔 (전부 1.0)", off);
    line("지금 배수", now);
    line("독점 기하평균 정규화", norm);
    const drop = (now.full.hoursPerUserPerMonth / off.full.hoursPerUserPerMonth - 1) * 100;
    console.log(`\n  배수를 켜면 A가 ${drop.toFixed(1)}% 움직인다.` +
      ` 이만큼이 **유형 차이가 아니라 전체 수준**으로 들어간 것이다.`);
    expect(off.full.hoursPerUserPerMonth).toBeGreaterThan(0);
  });

  it("(3) 100%를 넘는 매장이 누구인가 — 유형별로", () => {
    for (const [label, mul] of [["배수 끔", OFF], ["지금 배수", NOW], ["정규화", normalized(NOW)]] as const) {
      const { s } = run(mul);
      const over = s.rows.filter((r) => r.requiredShare != null && r.requiredShare > 1);
      const byType = new Map<string, number>();
      for (const r of over) {
        const row = rows.find((x) => x.input.storeCode === r.storeCode);
        const t = row ? typeOf(row) : "?";
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      console.log(`\n  [${label}] 필요 점유율 100% 초과 ${over.length}곳` +
        `  ${[...byType.entries()].map(([t, n]) => `${t} ${n}`).join(" · ")}`);
      for (const r of over.sort((a, b) => (b.requiredShare ?? 0) - (a.requiredShare ?? 0)).slice(0, 6)) {
        const row = rows.find((x) => x.input.storeCode === r.storeCode);
        console.log(`     ${(r.storeName ?? "").padEnd(14)} ${pct(r.requiredShare)}  (${row ? typeOf(row) : "?"})`);
      }
    }
    expect(true).toBe(true);
  });

  it("(4) 유형별 필요 점유율 — 배수를 다시 도출하면", () => {
    // 1차는 "배수 끔" 상태의 유형별 필요 점유율로 잡았다. 같은 자로 다시 재본다.
    for (const [label, mul] of [["배수 끔", OFF], ["정규화", normalized(NOW)]] as const) {
      const { s } = run(mul);
      const byType = new Map<string, number[]>();
      for (const r of s.rows) {
        if (r.requiredShare == null) continue;
        const row = rows.find((x) => x.input.storeCode === r.storeCode);
        const t = row ? typeOf(row) : "?";
        byType.set(t, [...(byType.get(t) ?? []), r.requiredShare]);
      }
      const base = (byType.get("없음") ?? []).slice().sort((a, b) => a - b);
      const baseMed = base.length ? base[Math.floor(base.length / 2)] : null;
      console.log(`\n  [${label}] 유형별 필요 점유율 중앙 (없음 대비 배수)`);
      for (const [t, vs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const sorted = vs.slice().sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        const ratio = baseMed && baseMed > 0 ? med / baseMed : null;
        console.log(`    ${t.padEnd(8)} n=${String(vs.length).padStart(2)}  중앙 ${pct(med)}` +
          `  -> 배수 ${ratio == null ? "-" : ratio.toFixed(2)}` +
          `   (지금 값 ${(NOW[t] ?? 1).toFixed(2)})`);
      }
    }
    console.log(`\n  ⚠️ 표본이 유형당 2~5곳이다. 이 표로 값을 확정하지 말 것 —` +
      `\n     지금 값과 얼마나 어긋나는지, 정규화가 그 어긋남을 줄이는지만 본다.`);
    expect(true).toBe(true);
  });
});
