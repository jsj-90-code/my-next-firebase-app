"use client";

// 후보지 상세 화면 - 탭 4개(기본정보/경쟁점/입지동선평가/최종결과)를 URL query(?tab=)로 관리한다.

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getCandidate } from "@/lib/storeEval/store";
import { blankCandidate } from "@/lib/storeEval/blankCandidate";
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

export default function CandidateDetailPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  return <CandidateDetail key={code} code={code} />;
}

function CandidateDetail({ code }: { code: string }) {
  const isNewDraft = code === NEW_DRAFT_CODE;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  const [candidate, setCandidate] = useState<CandidateInput | null>(() => isNewDraft ? blankCandidate(NEW_DRAFT_CODE) : null);
  const [persisted, setPersisted] = useState(false);
  const [loading, setLoading] = useState(!isNewDraft);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  // 코드가 아직 발급되지 않은 draft 상태에서는 기본정보 탭만 허용한다 — 경쟁점/입지동선평가는
  // 실제 후보지코드가 있어야 candidateCode로 하위 문서를 저장할 수 있기 때문이다.
  const requestedTab = searchParams.get("tab") ?? "";
  const activeTab = (!persisted ? "basic" : ["basic", "competitors", "location", "result"].includes(requestedTab) ? requestedTab : "basic") as TabKey;

  const load = useCallback(() => {
    if (isNewDraft) return;
    const sequence = ++loadSequence.current;
    return getCandidate(code).then((existing) => {
      if (sequence !== loadSequence.current) return;
      if (existing) {
        setCandidate(existing);
        setPersisted(true);
      } else {
        setError("해당 후보지를 찾을 수 없습니다.");
      }
    }).catch((err: unknown) => {
      if (sequence === loadSequence.current) setError(err instanceof Error ? err.message : "후보지를 불러오지 못했습니다.");
    }).finally(() => {
      if (sequence === loadSequence.current) setLoading(false);
    });
  }, [code, isNewDraft]);

  useEffect(() => {
    const sequenceCounter = loadSequence;
    load();
    return () => {
      sequenceCounter.current++;
    };
  }, [load]);

  function setTab(tab: TabKey) {
    if (!persisted) return; // draft 상태에서는 기본정보만 — 저장 전엔 탭 전환 막음
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", tab);
    router.replace(`${pathname}?${qs.toString()}`);
  }

  if (loading) {
    return <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="app-notice app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
        <Link href="/store-eval/candidates" className="w-fit text-sm text-[var(--sl-ink-soft)] underline">
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
          <Link href="/store-eval/candidates" className="text-xs text-[var(--sl-ink-soft)] hover:underline">
            ← 신규후보지 목록
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">
            {candidate.name || "(이름 없음)"}{" "}
            {!isNewDraft && <span className="font-mono text-sm text-[var(--sl-ink-soft)]">{candidate.code}</span>}
          </h1>
        </div>
        {!persisted && (
          <span className="app-badge app-badge-warn">
            아직 저장되지 않은 신규 후보지입니다 — 저장하면 후보지코드가 발급됩니다
          </span>
        )}
      </div>

      <nav aria-label="후보지 상세 메뉴" className="flex flex-wrap gap-1 border-b border-[#171310]/[0.08] text-sm dark:border-white/[0.08] print:hidden">
        {TABS.map((tab) => {
          const disabled = !persisted && tab.key !== "basic";
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              disabled={disabled}
              aria-current={activeTab === tab.key ? "page" : undefined}
              data-leaves-editor={activeTab !== tab.key ? "" : undefined}
              title={disabled ? "기본정보를 먼저 저장해야 이용할 수 있습니다" : undefined}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 font-medium transition sm:px-4 ${
                activeTab === tab.key
                  ? "border-[#c05a2c] text-[#171310] dark:text-[#f2ede2]"
                  : disabled
                    ? "cursor-not-allowed border-transparent text-[#c9bfae] dark:text-[#4a4438]"
                    : "border-transparent text-[var(--sl-ink-soft)] hover:text-[#171310] dark:hover:text-[#f2ede2]"
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
