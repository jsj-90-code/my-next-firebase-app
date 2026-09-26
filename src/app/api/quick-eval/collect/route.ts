// 주소 하나로 상권자료를 전부 자동수집한다. (주소만 초기평가 도구 · 새 경로)
//
// ⚠️ **운영 후보지 흐름과 완전히 별개다.** Firestore에 아무것도 쓰지 않고(사용자 확정
//    2026-09-22: "저장 안 함 — 화면에만"), 기존 `collect-market-data` 라우트도 건드리지 않는다.
//    이 라우트는 받은 자료를 그대로 JSON으로 돌려주고, 계산은 화면에서 V62를 불러서 한다.
//
// 단계:
//   1. 주소 -> 좌표 (카카오)                        실패하면 여기서 멈춘다(좌표를 지어내지 않는다)
//   2. 주거인구 500m·1km (SGIS 반경조회)             실패해도 계속 — 무엇이 빠졌는지 알려준다
//   3. 유동인구 500m (소상공인365)                   실패해도 계속(스크래핑이라 깨질 수 있다)
//   4. 경쟁점 PC방 500m (카카오 · 격자분할)           실패하면 경쟁점 0곳이 아니라 "수집 실패"다
//   5. 수요거점 (카카오) — AI 입지평가 컨텍스트용
//   6. 입지평가 AI 초안 (Gemini) — 가시성·선점경쟁 등
//
// 한 단계가 실패해도 나머지를 버리지 않는다. 대신 `errors`에 사람이 읽을 문장으로 담아
// 화면이 "무엇을 모른 채로 낸 숫자인지"를 같이 보여준다.

import { NextResponse } from "next/server";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { DEMAND_POINT_TARGETS } from "@/lib/storeEval/demandPointTargets";
import { haversineDistanceMeters } from "@/lib/storeEval/geo";
import { buildLocationEvalContext } from "@/lib/storeEval/locationEvalContext";
import { runLocationEvalDraft } from "@/lib/storeEval/locationEvalAi";
import type { DemandPoint, GroundLevel } from "@/lib/storeEval/types";
import { appendSiteFactsToContext } from "@/lib/storeEval/quickEval/quickEvalLocationContext";
import { collectKakaoPcBangs } from "@/lib/storeEval/quickEval/kakaoPcBangs";
import { collectSgisRadiusPopulation } from "@/lib/storeEval/quickEval/sgisRadiusPopulation";
import { collectSbizFloating, type SbizFloatingResult } from "@/lib/storeEval/quickEval/sbizFloating";
import { SBIZ_FLOATING_RADII, type SbizFloatingRadius } from "@/lib/storeEval/floatingPopulationFromSbiz";
import { QUICK_EVAL_RADII } from "@/lib/storeEval/quickEval/quickEvalDefaults";
import { judgePcBangName } from "@/lib/storeEval/quickEval/pcBangNameFilter";
import { QUICK_EVAL_CANDIDATE_CODE } from "@/lib/storeEval/quickEval/buildQuickCandidate";
import { tmSelfTestFailures } from "@/lib/storeEval/quickEval/tm";

// 소상공인365 스크래핑이 지점당 4초쯤 걸리고 AI 초안이 웹검색까지 한다 — 기본 타임아웃으로는
// 모자란다. Fluid Compute에서 긴 함수가 허용되므로 넉넉히 준다.
export const maxDuration = 300;

type CollectBody = {
  address?: string;
  name?: string;
  skipFloating?: boolean;
  skipAi?: boolean;
  // 물건 정보 — AI 입지평가의 **접근가시성 판단에 넘긴다**(2026-09-22 추가). 안 넘기면 AI가
  // 층수를 모른 채 가시성을 매긴다(quickEvalLocationContext.ts 머리 주석).
  floor?: number | null;
  groundLevel?: GroundLevel | null;
  hasElevator?: boolean | null;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });

  let body: CollectBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const address = body.address?.trim();
  if (!address) return NextResponse.json({ error: "주소가 필요합니다." }, { status: 400 });

  // 좌표변환 검산 — 틀리면 SGIS/소상공인365가 **에러 없이 빈 결과**를 준다. 수집 전에 막는다.
  const tmFailures = tmSelfTestFailures();
  if (tmFailures.length) {
    return NextResponse.json({ error: `좌표변환 검산 실패: ${tmFailures.join(" · ")}` }, { status: 500 });
  }

  const errors: string[] = [];

  // 1) 주소 -> 좌표
  let geocode;
  try {
    geocode = await geocodeAddress(address);
  } catch (err) {
    return NextResponse.json({ error: `주소 지오코딩 실패: ${message(err)}` }, { status: 502 });
  }
  if (!geocode) {
    return NextResponse.json(
      { error: "주소와 일치하는 좌표를 찾지 못했습니다. 도로명주소로 다시 입력해보세요." },
      { status: 200 },
    );
  }
  const origin = { lat: geocode.lat, lng: geocode.lng };

  // 2~5) 자료원마다 따로 실패할 수 있다 — 하나가 죽어도 나머지는 받는다.
  const [sgisResult, floatingResult, pcBangResult, demandPointResult] = await Promise.all([
    collectSgisRadiusPopulation(origin, [QUICK_EVAL_RADII.resident500, QUICK_EVAL_RADII.resident1km])
      .then((v) => ({ ok: true as const, value: v }))
      .catch((err) => ({ ok: false as const, error: `주거인구(SGIS) 수집 실패: ${message(err)}` })),
    body.skipFloating
      ? Promise.resolve({ ok: false as const, error: "유동인구 수집을 건너뛰었습니다(사용자 선택)." })
      // 2026-09-27 — 500m 하나가 아니라 100~1000m 6반경을 **차례로** 받는다(실험실 수요가 400m·중심도가 300m·1km를 읽는다).
      //    500m(V62)가 실패하면 예전처럼 실패로 올리고, 다른 반경 실패는 경고만 남긴다. 반경당 약 4초.
      : collectFloatingRadii(origin)
          .then((v) => ({ ok: true as const, value: v }))
          .catch((err) => ({ ok: false as const, error: `유동인구(소상공인365) 수집 실패: ${message(err)}` })),
    collectKakaoPcBangs(origin, QUICK_EVAL_RADII.competitor)
      .then((v) => ({ ok: true as const, value: v }))
      .catch((err) => ({ ok: false as const, error: `경쟁점(카카오) 수집 실패: ${message(err)}` })),
    collectDemandPoints(origin)
      .then((v) => ({ ok: true as const, value: v }))
      .catch((err) => ({ ok: false as const, error: `수요거점(카카오) 수집 실패: ${message(err)}` })),
  ]);

  if (!sgisResult.ok) errors.push(sgisResult.error);
  if (!floatingResult.ok) errors.push(floatingResult.error);
  if (!pcBangResult.ok) errors.push(pcBangResult.error);
  if (!demandPointResult.ok) errors.push(demandPointResult.error);

  const sgis = sgisResult.ok ? sgisResult.value : null;
  const floating = floatingResult.ok ? floatingResult.value.r500 : null;
  const floatingByRadius = floatingResult.ok ? floatingResult.value.byRadius : {};
  if (floatingResult.ok) errors.push(...floatingResult.value.otherErrors);
  const pcBangs = pcBangResult.ok ? pcBangResult.value.places : [];
  const demandPoints = demandPointResult.ok ? demandPointResult.value : [];

  // SGIS가 원을 잘랐으면 그 값은 "그 반경"이 아니다 — 조용히 넘기지 않는다.
  for (const [radius, stats] of Object.entries(sgis?.byRadius ?? {})) {
    if (stats.areaOffRatio != null && stats.areaOffRatio > 0.1) {
      errors.push(
        `주거인구 ${radius}m의 조회면적이 원 면적과 ${(stats.areaOffRatio * 100).toFixed(0)}% 어긋납니다` +
          " — SGIS가 영역을 자른 것이라 그 반경의 값으로 보기 어렵습니다.",
      );
    }
  }
  if (pcBangResult.ok && pcBangResult.value.possiblyTruncated) {
    errors.push("경쟁점 목록이 카카오 조회 상한에 걸려 일부 빠졌을 수 있습니다(격자분할 한계 도달).");
  }

  // 6) 입지평가 AI 초안 — 앞 단계 자료를 컨텍스트로 준다. 실패해도 나머지는 살린다.
  let locationDraft = null;
  if (!body.skipAi) {
    const countedCompetitors = pcBangs
      .filter((p) => judgePcBangName(p).counted)
      .map((p) => ({ name: p.name, distanceM: p.distanceM }));
    const baseContext = buildLocationEvalContext({
      candidate: {
        name: body.name?.trim() || address,
        address,
        roadAddress: geocode.roadAddress,
        floating500Avg: floating?.avg ?? null,
        employ500Total: null,
        employ1kmTotal: null,
        operatingPcStores500m: countedCompetitors.length,
        operatingPcStores1km: null,
        facility500SubwayRiders: null,
      },
      // buildLocationEvalContext는 이름·거리만 읽는다(파일 주석 참고) — 가짜 경쟁점 레코드를
      // 만들지 않고 필요한 두 필드만 넘긴다.
      competitors: countedCompetitors as never,
      demandPoints,
      adminDongReference: null,
    });
    // 층·엘리베이터를 사실로 덧붙인다 — 이게 없으면 AI가 층수를 모른 채 가시성을 매긴다.
    const contextText = appendSiteFactsToContext(baseContext, {
      floor: body.floor ?? null,
      groundLevel: body.groundLevel ?? null,
      hasElevator: body.hasElevator ?? null,
    });
    try {
      locationDraft = await runLocationEvalDraft({ contextText });
    } catch (err) {
      errors.push(`입지평가 AI 초안 실패: ${message(err)} (입지 항목 없이 계산됩니다)`);
    }
  }

  return NextResponse.json({
    collectedAt: Date.now(),
    geocode: {
      lat: geocode.lat,
      lng: geocode.lng,
      roadAddress: geocode.roadAddress,
      jibunAddress: geocode.jibunAddress,
      buildingName: geocode.buildingName,
    },
    sgis,
    floating,
    floatingByRadius,
    pcBangs,
    pcBangsPossiblyTruncated: pcBangResult.ok ? pcBangResult.value.possiblyTruncated : false,
    pcBangQueryCount: pcBangResult.ok ? pcBangResult.value.queryCount : 0,
    demandPoints,
    locationDraft,
    errors,
  });
}

/** 유동인구 6반경 — 500m는 필수(V62), 나머지는 실험실 입력(실패해도 경고만). */
async function collectFloatingRadii(origin: { lat: number; lng: number }) {
  const byRadius: Partial<Record<SbizFloatingRadius, SbizFloatingResult>> = {};
  const otherErrors: string[] = [];
  let r500Error: unknown = null;
  for (const r of SBIZ_FLOATING_RADII) {
    try {
      byRadius[r] = await collectSbizFloating(origin, r);
    } catch (err) {
      if (r === QUICK_EVAL_RADII.floating) r500Error = err;
      else otherErrors.push(`유동인구 ${r >= 1000 ? "1km" : `${r}m`} 수집 실패(실험실 값이 낮게 나올 수 있음): ${message(err)}`);
    }
  }
  if (!byRadius[500]) throw r500Error ?? new Error("유동인구 500m를 받지 못했습니다");
  return { r500: byRadius[500], byRadius, otherErrors };
}

/** AI 입지평가에 줄 수요거점. 운영 1단계(`collect-market-data`)와 **같은 타깃 목록**을 쓴다. */
async function collectDemandPoints(origin: { lat: number; lng: number }): Promise<DemandPoint[]> {
  const now = Date.now();
  const out: DemandPoint[] = [];
  const seen = new Set<string>();
  for (const target of DEMAND_POINT_TARGETS) {
    const places =
      target.kind === "category"
        ? await searchByCategory(origin.lat, origin.lng, target.code, target.radiusM)
        : await searchByKeyword(origin.lat, origin.lng, target.keyword, target.radiusM);
    for (const place of places) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      out.push({
        id: `${QUICK_EVAL_CANDIDATE_CODE}_kakao_${place.id}`,
        candidateCode: QUICK_EVAL_CANDIDATE_CODE,
        name: place.name,
        category: target.category,
        lat: place.lat,
        lng: place.lng,
        distanceM: place.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: place.lat, lng: place.lng })),
        source: "kakao",
        sourcePlaceId: place.id,
        fetchedAt: now,
        confirmed: false,
      });
    }
  }
  return out;
}
