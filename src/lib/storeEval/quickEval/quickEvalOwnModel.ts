// 자동화 범위 **전용 산식** — 주소만 초기평가 화면에서만 쓴다. (2026-09-22 밤 신설)
//
// ── 왜 (사용자 2026-09-22) ────────────────────────────────────────────────
// *"그럼 일단 주소만입력 이게 최선임? 자동화 범위에서의 산식 만들기"* ·
// *"자동화산식은 자동화 웹에서만 보이게해. 이거 신뢰성이좀 낮잖아"*
//
// 지금 도구는 운영 V62를 **빈칸 채워** 돌린다. V62는 경쟁점 대수·품질·자사 시설을 요구하는데
// 자동화로는 못 얻으니 손해를 본다. 이 파일은 **자동화로 실제 얻는 값만으로** 세운 회귀식이다.
//
// ── 측정 (`_quickEvalOwnModel.test.ts`, 리브원아웃 **40곳** — 송도·동탄북광장 포함) ──
//   기준선 전부 평균   MAPE 22.35% · ±20% 55.00%
//   PC대수만           18.74% · 60.00%
//   **PC대수 + 시급**  **18.27%** · 60.00% · 예측÷실측 0.976   <- 이 파일이 쓰는 것
//   + 경쟁점 개수      18.67%  (안 좋아진다)
//   + 유동인구         19.16%  (안 좋아진다)
//   + 주거인구         19.38%  (안 좋아진다)
//   + 개점경과         18.54%  (안 좋아진다)
//   + 층수             19.92%  (안 좋아진다)
//   비교: V62를 비워 쓰기 27.79% · ±20% 42.11% · 배율 1.211
//
// ⭐ **더 넣을 게 없다.** 위 피처 중 "PC대수 + 시급"을 이기는 조합이 하나도 없다. 개점 연차까지
//    넣어 봤지만(후보지는 늘 신규인데 학습 타깃은 누적평균이라 의심했다) 역시 나빠졌다.
//    다음 개선은 **표본 증가(2027 상반기)**나 **새 자료(경쟁점 PC 대수)**를 기다려야 한다.
//
// ⚠️ **불편한 결과를 그대로 적는다** — 인구·유동인구·경쟁점 개수를 넣으면 **더 나빠진다.**
//    자사 기획값(대수·시급)만으로 거의 다 설명된다. 이 저장소가 예전에 찾은 "인구 자료에
//    신호가 없다(최대 r=0.247)"와 같은 결론이다. 그래서 피처를 일부러 둘로 묶어 뒀다.
// ⚠️ 그래서 이 산식은 **상권을 못 본다.** 같은 대수·시급이면 어느 동네든 같은 값이 나온다.
//    상권 판단은 V62 값과 AI 평가문이 한다 — 화면에서 **둘을 나란히** 보여주는 이유다.
// ⚠️ 점포평가 시스템(/store-eval)에는 넣지 않는다(사용자 지시). 여기서만 쓴다.

import { isUsableForQuickEval } from "./quickEvalPeers";
import type { ExistingStore } from "../types";

/** 이 산식이 쓰는 입력 — 자동화가 아니라 **사람이 넣는 기획값** 둘뿐이다. */
export type QuickEvalOwnModelInput = { pcCount: number | null; hourlyRate: number | null };

export type QuickEvalOwnModel = {
  /** log매출 = intercept + b1*z(logPc) + b2*z(logRate) */
  intercept: number;
  coefPc: number;
  coefRate: number;
  meanLogPc: number; sdLogPc: number;
  meanLogRate: number; sdLogRate: number;
  sampleCount: number;
};

/** 리브원아웃 측정에 쓴 것과 같은 벌점. 표본 38곳이라 약하게 건다. */
const RIDGE_LAMBDA = 1;

function standardize(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) || 1 };
}

/**
 * 기존 가맹점 실적으로 계수를 정한다. **매 조회마다 다시 맞춘다** — 매장이 늘면 자동으로 따라간다
 * (운영 V62도 같은 원칙이다: 계산 결과를 저장하지 않고 매번 재계산).
 *
 * 대상은 V62 학습표본과 같은 뜻으로 맞춘다 — 블랙라벨 · 산식학습제외 아님 · 실매출 있음.
 * 여기를 다르게 하면 두 숫자가 다른 매장을 보고 말하게 된다.
 */
export function fitQuickEvalOwnModel(stores: ExistingStore[]): QuickEvalOwnModel | null {
  const rows = stores
    // 송도점·동탄북광장점을 포함한다(사용자 2026-09-22). 운영 Firestore는 안 건드린다 —
    // 그 이유와 실측 영향은 `isUsableForQuickEval` 주석에 있다.
    .filter(isUsableForQuickEval)
    .map((s) => {
      const pc = s.evaluationPcCount ?? s.pcCount;
      if (!pc || pc <= 0 || !s.hourlyRate || s.hourlyRate <= 0) return null;
      return {
        logPc: Math.log(pc),
        logRate: Math.log(s.hourlyRate),
        logY: Math.log(s.actualMonthlyRevenueAvg as number),
      };
    })
    .filter((r): r is { logPc: number; logRate: number; logY: number } => r != null);

  // 계수 둘을 정하려면 표본이 최소한 그보다 충분히 많아야 한다.
  if (rows.length < 10) return null;

  const pcStat = standardize(rows.map((r) => r.logPc));
  const rateStat = standardize(rows.map((r) => r.logRate));
  const X = rows.map((r) => [(r.logPc - pcStat.mean) / pcStat.sd, (r.logRate - rateStat.mean) / rateStat.sd]);
  const y = rows.map((r) => r.logY);

  // 정규방정식(3x3) + 릿지. 절편에는 벌점을 안 준다.
  const A = [
    [rows.length, 0, 0],
    [0, RIDGE_LAMBDA, 0],
    [0, 0, RIDGE_LAMBDA],
  ];
  const b = [0, 0, 0];
  for (let i = 0; i < rows.length; i++) {
    const xi = [1, X[i][0], X[i][1]];
    for (let r = 0; r < 3; r++) {
      b[r] += xi[r] * y[i];
      for (let c = 0; c < 3; c++) if (!(r === 0 && c === 0)) A[r][c] += xi[r] * xi[c];
    }
  }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const k = M[r][col] / M[col][col];
      for (let c = col; c <= 3; c++) M[r][c] -= k * M[col][c];
    }
  }
  const beta = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  if (!beta.every((v) => Number.isFinite(v))) return null;

  return {
    intercept: beta[0], coefPc: beta[1], coefRate: beta[2],
    meanLogPc: pcStat.mean, sdLogPc: pcStat.sd,
    meanLogRate: rateStat.mean, sdLogRate: rateStat.sd,
    sampleCount: rows.length,
  };
}

/** 예상 월매출(원). 입력이 비면 null — 지어내지 않는다. */
export function predictQuickEvalOwnRevenue(
  model: QuickEvalOwnModel | null,
  input: QuickEvalOwnModelInput,
): number | null {
  if (!model || !input.pcCount || input.pcCount <= 0 || !input.hourlyRate || input.hourlyRate <= 0) return null;
  const zPc = (Math.log(input.pcCount) - model.meanLogPc) / model.sdLogPc;
  const zRate = (Math.log(input.hourlyRate) - model.meanLogRate) / model.sdLogRate;
  const value = Math.exp(model.intercept + model.coefPc * zPc + model.coefRate * zRate);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** 리브원아웃으로 잰 이 산식의 성적 — 화면이 읽어 그린다(숫자를 화면에 글자로 박지 않는다). */
export const QUICK_EVAL_OWN_MODEL_ACCURACY = {
  measuredAt: "2026-09-22",
  /** 송도점·동탄북광장점을 이 도구에서만 포함한 뒤의 표본 */
  sampleCount: 40,
  testFile: "src/lib/storeEval/_quickEvalOwnModel.test.ts",
  mape: 0.1827,
  within20: 0.6,
  medianRatio: 0.976,
  /** 같은 표본에서 "전부 평균"으로 찍었을 때 — 이걸 못 이기면 산식이 의미가 없다 */
  flatBaselineMape: 0.2235,
} as const;
