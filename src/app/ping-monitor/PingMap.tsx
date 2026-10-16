"use client";

// 측정기 지도(2026-10-16 점포팀 요청) — 경쟁점 등록·경쟁점 상세·우리 매장 비교에서 주변을 본다.
// 반경 1km 원, 켜고 끄는 층 셋(주변 PC방 · 수요거점 · 등록 경쟁점). 번잡하지 않게 수요거점은 기본 꺼둔다(사용자).
// 카카오 SDK·키는 점포평가 지도(CandidateMap)와 같다. 주변 PC방·수요거점은 /api/ping-monitor/nearby가 켤 때만 가져온다.
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { PING_MAP_RADIUS_M, type NearbyPlace, type NearbyResponse } from "@/lib/pingMonitor/nearby";
import { listPingStoresByOwn } from "@/lib/pingMonitor/clientStore";
import { getCandidate, getExistingStore } from "@/lib/storeEval/store";

type LatLng = { lat: number; lng: number };
type KLatLng = object;
type KMap = { setCenter(p: KLatLng): void; relayout(): void };
type KOverlay = { setMap(m: KMap | null): void };
type KMaps = {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KLatLng;
  Map: new (el: HTMLDivElement, o: { center: KLatLng; level: number }) => KMap;
  CustomOverlay: new (o: { position: KLatLng; content: HTMLElement; yAnchor: number; zIndex?: number }) => KOverlay;
  Circle: new (o: { center: KLatLng; radius: number; strokeWeight: number; strokeColor: string; strokeOpacity: number; fillColor: string; fillOpacity: number }) => KOverlay;
};
const kmaps = () => (window as unknown as { kakao?: { maps?: KMaps } }).kakao?.maps;

export type PingMapPin = { id: string; name: string; lat: number; lng: number; kind: "own" | "rival" | "self"; note?: string };
type Selected = { name: string; note: string; place?: NearbyPlace };

const COLORS = { own: "#111827", self: "#dc2626", rival: "#ea580c", pc: "#71717a", demand: "#2563eb" };

export function PingMap({ center, pins, getToken, onPickPc, defaultPc = true }: {
  center: LatLng | null;
  pins: PingMapPin[];
  getToken: () => Promise<string>;
  onPickPc?: (place: NearbyPlace) => void;
  defaultPc?: boolean;
}) {
  const jsKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  const [sdk, setSdk] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState({ pc: defaultPc, demand: false, rival: true });
  const [layers, setLayers] = useState<{ key: string; pc?: NearbyPlace[]; demand?: NearbyPlace[] }>({ key: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<KMap | null>(null);
  const drawn = useRef<KOverlay[]>([]);
  const key = center ? `${center.lat.toFixed(5)},${center.lng.toFixed(5)}` : "";

  useEffect(() => {
    if (sdk) kmaps()?.load(() => setReady(true));
  }, [sdk]);

  // 켠 층만, 기준점이 바뀔 때만 가져온다.
  useEffect(() => {
    if (!center) return;
    const need = [show.pc && !(layers.key === key && layers.pc) ? "pc" : null, show.demand && !(layers.key === key && layers.demand) ? "demand" : null].filter(Boolean);
    if (need.length === 0) return;
    let stale = false;
    Promise.resolve()
      .then(() => {
        setLoading(true);
        setError(null);
        return getToken();
      })
      .then((token) => fetch("/api/ping-monitor/nearby", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ center, layers: need }) }))
      .then(async (res) => {
        const body = (await res.json()) as NearbyResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "주변 조회에 실패했습니다.");
        if (stale) return;
        setLayers((prev) => {
          const base = prev.key === key ? prev : { key };
          return { ...base, ...(body.pcBangs ? { pc: body.pcBangs } : {}), ...(body.demandPoints ? { demand: body.demandPoints } : {}) };
        });
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : "주변 조회에 실패했습니다."))
      .finally(() => !stale && setLoading(false));
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, show.pc, show.demand]);

  useEffect(() => {
    const m = kmaps();
    if (!ready || !m || !el.current || !center) return;
    const c = new m.LatLng(center.lat, center.lng);
    if (!map.current) map.current = new m.Map(el.current, { center: c, level: 5 });
    else map.current.setCenter(c);
    for (const o of drawn.current) o.setMap(null);
    drawn.current = [];
    const add = (o: KOverlay) => { o.setMap(map.current); drawn.current.push(o); };
    add(new m.Circle({ center: c, radius: PING_MAP_RADIUS_M, strokeWeight: 1, strokeColor: "#dc2626", strokeOpacity: 0.6, fillColor: "#dc2626", fillOpacity: 0.04 }));
    const pinEl = (text: string, color: string, onClick: () => void, small = false) => {
      const d = document.createElement("div");
      d.style.cssText = `padding:${small ? "1px 5px" : "2px 7px"};border-radius:9999px;background:${color};color:#fff;font-size:${small ? 10 : 11}px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3);cursor:pointer;`;
      d.textContent = text;
      d.onclick = onClick;
      return d;
    };
    const registered = new Set(pins.map((p) => p.name.replace(/\s/g, "")));
    if (show.demand) for (const p of layers.key === key ? layers.demand ?? [] : []) {
      add(new m.CustomOverlay({ position: new m.LatLng(p.lat, p.lng), yAnchor: 1.4, content: pinEl(p.name, COLORS.demand, () => setSelected({ name: p.name, note: `${p.category} · ${p.distanceM}m` }), true) }));
    }
    if (show.pc) for (const p of layers.key === key ? layers.pc ?? [] : []) {
      if (registered.has(p.name.replace(/\s/g, ""))) continue; // 이미 등록된 매장은 아래 등록 핀으로 그린다
      add(new m.CustomOverlay({ position: new m.LatLng(p.lat, p.lng), yAnchor: 1.4, content: pinEl(p.name, COLORS.pc, () => setSelected({ name: p.name, note: `카카오 PC방 · ${p.distanceM}m${p.address ? ` · ${p.address}` : ""}`, place: p })) }));
    }
    for (const p of pins) {
      if (p.kind === "rival" && !show.rival) continue;
      add(new m.CustomOverlay({ position: new m.LatLng(p.lat, p.lng), yAnchor: 1.4, zIndex: 3, content: pinEl(p.name, COLORS[p.kind], () => setSelected({ name: p.name, note: p.note ?? "" })) }));
    }
  }, [ready, key, center, pins, layers, show]);

  if (!jsKey) return <p className="text-xs text-[var(--sl-ink-soft)]">지도 키(NEXT_PUBLIC_KAKAO_MAP_JS_KEY)가 없어 지도를 표시할 수 없습니다.</p>;

  const toggle = (k: keyof typeof show, label: string, color: string) => (
    <button type="button" onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${show[k] ? "border-transparent bg-black/10 font-semibold dark:bg-white/15" : "border-black/15 text-[var(--sl-ink-soft)] dark:border-white/20"}`}>
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: show[k] ? color : "#a1a1aa" }} />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <Script src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false`} strategy="afterInteractive" onReady={() => setSdk(true)} onError={() => setFailed(true)} />
      <div className="flex flex-wrap items-center gap-2">
        {toggle("pc", "주변 PC방", COLORS.pc)}
        {toggle("demand", "수요거점", COLORS.demand)}
        {toggle("rival", "등록 경쟁점", COLORS.rival)}
        <span className="text-[11px] text-[var(--sl-ink-soft)]">반경 {PING_MAP_RADIUS_M / 1000}km{loading ? " · 불러오는 중…" : ""}</span>
      </div>
      {failed ? (
        <p className="text-xs text-[var(--sl-ink-soft)]">지도를 불러오지 못했습니다(카카오 지도 키에 이 주소가 등록되어 있는지 확인).</p>
      ) : !center ? (
        <p className="rounded-xl bg-black/5 px-3 py-6 text-center text-xs text-[var(--sl-ink-soft)] dark:bg-white/5">기준 위치를 정하면 지도가 나옵니다.</p>
      ) : (
        <div ref={el} className="h-72 w-full rounded-xl border border-black/10 sm:h-80 dark:border-white/10" />
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {selected && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/5">
          <b>{selected.name}</b>
          <span className="text-[var(--sl-ink-soft)]">{selected.note}</span>
          {selected.place && onPickPc && (
            <button type="button" className="app-btn-outline ml-auto rounded-lg px-2 py-1" onClick={() => { onPickPc(selected.place!); setSelected(null); }}>
              이 매장으로 채우기
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-[11px] text-[var(--sl-ink-soft)]">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS.own }} />우리 매장</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS.self }} />이 경쟁점</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: COLORS.rival }} />등록 경쟁점</span>
        <span>핀을 누르면 정보가 나옵니다</span>
      </div>
    </div>
  );
}

/** 주소들을 좌표로(서버 카카오). 실패한 주소는 null. */
export async function geocodeAddresses(addresses: string[], getToken: () => Promise<string>): Promise<NonNullable<NearbyResponse["geocoded"]>> {
  const list = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  if (list.length === 0) return {};
  const token = await getToken();
  const res = await fetch("/api/ping-monitor/nearby", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ geocode: list }) });
  const body = (await res.json()) as NearbyResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "주소 확인에 실패했습니다.");
  return body.geocoded ?? {};
}

/** 우리 매장(기존점·후보지) 좌표 — 점포평가 자료에서. 직접 입력한 매장은 좌표가 없어 null. */
export function useOwnLocation(ownCode: string | null | undefined): LatLng | null {
  const [loc, setLoc] = useState<{ code: string; at: LatLng | null } | null>(null);
  useEffect(() => {
    if (!ownCode || ownCode.startsWith("직접")) return;
    let stale = false;
    const load = /^N\d+$/.test(ownCode)
      ? getCandidate(ownCode).then((c) => (c?.lat != null && c?.lng != null ? { lat: c.lat, lng: c.lng } : null))
      : getExistingStore(ownCode).then((s) => (s?.lat != null && s?.lng != null ? { lat: s.lat, lng: s.lng } : null));
    load.then((at) => !stale && setLoc({ code: ownCode, at })).catch(() => !stale && setLoc({ code: ownCode, at: null }));
    return () => { stale = true; };
  }, [ownCode]);
  return ownCode && loc?.code === ownCode ? loc.at : null;
}

/** 같은 우리 매장에 묶인 측정기 경쟁점 핀. 좌표가 저장 안 된 옛 매장은 주소로 한 번에 찾는다(저장은 안 함). */
export function useRivalPins(ownCode: string | null | undefined, getToken: () => Promise<string>, selfId?: string): PingMapPin[] {
  const [pins, setPins] = useState<{ code: string; rows: PingMapPin[] } | null>(null);
  useEffect(() => {
    if (!ownCode) return;
    let stale = false;
    (async () => {
      const stores = (await listPingStoresByOwn(ownCode)).filter((s) => !s.isOwnStore);
      const missing = stores.filter((s) => (s.lat == null || s.lng == null) && s.address).map((s) => s.address);
      const geo = missing.length ? await geocodeAddresses(missing, getToken).catch(() => ({} as Record<string, null>)) : {};
      const rows: PingMapPin[] = [];
      for (const s of stores) {
        const g = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : geo[s.address.trim()] ?? null;
        if (!g) continue;
        rows.push({ id: s.id, name: s.name, lat: g.lat, lng: g.lng, kind: s.id === selfId ? "self" : "rival", note: [s.distanceM != null ? `우리 매장에서 ${s.distanceM}m` : null, s.pcCount ? `${s.pcCount}대` : null].filter(Boolean).join(" · ") });
      }
      if (!stale) setPins({ code: ownCode, rows });
    })().catch(() => !stale && setPins({ code: ownCode, rows: [] }));
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownCode, selfId]);
  return ownCode && pins?.code === ownCode ? pins.rows : [];
}

/** 상세 화면용 지도 — 우리 매장 비교(selfId 없음: 우리 매장 중심) · 경쟁점 상세(selfId: 그 경쟁점 중심). 사용자 10-16. */
export function PingMapSection({ ownCode, ownName, selfId, getToken }: { ownCode: string | null; ownName: string | null; selfId?: string; getToken: () => Promise<string> }) {
  const ownLoc = useOwnLocation(ownCode);
  const rivals = useRivalPins(ownCode, getToken, selfId);
  const self = selfId ? rivals.find((p) => p.id === selfId) ?? null : null;
  // 후보지 주소 없이 경쟁점만 넣은 상권답사 매장 — 경쟁점 좌표의 가운데를 임시 기준으로(우리 매장 핀은 안 찍음). 사용자 10-16.
  const rivalMid = !self && !ownLoc && rivals.length
    ? { lat: rivals.reduce((a, p) => a + p.lat, 0) / rivals.length, lng: rivals.reduce((a, p) => a + p.lng, 0) / rivals.length }
    : null;
  const center = self ? { lat: self.lat, lng: self.lng } : ownLoc ?? rivalMid;
  const pins: PingMapPin[] = [...(ownLoc ? [{ id: "own", name: ownName ?? "우리 매장", lat: ownLoc.lat, lng: ownLoc.lng, kind: "own" as const }] : []), ...rivals];
  return (
    <section className="app-card flex flex-col gap-2 rounded-2xl p-4">
      <h2 className="text-sm font-semibold">주변 지도</h2>
      {rivalMid && <p className="text-xs text-[var(--sl-ink-soft)]">후보지 주소가 없어 경쟁점 {rivals.length}곳의 가운데를 기준으로 표시합니다.</p>}
      {!ownCode && !selfId ? <p className="text-xs text-[var(--sl-ink-soft)]">우리 매장이 연결되지 않아 지도를 그릴 기준이 없습니다.</p> : <PingMap center={center} pins={pins} getToken={getToken} />}
    </section>
  );
}
