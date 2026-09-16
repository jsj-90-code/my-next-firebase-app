// 교과서식 모델에 넣을 **입력 한 벌**을 만드는 곳. 실험실 화면(/store-eval/lab)과 측정
// 하네스가 **똑같은 이 코드**를 쓴다.
//
// ── 왜 따로 뺐나 (2026-09-16) ──────────────────────────────────────────────
// 하네스가 화면의 조립 코드를 베껴 쓰고 있었다. 그러다 입지 5항목이 **화면에만** 추가되면서
// 하네스는 `location`을 아예 안 넘기게 됐고, 그 상태로 잰 MAPE 54.6%가 한동안 "교과서식
// 성적"으로 돌아다녔다 — 입지가 빠진 숫자였다. 조립을 한 곳에 두면 이 종류의 사고가
// 구조적으로 안 난다. **새 항목을 화면에 붙이면 하네스도 자동으로 같이 본다.**
//
// ⚠️ 여기는 교과서식(실험실) 전용이다. 운영 산식(calc.ts / usageRevenue.ts)은 이 파일을
//    읽지 않는다 — 교과서식은 운영 산식을 덮지 않는다(2026-09-16 사용자 확정).

import {
  computeCompetitorIp,
  computeSpecScore,
  computeLocationScoreFromFacts,
  computeOwnZoneComposition,
  computeCompetitorZoneComposition,
} from "@/lib/storeEval/calc";
import { existingStoreSourceCode } from "@/lib/storeEval/existingStoreEvaluation";
import type { QualityParts, TextbookInput } from "@/lib/storeEval/textbookModel";
import type { Competitor, ExistingStore, ModelSettings } from "@/lib/storeEval/types";

export type LabRow = { input: TextbookInput; actualRevenue: number };

// ── 경쟁력 항목별 점수 뽑기 (2026-09-17) ──────────────────────────────────
//
// ⚠️ 사양·존구성은 **저장 필드가 아니라 파생값**이다. 스냅샷에 `ownSpecScore`가 없다고
//    "자료 없음"으로 읽어 2026-09-16에 한 번 틀렸다. 원자료는 멀쩡히 있고, 운영 산식과
//    **같은 함수**로 계산해야 자사·경쟁점이 같은 자에 놓인다.
//
// ⚠️ 입지는 여기 없다. 경쟁력점수 안에 섞으면 효과가 없었고(r 0.554 -> 0.562, 잭나이프
//    하한이 유의선 아래), 밖에서 곱해야 살아났다. buildLabRows의 `location`을 볼 것.
export function ownQualityParts(s: ExistingStore, pc: number | null, settings: ModelSettings): QualityParts {
  const zone = computeOwnZoneComposition({
    counts: {
      singleSeatCount: s.ownSingleSeatCount ?? null, room1: s.ownRoom1 ?? null, room2: s.ownRoom2 ?? null,
      teamRoom: s.ownTeamRoom ?? null, coupleZone: s.ownCoupleZone ?? null, vipZone: s.ownVipZone ?? null,
      friendsZone: s.ownFriendsZone ?? null, firstClassZone: s.ownFirstClassZone ?? null,
    },
    teamRoomTotalSeats: s.ownTeamRoomTotalSeats ?? null, totalPcCount: pc,
  });
  return {
    spec: computeSpecScore({
      vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
      cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
      ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
      monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
    }, settings),
    food: s.ownFoodScore ?? null,
    zone: zone.composition,
    interior: s.ownInteriorScore ?? null,
    management: s.ownManagementScore ?? null,
  };
}

export function rivalQualityParts(c: Competitor, settings: ModelSettings): QualityParts {
  const zone = computeCompetitorZoneComposition({
    counts: {
      singleSeatCount: c.singleSeatCount ?? null, room1: c.room1 ?? null, room2: c.room2 ?? null,
      teamRoom: c.teamRoom ?? null, coupleZone: c.coupleZone ?? null, vipZone: c.vipZone ?? null,
      friendsZone: c.friendsZone ?? null, firstClassZone: c.firstClassZone ?? null,
    },
    regularCoupleSeatCount: c.regularCoupleSeatCount ?? null,
    teamRoomTotalSeats: c.teamRoomTotalSeats ?? null,
    totalPcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
  });
  return {
    spec: computeSpecScore({
      vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
      cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
      ram: c.ram ?? null, ramTop: c.ramTop ?? null,
      monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
    }, settings),
    food: c.foodScore ?? null,
    zone: zone.composition,
    interior: c.interiorScore ?? null,
    management: c.managementScore ?? null,
  };
}

export type BuildLabRowsArgs = {
  /** prepareExistingStoresForEvaluation을 이미 통과한 기존점. */
  stores: ExistingStore[];
  /** 후보지코드 -> 경쟁점 목록. */
  compsByCode: Map<string, Competitor[]>;
  /** 매장코드 -> 실측 월평균 가동률(0~1). 수요 축척을 여기 맞춘다. */
  utilByStore: Map<string, number>;
  settings: ModelSettings;
};

/**
 * 학습·검증에 쓸 행을 만든다. 제외매장과 실매출 없는 곳은 빠진다.
 *
 * 값을 지어내지 않는다 — 자료가 없는 항목은 null로 넘기고, 모델이 그 항을 중립(1배)으로
 * 빼도록 둔다. 빠진 자리를 평균이나 0으로 메우면 "모른다"가 "나쁘다"로 둔갑한다.
 */
export function buildLabRows({ stores, compsByCode, utilByStore, settings }: BuildLabRowsArgs): LabRow[] {
  const rows: LabRow[] = [];
  for (const s of stores) {
    if (s.excludedFromModel || !s.actualMonthlyRevenueAvg) continue;
    const code = existingStoreSourceCode(s);
    const cs = compsByCode.get(code) ?? [];
    const sr = s as unknown as Record<string, number | null>;
    rows.push({
      actualRevenue: s.actualMonthlyRevenueAvg,
      input: {
        storeCode: s.storeCode, storeName: s.storeName,
        pcCount: s.evaluationPcCount ?? s.pcCount,
        hourlyRate: s.hourlyRate,
        actualUtilization: utilByStore.get(s.storeCode) ?? null,
        // 특수수요는 이제 **수요 산식 안에서** 배수로 쓴다(2026-09-16). 입지 보정이 아니다.
        specialDemandType: s.specialDemandType ?? null,
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        // 품질 모드용 — 거리로 걸러야 하므로 합계가 아니라 낱개로 넘긴다.
        ownQualityParts: ownQualityParts(s, s.evaluationPcCount ?? s.pcCount, settings),
        rivals: cs
          .filter((c) => c.investigationStatus !== "경쟁점없음")
          .map((c) => ({
            // 경쟁점 pcCount는 전 문서가 0이다 — appliedPcCount/totalPcCount를 써야 한다.
            ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0),
            distanceM: c.distanceM ?? null,
            parts: rivalQualityParts(c, settings),
          }))
          .filter((r) => r.ip > 0),
        // 입지 5항목 (2026-09-17). 기존 주관 3항목(상권위치·동선/선점경쟁/접근가시성)은 안 쓴다 —
        // 1~5점인데 실제로 3~4개 값만 쓰였고 셋 다 유의선 미달이었다.
        location: {
          // 상권 중심도 — 유동 300m/1km. 1보다 크면 우리 문 앞이 상권 평균보다 빽빽하다.
          centrality: s.floating300Avg != null && s.floating1000Avg != null && s.floating1000Avg > 0
            ? (s.floating300Avg / s.floating1000Avg) * (1000 / 300) ** 2
            : null,
          // 접근성 — 경쟁점과 **같은 함수**로 매긴다. 자사만 다른 자를 쓰면 뜻이 없어진다.
          access: computeLocationScoreFromFacts(s.floor ?? null, s.groundLevel ?? null, s.hasElevator ?? null),
          // 유동 방향 — 편심도 0~1. 0이면 사방이 고르고(상권 한가운데), 1에 가까울수록
          // 한쪽에만 몰렸다(상권 끝). 2026-09-16에 52곳 전부 채웠다.
          // ⚠️ 계수 ω는 0이라 지금은 계산에 안 들어간다 — 중심도가 이미 이 신호를 먹어
          // 대조군을 못 넘었다. 값을 보여주고 스위치로 켤 수 있게만 해 둔다.
          direction: s.flowEccentricity ?? null,
          // 아래 둘은 아직 자료원이 없다. 자리만 둔다 — 계수도 0이라 계산에 안 들어간다.
          flowBlock: null,
          visibility: null,
        },
        pop500m: s.pop500m, pop1km: s.pop1km,
        // 연령별 이용률을 지역 성비로 섞는 데 쓴다(2026-09-16). 성별 x 연령 교차 자료는
        // 존재하지 않으므로 "연령대 안 성비 = 지역 전체 성비"로 근사한다.
        residentMaleRatio: s.male1kmRatio ?? null,
        floatingMaleRatioByRadius: {
          100: s.floating100Avg ? (s.floating100Male ?? 0) / s.floating100Avg : null,
          200: s.floating200Avg ? (s.floating200Male ?? 0) / s.floating200Avg : null,
          300: s.floating300Avg ? (s.floating300Male ?? 0) / s.floating300Avg : null,
          400: s.floating400Avg ? (s.floating400Male ?? 0) / s.floating400Avg : null,
          500: s.floating500Avg ? (s.floating500Male ?? 0) / s.floating500Avg : null,
        },
        residentAges: {
          age0s: sr.age1km_0_9 ?? 0, age10s: sr.age1km_10_19 ?? 0, age20s: sr.age1km_20_29 ?? 0,
          age30s: sr.age1km_30_39 ?? 0, age40s: sr.age1km_40_49 ?? 0, age50s: sr.age1km_50_59 ?? 0,
          age60plus: (sr.age1km_60_69 ?? 0) + (sr.age1km_70_79 ?? 0) + (sr.age1km_80plus ?? 0),
        },
        // 2026-09-15 — 100/200/300/400m 수집 경로를 열었다(소상공인365 반경 선택). 아직 안 모은
        // 매장은 null이라 그 반경을 고르면 "자료없음"으로 빠진다.
        floatingByRadius: {
          100: s.floating100Avg ?? null,
          200: s.floating200Avg ?? null,
          300: s.floating300Avg ?? null,
          400: s.floating400Avg ?? null,
          500: s.floating500Avg,
        },
        floatingAgesByRadius: {
          100: s.floating100Avg == null ? null : {
            age10s: s.floating100_10s ?? 0, age20s: s.floating100_20s ?? 0,
            age30s: s.floating100_30s ?? 0, age40s: s.floating100_40s ?? 0,
            age50s: s.floating100_50s ?? 0, age60plus: s.floating100_60plus ?? 0,
          },
          200: s.floating200Avg == null ? null : {
            age10s: s.floating200_10s ?? 0, age20s: s.floating200_20s ?? 0,
            age30s: s.floating200_30s ?? 0, age40s: s.floating200_40s ?? 0,
            age50s: s.floating200_50s ?? 0, age60plus: s.floating200_60plus ?? 0,
          },
          300: s.floating300Avg == null ? null : {
            age10s: s.floating300_10s ?? 0, age20s: s.floating300_20s ?? 0,
            age30s: s.floating300_30s ?? 0, age40s: s.floating300_40s ?? 0,
            age50s: s.floating300_50s ?? 0, age60plus: s.floating300_60plus ?? 0,
          },
          400: s.floating400Avg == null ? null : {
            age10s: s.floating400_10s ?? 0, age20s: s.floating400_20s ?? 0,
            age30s: s.floating400_30s ?? 0, age40s: s.floating400_40s ?? 0,
            age50s: s.floating400_50s ?? 0, age60plus: s.floating400_60plus ?? 0,
          },
          500: {
            age10s: s.floating500_10s ?? 0, age20s: s.floating500_20s ?? 0,
            age30s: s.floating500_30s ?? 0, age40s: s.floating500_40s ?? 0,
            age50s: s.floating500_50s ?? 0, age60plus: s.floating500_60plus ?? 0,
          },
        },
      },
    });
  }
  return rows;
}
