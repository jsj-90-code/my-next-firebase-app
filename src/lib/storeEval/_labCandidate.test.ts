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
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  qscInWindowAverage, utilizationByStore, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeQualityScore, computeTextbook, fittedParams, scoreTextbook,
} from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

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

  const existingRows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = { ...DEFAULT_TEXTBOOK_PARAMS };
  const score = scoreTextbook(existingRows, P);
  const full = fittedParams(P, score);
  const franchiseManagement = franchiseManagementFromRows(existingRows);

  const candRows = buildLabCandidateRows({
    candidates, compsByCode, locByCode, settings, franchiseManagement,
  });

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
});
