// SGIS 반경 통계(collectSgisRadiusPopulation 결과) -> 후보지 기본정보 폼 값 (2026-09-26, 후보지 입력 자동화 2번).
//
// 전에는 SGIS 생활권역 PDF의 표를 복사해 붙여넣었다. 같은 값을 SGIS API로 바로 받는다 — 경로·기준연도는
// 주소만 초기평가(quickEval/buildQuickCandidate.ts)와 같고, 그 경로는 운영 52곳 손입력과 중앙 차이 0.0%로
// 검증됐다(scripts/writeResidentPopulationToFirestore.mjs 머리 주석). 필드 대응도 buildQuickCandidate와 같게 둔다.
//
// ⚠️ 저장하지 않는다. 폼에 채우기만 하고 사람이 "저장"으로 확정한다(붙여넣기 경로와 같은 흐름).
// ⚠️ 남성비율은 **0~1 비율**로 저장한다(기존 후보지 0.488 등). 퍼센트(48.8)로 넣으면 안 된다.
import type { SgisRadiusStats } from "./quickEval/sgisRadiusPopulation";
import type { ExtractedFieldRecord } from "./types";

/** SGIS 조회면적이 원 면적과 이만큼 넘게 다르면 반경이 잘린 것(해안·경계)으로 보고 경고한다. */
export const SGIS_AREA_WARN_RATIO = 0.05;

const AGE_FIELDS = [
  "age1km_0_9", "age1km_10_19", "age1km_20_29", "age1km_30_39", "age1km_40_49",
  "age1km_50_59", "age1km_60_69", "age1km_70_79", "age1km_80plus",
] as const;

export type SgisResidentPatch = {
  patch: Record<string, number>;
  /** 이력(storeEvalMarketDataUploads)에 남길 필드별 기록 — 붙여넣기 경로와 같은 모양 */
  records: ExtractedFieldRecord[];
  warnings: string[];
};

export function residentPatchFromSgis(result: { baseYear: string; byRadius: Record<number, SgisRadiusStats> }): SgisResidentPatch {
  const r500 = result.byRadius[500] ?? null;
  const r1k = result.byRadius[1000] ?? null;
  const patch: Record<string, number> = {};
  const records: ExtractedFieldRecord[] = [];
  const warnings: string[] = [];
  const put = (key: string, label: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) {
      records.push({ fieldKey: key, matchedLabel: label, rawValue: null, parsedValue: null, autoExtracted: true, userEdited: false, applied: false });
      return;
    }
    patch[key] = value;
    records.push({ fieldKey: key, matchedLabel: label, rawValue: String(value), parsedValue: value, autoExtracted: true, userEdited: false, applied: true });
  };

  const year = Number(result.baseYear);
  put("demographicsYear", "SGIS base_year", Number.isFinite(year) ? year : null);
  put("pop500m", "SGIS 반경 500m tot_ppltn_cnt", r500?.totalPopulation);
  put("pop1km", "SGIS 반경 1km tot_ppltn_cnt", r1k?.totalPopulation);
  put("area1kmKm2", "SGIS 반경 1km area_size(㎡→㎢)", r1k?.areaSizeM2 != null ? Number((r1k.areaSizeM2 / 1_000_000).toFixed(4)) : null);
  put("male1kmRatio", "SGIS 반경 1km man_cnt ÷ tot_ppltn_cnt",
    r1k?.malePopulation != null && r1k.totalPopulation != null && r1k.totalPopulation > 0 ? Number((r1k.malePopulation / r1k.totalPopulation).toFixed(4)) : null);
  AGE_FIELDS.forEach((key, i) => put(key, `SGIS 반경 1km age_${i + 1}_cnt`, r1k?.ageBands[i]));

  if (r500?.totalPopulation == null) warnings.push("반경 500m 주거인구를 받지 못했습니다.");
  if (r1k?.totalPopulation == null) warnings.push("반경 1km 주거인구·연령을 받지 못했습니다.");
  for (const r of [r500, r1k]) {
    if (r?.areaOffRatio != null && r.areaOffRatio > SGIS_AREA_WARN_RATIO) {
      warnings.push(`반경 ${r.radiusM}m 조회면적이 원 면적과 ${(r.areaOffRatio * 100).toFixed(1)}% 다릅니다 — 해안·행정경계에서 잘렸을 수 있으니 SGIS 지도로 확인하세요.`);
    }
  }
  // 연령 9구간 합은 총인구와 정확히 같아야 한다(N001 대조). 어긋나면 응답 모양이 바뀐 것이다.
  const ageSum = r1k ? r1k.ageBands.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  if (r1k?.totalPopulation != null && ageSum != null && ageSum !== r1k.totalPopulation) {
    warnings.push(`1km 연령 9구간 합(${ageSum.toLocaleString()})이 총인구(${r1k.totalPopulation.toLocaleString()})와 다릅니다 — 값을 확인하세요.`);
  }
  return { patch, records, warnings };
}
