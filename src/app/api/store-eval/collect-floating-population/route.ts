import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { collectSbizFloating, type SbizFloatingResult } from "@/lib/storeEval/quickEval/sbizFloating";
import { tmSelfTestFailures } from "@/lib/storeEval/quickEval/tm";
import { floatingPatchFromSbiz, SBIZ_FLOATING_RADII, type SbizFloatingRadius } from "@/lib/storeEval/floatingPopulationFromSbiz";

// 후보지 기본정보 — 소상공인365 반경 유동인구(300·400·500m·1km)를 받아 **폼 값으로 돌려준다** (2026-09-26, 입력 자동화 3번).
// Firestore에 쓰지 않는다. 화면이 폼에 채우고 사람이 "저장"으로 확정한다(리포트 복사·붙여넣기 경로를 대신함).
// ⚠️ 서울 리전(icn1) 고정 — vercel.json. 소상공인365가 미국 리전을 막는다(2026-09-22 quick-eval에서 확인).
// ⚠️ 반경은 **차례로** 부른다. 남의 공개 사이트라 한꺼번에 때리지 않는다(sbizFloating.ts DELAY_MS). 4반경 약 20초.
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user) return NextResponse.json({ error: "회사 계정 로그인이 필요합니다." }, { status: 401 });

  let body: { lat?: unknown; lng?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39 || lng < 124 || lng > 132) {
    return NextResponse.json({ error: "좌표가 없거나 올바르지 않습니다. 상권자료 수집으로 좌표를 먼저 확정해주세요." }, { status: 400 });
  }
  // 좌표변환이 틀리면 소상공인365는 에러가 아니라 **엉뚱한 곳의 값**을 준다. 부르기 전에 막는다.
  const tmFailures = tmSelfTestFailures();
  if (tmFailures.length) {
    return NextResponse.json({ error: `좌표변환 검산 실패: ${tmFailures.join(" · ")}` }, { status: 500 });
  }

  const byRadius: Partial<Record<SbizFloatingRadius, SbizFloatingResult>> = {};
  const errors: Partial<Record<SbizFloatingRadius, string>> = {};
  for (const radius of SBIZ_FLOATING_RADII) {
    try {
      byRadius[radius] = await collectSbizFloating({ lat, lng }, radius);
    } catch (error) {
      errors[radius] = error instanceof Error ? error.message : String(error);
    }
  }
  if (Object.keys(byRadius).length === 0) {
    const first = Object.values(errors)[0] ?? "알 수 없는 오류";
    return NextResponse.json({ error: `소상공인365 유동인구를 받지 못했습니다(${first}). 리포트 붙여넣기로 입력해주세요.` }, { status: 502 });
  }

  const { patch, records, warnings } = floatingPatchFromSbiz(byRadius, errors);
  // 화면에 월별 추이를 보여 사람이 튄 달을 볼 수 있게 500m 계열만 같이 넘긴다(V62가 읽는 반경).
  const r500 = byRadius[500];
  return NextResponse.json({
    patch,
    records,
    warnings,
    trend500: r500 ? { months: r500.months, monthly: r500.monthly, admiNm: r500.admiNm } : null,
  });
}
