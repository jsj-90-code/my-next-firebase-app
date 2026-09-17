// QSC 잔차 검정 — 산식이 못 맞힌 부분을 점검 점수가 설명하는가 (2026-09-17)
//
// 실행:
//   npx vitest run src/lib/storeEval/_qscResidual.test.ts --reporter=verbose --disable-console-intercept
//
// ── 왜 재나 ────────────────────────────────────────────────────────────────
// fcdaum.com에서 PC방 QSC 831건(2023~2026)을 받았다. 기존점 41곳 중 37곳에 기록이 있고
// 그중 30곳이 **평가창 안에**(개점 다음 달~12개월) 점검을 받았다. 79~100점으로 편차가 있다.
//
// 인계 문서(2026-09-17) 5절의 날것 상관은 이랬다:
//   QSC ↔ 실측 가동률 0.369 · ↔ 실매출 0.362 · ↔ PC대수 -0.041 · ↔ 개점시점 0.163
//
// ⚠️ **날것 상관으로 판정하지 않는다.** 2026-09-17에 이 저장소가 정확히 그걸로 틀렸다 —
//    "중심도 ↔ 실측 가동률 r=-0.179, 무관"이라 했는데 모델을 켜고 끄니 정반대였다.
//    날것 상관에는 매장 규모·동네 수요·경쟁점이 하나도 안 걸러진다.
//
// 진짜 질문은 **"산식이 못 맞힌 부분을 QSC가 설명하는가"**다. 그래서 두 산식의 **잔차**에
// 대본다:
//   (2) 운영 V62 — 실제매출 ÷ 예측매출. 실제로 쓰이는 산식이고 MAPE 9.17%다.
//   (3) 실험실 교과서식 — 실측 점유율 ÷ 예측 점유율(품질 x 접근성^0.25 x 중심도^0.25).
//       계수를 넣을 자리가 여기다(점유율에 곱한다).
//
// ── 어느 QSC 값을 쓰나 ─────────────────────────────────────────────────────
// **평가창 안 평균**을 기본으로 쓴다. 매출 목표값이 평가창 12개월 평균이라 점검 점수도 같은
// 창에서 재야 짝이 맞는다(자사 시설점수를 평가 시점으로 통일해 둔 것과 같은 이유).
// 전체기간 평균은 표본이 몇 곳 더 많아 참고로만 같이 낸다 — 평가창 밖 점검은 평가창 매출을
// 만들어낸 운영 상태가 아니다.
//
// ── 처음부터 알고 시작하는 것 ──────────────────────────────────────────────
// ⚠️ **넣어도 후보지 예측력은 안 는다.** 후보지엔 QSC가 없어서 가맹점 평균(=항상 1배)을
//    쓰게 된다. 사용자가 2026-09-15에 이미 같은 이유로 기각한 적이 있다
//    (docs/competitiveness-gap-dead-ends-2026-09-15.md ③).
//    그래도 재는 값어치가 있다 — 기존점 오차의 정체가 밝혀지고, 다른 계수들이 관리 교란에서
//    풀려나고, "관리가 매출에 얼마"에 답이 나온다.
//
// ⚠️ **측정이지 채택이 아니다.** 채택은 사용자 결정 사항이다.
//
// ══════════════════════════════════════════════════════════════════════════
// ── 결과 (2026-09-17) ─────────────────────────────────────────────────────
//
// **한 줄: QSC는 진짜다. 관문을 전부 통과했고, 경쟁력점수의 그림자도 코호트도 아니다.**
//
// 1. **운영 V62의 잔차를 설명한다 — 날것 상관보다 강하게.** (n=29 · 유의선 0.371)
//      날것  QSC ↔ 실매출       0.362  (인계 문서 5절)
//      **잔차 QSC ↔ 실제÷예측    0.425 ***  <- 산식이 걸러내고 남은 것에 더 잘 붙는다
//      시점통제 편상관           **0.438 ***  <- 통제하면 오히려 **올라간다**
//      [교란] QSC ↔ 평가창시점 0.158 · QSC ↔ PC대수 -0.042  — 코호트도 규모도 아니다
//    방향도 맞다: QSC 낮은 5곳 잔차 중앙 **0.910**(과대예측) · 높은 5곳 **1.106**(과소예측).
//
//    ⚠️ 날것 상관이 잔차 상관보다 **낮았다**는 데 주목할 것. 2026-09-17에 중심도에서 겪은
//       것과 같은 구조다 — 날것에는 규모·수요·경쟁이 안 걸러져 신호가 묻힌다.
//
// 2. **"관리가 매출에 얼마"** — 탄력도 **0.84**. QSC 1% 높으면 매출 0.84% 높다.
//      기하평균 92.5점 대비: 85점 **-6.8%** · 90점 -2.3% · 95점 +2.3% · 100점 **+6.7%**
//      운영 잔차의 분산 **18.1%**를 설명하고, 이 몫을 빼면 MAPE 9.85% -> 7.79%가 된다.
//      ⚠️ 7.79%는 **표본 안 값이다**(홀드아웃 아님). "QSC를 알면 MAPE가 7.79%가 된다"로
//         읽으면 안 된다 — 후보지엔 애초에 QSC가 없다.
//
// 3. **앞 항을 반영할수록 커진다 — 편심도와 정반대다.** 실험실 점유율 잔차(n=23):
//      아무것도 없이(품질만)        r 0.420 * · 시점통제 0.381
//      접근성 κ=0.25까지            r 0.452 * · 시점통제 0.455 *
//      **접근성+중심도(지금 산식)   r 0.463 * · 시점통제 0.512 ***
//    편심도는 앞 항을 반영할수록 -0.280 -> -0.069로 사라졌다(같은 걸 두 번 본 것이었다).
//    QSC는 반대다. **다른 항이 안 먹고 있는 신호다** — 겹침도 작다(중심도 0.193 · 층수 0.051).
//
// 4. **ψ 관문을 통과한다.** 점유율 = [품질] x (층수자÷3.42)^0.25 x (중심도÷3.22)^0.25 x **(QSC÷92.6)^ψ**
//      표본 안   ψ=0    MAPE 23.72% · r 0.786
//               **ψ=2.5 MAPE 20.61% · r 0.843**   (촘촘한 격자에서 MAPE 최소)
//               ψ=2.25 MAPE 20.68% · r 0.844      (r 최대 — 두 기준이 사실상 같은 자리)
//      LOO      [MAPE] 20.72% -> 22.60% (벌어짐 **1.88%p**) · [r] 벌어짐 **0.38%p**
//      5겹 100회 [MAPE] ψ3 55%·ψ2 41% · [r] ψ2 61%·ψ3 32%
//      대조군    MAPE **p=0.028** ✅ · r **p=0.034** ✅
//      잭나이프  r 0.719~0.888 (유의선 0.426) — 여유가 크다
//    강도 순서: 중심도(p=0.002) > **QSC(0.028/0.034)** > 층수(p=0.046) > 경쟁 항(p=0.098 ❌)
//
//    ⚠️ **ψ가 크다(2.5).** QSC는 82~100으로 폭이 좁아 같은 효과를 내려면 지수가 커야 한다.
//       2026-09-17에 300m/500m 중심도를 **바로 이 징후로 기각**했다(변동계수 작음 -> 큰 지수
//       -> 이상점 증폭). 다만 그때는 LOO 벌어짐이 6.65%p였고 **여기는 1.88%p**다. 같은
//       징후가 아니다. 보정 배율도 0.745~1.216배로 상식 범위다.
//
// 5. **기존 계수는 안 흔들린다 — "관리 교란에서 풀려남"은 일어나지 않았다.**
//    κ·ν·ψ를 셋 다 자유로 풀면 MAPE 기준이 **κ=0.25 · ν=0.25 · ψ=2.5**를 고르고 LOO도
//    같은 조합을 61% 고른다. **κ·ν가 원래 관리와 안 얽혀 있었다**는 뜻이다(좋은 소식이다 —
//    2026-09-17에 채택한 입지 계수가 관리 착시가 아니었다).
//    ⚠️ 그래도 **자유도는 ψ 하나만 푼다.** 셋을 같이 풀면 LOO 벌어짐이 1.88%p -> 3.48%p다.
//       (r 기준은 κ=0.75로 튀는데 MAPE가 23.87%로 나빠진다 — MAPE 우선 원칙에서 κ=0.25다)
//
// 6. **경쟁력점수의 그림자가 아니다.** QSC ↔ 경쟁력점수 r=0.385로 겹치는데, 정체는 **스펙**이다
//    (QSC ↔ 스펙 **r=0.489 ***· 존구성 0.222). 먹거리·인테리어·관리는 자사 전 매장이 4점이라
//    상수여서 상관 자체가 정의되지 않는다(2026-09-17 확인, 의도된 설계).
//    **결정적인 자리**: 경쟁력점수를 통제하고도 잔차 상관이 0.463 -> **0.481 ***로 **올라간다**.
//    -> 좋은 장비를 갖춘 집이 점검도 잘 받는 경향은 있지만, QSC가 설명하는 잔차는 스펙이
//       이미 반영된 **뒤에 남은 것**이다.
//
// ── 그래서 어떻게 할 것인가 ───────────────────────────────────────────────
// ⚠️ **후보지 예측력은 여전히 안 는다.** 후보지엔 QSC가 없어서 가맹점 평균(=1배)을 쓰고,
//    그러면 (QSC/기준)^ψ = 1이 되어 후보지 예측값이 **한 톨도 안 바뀐다.** 바뀌는 건
//    기존점 쪽 설명력뿐이다. 이건 처음부터 알고 시작한 것이다.
//
// 그래서 **채택 = 사용자 결정**이다. 켜면 얻는 것과 치르는 것:
//   얻는 것 — 기존점 오차의 18%가 이름을 갖는다. 실험실 MAPE 23.72% -> 20.61%.
//             앞으로 다른 항목을 검정할 때 관리 교란이 빠진 잔차에 대볼 수 있다.
//   치르는 것 — 후보지에는 항상 1배라 산식이 한 줄 길어지기만 한다. 화면에서 "이 항은
//             후보지에 영향이 없다"를 설명해야 한다(안 하면 사람이 오해한다).
//
// ⚠️ 표본 23곳(실험실) / 29곳(운영)이다. 얇다. 표본이 45~50곳으로 늘면 다시 돌린다.
// ══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  computeCompetitorInvestigationSummary,
  computeSpecScore,
  computeOwnZoneComposition,
  computeCompetitorZoneComposition,
  computeLocationScoreFromFacts,
  type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { rivalDistanceM } from "./labInput";
import { defaultModelSettings, mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { computeQualityScore, DEFAULT_TEXTBOOK_PARAMS, type QualityParts } from "./textbookModel";
import type { Competitor } from "./types";

const SNAP = ".local-tools/validation-snapshot.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = hasValidationSnapshot() && [SNAP, QSC_FILE, FLOAT_FILE, RESI_FILE, UTIL_FILE].every((f) => existsSync(f));
const describeIf = ready ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
/** 기하평균 — 곱셈 보정의 기준값은 로그 공간의 중심이어야 중립이다(textbookModel 주석 참고). */
const geo = (a: number[]) => Math.exp(mean(a.map((v) => Math.log(v))));
function pear(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : NaN;
}
function spear(xs: number[], ys: number[]) {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i + 1;
    return r;
  };
  return pear(rank(xs), rank(ys));
}
/** 평가창 시점을 통제한 편상관 — 코호트 교란을 걷어낸다(개점 코호트 교란 메모 참고). */
function partial(x: number[], y: number[], z: number[]) {
  const rxy = pear(x, y), rxz = pear(x, z), ryz = pear(y, z);
  return (rxy - rxz * ryz) / Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
}

type QscSite = {
  name: string; openedAt: string;
  inWindowCount: number; inWindowAvg: number | null;
  allCount: number; records: { date: string; score: number }[];
};

// 수요 환산 비중 — _locationRebuild.test.ts와 같은 값을 쓴다(같은 실험실 모델이다).
const RM = { t: 0.39, tw: 0.42, th: 0.17, f: 0.1 }, RF = { t: 0.13, tw: 0.15, th: 0.045, f: 0.02 };
const bl = (m: number) => ({
  t: m * RM.t + (1 - m) * RF.t, tw: m * RM.tw + (1 - m) * RF.tw,
  th: m * RM.th + (1 - m) * RF.th, f: m * RM.f + (1 - m) * RF.f,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("QSC 잔차 검정 — 산식이 못 맞힌 부분을 점검 점수가 설명하는가", () => {
  const snap = loadValidationSnapshot<any>();
  const Q = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
  const F = (() => { const j = JSON.parse(readFileSync(FLOAT_FILE, "utf8")); return j.sites ?? j; })();
  const R = (() => { const j = JSON.parse(readFileSync(RESI_FILE, "utf8")); return j.sites ?? j; })();
  const U = JSON.parse(readFileSync(UTIL_FILE, "utf8"));
  const settings = mergeModelSettings(snap.settings);
  const set = defaultModelSettings();
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);

  /** 평가창 안 평균. 없으면 null — 전체기간 평균으로 메우지 않는다(다른 것을 재는 값이다). */
  const qscIn = (code: string): number | null => {
    const q = Q[`existing:${code}`];
    return q && q.inWindowCount > 0 && q.inWindowAvg != null && q.inWindowAvg > 0 ? q.inWindowAvg : null;
  };
  /** 전체기간 평균 — 참고용. 평가창 밖 점검이 섞인다. */
  const qscAll = (code: string): number | null => {
    const q = Q[`existing:${code}`];
    if (!q?.records?.length) return null;
    const v = mean(q.records.map((r) => r.score));
    return v > 0 ? v : null;
  };

  const openedBy = new Map((snap.existingStores as any[]).map((s) => [s.storeCode, s.openedAt]));
  /** 평가창 한가운데 시점(월 단위). 코호트 통제용 — 개점 다음 달~12개월의 중앙이다. */
  const midMonth = (code: string): number => {
    const o = openedBy.get(code);
    if (!o) return 0;
    const d = new Date(o);
    return d.getFullYear() * 12 + d.getMonth() + 6.5;
  };

  // ══ (가) 운영 V62 경로 — storedAccuracyParity.test.ts와 같다. 새 산식을 만들지 않는다.
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByLookup = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByLookup.set(c.candidateCode, [...(compsByLookup.get(c.candidateCode) ?? []), c]);
  const locByLookup = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = (snap.sales as any[]).filter((s) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));

  const vInputs: ValidationStoreInput[] = stores.map((s: any) => {
    const lookupCode = existingStoreSourceCode(s);
    const loc = locByLookup.get(lookupCode) ?? null;
    const competitors = compsByLookup.get(lookupCode) ?? [];
    return {
      storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0, franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand,
        { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore },
        competitors, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg, specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null, preemptionScore: loc?.preemptionScore ?? null,
      hasLocationEvaluation: loc != null, floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(competitors), sheetV61Predicted: s.v61Predicted,
    };
  });
  const v62 = runUsageCohortValidation(vInputs, sales as any, settings);
  const pcByCode = new Map(vInputs.map((v) => [v.storeCode, Number(v.evaluationPcCount ?? v.pcCount ?? 0)]));
  const coreRows = (v62.rows as any[]).filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy
    && r.v62PredictedRevenueAvg != null && r.v62PredictedRevenueAvg > 0
    && r.actualRevenueAvg != null && r.actualRevenueAvg > 0);

  // ══ (나) 실험실 교과서식 경로 — _locationRebuild.test.ts와 같은 행을 만든다.
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const W = P.qualityWeights;
  const compsBy = new Map<string, any[]>();
  for (const c of snap.competitors as any[]) {
    if (!compsBy.has(c.candidateCode)) compsBy.set(c.candidateCode, []);
    compsBy.get(c.candidateCode)!.push(c);
  }
  const ownParts = (s: any, pc: number): QualityParts => ({
    spec: computeSpecScore({
      vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
      cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
      ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
      monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
    }, set),
    food: s.ownFoodScore ?? null,
    zone: computeOwnZoneComposition({
      counts: {
        singleSeatCount: s.ownSingleSeatCount ?? null, room1: s.ownRoom1 ?? null, room2: s.ownRoom2 ?? null,
        teamRoom: s.ownTeamRoom ?? null, coupleZone: s.ownCoupleZone ?? null, vipZone: s.ownVipZone ?? null,
        friendsZone: s.ownFriendsZone ?? null, firstClassZone: s.ownFirstClassZone ?? null,
      },
      teamRoomTotalSeats: s.ownTeamRoomTotalSeats ?? null, totalPcCount: pc,
    }).composition,
    interior: s.ownInteriorScore ?? null,
    management: s.ownManagementScore ?? null,
  });
  const rivalParts = (c: any): QualityParts => ({
    spec: computeSpecScore({
      vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
      cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
      ram: c.ram ?? null, ramTop: c.ramTop ?? null,
      monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
    }, set),
    food: c.foodScore ?? null,
    zone: computeCompetitorZoneComposition({
      counts: {
        singleSeatCount: c.singleSeatCount ?? null, room1: c.room1 ?? null, room2: c.room2 ?? null,
        teamRoom: c.teamRoom ?? null, coupleZone: c.coupleZone ?? null, vipZone: c.vipZone ?? null,
        friendsZone: c.friendsZone ?? null, firstClassZone: c.firstClassZone ?? null,
      },
      regularCoupleSeatCount: c.regularCoupleSeatCount ?? null,
      teamRoomTotalSeats: c.teamRoomTotalSeats ?? null,
      totalPcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
    } as any).composition,
    interior: c.interiorScore ?? null,
    management: c.managementScore ?? null,
  });

  type Row = {
    code: string; n: string; pc: number; parts: QualityParts; floorScore: number | null;
    rivals: { ip: number; d: number; parts: QualityParts }[];
    demand: number; util: number; t: number; cent: number | null; shareObs: number;
  };
  const labRows: Row[] = [];
  for (const s of snap.existingStores as any[]) {
    const pc = s.evaluationPcCount ?? s.pcCount; if (!pc) continue;
    const g = U[s.storeName]; if (!g?.rows?.length) continue;
    const k = `existing:${s.storeCode}`, fv = F[k], rv = R[k]; if (!fv || !rv) continue;
    const p = rv.radii?.["1000"]?.pops; if (p?.age_2_cnt == null) continue;
    const rm = p.woman_cnt != null && Number(p.tot_ppltn_cnt) > 0 ? 1 - Number(p.woman_cnt) / Number(p.tot_ppltn_cnt) : 0.5;
    const RR = bl(rm);
    const pop = Number(p.age_2_cnt) * RR.t + Number(p.age_3_cnt) * RR.tw + Number(p.age_4_cnt) * RR.th + Number(p.age_5_cnt) * RR.f;
    const f4 = fv.radii?.["400"]; if (!f4?.selected?.length || !f4.demographics) continue;
    const last = f4.selected[f4.selected.length - 1];
    const scl = last > 0 ? mean(f4.selected.slice(-12)) / last : 1;
    const d = f4.demographics, FR = bl(d.total > 0 ? d.male / d.total : 0.5);
    const env = ((d.age10s ?? 0) * FR.t + (d.age20s ?? 0) * FR.tw + (d.age30s ?? 0) * FR.th + (d.age40s ?? 0) * FR.f) * scl;
    const sel3 = fv.radii?.["300"]?.selected, sel10 = fv.radii?.["1000"]?.selected;
    const cent = sel3?.length && sel10?.length && mean(sel10.slice(-12)) > 0
      ? (mean(sel3.slice(-12)) / mean(sel10.slice(-12))) * (1000 / 300) ** 2 : null;
    const win = g.rows.map((r: any) => r.yearMonth).sort();
    const mid = win[Math.floor(win.length / 2)];
    labRows.push({
      code: s.storeCode, n: s.storeName, pc, parts: ownParts(s, pc),
      floorScore: computeLocationScoreFromFacts(s.floor ?? null, s.groundLevel ?? null, s.hasElevator ?? null),
      rivals: (compsBy.get(s.storeCode) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음")
        .map((c) => ({ ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0), d: rivalDistanceM(s, c) ?? 0, parts: rivalParts(c) }))
        .filter((r) => r.ip > 0),
      demand: pop + env * 0.15, util: mean(g.rows.map((r: any) => r.monthlyRate)),
      t: Number(mid.slice(0, 4)) * 12 + Number(mid.slice(5, 7)), cent, shareObs: 0,
    });
  }
  const monoRows = labRows.filter((r) => !r.rivals.length);
  const A = med(monoRows.map((r) => r.util / (r.demand / (r.pc * 720))));
  for (const r of labRows) r.shareObs = r.util / (A * r.demand / (r.pc * 720));
  const cmp = labRows.filter((r) => r.rivals.length);
  const fRefAll = med(labRows.map((r) => r.floorScore).filter((v): v is number => v != null));

  /** 품질 점유율 — 새 경쟁 항(2026-09-17 채택). */
  const qualShare = (r: Row) => {
    const oq = computeQualityScore(r.parts, W);
    let riv = 0;
    for (const x of r.rivals) {
      if (x.d > P.effectiveRadiusM) continue;
      const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
      riv += x.ip * Math.pow(q, P.qualityExponent);
    }
    return r.pc / (r.pc + riv);
  };
  /** 지금 채택된 입지 항까지 반영한 예측 점유율 — κ=0.25 · ν=0.25. */
  const locShare = (r: Row) => {
    const fs = r.floorScore ?? fRefAll;
    const acc = Math.pow(fs / P.locationReferences.access, P.locationExponents.access);
    const ct = r.cent == null ? 1 : Math.pow(r.cent / P.locationReferences.centrality, P.locationExponents.centrality);
    return qualShare(r) * acc * ct;
  };

  it("(1) QSC 매칭 현황 — 무엇을 몇 곳에서 잴 수 있나", () => {
    const withIn = coreRows.filter((r) => qscIn(r.storeCode) != null);
    const withAll = coreRows.filter((r) => qscAll(r.storeCode) != null);
    const labIn = cmp.filter((r) => qscIn(r.code) != null);
    console.log(`\n기존점 ${snap.existingStores.length}곳 · QSC 기록 ${Object.keys(Q).length}곳`);
    console.log(`운영 V62 정식검증군 ${coreRows.length}곳`);
    console.log(`  평가창 안 QSC ${withIn.length}곳 (유의선 ${(2 / Math.sqrt(withIn.length)).toFixed(3)})`);
    console.log(`  전체기간 QSC ${withAll.length}곳 (유의선 ${(2 / Math.sqrt(withAll.length)).toFixed(3)})`);
    console.log(`실험실 표본 ${labRows.length}곳 중 경쟁상권 ${cmp.length}곳`);
    console.log(`  평가창 안 QSC ${labIn.length}곳 (유의선 ${(2 / Math.sqrt(Math.max(labIn.length, 1))).toFixed(3)})`);
    const vs = withIn.map((r) => qscIn(r.storeCode)!);
    console.log(`  평가창 QSC 분포 — 최소 ${Math.min(...vs).toFixed(1)} · 중앙 ${med(vs).toFixed(1)} · 기하평균 ${geo(vs).toFixed(2)} · 최대 ${Math.max(...vs).toFixed(1)}`);
    expect(withIn.length).toBeGreaterThan(10);
  });

  it("(2) 운영 V62의 예측오차를 QSC가 설명하나", () => {
    // 잔차 = 실제 ÷ 예측. 1보다 크면 산식이 **과소예측**한 곳이다.
    // QSC가 설명한다면 "점검 점수가 높을수록 산식이 과소예측"이어야 한다 -> 양의 상관.
    type Pt = { n: string; q: number; res: number; t: number; pc: number };
    const build = (get: (c: string) => number | null): Pt[] => coreRows
      .map((r) => {
        const q = get(r.storeCode);
        return q == null ? null : {
          n: r.storeName as string, q, res: r.actualRevenueAvg / r.v62PredictedRevenueAvg,
          t: midMonth(r.storeCode), pc: pcByCode.get(r.storeCode) ?? 0,
        };
      })
      .filter((p): p is Pt => p != null);

    const show = (label: string, ps: Pt[]) => {
      if (ps.length < 10) { console.log(`\n${label}: 표본 ${ps.length}곳 — 부족`); return; }
      const sig = 2 / Math.sqrt(ps.length);
      const lq = ps.map((p) => Math.log(p.q)), lr = ps.map((p) => Math.log(p.res)), t = ps.map((p) => p.t);
      const r = pear(lq, lr), rs = spear(ps.map((p) => p.q), ps.map((p) => p.res)), rp = partial(lq, lr, t);
      const mk = (v: number) => (Math.abs(v) >= sig ? " *" : "  ");
      console.log(`\n══ ${label} (n=${ps.length} · 유의선 ${sig.toFixed(3)}) ══`);
      console.log(`  log(QSC) ↔ log(실제÷예측)    r = ${r.toFixed(3)}${mk(r)}`);
      console.log(`  순위(스피어만)               r = ${rs.toFixed(3)}${mk(rs)}`);
      console.log(`  평가창 시점 통제 편상관      r = ${rp.toFixed(3)}${mk(rp)}`);
      console.log(`  [교란] QSC ↔ 평가창시점 ${pear(lq, t).toFixed(3)} · QSC ↔ PC대수 ${pear(lq, ps.map((p) => p.pc)).toFixed(3)}`);
      console.log(`  잔차 ${Math.min(...ps.map((p) => p.res)).toFixed(3)}~${Math.max(...ps.map((p) => p.res)).toFixed(3)} · MAPE ${(mean(ps.map((p) => Math.abs(p.res - 1))) * 100).toFixed(2)}%`);
      const lo = [...ps].sort((a, b) => a.q - b.q).slice(0, 5);
      const hi = [...ps].sort((a, b) => b.q - a.q).slice(0, 5);
      console.log(`  QSC 낮은 5곳 잔차 중앙 ${med(lo.map((p) => p.res)).toFixed(3)} (${lo.map((p) => `${p.n} ${p.q.toFixed(0)}점 ${p.res.toFixed(2)}`).join(" · ")})`);
      console.log(`  QSC 높은 5곳 잔차 중앙 ${med(hi.map((p) => p.res)).toFixed(3)} (${hi.map((p) => `${p.n} ${p.q.toFixed(0)}점 ${p.res.toFixed(2)}`).join(" · ")})`);
      // ── "관리가 매출에 얼마인가" — 인계 문서 5절이 이 검정의 목적으로 든 항목 ──────
      // log-log 회귀 기울기 = 탄력도. "QSC가 1% 높으면 매출이 몇 % 높나"다.
      const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
      const slope = r * (sd(lr) / sd(lq));
      const at = (q: number) => Math.pow(q / geo(ps.map((p) => p.q)), slope);
      console.log(`  [탄력도] QSC 1% ↑ -> 매출 ${slope.toFixed(2)}% ↑ · r² ${(r * r * 100).toFixed(1)}% 설명`);
      console.log(`  [환산] 기하평균 ${geo(ps.map((p) => p.q)).toFixed(1)}점 대비 — ` +
        [85, 90, 95, 100].map((q) => `${q}점 ${((at(q) - 1) * 100).toFixed(1)}%`).join(" · "));
      const r2 = ps.map((p) => p.res / at(p.q));
      console.log(`  [잔여] QSC로 설명한 몫을 빼면 MAPE ${(mean(ps.map((p) => Math.abs(p.res - 1))) * 100).toFixed(2)}% -> ${(mean(r2.map((v) => Math.abs(v - 1))) * 100).toFixed(2)}%` +
        `  ⚠️ 표본 안 값이다(홀드아웃 아님)`);
    };
    show("평가창 안 QSC — 본 후보", build(qscIn));
    show("전체기간 QSC — 참고(평가창 밖 점검이 섞인다)", build(qscAll));
    expect(coreRows.length).toBeGreaterThan(10);
  });

  it("(3) 실험실 점유율 잔차를 QSC가 설명하나 — 계수를 넣을 자리다", () => {
    // 여기가 (QSC/기준)^ψ를 곱할 자리다. 세 단계로 벗겨 본다 —
    // 앞 항을 반영할수록 사라지면 "이미 다른 항이 먹고 있는 신호"다(편심도가 그랬다).
    const stages: [string, (r: Row) => number][] = [
      ["아무것도 없이 (품질 점유율만)", qualShare],
      ["접근성 κ=0.25까지", (r) => qualShare(r) * Math.pow((r.floorScore ?? fRefAll) / P.locationReferences.access, P.locationExponents.access)],
      ["접근성 + 중심도 ν=0.25 (지금 산식)", locShare],
    ];
    const ps = cmp.filter((r) => qscIn(r.code) != null);
    console.log(`\n경쟁상권 ${cmp.length}곳 중 평가창 QSC 있는 ${ps.length}곳 · 유의선 ${(2 / Math.sqrt(ps.length)).toFixed(3)}`);
    const sig = 2 / Math.sqrt(ps.length);
    const lq = ps.map((r) => Math.log(qscIn(r.code)!)), t = ps.map((r) => r.t);
    for (const [label, pred] of stages) {
      const lr = ps.map((r) => Math.log(r.shareObs / pred(r)));
      const r = pear(lq, lr), rp = partial(lq, lr, t);
      const mk = (v: number) => (Math.abs(v) >= sig ? " *" : "  ");
      console.log(`  ${label.padEnd(34)} 잔차 r = ${r.toFixed(3)}${mk(r)} · 시점통제 ${rp.toFixed(3)}${mk(rp)}`);
    }
    console.log(`  [겹침] QSC ↔ 중심도 r = ${pear(lq, ps.map((r) => Math.log(r.cent ?? 1))).toFixed(3)} · QSC ↔ 층수자 r = ${pear(lq, ps.map((r) => r.floorScore ?? fRefAll)).toFixed(3)}`);
    console.log(`  [겹침] QSC ↔ 경쟁력점수 r = ${pear(lq, ps.map((r) => computeQualityScore(r.parts, W) ?? 0)).toFixed(3)}`);
    expect(ps.length).toBeGreaterThan(10);
  });

  it("(4) 계수 ψ — 관문(LOO·5겹·무작위 대조군)을 통과하나", () => {
    // 점유율 = [품질] x (층수자÷기준)^κ x (중심도÷기준)^ν x **(QSC÷기준)^ψ**
    // κ·ν는 이미 채택된 값으로 고정한다. ψ만 자유로 푼다 — 세 개를 다 풀기엔 표본이 없다.
    const ps = cmp.filter((r) => qscIn(r.code) != null);
    if (ps.length < 15) { console.log(`\n표본 ${ps.length}곳 — 관문을 걸 수 없다`); return; }
    type Q = { n: string; base: number; q: number; obs: number };
    const qRef = geo(ps.map((r) => qscIn(r.code)!));
    const set2: Q[] = ps.map((r) => ({ n: r.n, base: locShare(r), q: qscIn(r.code)!, obs: r.shareObs }));
    console.log(`\n══ ψ 관문 (n=${set2.length} · QSC 기하평균 기준 ${qRef.toFixed(2)}점) ══`);

    // ψ는 크게 잡는다 — QSC는 79~100으로 변동계수가 아주 작아(약 6%) 같은 효과를 내려면
    // 지수가 커야 한다. ⚠️ 큰 지수는 이상점에서 오차를 증폭시킨다(300m/500m 중심도가 그랬다).
    const PSI = [0, 0.5, 1, 2, 3, 5, 8, 12];
    const pred = (q: Q, psi: number) => q.base * Math.pow(q.q / qRef, psi);
    const mape = (s: Q[], psi: number) => mean(s.map((q) => Math.abs(pred(q, psi) / q.obs - 1)));
    const corr = (s: Q[], psi: number) => pear(s.map((q) => pred(q, psi)), s.map((q) => q.obs));
    const sc = (s: Q[], crit: "mape" | "r", psi: number) => (crit === "mape" ? mape(s, psi) : -corr(s, psi));
    const pick = (s: Q[], crit: "mape" | "r") => {
      let b = { psi: PSI[0], val: Infinity };
      for (const psi of PSI) { const x = sc(s, crit, psi); if (x < b.val) b = { psi, val: x }; }
      return b;
    };

    console.log(`  ${"ψ".padStart(4)}${"MAPE".padStart(10)}${"r".padStart(9)}${"편향".padStart(10)}`);
    for (const psi of PSI) {
      const bias = mean(set2.map((q) => pred(q, psi) / q.obs - 1));
      console.log(`  ${String(psi).padStart(4)}${(mape(set2, psi) * 100).toFixed(2).padStart(9)}%${corr(set2, psi).toFixed(3).padStart(9)}${(bias * 100).toFixed(1).padStart(9)}%`);
    }
    const bm = pick(set2, "mape"), br = pick(set2, "r");
    console.log(`  표본 안 최선 — MAPE 기준 ψ=${bm.psi} · r 기준 ψ=${br.psi}`);

    // 잭나이프 — 한 곳이 만든 값인지
    const jk = set2.map((_, i) => {
      const s2 = set2.filter((_, j) => j !== i);
      return pear(s2.map((q) => pred(q, bm.psi)), s2.map((q) => q.obs));
    });
    console.log(`  한 곳 빼면 r ${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)} (유의선 ${(2 / Math.sqrt(set2.length - 1)).toFixed(3)})`);

    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: string[] = [];
      for (let i = 0; i < set2.length; i++) {
        const b = pick(set2.filter((_, j) => j !== i), crit);
        picks.push(`ψ${b.psi}`);
        const ph = pred(set2[i], b.psi);
        preds.push(ph); errs.push(Math.abs(ph / set2[i].obs - 1));
      }
      const ins = pick(set2, crit);
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  LOO [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mape(set2, ins.psi) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}% (벌어짐 ${((mean(errs) - mape(set2, ins.psi)) * 100).toFixed(2)}%p) · LOO r=${pear(preds, set2.map((q) => q.obs)).toFixed(3)}`);
      console.log(`      고른 값: ${tally.slice(0, 3).map(([x, n]) => `${x} ${Math.round(n / set2.length * 100)}%`).join(" · ")}`);
    }

    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuf = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };
    for (const crit of ["mape", "r"] as const) {
      const picks: string[] = [];
      for (let rep = 0; rep < 100; rep++) {
        const idx = shuf(set2.map((_, i) => i));
        for (let f = 0; f < 5; f++) picks.push(`ψ${pick(idx.filter((_, j) => j % 5 !== f).map((i) => set2[i]), crit).psi}`);
      }
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  5겹 [${crit === "mape" ? "MAPE" : "r"}] ${tally.slice(0, 3).map(([x, n]) => `${x} ${(n / picks.length * 100).toFixed(0)}%`).join(" · ")}`);
    }

    // 대조군 — QSC만 매장끼리 섞는다. 기준선은 ψ=0(QSC 없음).
    for (const crit of ["mape", "r"] as const) {
      const gain = (s: Q[]) => sc(s, crit, 0) - sc(s, crit, pick(s, crit).psi);
      const real = gain(set2);
      const gs: number[] = [];
      for (let i = 0; i < 500; i++) { const pool = shuf(set2.map((q) => q.q)); gs.push(gain(set2.map((q, j) => ({ ...q, q: pool[j] })))); }
      gs.sort((a, b) => a - b);
      const pv = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
      const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  대조군 [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gs))} · 95퍼센타일 ${f(gs[Math.floor(gs.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    expect(set2.length).toBeGreaterThan(10);
  });

  it("(5) κ·ν를 같이 풀면 — 다른 계수가 관리 교란에서 풀려나나", () => {
    // 인계 문서 5절이 QSC를 재는 이유로 든 것 중 하나: "다른 계수들이 관리 교란에서 풀려남".
    // ψ를 켠 채로 κ(접근성)·ν(중심도)를 **다시 자유로 푼다.** 셋을 동시에 푸는 건 표본 23곳에
    // 자유도 셋이라 과적합 위험이 크다 — 그래서 **채택값을 고르는 자리가 아니라**
    // "QSC를 넣어도 κ=0.25·ν=0.25가 그대로 남나"를 보는 자리다.
    //
    // ⚠️ ψ 격자도 여기서 촘촘하게 본다. (4)는 0/0.5/1/2/3/5/8/12로 성겼다.
    const ps = cmp.filter((r) => qscIn(r.code) != null);
    if (ps.length < 15) { console.log(`\n표본 ${ps.length}곳 — 건너뜀`); return; }
    const qRef = geo(ps.map((r) => qscIn(r.code)!));
    type Q3 = { n: string; base: number; fs: number; ct: number; q: number; obs: number };
    const set3: Q3[] = ps.map((r) => ({
      n: r.n, base: qualShare(r), fs: r.floorScore ?? fRefAll,
      ct: r.cent ?? P.locationReferences.centrality, q: qscIn(r.code)!, obs: r.shareObs,
    }));
    const pred = (q: Q3, k: number, v: number, psi: number) =>
      q.base * Math.pow(q.fs / P.locationReferences.access, k)
        * Math.pow(q.ct / P.locationReferences.centrality, v) * Math.pow(q.q / qRef, psi);
    const mape = (s: Q3[], k: number, v: number, psi: number) => mean(s.map((q) => Math.abs(pred(q, k, v, psi) / q.obs - 1)));
    const corr = (s: Q3[], k: number, v: number, psi: number) => pear(s.map((q) => pred(q, k, v, psi)), s.map((q) => q.obs));

    console.log(`\n══ ψ 촘촘한 격자 (κ=0.25·ν=0.25 고정 · n=${set3.length}) ══`);
    console.log(`  ${"ψ".padStart(5)}${"MAPE".padStart(10)}${"r".padStart(9)}`);
    for (let psi = 0; psi <= 5.0001; psi += 0.25) {
      console.log(`  ${psi.toFixed(2).padStart(5)}${(mape(set3, 0.25, 0.25, psi) * 100).toFixed(2).padStart(9)}%${corr(set3, 0.25, 0.25, psi).toFixed(3).padStart(9)}`);
    }

    const KAP = [0, 0.25, 0.5, 0.75], NU = [0, 0.25, 0.5, 0.75], PSI2 = [0, 1, 2, 2.5, 3, 4];
    const pick3 = (s: Q3[], crit: "mape" | "r") => {
      let b = { k: 0, v: 0, psi: 0, val: Infinity };
      for (const k of KAP) for (const v of NU) for (const psi of PSI2) {
        const x = crit === "mape" ? mape(s, k, v, psi) : -corr(s, k, v, psi);
        if (x < b.val) b = { k, v, psi, val: x };
      }
      return b;
    };
    console.log(`\n══ 셋을 같이 풀면 (κ·ν·ψ 자유 · 과적합 위험 — 채택용이 아니다) ══`);
    for (const crit of ["mape", "r"] as const) {
      const b = pick3(set3, crit);
      console.log(`  ${crit === "mape" ? "MAPE" : "r   "} 기준 최선: κ=${b.k} · ν=${b.v} · ψ=${b.psi} → MAPE ${(mape(set3, b.k, b.v, b.psi) * 100).toFixed(2)}% · r ${corr(set3, b.k, b.v, b.psi).toFixed(3)}`);
      // LOO로 같은 격자를 돌려 안정성을 본다 — 표본 안 최선만 보면 과적합을 못 본다.
      const errs: number[] = [], picks: string[] = [];
      for (let i = 0; i < set3.length; i++) {
        const bb = pick3(set3.filter((_, j) => j !== i), crit);
        picks.push(`κ${bb.k}/ν${bb.v}/ψ${bb.psi}`);
        errs.push(Math.abs(pred(set3[i], bb.k, bb.v, bb.psi) / set3[i].obs - 1));
      }
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`      LOO ${(mean(errs) * 100).toFixed(2)}% (벌어짐 ${((mean(errs) - mape(set3, b.k, b.v, b.psi)) * 100).toFixed(2)}%p) · 고른 값 ${tally.slice(0, 3).map(([x, n]) => `${x} ${Math.round(n / set3.length * 100)}%`).join(" · ")}`);
    }
    console.log(`  [대조] ψ=0으로 같은 격자: MAPE 기준 κ=${pick3(set3.map((q) => ({ ...q })), "mape").k}...`);
    const noQsc = (() => {
      let b = { k: 0, v: 0, val: Infinity };
      for (const k of KAP) for (const v of NU) { const x = mape(set3, k, v, 0); if (x < b.val) b = { k, v, val: x }; }
      return b;
    })();
    console.log(`  QSC 없이(ψ=0) MAPE 기준 최선: κ=${noQsc.k} · ν=${noQsc.v} → ${(mape(set3, noQsc.k, noQsc.v, 0) * 100).toFixed(2)}%`);
    expect(set3.length).toBeGreaterThan(10);
  });

  it("(6) QSC ↔ 경쟁력점수 겹침의 정체 — 관리 항목과 같은 걸 재고 있나", () => {
    // (3)에서 QSC ↔ 경쟁력점수 r=0.385가 나왔다. 그냥 두면 "QSC를 넣었더니 좋아졌다"가
    // 실은 "경쟁력점수를 두 번 넣었다"일 수 있다. 다섯 항목 각각과 대본다.
    //
    // ⚠️ 자사 41곳의 인테리어·관리·먹거리는 **전부 4점**이다(2026-09-17 확인, 의도된 설계).
    //    그러니 그 셋과는 상관이 정의되지 않는다(상수). 남는 건 스펙과 존구성이다.
    const ps = cmp.filter((r) => qscIn(r.code) != null);
    const lq = ps.map((r) => Math.log(qscIn(r.code)!));
    const sig = 2 / Math.sqrt(ps.length);
    console.log(`\n경쟁상권·평가창QSC ${ps.length}곳 · 유의선 ${sig.toFixed(3)}`);
    const items: [string, (r: Row) => number | null][] = [
      ["스펙", (r) => r.parts.spec],
      ["먹거리", (r) => r.parts.food],
      ["존구성", (r) => r.parts.zone],
      ["인테리어", (r) => r.parts.interior],
      ["관리", (r) => r.parts.management],
      ["경쟁력점수(합)", (r) => computeQualityScore(r.parts, W)],
    ];
    for (const [label, get] of items) {
      const vs = ps.map(get);
      const ok = vs.every((v) => v != null);
      const uniq = new Set(vs.map((v) => (v == null ? "-" : v.toFixed(3)))).size;
      if (!ok || uniq < 2) { console.log(`  ${label.padEnd(16)} 값 ${uniq}개 — ${ok ? "상수라 상관이 정의되지 않는다" : "결측 있음"}`); continue; }
      const r = pear(lq, vs as number[]);
      console.log(`  ${label.padEnd(16)} 값 ${String(uniq).padStart(2)}개 · QSC와 r = ${r.toFixed(3)}${Math.abs(r) >= sig ? " *" : ""}`);
    }
    // 결정적인 자리 — 경쟁력점수를 통제하고도 QSC가 잔차를 설명하나.
    const lr = ps.map((r) => Math.log(r.shareObs / locShare(r)));
    const qs = ps.map((r) => computeQualityScore(r.parts, W) ?? 0);
    console.log(`\n  잔차 ↔ QSC            r = ${pear(lq, lr).toFixed(3)}`);
    console.log(`  경쟁력점수 통제 편상관 r = ${partial(lq, lr, qs).toFixed(3)}${Math.abs(partial(lq, lr, qs)) >= sig ? " *" : ""}`);
    console.log(`  (통제해도 남으면 QSC는 경쟁력점수의 그림자가 아니다)`);
    expect(ps.length).toBeGreaterThan(10);
  });
});
