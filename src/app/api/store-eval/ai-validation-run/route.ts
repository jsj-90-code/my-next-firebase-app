import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
import { fetchAdminDongPopulation, geocodeToAdminDong } from "@/lib/sgis";
import { runLocationEvalDraft } from "@/lib/storeEval/locationEvalAi";
import { buildLocationEvalContext, type LocationEvalContextCandidate } from "@/lib/storeEval/locationEvalContext";
import { DEMAND_POINT_TARGETS, NEARBY_PC_RADIUS_M } from "@/lib/storeEval/demandPointTargets";
import { haversineDistanceMeters } from "@/lib/storeEval/geo";
import type { AdminDongReference, Competitor, DemandPoint, LocationEvaluation } from "@/lib/storeEval/types";

// 4단계 — 기존 블랙라벨 매장 대상 AI 채점 정확도 검증. 이미 문을 연 매장은 오픈 전 사람이 직접
// 매긴 1~5점(storeEvalLocationEvaluations)이 "정답지"로 실제 남아있다. 같은 주소로 신규후보지와
// 동일한 로직(locationEvalAi.ts)을 태워서 AI 점수를 뽑고, 사람 점수와 비교한다(비교 자체는
// aiValidation.ts, 여기서는 안 함).
//
// 기존 매장은 후보지 파이프라인(storeEvalCandidates/Competitors/DemandPoints/AdminDongReferences)을
// 거친 적이 없어서 그 컬렉션에 데이터가 없다 — 경쟁점/수요거점/행정동통계를 매 요청마다 즉석으로만
// 조회하고 어디에도 저장하지 않는다(후보지 전용 컬렉션의 의미를 오염시키지 않기 위함). 지도 이미지
// 캡처는 브라우저 DOM이 필요해 서버 배치와 안 맞아 이번 검증에서는 생략한다(텍스트 컨텍스트만).
//
// 매장 1곳당 Gemini 2단계 호출(웹검색 조사+구조화 추출)에 30~45초가 걸려서, 여러 매장을 한
// 요청 안에서 순차 처리하면 Vercel 함수 타임아웃(300초)을 넘길 수 있다 — 그래서 collect-market-data/
// ai-location-eval과 같은 패턴으로 "매장 1곳 = API 호출 1번"을 유지하고, 클라이언트(검증 화면)가
// 매장 목록을 순차로 반복 호출한다.

async function getVerifiedUserId(request: Request) {
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

type RequestBody = { storeCode?: string };

const SCORE_FIELD_KEYS = ["locationScore", "flowScore", "preemptionScore", "visibilityScore", "attractionScore"] as const;

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!adminDb) return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const storeCode = body.storeCode?.trim();
  if (!storeCode) return NextResponse.json({ error: "storeCode가 필요합니다." }, { status: 400 });

  const [storeSnap, locSnap] = await Promise.all([
    adminDb.collection("storeEvalExistingStores").doc(storeCode).get(),
    adminDb.collection("storeEvalLocationEvaluations").doc(storeCode).get(),
  ]);
  if (!storeSnap.exists) {
    return NextResponse.json({ storeCode, skipped: true, reason: "매장을 찾을 수 없습니다." });
  }
  const storeName = (storeSnap.data()?.storeName as string | undefined) ?? storeCode;

  if (!locSnap.exists) {
    return NextResponse.json({ storeCode, storeName, skipped: true, reason: "입지동선평가(정답지) 기록이 없습니다." });
  }
  const loc = locSnap.data() as LocationEvaluation;
  const address = loc.address?.trim();
  const groundTruth = Object.fromEntries(SCORE_FIELD_KEYS.map((k) => [k, loc[k]])) as Record<(typeof SCORE_FIELD_KEYS)[number], number | null>;
  const missingGroundTruth = !address || SCORE_FIELD_KEYS.some((k) => groundTruth[k] == null);
  if (missingGroundTruth) {
    return NextResponse.json({ storeCode, storeName, skipped: true, reason: "정답지(주소 또는 5개 점수)가 불완전합니다." });
  }

  const geocode = await geocodeAddress(address).catch(() => null);
  if (!geocode) {
    return NextResponse.json({ storeCode, storeName, address, skipped: true, reason: "주소 지오코딩에 실패했습니다." });
  }
  const origin = { lat: geocode.lat, lng: geocode.lng };

  // 경쟁점(PC방, 500m) — 즉석 조회, 저장 안 함.
  let competitors: Competitor[] = [];
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
      room1: null,
      room2: null,
      teamRoom: null,
      coupleZone: null,
      premiumZone: null,
      premiumSpec: null,
      createdAt: now,
      updatedAt: now,
    }));
  } catch {
    competitors = []; // 실패해도 텍스트 컨텍스트 없이 진행(전체를 막지 않는다)
  }

  // 수요거점 — 즉석 조회, 저장 안 함.
  let demandPoints: DemandPoint[] = [];
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
    demandPoints = [];
  }

  // 행정동 인구통계(SGIS) — 즉석 조회, 저장 안 함.
  let adminDongReference: AdminDongReference | null = null;
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
    adminDongReference = null;
  }

  // 기존 매장은 소상공인365 참고자료를 수집한 적이 없어(후보지 전용 2단계) 전부 null로 둔다 —
  // buildLocationEvalContext는 값이 없는 항목은 조용히 생략한다(지어내지 않음).
  const contextCandidate: LocationEvalContextCandidate = {
    name: storeName,
    address,
    roadAddress: geocode.roadAddress,
    floating500Avg: null,
    employ500Total: null,
    employ1kmTotal: null,
    operatingPcStores500m: null,
    operatingPcStores1km: null,
    facility500SubwayRiders: null,
  };

  const contextText = buildLocationEvalContext({ candidate: contextCandidate, competitors, demandPoints, adminDongReference });

  try {
    const draft = await runLocationEvalDraft({ contextText, mapImageBase64: null });
    const aiFields = Object.fromEntries(SCORE_FIELD_KEYS.map((k) => [k, draft.fields[k] as number | null]));
    return NextResponse.json({
      storeCode,
      storeName,
      address,
      skipped: false,
      groundTruth,
      aiFields,
      rationale: draft.rationale,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ storeCode, storeName, address, skipped: true, reason: message });
  }
}
