"use client";

// 경쟁점 등록·수정 칸 + "지금 확인"(기록 안 남기는 즉석 측정). 목록 화면(등록)과 상세 화면(수정)이 같이 쓴다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { parseIpRanges } from "@/lib/pingMonitor/ipRange";
import {
  listCompetitorOptions,
  listOwnStoreOptions,
  type CompetitorOption,
  type OwnStoreOption,
  type PingStoreInput,
} from "@/lib/pingMonitor/clientStore";
import { customOwnCode, isCustomOwnCode, type CustomOwnKind } from "@/lib/pingMonitor/clientStore";
import { shortIps } from "@/lib/pingMonitor/summary";
import { distanceM as straightDistanceM } from "@/lib/pingMonitor/nearby";
import { PingMap, geocodeAddresses, useOwnLocation, useRivalPins, type PingMapPin } from "./PingMap";

const CUSTOM_OPTION: Record<CustomOwnKind, string> = { 기존점: "__custom_existing__", 후보지: "__custom_candidate__" };
const customKindOf = (v: string): CustomOwnKind | null => (v === CUSTOM_OPTION.기존점 ? "기존점" : v === CUSTOM_OPTION.후보지 ? "후보지" : null);

const FIELD = "app-input mt-1 w-full rounded-lg px-3 py-2 text-base sm:text-sm placeholder:text-[var(--sl-ink-soft)] placeholder:opacity-70";
const LABEL = "text-xs font-medium text-[var(--sl-ink-soft)]";

type ProbeResult = { at: string; total: number; aliveIps: string[] };

export function StoreForm({
  initial,
  submitLabel,
  onSubmit,
  showActive = false,
  showMap = false,
}: {
  initial?: Partial<PingStoreInput>;
  submitLabel: string;
  onSubmit: (input: PingStoreInput) => Promise<void>;
  showActive?: boolean;
  /** 경쟁점 등록 때 지도(2026-10-16 점포팀 요청). 수정 화면은 상세 페이지 지도를 쓴다. */
  showMap?: boolean;
}) {
  const { user } = useAuth();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [ipRanges, setIpRanges] = useState(initial?.ipRanges ?? "");
  const [pcCount, setPcCount] = useState(initial?.pcCount != null ? String(initial.pcCount) : "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [ownCode, setOwnCode] = useState(initial?.ownCode ?? "");
  /** 우리 매장 "직접 입력"을 고른 상태 — 점포평가에 없는 매장(2026-10-14 타부서 공유). */
  const [customMode, setCustomMode] = useState<CustomOwnKind | null>(null);
  const [customName, setCustomName] = useState("");
  const [competitorId, setCompetitorId] = useState(initial?.competitorId ?? "");
  const [distance, setDistance] = useState(initial?.distanceM != null ? String(initial.distanceM) : "");
  const [ownOptions, setOwnOptions] = useState<OwnStoreOption[] | null>(null);
  const [competitorOptions, setCompetitorOptions] = useState<{ code: string; rows: CompetitorOption[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2026-10-16 — 거리는 주소 좌표로 자동 계산한다(사용자 "직접 거리 넣게 하지 말고"). 좌표는 같이 저장해 지도에 쓴다.
  const [compLoc, setCompLoc] = useState<{ lat: number; lng: number } | null>(initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null);
  const [geoState, setGeoState] = useState<"idle" | "finding" | "notFound">("idle");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const locatedAddress = useRef<string>(initial?.lat != null ? (initial?.address ?? "").trim() : "");

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
    if (!ownCode || isCustomOwnCode(ownCode)) return;
    let cancelled = false;
    listCompetitorOptions(ownCode)
      .then((rows) => !cancelled && setCompetitorOptions({ code: ownCode, rows }))
      .catch(() => !cancelled && setCompetitorOptions({ code: ownCode, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [ownCode]);
  const getToken = async () => {
    if (!user) throw new Error("로그인이 필요합니다.");
    return user.getIdToken();
  };
  const ownLoc = useOwnLocation(customMode ? null : ownCode);
  const rivalPins = useRivalPins(showMap && !customMode ? ownCode : null, getToken);

  // 주소를 고치면 잠시 뒤 좌표를 다시 찾는다. 지도에서 고른 매장은 이미 좌표가 있어 건너뛴다.
  useEffect(() => {
    const a = address.trim();
    if (!a || a === locatedAddress.current || !user) return;
    const t = setTimeout(() => {
      setGeoState("finding");
      geocodeAddresses([a], getToken)
        .then((g) => {
          locatedAddress.current = a;
          const hit = g[a] ?? null;
          setCompLoc(hit ? { lat: hit.lat, lng: hit.lng } : null);
          setGeoState(hit ? "idle" : "notFound");
        })
        .catch(() => setGeoState("notFound"));
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, user]);

  function locateMe() {
    setGpsError(null);
    if (!navigator.geolocation) return setGpsError("이 브라우저는 위치 기능을 지원하지 않습니다.");
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setGpsError("위치를 가져오지 못했습니다 — 브라우저에서 위치 사용을 허용해 주세요."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  const autoDistance = ownLoc && compLoc ? straightDistanceM(ownLoc, compLoc) : null;

  const competitors = ownCode && isCustomOwnCode(ownCode) ? [] : competitorOptions?.code === ownCode ? competitorOptions.rows : null;
  const customTrimmed = customName.replace(/\s+/g, " ").trim();
  const effectiveOwnCode = customMode ? (customTrimmed ? customOwnCode(customMode, customTrimmed) : "") : ownCode;

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
  const canSubmit = name.trim() !== "" && !(customMode && !customTrimmed) && parsed.ips.length > 0 && parsed.errors.length === 0 && !pcInvalid && !distInvalid && !busy;

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
        ownCode: effectiveOwnCode || null,
        ownName: customMode
          ? customTrimmed || null
          : ownOptions?.find((o) => o.code === ownCode)?.name ?? (ownCode && ownCode === initial?.ownCode ? initial?.ownName ?? null : null),
        competitorId: !customMode && ownCode && !isCustomOwnCode(ownCode) && competitorId ? competitorId : null,
        distanceM: autoDistance ?? distNum,
        lat: compLoc?.lat ?? null,
        lng: compLoc?.lng ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>우리 매장</span>
          <select
            className={FIELD}
            value={customMode ? CUSTOM_OPTION[customMode] : ownCode}
            onChange={(e) => {
              const v = e.target.value;
              setCustomMode(customKindOf(v));
              setOwnCode(customKindOf(v) ? "" : v);
              setCompetitorId("");
            }}
          >
            <option value="">{ownOptions == null ? "불러오는 중..." : "연결 안 함"}</option>
            <option value={CUSTOM_OPTION.기존점}>+ 기존점 직접 입력 (목록에 없을 때)</option>
            <option value={CUSTOM_OPTION.후보지}>+ 신규후보지 직접 입력 (목록에 없을 때)</option>
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
          {customMode && (
            <input
              className={FIELD}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="지점명 (예: 부평역점)"
              autoFocus
            />
          )}
        </label>
        <label className="block">
          <span className={LABEL}>점포평가에 등록된 경쟁점에서 고르기 (상호·대수·거리 자동 입력)</span>
          <select className={FIELD} value={competitorId} disabled={!ownCode || !!customMode} onChange={(e) => pickCompetitor(e.target.value)}>
            <option value="">{customMode ? "아래에 직접 입력" : !ownCode ? "우리 매장을 먼저 고르세요" : competitors == null ? "불러오는 중..." : competitors.length === 0 ? "등록된 경쟁점 없음 — 직접 입력" : "직접 입력"}</option>
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
      {showMap && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={LABEL}>주변 지도 — PC방 핀을 누르면 상호·주소가 채워집니다</span>
            <button type="button" className="app-btn-outline rounded-lg px-3 py-1 text-xs" onClick={locateMe}>내 위치</button>
            {gpsError && <span className="text-xs text-red-600 dark:text-red-400">{gpsError}</span>}
          </div>
          <PingMap
            center={compLoc ?? gps ?? ownLoc}
            getToken={getToken}
            pins={[
              ...(ownLoc ? [{ id: "own", name: ownOptions?.find((o) => o.code === ownCode)?.name ?? "우리 매장", lat: ownLoc.lat, lng: ownLoc.lng, kind: "own" as const }] : []),
              ...rivalPins,
              ...(compLoc && name.trim() ? [{ id: "self", name: `${name.trim()} (등록 중)`, lat: compLoc.lat, lng: compLoc.lng, kind: "self" as const }] : []),
            ] satisfies PingMapPin[]}
            onPickPc={(p) => {
              locatedAddress.current = p.address.trim();
              setName(p.name);
              setAddress(p.address);
              setCompLoc({ lat: p.lat, lng: p.lng });
              setGeoState("idle");
            }}
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>상호 *</span>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 레벨업PC방" />
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
          <span className={LABEL}>우리 매장과 거리 (주소로 자동 계산)</span>
          <span className={`${FIELD} block tabular-nums`}>
            {autoDistance != null ? `${autoDistance.toLocaleString("ko-KR")}m` : distNum != null ? `${distNum.toLocaleString("ko-KR")}m (이전 값)` : "-"}
          </span>
          <span className="mt-1 block text-xs text-[var(--sl-ink-soft)]">
            {geoState === "finding" ? "주소 위치 찾는 중…" : geoState === "notFound" ? "주소로 위치를 못 찾았습니다 — 주소를 더 자세히 적거나 지도에서 매장을 고르세요." : customMode || !ownCode ? "우리 매장을 고르면 거리가 계산됩니다." : !ownLoc ? "우리 매장 위치가 점포평가에 없어 거리를 계산하지 못합니다." : !compLoc ? "주소를 넣으면 계산됩니다." : "직선거리"}
          </span>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={`${LABEL} flex flex-wrap items-center justify-between gap-2`}>
            <span>메모 (다우 경쟁점 조사 양식을 그대로 붙여넣으면 줄바꿈이 유지됩니다)</span>
            <button
              type="button"
              className="app-btn-outline rounded-lg px-3 py-1 text-xs"
              onClick={() => {
                if (memo.trim() && !window.confirm("지금 메모를 조사 양식으로 바꿀까요? 적어 둔 내용은 지워집니다.")) return;
                setMemo(surveyTemplate(new Date()));
              }}
            >
              조사 양식 넣기
            </button>
          </span>
          {/* 2026-10-16 점포팀 요청 — 한 줄 입력이라 붙여넣은 양식의 줄바꿈이 사라져 다우에 다시 붙여넣을 때 읽기 어려웠다. */}
          <textarea className={`${FIELD} min-h-[160px] leading-6`} value={memo} onChange={(e) => setMemo(e.target.value)} />
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
            TCP 응답 IP <b className="tabular-nums">{probe.aliveIps.length}</b> / {probe.total}개
            <span className="ml-2 text-xs text-[var(--sl-ink-soft)]">({new Date(probe.at).toLocaleTimeString("ko-KR")} · 기록 안 함)</span>
          </p>
          {probe.aliveIps.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              TCP 응답이 없습니다. 가동률 0%라는 뜻은 아닙니다. IP가 맞아도 방화벽·공유기에서 응답을 막을 수 있습니다.
            </p>
          ) : (
            <p className="mt-1 break-all font-mono text-xs text-[var(--sl-ink-soft)]">{shortIps(probe.aliveIps)}</p>
          )}
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            지금 확인은 TCP만 검사합니다. 매시간 정기 측정은 핑(ICMP)·TCP·타임스탬프를 함께 검사하므로 결과가 다를 수 있습니다. 응답 수만으로 실제 이용 좌석 수를 확정할 수 없습니다.
          </p>
        </div>
      )}
      {error && <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">{error}</p>}
    </div>
  );
}

// 2026-10-16 점포팀 요청 — 현장 담당자가 빈칸만 채우게 다우 "경쟁점 조사 양식" 틀을 넣는다(사용자가 준 리벨 노형점 평가문 모양).
// 매장명·주소·IP·전체 대수는 위 기본정보 칸에 이미 적으므로 틀에 넣지 않는다 — 상세 화면 메모와 복사에 기본정보가 같이 붙는다
// ([id]/page.tsx MemoBlock, 사용자 "굳이 또 넣게 하지 말고 기본정보를 불러와서").
// 사용자 10-16: 항목 사이 빈 줄 없이, "방문 일시 고객수"엔 버튼 누른 시각(현장 입력 시각)을 넣는다.
function surveyTemplate(now: Date): string {
  const h = now.getHours();
  const visited = `${String(now.getFullYear()).slice(2)}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시 ${now.getMinutes()}분`;
  return [
    "- 일반석",
    "1. CPU : ",
    "2. VGA : ",
    "3. RAM : ",
    "4. 모니터 : ",
    "- 프리미엄석 : ",
    "- 커플석 : ",
    "- 1인석 : ",
    "- 팀룸 : ",
    "- 매장 현황",
    `1. 방문 일시 고객수 : ${visited} `,
    "2. 인테리어 수준 : ",
    "3. 매장 관리 상태 (청결, 친절 등) : ",
    "4. 먹거리 브랜드 : ",
    "5. 1,000원 시간 : ",
    "6. 유료차감 : ",
    "종합 평가",
    "",
  ].join("\n");
}
