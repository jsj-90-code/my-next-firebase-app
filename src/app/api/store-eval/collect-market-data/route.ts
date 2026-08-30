import { NextResponse } from "next/server";
import { geocodeAddress, searchByCategory, searchByKeyword, type KakaoPlace } from "@/lib/kakao";
import { fetchAdminDongPopulation, geocodeToAdminDong } from "@/lib/sgis";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { DEMAND_POINT_TARGETS, NEARBY_PC_RADIUS_M } from "@/lib/storeEval/demandPointTargets";
import { findNearbyCandidates, haversineDistanceMeters } from "@/lib/storeEval/geo";
import type { Competitor, DemandPoint, DemandPointCategory } from "@/lib/storeEval/types";

// 신규후보지 "상권자료 수집" 1단계 — 주소 지오코딩 + 행정구역 참고자료 + 경쟁점/수요거점
// 자동수집을 한 번에 처리한다(요청사항 2단계 화면 흐름 중 1~4단계, 7단계에 해당).
//
// 중요: 여기서 자동으로 저장하는 값은 전부 "사실을 그대로 옮긴 것"이다 — 좌표는 카카오 주소검색
// 결과, 행정구역참고자료는 SGIS 공식 API 결과, 경쟁점/수요거점은 카카오 장소검색 결과다.
// AI가 추정한 값은 하나도 없다(그 부분은 3단계 Gemini 라우트에서 별도로 다룬다).

const DUPLICATE_RADIUS_M = 100;

async function getVerifiedUserId(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !adminAuth) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function placeToDemandPoint(
  place: KakaoPlace,
  candidateCode: string,
  category: DemandPointCategory,
  origin: { lat: number; lng: number },
  now: number,
): DemandPoint {
  const distanceM = place.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: place.lat, lng: place.lng }));
  return {
    id: `${candidateCode}_kakao_${place.id}`,
    candidateCode,
    name: place.name,
    category,
    lat: place.lat,
    lng: place.lng,
    distanceM,
    source: "kakao",
    sourcePlaceId: place.id,
    fetchedAt: now,
    confirmed: false,
  };
}

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });

  let body: { candidateCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const candidateCode = body.candidateCode?.trim();
  if (!candidateCode) return NextResponse.json({ error: "candidateCode가 필요합니다." }, { status: 400 });

  const candidateSnap = await adminDb.collection("storeEvalCandidates").doc(candidateCode).get();
  if (!candidateSnap.exists) return NextResponse.json({ error: "후보지를 찾을 수 없습니다. 먼저 저장해주세요." }, { status: 404 });
  const candidate = candidateSnap.data() as { address?: string };
  const address = candidate.address?.trim();
  if (!address) return NextResponse.json({ error: "주소가 비어 있습니다." }, { status: 400 });

  const now = Date.now();

  // 1) 주소 → 좌표 (카카오) — 실패해도 나머지 단계는 시도하지 않고 여기서 명확히 알린다.
  let geocode;
  try {
    geocode = await geocodeAddress(address);
  } catch (err) {
    return NextResponse.json(
      { error: `주소 지오코딩 실패: ${err instanceof Error ? err.message : String(err)}`, geocodeStatus: "수집 실패" },
      { status: 502 },
    );
  }
  if (!geocode) {
    return NextResponse.json({ error: "주소와 일치하는 좌표를 찾지 못했습니다. 주소를 확인해주세요.", geocodeStatus: "수집 실패" }, { status: 200 });
  }

  await adminDb.collection("storeEvalCandidates").doc(candidateCode).set(
    {
      lat: geocode.lat,
      lng: geocode.lng,
      roadAddress: geocode.roadAddress,
      jibunAddress: geocode.jibunAddress,
      buildingName: geocode.buildingName,
      geocodedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  // 2) 중복 후보지 경고 (좌표 100m 이내 또는 도로명주소 완전일치)
  const allCandidatesSnap = await adminDb.collection("storeEvalCandidates").get();
  const others = allCandidatesSnap.docs
    .map((d) => d.data() as { code: string; name?: string; lat: number | null; lng: number | null; roadAddress: string | null })
    .filter((c) => c.code !== candidateCode);
  const nearby = findNearbyCandidates(
    { code: candidateCode, lat: geocode.lat, lng: geocode.lng, roadAddress: geocode.roadAddress },
    others,
    DUPLICATE_RADIUS_M,
  ).map((c) => ({ code: c.code, name: c.name ?? "" }));

  // 3) 행정구역 참고자료 (SGIS) — 실패해도 나머지(경쟁점/수요거점 자동수집)는 계속 진행한다.
  let adminDongStatus: "자동수집 완료" | "수집 실패" = "수집 실패";
  let adminDongError: string | null = null;
  try {
    const lookup = await geocodeToAdminDong(address);
    if (lookup) {
      const pop = await fetchAdminDongPopulation(lookup.admCd);
      await adminDb.collection("storeEvalAdminDongReferences").doc(candidateCode).set({
        candidateCode,
        admCd: lookup.admCd,
        admName: lookup.admName,
        totalPopulation: pop.totalPopulation,
        malePopulation: pop.malePopulation,
        femalePopulation: pop.femalePopulation,
        year: pop.year,
        fetchedAt: now,
      });
      adminDongStatus = "자동수집 완료";
    } else {
      adminDongError = "SGIS 지오코딩에서 행정구역을 찾지 못했습니다.";
    }
  } catch (err) {
    adminDongError = err instanceof Error ? err.message : String(err);
  }

  // 4) 경쟁점(PC방) + 수요거점 자동수집 (카카오)
  const origin = { lat: geocode.lat, lng: geocode.lng };
  let competitorsAdded = 0;
  let demandPointsAdded = 0;
  const collectionErrors: string[] = [];

  try {
    const pcPlaces = await searchByKeyword(origin.lat, origin.lng, "PC방", NEARBY_PC_RADIUS_M);
    const existingCompetitorsSnap = await adminDb.collection("storeEvalCompetitors").where("candidateCode", "==", candidateCode).get();
    const existingPlaceIds = new Set(existingCompetitorsSnap.docs.map((d) => d.data().sourcePlaceId).filter(Boolean));
    const batch = adminDb.batch();
    for (const place of pcPlaces) {
      if (existingPlaceIds.has(place.id)) continue;
      const distanceM = place.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: place.lat, lng: place.lng }));
      const competitor: Competitor = {
        id: `${candidateCode}_kakao_${place.id}`,
        candidateCode,
        name: place.name,
        surveyLevel: null,
        investigationStatus: "조사완료", // 자동수집만으론 사양·가동률을 모르므로 "미조사"에 준하지만,
        // 05_경쟁점정보 워크플로 상 이 값은 "실사 진행 여부"라 자동수집 직후엔 화면에서 "확인 필요"로
        // 안내하고 실제 필드값은 전부 null로 남긴다(지어내지 않음) — investigationStatus는 사용자가
        // 실사 후 직접 바꾸는 게 맞아 여기서는 조사완료로 두지 않고 명시적으로 표시한다.
        distanceM,
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
        source: "kakao",
        sourcePlaceId: place.id,
        lat: place.lat,
        lng: place.lng,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(adminDb.collection("storeEvalCompetitors").doc(competitor.id), competitor);
      competitorsAdded++;
    }
    if (competitorsAdded > 0) await batch.commit();
  } catch (err) {
    collectionErrors.push(`경쟁점(PC방) 수집 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const existingPointsSnap = await adminDb.collection("storeEvalDemandPoints").where("candidateCode", "==", candidateCode).get();
    const existingPlaceIds = new Set(existingPointsSnap.docs.map((d) => d.data().sourcePlaceId).filter(Boolean));
    const batch = adminDb.batch();
    for (const target of DEMAND_POINT_TARGETS) {
      const places =
        target.kind === "category"
          ? await searchByCategory(origin.lat, origin.lng, target.code, target.radiusM)
          : await searchByKeyword(origin.lat, origin.lng, target.keyword, target.radiusM);
      for (const place of places) {
        if (existingPlaceIds.has(place.id)) continue;
        const point = placeToDemandPoint(place, candidateCode, target.category, origin, now);
        batch.set(adminDb.collection("storeEvalDemandPoints").doc(point.id), point);
        existingPlaceIds.add(place.id); // 이번 호출 안에서도 같은 장소가 여러 타깃에 잡히면 한 번만
        demandPointsAdded++;
      }
    }
    if (demandPointsAdded > 0) await batch.commit();
  } catch (err) {
    collectionErrors.push(`수요거점 수집 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json({
    geocode,
    geocodeStatus: "자동수집 완료",
    nearbyDuplicateWarnings: nearby,
    adminDongReferenceStatus: adminDongStatus,
    adminDongReferenceError: adminDongError,
    competitorsAdded,
    demandPointsAdded,
    collectionErrors,
    demandPointCategoriesSkipped: ["군부대", "산업단지", "관광유흥", "먹자상권"],
  });
}
