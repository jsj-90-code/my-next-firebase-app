// 후보지 점검표 🔴 남은 셋 — 울산삼산 · 창원상남 · 영월 (2026-09-21)
//
// ── 사용자 지시 ───────────────────────────────────────────────────────────
// *"시간 남으면 후보지 점검표 🔴 남은 3곳(울산삼산·창원상남·영월)"* → *"남은후보지도 하셈"*
//
// 점검표(`_candidateRedFlags`)는 **"사람이 봐라"까지만** 한다. 여기서 그 셋을 낱개로 판다.
// 셋 다 공통 증상이 하나다 — **실험실이 운영 V62보다 훨씬 낮다**(-59% · -71% · -75%).
// 후보지 13곳 중앙이 -17%이므로 이 셋만 유별나다. 왜 그런지가 이 파일의 과녁이다.
//
// ⚠️ 후보지는 실매출이 없어 **어느 쪽이 맞는지 채점할 수 없다.** 그래서 "어느 항이 얼마나
//    끌어내렸나"를 분해만 한다. 고치는 건 사람이 정한다.
//
// ── 2026-09-21에 새로 찾은 구멍 하나를 여기서 계량한다 ────────────────────
// 품질 모드는 경쟁점을 낱개로 세는데, `ip = appliedPcCount ?? totalPcCount`가 둘 다 비면
// **그 경쟁점이 배열에서 통째로 빠진다**(`labInput`의 `.filter(r => r.ip > 0)`).
// 거리·품질은 멀쩡한데 대수 한 칸이 비어서 경쟁이 없는 셈이 된다. 방향이 한쪽이라
// (빠지면 경쟁이 줄어 예측이 **위로** 밀린다) 그냥 두면 후보지가 체계적으로 후해진다.
// 기존점은 168곳 중 8곳(4.8%)뿐이라 축척은 거의 안 흔들린다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_remainingCandidates.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  utilizationByStore, qscInWindowAverage, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const won = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 1e4).toLocaleString()}만`);
const num = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString());
/** 점검표가 🔴를 띄운 셋. 오송·하안금당은 이미 따로 팠다. */
const TARGETS = ["울산삼산", "창원상남", "영월"];

describeIf("후보지 점검표 🔴 남은 셋", () => {
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
  const existingRows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const full = fittedParams(P, scoreTextbook(existingRows, P));
  const franchiseManagement = franchiseManagementFromRows(existingRows, qscByStoreCode);
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement });
  const v62 = new Map<string, number>();
  for (const r of (snap.results ?? []) as { candidateCode?: string; v62Final?: number | null }[]) {
    if (r.candidateCode && r.v62Final != null) v62.set(r.candidateCode, r.v62Final);
  }
  const ex = stores.filter((s) => !s.excludedFromModel);
  const pick = (key: string) => {
    const c = candidates.find((x) => (x.name ?? "").includes(key))!;
    return { c, row: candRows.find((r) => r.input.storeCode === c.code)! };
  };

  it("(1) 셋을 나란히 — 어디서 갈리나", () => {
    console.log(`\n[남은 🔴 셋] 실험실 vs 운영 V62 (후보지 13곳 중앙 편차 -17%)`);
    console.log(`  후보지          자사PC  시급   주거1km   유동400   경쟁(셈)  경쟁(빠짐)  점유율  가동률   실험실     V62    편차`);
    for (const k of TARGETS) {
      const { c, row } = pick(k);
      const b = computeTextbook(row.input, full);
      const comps = (compsByCode.get(c.code) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음");
      const dropped = comps.filter((x) => !(Number(x.appliedPcCount ?? x.totalPcCount ?? 0) > 0));
      const v = v62.get(c.code) ?? null;
      const f400 = (c as unknown as Record<string, number | null>).floating400Avg;
      console.log(`  ${(c.name ?? "").trim().padEnd(14)}${String(row.input.pcCount).padStart(5)}대${String(row.input.hourlyRate).padStart(6)}원` +
        `${num(c.pop1km).padStart(9)}${num(f400).padStart(10)}` +
        `${String(comps.length - dropped.length).padStart(9)}곳${String(dropped.length).padStart(9)}곳` +
        `${((b.share ?? 0) * 100).toFixed(1).padStart(7)}%${((b.utilization ?? 0) * 100).toFixed(1).padStart(7)}%` +
        `${won(b.monthlyRevenue).padStart(9)}${won(v).padStart(9)}` +
        `${(v && b.monthlyRevenue ? ((b.monthlyRevenue / v - 1) * 100).toFixed(0) + "%" : "-").padStart(7)}`);
    }
    console.log(`\n  기존점 38곳 분포: 주거1km ${num(Math.min(...ex.map((s) => s.pop1km ?? Infinity)))}~${num(Math.max(...ex.map((s) => s.pop1km ?? 0)))}`);
    expect(TARGETS.length).toBe(3);
  });

  it("(2) 빠진 경쟁점을 채우면 얼마나 더 내려가나 — 구멍의 방향을 잰다", () => {
    // 대수가 빈 경쟁점에 **기존점 경쟁점의 중앙 대수**를 넣어 본다.
    // ⚠️ 값을 고르는 게 아니라 **구멍의 크기와 방향**을 재는 것이다. 산식은 안 고친다.
    const allIp = existingRows.flatMap((r) => (r.input.rivals ?? []).map((x) => x.ip)).filter((x) => x > 0).sort((a, b) => a - b);
    const medIp = allIp[Math.floor(allIp.length / 2)];
    console.log(`\n[빠진 경쟁점 채우기] 기존점 경쟁점 ${allIp.length}곳의 중앙 대수 = ${medIp}대를 임시로 넣어 본다`);
    console.log(`  ⚠️ 이 값을 채택하자는 게 아니다. **구멍이 예측을 얼마나 위로 밀고 있나**를 재는 것이다.`);
    console.log(`\n  후보지          지금 실험실   채우면      차이     빠진 곳(거리)`);
    for (const k of [...TARGETS, "신중동", "산본", "평택소사벌"]) {
      const { c, row } = pick(k);
      const comps = (compsByCode.get(c.code) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음");
      const dropped = comps.filter((x) => !(Number(x.appliedPcCount ?? x.totalPcCount ?? 0) > 0));
      if (!dropped.length) { console.log(`  ${(c.name ?? "").trim().padEnd(14)}${"빠진 경쟁점 없음".padStart(12)}`); continue; }
      const now = computeTextbook(row.input, full).monthlyRevenue;
      // 빠진 곳을 중앙 대수로 채운 입력. 품질은 모르면 자사와 같게 본다(산식의 기본 처리).
      const filled = {
        ...row.input,
        rivals: [
          ...(row.input.rivals ?? []),
          ...dropped.map((x) => ({ ip: medIp, distanceM: x.distanceM == null ? null : Number(x.distanceM), parts: null, name: x.name ?? null })),
        ],
      };
      const after = computeTextbook(filled, full).monthlyRevenue;
      console.log(`  ${(c.name ?? "").trim().padEnd(14)}${won(now).padStart(10)}${won(after).padStart(11)}` +
        `${(now && after ? ((after / now - 1) * 100).toFixed(1) + "%" : "-").padStart(9)}     ` +
        dropped.map((x) => `${x.distanceM}m`).join(","));
    }
    console.log(`\n  ⚠️ 차이가 크면 그 후보지의 실험실 값은 **경쟁점 대수 칸이 비어서 후해진 것**이다.`);
    console.log(`     고칠 방법은 둘 — (가) 현장에서 대수를 채운다 (나) 산식이 기본대수를 넣는다.`);
    console.log(`     (나)는 운영 V62가 이미 하는 일이다(미조사 500m 점포를 100대로 셈). 실험실만 안 한다.`);
    expect(medIp).toBeGreaterThan(0);
  });

  it("(2-b) 영월은 경쟁이 아니라 수요다 — 닮은 기존점에서 산식이 어떻게 하나", () => {
    // 영월은 경쟁점이 1곳뿐이고 점유율 100%다. 경쟁 항으로는 설명이 안 된다.
    // 수요가 기존점 범위 **밖**(주거 9,973명 < 최소 18,786명)이라 외삽이다.
    // 그럼 "범위 가장자리"의 기존점에서 산식이 어떻게 하는지가 유일한 단서다.
    const loo = new Map<string, number>();
    for (let i = 0; i < existingRows.length; i++) {
      const rest = existingRows.filter((_, k) => k !== i);
      const f = fittedParams(P, scoreTextbook(rest, P));
      const b = computeTextbook(existingRows[i].input, f);
      const a = existingRows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) loo.set(existingRows[i].input.storeName ?? "", (b.monthlyRevenue - a) / a);
    }
    const small = existingRows
      .map((r) => {
        const s = ex.find((x) => x.storeCode === r.input.storeCode);
        return { n: r.input.storeName ?? "", pop: s?.pop1km ?? null, err: loo.get(r.input.storeName ?? "") ?? null };
      })
      .filter((x) => x.pop != null && x.err != null)
      .sort((a, b) => (a.pop as number) - (b.pop as number));
    console.log(`\n[수요가 작은 기존점부터] 영월 후보지는 주거 9,973명 — 이 표 맨 위보다도 아래다`);
    console.log(`  매장              주거1km    LOO 오차(부호)`);
    for (const x of small.slice(0, 8)) {
      console.log(`  ${x.n.padEnd(16)}${num(x.pop).padStart(9)}${((x.err as number) * 100).toFixed(1).padStart(12)}%` +
        ((x.err as number) < -0.3 ? "  <- 크게 과소예측" : ""));
    }
    const low = small.slice(0, 8).map((x) => x.err as number);
    const all = small.map((x) => x.err as number);
    const spread = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), lo: Math.min(...v), hi: Math.max(...v) };
    };
    const L = spread(low), A2 = spread(all);
    console.log(`\n  수요 작은 8곳  평균 ${(L.m * 100).toFixed(1)}% · SD ${(L.sd * 100).toFixed(1)}%p · 범위 ${(L.lo * 100).toFixed(1)}~${(L.hi * 100).toFixed(1)}%`);
    console.log(`  전체 38곳      평균 ${(A2.m * 100).toFixed(1)}% · SD ${(A2.sd * 100).toFixed(1)}%p · 범위 ${(A2.lo * 100).toFixed(1)}~${(A2.hi * 100).toFixed(1)}%`);
    console.log(`\n  ⚠️ 읽을 때 조심할 것 — 평균만 보면 "작은 동네를 낮게 본다"로 읽히지만, **범위를 보면**`);
    console.log(`     **−51.9%부터 +28.8%까지 널뛴다.** 한쪽으로 쏠린 편향이 아니라 **분산이 큰 것**이다.`);
    console.log(`     즉 영월 예측은 "낮게 나왔으니 올리면 된다"가 아니라 **믿을 구간 자체가 없다**.`);
    console.log(`     같은 이유로 문경시청점이 오늘도 표본 최악(−51.9%)이다. 표본이 늘기 전엔 안 풀린다.`);
    expect(small.length).toBeGreaterThan(20);
  });

  it("(3) 셋을 낱개로 — 무엇이 끌어내렸나", () => {
    for (const k of TARGETS) {
      const { c, row } = pick(k);
      const b = computeTextbook(row.input, full);
      const v = v62.get(c.code) ?? null;
      const rec = c as unknown as Record<string, number | null>;
      console.log(`\n${"=".repeat(78)}`);
      console.log(`[${(c.name ?? "").trim()}] ${c.code} · ${c.address ?? ""}`);
      console.log(`  자사 ${row.input.pcCount}대 · 시급 ${row.input.hourlyRate}원 · 실험실 ${won(b.monthlyRevenue)} vs V62 ${won(v)}` +
        ` (${v && b.monthlyRevenue ? ((b.monthlyRevenue / v - 1) * 100).toFixed(0) + "%" : "-"})`);

      console.log(`\n  [수요] 주거1km ${num(c.pop1km)}명 · 유동400 ${num(rec.floating400Avg)}명 · 유동500 ${num(rec.floating500Avg)}명`);
      console.log(`         주거수요 ${num(b.residentDemandUsers)}명 · 유동수요 ${num(b.floatingDemandUsers)}명 · 총 ${num(b.totalDemandUsers)}명 -> ${won(b.totalDemandHours)}시간`);
      const popMin = Math.min(...ex.map((s) => s.pop1km ?? Infinity));
      if (c.pop1km != null && c.pop1km < popMin) {
        console.log(`         ⚠️ 주거 ${num(c.pop1km)}명은 기존점 최소 ${num(popMin)}명보다 적다 — **검증 안 된 구간의 외삽**이다.`);
      }
      console.log(`         특수수요 ${row.input.specialDemandType ?? "없음"} · 편심도 ${(rec.flowEccentricity ?? 0).toFixed(3)}`);

      const comps = (compsByCode.get(c.code) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음");
      const dropped = comps.filter((x) => !(Number(x.appliedPcCount ?? x.totalPcCount ?? 0) > 0));
      console.log(`\n  [경쟁] 등록 ${comps.length}곳 · 산식이 세는 곳 ${comps.length - dropped.length}곳 · **대수 없어 빠지는 곳 ${dropped.length}곳**`);
      for (const x of [...(row.input.rivals ?? [])].sort((a, b2) => (a.distanceM ?? 0) - (b2.distanceM ?? 0))) {
        const d = x.distanceM;
        const D = P.rivalDistanceDecay!;
        const w = (d == null || d <= D.plateauM ? 1 : Math.exp(-(d - D.plateauM) / D.scaleM)) * (D.weightFactor ?? 1);
        console.log(`    ${(x.name ?? "?").padEnd(24)}${(Math.round(d ?? 0) + "m").padStart(7)}${String(x.ip).padStart(6)}대  ${(w * 100).toFixed(0).padStart(3)}%로 셈`);
      }
      for (const x of dropped) {
        console.log(`    ${(x.name ?? "?").padEnd(24)}${(x.distanceM + "m").padStart(7)}     ?대  ⚠️ **대수 없음 — 안 세짐**  (${x.surveyLevel ?? "?"})`);
      }
      console.log(`  점유율 ${((b.share ?? 0) * 100).toFixed(1)}% · 입지배율 ${(b.locationMultiplier ?? 1).toFixed(3)} · 가동률 ${((b.utilization ?? 0) * 100).toFixed(1)}%${b.capped ? " (상한)" : ""}`);
      if (b.missing.length) console.log(`  ⚠️ 빠진 입력: ${b.missing.join(" · ")}`);
    }
    expect(TARGETS.length).toBe(3);
  });
});
