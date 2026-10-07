import { NextResponse } from "next/server";
import { geocodeAddress, searchByCategory, searchByKeyword, type KakaoPlace } from "@/lib/kakao";
import { adminDb } from "@/lib/firebase-admin";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { DEMAND_POINT_TARGETS, NEARBY_PC_RADIUS_M } from "@/lib/storeEval/demandPointTargets";
import { findNearbyCandidates, haversineDistanceMeters } from "@/lib/storeEval/geo";
import type { Competitor, DemandPoint, DemandPointCategory } from "@/lib/storeEval/types";
import { lookupBuildingElevator } from "@/lib/storeEval/buildingElevator";
import { lookupPcBangPermit } from "@/lib/storeEval/pcBangPermit";
import { collectKakaoPcBangs } from "@/lib/storeEval/quickEval/kakaoPcBangs";
import { judgePcBangName } from "@/lib/storeEval/quickEval/pcBangNameFilter";
import { CANDIDATE_RIVAL_2KM_COLLECTION, RIVAL_2KM_OUTER_RADIUS_M, type CandidateRival2kmDoc } from "@/lib/storeEval/rival2km";

// 신규후보지 "상권자료 수집" 1단계 — 주소 지오코딩 + 행정구역 참고자료 + 경쟁점/수요거점
// 자동수집을 한 번에 처리한다(요청사항 2단계 화면 흐름 중 1~4단계, 7단계에 해당).
//
// 중요: 여기서 자동으로 저장하는 값은 전부 "사실을 그대로 옮긴 것"이다 — 좌표는 카카오 주소검색
// 결과, 행정구역참고자료는 SGIS 공식 API 결과, 경쟁점/수요거점은 카카오 장소검색 결과다.
// AI가 추정한 값은 하나도 없다(그 부분은 3단계 Gemini 라우트에서 별도로 다룬다).

const DUPLICATE_RADIUS_M = 100;

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
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });
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
  const candidate = candidateSnap.data() as { address?: string; hasElevator?: boolean | null };
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

  // 1-1) 후보지 건물 엘리베이터(2026-10-07 사용자 "가끔 안 적어주는 사람이 있어서") — 경쟁점과 같은 건축물대장 판정.
  //      칸이 비어 있을 때만 "있음"을 채운다(사람이 적은 값은 덮지 않는다). 근거 한 줄은 늘 남겨 칸 밑에 보인다.
  const elevatorPatch: { hasElevator?: true; elevatorBasis?: string } = {};
  let candidateElevatorFailed = false;
  try {
    const e = await lookupBuildingElevator({ lat: geocode.lat, lng: geocode.lng });
    elevatorPatch.elevatorBasis = e.basis;
    if (e.hasElevator === true && candidate.hasElevator == null) elevatorPatch.hasElevator = true;
  } catch {
    candidateElevatorFailed = true;
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
      ...elevatorPatch,
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

  // (3단계였던 SGIS 행정동 인구통계 수집은 2026-09-28에 뺐다 — 산식 무관 참고자료였고, SGIS가 아직 없는 연도를 물어
  //  "검색결과가 존재하지 않습니다(errCd -100)"가 매번 떴다. 이미 저장된 storeEvalAdminDongReferences 문서는 그대로 둔다.)

  // 3) 경쟁점(PC방) + 수요거점 자동수집 (카카오)
  const origin = { lat: geocode.lat, lng: geocode.lng };
  let competitorsAdded = 0;
  let demandPointsAdded = 0;
  const collectionErrors: string[] = [];
  if (candidateElevatorFailed) collectionErrors.push("후보지 건물의 건축물대장 조회에 실패해 엘리베이터는 그대로 뒀습니다.");

  try {
    const pcPlaces = await searchByKeyword(origin.lat, origin.lng, "PC방", NEARBY_PC_RADIUS_M);
    const existingCompetitorsSnap = await adminDb.collection("storeEvalCompetitors").where("candidateCode", "==", candidateCode).get();
    const existingPlaceIds = new Set(existingCompetitorsSnap.docs.map((d) => d.data().sourcePlaceId).filter(Boolean));
    const batch = adminDb.batch();
    // 2026-09-26 — 새 경쟁점마다 건축물대장으로 엘리베이터를 판정한다(경쟁점은 지도로 못 봐서 사람이 추측해 왔다, 사용자).
    // 이 라우트는 vercel.json에서 서울 리전(icn1) 고정 — 공공 API가 해외 리전을 막을 수 있다(소상공인365 선례).
    // "있음"만 채우고 판정 못 하면 빈칸. 실패해도 수집은 계속한다(키 없음·503 등 → 빈칸 + 안내 한 줄). 3곳씩 나눠 부른다.
    const newPlaces = pcPlaces.filter((p) => !existingPlaceIds.has(p.id));
    const elevatorByPlace = new Map<string, { hasElevator: true | null; basis: string }>();
    let elevatorFailed = 0;
    for (let i = 0; i < newPlaces.length; i += 3) {
      await Promise.all(
        newPlaces.slice(i, i + 3).map(async (p) => {
          try {
            elevatorByPlace.set(p.id, await lookupBuildingElevator({ lat: p.lat, lng: p.lng }));
          } catch {
            elevatorFailed++;
          }
        }),
      );
    }
    if (elevatorFailed > 0) collectionErrors.push(`경쟁점 ${elevatorFailed}곳은 건축물대장 조회에 실패해 엘리베이터를 빈칸으로 뒀습니다.`);
    for (const place of pcPlaces) {
      if (existingPlaceIds.has(place.id)) continue;
      const distanceM = place.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: place.lat, lng: place.lng }));
      const competitor: Competitor = {
        id: `${candidateCode}_kakao_${place.id}`,
        candidateCode,
        name: place.name,
        surveyLevel: null,
        // 조사 상태 값에는 "미조사"가 없다(조사완료·경쟁점없음·노후저경쟁력미조사·오픈예정). 그래서 "조사완료"로 두고
        // 사양·대수·가동률은 전부 null로 남긴다(지어내지 않음). 이 상태의 경쟁점을 V62는 **0대**로 센다(값 누락) —
        // 사람이 대수를 넣거나 조사수준 "간략"(90대)을 골라야 한다. 결과 탭 "빈 입력"에 "경쟁점 PC대수 빈칸 N곳"으로
        // 뜬다(dualEstimate.inputGapsFor, 2026-09-26). (예전 주석은 "조사완료로 두지 않는다"고 적혀 있어 코드와 반대였다.)
        investigationStatus: "조사완료",
        distanceM,
        floor: null,
        groundLevel: null,
        totalPcCount: null,
        appliedPcCount: null,
        hasElevator: elevatorByPlace.get(place.id)?.hasElevator ?? null,
        elevatorBasis: elevatorByPlace.get(place.id)?.basis ?? null,
        // 2026-09-28 — 인허가 자료로 만든 조사표 초기값. 번들 색인이라 네트워크 없이 바로 찾는다. 조사 칸엔 안 넣는다.
        permitHint: lookupPcBangPermit({ name: place.name, lat: place.lat, lng: place.lng }),
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

  // 3-1) 2km 경쟁점(실험실 산식용, 2026-09-28) — 카카오 격자로 잘림 없이 받아 후보지별 문서 하나에 저장한다.
  //      500m 안은 위 경쟁점 DB가 세고, 실험실은 500m 밖~2km만 이 문서에서 읽는다(rival2km.ts 머리). 오락실·성인PC는 상호로 거른다.
  //      전에는 사람이 스크립트로 코드 자료(rival2km.json)를 다시 만들기 전까지 새 후보지의 2km가 통째로 빠졌다.
  let rival2kmCount: number | null = null;
  try {
    const grid = await collectKakaoPcBangs(origin, RIVAL_2KM_OUTER_RADIUS_M);
    const rivals = grid.places
      .filter((p) => judgePcBangName(p).counted)
      .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, distanceM: p.distanceM, sourcePlaceId: p.id }))
      .sort((a, b) => a.distanceM - b.distanceM);
    const docData: CandidateRival2kmDoc = { candidateCode, collectedAt: now, radiusM: RIVAL_2KM_OUTER_RADIUS_M, possiblyTruncated: grid.possiblyTruncated, rivals };
    await adminDb.collection(CANDIDATE_RIVAL_2KM_COLLECTION).doc(candidateCode).set(docData);
    rival2kmCount = rivals.length;
    if (grid.possiblyTruncated) collectionErrors.push("2km 경쟁점 목록이 카카오 상한에 걸려 완전하지 않을 수 있습니다.");
  } catch (err) {
    collectionErrors.push(`2km 경쟁점 수집 실패: ${err instanceof Error ? err.message : String(err)}`);
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
    competitorsAdded,
    demandPointsAdded,
    rival2kmCount,
    collectionErrors,
    demandPointCategoriesSkipped: ["군부대", "산업단지", "관광유흥", "먹자상권"],
  });
}
