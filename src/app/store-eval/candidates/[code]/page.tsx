"use client";

// 후보지 상세 화면 - 탭 4개(기본정보/경쟁점/입지동선평가/최종결과)를 URL query(?tab=)로 관리한다.

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getCandidate } from "@/lib/storeEval/store";
import type { CandidateInput } from "@/lib/storeEval/types";
import { BasicInfoTab } from "./BasicInfoTab";
import { CompetitorsTab } from "./CompetitorsTab";
import { LocationEvalTab } from "./LocationEvalTab";
import { ResultTab } from "./ResultTab";

// "new"는 실제 후보지코드(N001...) 형식과 겹치지 않는 예약어다 — 아직 코드가 발급되지 않은
// 신규 등록 draft를 나타낸다. 코드는 BasicInfoTab에서 첫 저장을 누르는 순간에만 발급된다.
const NEW_DRAFT_CODE = "new";

const TABS = [
  { key: "basic", label: "기본정보" },
  { key: "competitors", label: "경쟁점" },
  { key: "location", label: "입지동선평가" },
  { key: "result", label: "최종결과" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function blankCandidate(code: string): CandidateInput {
  return {
    code,
    name: "",
    address: "",
    lat: null,
    lng: null,
    roadAddress: null,
    jibunAddress: null,
    buildingName: null,
    geocodedAt: null,
    reviewDate: null,
    reviewStatus: "진행",
    expectedPcCount: null,
    floor: null,
    groundLevel: null,
    hasElevator: null,
    hourlyRate: null,
    demographicsYear: null,
    plannedOpenMonth: null,
    pop500m: null,
    area1kmKm2: null,
    pop1km: null,
    male1kmRatio: null,
    age1km_0_9: null,
    age1km_10_19: null,
    age1km_20_29: null,
    age1km_30_39: null,
    age1km_40_49: null,
    age1km_50_59: null,
    age1km_60_69: null,
    age1km_70_79: null,
    age1km_80plus: null,
    floating500Avg: null,
    floating500Male: null,
    floating500_10s: null,
    floating500_20s: null,
    floating500_30s: null,
    floating500_40s: null,
    floating500_50s: null,
    floating500_60plus: null,
    operatingPcStores500m: null,
    commercialDataYearMonth: null,
    businessCountAsOfDate: null,
    operatingPcStores1km: null,
    employ500Total: null,
    employ500Male: null,
    employ500Female: null,
    employ1kmTotal: null,
    employ1kmMale: null,
    employ1kmFemale: null,
    facility500SubwayRiders: null,
    facility1kmSubwayRiders: null,
    // 2026-09-01 사용자 확정 — 모니터와 동일한 원칙으로 GPU/CPU/RAM "기본사양"도 신규 후보지 생성
    // 시 자동으로 채워둔다(scoreFromVga/scoreFromCpu의 앵커값과 동일한 "블랙라벨 현재 표준" 실제
    // 구매 사양 — RTX5060/울트라5 225F/16GB, calc.ts computeSpecScore 주석 참고). 일반 텍스트
    // 입력란 그대로라 저장 전 언제든 직접 수정 가능하다(특화1/특화2는 매장마다 실제로 다를 수
    // 있어 자동으로 안 채움 — 필요하면 직접 입력).
    ownCpu: "울트라5 225F",
    ownCpuTop1: null,
    ownCpuTop2: null,
    ownRam: "16GB",
    ownRamTop: null,
    ownVgaBase: "RTX 5060",
    ownVgaTop: null,
    ownVgaTop2: null,
    ownSingleSeatCount: null,
    ownRoom1: null,
    ownRoom2: null,
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownFirstClassZone: null,
    ownTeamRoomTotalSeats: null,
    ownTeamRoomTotalSeatsBasis: null,
    ownFoodScore: null,
    ownInteriorScore: null,
    ownManagementScore: null,
    // 2026-08-31 사용자 확정 — 최신매장 표준 모니터 스펙 기본값(신규 후보지 생성 시에만 채움,
    // 이미 값이 있는 매장/경쟁점에는 영향 없음). scoreFromMonitorSpec 기준 3.7점(기본 3.5×80%+
    // 특화 4.5×20%) — 정확히 4.0은 combineHardwareTiers(기본80%+특화20%) 공식의 수학적 상한
    // (특화 만점이어도 3.8)이라 도달 불가능, 공식 자체 재설계는 검증 인프라(LOOCV) 복구 후 별도 논의.
    ownMonitorBase: "제이씨현 32인치 FHD 240Hz",
    ownMonitorTop: "QNIX IPS 27인치 FHD 300Hz, BenQ ZOWIE XL2540X+ 24.1인치 FHD 280Hz, 비트엠 34인치 WWQHD 165Hz, 비트엠 27인치 FHD 240Hz",
    ownFoodBrand: null,
    ownInteriorLevelScore: null,
    ownInteriorConditionScore: null,
    ownSeatZoneScore: null,
    ownComfortScore: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: null,
    isDraft: true,
  };
}

export default function CandidateDetailPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const isNewDraft = code === NEW_DRAFT_CODE;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  const [candidate, setCandidate] = useState<CandidateInput | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 코드가 아직 발급되지 않은 draft 상태에서는 기본정보 탭만 허용한다 — 경쟁점/입지동선평가는
  // 실제 후보지코드가 있어야 candidateCode로 하위 문서를 저장할 수 있기 때문이다.
  const requestedTab = searchParams.get("tab") ?? "";
  const activeTab = (!persisted ? "basic" : ["basic", "competitors", "location", "result"].includes(requestedTab) ? requestedTab : "basic") as TabKey;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isNewDraft) {
        setCandidate(blankCandidate(NEW_DRAFT_CODE));
        setPersisted(false);
        return;
      }
      const existing = await getCandidate(code);
      if (existing) {
        setCandidate(existing);
        setPersisted(true);
      } else {
        setError("해당 후보지를 찾을 수 없습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보지를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isNewDraft]);

  useEffect(() => {
    load();
  }, [load]);

  function setTab(tab: TabKey) {
    if (!persisted) return; // draft 상태에서는 기본정보만 — 저장 전엔 탭 전환 막음
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", tab);
    router.replace(`${pathname}?${qs.toString()}`);
  }

  if (loading) {
    return <p className="text-sm text-[#8a8072]">불러오는 중...</p>;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
        <Link href="/store-eval/candidates" className="w-fit text-sm text-[#8a8072] underline">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  if (!candidate) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/store-eval/candidates" className="text-xs text-[#8a8072] hover:underline">
            ← 신규후보지 목록
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">
            {candidate.name || "(이름 없음)"}{" "}
            {!isNewDraft && <span className="font-mono text-sm text-[#8a8072]">{candidate.code}</span>}
          </h1>
        </div>
        {!persisted && (
          <span className="app-badge app-badge-warn">
            아직 저장되지 않은 신규 후보지입니다 — 저장하면 후보지코드가 발급됩니다
          </span>
        )}
      </div>

      <nav className="flex gap-1 border-b border-[#171310]/[0.08] text-sm dark:border-white/[0.08] print:hidden">
        {TABS.map((tab) => {
          const disabled = !persisted && tab.key !== "basic";
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              disabled={disabled}
              title={disabled ? "기본정보를 먼저 저장해야 이용할 수 있습니다" : undefined}
              className={`-mb-px rounded-t-md border-b-2 px-4 py-2 font-medium transition ${
                activeTab === tab.key
                  ? "border-[#c05a2c] text-[#171310] dark:text-[#f2ede2]"
                  : disabled
                    ? "cursor-not-allowed border-transparent text-[#c9bfae] dark:text-[#4a4438]"
                    : "border-transparent text-[#8a8072] hover:text-[#171310] dark:hover:text-[#f2ede2]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div>
        {activeTab === "basic" && (
          <BasicInfoTab
            candidate={candidate}
            actor={user?.email ?? null}
            onSaved={(saved) => {
              setCandidate(saved);
              setPersisted(true);
              if (isNewDraft) router.replace(`/store-eval/candidates/${saved.code}`);
            }}
          />
        )}
        {activeTab === "competitors" && <CompetitorsTab candidateCode={code} />}
        {activeTab === "location" && (
          <LocationEvalTab
            candidateCode={code}
            candidateName={candidate.name}
            candidateAddress={candidate.address}
            candidateLat={candidate.lat}
            candidateLng={candidate.lng}
          />
        )}
        {activeTab === "result" && <ResultTab candidateCode={code} />}
      </div>
    </div>
  );
}
