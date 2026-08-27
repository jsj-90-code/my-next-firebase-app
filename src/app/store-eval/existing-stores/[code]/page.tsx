"use client";

// 기존 가맹점 상세 화면 — 2026-08-27 추가. 지금은 입지동선평가(AI 재평가 포함) 한 탭만 있다.
// 후보지 상세(candidates/[code]/page.tsx)의 LocationEvalTab을 그대로 재사용한다 — 컴포넌트
// 자체가 candidateCode(=originCandidateCode ?? storeCode)만 있으면 동작하도록 이미 일반화돼
// 있어서, existingStoreCode prop 하나만 추가로 넘기면 순수 레거시 매장(후보지 문서 없음)도
// AI 초안 생성이 된다(/api/store-eval/ai-location-eval-existing-store).
// 나머지 기본정보/실적 편집은 그대로 existing-stores 목록 화면에서 한다 — 여긴 새로 안 옮긴다.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getExistingStore } from "@/lib/storeEval/store";
import type { ExistingStore } from "@/lib/storeEval/types";
import { LocationEvalTab } from "../../candidates/[code]/LocationEvalTab";

export default function ExistingStoreDetailPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);

  const [store, setStore] = useState<ExistingStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await getExistingStore(code);
      if (existing) {
        setStore(existing);
      } else {
        setError("해당 가맹점을 찾을 수 없습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "가맹점 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

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
            후보지 {store.originCandidateCode}에서 전환된 매장입니다 — 그 후보지의 경쟁점·수요거점 데이터를 그대로 씁니다.
          </p>
        )}
      </div>

      <LocationEvalTab
        candidateCode={lookupCode}
        candidateName={store.storeName}
        candidateAddress={store.address ?? ""}
        candidateLat={null}
        candidateLng={null}
        existingStoreCode={store.storeCode}
      />
    </div>
  );
}
