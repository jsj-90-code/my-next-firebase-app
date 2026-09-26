// 소상공인365 반경 유동인구(collectSbizFloating 결과) -> 후보지 기본정보 폼 값 (2026-09-26, 후보지 입력 자동화 3번).
//
// 전에는 소상공인365 리포트를 반경마다 Ctrl+A로 복사해 붙여넣었다(반경 4개 = 4번). 같은 값을 서버가 받아 온다 —
// 경로는 주소만 초기평가(quickEval/sbizFloating.ts)와 같고, 12개월 평균·성별연령 환산 규칙은
// scripts/writeFloatingPopulationToFirestore.mjs(운영 자료를 넣은 규칙)와 같다. 그래서 같은 필드에 같은 자로 잰 값이 들어간다.
//
// 반경: 500m(V62가 읽는 유일한 유동 반경) · 400m(실험실 수요) · 300m·1km(실험실 상권 중심도)
// · 100m·200m(실험실 화면의 반경 고르기 + 결과 탭 빈 입력 점검이 읽는다 — 기존 후보지 13곳엔 다 있다).
// 1km는 **총량만** 넣는다 — 중심도가 비율만 쓰고, 운영 스크립트도 1km 연령·성별 필드를 만들지 않는다.
//
// ⚠️ 저장하지 않는다. 폼에 채우기만 하고 사람이 "저장"으로 확정한다(붙여넣기 경로와 같은 흐름).
// ⚠️ 한 반경이 실패해도 나머지는 채운다. 실패한 반경은 폼의 기존 값을 건드리지 않는다(0으로 덮지 않는다).
import type { SbizFloatingResult } from "./quickEval/sbizFloating";
import type { ExtractedFieldRecord } from "./types";

export const SBIZ_FLOATING_RADII = [100, 200, 300, 400, 500, 1000] as const;
export type SbizFloatingRadius = (typeof SBIZ_FLOATING_RADII)[number];

/** 환산 배율(12개월 평균 ÷ 최근월)이 이 범위를 벗어나면 최근월이 튄 달이라 연령·성별 환산을 사람이 봐야 한다.
 *  운영 수집분 216건(2026-09-18) 분포 0.80~1.14 · 중앙 0.985 — 하위·상위 몇 건만 걸리는 폭이다. */
export const SBIZ_SCALE_WARN = { low: 0.85, high: 1.15 } as const;

const DEMO_FIELDS: [suffix: string, key: keyof SbizFloatingResult["scaled"], label: string][] = [
  ["Male", "male", "남"],
  ["_10s", "age10s", "10대"],
  ["_20s", "age20s", "20대"],
  ["_30s", "age30s", "30대"],
  ["_40s", "age40s", "40대"],
  ["_50s", "age50s", "50대"],
  ["_60plus", "age60plus", "60대 이상"],
];

export type SbizFloatingPatch = {
  patch: Record<string, number>;
  /** 이력(storeEvalMarketDataUploads)에 남길 필드별 기록 — 붙여넣기 경로와 같은 모양 */
  records: ExtractedFieldRecord[];
  warnings: string[];
};

export function floatingPatchFromSbiz(
  byRadius: Partial<Record<SbizFloatingRadius, SbizFloatingResult>>,
  errors: Partial<Record<SbizFloatingRadius, string>> = {},
): SbizFloatingPatch {
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

  for (const radius of SBIZ_FLOATING_RADII) {
    const r = byRadius[radius];
    const src = `소상공인365 반경 ${radius}m`;
    if (!r) {
      warnings.push(`반경 ${radius >= 1000 ? "1km" : `${radius}m`} 유동인구를 받지 못했습니다${errors[radius] ? `(${errors[radius]})` : ""} — 그 칸은 기존 값 그대로입니다.`);
      put(`floating${radius}Avg`, `${src} 12개월 평균`, null);
      continue;
    }
    put(`floating${radius}Avg`, `${src} 12개월 평균`, r.avg);
    if (radius === 1000) continue; // 1km는 중심도(비율)용 총량만
    for (const [suffix, key, label] of DEMO_FIELDS) {
      put(`floating${radius}${suffix}`, `${src} ${label}(최근월×${r.scale.toFixed(3)})`, r.scaled[key]);
    }
    if (r.scale < SBIZ_SCALE_WARN.low || r.scale > SBIZ_SCALE_WARN.high) {
      warnings.push(`반경 ${radius}m 최근월이 12개월 평균과 많이 다릅니다(배율 ${r.scale.toFixed(2)}) — 연령·성별은 최근월 구성비로 환산한 값이니 추이를 확인하세요.`);
    }
  }

  // 반경이 넓을수록 유동인구가 많아야 한다(같은 점 중심의 동심원). 뒤집히면 응답이 섞였거나 좌표가 흔들린 것이다.
  const got = SBIZ_FLOATING_RADII.filter((rad) => byRadius[rad]);
  for (let i = 1; i < got.length; i++) {
    const a = byRadius[got[i - 1]]!, b = byRadius[got[i]]!;
    if (b.avg < a.avg) {
      warnings.push(`반경 ${got[i]}m 유동인구(${b.avg.toLocaleString()})가 ${got[i - 1]}m(${a.avg.toLocaleString()})보다 적습니다 — 값을 확인하세요(운영 216건에선 한 번도 없었다).`);
    }
  }
  return { patch, records, warnings };
}
