// 측정기 지도용 조회(2026-10-16 점포팀 요청: 경쟁점 등록·상세에서 주변을 지도로). Firestore에 아무것도 쓰지 않는다.
// - geocode: 주소들 → 좌표(거리 자동 계산·등록 경쟁점 핀)
// - layers: 기준점 반경 1km 안의 카카오 PC방·수요거점(지도에서 켤 때만 부른다 — 카카오 호출을 아끼려고)
import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
import { collectKakaoPcBangs, haversineM } from "@/lib/storeEval/quickEval/kakaoPcBangs";
import { judgePcBangName } from "@/lib/storeEval/quickEval/pcBangNameFilter";
import { DEMAND_POINT_TARGETS } from "@/lib/storeEval/demandPointTargets";
import { PING_MAP_RADIUS_M, type NearbyResponse } from "@/lib/pingMonitor/nearby";

type Body = {
  geocode?: string[];
  center?: { lat: number; lng: number };
  layers?: ("pc" | "demand")[];
};

const valid = (c: unknown): c is { lat: number; lng: number } =>
  !!c && typeof c === "object" && Number.isFinite((c as { lat: number }).lat) && Number.isFinite((c as { lng: number }).lng);

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const out: NearbyResponse = {};
  try {
    if (Array.isArray(body.geocode)) {
      const addresses = [...new Set(body.geocode.map((a) => String(a ?? "").trim()).filter(Boolean))].slice(0, 40);
      out.geocoded = {};
      for (const a of addresses) {
        const g = await geocodeAddress(a).catch(() => null);
        out.geocoded[a] = g ? { lat: g.lat, lng: g.lng, roadAddress: g.roadAddress } : null;
      }
    }
    const layers = new Set(body.layers ?? []);
    if (layers.size > 0) {
      if (!valid(body.center)) return NextResponse.json({ error: "기준 좌표가 필요합니다." }, { status: 400 });
      const origin = body.center;
      if (layers.has("pc")) {
        const r = await collectKakaoPcBangs(origin, PING_MAP_RADIUS_M);
        out.pcBangs = r.places
          .filter((p) => judgePcBangName(p).counted)
          .map((p) => ({ id: p.id, name: p.name, address: p.address ?? "", category: "PC방", lat: p.lat, lng: p.lng, distanceM: Math.round(p.distanceM ?? haversineM(origin, p)) }));
      }
      if (layers.has("demand")) {
        const seen = new Set<string>();
        out.demandPoints = [];
        for (const t of DEMAND_POINT_TARGETS) {
          const radius = Math.min(t.radiusM, PING_MAP_RADIUS_M);
          const places = t.kind === "category" ? await searchByCategory(origin.lat, origin.lng, t.code, radius) : await searchByKeyword(origin.lat, origin.lng, t.keyword, radius);
          for (const p of places) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            out.demandPoints.push({ id: p.id, name: p.name, address: "", category: t.category, lat: p.lat, lng: p.lng, distanceM: Math.round(p.distanceM ?? haversineM(origin, p)) });
          }
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "카카오 조회에 실패했습니다." }, { status: 502 });
  }
  return NextResponse.json(out);
}
