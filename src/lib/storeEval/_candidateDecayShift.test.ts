// 후보지 13곳이 거리 감쇠로 얼마나 움직였나 (2026-09-21)
//
// ── 사용자 지시 ───────────────────────────────────────────────────────────
// *"후보지 13곳이 감쇠로 얼마나 움직였는지 표로 내라. 특히 오송점·하안금당."*
//
// ⚠️ **운영 V62 예상매출은 한 원도 안 바뀐다.** 운영 산식은 경쟁점 거리를 아예 안 읽는다
//    (calc.ts / usageRevenue.ts / evaluate.ts). 이 표는 **실험실(교과서식) 전용**이다.
//    표에 V62를 같이 찍는 건 견주라고 넣은 것이지 V62가 움직였다는 뜻이 아니다.
//
// ── 후보지는 채점할 수 없다 ───────────────────────────────────────────────
// 후보지는 실매출이 없다. 그래서 "어느 쪽이 맞나"를 여기서 가릴 수는 없고,
// **얼마나·왜 움직이나**만 찍는다. 맞나 틀리나는 기존점 38곳에서 이미 쟀다
// (`_rivalDecayNormalized` (6)(7)절 · `_jangsanDecay`).
//
// 축척은 **기존점에서 잡아 후보지에 그대로 쓴다.** 후보지로 다시 잡으면 판이 달라진다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_candidateDecayShift.test.ts --disable-console-intercept
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
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  type TextbookParams,
} from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const won = (v: number | null | undefined) => (v == null ? "-" : `${Math.round(v / 1e4).toLocaleString()}만`);

describeIf("후보지 — 거리 감쇠로 얼마나 움직이나", () => {
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
  const franchiseManagement = franchiseManagementFromRows(existingRows, qscByStoreCode);
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement });

  const P_DECAY: TextbookParams = DEFAULT_TEXTBOOK_PARAMS;                              // 지금 (채택됨)
  const P_STEP: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, rivalDistanceDecay: null }; // 채택 전
  const D = P_DECAY.rivalDistanceDecay!;
  /** 축척은 **기존점에서** 잡는다. 두 산식은 축척이 서로 다르다(경쟁 총량이 달라서). */
  const fitS = fittedParams(P_STEP, scoreTextbook(existingRows, P_STEP));
  const fitD = fittedParams(P_DECAY, scoreTextbook(existingRows, P_DECAY));

  const wDecay = (d: number | null) =>
    (d == null || d <= D.plateauM ? 1 : Math.exp(-(d - D.plateauM) / D.scaleM)) * (D.weightFactor ?? 1);
  const wStep = (d: number | null) => (d == null || d <= P_STEP.effectiveRadiusM ? 1 : 0);

  const v62 = new Map<string, number>();
  for (const r of (snap.results ?? []) as { candidateCode?: string; v62Final?: number | null }[]) {
    if (r.candidateCode && r.v62Final != null) v62.set(r.candidateCode, r.v62Final);
  }

  type Shift = {
    code: string; name: string;
    step: number | null; decay: number | null; move: number | null;
    mStep: number; mDecay: number; grow: number;
    nNew: number; newList: string[];
    v62: number | null;
  };
  const shifts: Shift[] = candRows.map((r) => {
    const code = r.input.storeCode;
    const name = candidates.find((x) => x.code === code)?.name ?? r.input.storeName ?? code;
    const bS = computeTextbook(r.input, fitS), bD = computeTextbook(r.input, fitD);
    const rivals = r.input.rivals ?? [];
    const mStep = rivals.reduce((s, v) => s + (v.ip > 0 ? v.ip * wStep(v.distanceM) : 0), 0);
    const mDecay = rivals.reduce((s, v) => s + (v.ip > 0 ? v.ip * wDecay(v.distanceM) : 0), 0);
    const nw = rivals.filter((v) => v.ip > 0 && wStep(v.distanceM) === 0 && wDecay(v.distanceM) > 0.2);
    return {
      code, name,
      step: bS.monthlyRevenue, decay: bD.monthlyRevenue,
      move: bS.monthlyRevenue && bD.monthlyRevenue ? bD.monthlyRevenue / bS.monthlyRevenue - 1 : null,
      mStep, mDecay, grow: mStep > 0 ? mDecay / mStep - 1 : mDecay > 0 ? Infinity : 0,
      nNew: nw.length,
      newList: nw.map((v) => `${v.name ?? "?"} ${Math.round(v.distanceM ?? 0)}m/${v.ip}대 ${(wDecay(v.distanceM) * 100).toFixed(0)}%`),
      v62: v62.get(code) ?? null,
    };
  });

  it("(1) 후보지 13곳 이동 표", () => {
    const sorted = [...shifts].sort((a, b) => (a.move ?? 0) - (b.move ?? 0));
    console.log(`\n[후보지 ${shifts.length}곳 — 실험실 예상매출이 감쇠로 얼마나 움직였나]`);
    console.log(`  ⚠️ **운영 V62는 안 움직인다** — 거리를 안 읽는다. 맨 오른쪽은 견주라고 찍은 것이다.`);
    console.log(`\n  후보지            계단300      감쇠      이동      경쟁량 계단->감쇠   새로세진곳   운영V62`);
    for (const s of sorted) {
      console.log(`  ${s.name.padEnd(16)}${won(s.step).padStart(9)}${won(s.decay).padStart(10)}` +
        `${(s.move == null ? "-" : (s.move >= 0 ? "+" : "") + (s.move * 100).toFixed(1) + "%").padStart(9)}` +
        `${(s.mStep.toFixed(0) + " -> " + s.mDecay.toFixed(0)).padStart(18)}` +
        `${(s.grow === Infinity ? "새로" : (s.grow >= 0 ? "+" : "") + (s.grow * 100).toFixed(0) + "%").padStart(8)}` +
        `${String(s.nNew).padStart(5)}곳${won(s.v62).padStart(10)}`);
    }
    const moved = shifts.filter((s) => s.move != null).map((s) => s.move!);
    console.log(`\n  내려간 곳 ${moved.filter((m) => m < -0.005).length} · 거의 그대로 ${moved.filter((m) => Math.abs(m) <= 0.005).length} · 올라간 곳 ${moved.filter((m) => m > 0.005).length}`);
    console.log(`  ⚠️ 올라간 곳이 있는 이유 — 총량 정규화 0.90 때문이다. 300m 밖에 경쟁점이 없는`);
    console.log(`     후보지는 **안쪽 경쟁점이 10% 약해져서** 예측이 올라간다. 공짜가 아니라 재분배다.`);
    expect(shifts.length).toBeGreaterThan(5);
  });

  it("(2) 오송점·하안금당 — 지시받은 두 곳을 낱개로", () => {
    for (const key of ["오송", "하안금당"]) {
      const s = shifts.find((x) => x.name.includes(key));
      if (!s) { console.log(`\n[${key}] 후보지 목록에 없다`); continue; }
      const r = candRows.find((x) => x.input.storeCode === s.code)!;
      console.log(`\n[${s.name}] ${s.code} · 자사 PC ${r.input.pcCount}대 · 시급 ${r.input.hourlyRate}원`);
      console.log(`  경쟁점            거리     PC수    계단    감쇠     계단기여   감쇠기여`);
      for (const v of [...(r.input.rivals ?? [])].sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))) {
        const ws = wStep(v.distanceM), wd = wDecay(v.distanceM);
        console.log(`  ${(v.name ?? "?").padEnd(18)}${(Math.round(v.distanceM ?? 0) + "m").padStart(6)}${String(v.ip).padStart(7)}` +
          `${(ws * 100).toFixed(0).padStart(7)}%${(wd * 100).toFixed(0).padStart(7)}%` +
          `${(v.ip * ws).toFixed(0).padStart(11)}${(v.ip * wd).toFixed(0).padStart(11)}` +
          (ws === 0 && wd > 0.2 ? "  <- 새로 센다" : ""));
      }
      const bS = computeTextbook(r.input, fitS), bD = computeTextbook(r.input, fitD);
      console.log(`  합${"".padEnd(37)}${s.mStep.toFixed(0).padStart(11)}${s.mDecay.toFixed(0).padStart(11)}`);
      console.log(`\n  점유율   ${((bS.share ?? 0) * 100).toFixed(1)}%  ->  ${((bD.share ?? 0) * 100).toFixed(1)}%`);
      console.log(`  가동률   ${((bS.utilization ?? 0) * 100).toFixed(1)}%  ->  ${((bD.utilization ?? 0) * 100).toFixed(1)}%${bD.capped ? "  (상한에 걸림)" : ""}`);
      console.log(`  실험실   ${won(bS.monthlyRevenue)}  ->  ${won(bD.monthlyRevenue)}   (${s.move == null ? "-" : (s.move >= 0 ? "+" : "") + (s.move * 100).toFixed(1) + "%"})`);
      console.log(`  운영V62  ${won(s.v62)}  (안 바뀜 — 거리를 안 읽는다)`);
      if (s.newList.length) console.log(`  새로 세진 경쟁점: ${s.newList.join(" · ")}`);
    }
    expect(shifts.length).toBeGreaterThan(5);
  });

  it("(3) 장산점과 같은 자리에 선 후보지가 있나", () => {
    // 장산이 무너진 이유는 **자사 PC 1대당 새로 세진 경쟁이 3.52대**로 표본 1위였기 때문이다.
    // 후보지에도 같은 자리가 있으면 그 예상매출은 같은 이유로 못 믿는다.
    console.log(`\n[장산 위험도] 자사 PC 1대당 새로 세진 경쟁 대수 — 기존점 장산점이 3.52대(1위)였다`);
    const risk = shifts.map((s) => {
      const r = candRows.find((x) => x.input.storeCode === s.code)!;
      return { ...s, perOwn: (s.mDecay - s.mStep) / (r.input.pcCount || 1) };
    }).sort((a, b) => b.perOwn - a.perOwn);
    console.log(`  후보지            자사1대당 추가   등급`);
    for (const x of risk) {
      const g = x.perOwn >= 2 ? "🔴 장산급" : x.perOwn >= 1 ? "🟡 주의" : x.perOwn > 0 ? "⚪ 약간" : "— 없음";
      console.log(`  ${x.name.padEnd(16)}${x.perOwn.toFixed(2).padStart(13)}대   ${g}`);
    }
    console.log(`\n  ⚠️ 🔴가 있으면 그 후보지의 실험실 값은 **장산과 같은 방식으로 틀릴 수 있다.**`);
    expect(risk.length).toBeGreaterThan(5);
  });
});
