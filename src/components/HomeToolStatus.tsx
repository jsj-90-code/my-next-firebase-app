"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listCandidates } from "@/lib/storeEval/store";
import { listProjects } from "@/lib/seatLayout/store";

// 홈 화면 도구 카드 하단의 "표제란" — 실제로 그 도구에 최근 활동이 있었는지 보여준다.
// 로그인 전에는 Firestore를 읽을 권한이 없으니 조회하지 않고, 로그인 후에만 실제 값을 가져온다.
function relativeTime(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}일 전`;
  return new Date(ts).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function HomeToolStatus({ tool }: { tool: "seat-layout" | "store-eval" }) {
  const { user } = useAuth();
  const [latest, setLatest] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">("idle");

  useEffect(() => {
    if (!user) {
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("loading");
    async function load() {
      try {
        const updatedAts =
          tool === "seat-layout"
            ? (await listProjects()).map((p) => p.updatedAt)
            : (await listCandidates()).map((c) => c.updatedAt);
        const max = updatedAts.reduce<number | null>(
          (acc, ts) => (ts != null && (acc == null || ts > acc) ? ts : acc),
          null,
        );
        if (!cancelled) {
          setLatest(max);
          setState("loaded");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tool, user]);

  const recentLabel =
    state === "loading"
      ? "확인 중..."
      : state === "error"
        ? "-"
        : state === "idle"
          ? "로그인 필요"
          : latest == null
            ? "아직 없음"
            : relativeTime(latest);

  return (
    <div className="flex border-t border-[#171310]/[0.08] font-mono text-[10.5px] dark:border-white/[0.08]">
      <div className="flex-1 border-r border-[#171310]/[0.08] px-3 py-2 dark:border-white/[0.08]">
        <div className="text-[9px] uppercase tracking-wide text-[#8a8072]">Status</div>
        <div className="mt-0.5 font-medium text-[var(--sl-ok)]">사용 가능</div>
      </div>
      <div className="flex-1 px-3 py-2">
        <div className="text-[9px] uppercase tracking-wide text-[#8a8072]">최근 업데이트</div>
        <div className="mt-0.5 font-medium text-[#171310] dark:text-[#f2ede2]">{recentLabel}</div>
      </div>
    </div>
  );
}
