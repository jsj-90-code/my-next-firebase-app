// 후보지 주거 상권 반경을 2km로 넓힐 때 필요한 **1.5km·2km 누적 원 연령 인구**를 SGIS 반경 API로 받아 돌려준다 (2026-09-28).
//
// 사용자: "이거 자동화 안 돼 있나? … 입력할 때 체크해서 하는 방안도" — 전에는 scripts/collectSgisResidentPopulation.mjs →
// writeLabResidentRingsToFirestore.mjs → writeLabResidentRadius.mjs 세 스크립트를 사람이 돌려야 했다. 이제 기본정보 탭
// "주거 상권 반경" 칸에서 2km를 고르면 화면이 이 라우트로 인구를 받아 실험실 전용 컬렉션(storeEvalLabResidentRings·
// storeEvalLabResidentRadius)에 쓴다. 운영 V62는 이 값을 모른다(실험실 전용 사실).
//
// SGIS 키는 서버에만 있다. 좌표는 화면의 확정 좌표를 받는다(collect-resident-population과 같은 이유).
// 연령 9구간 → 7구간 변환은 quick-eval/collect(고립 상권)·labResidentRings.ts와 같은 대응이다.
import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { collectSgisRadiusPopulation } from "@/lib/storeEval/quickEval/sgisRadiusPopulation";
import type { ResidentAges } from "@/lib/storeEval/textbookModel";

const RADII = [1500, 2000] as const;

function agesFromBands(b: (number | null)[] | undefined): ResidentAges | null {
  if (!b || b.length < 9 || b[1] == null) return null;
  return { age0s: b[0] ?? 0, age10s: b[1] ?? 0, age20s: b[2] ?? 0, age30s: b[3] ?? 0, age40s: b[4] ?? 0, age50s: b[5] ?? 0, age60plus: (b[6] ?? 0) + (b[7] ?? 0) + (b[8] ?? 0) };
}

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

  try {
    const result = await collectSgisRadiusPopulation({ lat, lng }, [...RADII]);
    const rings: Record<string, ResidentAges | null> = {};
    const totals: Record<string, number | null> = {};
    for (const r of RADII) {
      const ages = agesFromBands(result.byRadius[r]?.ageBands);
      rings[String(r)] = ages;
      totals[String(r)] = ages ? Object.values(ages).reduce((a, b) => a + b, 0) : null;
    }
    if (!rings["2000"]) return NextResponse.json({ error: "SGIS가 2km 연령 인구를 돌려주지 않았습니다(빈 결과). 잠시 뒤 다시 시도해주세요." }, { status: 502 });
    return NextResponse.json({ baseYear: result.baseYear, rings, totals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SGIS 수집에 실패했습니다.";
    return NextResponse.json({ error: `SGIS 1.5·2km 주거인구를 받지 못했습니다(${message}).` }, { status: 502 });
  }
}
