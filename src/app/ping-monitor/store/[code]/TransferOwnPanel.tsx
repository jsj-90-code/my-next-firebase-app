"use client";

// 직접 입력 매장 → 점포평가 매장으로 전환(2026-10-14 사용자). 타부서가 측정기에 이름만 적어 둔 매장을,
// 점포평가에 후보지·기존점을 등록한 뒤 그쪽으로 옮긴다. 측정 기록은 문서 그대로라 이어진다.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listOwnStoreOptions, transferCustomOwn, type OwnStoreOption } from "@/lib/pingMonitor/clientStore";

export function TransferOwnPanel({ fromCode, fromName, preferCandidate }: { fromCode: string; fromName: string; preferCandidate: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<OwnStoreOption[] | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || options) return;
    listOwnStoreOptions()
      .then((rows) => setOptions(rows.filter((o) => !o.custom)))
      .catch(() => setOptions([]));
  }, [open, options]);

  const kinds = preferCandidate ? (["후보지", "기존점"] as const) : (["기존점", "후보지"] as const);
  const picked = options?.find((o) => o.code === target) ?? null;

  async function run() {
    if (!picked) return;
    if (!window.confirm(`"${fromName}" 묶음의 경쟁점을 전부 점포평가 ${picked.kind} "${picked.name}"(으)로 옮깁니다. 측정 기록은 그대로 이어집니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await transferCustomOwn(fromCode, { code: picked.code, name: picked.name }, user?.email ?? null);
      window.alert(`${r.moved}곳을 옮겼습니다.${r.linked.length ? ` 점포평가 경쟁점과 이어짐: ${r.linked.join(", ")}` : ""}`);
      router.replace(`/ping-monitor/store/${encodeURIComponent(picked.code)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "옮기지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <section className="app-card-sm rounded-xl p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--sl-ink-soft)]">직접 입력한 매장입니다.</span>
        <button type="button" className="app-btn-outline ml-auto rounded-lg px-3 py-1 text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? "닫기" : "점포평가 매장으로 전환"}
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="app-input min-w-0 flex-1 rounded-lg px-3 py-2 text-base sm:text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{options == null ? "불러오는 중..." : "옮길 점포평가 매장 고르기"}</option>
            {kinds.map((kind) => (
              <optgroup key={kind} label={kind}>
                {(options ?? [])
                  .filter((o) => o.kind === kind)
                  .map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className="app-btn-primary rounded-lg px-4 py-2 text-sm" disabled={!picked || busy} onClick={run}>
            {busy ? "옮기는 중..." : "옮기기"}
          </button>
          {error && <p role="alert" className="app-notice app-badge-danger w-full px-3 py-2 text-sm">{error}</p>}
        </div>
      )}
    </section>
  );
}
