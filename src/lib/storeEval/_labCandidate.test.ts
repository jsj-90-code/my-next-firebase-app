// 신규후보지를 **실험실 교과서식 산식**으로 돌린다 (2026-09-18)
//
// ── 왜 이 하네스가 필요한가 ────────────────────────────────────────────────
// 그동안 실험실은 기존점만 봤다. 후보지는 실매출이 없어 **채점이 안 되지만 예측은 된다** —
// 축척은 이미 기존점에서 맞춰 뒀기 때문이다. 그런데 채점이 안 된다는 건 **틀려도 안 붉어진다**는
// 뜻이기도 하다. 그래서 여기서는 성적 대신 **"입력이 제대로 꽂혔는가"**를 본다.
//
// 실제로 2026-09-18에 후보지 PC수가 "0/12 자료없음"으로 읽혔던 적이 있다. 자료는 처음부터
// 다 있었고 **하네스가 기존점 필드명(pcCount)으로 후보지를 보고 있었다.** 후보지 필드는
// expectedPcCount다. 이런 건 성적으로 안 잡히고 이런 시험으로만 잡힌다.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────────
// 1) 입력 준비도 — 후보지 낱개로 어느 항목이 비었나
// 2) 예측이 실제로 나오나 — 조립한 행에 computeTextbook을 먹여 매출/가동률/점유율
// 3) 운영 V62와 나란히 — 두 산식이 얼마나 갈라지나 (어느 쪽이 맞다는 판정이 아니다)
// 4) 기존점과 자가 같은가 — 관리 점수·사양 점수가 같은 함수를 거쳤는지
//
// ⚠️ **측정만 한다.** 후보지엔 정답이 없으므로 여기 숫자로 계수를 고르면 안 된다.
//    계수는 기존점 채점(_textbookFull.test.ts)과 대조군이 정한다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_labCandidate.test.ts --disable-console-intercept

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  LAB_UPSIDE_STORE_CODES, buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  qscInWindowAverage, utilizationByStore, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeQualityScore, computeTextbook, fittedParams, scoreTextbook, type TextbookParams,
} from "./textbookModel";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const manwon = (v: number | null | undefined) =>
  v == null ? "      -" : `${Math.round(v / 10000).toLocaleString().padStart(6)}만`;
const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "    -" : `${(v * 100).toFixed(d).padStart(5)}%`;

describeIf("신규후보지 — 실험실 산식 경로", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];

  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const locByCode = new Map(locationEvaluations.map((l) => [l.candidateCode, l]));

  // ── 기존점에서 축척을 맞춘다. 후보지는 이 축척을 **그대로 받아 쓴다.** ──────────────
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, locationEvaluations, settings,
  );
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  // QSC — 화면·다른 하네스와 **같은 값**을 써야 관리 점수가 안 갈라진다(_textbookFull과 동일).
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
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

  // ⭐ 2026-09-24 — 고리 인구·항아리 판정을 **화면과 같은 자료**(스냅샷 컬렉션)로 싣는다. 안 넘기면
  //    λ800이 켜져 있어도 조용히 1km만 세서 "지금" 숫자가 뜻을 잃는다(handoff-20260927 규칙 6).
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) {
    const c = j.ringCutCount ?? j.blockedCount;
    if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c);
  }
  const existingRows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode });
  const P = { ...DEFAULT_TEXTBOOK_PARAMS };
  const score = scoreTextbook(existingRows, P);
  const full = fittedParams(P, score);
  const franchiseManagement = franchiseManagementFromRows(existingRows);

  const candRows = buildLabCandidateRows({
    candidates, compsByCode, locByCode, settings, franchiseManagement, residentRingsByCode, ringBlockedByCode,
  });

  // 옛 배선(2026-09-23 오전, 묶음 채택 전) — θ3 · 존구성 0.238 · 고리 꺼짐 · 배수 군부대 2.25만.
  // `_bundleCandidate` (0) 검산이 이 칸에서 자사 MAE 5.84%p를 재현한다. 후보지 옛/새 대조에 쓴다.
  const OLD: TextbookParams = {
    ...full, qualityExponent: 3, residentRingDecayM: 0, residentRingShare: "core", useRingEnclosure: false, ownShareCapK: 0,
    qualityWeights: { ...full.qualityWeights, zone: 0.238 },
    specialDemandMultipliers: { ...Object.fromEntries(Object.keys(full.specialDemandMultipliers).map((k) => [k, 1])), "군부대": 2.25 },
  };

  it("(1) 후보지 입력 준비도 — 낱개로 무엇이 비었나", () => {
    if (!candidates.length) { console.log("\n[후보지] 스냅샷에 후보지가 없다"); return; }
    const need: [string, (c: CandidateInput) => boolean, string][] = [
      // ⚠️ 후보지 PC수는 expectedPcCount다. 기존점 pcCount로 보면 전부 "자료없음"이 된다.
      ["PC수", (c) => c.expectedPcCount != null, "3단계 점유율 · 4단계 매출"],
      ["요금", (c) => c.hourlyRate != null, "4단계 단가"],
      ["주거 1km", (c) => c.pop1km != null, "1단계 수요"],
      ["유동 400m", (c) => c.floating400Avg != null, "1단계 수요 (확정 반경)"],
      ["유동 300m", (c) => c.floating300Avg != null, "2단계 중심도"],
      ["유동 1km", (c) => c.floating1000Avg != null, "2단계 중심도"],
      ["층·엘리베이터", (c) => c.floor != null, "2단계 접근성"],
      ["연령별 주거", (c) => c.age1km_20_29 != null, "1단계 연령가중"],
      ["자사 GPU", (c) => !!c.ownVgaBase, "3단계 사양"],
      ["자사 CPU", (c) => !!c.ownCpu, "3단계 사양"],
      ["자사 모니터", (c) => !!c.ownMonitorBase, "3단계 사양"],
      ["경쟁점 조사", (c) => (compsByCode.get(c.code)?.length ?? 0) > 0, "3단계 점유율"],
      ["입지평가(특수수요)", (c) => locByCode.has(c.code), "1단계 특수수요 배수"],
    ];
    console.log(`\n[후보지 ${candidates.length}곳 — 실험실 산식 입력 준비도]`);
    console.log("  항목                  갖춘 곳   쓰이는 곳");
    for (const [label, has, where] of need) {
      const missing = candidates.filter((c) => { try { return !has(c); } catch { return true; } });
      const n = candidates.length - missing.length;
      const mark = n === candidates.length ? "✅" : n === 0 ? "❌" : "⚠️";
      console.log(`  ${mark} ${label.padEnd(18)} ${String(n).padStart(2)}/${candidates.length}   ${where}`);
      if (missing.length && missing.length <= 4) {
        console.log(`       빠진 곳: ${missing.map((c) => `${c.code} ${c.name}`).join(" · ")}`);
      }
    }

    // 자사 시설 빈칸은 **결측이 아니라 표준 구성**이다 — 따로 세어서 보여준다.
    const stdFilled = candidates.filter((c) => c.ownTeamRoom == null).length;
    console.log(`\n  [표준 구성으로 채워지는 곳] 팀룸 미기입 ${stdFilled}/${candidates.length}곳`);
    console.log("     -> 결측이 아니다. 07 시트 '비우면 표준 N개 적용' 규칙(STANDARD_OWN_FACILITY_DEFAULTS).");
    // 팀룸 총좌석수 미기입은 **진짜 문제**다(개수x5로 환산되는데 실제는 룸당 3~4석).
    const noSeats = candidates.filter((c) => (c.ownTeamRoom ?? 0) > 0 && c.ownTeamRoomTotalSeats == null);
    console.log(`  [조사로 풀 일] 팀룸 총좌석수 미기입 ${noSeats.length}곳 — 개수x5는 약 40% 과대다`);

    console.log(`\n  [후보지에 원래 없는 둘]`);
    console.log(`     실측 가동률 — 예측 대상이다. 축척은 기존점 ${existingRows.length}곳에서 이미 맞췄다.`);
    console.log(`     QSC — 신규점은 점검 기록이 없다. 가맹점 평균 ${franchiseManagement?.toFixed(2) ?? "-"}점이 들어간다.`);
    expect(candRows.length).toBe(candidates.length);
  });

  it("(2) 예측이 실제로 나오나 — 조립한 행을 그대로 돌린다", () => {
    if (!candRows.length) return;
    console.log(`\n[실험실 예측] 축척: 1인 월 ${full.hoursPerUserPerMonth.toFixed(2)}시간 · ` +
      `상품몫 ${Math.round(full.productUnitPrice).toLocaleString()}원/PC·시간`);
    console.log("  코드    이름                 PC   예상매출   가동률  점유율  수요(명)  못 채운 것");
    let ok = 0;
    for (const r of candRows) {
      const b = computeTextbook(r.input, full);
      if (b.monthlyRevenue != null) ok++;
      console.log(
        `  ${r.input.storeCode.padEnd(6)} ${(r.input.storeName ?? "").slice(0, 18).padEnd(18)} ` +
        `${String(r.input.pcCount ?? "-").padStart(3)} ${manwon(b.monthlyRevenue)} ` +
        `${pct(b.utilization)} ${pct(b.share)} ` +
        `${(b.totalDemandUsers == null ? "-" : Math.round(b.totalDemandUsers).toLocaleString()).padStart(8)}  ` +
        `${b.missing.join(",") || "-"}`,
      );
    }
    console.log(`\n  예측이 나온 곳 ${ok}/${candRows.length}`);
    // 자료가 다 있는 후보지는 반드시 예측이 나와야 한다 — 하나도 안 나오면 경로가 끊긴 것이다.
    expect(ok).toBeGreaterThan(0);
  });

  it("(3) 운영 V62와 나란히 — 두 산식이 얼마나 갈라지나", () => {
    if (!candRows.length) return;
    // 저장된 평가결과(운영 V62)를 후보지코드로 이어붙인다. **비교 기준선일 뿐 정답이 아니다.**
    type V62Result = { candidateCode?: string; v62Final?: number | null };
    const v62 = new Map<string, number>(((snap.results ?? []) as V62Result[])
      .filter((r) => r?.candidateCode && r?.v62Final != null)
      .map((r) => [r.candidateCode as string, Number(r.v62Final)]));
    console.log(`\n[실험실 vs 운영 V62] 저장된 V62 결과 ${v62.size}건`);
    console.log("  코드    이름                 실험실     V62      차이");
    const diffs: number[] = [];
    for (const r of candRows) {
      const b = computeTextbook(r.input, full);
      const op = v62.get(r.input.storeCode) ?? null;
      const d = b.monthlyRevenue != null && op != null && op > 0
        ? (b.monthlyRevenue - op) / op : null;
      if (d != null) diffs.push(d);
      console.log(
        `  ${r.input.storeCode.padEnd(6)} ${(r.input.storeName ?? "").slice(0, 18).padEnd(18)} ` +
        `${manwon(b.monthlyRevenue)} ${manwon(op)} ` +
        `${d == null ? "     -" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`.padStart(7)}`,
      );
    }
    if (diffs.length) {
      const abs = diffs.map(Math.abs).sort((a, b) => a - b);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      console.log(`\n  짝지어진 ${diffs.length}곳 — 평균 편차 ${mean >= 0 ? "+" : ""}${(mean * 100).toFixed(1)}% ` +
        `(실험실이 ${mean >= 0 ? "높다" : "낮다"}) · 절대차 중앙 ${(abs[Math.floor(abs.length / 2)] * 100).toFixed(1)}%`);
      console.log("  ⚠️ 어느 쪽이 맞다는 판정이 아니다. 후보지엔 실매출이 없어 채점할 수 없다.");
    }
  });

  it("(4) 기존점과 같은 자를 쓰는가", () => {
    if (!candRows.length) return;
    const mg = candRows.map((r) => r.input.ownQualityParts?.management ?? null);
    const uniq = [...new Set(mg)];
    console.log(`\n[자 맞춤 점검]`);

    // ── QSC 가맹점 평균이 정확히 얼마인가 ────────────────────────────────────
    // 두 가지를 섞지 말 것: **원점수(0~100)**와 **환산한 관리 점수(1~5)**는 다른 수다.
    // 후보지에 들어가는 건 환산한 쪽이고, 평균도 **환산한 뒤에** 낸다
    // (먼저 평균 내고 환산하면 다른 값이 나온다 — 환산이 1~5로 잘리는 구간이 있어서).
    const raws = [...qscByStoreCode.values()];
    if (raws.length) {
      const rs = [...raws].sort((a, b) => a - b);
      const avgRaw = raws.reduce((a, b) => a + b, 0) / raws.length;
      console.log(`  QSC 원점수(0~100): 실측 ${raws.length}곳 · 평균 ${avgRaw.toFixed(2)} · ` +
        `중앙 ${rs[Math.floor(rs.length / 2)].toFixed(1)} · ${rs[0].toFixed(1)}~${rs[rs.length - 1].toFixed(1)}`);
      // 환산: 1 + (QSC-60) x (4/40), 1~5로 자름
      const conv = raws.map((v) => Math.max(1, Math.min(5, 1 + (v - 60) * 0.1)));
      const avgConv = conv.reduce((a, b) => a + b, 0) / conv.length;
      const cs = [...conv].sort((a, b) => a - b);
      console.log(`  -> 환산 관리 점수(1~5): 평균 ${avgConv.toFixed(3)} · ` +
        `${cs[0].toFixed(2)}~${cs[cs.length - 1].toFixed(2)} (1점/5점에 걸린 곳 ` +
        `${conv.filter((v) => v <= 1).length}/${conv.filter((v) => v >= 5).length}곳)`);
      // 환산이 1~5로 잘리는 구간에 걸린 매장이 있으면 "평균 낸 뒤 환산"과 "환산한 뒤 평균"이
      // 갈린다. 지금은 아무도 안 걸려서 같지만, 표본이 늘어 한 곳이라도 걸리면 갈라진다.
      const avgThenConv = Math.max(1, Math.min(5, 1 + (avgRaw - 60) * 0.1));
      const same = Math.abs(avgThenConv - avgConv) < 5e-4;
      console.log(`  순서 점검: 평균낸뒤환산 ${avgThenConv.toFixed(3)} vs 환산한뒤평균 ${avgConv.toFixed(3)} — ` +
        (same
          ? "지금은 같다(1점/5점에 걸린 매장이 없어서다). 걸리는 매장이 생기면 갈라진다."
          : "⚠️ 갈렸다. 쓰는 값은 환산한뒤평균이다."));
      console.log(`  (채점 대상 38곳 기준으로 다시 내면 ${franchiseManagement?.toFixed(3)} — ` +
        `실측 없는 매장이 평균을 받아 되먹임되므로 실측 ${raws.length}곳 평균과 조금 다르다)`);
    }
    console.log(`  후보지에 실제로 들어간 관리 점수: ${uniq.length}종 ${uniq.map((v) => v?.toFixed(3)).join(",")}`);
    // 후보지는 QSC가 없으니 **전부 같은 값(가맹점 평균)**이어야 한다. 갈라지면 어딘가에서
    // 저장된 ownManagementScore(4.00)가 새어 들어온 것이다.
    expect(uniq.length).toBe(1);
    if (franchiseManagement != null) expect(uniq[0]).toBeCloseTo(franchiseManagement, 6);

    // 사양 점수는 자사·경쟁점·기존점이 **같은 함수**(labComputeSpecScore)를 거쳐야 한다.
    const specs = candRows.map((r) => r.input.ownQualityParts?.spec ?? null)
      .filter((v): v is number => v != null);
    const exSpecs = existingRows.map((r) => r.input.ownQualityParts?.spec ?? null)
      .filter((v): v is number => v != null);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`  사양 점수: 후보지 ${specs.length}곳 평균 ${avg(specs).toFixed(2)} ` +
      `(${Math.min(...specs).toFixed(2)}~${Math.max(...specs).toFixed(2)}) vs ` +
      `기존점 ${exSpecs.length}곳 평균 ${avg(exSpecs).toFixed(2)}`);
    // 1~5 눈금 밖으로 나가면 어딘가에서 잣대가 어긋난 것이다.
    for (const v of specs) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(5); }

    // 경쟁력격차는 품질 모드에서 안 쓰인다 — 후보지가 null이어도 예측이 나와야 한다.
    expect(candRows.every((r) => r.input.competitivenessGap == null)).toBe(true);
  });

  it("(5) 실험실이 후보지에서 낮게 나오는 게 배선인가 산식인가", () => {
    if (!candRows.length) return;
    // (3)에서 실험실이 V62보다 평균 크게 낮게 나왔다. 두 가지로 갈린다:
    //   - **배선** — 후보지 입력이 기존점과 다른 자로 꽂혀 수요·점유율이 잘못 나온다
    //   - **산식** — 입력은 맞는데 두 산식이 원래 다르게 본다
    // 가르는 법: 기존점에서 **같은 산식**이 내는 중간값들과 후보지를 나란히 놓는다.
    // 기존점은 실측 가동률이 있으니 "실험실이 기존점에서 얼마나 맞히나"를 알고 있다.
    const per = <T,>(xs: T[], f: (x: T) => number | null) => {
      const vs = xs.map(f).filter((v): v is number => v != null && Number.isFinite(v));
      if (!vs.length) return null;
      const s = [...vs].sort((a, b) => a - b);
      return { n: vs.length, avg: vs.reduce((a, b) => a + b, 0) / vs.length, med: s[Math.floor(s.length / 2)] };
    };
    const exB = existingRows.map((r) => ({ r, b: computeTextbook(r.input, full) }));
    const caB = candRows.map((r) => ({ r, b: computeTextbook(r.input, full) }));
    const show = (label: string, ex: ReturnType<typeof per>, ca: ReturnType<typeof per>, d = 2) =>
      console.log(`  ${label.padEnd(22)} 기존점 ${ex ? ex.avg.toFixed(d).padStart(9) : "-"} ` +
        `| 후보지 ${ca ? ca.avg.toFixed(d).padStart(9) : "-"}` +
        `${ex && ca && ex.avg > 0 ? `   (후보지가 ${((ca.avg / ex.avg - 1) * 100).toFixed(0)}%)` : ""}`);

    console.log("\n[중간값 대조] 같은 산식·같은 축척으로 기존점과 후보지를 나란히 — 평균값");
    show("PC대수", per(exB, (x) => x.r.input.pcCount), per(caB, (x) => x.r.input.pcCount), 1);
    show("요금(원/시간)", per(exB, (x) => x.r.input.hourlyRate), per(caB, (x) => x.r.input.hourlyRate), 0);
    show("유동 400m", per(exB, (x) => x.r.input.floatingByRadius[400] ?? null), per(caB, (x) => x.r.input.floatingByRadius[400] ?? null), 0);
    show("주거 1km", per(exB, (x) => x.r.input.pop1km), per(caB, (x) => x.r.input.pop1km), 0);
    show("수요(명/월)", per(exB, (x) => x.b.totalDemandUsers), per(caB, (x) => x.b.totalDemandUsers), 0);
    show("수요 ÷ PC", per(exB, (x) => x.b.totalDemandUsers != null && x.r.input.pcCount ? x.b.totalDemandUsers / x.r.input.pcCount : null), per(caB, (x) => x.b.totalDemandUsers != null && x.r.input.pcCount ? x.b.totalDemandUsers / x.r.input.pcCount : null), 1);
    // ⚠️ 점유율 평균끼리 바로 견주면 안 된다 — 기존점엔 독점매장(경쟁IP=0, 점유율 1.0)이
    //    섞여 평균을 끌어올린다. 독점을 뺀 값도 같이 적는다.
    const notMono = <T extends { r: { input: { competitorIp: number | null } } }>(xs: T[]) =>
      xs.filter((x) => (x.r.input.competitorIp ?? 0) > 0);
    show("점유율", per(exB, (x) => x.b.share), per(caB, (x) => x.b.share), 3);
    show("  (독점 뺀 점유율)", per(notMono(exB), (x) => x.b.share), per(notMono(caB), (x) => x.b.share), 3);
    console.log(`  ${"  독점매장 수".padEnd(22)} 기존점 ${String(exB.length - notMono(exB).length).padStart(9)} ` +
      `| 후보지 ${String(caB.length - notMono(caB).length).padStart(9)}`);
    show("경쟁IP(합)", per(exB, (x) => x.r.input.competitorIp), per(caB, (x) => x.r.input.competitorIp), 0);
    show("유효거리 안 경쟁점", per(exB, (x) => (x.r.input.rivals ?? []).filter((v) => v.distanceM == null || v.distanceM <= full.effectiveRadiusM).length), per(caB, (x) => (x.r.input.rivals ?? []).filter((v) => v.distanceM == null || v.distanceM <= full.effectiveRadiusM).length), 1);
    show("자사 경쟁력(사양)", per(exB, (x) => x.r.input.ownQualityParts?.spec ?? null), per(caB, (x) => x.r.input.ownQualityParts?.spec ?? null));
    show("자사 경쟁력(존구성)", per(exB, (x) => x.r.input.ownQualityParts?.zone ?? null), per(caB, (x) => x.r.input.ownQualityParts?.zone ?? null));
    show("자사 경쟁력(관리)", per(exB, (x) => x.r.input.ownQualityParts?.management ?? null), per(caB, (x) => x.r.input.ownQualityParts?.management ?? null));
    show("입지 배율", per(exB, (x) => x.b.locationMultiplier), per(caB, (x) => x.b.locationMultiplier), 3);
    show("예측 가동률", per(exB, (x) => x.b.utilization), per(caB, (x) => x.b.utilization), 3);
    show("실측 가동률", per(exB, (x) => x.r.input.actualUtilization), null, 3);

    // 기존점에서 실험실이 매출을 얼마나 치우쳐 보는지 — 후보지 편차를 읽는 기준선이다.
    const bias = per(exB, (x) => x.b.monthlyRevenue != null && x.r.actualRevenue > 0
      ? x.b.monthlyRevenue / x.r.actualRevenue - 1 : null);
    console.log(`\n  기존점에서 실험실의 매출 치우침: 평균 ${bias ? `${(bias.avg * 100).toFixed(1)}%` : "-"} ` +
      `(중앙 ${bias ? `${(bias.med * 100).toFixed(1)}%` : "-"}) — 실매출 대비`);
    console.log("  ⚠️ 후보지 V62 대비 편차에서 이 치우침만큼은 원래 있던 것이다. 나머지가 설명할 몫이다.");
  });

  it("(6) 유동인구가 비면 얼마나 깎이나 — 빈칸은 중립이 아니다", () => {
    if (!candRows.length) return;
    // ⚠️ **유동인구 빈칸은 중립이 아니다.** 수요는 덧셈 구조라(주거 + 유동x0.15) 유동이
    //    없으면 그 몫이 **0으로 더해진다.** 입지 중심도(유동 300m ÷ 유동 1km)도 같이 빠진다.
    //    이 파일의 다른 항목들("모르면 1배로 빼기")과 성질이 다르므로 따로 잰다.
    //
    // 2026-09-18 구리돌다리점(N015)이 실제로 이 상태로 들어왔다. 예측은 나오는데
    // **말없이 낮다** — missing 열에만 적히고 숫자는 그럴듯해서 놓치기 쉽다.
    const missingFlow = candRows.filter((r) => r.input.floatingByRadius[full.floatingRadius] == null);
    const haveFlow = candRows.filter((r) => r.input.floatingByRadius[full.floatingRadius] != null);
    if (!haveFlow.length) return;

    // 유동이 있는 곳에서 유동 몫이 수요의 몇 %인지 — 빈 곳이 잃는 몫의 크기다.
    const shares: number[] = [];
    for (const r of haveFlow) {
      const b = computeTextbook(r.input, full);
      const base = (b.residentDemandUsers ?? 0) + (b.floatingDemandUsers ?? 0);
      if (base > 0 && b.floatingDemandUsers != null) shares.push(b.floatingDemandUsers / base);
    }
    const avgShare = shares.reduce((a, b) => a + b, 0) / shares.length;
    const srt = [...shares].sort((a, b) => a - b);
    console.log(`\n[유동인구 빈칸의 값어치] 유동이 있는 ${haveFlow.length}곳 기준`);
    console.log(`  수요 중 유동 몫: 평균 ${(avgShare * 100).toFixed(1)}% · ` +
      `중앙 ${(srt[Math.floor(srt.length / 2)] * 100).toFixed(1)}% · ` +
      `${(srt[0] * 100).toFixed(1)}~${(srt[srt.length - 1] * 100).toFixed(1)}%`);

    if (!missingFlow.length) { console.log("  ✅ 유동인구가 빈 후보지는 없다."); return; }
    console.log(`\n  [유동이 빈 ${missingFlow.length}곳] 지금 값은 그 몫이 통째로 빠진 값이다`);
    for (const r of missingFlow) {
      const now = computeTextbook(r.input, full);
      // 같은 동네 후보지들의 "유동 ÷ 주거" 비로 유동을 메워 본 값 — **채택하는 값이 아니라
      // 빈칸의 크기를 보여주는 눈금이다.** 실제로는 소상공인365에서 받아 채워야 한다.
      const ratios = haveFlow
        .map((h) => {
          const f = h.input.floatingByRadius[full.floatingRadius];
          return f != null && h.input.pop1km ? f / h.input.pop1km : null;
        })
        .filter((v): v is number => v != null);
      const medRatio = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
      const guessFlow = r.input.pop1km != null ? r.input.pop1km * medRatio : null;
      const patched = guessFlow == null ? null : computeTextbook({
        ...r.input,
        floatingByRadius: { ...r.input.floatingByRadius, [full.floatingRadius]: guessFlow },
      }, full);
      const up = patched?.monthlyRevenue != null && now.monthlyRevenue != null && now.monthlyRevenue > 0
        ? patched.monthlyRevenue / now.monthlyRevenue - 1 : null;
      console.log(`  ${r.input.storeCode} ${r.input.storeName ?? ""} — 지금 ${manwon(now.monthlyRevenue)}` +
        `  |  또래 비율로 메우면 ${manwon(patched?.monthlyRevenue)}` +
        `${up == null ? "" : ` (+${(up * 100).toFixed(0)}%)`}`);
      console.log(`     ⚠️ 메운 값은 **눈금일 뿐 채택값이 아니다.** 유동 400m/300m/1km를 실제로 받아 채울 것.`);
      console.log(`     ⚠️ 중심도(유동 300m ÷ 1km)도 같이 빠져 입지 배율이 ${now.locationMultiplier?.toFixed(3) ?? "-"}에 머문다.`);
    }
  });

  it("(7) 한 곳 상세 — 평가 코멘트에 쓸 근거를 통째로 찍는다", () => {
    // 평가기록 코멘트([상권]/[경쟁]/[종합 의견])를 쓰려면 **산식이 실제로 무엇을 보고
    // 그 숫자를 냈는지**가 필요하다. 요약표만 보고 쓰면 "느낌"이 섞인다.
    //
    //   LAB_CANDIDATE=N015 npx vitest run src/lib/storeEval/_labCandidate.test.ts --disable-console-intercept
    //
    // ⚠️ 여기 찍힌 것만 근거로 쓴다. 안 찍힌 건 산식이 안 본 것이므로 코멘트에도 넣지 않는다.
    const want = process.env.LAB_CANDIDATE?.trim();
    const picks = want ? candRows.filter((r) => r.input.storeCode === want) : candRows;
    if (!picks.length) { console.log(`\n[상세] ${want ?? ""} 해당 후보지가 없다`); return; }

    for (const r of picks) {
      const b = computeTextbook(r.input, full);
      const c = r.candidate;
      const oq = r.input.ownQualityParts ? computeQualityScore(r.input.ownQualityParts, full.qualityWeights) : null;
      console.log(`\n${"=".repeat(78)}`);
      console.log(`[상세] ${r.input.storeCode} ${r.input.storeName} · ${c.address ?? ""}`);
      console.log(`${"=".repeat(78)}`);

      console.log(`\n-- 1단계 수요 --`);
      console.log(`  주거 1km ${c.pop1km?.toLocaleString() ?? "-"}명 · 500m ${c.pop500m?.toLocaleString() ?? "-"}명`);
      console.log(`  유동 ${full.floatingRadius}m ${r.input.floatingByRadius[full.floatingRadius]?.toLocaleString() ?? "-"}명 (유동계수 ${full.floatingFactor})`);
      console.log(`  -> 주거수요 ${b.residentDemandUsers == null ? "-" : Math.round(b.residentDemandUsers).toLocaleString()}명` +
        ` + 유동수요 ${b.floatingDemandUsers == null ? "-" : Math.round(b.floatingDemandUsers).toLocaleString()}명`);
      console.log(`  특수수요: ${r.input.specialDemandType ?? "없음"} · 조사 경쟁점 ${r.input.competitorCount ?? 0}곳(흡인력 항)`);
      console.log(`  => 총수요 ${b.totalDemandUsers == null ? "-" : Math.round(b.totalDemandUsers).toLocaleString()}명/월` +
        ` · ${b.totalDemandHours == null ? "-" : Math.round(b.totalDemandHours).toLocaleString()}시간/월`);

      console.log(`\n-- 2단계 입지 (점유율에 곱한다) --`);
      const cen = r.input.location?.centrality;
      console.log(`  상권 중심도 ${cen == null ? "-" : cen.toFixed(3)} (유동300m ÷ 유동1km × (1000/300)²; 1보다 크면 문 앞이 빽빽)`);
      console.log(`     유동 300m ${c.floating300Avg?.toLocaleString() ?? "-"} · 1km ${c.floating1000Avg?.toLocaleString() ?? "-"}`);
      console.log(`  접근성 ${r.input.location?.access?.toFixed(2) ?? "-"} (층 ${c.floor ?? "-"} · ${c.groundLevel ?? "-"} · 엘리베이터 ${c.hasElevator === true ? "있음" : c.hasElevator === false ? "없음" : "-"})`);
      console.log(`  => 입지 배율 ${b.locationMultiplier?.toFixed(4) ?? "-"}` +
        (b.locationFactors.length ? `  [${b.locationFactors.map((f) => `${f.key} ${f.value.toFixed(4)}`).join(" · ")}]` : ""));

      console.log(`\n-- 3단계 점유율 --`);
      console.log(`  자사 PC ${r.input.pcCount ?? "-"}대 · 자사 경쟁력 ${oq?.toFixed(3) ?? "-"}`);
      const qp = r.input.ownQualityParts;
      if (qp) {
        console.log(`     사양 ${qp.spec?.toFixed(2) ?? "-"} · 존구성 ${qp.zone?.toFixed(2) ?? "-"} · 먹거리 ${qp.food?.toFixed(2) ?? "-"}` +
          ` · 인테리어 ${qp.interior?.toFixed(2) ?? "-"} · 관리 ${qp.management?.toFixed(2) ?? "-"}(가맹점 평균)`);
      }
      const rivals = (r.input.rivals ?? []).map((v) => ({
        ...v, q: v.parts ? computeQualityScore(v.parts, full.qualityWeights) : null,
        inRange: v.distanceM == null || v.distanceM <= full.effectiveRadiusM,
      }));
      console.log(`  경쟁점 ${rivals.length}곳 (유효거리 ${full.effectiveRadiusM}m 안 ${rivals.filter((v) => v.inRange).length}곳이 실제로 겨룬다)`);
      for (const v of rivals.sort((a, x) => (a.distanceM ?? 9e9) - (x.distanceM ?? 9e9))) {
        console.log(`     ${v.inRange ? "●" : "○"} ${String(Math.round(v.distanceM ?? 0)).padStart(4)}m  PC ${String(v.ip).padStart(3)}대  경쟁력 ${v.q?.toFixed(3) ?? "-"}` +
          `  (자사 대비 ${oq && v.q ? `${((v.q / oq - 1) * 100).toFixed(0)}%` : "-"})`);
      }
      const inR = rivals.filter((v) => v.inRange && v.q != null);
      if (inR.length && oq) {
        const avgQ = inR.reduce((a, v) => a + (v.q as number), 0) / inR.length;
        console.log(`  유효거리 안 경쟁점 평균 경쟁력 ${avgQ.toFixed(3)} · 자사 ${oq.toFixed(3)} -> ${oq >= avgQ ? "자사 우위" : "자사 열위"} (${((oq / avgQ - 1) * 100).toFixed(1)}%)`);
      }
      console.log(`  => 점유율 ${b.share == null ? "-" : (b.share * 100).toFixed(1)}%` +
        ` · 자사 이용시간 ${b.ownDemandHours == null ? "-" : Math.round(b.ownDemandHours).toLocaleString()}시간/월`);

      console.log(`\n-- 4단계 매출 --`);
      console.log(`  정가 ${c.hourlyRate?.toLocaleString() ?? "-"}원/시간 -> PC몫 ${b.pcUnitPrice == null ? "-" : Math.round(b.pcUnitPrice).toLocaleString()}원` +
        ` + 상품몫 ${Math.round(full.productUnitPrice).toLocaleString()}원 = 총단가 ${b.unitPrice == null ? "-" : Math.round(b.unitPrice).toLocaleString()}원/PC·시간`);
      console.log(`  예상 가동률 ${b.utilization == null ? "-" : (b.utilization * 100).toFixed(1)}%` +
        `${b.capped ? ` (상한 ${(full.maxUtilization * 100).toFixed(0)}%에 걸렸다)` : ""}`);
      console.log(`  => 예상 월매출 ${b.monthlyRevenue == null ? "-" : Math.round(b.monthlyRevenue).toLocaleString()}원 (${manwon(b.monthlyRevenue)})`);
      if (b.missing.length) console.log(`  ⚠️ 자료없음: ${b.missing.join(", ")}`);

      // ── 정가가 매출에 얼마를 보탰나 ──────────────────────────────────────
      // 정가는 **총단가에만** 들어가고 이용시간(가동률)에는 안 들어간다. 그래서 매출은
      // 총단가에 정확히 비례한다 — "정가를 평균으로 바꾸면 얼마가 되나"를 바로 잴 수 있다.
      // ⚠️ 상한에 걸린 매장은 이 비례가 깨진다(이용시간이 잘려서다). 걸리면 같이 적는다.
      const rate = r.input.hourlyRate;
      if (rate != null && b.monthlyRevenue != null) {
        const rates = (xs: { input: { hourlyRate: number | null } }[]) =>
          xs.map((x) => x.input.hourlyRate).filter((v): v is number => v != null);
        const exRates = rates(existingRows), caRates = rates(candRows);
        const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
        const pctile = (xs: number[], v: number) => xs.filter((x) => x < v).length / xs.length;
        const bases: [string, number][] = [
          ["기존 가맹점 평균", mean(exRates)],
          ["후보지 평균", mean(caRates)],
          ["산식 기준정가", full.referenceHourlyRate],
        ];
        console.log(`\n-- 정가 ${rate.toLocaleString()}원이 매출에 보탠 몫 --`);
        console.log(`  견줄 값            정가차이     총단가          매출        이 매장이 더 번 몫`);
        for (const [label, baseRate] of bases) {
          const alt = computeTextbook({ ...r.input, hourlyRate: baseRate }, full);
          if (alt.unitPrice == null || alt.monthlyRevenue == null || b.unitPrice == null) continue;
          console.log(`  ${label.padEnd(16)} ${`${((rate / baseRate - 1) * 100).toFixed(1)}%`.padStart(7)}  ` +
            `${Math.round(alt.unitPrice).toLocaleString()} -> ${Math.round(b.unitPrice).toLocaleString()}원 ` +
            `(${((b.unitPrice / alt.unitPrice - 1) * 100).toFixed(1).padStart(5)}%)  ` +
            `${manwon(alt.monthlyRevenue)} -> ${manwon(b.monthlyRevenue)}  ` +
            `+${manwon(b.monthlyRevenue - alt.monthlyRevenue)}`);
        }
        console.log(`  정가 위치: 기존 가맹점 38곳 중 상위 ${((1 - pctile(exRates, rate)) * 100).toFixed(0)}% ` +
          `(${Math.min(...exRates).toLocaleString()}~${Math.max(...exRates).toLocaleString()}원) · ` +
          `후보지 12곳 중 상위 ${((1 - pctile(caRates, rate)) * 100).toFixed(0)}% ` +
          `(${Math.min(...caRates).toLocaleString()}~${Math.max(...caRates).toLocaleString()}원)`);

        // ── 이 상권의 경쟁점 요금과 견준다 (2026-09-18) ────────────────────
        // ⚠️ **산식은 경쟁점 요금을 안 읽는다**(calc.ts·textbookModel.ts 어디에도 없다).
        //    그래도 여기 찍는 이유는 "자사 정가를 실제로 받을 수 있나"가 예측값이 아니라
        //    **이 판단으로 갈리기** 때문이다. 전국 평균보다 옆집이 훨씬 중요하다.
        const localRates = (compsByCode.get(r.candidate.code) ?? [])
          .filter((x) => x.investigationStatus !== "경쟁점없음")
          .map((x) => ({ name: x.name ?? "", d: x.distanceM, min: x.ratePer1000Won, h: x.hourlyRateConverted }))
          .filter((x): x is { name: string; d: number | null; min: number; h: number } => x.min != null && x.h != null);
        if (localRates.length) {
          const avgLocal = localRates.reduce((a, x) => a + x.h, 0) / localRates.length;
          console.log(`  이 상권 경쟁점 요금:`);
          for (const x of localRates.sort((a, y) => (a.d ?? 9e9) - (y.d ?? 9e9))) {
            console.log(`     ${String(Math.round(x.d ?? 0)).padStart(4)}m ${x.name.padEnd(18)} ` +
              `1,000원/${x.min}분 = ${x.h.toLocaleString()}원/시간 (자사 대비 ${((x.h / rate - 1) * 100).toFixed(0)}%)`);
          }
          console.log(`     경쟁점 평균 ${Math.round(avgLocal).toLocaleString()}원 · 자사 ${rate.toLocaleString()}원 ` +
            `-> 자사가 ${((rate / avgLocal - 1) * 100).toFixed(1)}%`);
          console.log(`     ⚠️ 경쟁점 요금은 산식에 안 들어간다. "이 정가를 받을 수 있나"를 사람이 볼 때만 쓴다.`);
        }
        console.log(`  ⚠️ 정가 차이가 매출 차이로 **그대로 안 간다** — β=${full.rateElasticity}로 눌리고,` +
          ` 상품몫 ${Math.round(full.productUnitPrice).toLocaleString()}원은 요금과 무관하다.`);
        if (b.capped) console.log(`  ⚠️ 이 매장은 가동률 상한에 걸려 있어 위 비례가 정확하지 않다.`);
        // ⚠️ **외삽 경고.** β는 기존점 정가 범위 안에서 잰 값이다. 그 밖의 정가를 넣으면
        //    "재본 적 없는 구간"으로 밀어 넣는 것이라, 눌림이 맞는지 아무도 확인한 적이 없다.
        //    2026-09-18 구리돌다리점 2,000원이 실제로 이 경우였다(기존점 최고 1,800원).
        const exMin = Math.min(...exRates), exMax = Math.max(...exRates);
        if (rate > exMax || rate < exMin) {
          console.log(`  🔴 **외삽이다** — 기존 가맹점 정가는 ${exMin.toLocaleString()}~${exMax.toLocaleString()}원인데 ` +
            `이 매장은 ${rate.toLocaleString()}원이라 그 밖이다.`);
          console.log(`     β=${full.rateElasticity}는 그 범위 **안에서** 잰 값이라, 이 구간에서도 맞는지는 확인된 바 없다.`);
          console.log(`     정액권 할인이 정가에 비례해 더 커지면 실제 실수령은 여기 예측보다 낮을 수 있다.`);
        }
      }
    }
  });

  it("(8) ⭐ 옛 배선(1km만) vs 새 기본값(고리) — 후보지 13곳 나란히 · 자사는 라벨 뺀 성적", () => {
    // ── 사용자(2026-09-24): *"상권 늘리니까 매출 낮은 매장이 확 뛰어올라서 맛탱이가 가버렸어.
    //    차라리 1키로/300인가 400인가 그거 하고 튀는 매장들 버리는 건 어떤데, 검증이 불가한 곳"*
    //    → 되돌리기 전에 (a) 후보지가 어디서 갈라지는지 (b) 기전 확인 매장을 빼고도 옛이 나은지를 본다.
    // ⚠️ 축척(8.20h)은 고정이라 매장을 빼도 **후보지 예측은 안 바뀐다.** 빼기는 성적표에만 작용한다.
    //    그래서 "빼기"가 아니라 "라벨"로 둔다 — 걸러낸 자료로 검증하면 항상 통과한다(memory).
    if (!candRows.length) return;
    const pctp = (v: number | null | undefined) => (v == null ? "    -" : `${(v * 100).toFixed(1).padStart(5)}`);
    type V62Result = { candidateCode?: string; v62Final?: number | null; v62ImpliedUtilization?: number | null; expectedUtilization?: number | null };
    const v62 = new Map<string, V62Result>(((snap.results ?? []) as V62Result[]).filter((r) => r?.candidateCode).map((r) => [r.candidateCode as string, r]));

    console.log(`\n[후보지 13곳 — 옛 배선(θ3·존.238·1km만) vs 새 기본값(θ${full.qualityExponent}·존 ${full.qualityWeights.zone}·λ${full.residentRingDecayM} ${full.residentRingShare}·항아리 ${full.useRingEnclosure ? "켬" : "끔"})]`);
    console.log(`  가동률(%) · 고리배율 = 주거 이용자(고리 포함) ÷ 1km만 · 컷 = 항아리로 막힌 방향 수 · V62는 저장된 운영 결과(참고)`);
    console.log(`  코드   이름            PC  요금  특수      경쟁  주거1km  고리배율 컷 | 옛가동률  새가동률   차이 | 옛매출  새매출  V62매출`);
    const rowsOut: { code: string; name: string; old: number | null; neu: number | null; ratio: number | null; comps: number; pop: number | null }[] = [];
    for (const r of candRows) {
      const bo = computeTextbook(r.input, OLD), bn = computeTextbook(r.input, full);
      const b1 = computeTextbook(r.input, { ...full, residentRingDecayM: 0 });
      const ratio = bn.residentDemandUsers && b1.residentDemandUsers ? bn.residentDemandUsers / b1.residentDemandUsers : null;
      const c = r.candidate, v = v62.get(r.input.storeCode);
      const d = bo.utilization != null && bn.utilization != null ? bn.utilization - bo.utilization : null;
      rowsOut.push({ code: r.input.storeCode, name: r.input.storeName ?? "", old: bo.utilization, neu: bn.utilization, ratio, comps: r.input.competitorCount ?? 0, pop: c.pop1km ?? null });
      console.log(`  ${r.input.storeCode.padEnd(5)} ${(r.input.storeName ?? "").trim().slice(0, 8).padEnd(8)}` +
        ` ${String(r.input.pcCount ?? "-").padStart(4)} ${String(c.hourlyRate ?? "-").padStart(5)} ${(r.input.specialDemandType ?? "없음").slice(0, 4).padEnd(5)}` +
        ` ${String(r.input.competitorCount ?? 0).padStart(4)} ${String(c.pop1km ?? "-").padStart(8)}` +
        ` ${ratio == null ? "    -" : `×${ratio.toFixed(2)}`.padStart(6)} ${String(r.input.ringBlockedDirections ?? "-").padStart(2)} |` +
        ` ${pctp(bo.utilization)}%   ${pctp(bn.utilization)}%  ${d == null ? "    -" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}`.padStart(6)} |` +
        ` ${manwon(bo.monthlyRevenue)} ${manwon(bn.monthlyRevenue)} ${manwon(v?.v62Final)}` +
        `${bn.capped ? " (상한)" : ""}${bn.missing.length ? `  못 채움: ${bn.missing.join(",")}` : ""}`);
    }
    const paired = rowsOut.filter((x) => x.old != null && x.neu != null) as { old: number; neu: number; ratio: number | null; comps: number; pop: number | null; name: string }[];
    if (paired.length) {
      const diffs = paired.map((x) => x.neu - x.old);
      const m = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const up = paired.filter((x) => x.neu - x.old > 0.03), down = paired.filter((x) => x.neu - x.old < -0.03);
      console.log(`\n  짝 ${paired.length}곳 — 새가 평균 ${m >= 0 ? "+" : ""}${(m * 100).toFixed(1)}%p · 3%p 이상 오른 곳 ${up.length}(${up.map((x) => x.name.trim()).join("·")}) · 내린 곳 ${down.length}(${down.map((x) => x.name.trim()).join("·")})`);
      // 어디서 갈라지나 — 밀집(주거 1km 큼·경쟁 많음)인가, 유일 상권(경쟁 1~2)인가
      const dense = paired.filter((x) => (x.pop ?? 0) >= 70000), sparse = paired.filter((x) => x.comps <= 2);
      const avg = (g: typeof paired) => (g.length ? g.reduce((a, x) => a + (x.neu - x.old), 0) / g.length : NaN);
      console.log(`  밀집(주거 1km ≥ 7만) ${dense.length}곳 평균 ${(avg(dense) * 100).toFixed(1)}%p · 경쟁 2곳 이하 ${sparse.length}곳 평균 ${(avg(sparse) * 100).toFixed(1)}%p`);
    }

    // ── 자사 37곳 — 라벨 뺀 성적 (옛 vs 새) ───────────────────────────────────
    // 라벨: 기전이 현장에서 확인된 곳. 송도(오픈 후 경쟁점 500원 요금전쟁 — 점유율에 요금 항이 없다) ·
    //       구미산동(운영 부진 — QSC 반영분 밖) · 동탄북광장(운영관리, LabRow.excludedReason) · 전대후문(대학가
    //       배수 — 자사·경쟁점 같이 과소). 문경시청은 이유를 모르므로 라벨 **안** 단다.
    const LABELED = ["송도", "구미산동", "동탄북광장", "전대후문"];
    const own = existingRows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const errs = (p: TextbookParams, rows: typeof own) => rows.map((r) => ({ r, e: (computeTextbook(r.input, p).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
    const summary = (label: string, xs: { e: number }[]) => {
      const abs = xs.map((x) => Math.abs(x.e));
      const mae = abs.reduce((a, b) => a + b, 0) / abs.length, bias = xs.reduce((a, x) => a + x.e, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, x) => a + (x.e - bias) ** 2, 0) / xs.length);
      console.log(`  ${label.padEnd(24)} n=${String(xs.length).padStart(2)}  MAE ${(mae * 100).toFixed(2)}%p  편향 ${bias >= 0 ? "+" : ""}${(bias * 100).toFixed(1)}%p  오차SD ${(sd * 100).toFixed(1)}  ±5%p ${abs.filter((a) => a <= 0.05).length}  ±10%p ${abs.filter((a) => a <= 0.10).length}`);
      return mae;
    };
    const isLabeled = (r: typeof own[number]) => LABELED.some((k) => (r.input.storeName ?? "").includes(k));
    const kept = own.filter((r) => !isLabeled(r)), dropped = own.filter(isLabeled);
    console.log(`\n[자사 — 라벨 뺀 성적] 라벨(기전 확인) ${dropped.length}곳: ${dropped.map((r) => r.input.storeName).join(" · ")}`);
    const oAll = summary("옛 배선   · 전체", errs(OLD, own)), nAll = summary("새 기본값 · 전체", errs(full, own));
    const oKept = summary("옛 배선   · 라벨 뺌", errs(OLD, kept)), nKept = summary("새 기본값 · 라벨 뺌", errs(full, kept));
    // 라벨 뺀 표본에서 짝지은 차이의 2SE — 옛/새 차이가 잡음 안인지
    const oe = errs(OLD, kept), ne = errs(full, kept);
    const dd = oe.map((x, i) => Math.abs(ne[i].e) - Math.abs(x.e));
    const dm = dd.reduce((a, b) => a + b, 0) / dd.length, dsd = Math.sqrt(dd.reduce((a, b) => a + (b - dm) ** 2, 0) / dd.length);
    console.log(`  라벨 뺀 표본에서 새−옛 MAE 차 ${((nKept - oKept) * 100).toFixed(2)}%p (2SE ${(2 * dsd / Math.sqrt(dd.length) * 100).toFixed(2)}) · 전체 ${((nAll - oAll) * 100).toFixed(2)}%p`);
    console.log(`  라벨 매장만 (옛→새 오차):`);
    for (const r of dropped) {
      const eo = (computeTextbook(r.input, OLD).utilization ?? NaN) - (r.input.actualUtilization as number);
      const en = (computeTextbook(r.input, full).utilization ?? NaN) - (r.input.actualUtilization as number);
      console.log(`     ${(r.input.storeName ?? "").padEnd(10)} 실측 ${((r.input.actualUtilization as number) * 100).toFixed(1)}%  옛 ${eo >= 0 ? "+" : ""}${(eo * 100).toFixed(1)} → 새 ${en >= 0 ? "+" : ""}${(en * 100).toFixed(1)}`);
    }
    console.log(`  ⚠️ 여기 성적은 자사 잣대 하나다. 경쟁점 47곳 편향(옛 −11%p / 새 −2%p)·자사우위(옛 3.5배 / 새 1.65배, 실측 1.74)는 _bundleCandidate (0)에 있다.`);
    expect(paired.length).toBeGreaterThan(0);
  });

  it("(9) ⭐ 특수수요 배수가 40곳 전체에 어떻게 맞나 — 재고 표(_bundleCandidate (7), 경쟁점 있는 37곳) 밖 매장 포함", () => {
    // 사용자(2026-09-24 퇴근 직전): *"특수수요 보정 어케 넣었냐? 탕정역 가동률 +20 뜨네"* — 탕정역은 500m 안 경쟁점이 없어
    // _bundleCandidate 주인공(37곳)에 안 들어간다. 배수는 그 37곳 안의 유형별 매장으로 골랐는데, 화면 40곳엔 밖 매장도 있다.
    const own = existingRows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const types = [...new Set(own.map((r) => r.input.specialDemandType ?? "없음"))].filter((t) => (full.specialDemandMultipliers[t] ?? 1) !== 1);
    console.log(`\n[특수수요 유형별 · 자사 ${own.length}곳 전체] 오차 = 예측 − 실측 %p. 경쟁 = 500m 안 조사 경쟁점 수(0이면 재고 표 밖)`);
    for (const t of types) {
      const m = full.specialDemandMultipliers[t] ?? 1;
      const p1: TextbookParams = { ...full, specialDemandMultipliers: { ...full.specialDemandMultipliers, [t]: 1 } };
      const g = own.filter((r) => (r.input.specialDemandType ?? "없음") === t);
      console.log(`  ── ${t} ×${m} (${g.length}곳) ──`);
      for (const r of g) {
        const a = r.input.actualUtilization as number;
        const e1 = (computeTextbook(r.input, p1).utilization ?? NaN) - a, eN = (computeTextbook(r.input, full).utilization ?? NaN) - a;
        const nComp = (r.input.rivals ?? []).filter((v) => (v.distanceM ?? 9e9) <= 500).length;
        console.log(`     ${(r.input.storeName ?? "").padEnd(12)} 실측 ${(a * 100).toFixed(1).padStart(5)}%  ×1.0 ${(e1 * 100).toFixed(1).padStart(6)}  ×${m} ${(eN * 100).toFixed(1).padStart(6)}   경쟁 ${nComp}${nComp === 0 ? "  ← 재고 표 밖" : ""}`);
      }
      const bias = (p: TextbookParams) => mean(g.map((r) => (computeTextbook(r.input, p).utilization ?? NaN) - (r.input.actualUtilization as number)));
      console.log(`     평균 편향  ×1.0 ${(bias(p1) * 100).toFixed(1)}%p → ×${m} ${(bias(full) * 100).toFixed(1)}%p`);
    }
    expect(own.length).toBeGreaterThan(30);
  });

  it("(10) ⭐⭐⭐ 특수수요 배수 재고 표 — 자사 40곳 성적과 후보지 13곳 가동률을 배수 조합별로 나란히", () => {
    // 사용자(2026-09-24 집): *"신규후보지 호구포역점, 오송점 예상매출이 많이 높아져가지고, 산업단지에 해당하는 매장인것같은데
    //    이거좀 배수없애던가 하는거 고려해야할듯."*
    // 배수는 수요에 곱하고 점유율은 수요와 무관하므로 **그 유형 매장 가동률이 정확히 ×배수**가 된다(상한에 걸리지 않는 한).
    // 자사에서 고른 배수가 후보지에서 어떻게 보이는지 조합별로 찍는다. 채택은 사용자 몫 — 추천은 아래 "읽는 법"에.
    if (!candRows.length) return;
    const own = existingRows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const NOW = full.specialDemandMultipliers;
    const allOne = Object.fromEntries(Object.keys(NOW).map((k) => [k, 1]));
    const ON = { ...allOne, "군부대": 2.0, "대학가": 1.3, "산업단지": 1.2, "관광·유흥": 1.4, "관광유흥": 1.4 };
    const configs: { label: string; m: Record<string, number>; gate?: boolean }[] = [
      { label: `지금(${Object.entries(NOW).filter(([, v]) => v !== 1).map(([k, v]) => `${k.slice(0, 2)}${v}`).join("·") || "전부 1.0"})`, m: NOW },
      { label: "09-24 오후(군2.0·대1.3·산1.2·관1.4)", m: ON },
      { label: "  산업단지 1.0", m: { ...ON, "산업단지": 1.0 } },
      { label: "  대학가 1.0", m: { ...ON, "대학가": 1.0 } },
      { label: "  관광유흥 1.0", m: { ...ON, "관광·유흥": 1.0, "관광유흥": 1.0 } },
      { label: "군부대만 2.0(나머지 1.0)", m: { ...allOne, "군부대": 2.0 } },
      { label: "군부대 2.0 + 대학가 1.3", m: { ...allOne, "군부대": 2.0, "대학가": 1.3 } },
      { label: "군부대 2.0 + 대학가 1.3 (강도 높음만)", m: { ...allOne, "군부대": 2.0, "대학가": 1.3 }, gate: true },
      { label: "군부대 2.0 + 대학가 1.2 (강도 높음만)", m: { ...allOne, "군부대": 2.0, "대학가": 1.2 }, gate: true },
      { label: "군부대 2.0 + 대학가 1.4 (강도 높음만)", m: { ...allOne, "군부대": 2.0, "대학가": 1.4 }, gate: true },
      { label: "전부 1.0", m: allOne },
    ];
    const paramsOf = (m: Record<string, number>): TextbookParams => ({ ...full, specialDemandMultipliers: m });
    // 강도 문 — 사용자(2026-09-24 밤): 오송(대학가/보통, 약대·행정타운)이 학부 대학가와 같은 분류로 들어왔다. "강도 높음만 배수"를 재 본다.
    // 산식엔 강도 입력이 없으므로 여기서는 **강도가 높음이 아니면 유형을 '없음'으로 바꿔** 같은 효과를 낸다(측정용, 산식 변경 아님).
    const intensityByCode = new Map<string, string | null>();
    for (const s of stores) intensityByCode.set(s.storeCode, s.specialDemandIntensity ?? null);
    for (const [code, loc] of locByCode) intensityByCode.set(code, loc.specialDemandIntensity ?? null);
    const gateHigh = (input: TextbookInput): TextbookInput =>
      (input.specialDemandType ?? "없음") === "없음" || input.specialDemandType === "군부대" || intensityByCode.get(input.storeCode) === "높음"
        ? input : { ...input, specialDemandType: "없음" };
    const errs = (p: TextbookParams, gate = false) => own.map((r) => ({ t: r.input.specialDemandType ?? "없음", e: (computeTextbook(gate ? gateHigh(r.input) : r.input, p).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
    const typeBias = (xs: { t: string; e: number }[], t: string) => { const g = xs.filter((x) => x.t === t); return g.length ? mean(g.map((x) => x.e)) : NaN; };
    console.log(`\n[특수수요 배수 재고 표 — 자사 ${own.length}곳] 오차 = 예측 − 실측 %p. 유형별 편향은 그 유형 매장 평균`);
    console.log(`  조합                          MAE   편향  ±5%p ±10%p | 대학가(5) 산업단지(3) 관광유흥(2) 군부대(2) 없음(22)`);
    for (const c of configs) {
      const xs = errs(paramsOf(c.m), c.gate);
      const abs = xs.map((x) => Math.abs(x.e));
      console.log(`  ${c.label.padEnd(38)}${(mean(abs) * 100).toFixed(2).padStart(6)}${(mean(xs.map((x) => x.e)) * 100).toFixed(1).padStart(6)}${String(abs.filter((a) => a <= 0.05).length).padStart(5)}${String(abs.filter((a) => a <= 0.10).length).padStart(6)} |`
        + `${(typeBias(xs, "대학가") * 100).toFixed(1).padStart(9)}${(typeBias(xs, "산업단지") * 100).toFixed(1).padStart(11)}${(typeBias(xs, "관광·유흥") * 100).toFixed(1).padStart(11)}${(typeBias(xs, "군부대") * 100).toFixed(1).padStart(10)}${(typeBias(xs, "없음") * 100).toFixed(1).padStart(9)}`);
    }
    // 대학가 5곳 매장별 — 강도와 함께. 강도 문(높음만)이 전대상대(보통)를 어떻게 하나
    console.log(`\n  [대학가 자사 5곳 — 강도 · 배수 1.0 / 1.3 전부 / 1.3 높음만 / 1.2 높음만] 오차 %p`);
    const uni = own.filter((r) => r.input.specialDemandType === "대학가");
    for (const r of uni) {
      const a = r.input.actualUtilization as number;
      const e = (m: number, gate: boolean) => (computeTextbook(gate ? gateHigh(r.input) : r.input, paramsOf({ ...allOne, "군부대": 2.0, "대학가": m })).utilization ?? NaN) - a;
      console.log(`     ${(r.input.storeName ?? "").padEnd(8)} 강도 ${String(intensityByCode.get(r.input.storeCode) ?? "-").padEnd(3)} 실측 ${(a * 100).toFixed(1).padStart(5)}%  1.0 ${(e(1, false) * 100).toFixed(1).padStart(6)}  1.3 ${(e(1.3, false) * 100).toFixed(1).padStart(6)}  1.3높음만 ${(e(1.3, true) * 100).toFixed(1).padStart(6)}  1.2높음만 ${(e(1.2, true) * 100).toFixed(1).padStart(6)}`);
    }
    // 후보지 — 특수수요 유형이 있는 곳만 (없음은 배수와 무관)
    type V62Result = { candidateCode?: string; v62Final?: number | null };
    const v62 = new Map<string, V62Result>(((snap.results ?? []) as V62Result[]).filter((r) => r?.candidateCode).map((r) => [r.candidateCode as string, r]));
    const affected = candRows.filter((r) => (r.input.specialDemandType ?? "없음") !== "없음");
    console.log(`\n  [후보지 — 특수수요 유형 있는 ${affected.length}곳] 가동률 % (매출 만원). 배수 1.0 = 유형 무시. V62 = 운영 결과(참고)`);
    console.log(`  코드   이름         특수  강도  경쟁 |  배수 1.0        09-24 오후 배수   대1.3 높음만     지금        V62매출`);
    const gated13 = paramsOf({ ...allOne, "군부대": 2.0, "대학가": 1.3 });
    for (const r of affected) {
      const b1 = computeTextbook(r.input, paramsOf(allOne)), bOn = computeTextbook(r.input, paramsOf(ON)), bG = computeTextbook(gateHigh(r.input), gated13), bn = computeTextbook(r.input, full);
      const t = r.input.specialDemandType ?? "없음";
      console.log(`  ${r.input.storeCode.padEnd(5)} ${(r.input.storeName ?? "").trim().slice(0, 7).padEnd(7)} ${t.slice(0, 4).padEnd(5)} ${String(intensityByCode.get(r.input.storeCode) ?? "-").padEnd(3)} ${String(r.input.competitorCount ?? 0).padStart(3)} |`
        + ` ${pct(b1.utilization)} (${manwon(b1.monthlyRevenue).trim()})  ${pct(bOn.utilization)} (${manwon(bOn.monthlyRevenue).trim()})  ${pct(bG.utilization)} (${manwon(bG.monthlyRevenue).trim()})  ${pct(bn.utilization)}${bn.capped ? " 상한" : ""}  ${manwon(v62.get(r.input.storeCode)?.v62Final).trim()}`);
    }
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 배수는 그 유형 후보지 가동률을 그대로 ×배수 한다 — 자사에서 "평균 편향 0"으로 고른 값이 후보지에선 검증 없이 통과한다.`);
    console.log(`     · 자사 근거의 세기: 군부대 2곳(−17.6→+0.1, 두 곳 같은 방향) > 대학가 5곳(−7.5→+0.7, 매장별 −16~+0) > 관광유흥 2곳(−8.1→+1.7) > 산업단지 3곳(25%p 갈림 · 1.0이어도 탕정역 +7.4).`);
    console.log(`     · 산업단지는 층 가르기(_layerSplit)에서 광주첨단·탕정역이 핑봇 없어 수요/점유율을 못 갈랐고, 시흥정왕은 1.0이어도 −8.4다. 배수 자리인지 확인이 안 된 유형이다.`);
    expect(affected.length).toBeGreaterThan(0);
  });

  it("(11) ⭐⭐ 강도별 배수 — 산업단지·관광유흥·군부대도 강도(높음/보통/낮음)로 갈라 태울 수 있나", () => {
    // 사용자(2026-09-24 밤): *"산업단지나 유흥가 군부대상권도 특수수요 강도에 따라서 배수 적용하는 거 검토해봐."*
    // 판정 기준(자료 보기 전): 그 유형 안에서 **강도가 높은 매장의 함의 배수(실측÷배수 1.0 예측)가 낮은 매장보다 커야** 강도로 갈라 태울 근거가 있다.
    // 강도가 같은 매장들끼리 함의 배수가 크게 갈리면 강도는 배수의 자리가 아니다. 표본 2~3곳이라 값이 아니라 방향.
    if (!candRows.length) return;
    const own = existingRows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const allOne = Object.fromEntries(Object.keys(full.specialDemandMultipliers).map((k) => [k, 1]));
    const base: TextbookParams = { ...full, specialDemandMultipliers: allOne, specialDemandHighOnly: [] };
    const intensityOf = new Map<string, string | null>();
    for (const s of stores) intensityOf.set(s.storeCode, s.specialDemandIntensity ?? null);
    const rank = (i: string | null | undefined) => ({ "높음": 3, "보통": 2, "낮음": 1, "없음": 0 } as Record<string, number>)[i ?? ""] ?? -1;
    console.log(`\n[유형별 · 강도별 함의 배수 — 자사] 함의 배수 = 실측 ÷ 배수 1.0 예측. 강도 순으로 정렬. 강도가 높을수록 함의 배수가 커야 강도로 갈라 태울 수 있다`);
    for (const type of ["군부대", "산업단지", "관광·유흥", "대학가", "기타"]) {
      const g = own.filter((r) => (r.input.specialDemandType ?? "없음") === type)
        .map((r) => { const a = r.input.actualUtilization as number, u = computeTextbook(r.input, base).utilization ?? NaN; return { r, a, u, imp: a / u, inten: intensityOf.get(r.input.storeCode) ?? null }; })
        .sort((x, y) => rank(y.inten) - rank(x.inten));
      if (!g.length) continue;
      console.log(`  ── ${type} (${g.length}곳) · 지금 배수 ×${full.specialDemandMultipliers[type] ?? 1}${full.specialDemandHighOnly.includes(type) ? " (높음만)" : ""} ──`);
      for (const x of g) console.log(`     ${(x.r.input.storeName ?? "").padEnd(9)} 강도 ${String(x.inten ?? "-").padEnd(3)} 실측 ${(x.a * 100).toFixed(1).padStart(5)}%  배수1.0 예측 ${(x.u * 100).toFixed(1).padStart(5)}%  오차 ${((x.u - x.a) * 100).toFixed(1).padStart(6)}  함의 배수 ×${x.imp.toFixed(2)}`);
      const hi = g.filter((x) => x.inten === "높음"), mid = g.filter((x) => x.inten === "보통"), lo = g.filter((x) => x.inten === "낮음" || x.inten === "없음" || !x.inten);
      const geo = (xs: typeof g) => (xs.length ? Math.exp(mean(xs.map((x) => Math.log(x.imp)))) : NaN);
      console.log(`     강도별 함의 배수(기하평균): 높음 ×${geo(hi).toFixed(2)}(${hi.length}) · 보통 ×${geo(mid).toFixed(2)}(${mid.length}) · 낮음/없음 ×${geo(lo).toFixed(2)}(${lo.length})`
        + `   → ${hi.length && mid.length ? (geo(hi) > geo(mid) ? "높음 > 보통 (강도 방향 맞음)" : "높음 ≤ 보통 (강도 방향 아님)") : "한 강도만 있어 못 가름"}`);
    }

    // 후보지 강도 분포 — 문이 어디를 막고 어디를 못 막나
    console.log(`\n  [후보지 — 유형/강도] 문(높음만)을 달면 막히는 곳과 그대로 타는 곳`);
    for (const r of candRows) {
      const t = r.input.specialDemandType ?? "없음";
      if (t === "없음") continue;
      const inten = locByCode.get(r.input.storeCode)?.specialDemandIntensity ?? null;
      console.log(`     ${r.input.storeCode} ${(r.input.storeName ?? "").trim().slice(0, 7).padEnd(7)} ${t.padEnd(5)} 강도 ${String(inten ?? "-").padEnd(3)} → 높음만 문: ${inten === "높음" ? "탄다" : "안 탄다"}`);
    }

    // 방식 재고 표 — 유형만 / 높음만 / 강도 계단(높음 m · 보통 1+(m−1)/2 · 낮음 1)
    const ON: Record<string, number> = { "군부대": 2.0, "대학가": 1.3, "산업단지": 1.2, "관광·유흥": 1.4, "관광유흥": 1.4 };
    const stepped = (input: TextbookInput, m: Record<string, number>, inten: string | null): TextbookInput => {
      // 계단은 산식에 없으므로 입력 유형을 바꿔 흉내 낸다 — 보통은 배수 절반, 낮음은 없음
      const t = input.specialDemandType ?? "없음";
      if (!(t in m) || (m[t] ?? 1) === 1) return input;
      if (inten === "높음") return { ...input, specialDemandIntensity: "높음" };
      if (inten === "보통") return { ...input, specialDemandType: `${t}(보통)`, specialDemandIntensity: "높음" };
      return { ...input, specialDemandType: "없음" };
    };
    const withMid = (m: Record<string, number>) => ({ ...m, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [`${k}(보통)`, 1 + (v - 1) / 2])) });
    type Scheme = { label: string; params: TextbookParams; map: (input: TextbookInput, inten: string | null) => TextbookInput };
    const schemes: Scheme[] = [
      { label: "지금(군2.0 · 대1.3 높음만)", params: full, map: (i) => i },
      { label: "넷 다 유형만(군2.0·대1.3·산1.2·관1.4)", params: { ...full, specialDemandMultipliers: { ...allOne, ...ON }, specialDemandHighOnly: [] }, map: (i) => i },
      { label: "넷 다 높음만", params: { ...full, specialDemandMultipliers: { ...allOne, ...ON }, specialDemandHighOnly: ["대학가", "산업단지", "관광·유흥", "관광유흥", "군부대"] }, map: (i) => i },
      { label: "넷 다 강도 계단(높음 m · 보통 절반 · 낮음 1)", params: { ...full, specialDemandMultipliers: { ...allOne, ...withMid(ON) }, specialDemandHighOnly: Object.keys(withMid(ON)) }, map: (i, inten) => stepped(i, ON, inten) },
      { label: "군·대만 높음만 + 산·관 강도 계단", params: { ...full, specialDemandMultipliers: { ...allOne, ...withMid(ON) }, specialDemandHighOnly: Object.keys(withMid(ON)) }, map: (i, inten) => ((i.specialDemandType === "산업단지" || i.specialDemandType === "관광·유흥") ? stepped(i, ON, inten) : i) },
      { label: "추천: 군2.0·대1.3·산1.4 높음만 · 관 1.0", params: { ...full, specialDemandMultipliers: { ...allOne, "군부대": 2.0, "대학가": 1.3, "산업단지": 1.4 }, specialDemandHighOnly: ["대학가", "산업단지", "군부대"] }, map: (i) => i },
      { label: "  같은 것, 산업단지 1.3", params: { ...full, specialDemandMultipliers: { ...allOne, "군부대": 2.0, "대학가": 1.3, "산업단지": 1.3 }, specialDemandHighOnly: ["대학가", "산업단지", "군부대"] }, map: (i) => i },
      { label: "  같은 것, 산업단지 1.5", params: { ...full, specialDemandMultipliers: { ...allOne, "군부대": 2.0, "대학가": 1.3, "산업단지": 1.5 }, specialDemandHighOnly: ["대학가", "산업단지", "군부대"] }, map: (i) => i },
    ];
    console.log(`\n  [방식 재고 표] 자사 40곳 성적 · 유형별 편향 · 후보지 영향(배수 탄 곳)`);
    console.log(`  방식                                    MAE   편향 ±5%p | 대학가 산업단지 관광유흥 군부대 | 후보지 배수 탄 곳`);
    for (const s of schemes) {
      const xs = own.map((r) => ({ t: r.input.specialDemandType ?? "없음", e: (computeTextbook(s.map(r.input, intensityOf.get(r.input.storeCode) ?? null), s.params).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
      const abs = xs.map((x) => Math.abs(x.e));
      const tb = (t: string) => { const g = xs.filter((x) => x.t === t); return g.length ? (mean(g.map((x) => x.e)) * 100).toFixed(1) : "-"; };
      const cand = candRows.map((r) => {
        const inten = locByCode.get(r.input.storeCode)?.specialDemandIntensity ?? null;
        const u0 = computeTextbook(r.input, base).utilization ?? 0, u1 = computeTextbook(s.map(r.input, inten), s.params).utilization ?? 0;
        return u1 > u0 + 1e-6 ? `${(r.input.storeName ?? "").trim().replace(/점$/, "")} ${(u0 * 100).toFixed(1)}→${(u1 * 100).toFixed(1)}` : null;
      }).filter(Boolean);
      console.log(`  ${s.label.padEnd(40)}${(mean(abs) * 100).toFixed(2).padStart(5)}${(mean(xs.map((x) => x.e)) * 100).toFixed(1).padStart(6)}${String(abs.filter((a) => a <= 0.05).length).padStart(5)} |${tb("대학가").padStart(6)}${tb("산업단지").padStart(8)}${tb("관광·유흥").padStart(9)}${tb("군부대").padStart(7)} | ${cand.length ? cand.join(" · ") : "없음"}`);
    }
    console.log(`\n  ⭐ 읽는 법 — 강도로 갈라 태우려면 (1) 그 유형 안에서 높음의 함의 배수 > 보통의 함의 배수여야 하고 (2) 후보지에서 문이 실제로 무언가를 막아야 한다.`);
    console.log(`     관광유흥 후보지가 대부분 "높음"이면 문은 구리돌다리·신중동을 못 막는다 — 그때 문제는 강도가 아니라 관광유흥이 수요 배수 자리인가다(층 가르기: 수원인계·야당은 점유율 층).`);
    expect(own.length).toBeGreaterThan(30);
  });

  it("(12) ⭐⭐⭐ 소도시 수요 갈래 — 1km 밖 고리를 낮은 λ·성김 비례 λ로 켜면 소도시는 살고 후보지는 안 튀나", () => {
    // 층 가르기(_layerSplit): 양주덕정·문경시청·진주혁신은 "수요↓ 확정"(전부 먹어도 실측 못 미침 · 동네 실측시간 > 산식 수요). 1km이 배후지보다 좁다.
    // 전에 고리 λ800을 전 매장에 켰을 때는 후보지가 한결같이 +4.8%p 올라 되돌렸다(handoff-20260928). 두 가지를 재 본다:
    //   (A) 낮은 λ(200~500) — 실측 수요 잣대(_bundleCandidate (1))가 λ0 1.14배 / λ500 0.67배라 그 사이에 "산식 = 실측 하한" 지점이 있다.
    //   (B) 성김 비례 λ — 기전: 대안이 드물수록 멀리서 온다. λ_i = λ_ref × (1km 안 이용자 중앙 ÷ 그 매장 1km 안 이용자), 0~2000m로 자른다.
    //       밀집 도심은 λ가 작아져 고리가 거의 안 들고, 소도시는 λ가 커져 시내 전체가 배후지가 된다. 계수는 λ_ref 하나.
    // ⚠️ 사전 기준: 자사 성적만으로 채택 금지. 후보지 13곳 평균 이동·3%p↑ 개수·호구포역/오송/영월을 같이 본다. 소도시 3곳이 좋아지고 밀집이 안 나빠지고 후보지가 안 튀어야 한다.
    if (!candRows.length) return;
    const own = existingRows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const base: TextbookParams = { ...full, residentRingDecayM: 0 };
    const coreUsers = (input: TextbookInput) => { const b = computeTextbook(input, base); return (b.residentDemandUsers ?? 0) + (b.floatingDemandUsers ?? 0); };
    const utilIfAll = (input: TextbookInput) => { const b = computeTextbook(input, base); return b.totalDemandHours && input.pcCount ? b.totalDemandHours / (input.pcCount * 720) : NaN; };
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
    const medianCore = med(own.map((r) => coreUsers(r.input)));
    const SMALL = new Set(["양주덕정점", "문경시청점", "진주혁신도시본점"]);
    type Mode = { label: string; lambdaFor: (input: TextbookInput) => number; outside?: number };
    const modes: Mode[] = [
      { label: "λ0 (지금)", lambdaFor: () => 0 },
      ...[200, 300, 400, 500, 800].map((l) => ({ label: `λ${l} 전 매장`, lambdaFor: () => l })),
      ...[200, 300, 400, 600].map((l) => ({ label: `성김 비례 λ_ref ${l}`, lambdaFor: (input: TextbookInput) => Math.min(2000, l * medianCore / Math.max(1, coreUsers(input))) })),
      // (C) 고리의 짝 — "PC방 안 가는 몫"(분모 상수). 경쟁점 1~2곳인 후보지에서 고리 수요가 점유율에 안 눌리고 통과한 게 되돌림의 이유였다.
      //     분모에 상수를 두면 경쟁이 없어도 점유율이 1이 안 된다. 어제 묶음엔 이 항이 없었다.
      ...[100, 200, 400].map((o) => ({ label: `λ800 + 안가는몫 ${o}`, lambdaFor: () => 800, outside: o })),
      ...[100, 200].map((o) => ({ label: `λ400 + 안가는몫 ${o}`, lambdaFor: () => 400, outside: o })),
      { label: "λ0 + 안가는몫 100", lambdaFor: () => 0, outside: 100 },
    ];
    const run = (input: TextbookInput, m: Mode) => computeTextbook(input, { ...full, residentRingDecayM: m.lambdaFor(input), residentRingShare: "gravity", useRingEnclosure: true, outsideOptionIp: m.outside ?? full.outsideOptionIp });
    const cand0 = new Map(candRows.map((r) => [r.input.storeCode, computeTextbook(r.input, base).utilization ?? NaN]));
    console.log(`\n[소도시 수요 갈래 — 고리 λ 방식별] 자사 ${own.length}곳 · 후보지 ${candRows.length}곳. 1km 안 이용자 중앙 ${Math.round(medianCore).toLocaleString()}명. gravity·항아리 켬`);
    console.log(`  소도시 = 수요전부 가동률 < 45% (${own.filter((r) => utilIfAll(r.input) < 0.45).length}곳) · 밀집 = ≥ 90% (${own.filter((r) => utilIfAll(r.input) >= 0.9).length}곳). 오차 = 예측 − 실측 %p`);
    console.log(`  방식                 자사MAE  편향 | 소도시편향 밀집편향 | 양주덕정 문경시청 진주혁신 | 후보지 평균Δ 3%p↑ | 호구포역 오송 영월 신중동`);
    for (const m of modes) {
      const errs = own.map((r) => ({ r, e: (run(r.input, m).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
      const grp = (f: (r: typeof own[number]) => boolean) => { const g = errs.filter((x) => f(x.r)); return g.length ? mean(g.map((x) => x.e)) : NaN; };
      const one = (name: string) => { const x = errs.find((y) => y.r.input.storeName === name); return x ? (x.e * 100).toFixed(1).padStart(6) : "     -"; };
      const cd = candRows.map((r) => (run(r.input, m).utilization ?? NaN) - (cand0.get(r.input.storeCode) ?? NaN)).filter(Number.isFinite);
      const cu = (code: string) => { const r = candRows.find((x) => x.input.storeCode === code); return r ? ((run(r.input, m).utilization ?? NaN) * 100).toFixed(1).padStart(5) : "    -"; };
      console.log(`  ${m.label.padEnd(20)}${(mean(errs.map((x) => Math.abs(x.e))) * 100).toFixed(2).padStart(6)}${(mean(errs.map((x) => x.e)) * 100).toFixed(1).padStart(6)} |`
        + `${(grp((r) => utilIfAll(r.input) < 0.45) * 100).toFixed(1).padStart(9)}${(grp((r) => utilIfAll(r.input) >= 0.9) * 100).toFixed(1).padStart(9)} |`
        + `${one("양주덕정점")}${one("문경시청점")}${one("진주혁신도시본점")} |`
        + `${(mean(cd) * 100).toFixed(1).padStart(9)}${String(cd.filter((d) => d > 0.03).length).padStart(5)} |`
        + `${cu("N003")}${cu("N016")}${cu("N014")}${cu("N001")}`);
    }
    // 성김 비례에서 매장별 λ가 어떻게 배정되나 — 소도시 3곳과 밀집 몇 곳
    const show = [...own].sort((a, b) => coreUsers(a.input) - coreUsers(b.input));
    console.log(`\n  [성김 비례 λ_ref 300 — 매장별 λ] 1km 안 이용자 적은 순. λ = 300 × ${Math.round(medianCore)} ÷ 이용자`);
    for (const r of [...show.slice(0, 6), ...show.slice(-3)]) {
      const cu2 = coreUsers(r.input), lam = Math.min(2000, 300 * medianCore / Math.max(1, cu2));
      const u = run(r.input, modes.find((m) => m.label === "성김 비례 λ_ref 300")!).utilization ?? NaN;
      console.log(`     ${(r.input.storeName ?? "").padEnd(10)} 1km 이용자 ${Math.round(cu2).toString().padStart(6)} → λ ${Math.round(lam).toString().padStart(5)}m  실측 ${((r.input.actualUtilization as number) * 100).toFixed(1).padStart(5)}%  λ0 ${((computeTextbook(r.input, base).utilization ?? NaN) * 100).toFixed(1).padStart(5)}%  → ${(u * 100).toFixed(1).padStart(5)}%${SMALL.has(r.input.storeName ?? "") ? "  ← 소도시 수요↓ 확정" : ""}`);
    }
    console.log(`\n  ⭐ 읽는 법 — 후보지 평균Δ가 +1%p 안이고 3%p↑가 0~1곳인데 소도시 3곳이 5%p 이상 좋아지는 방식이 있으면 갈래가 산다. 전 매장 λ는 전에 후보지에서 깨졌다(+4.8%p).`);
    console.log(`     성김 비례는 계수가 λ_ref 하나지만 "이용자 중앙값"이 표본에서 나오므로 표본이 바뀌면 λ 배정이 흔들린다 — 채택하려면 중앙값을 상수로 못 박아야 한다.`);
    expect(own.length).toBeGreaterThan(30);
  });

  it("(13) ⭐⭐⭐ 고리 사람은 거리로 고른다 — 고리 λ × 고리 품질지수(θ / 1 / 0), 몫 상한 위에서", () => {
    // 사용자(2026-09-24 밤, 양주덕정): 300m 안 경쟁점 빼면 2km 안에 경쟁이 없고, 1~2km 배후지 사람은 우리 상권밖에 선택지가 없어 온다(자전거).
    // 1.6km까지는 오고 2km 밖은 힘들 듯. → 고리 기전 그대로. 전에 고리를 켰을 때 밀집이 같이 뜬 건 고리 사람에게도 θ3(우리 품질 3배)을 걸어서였을 수 있다.
    // 여기서는 고리 사람의 점유율에서 품질 지수를 θ / 1 / 0으로 낮춰 가며 λ를 훑는다. 1km 안 점유율은 그대로(θ3).
    // ⚠️ 사전 기준: (1) 10%p 넘는 5곳(양주덕정·문경·진주·전대후문·광주각화)이 줄고 (2) 밀집 편향이 +2 안이고 (3) 후보지 평균 이동 ±2%p·3%p↑ 2곳 이하
    //    (4) 이해되는 오차(상향 이탈 7곳 과소 제외)가 지금보다 낮을 것. 넷 다 맞아야 채택 후보.
    if (!candRows.length) return;
    const own = existingRows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
    const isUp = (code: string) => LAB_UPSIDE_STORE_CODES.has(code);
    const BIG = ["양주덕정점", "문경시청점", "진주혁신도시본점", "전대후문점", "광주각화점"];
    const base: TextbookParams = { ...full, residentRingDecayM: 0 };
    const utilIfAll = (input: TextbookInput) => { const b = computeTextbook(input, base); return b.totalDemandHours && input.pcCount ? b.totalDemandHours / (input.pcCount * 720) : NaN; };
    const cand0 = new Map(candRows.map((r) => [r.input.storeCode, computeTextbook(r.input, base).utilization ?? NaN]));
    const e0 = own.map((r) => ({ code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(r.input, base).utilization ?? NaN) - (r.input.actualUtilization as number) }));
    const okOf = (xs: { code: string; e: number }[]) => mean(xs.map((x) => (isUp(x.code) && x.e < 0 ? 0 : Math.abs(x.e))));
    const ok0 = okOf(e0);
    console.log(`\n[고리 λ × 고리 품질지수 — 몫 상한 k${full.ownShareCapK} · 배수 넷 위에서] gravity·항아리 켬. 자사 ${own.length}곳 · 후보지 ${candRows.length}곳. 지금 이해MAE ${(ok0 * 100).toFixed(2)}`);
    console.log(`  고리θ  λ    자사MAE 이해MAE  편향 | 밀집  소도시 | 양주덕정 문경 진주 전대후문 각화 | 10%p↑ | 후보지 Δ 3%p↑ | 호구포역 오송 영월 하안금당 | 판정`);
    for (const rq of [null, 1, 0] as (number | null)[]) {
      for (const lambda of [0, 300, 500, 600, 800]) {
        if (lambda === 0 && rq !== null) continue;
        const p2: TextbookParams = { ...full, residentRingDecayM: lambda, residentRingShare: "gravity", useRingEnclosure: true, ringQualityExponent: rq };
        const errs = own.map((r) => ({ code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(r.input, p2).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
        const g = (f: (u: number) => boolean) => { const xs = errs.filter((x) => f(utilIfAll(own.find((r) => r.input.storeCode === x.code)!.input))); return xs.length ? mean(xs.map((x) => x.e)) : NaN; };
        const one = (name: string) => { const x = errs.find((y) => y.name === name); return x ? (x.e * 100).toFixed(1).padStart(6) : "     -"; };
        const cd = candRows.map((r) => (computeTextbook(r.input, p2).utilization ?? NaN) - (cand0.get(r.input.storeCode) ?? NaN)).filter(Number.isFinite);
        const cu = (code: string) => { const r = candRows.find((x) => x.input.storeCode === code); return r ? ((computeTextbook(r.input, p2).utilization ?? NaN) * 100).toFixed(1).padStart(5) : "    -"; };
        const big = errs.filter((x) => Math.abs(x.e) >= 0.1).length, dB = g((u) => u >= 0.9), sB = g((u) => u < 0.45), ok = okOf(errs), cm = mean(cd), up3 = cd.filter((d) => d > 0.03).length;
        const bigNow = errs.filter((x) => BIG.includes(x.name)).map((x) => x.e), bigBase = e0.filter((x) => BIG.includes(x.name)).map((x) => x.e);
        const verdict = lambda === 0 ? "기준" : [
          mean(bigNow.map(Math.abs)) < mean(bigBase.map(Math.abs)) - 0.02 ? "" : "5곳 안 줄음",
          dB <= 0.02 ? "" : "밀집 뜸",
          Math.abs(cm) <= 0.02 && up3 <= 2 ? "" : "후보지 이동",
          ok < ok0 - 0.001 ? "" : "이해MAE 안 줄음",
        ].filter(Boolean).join(" · ") || "★ 기준 통과";
        console.log(`  ${(rq == null ? "θ" : String(rq)).padStart(4)}${String(lambda).padStart(5)}${(mean(errs.map((x) => Math.abs(x.e))) * 100).toFixed(2).padStart(8)}${(ok * 100).toFixed(2).padStart(8)}${(mean(errs.map((x) => x.e)) * 100).toFixed(1).padStart(6)} |${(dB * 100).toFixed(1).padStart(5)}${(sB * 100).toFixed(1).padStart(7)} |${one("양주덕정점")}${one("문경시청점")}${one("진주혁신도시본점")}${one("전대후문점")}${one("광주각화점")} |${String(big).padStart(5)} |${(cm * 100).toFixed(1).padStart(8)}${String(up3).padStart(5)} |${cu("N003")}${cu("N016")}${cu("N014")}${cu("N004")} | ${verdict}`);
      }
    }
    // ── 유일 상권에만 고리 — 사용자 기전의 핵심 조건("2km 안에 다른 상권이 없어 우리 상권밖에 선택지가 없다")을 AI 판정(otherCommercialWithin2km=false)으로 건다 ──
    type J = { code?: string; name?: string; otherCommercialWithin2km?: boolean | null };
    const solo = new Set(((snap.labTradeAreaJudgments ?? []) as J[]).filter((j) => j.otherCommercialWithin2km === false && j.code).map((j) => String(j.code)));
    console.log(`\n  [유일 상권(2km 안 다른 상권 없음, AI 판정)에만 고리] 판정 ${solo.size}곳: ${[...own, ...candRows].filter((r) => solo.has(r.input.storeCode)).map((r) => (r.input.storeName ?? "").replace(/점$/, "")).join(" · ")}`);
    console.log(`  고리θ  λ    자사MAE 이해MAE  편향 | 밀집  소도시 | 양주덕정 문경 진주 전대후문 각화 | 10%p↑ | 후보지 Δ 3%p↑ | 호구포역 오송 영월 하안금당`);
    for (const rq of [0, 1] as number[]) for (const lambda of [500, 800, 1200]) {
      const pFor = (code: string): TextbookParams => solo.has(code) ? { ...full, residentRingDecayM: lambda, residentRingShare: "gravity", useRingEnclosure: true, ringQualityExponent: rq } : full;
      const errs = own.map((r) => ({ code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(r.input, pFor(r.input.storeCode)).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
      const g = (f: (u: number) => boolean) => { const xs = errs.filter((x) => f(utilIfAll(own.find((r) => r.input.storeCode === x.code)!.input))); return xs.length ? mean(xs.map((x) => x.e)) : NaN; };
      const one = (name: string) => { const x = errs.find((y) => y.name === name); return x ? (x.e * 100).toFixed(1).padStart(6) : "     -"; };
      const cd = candRows.map((r) => (computeTextbook(r.input, pFor(r.input.storeCode)).utilization ?? NaN) - (cand0.get(r.input.storeCode) ?? NaN)).filter(Number.isFinite);
      const cu = (code: string) => { const r = candRows.find((x) => x.input.storeCode === code); return r ? ((computeTextbook(r.input, pFor(code)).utilization ?? NaN) * 100).toFixed(1).padStart(5) : "    -"; };
      console.log(`  ${String(rq).padStart(4)}${String(lambda).padStart(5)}${(mean(errs.map((x) => Math.abs(x.e))) * 100).toFixed(2).padStart(8)}${(okOf(errs) * 100).toFixed(2).padStart(8)}${(mean(errs.map((x) => x.e)) * 100).toFixed(1).padStart(6)} |${(g((u) => u >= 0.9) * 100).toFixed(1).padStart(5)}${(g((u) => u < 0.45) * 100).toFixed(1).padStart(7)} |${one("양주덕정점")}${one("문경시청점")}${one("진주혁신도시본점")}${one("전대후문점")}${one("광주각화점")} |${String(errs.filter((x) => Math.abs(x.e) >= 0.1).length).padStart(5)} |${(mean(cd) * 100).toFixed(1).padStart(8)}${String(cd.filter((d) => d > 0.03).length).padStart(5)} |${cu("N003")}${cu("N016")}${cu("N014")}${cu("N004")}`);
    }
    console.log(`\n  ⭐ 읽는 법 — 고리θ 0·λ500~600에서 양주덕정이 −5 안으로 들어오고 밀집이 안 뜨면 사용자 기전("멀리선 거리로 고른다, 1.6km까지")이 맞는 것.`);
    console.log(`     후보지가 뜨면 그 자리 2km 경쟁점 목록이 비었는지(누락)부터 본다 — 고리는 2km 경쟁점 대수(기본 90)에 기대므로 누락이면 고리 사람이 전부 우리에게 온다.`);
    expect(own.length).toBeGreaterThan(30);
  });
});
