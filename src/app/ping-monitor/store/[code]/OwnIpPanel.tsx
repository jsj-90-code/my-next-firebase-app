"use client";

// 우리 매장 IP 등록(2026-10-28 사용자 — 울산삼산점 IP를 넣으려는데 화면에 칸이 없었다). 우리 매장 줄이 아직 없는 기존점에만 보인다.
// 저장은 서버(/api/ping-monitor/own-register)가 한다 — 보안 규칙상 화면은 우리 매장 줄을 못 만든다. 고칠 때는 우리 매장 줄의 "정보 수정".

import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { parseIpRanges } from "@/lib/pingMonitor/ipRange";

export function OwnIpPanel({ ownCode, onSaved }: { ownCode: string; onSaved: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [ipRanges, setIpRanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseIpRanges(ipRanges), [ipRanges]);

  async function save() {
    if (!user) return;
    if (!window.confirm(`우리 매장 IP ${parsed.ips.length}개(= 측정기 대수 ${parsed.ips.length}대)로 등록합니다. 다음 정각 5분 회차부터 잽니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ping-monitor/own-register", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ownCode, ipRanges }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "등록하지 못했습니다.");
      if (body.webPcCount != null && body.webPcCount !== body.ipCount)
        window.alert(`등록했습니다. 다만 점포평가 웹 대수(${body.webPcCount}대)와 IP 수(${body.ipCount}개)가 다릅니다 — 셋이 같아야 합니다. 맞는 쪽으로 고쳐 주세요.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <section className="app-card-sm rounded-xl p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--sl-ink-soft)]">우리 매장 IP가 아직 없습니다.</span>
        <button type="button" className="app-btn-outline ml-auto rounded-lg px-3 py-1 text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? "닫기" : "우리 매장 IP 등록"}
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            className="app-input rounded-lg px-3 py-2 text-base sm:text-sm"
            placeholder="손님 PC 대역 한 덩어리 — 예: 211.50.64.141~239"
            value={ipRanges}
            onChange={(e) => setIpRanges(e.target.value)}
          />
          <p className="text-xs text-[var(--sl-ink-soft)]">
            {parsed.errors.length ? parsed.errors.join(" ") : parsed.ips.length ? `IP ${parsed.ips.length}개 = 측정기 대수 ${parsed.ips.length}대 (웹 대수와 같아야 합니다)` : "IP 수가 곧 측정기 대수입니다."}
          </p>
          <div>
            <button
              type="button"
              className="app-btn-primary rounded-lg px-4 py-2 text-sm"
              disabled={busy || parsed.ips.length === 0 || parsed.errors.length > 0}
              onClick={save}
            >
              {busy ? "등록 중..." : "등록"}
            </button>
          </div>
          {error && <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-xs">{error}</p>}
        </div>
      )}
    </section>
  );
}
