// 수요식은 동네마다 얼마나 틀리나 — 그리고 무엇과 함께 틀리나 (2026-09-18)
//
// ── 어디서 나온 질문인가 ──────────────────────────────────────────────────
// 하루 종일 입지·경쟁·품질·특수수요를 아홉 번 만졌고 아홉 번 다 기각됐다. 그러다
// `_rivalCapacity.test.ts` (2-C)에서 이게 나왔다 — 경쟁점 핑봇이 **전부** 있는 8곳만 보면:
//
//   실제로 쓰인 시간 ÷ 산식이 센 수요   중앙 1.45 · 범위 0.52~2.26 · 1 넘는 곳 5/8
//
// 크기가 일정하게 틀리면 계수 하나로 끝난다. 그런데 **동네마다 0.5배에서 2.3배까지** 틀린다.
// 그리고 그 방향이 오차 방향과 정확히 맞는다(문경시청 비 2.26 -> 과소예측 · 수원망포 0.52 -> 과대예측).
//
// ── 여기서 쓰는 자 ────────────────────────────────────────────────────────
// **필요 점유율** = 실측 가동률 ÷ (경쟁 없다고 볼 때의 예측 가동률)
//   경쟁점 자료가 **한 글자도 안 들어간다.** 우리 실측과 산식 수요, 둘뿐이다.
//   그래서 오늘 흔들린 경쟁점 가동률 문제(핑봇 vs 좌석, r=0.219)와 무관하다.
//   높을수록 수요를 작게 센 것이다. 1을 넘으면 우리가 동네 수요를 다 먹어도 모자란다는 뜻.
//
// ⚠️ **측정만 한다.** 여기 상관이 세게 나와도 그걸로 계수를 고르지 않는다 —
//    그건 오늘 하루 종일 걸러낸 그 함정이다. 관문(LOO·대조군)은 다음 단계다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_demandGap.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, qscInWindowAverage, utilizationByStore, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pear = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
};
/** 순위상관 — 이상치 한둘에 끌려다니지 않게 같이 본다. */
const spear = (a: number[], b: number[]) => {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length).fill(0);
    idx.forEach(([, i], k) => { r[i] = k + 1; });
    return r;
  };
  return pear(rank(a), rank(b));
};

describeIf("수요식이 동네마다 얼마나 틀리나", () => {
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
  const labRows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const score = scoreTextbook(labRows, P);
  const full = fittedParams(P, score);

  type Probe = { name: string; req: number; vars: Record<string, number | null> };
  const probes: Probe[] = [];
  for (const lr of labRows) {
    const r = score.rows.find((x) => x.storeCode === lr.input.storeCode);
    if (!r || r.requiredShare == null) continue;
    const i = lr.input;
    const b = computeTextbook(i, full);
    const pop1 = i.pop1km ?? null;
    const pop5 = i.pop500m ?? null;
    const f400 = i.floatingByRadius?.[400] ?? null;
    const f1000 = i.floatingByRadius?.[1000] ?? null;
    const ages = i.residentAges;
    const young = ages ? (ages.age10s + ages.age20s) : null;
    const totalAge = ages
      ? ages.age0s + ages.age10s + ages.age20s + ages.age30s + ages.age40s + ages.age50s + ages.age60plus
      : null;
    probes.push({
      name: r.storeName ?? r.storeCode,
      req: r.requiredShare,
      vars: {
        "주거 1km": pop1,
        "주거 500m": pop5,
        "유동 400m": f400,
        "유동 1km": f1000,
        "유동÷주거": pop1 && f400 ? f400 / pop1 : null,
        "밀집도(500÷1km)": pop1 && pop5 ? pop5 / pop1 : null,
        "10~20대 비중": young != null && totalAge ? young / totalAge : null,
        "자사 PC수": i.pcCount ?? null,
        "경쟁점 수": i.competitorCount ?? null,
        "산식 수요(시간)": b.totalDemandHours ?? null,
        "예측 가동률": b.utilization ?? null,
      },
    });
  }

  it("(1) 필요 점유율은 무엇과 함께 움직이나", () => {
    const keys = Object.keys(probes[0].vars);
    const n = probes.length;
    const sig = 2 / Math.sqrt(n);
    console.log(`\n══ 필요 점유율 ↔ 상권 특성 — ${n}곳 · 유의선 ${sig.toFixed(3)} ══`);
    console.log(`  필요 점유율이 **높을수록 수요를 작게 센 것**이다.`);
    console.log(`  음수 = "이 값이 클수록 수요를 잘 센다" · 양수 = "이 값이 클수록 수요를 작게 센다"\n`);
    console.log(`  ${"항목".padEnd(18)}${"상관 r".padStart(9)}${"순위상관".padStart(10)}  판정`);
    const rows: [string, number, number][] = [];
    for (const k of keys) {
      const pairs = probes.filter((p) => p.vars[k] != null);
      if (pairs.length < 10) continue;
      const x = pairs.map((p) => p.vars[k] as number);
      const y = pairs.map((p) => p.req);
      const r = pear(x, y), s = spear(x, y);
      rows.push([k, r, s]);
    }
    rows.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
    for (const [k, r, s] of rows) {
      const strong = Math.abs(s) > sig;
      console.log(`  ${k.padEnd(18)}${r.toFixed(3).padStart(9)}${s.toFixed(3).padStart(10)}  ${strong ? "⭐ 유의" : ""}`);
    }
    console.log(`\n  ⚠️ 상관이 세다고 그 항을 바로 넣으면 안 된다. 오늘 아홉 번 그렇게 걸렀다.`);
    expect(rows.length).toBeGreaterThan(3);
  });

  // ⚠️ (1)의 -0.816을 그대로 믿으면 안 된다. 필요 점유율의 **분모가 산식 수요**라서
  //    "예측값과 그 잔차의 상관"이 섞여 있다. 수요를 아무 숫자로 흔들어도 음의 상관이 나온다.
  //    그래서 진짜 시험은 **b를 넣고 성적이 좋아지나 + 관문을 통과하나**다.
  //
  //    수요 = (주거 + 유동 x α) x ... 를 그대로 두고, 마지막에 (수요/기준)^(b-1)을 곱한다.
  //    b=1이면 지금과 같다. b<1이면 작은 동네가 올라가고 큰 동네가 내려간다.
  //    기준은 기하평균 — 곱셈 보정이 표본 전체에서 평균적으로 1배여야 중립이다
  //    (locationReferences가 쓰는 것과 같은 규칙. 자유계수가 아니라 정규화다).
  it("(3) 인구 정비례를 깨면 — b를 넣고 관문에 건다", () => {
    const base = labRows.map((lr) => computeTextbook(lr.input, full).totalDemandHours)
      .filter((v): v is number => v != null && v > 0);
    const geo = Math.exp(mean(base.map((v) => Math.log(v))));

    // b를 넣은 채로 축척까지 다시 맞춘다 — 안 그러면 b가 수준만 옮기고 끝난다.
    const runB = (b: number) => {
      const scaled = labRows.map((lr) => {
        const h = computeTextbook(lr.input, full).totalDemandHours;
        const f = h != null && h > 0 ? Math.pow(h / geo, b - 1) : 1;
        // 수요 배율은 특수수요 배수 칸을 빌려 매장별로 먹인다(유형별이 아니라 매장별이라
        // 임시로 쓴다 — 채택되면 제대로 된 자리를 만든다).
        return {
          ...lr,
          input: {
            ...lr.input,
            specialDemandType: `__b${lr.input.storeCode}`,
          },
        };
      });
      const mul: Record<string, number> = {};
      for (const lr of labRows) {
        const h = computeTextbook(lr.input, full).totalDemandHours;
        const cur = DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers[lr.input.specialDemandType ?? "없음"] ?? 1;
        mul[`__b${lr.input.storeCode}`] = cur * (h != null && h > 0 ? Math.pow(h / geo, b - 1) : 1);
      }
      const p2 = { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul };
      const s = scoreTextbook(scaled, p2);
      return s;
    };

    const BS = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
    console.log(`\n══ (3) 수요 ∝ 인구^b — b를 낮추면 작은 동네가 올라간다 ══`);
    console.log(`  ${"b".padStart(5)}  ${"MAPE".padStart(8)} ${"중앙".padStart(7)} ${"±20%".padStart(6)} ${"최대".padStart(7)}  필요점유율 100%초과`);
    for (const b of BS) {
      const s = runB(b);
      console.log(`  ${String(b).padStart(5)}  ${`${((s.mape ?? 0) * 100).toFixed(2)}%`.padStart(8)} ` +
        `${`${((s.medianAbsErr ?? 0) * 100).toFixed(1)}%`.padStart(7)} ` +
        `${`${((s.within20 ?? 0) * 100).toFixed(0)}%`.padStart(6)} ` +
        `${`${((s.maxAbsErr ?? 0) * 100).toFixed(0)}%`.padStart(7)}  ` +
        `${String(s.requiredShare?.overOne ?? 0).padStart(6)}곳${b === 1 ? "   <- 지금" : ""}`);
    }

    // 관문 — LOO
    console.log(`\n══ LOO — 한 곳 빼고 b 고른 뒤 뺀 곳에서 채점 ══`);
    const perRow = (b: number) => runB(b).rows;
    const cache = new Map<number, ReturnType<typeof perRow>>();
    for (const b of BS) cache.set(b, perRow(b));
    const codes = labRows.map((l) => l.input.storeCode);
    for (const crit of ["mape"] as const) {
      const errs: number[] = [], picks: number[] = [];
      for (let i = 0; i < codes.length; i++) {
        let best = { b: 1, v: Infinity };
        for (const b of BS) {
          const rs = cache.get(b)!.filter((_, j) => j !== i);
          const v = mean(rs.map((r) => Math.abs(r.absErrPct ?? 0)));
          if (v < best.v) best = { b, v };
        }
        picks.push(best.b);
        errs.push(Math.abs(cache.get(best.b)![i]?.absErrPct ?? 0));
      }
      const tally = [...new Set(picks)].map((b) => [b, picks.filter((x) => x === b).length] as const).sort((a, b) => b[1] - a[1]);
      const base1 = mean(cache.get(1)!.map((r) => Math.abs(r.absErrPct ?? 0)));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] LOO ${(mean(errs) * 100).toFixed(2)}%   (b=1 그대로면 ${(base1 * 100).toFixed(2)}%)`);
      console.log(`     훈련이 고른 b: ${tally.map(([b, n]) => `${b} ${Math.round(n / picks.length * 100)}%`).join(" · ")}`);
    }
    expect(BS.length).toBeGreaterThan(3);
  });

  it("(2) 필요 점유율 순으로 늘어놓고 본다", () => {
    const sorted = [...probes].sort((a, b) => b.req - a.req);
    console.log(`\n══ 필요 점유율 높은 순 (수요를 작게 센 순) ══`);
    console.log(`  ${"매장".padEnd(14)}${"필요점유율".padStart(10)}${"주거1km".padStart(10)}${"유동400m".padStart(10)}` +
      `${"유동÷주거".padStart(10)}${"PC수".padStart(6)}`);
    const show = (p: Probe) => {
      const v = p.vars;
      console.log(`  ${p.name.slice(0, 13).padEnd(14)}${`${(p.req * 100).toFixed(1)}%`.padStart(10)}` +
        `${(v["주거 1km"] == null ? "-" : Math.round(v["주거 1km"]).toLocaleString()).padStart(10)}` +
        `${(v["유동 400m"] == null ? "-" : Math.round(v["유동 400m"]).toLocaleString()).padStart(10)}` +
        `${(v["유동÷주거"] == null ? "-" : v["유동÷주거"].toFixed(2)).padStart(10)}` +
        `${(v["자사 PC수"] == null ? "-" : String(v["자사 PC수"])).padStart(6)}`);
    };
    for (const p of sorted.slice(0, 8)) show(p);
    console.log(`  ${"...".padEnd(14)}`);
    for (const p of sorted.slice(-6)) show(p);

    const hi = sorted.slice(0, Math.floor(sorted.length / 3));
    const lo = sorted.slice(-Math.floor(sorted.length / 3));
    const cmp = (k: string) => {
      const a = hi.map((p) => p.vars[k]).filter((v): v is number => v != null);
      const b = lo.map((p) => p.vars[k]).filter((v): v is number => v != null);
      if (!a.length || !b.length) return null;
      return [med(a), med(b)] as const;
    };
    console.log(`\n  [상위 3분의 1 vs 하위 3분의 1] 중앙값 비교`);
    for (const k of ["주거 1km", "유동 400m", "유동÷주거", "밀집도(500÷1km)", "10~20대 비중", "자사 PC수", "경쟁점 수"]) {
      const c = cmp(k);
      if (!c) continue;
      const [a, b] = c;
      console.log(`    ${k.padEnd(18)} 수요 작게 센 쪽 ${a.toFixed(a < 10 ? 2 : 0).padStart(10)}` +
        ` · 잘 센 쪽 ${b.toFixed(b < 10 ? 2 : 0).padStart(10)}` +
        `   ${b !== 0 ? `${(a / b).toFixed(2)}배` : ""}`);
    }
    expect(sorted.length).toBeGreaterThan(10);
  });
});
