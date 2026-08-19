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
    reviewDate: null,
    reviewStatus: "진행",
    expectedPcCount: null,
    floor: null,
    groundLevel: null,
    hasElevator: null,
    hourlyRate: null,
    demographicsYear: null,
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
    floating500Female: null,
    floating500_10s: null,
    floating500_20s: null,
    floating500_30s: null,
    floating500_40s: null,
    floating500_50s: null,
    floating500_60plus: null,
    licensedPcStores500m: null,
    operatingPcStores500m: null,
    ownVgaBase: null,
    ownVgaTop: null,
    ownGameZoneCount: null,
    ownRoom1: null,
    ownRoom2: null,
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownSpecScore: null,
    ownSeatScore: null,
    ownFoodScore: null,
    ownInteriorScore: null,
    ownLocationScore: null,
    ownMonitorScore: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: null,
    isDraft: true,
  };
}

export default function CandidateDetailPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const isNew = searchParams.get("new") === "1";

  const [candidate, setCandidate] = useState<CandidateInput | null>(null);
  const [persisted, setPersisted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTab = (["basic", "competitors", "location", "result"].includes(searchParams.get("tab") ?? "")
    ? searchParams.get("tab")
    : "basic") as TabKey;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await getCandidate(code);
      if (existing) {
        setCandidate(existing);
        setPersisted(true);
      } else if (isNew) {
        setCandidate(blankCandidate(code));
        setPersisted(false);
      } else {
        setError("해당 후보지를 찾을 수 없습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보지를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  function setTab(tab: TabKey) {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", tab);
    qs.delete("new");
    router.replace(`${pathname}?${qs.toString()}`);
  }

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">불러오는 중...</p>;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
        <Link href="/store-eval/candidates" className="w-fit text-sm text-zinc-600 underline dark:text-zinc-400">
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
          <Link href="/store-eval/candidates" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
            ← 신규후보지 목록
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {candidate.name || "(이름 없음)"} <span className="font-mono text-sm text-zinc-400">{candidate.code}</span>
          </h1>
        </div>
        {!persisted && (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            아직 저장되지 않은 신규 후보지입니다
          </span>
        )}
      </div>

      <nav className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800 print:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTab(tab.key)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 font-medium transition ${
              activeTab === tab.key
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div>
        {activeTab === "basic" && (
          <BasicInfoTab
            candidate={candidate}
            actor={user?.email ?? null}
            onSaved={(saved) => {
              setCandidate(saved);
              setPersisted(true);
            }}
          />
        )}
        {activeTab === "competitors" && <CompetitorsTab candidateCode={code} />}
        {activeTab === "location" && (
          <LocationEvalTab candidateCode={code} candidateName={candidate.name} candidateAddress={candidate.address} />
        )}
        {activeTab === "result" && <ResultTab candidateCode={code} />}
      </div>
    </div>
  );
}
