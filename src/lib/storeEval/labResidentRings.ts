// 1km 밖 고리 인구 — SGIS 반경 집계 파일을 산식 입력(`residentAgesByRadius`)으로 바꾼다 (2026-09-23)
//
// 자료: `.local-tools/sgis-resident-population.json` (scripts가 2026-09-20에 수집. 기준연도 2024).
//   sites["existing:<매장코드>"].radii["1500"|"2000"|"5000"].pops.age_1_cnt ~ age_9_cnt
//   SGIS age_1~9는 0~9세 · 10대 · … · 80세 이상 9구간이다(writeResidentPopulationToFirestore.mjs와 같은 대응).
//   값은 **그 반경 원의 누적 인구**다 — 고리 인구는 산식(computeTextbook)이 안쪽 원을 빼서 만든다.
//
// ⚠️ 여기엔 파일 읽기(fs)가 없다. 브라우저에서도 import할 수 있어야 해서다. 파일은 부르는 쪽이 읽어서
//    파싱한 객체를 넘긴다(테스트·스크립트). 화면은 아직 이 자료를 못 받는다 — Firestore 실험실 복제본에
//    고리 인구가 없기 때문이다. 넣으려면 동기화 스크립트가 필요하다(사용자 승인 사항).
import type { ResidentAges, ResidentRingRadius } from "@/lib/storeEval/textbookModel";

export type SgisPops = Record<string, number | string | null | undefined>;
export type SgisSite = {
  kind?: string; code?: string | number; name?: string;
  radii?: Record<string, { pops?: SgisPops; totalPopulation?: number | null }>;
};
export type SgisFile = { collectedAt?: string; baseYear?: number; sites?: Record<string, SgisSite> };

const RING_RADII: readonly ResidentRingRadius[] = [1500, 2000, 5000];

/** SGIS 연령 9구간 -> 산식 7구간. age_2가 없으면 연령 분해가 없는 반경이다(null). */
export function residentAgesFromSgisPops(pops: SgisPops | undefined): ResidentAges | null {
  if (!pops || pops.age_2_cnt == null) return null;
  const n = (k: string) => Number(pops[k] ?? 0);
  return {
    age0s: n("age_1_cnt"), age10s: n("age_2_cnt"), age20s: n("age_3_cnt"), age30s: n("age_4_cnt"),
    age40s: n("age_5_cnt"), age50s: n("age_6_cnt"),
    age60plus: n("age_7_cnt") + n("age_8_cnt") + n("age_9_cnt"),
  };
}

/** 한 사이트의 고리 누적 원 인구. 있는 반경만 채운다. 하나도 없으면 null. */
export function residentRingsFromSgisSite(site: SgisSite): Partial<Record<ResidentRingRadius, ResidentAges | null>> | null {
  const out: Partial<Record<ResidentRingRadius, ResidentAges | null>> = {};
  let any = false;
  for (const r of RING_RADII) {
    const a = residentAgesFromSgisPops(site.radii?.[String(r)]?.pops);
    if (a) { out[r] = a; any = true; }
  }
  return any ? out : null;
}

/**
 * 파일 전체 -> 코드별 고리 맵(`BuildLabRowsArgs` / `BuildLabCandidateRowsArgs`의 `residentRingsByCode`).
 * 기존점 코드(매장코드)와 후보지 코드(N001 …)는 안 겹치므로 **한 맵**에 담아 양쪽에 넘겨도 된다.
 * `kinds`로 한쪽만 담을 수 있다(기본은 둘 다).
 */
export function residentRingsByCodeFromSgis(
  file: SgisFile,
  kinds: readonly string[] = ["existing", "candidate"],
): Map<string, Partial<Record<ResidentRingRadius, ResidentAges | null>>> {
  const map = new Map<string, Partial<Record<ResidentRingRadius, ResidentAges | null>>>();
  for (const site of Object.values(file.sites ?? {})) {
    if (!site.kind || !kinds.includes(site.kind) || site.code == null) continue;
    const rings = residentRingsFromSgisSite(site);
    if (rings) map.set(String(site.code), rings);
  }
  return map;
}
