"use client";

// 기존 가맹점 상세화면 "평가 비교" 탭 — 2026-09-01 신규(사용자 요청).
// "자사 평가항목/값이 쫙 나열되고, 아래에 경쟁점들 평가항목/값이 쫙 나오는" 한 화면 비교 리포트.
// 새 계산 로직은 전혀 만들지 않는다 — ExistingStoreProfileTab.tsx/CompetitorsTab.tsx가 이미
// 계산해서 보여주던 것과 완전히 같은 calc.ts 순수함수를 그대로 재사용하고, 편집 폼 대신 읽기전용
// 표로 한 화면에 모아 보여주기만 한다(입력값 대비 점수를 한눈에 대조하려는 목적).
import { useEffect, useMemo, useState } from "react";
import {
  applyStandardOwnFacilityDefaults,
  computeCompetitorAppliedPcCount,
  computeCompetitorAvgCompetitiveness,
  computeCompetitorScores,
  computeCompetitorZoneComposition,
  computeCompetitivenessGap,
  computeExistingStoreDemandEvaluation,
  computeFacilityScore,
  computeFoodScore,
  computeLocationScoreFromFacts,
  computeOwnLocationScore,
  computeOwnZoneComposition,
  computeSpecScore,
  EXISTING_STORE_FACILITY_DEFAULTS,
  lookupDemandCapture,
  resolveZoneCompositionScore,
  scoreFromCpuSpec,
  scoreFromMonitorSpec,
  scoreFromRamSpec,
  scoreFromVgaSpec,
} from "@/lib/storeEval/calc";
import { formatNumber, formatPercent, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getLocationEvaluation, getModelSettings, listCompetitors } from "@/lib/storeEval/store";
import type { Competitor, ExistingStore, LocationEvaluation, ModelSettings } from "@/lib/storeEval/types";

function fmt(v: number | string | null | undefined): string {
  if (v == null || v === "") return "-";
  return String(v);
}
function fmtScore(v: number | null): string {
  return v == null ? "-" : v.toFixed(2);
}

function computeOwnBreakdown(store: ExistingStore, settings: ModelSettings, loc: LocationEvaluation | null) {
  const facility = applyStandardOwnFacilityDefaults(store, EXISTING_STORE_FACILITY_DEFAULTS);
  const zoneComposition = resolveZoneCompositionScore(
    computeOwnZoneComposition({
      counts: {
        singleSeatCount: facility.ownSingleSeatCount,
        room1: facility.ownRoom1,
        room2: facility.ownRoom2,
        teamRoom: facility.ownTeamRoom,
        coupleZone: facility.ownCoupleZone,
        vipZone: facility.ownVipZone,
        friendsZone: facility.ownFriendsZone,
        firstClassZone: facility.ownFirstClassZone,
      },
      teamRoomTotalSeats: store.ownTeamRoomTotalSeats,
      totalPcCount: store.evaluationPcCount ?? store.pcCount,
    }).composition,
    store.ownSeatZoneScore,
  );
  const spec = computeSpecScore(
    {
      vgaBase: store.ownVgaBase,
      vgaTop: store.ownVgaTop,
      vgaTop2: store.ownVgaTop2,
      cpu: store.ownCpu,
      cpuTop1: store.ownCpuTop1,
      cpuTop2: store.ownCpuTop2,
      ram: store.ownRam,
      ramTop: store.ownRamTop,
      monitorBase: store.ownMonitorBase,
      monitorTop: store.ownMonitorTop,
    },
    settings,
  );
  const interior = computeFacilityScore(
    { zoneComposition, interiorScore: facility.ownInteriorScore, managementScore: facility.ownManagementScore },
    settings,
  );
  const food = computeFoodScore({ brand: store.ownFoodBrand, legacyScore: facility.ownFoodScore }, settings);
  const location = computeOwnLocationScore(loc, store, settings);
  const total =
    spec != null && food != null && interior != null && location != null
      ? spec * settings.competitivenessWeights.spec +
        food * settings.competitivenessWeights.food +
        interior * settings.competitivenessWeights.interior +
        location * settings.competitivenessWeights.location
      : null;
  return {
    vgaBase: store.ownVgaBase,
    vgaTop: [store.ownVgaTop, store.ownVgaTop2].filter(Boolean).join(", ") || null,
    vgaScore: scoreFromVgaSpec(store.ownVgaBase, store.ownVgaTop, store.ownVgaTop2),
    cpuBase: store.ownCpu,
    cpuTop: [store.ownCpuTop1, store.ownCpuTop2].filter(Boolean).join(", ") || null,
    cpuScore: scoreFromCpuSpec(store.ownCpu, store.ownCpuTop1, store.ownCpuTop2),
    ramBase: store.ownRam,
    ramTop: store.ownRamTop,
    ramScore: scoreFromRamSpec(store.ownRam, store.ownRamTop),
    monitorBase: store.ownMonitorBase,
    monitorTop: store.ownMonitorTop,
    monitorScore: scoreFromMonitorSpec(store.ownMonitorBase, store.ownMonitorTop),
    spec,
    zoneComposition,
    interiorScore: facility.ownInteriorScore,
    managementScore: facility.ownManagementScore,
    interior,
    foodBrand: store.ownFoodBrand,
    foodScore: facility.ownFoodScore,
    food,
    floor: store.floor,
    groundLevel: store.groundLevel,
    hasElevator: store.hasElevator,
    hasLocationEvaluation: loc != null,
    location,
    total,
  };
}

function computeCompetitorBreakdown(c: Competitor, settings: ModelSettings) {
  const computed = computeCompetitorScores(c, settings);
  const zoneComposition = computeCompetitorZoneComposition({
    counts: {
      teamRoom: c.teamRoom,
      room2: c.room2,
      coupleZone: c.coupleZone,
      vipZone: c.vipZone,
      friendsZone: c.friendsZone,
      singleSeatCount: c.singleSeatCount,
      room1: c.room1,
      firstClassZone: c.firstClassZone,
    },
    regularCoupleSeatCount: c.regularCoupleSeatCount,
    teamRoomTotalSeats: c.teamRoomTotalSeats,
    totalPcCount: computeCompetitorAppliedPcCount(c),
  }).composition;
  return {
    name: c.name,
    surveyLevel: c.surveyLevel,
    distanceM: c.distanceM,
    appliedPcCount: computeCompetitorAppliedPcCount(c),
    vgaBase: c.vgaBase,
    vgaTop: [c.vgaTop, c.vgaTop2].filter(Boolean).join(", ") || null,
    vgaScore: scoreFromVgaSpec(c.vgaBase, c.vgaTop, c.vgaTop2),
    cpuBase: c.cpu,
    cpuTop: [c.cpuTop1, c.cpuTop2].filter(Boolean).join(", ") || null,
    cpuScore: scoreFromCpuSpec(c.cpu, c.cpuTop1, c.cpuTop2),
    ramBase: c.ram,
    ramTop: c.ramTop,
    ramScore: scoreFromRamSpec(c.ram, c.ramTop),
    monitorBase: c.monitorBase,
    monitorTop: c.monitorTop,
    monitorScore: scoreFromMonitorSpec(c.monitorBase, c.monitorTop),
    spec: computed.spec,
    zoneComposition,
    interiorScore: c.interiorScore,
    managementScore: c.managementScore,
    interior: computed.interior,
    foodBrand: c.foodBrand,
    foodScore: c.foodScore,
    food: computed.food,
    floor: c.floor,
    groundLevel: c.groundLevel,
    location: computed.location ?? computeLocationScoreFromFacts(c.floor, c.groundLevel, c.hasElevator),
    total: computed.total,
  };
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-2 py-1.5 text-left text-xs font-medium text-[#8a8072]">{children}</th>;
}
function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`whitespace-nowrap px-2 py-1.5 text-xs ${strong ? "font-semibold text-[#171310] dark:text-[#f2ede2]" : ""}`}>{children}</td>;
}
function ItemValueScore({ value, score }: { value: string | null; score: number | null }) {
  return (
    <Td>
      {fmt(value)}
      {score != null && <span className="ml-1 text-[#8a8072]">({fmtScore(score)})</span>}
    </Td>
  );
}

export function ScorecardTab({ store, candidateCode }: { store: ExistingStore; candidateCode: string }) {
  const [settings, setSettings] = useState<ModelSettings>({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });
  const [loc, setLoc] = useState<LocationEvaluation | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getModelSettings(), getLocationEvaluation(candidateCode), listCompetitors(candidateCode)]).then(([s, l, c]) => {
      if (s) setSettings(s);
      setLoc(l);
      setCompetitors(c);
      setLoading(false);
    });
  }, [candidateCode]);

  const own = useMemo(() => computeOwnBreakdown(store, settings, loc), [store, settings, loc]);
  const competitorRows = useMemo(() => competitors.map((c) => computeCompetitorBreakdown(c, settings)), [competitors, settings]);
  const demandEval = useMemo(() => computeExistingStoreDemandEvaluation(store, competitors, loc, settings), [store, competitors, loc, settings]);
  const competitorAvg = useMemo(() => computeCompetitorAvgCompetitiveness(competitors, settings), [competitors, settings]);
  const gap = useMemo(() => computeCompetitivenessGap(own.total, competitorAvg), [own.total, competitorAvg]);
  const capture = useMemo(() => lookupDemandCapture(gap, settings.demandCaptureTable), [gap, settings.demandCaptureTable]);

  if (loading) return <p className="text-sm text-[#8a8072]">불러오는 중...</p>;

  return (
    <div className="flex flex-col gap-6">
      <section className="app-card rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">자사 — {store.storeName}</h3>
        <p className="mt-1 text-xs text-[#8a8072]">항목값 옆 괄호 안 숫자가 그 항목의 환산 점수입니다. 편집은 "기본정보" 탭에서 합니다.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#171310]/10 dark:border-white/10">
                <Th>GPU(기본/특화)</Th>
                <Th>CPU(기본/특화)</Th>
                <Th>RAM(기본/특화)</Th>
                <Th>모니터(기본/특화)</Th>
                <Th>하드웨어종합</Th>
                <Th>존구성</Th>
                <Th>인테리어</Th>
                <Th>관리</Th>
                <Th>시설종합</Th>
                <Th>먹거리(브랜드)</Th>
                <Th>입지</Th>
                <Th>경쟁력점수</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#171310]/5 dark:border-white/5">
                <ItemValueScore value={[own.vgaBase, own.vgaTop].filter(Boolean).join(" / ")} score={own.vgaScore} />
                <ItemValueScore value={[own.cpuBase, own.cpuTop].filter(Boolean).join(" / ")} score={own.cpuScore} />
                <ItemValueScore value={[own.ramBase, own.ramTop].filter(Boolean).join(" / ")} score={own.ramScore} />
                <ItemValueScore value={[own.monitorBase, own.monitorTop].filter(Boolean).join(" / ")} score={own.monitorScore} />
                <Td strong>{fmtScore(own.spec)}</Td>
                <Td>{fmtScore(own.zoneComposition)}</Td>
                <ItemValueScore value={own.interiorScore != null ? String(own.interiorScore) : null} score={own.interiorScore} />
                <ItemValueScore value={own.managementScore != null ? String(own.managementScore) : null} score={own.managementScore} />
                <Td strong>{fmtScore(own.interior)}</Td>
                <ItemValueScore value={own.foodBrand ?? (own.foodScore != null ? `직접입력 ${own.foodScore}` : null)} score={own.food} />
                <ItemValueScore
                  value={own.hasLocationEvaluation ? "입지동선평가 4요소" : `${fmt(own.floor)}층/${fmt(own.groundLevel)}/엘베${own.hasElevator ? "O" : "X"}`}
                  score={own.location}
                />
                <Td strong>{fmtScore(own.total)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-card rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">경쟁점 {competitors.length}곳</h3>
        {competitors.length === 0 ? (
          <p className="mt-2 text-xs text-[#8a8072]">등록된 경쟁점이 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#171310]/10 dark:border-white/10">
                  <Th>경쟁점명</Th>
                  <Th>조사수준</Th>
                  <Th>거리(m)</Th>
                  <Th>적용대수</Th>
                  <Th>GPU</Th>
                  <Th>CPU</Th>
                  <Th>RAM</Th>
                  <Th>모니터</Th>
                  <Th>하드웨어</Th>
                  <Th>존구성</Th>
                  <Th>인테리어</Th>
                  <Th>관리</Th>
                  <Th>시설종합</Th>
                  <Th>먹거리</Th>
                  <Th>입지</Th>
                  <Th>경쟁력점수</Th>
                </tr>
              </thead>
              <tbody>
                {competitorRows.map((c, i) => (
                  <tr key={i} className="border-b border-[#171310]/5 dark:border-white/5">
                    <Td strong>{c.name}</Td>
                    <Td>{fmt(c.surveyLevel)}</Td>
                    <Td>{fmt(c.distanceM)}</Td>
                    <Td>{fmt(c.appliedPcCount)}</Td>
                    <ItemValueScore value={[c.vgaBase, c.vgaTop].filter(Boolean).join(" / ")} score={c.vgaScore} />
                    <ItemValueScore value={[c.cpuBase, c.cpuTop].filter(Boolean).join(" / ")} score={c.cpuScore} />
                    <ItemValueScore value={[c.ramBase, c.ramTop].filter(Boolean).join(" / ")} score={c.ramScore} />
                    <ItemValueScore value={[c.monitorBase, c.monitorTop].filter(Boolean).join(" / ")} score={c.monitorScore} />
                    <Td strong>{fmtScore(c.spec)}</Td>
                    <Td>{fmtScore(c.zoneComposition)}</Td>
                    <ItemValueScore value={c.interiorScore != null ? String(c.interiorScore) : null} score={c.interiorScore} />
                    <ItemValueScore value={c.managementScore != null ? String(c.managementScore) : null} score={c.managementScore} />
                    <Td strong>{fmtScore(c.interior)}</Td>
                    <ItemValueScore value={c.foodBrand ?? (c.foodScore != null ? `직접입력 ${c.foodScore}` : null)} score={c.food} />
                    <ItemValueScore value={`${fmt(c.floor)}층/${fmt(c.groundLevel)}`} score={c.location} />
                    <Td strong>{fmtScore(c.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="app-card rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">점수가 매출에 미치는 영향</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-[#8a8072]">자사 경쟁력점수</p>
            <p className="mt-0.5 text-base font-semibold">{fmtScore(own.total)}</p>
          </div>
          <div>
            <p className="text-xs text-[#8a8072]">경쟁점 평균(대수가중)</p>
            <p className="mt-0.5 text-base font-semibold">{fmtScore(competitorAvg)}</p>
          </div>
          <div>
            <p className="text-xs text-[#8a8072]">경쟁력격차(자사÷경쟁점평균)</p>
            <p className="mt-0.5 text-base font-semibold">{gap != null ? gap.toFixed(2) : "-"}</p>
          </div>
          <div>
            <p className="text-xs text-[#8a8072]">수요확보율</p>
            <p className="mt-0.5 text-base font-semibold">{capture ? formatPercent(capture.captureRate) : "-"}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[#8a8072]">
          상권수요 <b>{formatNumber(demandEval.marketDemand)}명</b> 중, 자사·경쟁점 격차({gap != null ? gap.toFixed(2) : "-"})로 산출된 확보율(
          {capture ? formatPercent(capture.captureRate) : "-"})이 적용되어 자사수요 <b>{formatNumber(demandEval.ownDemand)}명</b>이 계산됩니다. 이
          자사수요가 V61 학습모형의 핵심 특징치 중 하나(log(상권수요/PC))로 그대로 들어가 최종 예상월매출에 반영됩니다 — 정확한 예측매출·산식
          단계별 근거는 <span className="font-medium">검증(/store-eval/validation)</span> 화면에서 이 매장을 펼쳐보면 확인할 수 있습니다. (참고 —
          실제 평균매출: {formatWon(store.actualMonthlyRevenueAvg)})
        </p>
      </section>
    </div>
  );
}
