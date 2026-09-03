"use client";

// 기존 가맹점 상세 화면 — 2026-08-27 추가, 2026-08-28 탭 구조로 확장(사용자 요청: 기존 가맹점의
// 하드웨어·수요·경쟁점정보도 웹에서 편집 가능하게). candidates/[code]/page.tsx와 같은 탭 패턴
// (URL query ?tab=)을 쓴다. 경쟁점 탭은 이미 candidateCode 문자열만 받는 범용 컴포넌트인
// CompetitorsTab을 그대로 재사용한다(LocationEvalTab을 이미 같은 방식으로 재사용 중인 것과 동일).
// 나머지 운영상태/월매출/회원스냅샷 편집은 그대로 existing-stores 목록 화면에서 한다 — 여긴 안 옮긴다.

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getExistingStore } from "@/lib/storeEval/store";
import type { ExistingStore } from "@/lib/storeEval/types";
import { CompetitorsTab } from "../../candidates/[code]/CompetitorsTab";
import { LocationEvalTab } from "../../candidates/[code]/LocationEvalTab";
import { ExistingStoreProfileTab } from "./ExistingStoreProfileTab";
import { ScorecardTab } from "./ScorecardTab";

const TABS = [
  { key: "basic", label: "기본정보" },
  { key: "competitors", label: "경쟁점" },
  { key: "location", label: "입지동선평가" },
  { key: "scorecard", label: "평가 비교" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function ExistingStoreDetailPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  const [store, setStore] = useState<ExistingStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const requestedTab = searchParams.get("tab") ?? "";
  const activeTab = (TABS.some((t) => t.key === requestedTab) ? requestedTab : "basic") as TabKey;

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const existing = await getExistingStore(code);
      if (sequence !== loadSequence.current) return;
      if (existing) {
        setStore(existing);
      } else {
        setError("해당 가맹점을 찾을 수 없습니다.");
      }
    } catch (err) {
      if (sequence === loadSequence.current) setError(err instanceof Error ? err.message : "가맹점 정보를 불러오지 못했습니다.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
    return () => {
      loadSequence.current++;
    };
  }, [load]);

  function setTab(tab: TabKey) {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", tab);
    router.replace(`${pathname}?${qs.toString()}`);
  }

  if (loading) return <p className="text-sm text-[#8a8072]">불러오는 중...</p>;

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
        <Link href="/store-eval/existing-stores" className="w-fit text-sm text-[#8a8072] underline">
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  if (!store) return null;

  const lookupCode = store.originCandidateCode ?? store.storeCode;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/store-eval/existing-stores" className="text-xs text-[#8a8072] hover:underline">
          ← 기존 가맹점 목록
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">
          {store.storeName} <span className="font-mono text-sm text-[#8a8072]">{store.storeCode}</span>
        </h1>
        {store.originCandidateCode && (
          <p className="mt-1 text-xs text-[#8a8072]">
            후보지 {store.originCandidateCode}에서 전환된 매장입니다 — 그 후보지의 경쟁점·입지평가 데이터를 그대로 씁니다.
          </p>
        )}
      </div>

      <nav className="flex gap-1 border-b border-[#171310]/[0.08] text-sm dark:border-white/[0.08]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTab(tab.key)}
            className={`px-3 py-2 ${
              activeTab === tab.key
                ? "border-b-2 border-[#171310] font-medium text-[#171310] dark:border-[#f2ede2] dark:text-[#f2ede2]"
                : "text-[#8a8072]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "basic" && (
        <ExistingStoreProfileTab store={store} actor={user?.email ?? null} onSaved={(updated) => setStore(updated)} />
      )}
      {activeTab === "competitors" && <CompetitorsTab candidateCode={lookupCode} />}
      {activeTab === "location" && (
        <LocationEvalTab
          candidateCode={lookupCode}
          candidateName={store.storeName}
          candidateAddress={store.address ?? ""}
          candidateLat={null}
          candidateLng={null}
          existingStoreCode={store.storeCode}
        />
      )}
      {activeTab === "scorecard" && <ScorecardTab store={store} candidateCode={lookupCode} />}
    </div>
  );
}
