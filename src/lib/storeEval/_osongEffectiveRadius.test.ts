// 오송점(N016) — 유효거리 R을 바꾸면 무엇이 같이 움직이나 (2026-09-18)
//
// ── 왜 이걸 재나 ──────────────────────────────────────────────────────────
// 오송점의 유일한 경쟁점(팀플PC)이 **342m**다. 유효거리가 300m라 42m 차로 계산에서 통째로
// 빠지고 점유율이 100%가 된다. 그런데 `textbookModel.ts`의 effectiveRadiusM 주석이 스스로
// 이렇게 적어 뒀다:
//
//   "⚠️ 300m은 잠정값이다. 300·400·500m가 MAPE로 30.1~30.5%라 구별이 안 된다.
//    300을 고른 근거는 상관(0.560 vs 400m 0.434)과 실무 의견뿐이다."
//
// **오송점은 하필 그 구별 안 되는 구간(300~500m) 한가운데에 서 있다.** 그래서 이 매장의
// 예측은 "자료가 고른 값"이 아니라 "자료가 못 고른 값"에 통째로 달려 있다.
//
// ⚠️ **여기 숫자로 R을 고르면 안 된다.** 이건 계수 선택이 아니라 **불확실성 측정**이다.
//    R을 바꿀지 말지는 기존점 채점과 대조군이 정한다(_competitionDesign.test.ts).
//    이 하네스는 "오송점 예측을 단일값으로 볼 수 있나"에만 답한다.
//
// R을 바꾸면 기존점 쪽에서도 세는 경쟁점이 달라지므로 **축척을 매번 다시 맞춘다** —
// 오송점만 갈아끼우고 기존점은 그대로 두면 사과와 배를 견주게 된다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_osongEffectiveRadius.test.ts --disable-console-intercept
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
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import { rivalDistanceM } from "./labInput";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const CODE = "N016";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

const manwon = (v: number | null | undefined) =>
  v == null ? "      -" : `${Math.round(v / 10000).toLocaleString().padStart(6)}만`;
const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "    -" : `${(v * 100).toFixed(d).padStart(5)}%`;

describeIf("오송점 유효거리 민감도", () => {
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

  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, locationEvaluations, settings,
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
  const franchiseManagement = franchiseManagementFromRows(existingRows);
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement });
  const osong = candRows.find((r) => r.input.storeCode === CODE) ?? null;

  // R 하나에 대해: 기존점으로 축척을 다시 맞추고, 그 축척으로 오송점을 돌린다.
  const runAt = (radiusM: number) => {
    const P = { ...DEFAULT_TEXTBOOK_PARAMS, effectiveRadiusM: radiusM };
    const s = scoreTextbook(existingRows, P);
    const full = fittedParams(P, s);
    const b = osong ? computeTextbook(osong.input, full) : null;
    return { score: s, full, osong: b };
  };

  it("오송점과 그 경쟁점이 스냅샷에 있다", () => {
    expect(osong).not.toBeNull();
    const rivals = compsByCode.get(CODE) ?? [];
    expect(rivals.length).toBeGreaterThan(0);
    const cand = candidates.find((c) => c.code === CODE);
    console.log(`\n[${CODE} 경쟁점]`);
    for (const r of rivals) {
      // ⚠️ 산식이 실제로 쓰는 거리는 **좌표로 잰 값**이다(labInput.rivalDistanceM).
      //    조사 거리(distanceM)는 기록으로만 남고 계산에 안 들어간다.
      const byCoord = cand ? rivalDistanceM({ lat: cand.lat ?? null, lng: cand.lng ?? null }, r) : null;
      console.log(
        `  ${r.name} · PC ${r.totalPcCount}대 · ${r.investigationStatus}` +
          `\n     조사 거리 ${r.distanceM}m  /  좌표로 잰 거리 ${byCoord == null ? "-" : `${byCoord.toFixed(1)}m`}` +
          `  <- 산식이 쓰는 값`,
      );
    }
  });

  it("유효거리를 바꾸면 기존점 성적과 오송점 예측이 어떻게 같이 움직이나", () => {
    if (!osong) return;
    const cand = candidates.find((c) => c.code === CODE) ?? null;
    const rivals = compsByCode.get(CODE) ?? [];
    // 산식이 쓰는 거리(좌표) 바로 앞뒤를 끼워 넣어 **계단이 정확히 어디서 떨어지는지** 본다.
    const labDist = cand
      ? rivals.map((r) => rivalDistanceM({ lat: cand.lat ?? null, lng: cand.lng ?? null }, r)).filter((v): v is number => v != null)
      : [];
    const edge = labDist.length ? Math.ceil(Math.min(...labDist)) : null;
    const radii = [...new Set([200, 250, 300, 350, ...(edge ? [edge - 1, edge] : []), 400, 500, 700, 1000])]
      .sort((a, b) => a - b);
    const base = runAt(DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM);

    console.log(
      `\n[유효거리 민감도] 지금 기본값 R=${DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM}m · θ=${DEFAULT_TEXTBOOK_PARAMS.qualityExponent}` +
        `\n기존점 ${existingRows.length}곳으로 매번 축척을 다시 맞춘 뒤 오송점을 돌린다.\n`,
    );
    console.log(
      `  ${"R(m)".padStart(6)} │ ${"MAPE".padStart(7)} ${"중앙".padStart(6)} ${"±20%".padStart(6)}` +
        ` │ ${"경쟁점".padStart(5)} ${"점유율".padStart(6)} ${"오송점 예측".padStart(9)} ${"R=300대비".padStart(9)}`,
    );
    console.log(`  ${"─".repeat(6)}─┼─${"─".repeat(22)}─┼─${"─".repeat(40)}`);

    const baseRev = base.osong?.monthlyRevenue ?? null;
    for (const R of radii) {
      const { score, osong: b } = runAt(R);
      const counted = labDist.filter((d) => d <= R).length;
      const vs = baseRev && b?.monthlyRevenue != null
        ? `${b.monthlyRevenue >= baseRev ? "+" : ""}${(((b.monthlyRevenue - baseRev) / baseRev) * 100).toFixed(1)}%`
        : "-";
      const mark = R === DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM ? " <- 지금" : "";
      console.log(
        `  ${String(R).padStart(6)} │ ${pct(score.mape)} ${pct(score.medianAbsErr)} ${pct(score.within20, 0)}` +
          ` │ ${String(counted).padStart(5)} ${pct(b?.share)} ${manwon(b?.monthlyRevenue)} ${vs.padStart(9)}${mark}`,
      );
    }

    console.log(
      `\n  읽는 법: 왼쪽 세 칸(기존점 성적)이 R에 따라 거의 안 움직이는데 오른쪽(오송점)만 크게` +
        `\n  움직이면, 그 차이는 **자료가 고른 것이 아니라 못 고른 것**이다.`,
    );
    expect(radii.length).toBeGreaterThan(0);
  });

  // 2026-09-18 사용자: "팀플을 경쟁점으로 설정해야할것같음."
  // 그런데 R은 **전역 계수**다. 오송점 하나 때문에 옮기면 기존점 38곳과 후보지 13곳이 전부
  // 같이 움직인다. 그 값이 얼마인지 먼저 재 둔다 — 고르기 전에 대가를 봐야 한다.
  it("R을 옮기면 오송점 말고 어디가 같이 움직이나", () => {
    const targets = [300, 343, 400];
    console.log(`\n[R을 옮겼을 때 전체 영향] 기존점 ${existingRows.length}곳 · 후보지 ${candRows.length}곳\n`);

    console.log("  기존점 성적");
    for (const R of targets) {
      const { score } = runAt(R);
      console.log(
        `    R=${String(R).padStart(4)}  MAPE ${pct(score.mape)}  중앙 ${pct(score.medianAbsErr)}` +
          `  ±20% ${pct(score.within20, 0)}${R === 300 ? "   <- 지금" : ""}`,
      );
    }

    const byR = new Map(targets.map((R) => [R, runAt(R)]));
    console.log(`\n  후보지별 예측 (경쟁점이 유효거리 밖에 있다가 들어오는 곳만 움직인다)`);
    console.log(
      `    ${"코드".padEnd(6)} ${"이름".padEnd(16)} ${"R=300".padStart(8)} ${"R=343".padStart(8)} ${"R=400".padStart(8)}  움직임`,
    );
    let moved = 0;
    for (const r of candRows) {
      const vals = targets.map((R) => {
        const P = { ...DEFAULT_TEXTBOOK_PARAMS, effectiveRadiusM: R };
        const s = byR.get(R)!;
        void P;
        return computeTextbook(r.input, s.full).monthlyRevenue ?? null;
      });
      const [a, , c] = vals;
      const delta = a && c ? (c - a) / a : null;
      const big = delta != null && Math.abs(delta) > 0.01;
      if (big) moved++;
      console.log(
        `    ${r.input.storeCode.padEnd(6)} ${(r.input.storeName ?? "").slice(0, 15).padEnd(16)} ` +
          vals.map((v) => manwon(v)).join(" ") +
          `  ${delta == null ? "-" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`}${big ? "  <-" : ""}`,
      );
    }
    console.log(`\n  R=300 -> 400에서 1% 넘게 움직인 후보지 ${moved}/${candRows.length}곳`);
    expect(candRows.length).toBeGreaterThan(0);
  });
});
