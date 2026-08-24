"use client";

// 후보지 좌표 확인/보정 + 주변 경쟁점·수요거점 표시용 지도.
// 카카오맵 JS SDK(공개키, NEXT_PUBLIC_KAKAO_MAP_JS_KEY)를 next/script로 로드한다 — 이 키는
// 카카오 콘솔에서 도메인 제한을 걸어 발급하는 공개키라 브라우저에 노출되는 게 정상이다
// (서버 전용 REST 키인 KAKAO_REST_API_KEY와는 다른 키).

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { DemandPointCategory } from "@/lib/storeEval/types";

declare global {
  interface Window {
    kakao?: any;
  }
}

export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: DemandPointCategory | "PC방(경쟁점)";
};

const CATEGORY_COLORS: Record<string, string> = {
  "PC방(경쟁점)": "#dc2626",
  지하철역: "#2563eb",
  버스정류장: "#0891b2",
  학교: "#16a34a",
  대학: "#15803d",
  아파트단지: "#7c3aed",
  대형상업시설: "#ea580c",
  먹자상권: "#db2777",
  군부대: "#525252",
  산업단지: "#525252",
  관광유흥: "#525252",
};

export function CandidateMap({
  lat,
  lng,
  points,
  onConfirmPosition,
}: {
  lat: number;
  lng: number;
  points: MapPoint[];
  onConfirmPosition: (lat: number, lng: number) => void;
}) {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const [pendingPosition, setPendingPosition] = useState<{ lat: number; lng: number } | null>(null);

  const jsKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;

  useEffect(() => {
    if (!sdkLoaded || !window.kakao?.maps) return;
    window.kakao.maps.load(() => setMapsReady(true));
  }, [sdkLoaded]);

  useEffect(() => {
    if (!mapsReady || !containerRef.current) return;
    const kakao = window.kakao;
    const center = new kakao.maps.LatLng(lat, lng);
    const map = new kakao.maps.Map(containerRef.current, { center, level: 4 });

    const marker = new kakao.maps.Marker({ position: center, draggable: true });
    marker.setMap(map);
    markerRef.current = marker;
    kakao.maps.event.addListener(marker, "dragend", () => {
      const pos = marker.getPosition();
      setPendingPosition({ lat: pos.getLat(), lng: pos.getLng() });
    });

    for (const p of points) {
      const overlayEl = document.createElement("div");
      overlayEl.style.cssText =
        `display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:9999px;` +
        `background:${CATEGORY_COLORS[p.category] ?? "#71717a"};color:white;font-size:11px;white-space:nowrap;` +
        `box-shadow:0 1px 2px rgba(0,0,0,0.3);`;
      overlayEl.textContent = p.name;
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(p.lat, p.lng),
        content: overlayEl,
        yAnchor: 1.4,
      });
      overlay.setMap(map);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsReady, lat, lng, points]);

  if (!jsKey) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        NEXT_PUBLIC_KAKAO_MAP_JS_KEY가 설정되지 않아 지도를 표시할 수 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false&libraries=services`}
        strategy="afterInteractive"
        onReady={() => setSdkLoaded(true)}
      />
      <div ref={containerRef} className="h-80 w-full rounded-xl border border-zinc-200 dark:border-zinc-800" />
      {pendingPosition && (
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
          <span>
            마커를 이동했습니다 ({pendingPosition.lat.toFixed(6)}, {pendingPosition.lng.toFixed(6)}).
          </span>
          <button
            type="button"
            onClick={() => {
              onConfirmPosition(pendingPosition.lat, pendingPosition.lng);
              setPendingPosition(null);
            }}
            className="rounded-md bg-blue-600 px-2 py-1 font-semibold text-white hover:bg-blue-700"
          >
            이 위치로 확정
          </button>
          <button
            type="button"
            onClick={() => {
              markerRef.current?.setPosition(new window.kakao.maps.LatLng(lat, lng));
              setPendingPosition(null);
            }}
            className="rounded-md border border-blue-300 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-100"
          >
            취소
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {Object.entries(CATEGORY_COLORS).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
