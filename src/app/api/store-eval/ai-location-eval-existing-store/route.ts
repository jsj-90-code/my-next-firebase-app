import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
import { fetchAdminDongPopulation, geocodeToAdminDong } from "@/lib/sgis";
import { runLocationEvalDraft } from "@/lib/storeEval/locationEvalAi";
import { buildLocationEvalContext, type LocationEvalContextCandidate } from "@/lib/storeEval/locationEvalContext";
import { DEMAND_POINT_TARGETS, NEARBY_PC_RADIUS_M } from "@/lib/storeEval/demandPointTargets";
import { haversineDistanceMeters } from "@/lib/storeEval/geo";
import type { AdminDongReference, Competitor, DemandPoint, ExistingStore } from "@/lib/storeEval/types";

// 2026-08-27 — 기존 가맹점용 입지동선평가 AI 초안. 신규 후보지는 /api/store-eval/ai-location-eval을
// 쓰는데, 그 라우트는 storeEvalCandidates 문서가 반드시 있어야 동작한다(순수 레거시 매장은 이 문서가
// 아예 없어 404). 이 라우트가 그 빈 자리를 채운다 — locationEvalAi.ts(Gemini 2단계 호출)는 동일하게
// 재사용하고, 컨텍스트 수집만 기존 가맹점 사정에 맞게 다르게 한다:
//   - originCandidateCode가 있는(웹에서 만든 후보지가 오픈해서 전환된) 매장은 그 코드로 저장된
//     실제 경쟁점/수요거점/행정동통계를 그대로 재사용한다(신규 코드 불필요, 더 정확함).
//   - 그마저도 없는(스프레드시트에서 바로 마이그레이션된) 순수 레거시 매장은 ai-validation-run과
//     같은 방식으로 카카오/SGIS를 즉석 조회한다(저장은 안 함).
// 저장은 이 라우트에서 하지 않는다 — LocationEvalTab의 기존 검토·적용·저장 흐름을 그대로 탄다.

type RequestBody = { storeCode?: string };

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const storeCode = body.storeCode?.trim();
  if (!storeCode) return NextResponse.json({ error: "storeCode가 필요합니다." }, { status: 400 });

  const storeSnap = await adminDb.collection("storeEvalExistingStores").doc(storeCode).get();
  if (!storeSnap.exists) return NextResponse.json({ error: "매장을 찾을 수 없습니다." }, { status: 404 });
  const store = storeSnap.data() as ExistingStore;
  const address = store.address?.trim();
  if (!address) return NextResponse.json({ error: "주소가 없습니다. 먼저 매장 정보에 주소를 입력해주세요." }, { status: 400 });

  const lookupCode = store.originCandidateCode ?? storeCode;
  const [storedCompetitorsSnap, storedDemandPointsSnap, storedAdminDongSnap] = await Promise.all([
    adminDb.collection("storeEvalCompetitors").where("candidateCode", "==", lookupCode).get(),
    adminDb.collection("storeEvalDemandPoints").where("candidateCode", "==", lookupCode).get(),
    adminDb.collection("storeEvalAdminDongReferences").doc(lookupCode).get(),
  ]);

  let competitors: Competitor[] = storedCompetitorsSnap.docs.map((d) => d.data() as Competitor);
  const demandPoints: DemandPoint[] = storedDemandPointsSnap.docs.map((d) => d.data() as DemandPoint);
  let adminDongReference: AdminDongReference | null = storedAdminDongSnap.exists ? (storedAdminDongSnap.data() as AdminDongReference) : null;
  const warnings: string[] = [];

  // 저장된 데이터가 하나도 없으면(순수 레거시 매장) ai-validation-run과 같은 방식으로 즉석 조회한다.
  if (competitors.length === 0 && demandPoints.length === 0 && !adminDongReference) {
    const geocode = await geocodeAddress(address).catch(() => null);
    if (!geocode) {
      return NextResponse.json({ error: "주소 지오코딩에 실패했습니다." }, { status: 502 });
    }
    const origin = { lat: geocode.lat, lng: geocode.lng };

    try {
      const places = await searchByKeyword(origin.lat, origin.lng, "PC방", NEARBY_PC_RADIUS_M);
      const now = Date.now();
      competitors = places.map((p) => ({
        id: `${storeCode}_${p.id}`,
        candidateCode: storeCode,
        name: p.name,
        surveyLevel: null,
        investigationStatus: "조사완료",
        address: null,
        distanceM: p.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: p.lat, lng: p.lng })),
        floor: null,
        groundLevel: null,
        totalPcCount: null,
        appliedPcCount: null,
        hasElevator: null,
        cpu: null,
        cpuTop1: null,
        cpuTop2: null,
        vgaBase: null,
        vgaTop: null,
        vgaTop2: null,
        ram: null,
        ramTop: null,
        monitorBase: null,
        monitorTop: null,
        ratePer1000Won: null,
        hourlyRateConverted: null,
        paidDeduction: null,
        visitedAt: null,
        visitedDow: null,
        visitorCount: null,
        measuredSeatRate: null,
        pingbotUtilization: null,
        pingbotPeriod: null,
        renovationYear: null,
        foodScore: null,
        foodBasis: null,
        foodBrand: null,
        interiorScore: null,
        interiorBasis: null,
        interiorLevelScore: null,
        interiorConditionScore: null,
        monitorBasis: null,
        seatZoneScore: null,
        comfortScore: null,
        singleSeatCount: null,
        room1: null,
        room2: null,
        teamRoom: null,
        coupleZone: null,
        vipZone: null,
        friendsZone: null,
        firstClassZone: null,
        managementScore: null,
        regularCoupleSeatCount: null,
        teamRoomTotalSeats: null,
        teamRoomTotalSeatsBasis: null,
        createdAt: now,
        updatedAt: now,
      }));
    } catch {
      warnings.push("경쟁점 즉석 조회에 실패했습니다 — 텍스트 컨텍스트 없이 진행합니다.");
    }

    try {
      const now = Date.now();
      for (const target of DEMAND_POINT_TARGETS) {
        const places =
          target.kind === "category"
            ? await searchByCategory(origin.lat, origin.lng, target.code, target.radiusM)
            : await searchByKeyword(origin.lat, origin.lng, target.keyword, target.radiusM);
        for (const p of places) {
          demandPoints.push({
            id: `${storeCode}_${p.id}`,
            candidateCode: storeCode,
            name: p.name,
            category: target.category,
            lat: p.lat,
            lng: p.lng,
            distanceM: p.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: p.lat, lng: p.lng })),
            source: "kakao",
            sourcePlaceId: p.id,
            fetchedAt: now,
            confirmed: false,
          });
        }
      }
    } catch {
      warnings.push("수요거점 즉석 조회에 실패했습니다 — 텍스트 컨텍스트 없이 진행합니다.");
    }

    try {
      const lookup = await geocodeToAdminDong(address);
      if (lookup) {
        const pop = await fetchAdminDongPopulation(lookup.admCd);
        adminDongReference = {
          candidateCode: storeCode,
          admCd: lookup.admCd,
          admName: lookup.admName,
          totalPopulation: pop.totalPopulation,
          malePopulation: pop.malePopulation,
          femalePopulation: pop.femalePopulation,
          year: pop.year,
          fetchedAt: Date.now(),
        };
      }
    } catch {
      warnings.push("행정동 인구통계 조회에 실패했습니다.");
    }
  }

  const contextCandidate: LocationEvalContextCandidate = {
    name: store.storeName,
    address,
    roadAddress: address,
    floating500Avg: store.floating500Avg,
    employ500Total: null,
    employ1kmTotal: null,
    operatingPcStores500m: store.operatingPcStores500m,
    operatingPcStores1km: null,
    facility500SubwayRiders: null,
  };

  const contextText = buildLocationEvalContext({ candidate: contextCandidate, competitors, demandPoints, adminDongReference });

  try {
    const draft = await runLocationEvalDraft({ contextText, mapImageBase64: null });
    return NextResponse.json({ ...draft, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
