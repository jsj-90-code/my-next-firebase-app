"use client";

// 경쟁점 등록·수정 칸 + "지금 확인"(기록 안 남기는 즉석 측정). 목록 화면(등록)과 상세 화면(수정)이 같이 쓴다.

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { parseIpRanges } from "@/lib/pingMonitor/ipRange";
import {
  listCompetitorOptions,
  listOwnStoreOptions,
  type CompetitorOption,
  type OwnStoreOption,
  type PingStoreInput,
} from "@/lib/pingMonitor/clientStore";
import { formatPct, shortIps } from "@/lib/pingMonitor/summary";

const FIELD = "app-input mt-1 w-full rounded-lg px-3 py-2 text-base sm:text-sm placeholder:text-[var(--sl-ink-soft)] placeholder:opacity-70";
const LABEL = "text-xs font-medium text-[var(--sl-ink-soft)]";

type ProbeResult = { at: string; total: number; aliveIps: string[] };

export function StoreForm({
  initial,
  submitLabel,
  onSubmit,
  showActive = false,
}: {
  initial?: Partial<PingStoreInput>;
  submitLabel: string;
  onSubmit: (input: PingStoreInput) => Promise<void>;
  showActive?: boolean;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [ipRanges, setIpRanges] = useState(initial?.ipRanges ?? "");
  const [pcCount, setPcCount] = useState(initial?.pcCount != null ? String(initial.pcCount) : "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [ownCode, setOwnCode] = useState(initial?.ownCode ?? "");
  const [competitorId, setCompetitorId] = useState(initial?.competitorId ?? "");
  const [distance, setDistance] = useState(initial?.distanceM != null ? String(initial.distanceM) : "");
  const [ownOptions, setOwnOptions] = useState<OwnStoreOption[] | null>(null);
  const [competitorOptions, setCompetitorOptions] = useState<{ code: string; rows: CompetitorOption[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOwnStoreOptions()
      .then((rows) => !cancelled && setOwnOptions(rows))
      .catch(() => !cancelled && setOwnOptions([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ownCode) return;
    let cancelled = false;
    listCompetitorOptions(ownCode)
      .then((rows) => !cancelled && setCompetitorOptions({ code: ownCode, rows }))
      .catch(() => !cancelled && setCompetitorOptions({ code: ownCode, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [ownCode]);
  const competitors = competitorOptions?.code === ownCode ? competitorOptions.rows : null;

  function pickCompetitor(id: string) {
    setCompetitorId(id);
    const c = competitors?.find((x) => x.id === id);
    if (!c) return;
    setName(c.name);
    if (c.address) setAddress(c.address);
    if (c.pcCount) setPcCount(String(c.pcCount));
    if (c.distanceM != null) setDistance(String(c.distanceM));
  }

  const parsed = useMemo(() => parseIpRanges(ipRanges), [ipRanges]);
  const pcNum = pcCount.trim() === "" ? null : Number(pcCount);
  const pcInvalid = pcNum != null && !(Number.isInteger(pcNum) && pcNum > 0);
  const distNum = distance.trim() === "" ? null : Number(distance);
  const distInvalid = distNum != null && !(Number.isFinite(distNum) && distNum >= 0);
  const canSubmit = name.trim() !== "" && parsed.ips.length > 0 && parsed.errors.length === 0 && !pcInvalid && !distInvalid && !busy;

  async function runProbe() {
    if (!user) return;
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/ping-monitor/probe", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ipRanges }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "확인에 실패했습니다.");
      setProbe(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "확인에 실패했습니다.");
    } finally {
      setProbing(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        address: address.trim(),
        ipRanges: ipRanges.trim(),
        ipCount: parsed.ips.length,
        pcCount: pcNum,
        memo: memo.trim(),
        active,
        ownCode: ownCode || null,
        ownName: ownOptions?.find((o) => o.code === ownCode)?.name ?? initial?.ownName ?? null,
        competitorId: ownCode && competitorId ? competitorId : null,
        distanceM: distNum,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const probeDenominator = pcNum ?? probe?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>우리 매장 (매장별로 묶어 보기용)</span>
          <select
            className={FIELD}
            value={ownCode}
            onChange={(e) => {
              setOwnCode(e.target.value);
              setCompetitorId("");
            }}
          >
            <option value="">{ownOptions == null ? "불러오는 중..." : "연결 안 함"}</option>
            {(["기존점", "후보지"] as const).map((kind) => (
              <optgroup key={kind} label={kind}>
                {(ownOptions ?? [])
                  .filter((o) => o.kind === kind)
                  .map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
              </optgroup>
            ))}
            {ownCode && ownOptions && !ownOptions.some((o) => o.code === ownCode) && (
              <option value={ownCode}>{initial?.ownName ?? ownCode}</option>
            )}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>점포평가에 등록된 경쟁점에서 고르기 (상호·대수·거리 자동 입력)</span>
          <select className={FIELD} value={competitorId} disabled={!ownCode} onChange={(e) => pickCompetitor(e.target.value)}>
            <option value="">{!ownCode ? "우리 매장을 먼저 고르세요" : competitors == null ? "불러오는 중..." : competitors.length === 0 ? "등록된 경쟁점 없음 — 직접 입력" : "직접 입력"}</option>
            {(competitors ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.distanceM != null ? ` · ${c.distanceM}m` : ""}
                {c.pcCount ? ` · ${c.pcCount}대` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>상호 *</span>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 레벨업PC방 울산삼산점" />
        </label>
        <label className="block">
          <span className={LABEL}>주소</span>
          <input className={FIELD} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="예: 울산 남구 삼산동 1476-2" />
        </label>
      </div>
      <label className="block">
        <span className={LABEL}>IP대역 * (여러 개면 쉼표나 줄바꿈)</span>
        <textarea
          className={`${FIELD} min-h-[64px] font-mono`}
          value={ipRanges}
          onChange={(e) => {
            setIpRanges(e.target.value);
            setProbe(null);
          }}
          placeholder="예: 118.128.168.1~110"
        />
        <span className="mt-1 block text-xs text-[var(--sl-ink-soft)]">
          {parsed.errors.length > 0 ? (
            <span className="text-red-600 dark:text-red-400">{parsed.errors.join(" ")}</span>
          ) : (
            `IP ${parsed.ips.length}개`
          )}
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>PC 대수 (비우면 IP 개수 {parsed.ips.length}대로 계산)</span>
          <input className={`${FIELD} tabular-nums`} inputMode="numeric" value={pcCount} onChange={(e) => setPcCount(e.target.value)} placeholder={String(parsed.ips.length || "")} />
          {pcInvalid && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">1 이상의 정수를 넣어 주세요.</span>}
        </label>
        <label className="block">
          <span className={LABEL}>우리 매장과 거리(m)</span>
          <input className={`${FIELD} tabular-nums`} inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="예: 43" />
          {distInvalid && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">0 이상의 숫자를 넣어 주세요.</span>}
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={LABEL}>메모</span>
          <input className={FIELD} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 울산삼산 후보지 43m" />
        </label>
      </div>
      {showActive && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          1시간마다 측정 (끄면 측정만 멈추고 지난 기록은 그대로 남습니다)
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="app-btn-outline rounded-lg px-4 py-2 text-sm" disabled={probing || parsed.ips.length === 0 || parsed.errors.length > 0} onClick={runProbe}>
          {probing ? "확인 중..." : "지금 확인"}
        </button>
        <button type="button" className="app-btn-primary rounded-lg px-4 py-2 text-sm" disabled={!canSubmit} onClick={submit}>
          {busy ? "저장 중..." : submitLabel}
        </button>
      </div>

      {probe && (
        <div className="app-card-sm rounded-xl p-3 text-sm">
          <p>
            지금 켜진 PC <b className="tabular-nums">{probe.aliveIps.length}</b> / {probeDenominator}대 ·{" "}
            <b className="tabular-nums">{formatPct(probeDenominator > 0 ? probe.aliveIps.length / probeDenominator : null)}</b>
            <span className="ml-2 text-xs text-[var(--sl-ink-soft)]">({new Date(probe.at).toLocaleTimeString("ko-KR")} · 기록 안 함)</span>
          </p>
          {probe.aliveIps.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              대답한 PC가 없습니다. 손님이 없는 시간이거나, PC가 바깥 확인을 막아 둔 매장일 수 있습니다. 저녁 시간에 다시 확인해 보세요.
            </p>
          ) : (
            <p className="mt-1 break-all font-mono text-xs text-[var(--sl-ink-soft)]">{shortIps(probe.aliveIps)}</p>
          )}
        </div>
      )}
      {error && <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">{error}</p>}
    </div>
  );
}
