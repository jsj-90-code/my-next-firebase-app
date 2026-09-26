import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { collectSgisRadiusPopulation } from "@/lib/storeEval/quickEval/sgisRadiusPopulation";
import { residentPatchFromSgis } from "@/lib/storeEval/residentPopulationFromSgis";

// 후보지 기본정보 — SGIS 반경 500m/1km 주거인구·연령을 API로 받아 **폼 값으로 돌려준다** (2026-09-26, 입력 자동화 2번).
// Firestore에 쓰지 않는다. 화면이 폼에 채우고 사람이 "저장"으로 확정한다(SGIS PDF 붙여넣기 경로를 대신함).
// SGIS 키는 서버에만 있다(SGIS_SERVICE_ID / SGIS_SECURITY_KEY). 좌표는 화면의 확정 좌표를 받는다 —
// 사용자가 지도에서 마커를 옮겨 확정했으면 그 점이 반경의 중심이어야 하기 때문이다.
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
  // 대한민국 범위 밖이면 좌표 순서가 뒤집혔거나 잘못된 값이다(SGIS는 틀린 좌표에 에러가 아니라 빈 결과를 준다).
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39 || lng < 124 || lng > 132) {
    return NextResponse.json({ error: "좌표가 없거나 올바르지 않습니다. 상권자료 수집으로 좌표를 먼저 확정해주세요." }, { status: 400 });
  }

  try {
    const result = await collectSgisRadiusPopulation({ lat, lng }, [500, 1000]);
    const { patch, records, warnings } = residentPatchFromSgis(result);
    return NextResponse.json({ baseYear: result.baseYear, patch, records, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SGIS 수집에 실패했습니다.";
    return NextResponse.json({ error: `SGIS 주거인구를 받지 못했습니다(${message}). PDF 붙여넣기로 입력해주세요.` }, { status: 502 });
  }
}
