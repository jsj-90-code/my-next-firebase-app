"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/AuthForm";
import { deleteGalleryEntry, listGalleryEntries } from "@/lib/seatLayout/store";
import type { GalleryEntry } from "@/lib/seatLayout/types";

type StoreGroup = {
  projectId: string;
  projectName: string;
  desk: GalleryEntry | null;
  pc: GalleryEntry | null;
  updatedAt: number;
};

function groupByStore(entries: GalleryEntry[]): StoreGroup[] {
  const map = new Map<string, StoreGroup>();
  entries.forEach((entry) => {
    const existing = map.get(entry.projectId);
    const group: StoreGroup = existing ?? {
      projectId: entry.projectId,
      projectName: entry.projectName,
      desk: null,
      pc: null,
      updatedAt: 0,
    };
    if (entry.tab === "desk") group.desk = entry;
    else group.pc = entry;
    group.updatedAt = Math.max(group.updatedAt, entry.updatedAt);
    group.projectName = entry.projectName;
    map.set(entry.projectId, group);
  });
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function GalleryContent() {
  const [groups, setGroups] = useState<StoreGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const entries = await listGalleryEntries();
      setGroups(groupByStore(entries));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Firestore에서 갤러리 목록을 최초 1회 비동기로 가져와야 하므로 setState를 피할 수 없다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  async function handleDelete(entry: GalleryEntry) {
    if (!window.confirm(`"${entry.projectName}" (${entry.tab === "desk" ? "책상" : "PC"}) 항목을 갤러리에서 삭제할까요?`)) {
      return;
    }
    await deleteGalleryEntry(entry);
    await refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <Link href="/seat-layout" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          ← 작업 툴로
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          매장 전체보기
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          각 매장에서 &ldquo;매장 전체보기에 등록&rdquo;을 누르면 최신 발주 이미지가 여기에 모입니다.
        </p>
      </header>

      {loading && <p className="text-sm text-zinc-500">불러오는 중...</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!loading && !error && groups.length === 0 && (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          아직 등록된 매장이 없습니다. 작업 툴에서 도면을 완성한 뒤 &ldquo;매장 전체보기에 등록&rdquo;을 눌러주세요.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {groups.map((group) => (
          <div
            key={group.projectId}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{group.projectName}</h2>
              <span className="text-xs text-zinc-400">
                {new Date(group.updatedAt).toLocaleString("ko-KR")}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["desk", "pc"] as const).map((tab) => {
                const entry = tab === "desk" ? group.desk : group.pc;
                return (
                  <div key={tab} className="space-y-1.5">
                    <p className="text-xs font-medium text-zinc-500">
                      {tab === "desk" ? "책상 발주" : "PC 발주"}
                    </p>
                    {entry ? (
                      <div className="group relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <a href={entry.imageUrl} target="_blank" rel="noreferrer">
                          <Image
                            src={entry.imageUrl}
                            alt={`${group.projectName} ${tab === "desk" ? "책상" : "PC"} 발주`}
                            width={960}
                            height={540}
                            unoptimized
                            className="aspect-video w-full object-cover"
                          />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
                        >
                          삭제
                        </button>
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
                        아직 등록 안 됨
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const { user, loading, configured } = useAuth();

  if (!configured) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        Firebase 설정이 필요합니다.
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center text-zinc-500">로그인 상태 확인 중...</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-16">
        <AuthForm />
      </div>
    );
  }

  return <GalleryContent />;
}
