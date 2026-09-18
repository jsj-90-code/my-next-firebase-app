// 입지 재설계 — 무엇을 버리고 무엇으로 다시 세울지 먼저 잰다 (2026-09-17). 일회성 분석용.
//
// 사용자 방향(2026-09-17): "입지부분은 전체교체필요함 항목이랑 평가값까지 전체개념 재수립필요"
//
//   npx vitest run src/lib/storeEval/_locationRebuild.test.ts --reporter=verbose
//
// ── 왜 이 검사가 먼저인가 ────────────────────────────────────────────────
// 새 경쟁 항(2026-09-17 채택)은 **자사 품질과 경쟁점 품질을 직접 나눈다**:
//
//   점유율 = 자사PC ÷ (자사PC + Σ[R 안] 경쟁PC x (경쟁품질÷자사품질)^θ)
//
// 그래서 입지를 여기 넣으려면 **자사와 경쟁점을 같은 자로 재야 한다.** 지금은 아니다:
//
//   자사   computeOwnLocationScore       = 상권위치·동선 x0.6 + 선점경쟁 x0.25 + 접근가시성 x0.15
//   경쟁점 computeLocationScoreFromFacts = 층수 + 엘리베이터
//
// 자가 다르면 나눗셈이 뜻을 잃는다. 2026-09-15에 자를 맞추려다 정확도가 악화돼(A 9.67% ->
// B 11.54%) "의도된 상태로 둔다"고 결론냈는데, **그건 경쟁 항이 격차^4이던 시절 이야기다.**
// 지금 구조에서는 자가 다른 걸 그냥 둘 수 없다.
//
// 그래서 이 검사가 답할 것은 셋이다:
//   ① 지금 입지 3항목은 실제로 무엇을 재고 있나 (분포·변별력·실측 점유율과의 관계)
//   ② 자사·경쟁점 **양쪽에 다 있는** 입지 원자료가 무엇인가 (채움률)
//   ③ 같은 자로 잰 입지를 품질에 넣으면 순서가 좋아지나 (새 항의 판정 기준은 r이다)
//
// ── 결과 (2026-09-17) ───────────────────────────────────────────────────
//
// **한 줄: 입지는 경쟁력점수 안에서 빼고, 층수 기반 "접근성"을 독립 곱셈 항으로 둔다.**
//
// ① **주관 3항목은 전부 유의선(0.371) 미달이고, 값이 3~4개밖에 안 쓰인다.**
//      상권위치·동선  값 3개 (29곳 중 19곳이 5점)  r=0.075  시점통제 0.111
//      선점경쟁       값 3개 (29곳 중 17곳이 3점)  r=0.220  시점통제 0.246
//      접근가시성     값 4개                      r=0.181  시점통제 0.200
//      **층수자 점수  값 5개 전부 쓰임            r=0.329  시점통제 0.389 ***  <- 유일하게 유의
//    사람이 1~5로 매긴 셋보다 **층수에서 기계적으로 나온 값이 낫다.**
//
// ② **양쪽에 다 있는 입지 원자료는 층수·지상지하·엘리베이터 셋뿐이다.**
//      층수 자사 41/41 · 경쟁 200/225(89%) / 지상지하 88% / 엘베 92%
//      좌표는 자사도 스냅샷에 0/41이고 경쟁점엔 아예 없다. 주관 3항목은 경쟁점에 없다.
//    새 항은 자사÷경쟁을 나누므로 **자사에만 있는 항목은 그대로는 못 넣는다.**
//
// ③ **품질에 섞으면 소용없다.** 유효거리 300m·θ=3 고정, 입지 없음 r=0.554 기준:
//      층수자 입지 17%   r 0.562 (+0.008)  한 곳 빼면 0.323~0.730  <- 하한이 유의선 아래
//      층수자 입지 8.5%  r 0.565 (+0.011)  한 곳 빼면 0.354~0.716  <- 역시 아래
//      자가 다른 채로 17% r 0.519 (-0.035)                        <- 지금 운영방식, 더 나쁘다
//    MAPE·편향은 전부 악화한다(-5.5% -> -21.9%).
//
// ④ **독립 곱셈 항으로 두면 완전히 다르다.** 점유율 x (자사 층수자 점수 ÷ 4)^κ:
//      κ=0     편향 -5.5%  MAPE 30.9%  r 0.554  한 곳 빼면 0.383~0.676
//      κ=0.25  편향 -10.0% MAPE 28.7%  r 0.632  한 곳 빼면 0.453~0.769
//      κ=0.5   편향 -13.2% MAPE 29.6%  r 0.657  한 곳 빼면 0.476~0.781
//    품질 점유율이 남긴 오차와 층수자 점수의 상관이 r=0.400*(시점통제 0.374*)다.
//    **접근성은 "경쟁점보다 낮은 층인가"가 아니라 "올라오기 얼마나 번거로운가"다.**
//    6층 매장은 경쟁점이 없어도 덜 온다 — 그래서 비율이 아니라 곱셈이 맞다.
//
// ⑤ **관문 통과 — 그것도 MAPE 기준으로.** (경쟁 항은 MAPE 기준을 못 넘었다)
//      LOO      28.66% -> 28.66%  **벌어짐 0.00%p** (훈련겹 100%가 κ=0.25를 고른다)
//      5겹 100회 κ=0.25 88%       안정
//      대조군    MAPE p=0.046 ✅ · r p=0.048 ✅
//    ⚠️ **여유가 없다.** 두 p값이 0.05에 간신히 걸쳐 있고(실제 2.27%p vs 95퍼센타일 2.06%p),
//       평가창 시점을 통제하면 잔차 상관이 0.400 -> 0.374로 유의선 0.371에 거의 붙는다.
//       코호트 교란 가능성이 남아 있다(memory: project_cohort_effect_confound).
//    ⚠️ **r 기준으로 고르면 과적합한다** — κ=0.75가 LOO에서 33.0% -> 42.1%로 무너지고
//       5겹에서 κ=2를 54% 고른다. **여기서는 MAPE 기준이 맞다**(경쟁 항과 반대다).
//
// ⑥ **"경쟁점 대비 층수"는 아니다 — "우리가 몇 층인가"만 작용한다.** (사용자 항목 ②)
//    경쟁점 층수를 아는 27곳에서 품질 점유율 잔차와의 상관:
//      자사 절대 층수   r=0.443 * (시점통제 0.413 *)   <- 이것만 걸린다
//      자사 − 경쟁      r=0.410 * (시점통제 0.382)     <- 자사가 들어있어서 따라 올라간 값
//      **경쟁 층수만    r=-0.004** (시점통제 -0.038)   <- 아무것도 아니다
//    상대항 μ를 같이 넣으면 전부 나빠진다(κ=0.25·μ=0에서 MAPE 24.4%가 최선, μ를 올리면 28~35%).
//    -> **"올라오기 번거롭다"가 맞고 "경쟁점과 비교당한다"는 아니다.** 경쟁점 층수는 안 봐도 된다.
//    ⚠️ 표본 27곳이고 자사가 층수에서 불리한 곳이 14곳뿐이다. 표본이 늘면 다시 본다.
//
// ⑦ **"상권 끝"은 실재한다 — 두 출처가 일치한다.** (사용자 항목 ①)
//    중심도 = (안쪽 개수 ÷ 넓은 개수) x (넓은반경/안쪽반경)²  — 1보다 크면 문 앞이 빽빽하다.
//
//      유동인구(소상공인365) ↔ 업소밀도(카카오)  **r=0.697** (순위 0.687, n=29)
//
//    출처가 완전히 다른데 이만큼 일치한다. **사용자 항목 ①은 측정 가능한 실체다.**
//
//    실측 검정(층수 항 κ=0.25를 반영한 뒤의 잔차와의 상관):
//      **유동 300m/1km   r=0.601 * (시점통제 0.604 *)**  <- 제일 강하다
//      유동 100m/1km     r=0.430 * (시점통제 0.429 *)
//      카카오 음식점 300m/1km 0.339  · 100m/1km 0.147
//    -> **유동인구 쪽이 훨씬 강하다.** 가게가 모여 있는 것과 사람이 다니는 건 다르고,
//       PC방 수요는 후자에 달렸다. 카카오는 **정의를 검증**하는 데 쓰고, 산식에 넣을 값은
//       유동인구로 만든다.
//    (300m가 100m보다 훨씬 나은 것도 눈에 띈다 — 경쟁 항의 유효거리 300m와 같은 값이다)
//
// ⑧ **수요식 반경의 그림자가 아니다.** 붙잡기 전에 의심부터 했다 — 수요식이 유동을 400m로
//    재는데 중심도가 유동 300m/1km의 비라서, "반경을 잘못 골랐다"가 중심도의 탈을 쓸 수 있다.
//    수요식의 유동 반경을 바꿔가며 축척 A를 매번 다시 고정하고 다시 쟀다:
//
//      수요식 유동반경   100m   200m   300m   400m(지금)  500m   1000m
//      유동 300m/1km   0.688* 0.637* 0.607*  0.601*     0.604* 0.681*
//      카카오 300m/1km 0.443* 0.381* 0.344   0.339      0.342  0.430*
//
//    **어느 반경에서도 살아남는다.** 반경 선택 문제가 아니라 실재하는 입지 효과다.
//    카카오 쪽은 약하지만 부호가 일관되게 양수다.
//
// ⑨ **중심도 항 ν가 관문을 통과한다 — 지금까지 중 제일 강하게.** κ까지 같이 자유로 풀었다.
//
//      점유율 = [품질 점유율] x (층수자÷4)^κ x (중심도÷기준)^ν
//
//      표본 안   층수만 κ=0.25        MAPE 28.66% · r 0.632
//               +중심도 κ=0·ν=0.25   MAPE **24.52%** · r **0.725**
//      LOO      24.52% -> 25.50% (벌어짐 0.98%p) · LOO r **0.734**
//      5겹 100회 κ0/ν0.25 **78%**
//      대조군    MAPE **p=0.002** ✅ · r **p=0.012** ✅
//      잭나이프  r 0.570~0.780 (유의선 0.378) — 여유가 크다
//
//    경쟁 항은 MAPE 대조군 p=0.098로 미달이었고 층수는 p=0.046 턱걸이였다. 중심도는 0.002다.
//
// ⚠️ **반전: 중심도가 들어오면 MAPE 기준으로 층수 항이 빠진다(κ=0).** LOO가 97%, 5겹이 78%로
//    κ=0을 고른다. 그런데 **r 기준으로는 κ=0.25~0.5가 남는다.** 그리고 둘은 서로 겹치지도
//    않는다(층수자 ↔ 중심도 r=0.068, 거의 독립).
//    해석: **층수는 순서는 맞히지만 편향을 키운다**(④에서 편향 -5.5% -> -10.0%). 중심도가
//    순서를 더 잘 맞히므로, 층수를 빼면 편향이 덜 나빠져 MAPE가 좋아진다. 둘 다 둘지는
//    표본 29곳으로 못 정한다 — 실험실 스위치로 두고 보는 게 맞다.
//
// ⚠️ **카카오판은 약하다.** 출처를 바꿔 재현해 보면 MAPE 대조군은 통과하지만(p=0.024) r
//    대조군이 미달이고(p=0.317) LOO도 더 벌어진다(1.43%p). **산식에는 유동인구판을 쓴다.**
//    카카오는 ⑦의 교차검증(정의가 실재하는가)에서 제 몫을 다했다.
//
// ⑪ **1km는 파이어스토어에 없다 — 300m/500m이 대안인데 성격이 다르다.**
//    실험실은 파이어스토어를 읽는데 `floating1000Avg` 필드가 없다(로컬 연구 파일에만 있다).
//    이미 있는 반경만으로 되는지 봤다:
//
//      짝          파이어스토어   잔차와 r
//      300m/500m    있음        0.552 *   <- 유일한 대안
//      200m/500m    있음        0.413 *
//      100m/500m    있음        0.231
//      300m/1000m   없음        0.601 *   <- ⑨에서 관문을 통과한 짝
//
//    **그런데 관문을 돌려 보니 둘의 성격이 다르다:**
//
//                        300m/1km        300m/500m
//      표본 안 MAPE       24.52%          25.47%
//      표본 안 r          0.725           **0.801**
//      LOO [MAPE] 벌어짐  **0.98%p**      6.65%p  <- gamma(7%p)와 비슷한 징후
//      LOO [r]   벌어짐   0.43%p          **0.12%p**
//      LOO r              0.734           **0.771**
//      5겹 안정(MAPE)     **78%**         53%
//      대조군 MAPE        **p=0.002**     p=0.028
//      대조군 r           p=0.012         **p=0.006**
//      잭나이프           0.570~0.780     **0.641~0.843**
//
//    **300m/500m은 순서(r)는 더 잘 맞히는데 MAPE 홀드아웃에서 6.65%p 벌어진다.**
//    변동계수가 작아서(22.5% vs 45.3%) 같은 효과를 내려면 지수를 키워야 하고(ν=0.5),
//    큰 지수가 이상점에서 오차를 증폭시킨다. **MAPE 우선 원칙에서는 1km판이 안전하다.**
//    -> 필드 `floating1000Avg` 하나만 더하면 된다(`writeFloatingPopulationToFirestore.mjs`가
//       이미 반경 배열로 돌고, 1000m만 "대응 필드가 없어" 빠져 있다). 사용자 판단 대기.
//
// ⑩ **유동 방향(편심도) — 방향은 맞았는데 중심도가 이미 먹고 있다.** (사용자 항목)
//    8방위로 300m 밀어낸 점에서 반경 300m 업소 수를 세고 방위벡터로 합쳤다.
//    편심도 0=사방이 고름(중앙) · 1에 가까울수록 한쪽 쏠림(끝). 29곳 0.094~0.505.
//
//    **부호는 전부 음수다 — 사용자 직관이 방향은 맞았다**(편심도가 크면 점유율이 낮다).
//    그런데 앞 항을 반영할수록 사라진다:
//      아무것도 없이  r=-0.280 (이미 유의선 0.371 미달)
//      층수만 반영    r=-0.208
//      중심도만 반영  r=-0.167
//      **둘 다 반영   r=-0.069**  <- 거의 0
//    편심도 ↔ 중심도가 r=-0.335로 상당히 겹친다. **같은 걸 방향으로 본 것뿐이다.**
//
//    관문: MAPE 기준 최선이 **ω=0**(편심도 안 씀)이고 대조군 p=1.000 ❌ · r 기준 p=0.216 ❌.
//    -> **자료는 ω를 정해주지 못한다.** 항목을 버리라는 뜻이 아니다
//       ([[feedback_item_vs_coefficient]]) — 계수를 `[보류]`(ω=0)로 두거나 사용자가
//       `[감각]`으로 정하면 된다. 표본이 늘면 다시 본다.
//
// ⑫ **접근성 κ는 켠다 — 갈렸던 원인은 기준값이었다.** (사용자: "작업은 너한테시킬거임")
//    ⑨에서 MAPE 기준은 κ=0을, r 기준은 κ=0.25를 골라 갈렸다. 원인을 찾았다:
//    층수 항이 편향을 키우는데(-5.5% -> -10.0%) MAPE가 편향을 포함하기 때문이다.
//
//    **기준값을 중앙값에서 기하평균으로 바꾸니 갈림이 사라진다.**
//    곱셈 보정 (x/기준)^지수는 표본 전체에서 평균적으로 1배여야 중립인데, 그러려면 기준이
//    **로그 공간의 중심 = 기하평균**이어야 한다. 중심도는 0.37~6.95로 오른쪽 꼬리가 길어
//    중앙값(3.95)과 기하평균(3.22)이 꽤 다르다.
//
//      기준           고르는 κ (MAPE / r)   편향      MAPE      r
//      중앙값 3.95·4   0 / 0.25            -12.8%   24.59%   0.712
//      **기하평균 3.22·3.42  0.25 / 0.25   -9.2%    24.08%   0.736**
//
//      [ν=0.25 고정] κ=0 -> 24.39%·0.693 · **κ=0.25 -> 24.08%·0.736** · κ=0.5 -> 26.13%·0.727
//      LOO도 κ0.25/ν0.25를 93%(MAPE)·86%(r) 고르고 벌어짐 1.79%p.
//
//    ⚠️ **수준을 자유계수 λ로 푸는 것보다 낫다.** λ를 풀면 표본 안 MAPE는 비슷한데(24.04%)
//       LOO 벌어짐이 1.79%p -> **6.45%p**로 커진다. 기하평균은 자료에 맞춰 고르는 값이 아니라
//       "보정이 평균적으로 아무 일도 안 하게" 만드는 유일한 값이라 **자유계수가 아니다.**
//
// ⚠️ 이건 **측정이지 채택이 아니다.** 입지 개념 재수립은 사용자 결정 사항이다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSpecScore, computeOwnZoneComposition, computeCompetitorZoneComposition, computeLocationScoreFromFacts } from "./calc";
import { rivalDistanceM } from "./labInput";
import { defaultModelSettings } from "./settings";
import { computeQualityScore, DEFAULT_TEXTBOOK_PARAMS, type QualityParts } from "./textbookModel";

const SNAP = ".local-tools/validation-snapshot.json";
const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = [SNAP, FLOAT_FILE, RESI_FILE, UTIL_FILE].every((f) => existsSync(f));
const describeIf = ready ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
function pear(xs: number[], ys: number[]) {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : NaN;
}
/** 평가창 시점을 통제한 편상관 — 코호트 교란을 걷어낸다(2026-09-16의 교훈). */
function partial(x: number[], y: number[], z: number[]) {
  const rxy = pear(x, y), rxz = pear(x, z), ryz = pear(y, z);
  return (rxy - rxz * ryz) / Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
}
const RM = { t: 0.39, tw: 0.42, th: 0.17, f: 0.1 }, RF = { t: 0.13, tw: 0.15, th: 0.045, f: 0.02 };
const bl = (m: number) => ({ t: m * RM.t + (1 - m) * RF.t, tw: m * RM.tw + (1 - m) * RF.tw, th: m * RM.th + (1 - m) * RF.th, f: m * RM.f + (1 - m) * RF.f });

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("입지 재설계 — 먼저 잰다", () => {
  const S = JSON.parse(readFileSync(SNAP, "utf8"));
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const U = JSON.parse(readFileSync(UTIL_FILE, "utf8"));
  const F = fl.sites ?? fl, R = re.sites ?? re, set = defaultModelSettings();
  const W = DEFAULT_TEXTBOOK_PARAMS.qualityWeights;

  const compsBy = new Map<string, any[]>();
  for (const c of S.competitors as any[]) {
    if (!compsBy.has(c.candidateCode)) compsBy.set(c.candidateCode, []);
    compsBy.get(c.candidateCode)!.push(c);
  }
  const locBy = new Map((S.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));

  const ownParts = (s: any, pc: number): QualityParts => ({
    spec: computeSpecScore({
      vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
      cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
      ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
      monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
    }, set),
    food: s.ownFoodScore ?? null,
    zone: computeOwnZoneComposition({
      counts: { singleSeatCount: s.ownSingleSeatCount ?? null, room1: s.ownRoom1 ?? null, room2: s.ownRoom2 ?? null,
        teamRoom: s.ownTeamRoom ?? null, coupleZone: s.ownCoupleZone ?? null, vipZone: s.ownVipZone ?? null,
        friendsZone: s.ownFriendsZone ?? null, firstClassZone: s.ownFirstClassZone ?? null },
      teamRoomTotalSeats: s.ownTeamRoomTotalSeats ?? null, totalPcCount: pc,
    }).composition,
    interior: s.ownInteriorScore ?? null,
    management: s.ownManagementScore ?? null,
  });
  const rivalParts = (c: any): QualityParts => ({
    spec: computeSpecScore({
      vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
      cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
      ram: c.ram ?? null, ramTop: c.ramTop ?? null,
      monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
    }, set),
    food: c.foodScore ?? null,
    zone: computeCompetitorZoneComposition({
      counts: { singleSeatCount: c.singleSeatCount ?? null, room1: c.room1 ?? null, room2: c.room2 ?? null,
        teamRoom: c.teamRoom ?? null, coupleZone: c.coupleZone ?? null, vipZone: c.vipZone ?? null,
        friendsZone: c.friendsZone ?? null, firstClassZone: c.firstClassZone ?? null },
      regularCoupleSeatCount: c.regularCoupleSeatCount ?? null,
      teamRoomTotalSeats: c.teamRoomTotalSeats ?? null,
      totalPcCount: c.totalPcCount ?? c.appliedPcCount ?? null,
    } as any).composition,
    interior: c.interiorScore ?? null,
    management: c.managementScore ?? null,
  });

  type Row = {
    n: string; pc: number; loc: any; store: any;
    parts: QualityParts; floorScore: number | null;
    // name — 상권 분리 판정(매장명↔경쟁점명으로 맞춘다)을 붙이려고 2026-09-18에 넣었다.
    // id   — 소상공인365 100m 유동인구를 `competitor:<id>` 키로 찾으려고 같은 날 넣었다.
    rivals: { name: string; id: string; ip: number; d: number; parts: QualityParts; floorScore: number | null }[];
    demand: number; util: number; t: number; shareObs: number;
  };
  const rows: Row[] = [];
  for (const s of S.existingStores as any[]) {
    const pc = s.evaluationPcCount ?? s.pcCount; if (!pc) continue;
    const g = U[s.storeName]; if (!g?.rows?.length) continue;
    const k = `existing:${s.storeCode}`, fv = F[k], rv = R[k]; if (!fv || !rv) continue;
    const p = rv.radii?.["1000"]?.pops; if (p?.age_2_cnt == null) continue;
    const rm = p.woman_cnt != null && Number(p.tot_ppltn_cnt) > 0 ? 1 - Number(p.woman_cnt) / Number(p.tot_ppltn_cnt) : 0.5;
    const RR = bl(rm);
    const pop = Number(p.age_2_cnt) * RR.t + Number(p.age_3_cnt) * RR.tw + Number(p.age_4_cnt) * RR.th + Number(p.age_5_cnt) * RR.f;
    const f4 = fv.radii?.["400"]; if (!f4?.selected?.length || !f4.demographics) continue;
    const last = f4.selected[f4.selected.length - 1];
    const sc = last > 0 ? mean(f4.selected.slice(-12)) / last : 1;
    const d = f4.demographics, FR = bl(d.total > 0 ? d.male / d.total : 0.5);
    const env = ((d.age10s ?? 0) * FR.t + (d.age20s ?? 0) * FR.tw + (d.age30s ?? 0) * FR.th + (d.age40s ?? 0) * FR.f) * sc;
    const win = g.rows.map((r: any) => r.yearMonth).sort();
    const mid = win[Math.floor(win.length / 2)];
    rows.push({
      n: s.storeName, pc, loc: locBy.get(s.storeCode) ?? {}, store: s,
      parts: ownParts(s, pc),
      floorScore: computeLocationScoreFromFacts(s.floor ?? null, s.groundLevel ?? null, s.hasElevator ?? null),
      rivals: (compsBy.get(s.storeCode) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음")
        .map((c) => ({
          // 거리는 **좌표로 잰 값**을 먼저 쓴다. 현장조사 거리(distanceM)는 초기 데이터라
          // 잘못 적힌 게 있다(2026-09-17 사용자 확인). 유효거리 300m 판정이 걸린 자리라
          // 틀리면 경쟁점이 통째로 빠지거나 없던 게 들어온다.
          name: String(c.name ?? ""), id: String(c.id ?? ""),
          ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0), d: rivalDistanceM(s, c) ?? 0,
          parts: rivalParts(c),
          floorScore: computeLocationScoreFromFacts(c.floor ?? null, c.groundLevel ?? null, c.hasElevator ?? null),
        }))
        .filter((r) => r.ip > 0),
      demand: pop + env * 0.15, util: mean(g.rows.map((r: any) => r.monthlyRate)),
      t: Number(mid.slice(0, 4)) * 12 + Number(mid.slice(5, 7)), shareObs: 0,
    });
  }
  const mono = rows.filter((r) => !r.rivals.length);
  const A = med(mono.map((r) => r.util / (r.demand / (r.pc * 720))));
  for (const r of rows) r.shareObs = r.util / (A * r.demand / (r.pc * 720));
  const cmp = rows.filter((r) => r.rivals.length);

  it("① 지금 입지 3항목은 실제로 무엇을 재고 있나", () => {
    const n = cmp.length, sig = 2 / Math.sqrt(n);
    console.log(`\n기존점 ${rows.length}곳 · 경쟁상권 ${n}곳 · 유의선 ${sig.toFixed(3)}`);
    console.log(`${"항목".padEnd(20)}${"결측".padStart(6)}${"쓰인값".padStart(8)}${"분포".padStart(22)}${"실측점유율 r".padStart(13)}${"시점통제".padStart(10)}`);
    const items: [string, (r: Row) => unknown][] = [
      ["상권위치·동선", (r) => r.loc.locationScore],
      ["선점경쟁", (r) => r.loc.preemptionScore],
      ["접근가시성", (r) => r.loc.visibilityScore],
      ["(참고) 층수자 점수", (r) => r.floorScore],
    ];
    for (const [label, get] of items) {
      const ok = cmp.filter((r) => { const v = get(r); return v != null && Number.isFinite(Number(v)); });
      const v = ok.map((r) => Number(get(r)));
      if (v.length < 10) { console.log(`${label.padEnd(20)}${String(n - v.length).padStart(6)}  결측이 너무 많다`); continue; }
      const tally = [...new Set(v)].sort((a, b) => a - b).map((x) => `${x}:${v.filter((y) => y === x).length}`).join(" ");
      const y = ok.map((r) => r.shareObs), t = ok.map((r) => r.t);
      const r1 = pear(v, y), r2 = partial(v, y, t);
      console.log(`${label.padEnd(20)}${String(n - v.length).padStart(6)}${String(new Set(v).size).padStart(8)}${tally.padStart(22)}${(r1.toFixed(3) + (Math.abs(r1) > sig ? "*" : " ")).padStart(13)}${(r2.toFixed(3) + (Math.abs(r2) > sig ? "*" : " ")).padStart(10)}`);
    }
    console.log(`  -> 1~5점인데 실제로 쓰이는 값이 몇 개인지가 핵심이다. 값이 3~4개뿐이면 배점을 바꿔도 소용없다.`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("② 자사·경쟁점 양쪽에 다 있는 입지 원자료는 무엇인가", () => {
    const comps = (S.competitors as any[]).filter((c) => c.investigationStatus !== "경쟁점없음");
    const fill = (arr: any[], get: (x: any) => unknown) => {
      const k = arr.filter((x) => { const v = get(x); return v != null && v !== ""; }).length;
      return `${k}/${arr.length} (${Math.round(k / arr.length * 100)}%)`;
    };
    console.log(`\n${"원자료".padEnd(22)}${"자사 41곳".padStart(16)}${"경쟁점".padStart(18)}   양쪽에 있나`);
    const both: [string, (s: any) => unknown, ((c: any) => unknown) | null][] = [
      ["층수 floor", (s) => s.floor, (c) => c.floor],
      ["지상/지하", (s) => s.groundLevel, (c) => c.groundLevel],
      ["엘리베이터", (s) => s.hasElevator, (c) => c.hasElevator],
      ["거리(자사로부터)", () => null, (c) => c.distanceM],
      ["좌표 lat/lng", (s) => s.lat, null],
      ["상권위치·동선(주관)", (s) => locBy.get(s.storeCode)?.locationScore, null],
      ["선점경쟁(주관)", (s) => locBy.get(s.storeCode)?.preemptionScore, null],
      ["접근가시성(주관)", (s) => locBy.get(s.storeCode)?.visibilityScore, null],
    ];
    for (const [label, gs, gc] of both) {
      const own = gs(S.existingStores[0]) === null && label.startsWith("거리") ? "— (자기자신)" : fill(S.existingStores as any[], gs);
      const riv = gc ? fill(comps, gc) : "없음";
      console.log(`${label.padEnd(22)}${own.padStart(16)}${riv.padStart(18)}   ${gc && !label.includes("주관") && !label.includes("좌표") && !label.startsWith("거리") ? "✅ 같은 자로 잴 수 있다" : gc ? "경쟁점만" : "❌ 자사만"}`);
    }
    console.log(`  -> 양쪽에 다 있는 건 층수·지상지하·엘리베이터 셋뿐이다. 새 항은 자사÷경쟁을 나누므로`);
    console.log(`     자사만 있는 주관 3항목은 그대로는 못 넣는다.`);
    expect(comps.length).toBeGreaterThan(100);
  });

  it("③ 같은 자로 잰 입지를 품질에 넣으면 순서가 좋아지나", () => {
    const P = DEFAULT_TEXTBOOK_PARAMS;
    // 입지를 품질 점수에 섞는다 — 실무 감각 비중에서 입지 몫은 17.0%였다.
    const scoreWith = (parts: QualityParts, loc: number | null, locW: number) => {
      const base = computeQualityScore(parts, W);
      if (base == null) return null;
      if (loc == null || locW <= 0) return base;
      const bw = W.spec + W.food + W.zone + W.interior + W.management;
      return (base * bw + loc * locW) / (bw + locW);
    };
    const shareOf = (r: Row, locW: number, ownLoc: (r: Row) => number | null) => {
      const oq = scoreWith(r.parts, ownLoc(r), locW);
      const own = r.pc;
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (scoreWith(x.parts, x.floorScore, locW) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return own / (own + riv);
    };
    const show = (label: string, locW: number, ownLoc: (r: Row) => number | null) => {
      const ps = cmp.map((r) => shareOf(r, locW, ownLoc));
      const e = cmp.map((r, i) => ps[i] / r.shareObs - 1);
      const jk = cmp.map((_, i) => pear(ps.filter((_, j) => j !== i), cmp.filter((_, j) => j !== i).map((r) => r.shareObs)));
      console.log(`${label.padEnd(34)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(ps, cmp.map((r) => r.shareObs)).toFixed(3).padStart(10)}${`${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)}`.padStart(16)}`);
    };
    console.log(`\n유효거리 ${P.effectiveRadiusM}m · θ=${P.qualityExponent} 고정. 판정 기준은 r이다(MAPE는 이 층에서 무력하다).`);
    console.log(`${"입지 처리".padEnd(34)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"실측과 r".padStart(10)}${"한 곳 빼면".padStart(16)}`);
    show("입지 없음 (지금 채택본)", 0, () => null);
    show("층수자 입지 17% (양쪽 같은 자)", 0.17, (r) => r.floorScore);
    show("  └ 비중 8.5%", 0.085, (r) => r.floorScore);
    show("  └ 비중 30%", 0.30, (r) => r.floorScore);
    // 지금 운영 방식 — 자사는 주관 3항목, 경쟁점은 층수자. 자가 다른 상태 그대로.
    const ownSubjective = (r: Row) => {
      const a = r.loc.locationScore, b = r.loc.preemptionScore, c = r.loc.visibilityScore;
      return a == null && b == null && c == null ? null
        : (Number(a ?? 3) * 0.6 + Number(b ?? 3) * 0.25 + Number(c ?? 3) * 0.15);
    };
    show("자가 다른 채로 17% (지금 운영방식)", 0.17, ownSubjective);
    console.log(`  -> "입지 없음"보다 r이 올라야 넣을 값어치가 있다. 한 곳 빼서 무너지면 한 매장이 만든 것이다.`);

    // 주관 항목이 층수 말고 무엇을 더 담고 있나 — 그게 새로 만들 항목의 재료다.
    const ok = cmp.filter((r) => r.floorScore != null && r.loc.visibilityScore != null);
    console.log(`\n[주관 항목 vs 층수자] n=${ok.length}`);
    console.log(`  접근가시성 ↔ 층수자 상관 r=${pear(ok.map((r) => Number(r.loc.visibilityScore)), ok.map((r) => r.floorScore!)).toFixed(3)}`);
    const resid = ok.map((r) => Number(r.loc.visibilityScore) - r.floorScore!);
    console.log(`  층수로 설명 안 되는 몫: 중앙 ${med(resid).toFixed(2)} · 표준편차 ${sd(resid).toFixed(2)} · 범위 ${Math.min(...resid)}~${Math.max(...resid)}`);
    console.log(`  그 몫과 실측 점유율 r=${pear(resid, ok.map((r) => r.shareObs)).toFixed(3)} (유의선 ${(2 / Math.sqrt(ok.length)).toFixed(3)})`);
    console.log(`  -> 이 잔차가 유의하면 "층수 밖의 무언가"(간판·코너·보행노출)가 실재한다는 뜻이고,`);
    console.log(`     그게 새 입지 항목이 담아야 할 내용이다. 유의하지 않으면 입지는 층수로 충분하다.`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("④ 입지를 경쟁력 안이 아니라 독립 항으로 두면", () => {
    // ③에서 층수를 **품질에 섞으면** 개선이 없었다. 그런데 ①에서 자사 층수자 점수 자체는
    // 실측 점유율과 r=0.329(시점통제 0.389*)로 **유일하게 유의선을 넘는 입지 지표**였다.
    //
    // 두 결과가 모순이 아니다. 품질에 섞으면 **경쟁점 층수와 나누게 되는데**, 접근성은
    // "경쟁점보다 높은 층인가"가 아니라 **"올라오기 얼마나 번거로운가"**일 수 있다.
    // 6층 매장은 경쟁점이 없어도 덜 온다. 그렇다면 비율이 아니라 **곱셈 항**이 맞다:
    //
    //   점유율 = [품질 점유율] x (자사 층수자 점수 ÷ 기준)^κ
    //
    // ⚠️ 독점 3곳으로 축척 A를 맞추므로, 그 3곳의 층수가 평균적이면 효과 일부가 A에 흡수된다.
    //    그래서 κ를 올렸을 때 **편향이 아니라 r이 좋아지는지**를 본다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    console.log(`\n층수자 점수 기준값(전 매장 중앙) = ${ref}`);
    console.log(`${"κ (접근성 지수)".padEnd(18)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"실측과 r".padStart(10)}${"한 곳 빼면".padStart(16)}`);
    for (const k of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
      const ps = cmp.map((r) => baseShare(r) * (r.floorScore == null ? 1 : Math.pow(r.floorScore / ref, k)));
      const e = cmp.map((r, i) => ps[i] / r.shareObs - 1);
      const jk = cmp.map((_, i) => pear(ps.filter((_, j) => j !== i), cmp.filter((_, j) => j !== i).map((r) => r.shareObs)));
      console.log(`${String(k).padEnd(18)}${(mean(e) * 100).toFixed(1).padStart(8)}%${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(ps, cmp.map((r) => r.shareObs)).toFixed(3).padStart(10)}${`${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)}`.padStart(16)}`);
    }
    console.log(`  κ=0이 "입지 없음"이다. r이 올라가야 값어치가 있다.`);

    // 층수자 점수를 잔차에 직접 대본다 — 곱셈 항이 맞다면 여기서 붙어야 한다.
    const ok = cmp.filter((r) => r.floorScore != null);
    const resid = ok.map((r) => Math.log(r.shareObs / baseShare(r)));
    const fs = ok.map((r) => r.floorScore!);
    const sig = 2 / Math.sqrt(ok.length);
    console.log(`\n[품질 점유율이 남긴 오차 vs 층수자 점수] n=${ok.length} · 유의선 ${sig.toFixed(3)}`);
    const rr = pear(fs, resid), rp = partial(fs, resid, ok.map((r) => r.t));
    console.log(`  단순 r=${rr.toFixed(3)}${Math.abs(rr) > sig ? " *" : ""} · 평가창 시점 통제 r=${rp.toFixed(3)}${Math.abs(rp) > sig ? " *" : ""}`);
    console.log(`  양수면 "층이 낮은데도 예측이 낮다 = 접근성을 덜 쳐줬다"는 뜻이다.`);
    console.log(`  ⚠️ 부호가 음수이거나 유의선 미달이면 층수는 이 층에서 더 쓸 게 없다.`);
    expect(ok.length).toBeGreaterThan(20);
  });

  it("⑤ 접근성 항 κ — 경쟁 항과 같은 관문을 통과하나", () => {
    // ④에서 r이 0.554 -> 0.657로 크게 올랐다. 하지만 κ는 **또 하나의 자유계수**다.
    // 이 저장소는 정확히 이렇게 두 번 속았다(2026-09-15 밀집도 r=0.660, 2026-09-16 gamma=4).
    // 그래서 경쟁 항에 쓴 관문을 그대로 통과시킨다: LOO · 5겹 · 무작위 대조군.
    //
    // ⚠️ 경고등이 하나 켜져 있다 — 평가창 시점을 통제하면 잔차 상관이 0.400 -> 0.374로
    //    유의선(0.371)에 거의 붙는다. 코호트 교란일 수 있다(project_cohort_effect_confound).
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    type P2 = { base: number; fs: number; obs: number };
    const base: P2[] = cmp.map((r) => ({ base: baseShare(r), fs: r.floorScore ?? ref, obs: r.shareObs }));
    const KS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
    const predK = (p: P2, k: number) => p.base * Math.pow(p.fs / ref, k);
    const mapeK = (s: P2[], k: number) => mean(s.map((p) => Math.abs(predK(p, k) / p.obs - 1)));
    const corrK = (s: P2[], k: number) => pear(s.map((p) => predK(p, k)), s.map((p) => p.obs));
    const pickK = (s: P2[], crit: "mape" | "r") => {
      let best = { k: KS[0], v: Infinity };
      for (const k of KS) { const v = crit === "mape" ? mapeK(s, k) : -corrK(s, k); if (v < best.v) best = { k, v }; }
      return best;
    };

    console.log(`\n══ LOO 홀드아웃 — 한 곳 빼고 κ 고른 뒤 뺀 곳에서 채점 ══`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: number[] = [];
      for (let i = 0; i < base.length; i++) {
        const b = pickK(base.filter((_, j) => j !== i), crit);
        picks.push(b.k);
        const ph = predK(base[i], b.k);
        preds.push(ph); errs.push(Math.abs(ph / base[i].obs - 1));
      }
      const ins = pickK(base, crit);
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준] 표본 안 ${(mapeK(base, ins.k) * 100).toFixed(2)}% (κ=${ins.k}) → LOO ${(mean(errs) * 100).toFixed(2)}% · LOO r=${pear(preds, base.map((p) => p.obs)).toFixed(3)}`);
      console.log(`     훈련이 고른 κ: ${tally.map(([k, n]) => `${k} ${Math.round(n / base.length * 100)}%`).join(" · ")}`);
    }
    console.log(`  (비교) κ=0(입지 없음) LOO 기준선 r=${corrK(base, 0).toFixed(3)} · MAPE ${(mapeK(base, 0) * 100).toFixed(2)}%`);

    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n══ 5겹 교차검증 100회 — κ가 흔들리나 ══`);
    for (const crit of ["mape", "r"] as const) {
      const picks: number[] = [];
      for (let rep = 0; rep < 100; rep++) {
        const idx = shuffled(base.map((_, i) => i));
        for (let f = 0; f < 5; f++) picks.push(pickK(idx.filter((_, j) => j % 5 !== f).map((i) => base[i]), crit).k);
      }
      const tally = [...new Set(picks)].map((k) => [k, picks.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준] ${tally.slice(0, 4).map(([k, n]) => `κ=${k} ${(n / picks.length * 100).toFixed(0)}%`).join(" · ")}`);
    }

    console.log(`\n══ 무작위 대조군 500회 — 층수를 매장끼리 섞는다 ══`);
    for (const crit of ["mape", "r"] as const) {
      const sc = (s: P2[], k: number) => (crit === "mape" ? mapeK(s, k) : -corrK(s, k));
      const gainOf = (s: P2[]) => sc(s, 0) - sc(s, pickK(s, crit).k);
      const real = gainOf(base);
      const gains: number[] = [];
      for (let i = 0; i < 500; i++) {
        const pool = shuffled(base.map((p) => p.fs));
        gains.push(gainOf(base.map((p, j) => ({ ...p, fs: pool[j] }))));
      }
      gains.sort((a, b) => a - b);
      const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
      const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gains))} · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])} · p = ${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    expect(base.length).toBeGreaterThan(20);
  });

  it("⑤-B 지하를 지상과 같게 보는 게 맞나 — 2026-09-18 오송점에서 나온 질문", () => {
    // 지금 자(`computeLocationScoreFromFacts`)는 **지하 1~2층과 지상 1~2층에 같은 4점**을 준다.
    // 엘리베이터가 있으면 둘 다 5점 만점이다. 오송점(지하 1층·엘베)이 접근성 만점을 받아서
    // 드러났다 — 사람은 "지하라 가시성이 나쁘다"고 접근가시성을 내렸는데 산식은 만점이었다.
    //
    // ⚠️ 이 자는 **운영 V62도 쓴다**(경쟁력점수 입지 폴백). 그래서 여기서는 고치지 않고
    //    실험실 안에서 대안 자로 갈아끼워 재기만 한다. 통과하면 그때 어디에 둘지 얘기한다.
    //
    // 관문은 ⑤와 같다. 다만 고르는 게 κ가 아니라 **자 자체**라, 대조군은 "어느 매장이
    // 지하인가"를 섞는다 — 지하 곳수는 그대로 두고 라벨만 옮긴다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const KAPPA = P.locationExponents.access;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };

    // 대안 자들. 지상 쪽은 한 글자도 안 건드린다 — 지하 칸만 다르다.
    type Scale = (floor: number, isBasement: boolean, elev: boolean) => number;
    const mk = (basementBase: (f: number) => number, elevInBasement: boolean): Scale =>
      (floor, isBasement, elev) => {
        if (isBasement) return Math.min(5, basementBase(floor) + (elev && elevInBasement ? 1 : 0));
        let b: number;
        if (floor <= 2) b = 4; else if (floor === 3) b = 3; else if (floor === 4) b = 2;
        else if (floor === 5) b = 1; else b = 0;
        return Math.min(5, b + (elev ? 1 : 0));
      };
    const SCALES: { label: string; f: Scale }[] = [
      { label: "지금 (지하1~2 = 4, 지상과 같음)", f: mk((f) => (f <= 2 ? 4 : 3), true) },
      { label: "지하 한 단계 아래 (지하1~2 = 3)", f: mk((f) => (f <= 2 ? 3 : 2), true) },
      { label: "지하 두 단계 아래 (지하1~2 = 2)", f: mk((f) => (f <= 2 ? 2 : 1), true) },
      { label: "지하엔 엘베 가산 없음", f: mk((f) => (f <= 2 ? 4 : 3), false) },
    ];

    const facts = cmp.map((r) => ({
      n: r.n,
      floor: Math.abs(Number(r.store.floor ?? 1)),
      basement: r.store.groundLevel === "지하",
      elev: r.store.hasElevator === true,
      base: baseShare(r),
      obs: r.shareObs,
    }));
    const basements = facts.filter((f) => f.basement);
    console.log(
      `\n══ ⑤-B 지하 자 — 경쟁상권 ${facts.length}곳 중 지하 ${basements.length}곳 ══\n` +
        basements.map((b) => `  ${b.n} 지하${b.floor}층 · 엘베 ${b.elev ? "있음" : "없음"}`).join("\n"),
    );

    // 기준값은 자유계수가 아니라 정규화다 — 자를 바꾸면 기하평균도 같이 다시 잡는다.
    const geo = (a: number[]) => Math.exp(mean(a.map((v) => Math.log(Math.max(0.01, v)))));
    const scoreOf = (s: Scale, ff: typeof facts) => {
      const fs = ff.map((p) => s(p.floor, p.basement, p.elev));
      const ref = geo(fs);
      const pred = ff.map((p, i) => p.base * Math.pow(fs[i] / ref, KAPPA));
      return {
        mape: mean(pred.map((v, i) => Math.abs(v / ff[i].obs - 1))),
        r: pear(pred, ff.map((p) => p.obs)),
        ref,
      };
    };

    console.log(`\n  ${"자".padEnd(30)} ${"기준값".padStart(7)} ${"MAPE".padStart(8)} ${"r".padStart(7)}  지금 대비`);
    const v0 = scoreOf(SCALES[0].f, facts);
    for (const s of SCALES) {
      const v = scoreOf(s.f, facts);
      const dm = ((v.mape - v0.mape) * 100).toFixed(2);
      const dr = (v.r - v0.r).toFixed(3);
      console.log(
        `  ${s.label.padEnd(30)} ${v.ref.toFixed(2).padStart(7)} ${`${(v.mape * 100).toFixed(2)}%`.padStart(8)} ${v.r.toFixed(3).padStart(7)}` +
          `  MAPE ${dm}%p · r ${dr}`,
      );
    }

    // 대조군 — "어느 매장이 지하인가"를 섞는다. 지하 곳수는 보존한다.
    let seed = 20260918 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n══ 무작위 대조군 500회 — 지하 라벨을 매장끼리 섞는다 ══`);
    for (const s of SCALES.slice(1)) {
      for (const crit of ["mape", "r"] as const) {
        const gain = (ff: typeof facts) => {
          const a = scoreOf(SCALES[0].f, ff), b = scoreOf(s.f, ff);
          return crit === "mape" ? a.mape - b.mape : b.r - a.r;
        };
        const real = gain(facts);
        const gains: number[] = [];
        for (let i = 0; i < 500; i++) {
          const pool = shuffled(facts.map((p) => p.basement));
          gains.push(gain(facts.map((p, j) => ({ ...p, basement: pool[j] }))));
        }
        gains.sort((a, b) => a - b);
        const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
        const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
        console.log(
          `  ${s.label.padEnd(30)} [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)}` +
            ` · 섞으면 중앙 ${f(med(gains))} · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])}` +
            ` · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`,
        );
      }
    }
    console.log(
      `\n  ⚠️ 지하가 ${basements.length}곳뿐이다. 대조군이 통과해도 그 셋이 우연히 잘 맞은 것일 수 있고,` +
        `\n     미달이어도 "지하가 상관없다"는 뜻이 아니라 **자료가 못 정한다**는 뜻이다.`,
    );
    expect(facts.length).toBeGreaterThan(20);
  });

  it("⑥ 절대 층수인가 상대 층수인가 — 사용자 항목 ②", () => {
    // 사용자(2026-09-17): "경재점이 지하1층 2층 이렇게되어있는데 우리점포는 5층 7층
    // 이렇게되어있으면 이것도반영해야되고"
    //
    // ④~⑤에서 쓴 건 **자사 절대 층수**다. 사용자가 말한 건 **경쟁점 대비 상대 층수**다.
    // 둘은 다른 주장이고, 어느 쪽이 맞는지는 재보면 안다.
    //   절대 — 6층이면 경쟁점이 없어도 덜 온다 (올라오기 번거롭다)
    //   상대 — 경쟁점이 2층이고 우리가 6층이면 손님이 그쪽으로 간다 (비교당한다)
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    // 유효거리 안 경쟁점의 층수자 점수를 PC대수로 가중평균 — "이 상권 경쟁점들은 몇 층인가"
    const rivalFloor = (r: Row) => {
      let w = 0, s = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM || x.floorScore == null) continue;
        w += x.ip; s += x.ip * x.floorScore;
      }
      return w > 0 ? s / w : null;
    };
    const ok = cmp.filter((r) => r.floorScore != null && rivalFloor(r) != null);
    console.log(`\n경쟁상권 ${cmp.length}곳 중 경쟁점 층수를 아는 ${ok.length}곳 · 유의선 ${(2 / Math.sqrt(ok.length)).toFixed(3)}`);
    const own = ok.map((r) => r.floorScore!), riv = ok.map((r) => rivalFloor(r)!);
    console.log(`  자사 층수자 점수  중앙 ${med(own).toFixed(2)} · 범위 ${Math.min(...own)}~${Math.max(...own)}`);
    console.log(`  경쟁 층수자 점수  중앙 ${med(riv).toFixed(2)} · 범위 ${Math.min(...riv).toFixed(1)}~${Math.max(...riv).toFixed(1)}`);
    console.log(`  자사-경쟁 차이    중앙 ${med(own.map((v, i) => v - riv[i])).toFixed(2)} · 자사가 유리한 곳 ${own.filter((v, i) => v > riv[i]).length}곳 / 불리 ${own.filter((v, i) => v < riv[i]).length}곳`);
    console.log(`  두 값의 상관 r=${pear(own, riv).toFixed(3)} (높으면 "같은 상권은 다 비슷한 층"이라 상대가 무의미하다)`);

    const resid = ok.map((r) => Math.log(r.shareObs / baseShare(r)));
    const t = ok.map((r) => r.t);
    const sig = 2 / Math.sqrt(ok.length);
    const line = (label: string, v: number[]) => {
      const r1 = pear(v, resid), r2 = partial(v, resid, t);
      console.log(`  ${label.padEnd(30)} r=${(r1.toFixed(3) + (Math.abs(r1) > sig ? " *" : "  ")).padStart(9)}  시점통제 ${(r2.toFixed(3) + (Math.abs(r2) > sig ? " *" : "")).padStart(8)}`);
    };
    console.log(`\n[품질 점유율이 남긴 오차와의 상관]`);
    line("자사 절대 층수 (지금 κ 항)", own);
    line("자사 − 경쟁 (상대 층수)", own.map((v, i) => v - riv[i]));
    line("자사 ÷ 경쟁 (상대 비율)", own.map((v, i) => v / riv[i]));
    line("경쟁 층수만 (참고)", riv);

    console.log(`\n[두 항을 같이 넣으면] 점유율 x (자사÷${ref})^κ x (자사−경쟁+3)^μ 훑기`);
    console.log(`${"κ(절대)".padStart(8)}${"μ(상대)".padStart(9)}${"MAPE".padStart(9)}${"실측과 r".padStart(10)}`);
    for (const k of [0, 0.25, 0.5]) {
      for (const m of [0, 0.25, 0.5]) {
        const ps = ok.map((r) => baseShare(r) * Math.pow(r.floorScore! / ref, k) * Math.pow(Math.max(0.5, r.floorScore! - rivalFloor(r)! + 3) / 3, m));
        const e = ok.map((r, i) => ps[i] / r.shareObs - 1);
        console.log(`${String(k).padStart(8)}${String(m).padStart(9)}${(mean(e.map(Math.abs)) * 100).toFixed(1).padStart(8)}%${pear(ps, ok.map((r) => r.shareObs)).toFixed(3).padStart(10)}`);
      }
    }
    console.log(`  -> μ를 올려 좋아지면 "비교당한다"가 맞고, κ만 남으면 "올라오기 번거롭다"가 맞다.`);
    expect(ok.length).toBeGreaterThan(15);
  });

  it("⑦ 상권 끝 vs 중심 — 두 출처로 만들어 교차검증한다", () => {
    // 사용자 항목 ①: "상권 끝에있으면 접근성이 떨어지니까 이거 평가해야되고"
    // 사용자 방향: "카카오API지금 활성화되어있으니까 이런걸로 교차검증하면어떨까"
    //
    // ── 정의 ──────────────────────────────────────────────────────────
    // 상권 중심에 있으면 **우리 문 앞**이 붐비고, 끝에 있으면 우리 주변은 한산한데
    // **조금 떨어진 곳**이 붐빈다. 그래서 "가까운 밀도 ÷ 넓은 밀도"로 잰다:
    //
    //   중심도 = (안쪽 100m 밀도) ÷ (전체 1km 밀도) = (안쪽 개수 ÷ 전체 개수) x 100
    //
    // 1보다 크면 우리 바로 앞이 상권 평균보다 빽빽하다(=중심), 작으면 한산하다(=끝).
    //
    // ── 왜 두 벌인가 ──────────────────────────────────────────────────
    // 같은 자료로는 정의가 맞는지 확인할 수 없다. 출처를 갈라야 한다:
    //   (가) 유동인구 — 소상공인365. "사람이 지나가나"
    //   (나) 업소 밀도 — 카카오 FD6/CE7/CS2. "가게가 모여 있나"
    // 둘이 같은 답을 내면 정의가 실재하는 것이고, 갈리면 내가 잘못 정의한 것이다.
    const DENS = ".local-tools/kakao-place-density.json";
    if (!existsSync(DENS)) { console.log(`\n${DENS}가 없다. node scripts/collectKakaoPlaceDensity.mjs 먼저.`); return; }
    const K = JSON.parse(readFileSync(DENS, "utf8")).sites as Record<string, any>;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const baseShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    /** 유동인구 반경 r의 최근 12개월 평균. */
    const flo = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      if (!sel?.length) return null;
      return mean(sel.slice(-12));
    };
    const kak = (r: Row, code: string, rad: number): number | null => {
      const v = K[key(r)]?.counts?.[code]?.[String(rad)];
      return v == null ? null : Number(v);
    };
    /** 중심도 = (안쪽 개수 ÷ 넓은 개수) x (넓은반경/안쪽반경)^2 */
    const centrality = (inner: number | null, outer: number | null, ri: number, ro: number) =>
      inner == null || outer == null || !(outer > 0) ? null : (inner / outer) * (ro / ri) ** 2;

    type M = { label: string; get: (r: Row) => number | null };
    const measures: M[] = [
      { label: "(가) 유동 100m/1km", get: (r) => centrality(flo(r, 100), flo(r, 1000), 100, 1000) },
      { label: "(가) 유동 100m/500m", get: (r) => centrality(flo(r, 100), flo(r, 500), 100, 500) },
      { label: "(가) 유동 300m/1km", get: (r) => centrality(flo(r, 300), flo(r, 1000), 300, 1000) },
      { label: "(나) 음식점 100m/1km", get: (r) => centrality(kak(r, "FD6", 100), kak(r, "FD6", 1000), 100, 1000) },
      { label: "(나) 음식점 300m/1km", get: (r) => centrality(kak(r, "FD6", 300), kak(r, "FD6", 1000), 300, 1000) },
      { label: "(나) 음식+카페+편의 100m/1km", get: (r) => {
        const i = ["FD6", "CE7", "CS2"].map((c) => kak(r, c, 100));
        const o = ["FD6", "CE7", "CS2"].map((c) => kak(r, c, 1000));
        if (i.some((v) => v == null) || o.some((v) => v == null)) return null;
        return centrality(i.reduce((a, b) => a! + b!, 0), o.reduce((a, b) => a! + b!, 0), 100, 1000);
      } },
    ];

    console.log(`\n[분포] 1보다 크면 우리 문 앞이 상권 평균보다 빽빽하다(=중심)`);
    console.log(`${"지표".padEnd(30)}${"결측".padStart(6)}${"중앙".padStart(9)}${"범위".padStart(18)}${"변동계수".padStart(10)}`);
    for (const m of measures) {
      const v = cmp.map(m.get).filter((x): x is number => x != null);
      console.log(`${m.label.padEnd(30)}${String(cmp.length - v.length).padStart(6)}${med(v).toFixed(2).padStart(9)}${`${Math.min(...v).toFixed(2)}~${Math.max(...v).toFixed(2)}`.padStart(18)}${(sd(v) / mean(v) * 100).toFixed(1).padStart(9)}%`);
    }

    // ── 교차검증 — 두 출처가 같은 답을 내는가 ─────────────────────────
    console.log(`\n[교차검증] 유동인구(소상공인365) x 업소밀도(카카오) — 출처가 완전히 다르다`);
    const A = measures[0], B = measures[3];
    const pair = cmp.filter((r) => A.get(r) != null && B.get(r) != null);
    const av = pair.map((r) => A.get(r)!), bv = pair.map((r) => B.get(r)!);
    console.log(`  ${A.label} ↔ ${B.label}  r=${pear(av, bv).toFixed(3)}  (n=${pair.length}, 유의선 ${(2 / Math.sqrt(pair.length)).toFixed(3)})`);
    console.log(`  순위로 보면 r=${pear(av.map((_, i) => av.filter((x) => x < av[i]).length), bv.map((_, i) => bv.filter((x) => x < bv[i]).length)).toFixed(3)}`);
    const disagree = pair.map((r, i) => ({ n: r.n, a: av[i], b: bv[i] }))
      .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b)).slice(0, 4);
    console.log(`  가장 어긋나는 4곳: ${disagree.map((d) => `${d.n}(유동 ${d.a.toFixed(1)} vs 업소 ${d.b.toFixed(1)})`).join(" · ")}`);

    // ── 실측 검정 — 품질 점유율이 남긴 오차를 설명하나 ─────────────────
    console.log(`\n[실측 검정] 품질 점유율 잔차와의 상관 (층수 항 κ=0.25를 이미 반영한 뒤)`);
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    const withFloor = (r: Row) => baseShare(r) * Math.pow((r.floorScore ?? ref) / ref, 0.25);
    console.log(`${"지표".padEnd(30)}${"단순 r".padStart(10)}${"시점통제".padStart(10)}`);
    for (const m of measures) {
      const ok2 = cmp.filter((r) => m.get(r) != null);
      if (ok2.length < 15) continue;
      const x = ok2.map((r) => Math.log(m.get(r)!));
      const y = ok2.map((r) => Math.log(r.shareObs / withFloor(r)));
      const t = ok2.map((r) => r.t);
      const sg = 2 / Math.sqrt(ok2.length);
      const r1 = pear(x, y), r2 = partial(x, y, t);
      console.log(`${m.label.padEnd(30)}${(r1.toFixed(3) + (Math.abs(r1) > sg ? " *" : "  ")).padStart(10)}${(r2.toFixed(3) + (Math.abs(r2) > sg ? " *" : "  ")).padStart(10)}`);
    }
    console.log(`  양수면 "상권 중심인데 예측이 낮다 = 중심 프리미엄을 덜 쳐줬다"는 뜻이다.`);
    console.log(`  ⚠️ 유의선을 넘는 지표가 없으면 "상권 끝"은 이 자료로는 잡히지 않는 것이다.`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("⑧ 그 중심도가 정말 '입지'인가 — 수요식 반경의 그림자가 아닌가", () => {
    // ⑦에서 유동 300m/1km 중심도가 잔차를 r=0.601*로 설명했다. 붙잡기 전에 **의심부터** 한다.
    //
    // 지금 수요식은 **주거 1km + 유동 400m x 0.15**다. 중심도는 유동 300m와 1km의 비다.
    // 그러면 "유동을 400m로 재는 게 틀렸다"는 사실이 중심도의 탈을 쓰고 나타날 수 있다.
    // 상권 끝 매장은 400m 안에 남의 상권이 섞여 수요가 부풀고, 그만큼 shareObs가 작아진다.
    // **그건 입지가 아니라 반경 선택 문제다.**
    //
    // 가르는 법: 수요식의 유동 반경을 바꿔가며 중심도 효과가 살아남는지 본다.
    //   살아남으면  -> 진짜 입지다 (반경과 무관하게 실재)
    //   사라지면    -> 반경을 잘못 고른 것이다 (입지 항목이 아니라 수요식을 고쳐야 한다)
    const DENS = ".local-tools/kakao-place-density.json";
    if (!existsSync(DENS)) return;
    const K = JSON.parse(readFileSync(DENS, "utf8")).sites as Record<string, any>;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    const floAvg = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    /** 반경 rad로 유동 수요를 다시 만든다 — 본 산식의 연령·성비 가중을 그대로 쓴다. */
    const floDemand = (r: Row, rad: number): number | null => {
      const node = F[key(r)]?.radii?.[String(rad)];
      if (!node?.selected?.length || !node.demographics) return null;
      const last = node.selected[node.selected.length - 1];
      const sc = last > 0 ? mean(node.selected.slice(-12)) / last : 1;
      const d = node.demographics, FR = bl(d.total > 0 ? d.male / d.total : 0.5);
      return ((d.age10s ?? 0) * FR.t + (d.age20s ?? 0) * FR.tw + (d.age30s ?? 0) * FR.th + (d.age40s ?? 0) * FR.f) * sc;
    };
    /** 주거 몫 = 지금 demand에서 유동 400m 몫을 걷어낸 나머지. */
    const resiOf = (r: Row) => r.demand - (floDemand(r, 400) ?? 0) * 0.15;
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const ref = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    const withFloor = (r: Row) => qualShare(r) * Math.pow((r.floorScore ?? ref) / ref, 0.25);

    const cent = (r: Row, inner: number, outer: number) => {
      const i = floAvg(r, inner), o = floAvg(r, outer);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (outer / inner) ** 2;
    };
    const centKakao = (r: Row) => {
      const i = K[key(r)]?.counts?.FD6?.["300"], o = K[key(r)]?.counts?.FD6?.["1000"];
      return i == null || o == null || !(o > 0) ? null : (Number(i) / Number(o)) * (1000 / 300) ** 2;
    };

    console.log(`\n수요식의 유동 반경을 바꿔가며 축척 A를 다시 맞추고, 중심도가 남는지 본다.`);
    console.log(`(독점 ${rows.filter((r) => !r.rivals.length).length}곳으로 A를 매번 다시 고정한다 — 산식이 실제로 쓰는 설정)`);
    console.log(`${"수요식 유동반경".padEnd(16)}${"n".padStart(4)}${"유동300/1km r".padStart(14)}${"시점통제".padStart(10)}${"카카오300/1km r".padStart(16)}`);
    for (const rad of [100, 200, 300, 400, 500, 1000]) {
      const built = rows.map((r) => {
        const fd = floDemand(r, rad);
        return { r, demand: fd == null ? null : resiOf(r) + fd * 0.15 };
      }).filter((x): x is { r: Row; demand: number } => x.demand != null && x.demand > 0);
      const mono2 = built.filter((x) => !x.r.rivals.length);
      if (mono2.length < 2) continue;
      const A2 = med(mono2.map((x) => x.r.util / (x.demand / (x.r.pc * 720))));
      const cmp2 = built.filter((x) => x.r.rivals.length);
      const obs = cmp2.map((x) => x.r.util / (A2 * x.demand / (x.r.pc * 720)));
      const resid = cmp2.map((x, i) => Math.log(obs[i] / withFloor(x.r)));
      const t = cmp2.map((x) => x.r.t);
      const sg = 2 / Math.sqrt(cmp2.length);
      const c1 = cmp2.map((x) => cent(x.r, 300, 1000));
      const c2 = cmp2.map((x) => centKakao(x.r));
      const use = (cv: (number | null)[]) => {
        const idx = cv.map((v, i) => [v, i] as const).filter((p): p is readonly [number, number] => p[0] != null);
        return { x: idx.map(([v]) => Math.log(v)), y: idx.map(([, i]) => resid[i]), t: idx.map(([, i]) => t[i]) };
      };
      const u1 = use(c1), u2 = use(c2);
      const r1 = pear(u1.x, u1.y), r1p = partial(u1.x, u1.y, u1.t), r2 = pear(u2.x, u2.y);
      const mark = (v: number) => v.toFixed(3) + (Math.abs(v) > sg ? " *" : "  ");
      console.log(`${`${rad}m${rad === 400 ? " (지금)" : ""}`.padEnd(16)}${String(cmp2.length).padStart(4)}${mark(r1).padStart(14)}${mark(r1p).padStart(10)}${mark(r2).padStart(16)}`);
    }
    console.log(`  -> 모든 반경에서 살아남으면 진짜 입지다. 특정 반경에서만 뜨면 반경 선택 문제다.`);
    console.log(`  ⚠️ 유동 300m/1km는 수요식이 유동을 300m로 재면 **정의상 수요와 겹친다** — 그 줄은 걸러 읽어라.`);
    console.log(`     카카오 열은 수요식과 출처가 달라 그 겹침이 없다. **그 열이 진짜 판정이다.**`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("⑨ 중심도 항 ν — 관문(LOO·5겹·대조군)을 통과하나", () => {
    // ⑦⑧은 상관까지였다. 상관 0.601은 아직 "그럴싸하다"까지다 — 이 저장소는 정확히 그 단계에서
    // 두 번 속았다(2026-09-15 밀집도 r=0.660 / 2026-09-16 gamma=4). 항으로 만들어 검정한다.
    //
    //   점유율 = [품질 점유율] x (층수자÷기준)^κ x (중심도÷기준)^ν
    //
    // κ까지 **같이 자유로 푼다.** κ를 0.25로 박아두고 ν만 고르면 자유도를 숨기는 것이다.
    const DENS = ".local-tools/kakao-place-density.json";
    if (!existsSync(DENS)) return;
    const K = JSON.parse(readFileSync(DENS, "utf8")).sites as Record<string, any>;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    const floAvg = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const centFlo = (r: Row) => {
      const i = floAvg(r, 300), o = floAvg(r, 1000);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (1000 / 300) ** 2;
    };
    const centKak = (r: Row) => {
      const i = K[key(r)]?.counts?.FD6?.["300"], o = K[key(r)]?.counts?.FD6?.["1000"];
      return i == null || o == null || !(o > 0) ? null : (Number(i) / Number(o)) * (1000 / 300) ** 2;
    };
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const fRef = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));

    type Q = { n: string; base: number; fs: number; ct: number; obs: number; t: number };
    const build = (get: (r: Row) => number | null): { set: Q[]; ref: number } | null => {
      const ok = cmp.filter((r) => get(r) != null && get(r)! > 0);
      if (ok.length < 20) return null;
      const ref = med(ok.map((r) => get(r)!));
      return { ref, set: ok.map((r) => ({ n: r.n, base: qualShare(r), fs: r.floorScore ?? fRef, ct: get(r)!, obs: r.shareObs, t: r.t })) };
    };
    const KAP = [0, 0.25, 0.5, 0.75, 1];
    const NU = [0, 0.25, 0.5, 0.75, 1];

    const runGate = (title: string, get: (r: Row) => number | null) => {
      const built = build(get);
      if (!built) { console.log(`\n${title}: 표본 부족`); return; }
      const { set, ref } = built;
      const pred = (q: Q, k: number, v: number) => q.base * Math.pow(q.fs / fRef, k) * Math.pow(q.ct / ref, v);
      const mape = (s: Q[], k: number, v: number) => mean(s.map((q) => Math.abs(pred(q, k, v) / q.obs - 1)));
      const corr = (s: Q[], k: number, v: number) => pear(s.map((q) => pred(q, k, v)), s.map((q) => q.obs));
      const sc = (s: Q[], crit: "mape" | "r", k: number, v: number) => (crit === "mape" ? mape(s, k, v) : -corr(s, k, v));
      const pick = (s: Q[], crit: "mape" | "r", Ks = KAP, Vs = NU) => {
        let b = { k: Ks[0], v: Vs[0], val: Infinity };
        for (const k of Ks) for (const v of Vs) { const x = sc(s, crit, k, v); if (x < b.val) b = { k, v, val: x }; }
        return b;
      };
      console.log(`\n══ ${title} (n=${set.length}) ══`);
      const b0 = pick(set, "mape", KAP, [0]);       // 층수만
      const b1 = pick(set, "mape");                  // 층수 + 중심도
      console.log(`  표본 안 최선: 층수만 κ=${b0.k} → MAPE ${(mape(set, b0.k, 0) * 100).toFixed(2)}% · r ${corr(set, b0.k, 0).toFixed(3)}`);
      console.log(`              +중심도 κ=${b1.k}·ν=${b1.v} → MAPE ${(mape(set, b1.k, b1.v) * 100).toFixed(2)}% · r ${corr(set, b1.k, b1.v).toFixed(3)}`);
      // 잭나이프 — 한 곳이 만든 값인지
      const jk = set.map((_, i) => {
        const s2 = set.filter((_, j) => j !== i);
        return pear(s2.map((q) => pred(q, b1.k, b1.v)), s2.map((q) => q.obs));
      });
      console.log(`  한 곳 빼면 r ${Math.min(...jk).toFixed(3)}~${Math.max(...jk).toFixed(3)} (유의선 ${(2 / Math.sqrt(set.length - 1)).toFixed(3)})`);

      for (const crit of ["mape", "r"] as const) {
        const errs: number[] = [], preds: number[] = [], picks: string[] = [];
        for (let i = 0; i < set.length; i++) {
          const b = pick(set.filter((_, j) => j !== i), crit);
          picks.push(`κ${b.k}/ν${b.v}`);
          const ph = pred(set[i], b.k, b.v);
          preds.push(ph); errs.push(Math.abs(ph / set[i].obs - 1));
        }
        const ins = pick(set, crit);
        const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
        console.log(`  LOO [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mape(set, ins.k, ins.v) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}% (벌어짐 ${((mean(errs) - mape(set, ins.k, ins.v)) * 100).toFixed(2)}%p) · LOO r=${pear(preds, set.map((q) => q.obs)).toFixed(3)}`);
        console.log(`      고른 값: ${tally.slice(0, 3).map(([x, n]) => `${x} ${Math.round(n / set.length * 100)}%`).join(" · ")}`);
      }

      let seed = 20260917 >>> 0;
      const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
      const shuf = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };
      for (const crit of ["mape", "r"] as const) {
        const picks: string[] = [];
        for (let rep = 0; rep < 100; rep++) {
          const idx = shuf(set.map((_, i) => i));
          for (let f = 0; f < 5; f++) { const b = pick(idx.filter((_, j) => j % 5 !== f).map((i) => set[i]), crit); picks.push(`κ${b.k}/ν${b.v}`); }
        }
        const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
        console.log(`  5겹 [${crit === "mape" ? "MAPE" : "r"}] ${tally.slice(0, 3).map(([x, n]) => `${x} ${(n / picks.length * 100).toFixed(0)}%`).join(" · ")}`);
      }

      // 대조군 — 중심도만 매장끼리 섞는다. 기준선은 "중심도 없음(ν=0)에서 최선의 κ".
      for (const crit of ["mape", "r"] as const) {
        const gain = (s: Q[]) => { const a = pick(s, crit, KAP, [0]), b = pick(s, crit); return sc(s, crit, a.k, 0) - sc(s, crit, b.k, b.v); };
        const real = gain(set);
        const gs: number[] = [];
        for (let i = 0; i < 500; i++) { const pool = shuf(set.map((q) => q.ct)); gs.push(gain(set.map((q, j) => ({ ...q, ct: pool[j] })))); }
        gs.sort((a, b) => a - b);
        const pv = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
        const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
        console.log(`  대조군 [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gs))} · 95퍼센타일 ${f(gs[Math.floor(gs.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
      }
    };

    // 층수와 중심도가 서로 겹치면 "둘 다 넣었다"가 아니라 "같은 걸 두 번 넣었다"가 된다.
    const both = cmp.filter((r) => centFlo(r) != null && r.floorScore != null);
    console.log(`\n[겹침 점검] 층수자 점수 ↔ 중심도 r=${pear(both.map((r) => r.floorScore!), both.map((r) => Math.log(centFlo(r)!))).toFixed(3)} (n=${both.length})`);
    runGate("(가) 유동 300m/1km — 본 후보", centFlo);
    // 1km는 파이어스토어에 없다(⑪). 이미 있는 300m/500m이 관문도 통과하면 배관을 안 뚫어도 된다.
    runGate("(다) 유동 300m/500m — 파이어스토어에 있는 짝", (r) => {
      const sel3 = F[key(r)]?.radii?.["300"]?.selected, sel5 = F[key(r)]?.radii?.["500"]?.selected;
      if (!sel3?.length || !sel5?.length) return null;
      const i = mean(sel3.slice(-12)), o = mean(sel5.slice(-12));
      return o > 0 ? (i / o) * (500 / 300) ** 2 : null;
    });
    runGate("(나) 카카오 음식점 300m/1km — 출처 바꿔 재현되나", centKak);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("⑫ 접근성 κ를 켤까 끌까 — 수준(λ)을 풀고 다시 판정한다", () => {
    // ⑨에서 갈렸다: 중심도가 들어오면 **MAPE 기준은 κ=0**(LOO 97%), **r 기준은 κ=0.25~0.5**.
    // 사용자 방침(2026-09-17): "웹에서 슬라이드조정해서 맞춰보진않을거야 (...) 작업은 너한테시킬거임".
    // 화면에 떠넘길 게 아니라 여기서 결론을 내야 한다.
    //
    // 심증: **편향 때문이다.** 층수 항은 편향을 -5.5% -> -10.0%로 키운다(④). 중심도도 편향을
    // 키운다. 축척 A가 독점 3곳에 고정돼 있어서 둘이 겹치면 수준이 너무 내려가고, MAPE는
    // 편향을 포함하므로 손해가 난다. 경쟁 항 때도 같은 함정이 있었다(λ를 풀면 그림이 바뀐다).
    //
    // 그래서 **수준 λ를 자유로 풀고** 다시 본다. λ가 편향을 흡수한 뒤에도 κ가 남으면 켜고,
    // 그때도 0이면 끈다.
    const DENS = ".local-tools/kakao-place-density.json";
    if (!existsSync(DENS)) return;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    const floAvg = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const centFlo = (r: Row) => {
      const i = floAvg(r, 300), o = floAvg(r, 1000);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (1000 / 300) ** 2;
    };
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const fRef = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    const ok = cmp.filter((r) => centFlo(r) != null && r.floorScore != null);
    const cRef = med(ok.map((r) => centFlo(r)!));
    type Q = { base: number; fs: number; ct: number; obs: number };
    const set: Q[] = ok.map((r) => ({ base: qualShare(r), fs: r.floorScore!, ct: centFlo(r)!, obs: r.shareObs }));

    const KAP = [0, 0.25, 0.5, 0.75], NU = [0, 0.25, 0.5, 0.75], LAM = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
    const pred = (q: Q, l: number, k: number, v: number) => Math.min(1, l * q.base * Math.pow(q.fs / fRef, k) * Math.pow(q.ct / cRef, v));
    const mape = (s: Q[], l: number, k: number, v: number) => mean(s.map((q) => Math.abs(pred(q, l, k, v) / q.obs - 1)));
    const corr = (s: Q[], l: number, k: number, v: number) => pear(s.map((q) => pred(q, l, k, v)), s.map((q) => q.obs));
    const bias = (s: Q[], l: number, k: number, v: number) => mean(s.map((q) => pred(q, l, k, v) / q.obs - 1));
    const sc = (s: Q[], crit: "mape" | "r", l: number, k: number, v: number) => (crit === "mape" ? mape(s, l, k, v) : -corr(s, l, k, v));
    const pick = (s: Q[], crit: "mape" | "r", Ls: number[], Ks = KAP) => {
      let b = { l: Ls[0], k: Ks[0], v: NU[0], val: Infinity };
      for (const l of Ls) for (const k of Ks) for (const v of NU) { const x = sc(s, crit, l, k, v); if (x < b.val) b = { l, k, v, val: x }; }
      return b;
    };

    console.log(`\n══ 수준 λ 고정(=1) vs 자유 · n=${set.length} ══`);
    console.log(`${"설정".padEnd(26)}${"고른 값".padStart(20)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"r".padStart(8)}`);
    const show = (label: string, b: { l: number; k: number; v: number }) => {
      console.log(`${label.padEnd(26)}${`λ=${b.l}·κ=${b.k}·ν=${b.v}`.padStart(20)}${(bias(set, b.l, b.k, b.v) * 100).toFixed(1).padStart(8)}%${(mape(set, b.l, b.k, b.v) * 100).toFixed(2).padStart(7)}%${corr(set, b.l, b.k, b.v).toFixed(3).padStart(8)}`);
    };
    show("λ 고정 · MAPE 기준", pick(set, "mape", [1]));
    show("λ 고정 · r 기준", pick(set, "r", [1]));
    show("λ 자유 · MAPE 기준", pick(set, "mape", LAM));
    show("λ 자유 · r 기준", pick(set, "r", LAM));
    console.log(`  -> λ가 편향을 흡수한 뒤에도 κ가 남으면 켠다. 그때도 0이면 끈다.`);

    // ── 기준값을 제대로 잡으면 λ가 필요 없다 ──────────────────────────
    // λ를 푸는 건 자유계수를 하나 더 주는 것이라 비싸다(LOO 벌어짐 0.98 -> 6.45%p).
    // 그런데 λ가 한 일은 **수준 보정**뿐이고, 그건 기준값이 잘못 잡혀서 생긴 일이다.
    //
    // 곱셈 보정 (x/ref)^e는 표본 전체에서 **평균적으로 1배**여야 중립이다. 그러려면
    // ref가 x의 **기하평균**이어야 한다(로그 공간의 중심). 중앙값을 쓰면 분포가 한쪽으로
    // 꼬리를 끌 때 중립이 깨진다 — 중심도는 0.37~6.95로 오른쪽 꼬리가 길다.
    //
    // 기하평균은 **자유계수가 아니라 정규화**다. λ처럼 자료에 맞춰 고르는 값이 아니라,
    // "보정이 평균적으로 아무 일도 안 하게" 만드는 유일한 값이다.
    const geo = (a: number[]) => Math.exp(mean(a.map(Math.log)));
    const cGeo = geo(set.map((q) => q.ct)), fGeo = geo(set.map((q) => q.fs));
    const pred2 = (q: Q, k: number, v: number) => Math.min(1, q.base * Math.pow(q.fs / fGeo, k) * Math.pow(q.ct / cGeo, v));
    const mape2 = (s: Q[], k: number, v: number) => mean(s.map((q) => Math.abs(pred2(q, k, v) / q.obs - 1)));
    const corr2 = (s: Q[], k: number, v: number) => pear(s.map((q) => pred2(q, k, v)), s.map((q) => q.obs));
    const bias2 = (s: Q[], k: number, v: number) => mean(s.map((q) => pred2(q, k, v) / q.obs - 1));
    const pick2 = (s: Q[], crit: "mape" | "r") => {
      let b = { k: KAP[0], v: NU[0], val: Infinity };
      for (const k of KAP) for (const v of NU) { const x = crit === "mape" ? mape2(s, k, v) : -corr2(s, k, v); if (x < b.val) b = { k, v, val: x }; }
      return b;
    };
    console.log(`\n══ 기준값을 기하평균으로 (λ 없이) ══`);
    console.log(`  중심도 기준 ${cRef.toFixed(2)}(중앙) → ${cGeo.toFixed(2)}(기하평균) · 층수 기준 ${fRef}(중앙) → ${fGeo.toFixed(2)}(기하평균)`);
    console.log(`${"설정".padEnd(26)}${"고른 값".padStart(16)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"r".padStart(8)}`);
    for (const crit of ["mape", "r"] as const) {
      const b = pick2(set, crit);
      console.log(`${(crit === "mape" ? "MAPE 기준" : "r 기준").padEnd(26)}${`κ=${b.k}·ν=${b.v}`.padStart(16)}${(bias2(set, b.k, b.v) * 100).toFixed(1).padStart(8)}%${(mape2(set, b.k, b.v) * 100).toFixed(2).padStart(7)}%${corr2(set, b.k, b.v).toFixed(3).padStart(8)}`);
    }
    // κ만 켜고 끄며 직접 비교 — ν는 고정한다.
    console.log(`\n  [ν=0.25 고정] κ를 켜고 끄면`);
    console.log(`  ${"κ".padStart(6)}${"편향".padStart(9)}${"MAPE".padStart(8)}${"r".padStart(8)}`);
    for (const k of KAP) {
      console.log(`  ${String(k).padStart(6)}${(bias2(set, k, 0.25) * 100).toFixed(1).padStart(8)}%${(mape2(set, k, 0.25) * 100).toFixed(2).padStart(7)}%${corr2(set, k, 0.25).toFixed(3).padStart(8)}`);
    }
    console.log(`\n  [LOO · 기하평균 기준, λ 없이]`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: string[] = [];
      for (let i = 0; i < set.length; i++) {
        const b = pick2(set.filter((_, j) => j !== i), crit);
        picks.push(`κ${b.k}/ν${b.v}`);
        const ph = pred2(set[i], b.k, b.v);
        preds.push(ph); errs.push(Math.abs(ph / set[i].obs - 1));
      }
      const ins = pick2(set, crit);
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mape2(set, ins.k, ins.v) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}% (벌어짐 ${((mean(errs) - mape2(set, ins.k, ins.v)) * 100).toFixed(2)}%p) · LOO r=${pear(preds, set.map((q) => q.obs)).toFixed(3)} · ${tally.slice(0, 2).map(([x, n]) => `${x} ${Math.round(n / set.length * 100)}%`).join(" · ")}`);
    }

    // λ를 푼 상태에서 홀드아웃까지 본다 — λ도 자유계수라 공짜가 아니다.
    console.log(`\n[LOO · λ 자유]`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: string[] = [];
      for (let i = 0; i < set.length; i++) {
        const b = pick(set.filter((_, j) => j !== i), crit, LAM);
        picks.push(`κ${b.k}`);
        const ph = pred(set[i], b.l, b.k, b.v);
        preds.push(ph); errs.push(Math.abs(ph / set[i].obs - 1));
      }
      const ins = pick(set, crit, LAM);
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mape(set, ins.l, ins.k, ins.v) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}% (벌어짐 ${((mean(errs) - mape(set, ins.l, ins.k, ins.v)) * 100).toFixed(2)}%p) · LOO r=${pear(preds, set.map((q) => q.obs)).toFixed(3)}`);
      console.log(`      훈련이 고른 κ: ${tally.map(([x, n]) => `${x} ${Math.round(n / set.length * 100)}%`).join(" · ")}`);
    }
    expect(set.length).toBeGreaterThan(20);
  });

  it("⑪ 중심도를 어떤 반경 짝으로 만들까 — 1km는 Firestore에 없다", () => {
    // ⑨에서 고른 건 유동 300m/1km인데, **1km는 파이어스토어에 없다**(로컬 연구 파일에만 있다).
    // 실험실에 넣으려면 수집 경로를 새로 뚫어야 한다. 그 전에 **이미 있는 반경(100~500m)만으로
    // 대체 가능한지** 본다 — 되면 배관 작업이 통째로 없어진다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    const floAvg = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const fRef = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));
    const withFloor = (r: Row) => qualShare(r) * Math.pow((r.floorScore ?? fRef) / fRef, 0.25);
    const cent = (r: Row, i: number, o: number) => {
      const a = floAvg(r, i), b = floAvg(r, o);
      return a == null || b == null || !(b > 0) ? null : (a / b) * (o / i) ** 2;
    };
    const PAIRS: [number, number, boolean][] = [
      [100, 500, true], [100, 400, true], [200, 500, true], [300, 500, true], [100, 300, true],
      [300, 1000, false], [100, 1000, false], [200, 1000, false], [500, 1000, false],
    ];
    const sig = 2 / Math.sqrt(cmp.length);
    console.log(`\n안쪽/바깥 반경 짝별 · n=${cmp.length} · 유의선 ${sig.toFixed(3)}`);
    console.log(`${"짝".padEnd(16)}${"파이어스토어".padStart(12)}${"잔차와 r".padStart(11)}${"시점통제".padStart(10)}${"변동계수".padStart(10)}`);
    for (const [i, o, inFs] of PAIRS) {
      const ok2 = cmp.filter((r) => cent(r, i, o) != null);
      if (ok2.length < 20) continue;
      const x = ok2.map((r) => Math.log(cent(r, i, o)!));
      const y = ok2.map((r) => Math.log(r.shareObs / withFloor(r)));
      const v = ok2.map((r) => cent(r, i, o)!);
      const r1 = pear(x, y), r2 = partial(x, y, ok2.map((r) => r.t));
      console.log(`${`${i}m/${o}m`.padEnd(16)}${(inFs ? "있음" : "없음").padStart(12)}${(r1.toFixed(3) + (Math.abs(r1) > sig ? " *" : "  ")).padStart(11)}${(r2.toFixed(3) + (Math.abs(r2) > sig ? " *" : "  ")).padStart(10)}${(sd(v) / mean(v) * 100).toFixed(1).padStart(9)}%`);
    }
    console.log(`  -> "있음" 줄 중에 1km 짝만큼 나오는 게 있으면 수집 경로를 안 뚫어도 된다.`);
    expect(cmp.length).toBeGreaterThan(20);
  });

  it("⑩ 유동 방향(편심도) — 중심도와 겹치나, 따로 서나", () => {
    // 사용자 항목: "유동방향좋긴한데 이거 너가 자료넣어줄수있어?"
    //
    // 8방위로 300m 밀어낸 점에서 반경 300m 업소 수를 세고, 방위벡터로 합쳐 **편심도**를 만든다.
    //   편심도 0 = 사방이 고르다(상권 한가운데) · 1에 가까울수록 한쪽으로 쏠렸다(상권 끝)
    //
    // 중심도와 **재는 대상이 다르다**:
    //   중심도  — 우리 주변이 빽빽한가 (거리)
    //   편심도  — 상권이 우리 기준 어느 쪽에 쏠렸나 (방향)
    // 그런데 둘이 같은 걸 보고 있을 수도 있다. **겹침부터 확인한다.**
    const DIR = ".local-tools/kakao-directional.json";
    const DENS = ".local-tools/kakao-place-density.json";
    if (!existsSync(DIR) || !existsSync(DENS)) { console.log(`\n자료 없음. node scripts/collectKakaoDirectional.mjs 먼저.`); return; }
    const D = JSON.parse(readFileSync(DIR, "utf8")).sites as Record<string, any>;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    const floAvg = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const centFlo = (r: Row) => {
      const i = floAvg(r, 300), o = floAvg(r, 1000);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (1000 / 300) ** 2;
    };
    const ecc = (r: Row): number | null => {
      const v = D[key(r)]?.eccentricity;
      return v == null ? null : Number(v);
    };
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const fRef = med(rows.map((r) => r.floorScore).filter((v): v is number => v != null));

    const ok = cmp.filter((r) => ecc(r) != null && centFlo(r) != null && r.floorScore != null);
    const e = ok.map((r) => ecc(r)!), c = ok.map((r) => Math.log(centFlo(r)!)), f = ok.map((r) => r.floorScore!);
    const sig = 2 / Math.sqrt(ok.length);
    console.log(`\n[분포] n=${ok.length} · 편심도 중앙 ${med(e).toFixed(3)} · 범위 ${Math.min(...e).toFixed(3)}~${Math.max(...e).toFixed(3)} · 변동계수 ${(sd(e) / mean(e) * 100).toFixed(1)}%`);
    console.log(`[겹침 점검] 유의선 ${sig.toFixed(3)}`);
    console.log(`  편심도 ↔ 중심도   r=${pear(e, c).toFixed(3)}${Math.abs(pear(e, c)) > sig ? " *" : ""}   (겹치면 같은 걸 두 번 넣는 것이다)`);
    console.log(`  편심도 ↔ 층수자   r=${pear(e, f).toFixed(3)}${Math.abs(pear(e, f)) > sig ? " *" : ""}`);

    const cRef = med(ok.map((r) => centFlo(r)!));
    const resid = (r: Row, k: number, v: number) =>
      Math.log(r.shareObs / (qualShare(r) * Math.pow((r.floorScore ?? fRef) / fRef, k) * Math.pow(centFlo(r)! / cRef, v)));
    console.log(`\n[잔차와의 상관] 앞 항들을 반영한 뒤에도 편심도가 남는가`);
    for (const [label, k, v] of [["아무것도 없이", 0, 0], ["층수만 κ=0.25", 0.25, 0], ["중심도만 ν=0.25", 0, 0.25], ["둘 다", 0.25, 0.25]] as [string, number, number][]) {
      const y = ok.map((r) => resid(r, k, v));
      const r1 = pear(e, y), r2 = partial(e, y, ok.map((r) => r.t));
      console.log(`  ${label.padEnd(20)} r=${(r1.toFixed(3) + (Math.abs(r1) > sig ? " *" : "  ")).padStart(9)} 시점통제 ${(r2.toFixed(3) + (Math.abs(r2) > sig ? " *" : "")).padStart(8)}`);
    }
    console.log(`  ⚠️ 음수여야 말이 된다 — 편심도가 크면(상권 끝) 점유율이 낮아야 한다.`);

    // ── 관문 ─────────────────────────────────────────────────────────
    // 자유계수가 셋이 된다(κ·ν·ω). 표본 29곳에 셋이면 과적합이 쉽다 — 그래서 더 엄하게 본다.
    type Q = { base: number; fs: number; ct: number; ec: number; obs: number };
    const set: Q[] = ok.map((r) => ({ base: qualShare(r), fs: r.floorScore ?? fRef, ct: centFlo(r)!, ec: ecc(r)!, obs: r.shareObs }));
    const KAP = [0, 0.25, 0.5], NU = [0, 0.25, 0.5, 0.75], OM = [0, 0.5, 1, 2];
    // 편심도가 크면 불리하므로 (1-편심도)를 쓴다. 기준은 중앙값.
    const eRef = med(set.map((q) => 1 - q.ec));
    const pred = (q: Q, k: number, v: number, w: number) =>
      q.base * Math.pow(q.fs / fRef, k) * Math.pow(q.ct / cRef, v) * Math.pow((1 - q.ec) / eRef, w);
    const mape = (s: Q[], k: number, v: number, w: number) => mean(s.map((q) => Math.abs(pred(q, k, v, w) / q.obs - 1)));
    const corr = (s: Q[], k: number, v: number, w: number) => pear(s.map((q) => pred(q, k, v, w)), s.map((q) => q.obs));
    const sc = (s: Q[], crit: "mape" | "r", k: number, v: number, w: number) => (crit === "mape" ? mape(s, k, v, w) : -corr(s, k, v, w));
    const pick = (s: Q[], crit: "mape" | "r", Ws = OM) => {
      let b = { k: KAP[0], v: NU[0], w: Ws[0], val: Infinity };
      for (const k of KAP) for (const v of NU) for (const w of Ws) { const x = sc(s, crit, k, v, w); if (x < b.val) b = { k, v, w, val: x }; }
      return b;
    };
    const b0 = pick(set, "mape", [0]), b1 = pick(set, "mape");
    console.log(`\n══ 관문 (n=${set.length}, 자유계수 셋) ══`);
    console.log(`  표본 안: 편심도 없이 κ=${b0.k}·ν=${b0.v} → MAPE ${(mape(set, b0.k, b0.v, 0) * 100).toFixed(2)}% · r ${corr(set, b0.k, b0.v, 0).toFixed(3)}`);
    console.log(`          +편심도 κ=${b1.k}·ν=${b1.v}·ω=${b1.w} → MAPE ${(mape(set, b1.k, b1.v, b1.w) * 100).toFixed(2)}% · r ${corr(set, b1.k, b1.v, b1.w).toFixed(3)}`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: string[] = [];
      for (let i = 0; i < set.length; i++) {
        const b = pick(set.filter((_, j) => j !== i), crit);
        picks.push(`κ${b.k}/ν${b.v}/ω${b.w}`);
        const ph = pred(set[i], b.k, b.v, b.w);
        preds.push(ph); errs.push(Math.abs(ph / set[i].obs - 1));
      }
      const ins = pick(set, crit);
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  LOO [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mape(set, ins.k, ins.v, ins.w) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}% (벌어짐 ${((mean(errs) - mape(set, ins.k, ins.v, ins.w)) * 100).toFixed(2)}%p) · LOO r=${pear(preds, set.map((q) => q.obs)).toFixed(3)}`);
      console.log(`      고른 값: ${tally.slice(0, 3).map(([x, n]) => `${x} ${Math.round(n / set.length * 100)}%`).join(" · ")}`);
    }
    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuf = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };
    for (const crit of ["mape", "r"] as const) {
      const picks: string[] = [];
      for (let rep = 0; rep < 100; rep++) {
        const idx = shuf(set.map((_, i) => i));
        for (let ff = 0; ff < 5; ff++) { const b = pick(idx.filter((_, j) => j % 5 !== ff).map((i) => set[i]), crit); picks.push(`κ${b.k}/ν${b.v}/ω${b.w}`); }
      }
      const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  5겹 [${crit === "mape" ? "MAPE" : "r"}] ${tally.slice(0, 3).map(([x, n]) => `${x} ${(n / picks.length * 100).toFixed(0)}%`).join(" · ")}`);
    }
    for (const crit of ["mape", "r"] as const) {
      const gain = (s: Q[]) => { const a = pick(s, crit, [0]), b = pick(s, crit); return sc(s, crit, a.k, a.v, 0) - sc(s, crit, b.k, b.v, b.w); };
      const real = gain(set);
      const gs: number[] = [];
      for (let i = 0; i < 500; i++) { const pool = shuf(set.map((q) => q.ec)); gs.push(gain(set.map((q, j) => ({ ...q, ec: pool[j] })))); }
      gs.sort((a, b) => a - b);
      const pv = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
      const fm = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  대조군 [${crit === "mape" ? "MAPE" : "r"}] 실제 ${fm(real)} · 섞으면 중앙 ${fm(med(gs))} · 95퍼센타일 ${fm(gs[Math.floor(gs.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    expect(set.length).toBeGreaterThan(20);
  });

  // ── (14) 동선 방해·가시성 — 로드뷰 판정이 관문을 통과하나 (2026-09-17) ──────
  //
  // 사용자: "그래서 지금 동선방해 가시성 작업하면 되는겨?"
  //
  // 값은 2026-09-16에 로드뷰 자동 캡처 + AI 예/아니오 판정으로 52곳 중 49곳을 채웠다.
  // 계수가 0이라 지금은 계산에 안 들어간다. 여기서 켜 보고 관문에 건다.
  //
  // 자를 앞 항목들과 **똑같이** 쓴다 — 실측 점유율 대비, LOO · 5겹 · 무작위 대조군,
  // MAPE와 r 두 기준. 그래야 접근성 κ(p=0.046)·중심도 ν(p=0.002)와 견줄 수 있다.
  //
  // ⚠️ 기준선은 "입지 없음"이 아니라 **중심도·접근성을 이미 켠 상태**다. 그 둘이 이미
  //    이 신호를 먹고 있으면 여기서 아무것도 안 나와야 정상이다(유동 방향이 그랬다).
  //
  // ⚠️ 사람이 표본을 대조하기 전이다. 여기서 못 넘으면 대조하는 품을 안 들여도 된다.
  it("(14) 동선 방해·가시성 — 로드뷰 판정이 관문을 통과하나", () => {
    const RV = ".local-tools/roadview-judgments.json";
    if (!existsSync(RV)) { console.log("\n로드뷰 판정 자료가 없다."); return; }
    const raw = JSON.parse(readFileSync(RV, "utf8"));
    const BLOCK = ["block1", "block2", "block3", "block4"], VIS = ["vis1", "vis2", "vis3"];
    // 문항은 전부 "예=나쁨"이라 뒤집는다(writeRoadviewJudgmentsToFirestore.mjs와 같은 규칙).
    const judged = new Map<string, { fb: number; vi: number }>();
    for (const s of raw.sites as any[]) {
      if (!String(s.key).startsWith("existing_")) continue;
      judged.set(String(s.key).replace("existing_", ""), {
        fb: 5 - BLOCK.filter((k) => s[k] === true).length,
        vi: 4 - VIS.filter((k) => s[k] === true).length,
      });
    }

    const P = DEFAULT_TEXTBOOK_PARAMS;
    const key = (r: Row) => `existing:${r.store.storeCode}`;
    const floAvg = (r: Row, rad: number): number | null => {
      const sel = F[key(r)]?.radii?.[String(rad)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const centFlo = (r: Row) => {
      const i = floAvg(r, 300), o = floAvg(r, 1000);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (1000 / 300) ** 2;
    };
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };

    const ok = cmp.filter((r) =>
      judged.has(r.store.storeCode) && centFlo(r) != null && r.floorScore != null);
    if (ok.length < 15) { console.log(`\n표본이 ${ok.length}곳뿐이라 관문을 못 건다.`); return; }
    const sig = 2 / Math.sqrt(ok.length);

    console.log(`\n══ (14) 동선 방해·가시성 ══`);
    console.log(`경쟁상권 ${cmp.length}곳 중 판정 있는 곳 ${ok.length}곳 · 유의선 ${sig.toFixed(3)}`);

    // 1) 값이 실제로 몇 가지나 쓰이나 — (1)의 교훈. 값이 2~3개면 배점을 바꿔도 소용없다.
    for (const [label, get] of [["동선 방해", (r: Row) => judged.get(r.store.storeCode)!.fb],
      ["가시성", (r: Row) => judged.get(r.store.storeCode)!.vi]] as const) {
      const v = ok.map(get);
      const tally = [...new Set(v)].sort((a, b) => a - b).map((x) => `${x}점:${v.filter((y) => y === x).length}곳`).join(" ");
      const y = ok.map((r) => r.shareObs), t = ok.map((r) => r.t);
      const r1 = pear(v, y), r2 = partial(v, y, t);
      console.log(`  ${label.padEnd(8)} 쓰인값 ${new Set(v).size}가지 [${tally}]`);
      console.log(`  ${" ".padEnd(8)} 실측점유율 r=${r1.toFixed(3)}${Math.abs(r1) > sig ? "*" : " "} · 시점통제 ${r2.toFixed(3)}${Math.abs(r2) > sig ? "*" : " "}`);
    }

    // 1-b) 문항 하나하나가 뜻대로 재고 있나.
    //
    // 합산 점수의 부호가 뜻과 반대로 나왔다. 합쳐 놓으면 어느 문항이 범인인지 안 보이므로
    // 문항별로 실측 점유율과 대본다. **"예"가 나쁨이면 상관이 음수여야 정상이다.**
    // 양수로 나오는 문항은 나쁨을 재는 게 아니라 다른 것을 재고 있다.
    const Q: Record<string, string> = raw.questions ?? {};
    const siteByCode = new Map<string, any>();
    for (const s of raw.sites as any[]) {
      if (String(s.key).startsWith("existing_")) siteByCode.set(String(s.key).replace("existing_", ""), s);
    }
    console.log(`\n  [문항별] "예"가 나쁨이므로 **음(-)이 정상**이다. 양(+)이면 뜻대로 안 재는 것이다.`);
    for (const q of [...BLOCK, ...VIS]) {
      const sel = ok.filter((r) => typeof siteByCode.get(r.store.storeCode)?.[q] === "boolean");
      if (sel.length < 10) { console.log(`  ${q.padEnd(8)} 판정 ${sel.length}곳뿐 — 건너뜀 (선행조건 미충족)`); continue; }
      const yes = sel.map((r) => (siteByCode.get(r.store.storeCode)[q] === true ? 1 : 0));
      const nYes = yes.filter((v) => v === 1).length;
      if (nYes === 0 || nYes === sel.length) { console.log(`  ${q.padEnd(8)} 전부 같은 답(예 ${nYes}곳) — 변별 없음`); continue; }
      const rr = pear(yes, sel.map((r) => r.shareObs));
      const s2 = 2 / Math.sqrt(sel.length);
      console.log(`  ${q.padEnd(8)} 예 ${String(nYes).padStart(2)}곳/${sel.length}곳  실측점유율 r=${rr.toFixed(3)}`
        + `${Math.abs(rr) > s2 ? "*" : " "}  ${rr > 0 && Math.abs(rr) > s2 ? "<- ⚠️ 부호가 뒤집혔다" : ""}`);
      console.log(`  ${" ".padEnd(8)} "${Q[q] ?? ""}"`);
    }

    // 2) 중심도·접근성을 이미 켠 뒤의 **잔차**와 붙나 — 앞 항이 신호를 먹었는지 본다.
    const cRef = P.locationReferences.centrality, fRef = P.locationReferences.access;
    const baseOf = (r: Row) =>
      qualShare(r)
      * Math.pow(centFlo(r)! / cRef, P.locationExponents.centrality)
      * Math.pow(r.floorScore! / fRef, P.locationExponents.access);
    const resid = ok.map((r) => Math.log(r.shareObs / baseOf(r)));
    for (const [label, get] of [["동선 방해", (r: Row) => judged.get(r.store.storeCode)!.fb],
      ["가시성", (r: Row) => judged.get(r.store.storeCode)!.vi]] as const) {
      const rr = pear(ok.map(get), resid);
      console.log(`  ${label} ↔ (중심도·접근성 켠 뒤) 잔차   r=${rr.toFixed(3)}${Math.abs(rr) > sig ? "*  <- 남는 신호가 있다" : "   <- 앞 항이 이미 먹었다"}`);
    }

    // 3) 관문 — 접근성 κ·중심도 ν와 **같은 자**로 건다.
    const gm = (a: number[]) => Math.exp(mean(a.map(Math.log)));
    const fbRef = gm(ok.map((r) => judged.get(r.store.storeCode)!.fb));
    const viRef = gm(ok.map((r) => judged.get(r.store.storeCode)!.vi));
    console.log(`  기준값(기하평균) 동선 ${fbRef.toFixed(2)} · 가시성 ${viRef.toFixed(2)}`);

    type Pt = { base: number; fb: number; vi: number; obs: number };
    const pts: Pt[] = ok.map((r) => ({
      base: baseOf(r), fb: judged.get(r.store.storeCode)!.fb,
      vi: judged.get(r.store.storeCode)!.vi, obs: r.shareObs,
    }));
    // ⚠️ 음수 지수까지 훑는다. 동선 방해가 실측 점유율과 **음(-)의 상관**으로 나와서,
    //    양수만 훑으면 "최선이 0"이라는 잘못된 답이 나온다. 음수가 이기면 그건
    //    "방해가 적을수록 점유율이 낮다"는 뜻이라 **뜻이 뒤집힌 것**이고, 채택이 아니라
    //    교란을 의심해야 하는 신호다. 값은 재되 해석은 따로 한다.
    const EX = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5];
    const predE = (p: Pt, a: number, b: number) =>
      p.base * Math.pow(p.fb / fbRef, a) * Math.pow(p.vi / viRef, b);
    const mapeE = (s: Pt[], a: number, b: number) => mean(s.map((p) => Math.abs(predE(p, a, b) / p.obs - 1)));
    const corrE = (s: Pt[], a: number, b: number) => pear(s.map((p) => predE(p, a, b)), s.map((p) => p.obs));
    const pickE = (s: Pt[], crit: "mape" | "r") => {
      let best = { a: 0, b: 0, v: Infinity };
      for (const a of EX) for (const b of EX) {
        const v = crit === "mape" ? mapeE(s, a, b) : -corrE(s, a, b);
        if (v < best.v) best = { a, b, v };
      }
      return best;
    };

    console.log(`\n  [지수 훑기] 기준선 a=0·b=0 -> MAPE ${(mapeE(pts, 0, 0) * 100).toFixed(2)}% · r ${corrE(pts, 0, 0).toFixed(3)}`);
    for (const a of EX) {
      const line = EX.map((b) => `b=${b} ${(mapeE(pts, a, b) * 100).toFixed(1)}%/${corrE(pts, a, b).toFixed(2)}`).join("  ");
      console.log(`    a=${a}  ${line}`);
    }
    for (const crit of ["mape", "r"] as const) {
      const p = pickE(pts, crit);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"} 기준 최선] 동선 a=${p.a} · 가시성 b=${p.b}`
        + `  -> MAPE ${(mapeE(pts, p.a, p.b) * 100).toFixed(2)}% · r ${corrE(pts, p.a, p.b).toFixed(3)}`);
    }

    console.log(`\n  ══ LOO 홀드아웃 ══`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], pa: number[] = [], pb: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const best = pickE(pts.filter((_, j) => j !== i), crit);
        pa.push(best.a); pb.push(best.b);
        const ph = predE(pts[i], best.a, best.b);
        preds.push(ph); errs.push(Math.abs(ph / pts[i].obs - 1));
      }
      const ins = pickE(pts, crit);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mapeE(pts, ins.a, ins.b) * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}%`
        + ` · LOO r=${pear(preds, pts.map((p) => p.obs)).toFixed(3)}`
        + `  (기준선 LOO r=${corrE(pts, 0, 0).toFixed(3)})`);
      console.log(`     훈련이 고른 동선 a 중앙 ${med(pa)} · 가시성 b 중앙 ${med(pb)}`);
    }

    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuf = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n  ══ 무작위 대조군 500회 — 판정을 매장끼리 섞는다 ══`);
    for (const crit of ["mape", "r"] as const) {
      const sc = (s: Pt[], a: number, b: number) => (crit === "mape" ? mapeE(s, a, b) : -corrE(s, a, b));
      const gainOf = (s: Pt[]) => { const p = pickE(s, crit); return sc(s, 0, 0) - sc(s, p.a, p.b); };
      const real = gainOf(pts);
      const gs: number[] = [];
      for (let i = 0; i < 500; i++) {
        const fbP = shuf(pts.map((p) => p.fb)), viP = shuf(pts.map((p) => p.vi));
        gs.push(gainOf(pts.map((p, j) => ({ ...p, fb: fbP[j], vi: viP[j] }))));
      }
      gs.sort((a, b) => a - b);
      const pv = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
      const fm = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 실제 ${fm(real)} · 섞으면 중앙 ${fm(med(gs))}`
        + ` · 95퍼센타일 ${fm(gs[Math.floor(gs.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    console.log(`\n  ⚠️ 자유계수가 둘(a·b)이라 섞어도 이득이 난다. 대조군 중앙값이 0보다 크면`);
    console.log(`     그만큼은 계수를 푼 값이지 판정이 준 값이 아니다.`);
    expect(ok.length).toBeGreaterThan(14);
  });

  // ── (15) 동선 방해를 다시 만든다 — 상권 쪽 길목에 경쟁점이 있나 (2026-09-17) ──
  //
  // 사용자 설명:
  //   "역에서 상권으로 가는 길에 경쟁점이 하나 있으면 점유율 떨구고 뭐 이런 식.
  //    근데 이게 반대로 상권에서 역으로 가는 길은 우리가 가까운데 이거 어떤 개념으로
  //    할지는 잘 모르겠다. (...) 상권 중심에서 통행로에 경쟁점이 얼마나 걸쳐져 있는지
  //    이게 포괄적인 개념인데 구체화하기가 좀 어렵네 나도. 사실 이건 나도 잘 모르겠어
  //    **지도만 보면 뭐가 주통행로인지 모르니까.**"
  //
  // ── 주통행로를 몰라도 되는 이유 ──────────────────────────────────────────
  // 편심도를 뽑을 때 8방위로 업소 수를 세어 뒀다(kakao-directional.json). 그 벡터합이
  // **상권이 쏠린 방향**이고, 그게 곧 사람이 오는 방향이다. 주통행로를 따로 몰라도 된다.
  //
  //   1. 업소 수 8방위 벡터합 -> 상권 방향 θm
  //   2. 경쟁점마다 우리 기준 방위 θc (좌표 178/228 = 78%)
  //   3. 상권 쪽에 있는 경쟁점에만 무게 -> max(0, cos(θc - θm))
  //
  // 반대편 경쟁점은 cos이 음수라 자동으로 0이 된다. 사용자가 "어떤 개념으로 할지 모르겠다"고
  // 한 그 부분 — "상권에서 역으로 가는 길은 우리가 가깝다" — 이 식에서 저절로 나온다.
  //
  // ⚠️ **총량이 아니라 비중을 쓴다.** 경쟁 IP 총량은 경쟁 항(품질 모드)이 이미 다 쓰고
  //    있다. 여기서 새로운 정보는 "경쟁이 어느 **쪽**에 있나"뿐이다. 총량을 또 쓰면
  //    같은 걸 두 번 세는 것이고, 그건 이 저장소가 중심도에서 이미 겪은 실수다.
  it("(15) 동선 방해 재설계 — 상권 쪽 길목에 경쟁점이 있나", () => {
    const DIR = ".local-tools/kakao-directional.json";
    if (!existsSync(DIR)) { console.log("\n편심도 자료가 없다."); return; }
    const D = JSON.parse(readFileSync(DIR, "utf8")).sites as Record<string, any>;
    const DEG: Record<string, number> = { 북: 0, 북동: 45, 동: 90, 남동: 135, 남: 180, 남서: 225, 서: 270, 북서: 315 };
    const rad = (d: number) => (d * Math.PI) / 180;

    /** 8방위 업소 수의 벡터합 -> 상권이 쏠린 방향(도, 북=0 시계방향). 고르면 null. */
    const marketDir = (code: string): number | null => {
      const by = D[`existing:${code}`]?.byDir;
      if (!by) return null;
      let x = 0, y = 0;
      for (const [k, v] of Object.entries(by)) {
        const deg = DEG[k]; if (deg == null) continue;
        x += Number(v) * Math.sin(rad(deg)); y += Number(v) * Math.cos(rad(deg));
      }
      if (Math.hypot(x, y) < 1e-9) return null;
      return (Math.atan2(x, y) * 180) / Math.PI;
    };
    /** 우리 매장에서 경쟁점을 볼 때의 방위(도, 북=0 시계방향). */
    const bearing = (la1: number, lo1: number, la2: number, lo2: number) => {
      const p1 = rad(la1), p2 = rad(la2), dl = rad(lo2 - lo1);
      const y = Math.sin(dl) * Math.cos(p2);
      const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
      return (Math.atan2(y, x) * 180) / Math.PI;
    };
    const angDiff = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };

    type Blk = { r: Row; share: number; shareD: number; nCoord: number; nAll: number; md: number };
    const blks: Blk[] = [];
    for (const r of cmp) {
      const s = r.store;
      const md = marketDir(s.storeCode);
      if (md == null || s.lat == null || s.lng == null) continue;
      const raw = (compsBy.get(s.storeCode) ?? []).filter((c: any) =>
        c.investigationStatus !== "경쟁점없음" && Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
      const withXY = raw.filter((c: any) => c.lat != null && c.lng != null);
      if (!raw.length || withXY.length < Math.max(2, raw.length * 0.5)) continue;
      let num = 0, den = 0, numD = 0, denD = 0;
      for (const c of withXY) {
        const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
        const w = Math.max(0, Math.cos(rad(angDiff(bearing(s.lat, s.lng, c.lat, c.lng), md))));
        const dw = Math.exp(-(rivalDistanceM(s, c) ?? 0) / 300);
        num += ip * w; den += ip;
        numD += ip * w * dw; denD += ip * dw;
      }
      if (!(den > 0) || !(denD > 0)) continue;
      blks.push({ r, share: num / den, shareD: numD / denD, nCoord: withXY.length, nAll: raw.length, md });
    }

    console.log(`\n══ (15) 동선 방해 재설계 — 상권 쪽 길목의 경쟁 비중 ══`);
    console.log(`경쟁상권 ${cmp.length}곳 중 계산 가능 ${blks.length}곳 (좌표가 절반 넘는 곳만)`);
    if (blks.length < 15) { console.log("표본이 모자라 관문을 못 건다."); expect(blks.length).toBeGreaterThanOrEqual(0); return; }
    const sig = 2 / Math.sqrt(blks.length);
    const sh = blks.map((b) => b.share), shD = blks.map((b) => b.shareD);
    const obs = blks.map((b) => b.r.shareObs), tt = blks.map((b) => b.r.t);
    console.log(`  상권쪽 경쟁 비중  범위 ${Math.min(...sh).toFixed(2)}~${Math.max(...sh).toFixed(2)} · 중앙 ${med(sh).toFixed(2)} · 표준편차 ${sd(sh).toFixed(3)}`);
    console.log(`  (거리가중판)      범위 ${Math.min(...shD).toFixed(2)}~${Math.max(...shD).toFixed(2)} · 중앙 ${med(shD).toFixed(2)} · 표준편차 ${sd(shD).toFixed(3)}`);
    console.log(`  유의선 ${sig.toFixed(3)}`);
    console.log(`  상권쪽 비중   ↔ 실측점유율 r=${pear(sh, obs).toFixed(3)}${Math.abs(pear(sh, obs)) > sig ? "*" : " "} · 시점통제 ${partial(sh, obs, tt).toFixed(3)}`);
    console.log(`  거리가중판    ↔ 실측점유율 r=${pear(shD, obs).toFixed(3)}${Math.abs(pear(shD, obs)) > sig ? "*" : " "} · 시점통제 ${partial(shD, obs, tt).toFixed(3)}`);
    console.log(`  -> 막혀 있을수록 점유율이 낮아야 하므로 **음(-)이 정상**이다.`);

    // ── 정의를 좁힌 변형 ───────────────────────────────────────────────────
    // cos 가중은 넓다 — 옆쪽(90도) 경쟁점도 조금 센다. 사용자가 말한 "길목에 걸쳐져 있는"은
    // 더 좁은 통로다. 좁혀도 안 나오면 검정력이 아니라 개념 문제다.
    //
    // ⚠️ 변형을 여럿 재면 우연히 하나가 유의해질 확률이 올라간다. 아래 셋은 **같은 개념을
    //    좁힌 것**이지 다른 가설이 아니고, 하나가 유의해도 그것만 떼어 채택하지 않는다.
    const variants: { label: string; f: (b: Blk) => number | null }[] = [
      {
        label: "45도 이내만 (좁은 길목)",
        f: (b) => {
          const s = b.r.store;
          const list = (compsBy.get(s.storeCode) ?? []).filter((c: any) =>
            c.investigationStatus !== "경쟁점없음" && c.lat != null && c.lng != null
            && Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
          if (!list.length) return null;
          let num = 0, den = 0;
          for (const c of list) {
            const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
            const inside = angDiff(bearing(s.lat, s.lng, c.lat, c.lng), b.md) <= 45 ? 1 : 0;
            num += ip * inside; den += ip;
          }
          return den > 0 ? num / den : null;
        },
      },
      {
        label: "45도 이내 경쟁 IP 총량",
        f: (b) => {
          const s = b.r.store;
          const list = (compsBy.get(s.storeCode) ?? []).filter((c: any) =>
            c.investigationStatus !== "경쟁점없음" && c.lat != null && c.lng != null
            && Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
          let n = 0;
          for (const c of list) {
            if (angDiff(bearing(s.lat, s.lng, c.lat, c.lng), b.md) > 45) continue;
            n += Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
          }
          return n;
        },
      },
      {
        label: "가장 가까운 경쟁점이 상권 쪽인가",
        f: (b) => {
          const s = b.r.store;
          const list = (compsBy.get(s.storeCode) ?? []).filter((c: any) =>
            c.investigationStatus !== "경쟁점없음" && c.lat != null && c.lng != null
            && Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
          if (!list.length) return null;
          const near = [...list].sort((a: any, c: any) => Number(a.distanceM ?? 9e9) - Number(c.distanceM ?? 9e9))[0];
          return Math.max(0, Math.cos(rad(angDiff(bearing(s.lat, s.lng, near.lat, near.lng), b.md))));
        },
      },
    ];
    console.log(`  ── 정의를 좁힌 변형 (같은 개념, 더 좁은 통로) ──`);
    for (const v of variants) {
      const pairs = blks.map((b) => ({ x: v.f(b), y: b.r.shareObs, t: b.r.t }))
        .filter((p): p is { x: number; y: number; t: number } => p.x != null && Number.isFinite(p.x));
      if (pairs.length < 10 || new Set(pairs.map((p) => p.x)).size < 3) {
        console.log(`  ${v.label.padEnd(26)} 변별 없음 (쓰인값 ${new Set(pairs.map((p) => p.x)).size}가지)`);
        continue;
      }
      const s2 = 2 / Math.sqrt(pairs.length);
      const r1 = pear(pairs.map((p) => p.x), pairs.map((p) => p.y));
      const r2 = partial(pairs.map((p) => p.x), pairs.map((p) => p.y), pairs.map((p) => p.t));
      console.log(`  ${v.label.padEnd(26)} n=${pairs.length} r=${r1.toFixed(3)}${Math.abs(r1) > s2 ? "*" : " "}`
        + ` · 시점통제 ${r2.toFixed(3)}${Math.abs(r2) > s2 ? "*" : " "} (유의선 ${s2.toFixed(3)})`);
    }

    // 이미 쓰는 항들과 겹치나 — 겹치면 새 정보가 아니다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const floAvg = (r: Row, rr: number): number | null => {
      const sel = F[`existing:${r.store.storeCode}`]?.radii?.[String(rr)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const centFlo = (r: Row) => {
      const i = floAvg(r, 300), o = floAvg(r, 1000);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (1000 / 300) ** 2;
    };
    const eccOf = (r: Row) => { const v = D[`existing:${r.store.storeCode}`]?.eccentricity; return v == null ? null : Number(v); };
    const useC = blks.filter((b) => centFlo(b.r) != null && eccOf(b.r) != null);
    if (useC.length >= 10) {
      // 실측 점유율이 1을 넘는 매장은 **물리적으로 불가능한 값**이다 — 수요식이 그 동네
    // 수요를 적게 잡은 것이라, 그 오차가 shareObs에 통째로 들어 있다. 상관을 흐리므로
    // 빼고 다시 본다(값을 고른 게 아니라 못 쓰는 값을 뺀 것이다).
    {
      const clean = blks.filter((b) => b.r.shareObs <= 1);
      if (clean.length >= 10) {
        const s3 = 2 / Math.sqrt(clean.length);
        const r1 = pear(clean.map((b) => b.share), clean.map((b) => b.r.shareObs));
        const r2 = pear(clean.map((b) => b.shareD), clean.map((b) => b.r.shareObs));
        console.log(`  [점유율 100% 초과 ${blks.length - clean.length}곳 제외 · n=${clean.length} · 유의선 ${s3.toFixed(3)}]`
          + ` 상권쪽 비중 r=${r1.toFixed(3)}${Math.abs(r1) > s3 ? "*" : " "} · 거리가중 r=${r2.toFixed(3)}${Math.abs(r2) > s3 ? "*" : " "}`);
      }
    }
    console.log(`  겹침 — 중심도와 r=${pear(useC.map((b) => b.share), useC.map((b) => Math.log(centFlo(b.r)!))).toFixed(3)}`
        + ` · 편심도와 r=${pear(useC.map((b) => b.share), useC.map((b) => eccOf(b.r)!)).toFixed(3)}`
        + ` · 경쟁점수와 r=${pear(useC.map((b) => b.share), useC.map((b) => b.nAll)).toFixed(3)}`);
    }

    // 관문 — 접근성 κ·중심도 ν와 같은 자.
    const gate = blks.filter((b) => centFlo(b.r) != null && b.r.floorScore != null);
    if (gate.length < 15) { console.log("  관문용 표본 부족."); expect(blks.length).toBeGreaterThan(0); return; }
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const cRef = P.locationReferences.centrality, fRef = P.locationReferences.access;
    const baseOf = (r: Row) => qualShare(r)
      * Math.pow(centFlo(r)! / cRef, P.locationExponents.centrality)
      * Math.pow(r.floorScore! / fRef, P.locationExponents.access);

    // 뚫린 정도 — 클수록 좋다. 0이 되지 않게 바닥을 둔다.
    const openOf = (b: Blk) => Math.max(0.05, 1 - b.share);
    const gm = (a: number[]) => Math.exp(mean(a.map(Math.log)));
    const oRef = gm(gate.map(openOf));
    type Pt = { base: number; open: number; obs: number };
    const pts: Pt[] = gate.map((b) => ({ base: baseOf(b.r), open: openOf(b), obs: b.r.shareObs }));
    const EXP = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
    const predX = (p: Pt, k: number) => p.base * Math.pow(p.open / oRef, k);
    const mapeX = (s: Pt[], k: number) => mean(s.map((p) => Math.abs(predX(p, k) / p.obs - 1)));
    const corrX = (s: Pt[], k: number) => pear(s.map((p) => predX(p, k)), s.map((p) => p.obs));
    const pickX = (s: Pt[], crit: "mape" | "r") => {
      let best = { k: EXP[0], v: Infinity };
      for (const k of EXP) { const v = crit === "mape" ? mapeX(s, k) : -corrX(s, k); if (v < best.v) best = { k, v }; }
      return best;
    };
    console.log(`\n  [지수 훑기] 표본 ${gate.length}곳 · 기준값(기하평균) ${oRef.toFixed(3)}`);
    for (const k of EXP) console.log(`    ψ=${String(k).padEnd(4)} MAPE ${(mapeX(pts, k) * 100).toFixed(2)}% · r ${corrX(pts, k).toFixed(3)}`);

    console.log(`\n  ══ LOO 홀드아웃 ══`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const b = pickX(pts.filter((_, j) => j !== i), crit);
        picks.push(b.k);
        const ph = predX(pts[i], b.k);
        preds.push(ph); errs.push(Math.abs(ph / pts[i].obs - 1));
      }
      const ins = pickX(pts, crit);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ${(mapeX(pts, ins.k) * 100).toFixed(2)}% (ψ=${ins.k}) → LOO ${(mean(errs) * 100).toFixed(2)}%`
        + ` · LOO r=${pear(preds, pts.map((p) => p.obs)).toFixed(3)}  (기준선 ψ=0: MAPE ${(mapeX(pts, 0) * 100).toFixed(2)}% · r ${corrX(pts, 0).toFixed(3)})`);
      console.log(`     훈련이 고른 ψ 중앙 ${med(picks)}`);
    }

    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuf = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };
    console.log(`\n  ══ 무작위 대조군 500회 — 상권쪽 비중을 매장끼리 섞는다 ══`);
    for (const crit of ["mape", "r"] as const) {
      const sc = (s: Pt[], k: number) => (crit === "mape" ? mapeX(s, k) : -corrX(s, k));
      const gainOf = (s: Pt[]) => sc(s, 0) - sc(s, pickX(s, crit).k);
      const real = gainOf(pts);
      const gs: number[] = [];
      for (let i = 0; i < 500; i++) {
        const pool = shuf(pts.map((p) => p.open));
        gs.push(gainOf(pts.map((p, j) => ({ ...p, open: pool[j] }))));
      }
      gs.sort((a, b) => a - b);
      const pv = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
      const fm = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 실제 ${fm(real)} · 섞으면 중앙 ${fm(med(gs))}`
        + ` · 95퍼센타일 ${fm(gs[Math.floor(gs.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }

    console.log(`\n  매장별 (상권쪽 비중 높은 순 = 많이 막힌 순)`);
    console.log(`  매장            상권방향  경쟁점(좌표/전체)  상권쪽비중  실측점유율`);
    for (const b of [...blks].sort((x, y) => y.share - x.share)) {
      const dirName = Object.entries(DEG).sort((a, c) =>
        angDiff(a[1], b.md) - angDiff(c[1], b.md))[0][0];
      console.log(`  ${b.r.n.slice(0, 12).padEnd(14)}${dirName.padStart(6)}${(b.nCoord + "/" + b.nAll).padStart(14)}`
        + `${b.share.toFixed(2).padStart(12)}${(b.r.shareObs * 100).toFixed(1).padStart(11)}%`);
    }
    expect(blks.length).toBeGreaterThan(10);
  });

  // ── (16) 가시성 재설계 — 올려보는 각도 (2026-09-17) ────────────────────────
  //
  // 사용자 설명:
  //   "가시성이라 함은 점포의 주통행로에서 우리 매장 간판이 잘 보이냐 이거거든. 예를 들어
  //    **통행로가 좁은데 높으면 고개를 완전 올려야 보일 거 아냐.** 멀리에서 보인다든가
  //    이런 단점들이 있고, **통행로가 좀 넓으면 3-4층 정도는 커버 가능한 정도**일 거고"
  //
  // 이건 예/아니오가 아니라 **각도**다.
  //
  //   올려보는 각도 = arctan( 간판 높이 ÷ 보는 거리 )
  //                            ↑ 층수        ↑ 도로 폭
  //
  // 지표는 0~1로 둔다:  보임 = 도로폭 ÷ (도로폭 + 높이)
  //   1층이면 1.0(눈높이) · 좁은 길 4층이면 0.46 · 넓은 길 4층이면 0.66
  //
  // ⚠️ **도로 폭이 있어야만 새 정보다.** 층수는 접근성 κ가 이미 쓰고 있다. 층수만 다시
  //    쓰면 같은 걸 두 번 세는 것이다. 그래서 "접근성을 켠 뒤의 잔차에 붙나"가 핵심이다.
  //
  // ⚠️ 지금은 도로 폭을 **거칠게** 쓴다. 로드뷰 캡처가 스크래치패드에 있어 지워졌고,
  //    남은 건 block1("왕복 4차선 이상인가") 예/아니오뿐이다. 넓음 20m · 좁음 9m로 둔다.
  //    여기서 신호가 보이면 캡처를 다시 찍어 **차선 수를 숫자로** 읽는다(예/아니오 대신).
  it("(16) 가시성 재설계 — 올려보는 각도 (층수 x 도로폭)", () => {
    const RV = ".local-tools/roadview-judgments.json";
    if (!existsSync(RV)) { console.log("\n로드뷰 판정 자료가 없다."); return; }
    const raw = JSON.parse(readFileSync(RV, "utf8"));
    const wideBy = new Map<string, boolean>();
    for (const s of raw.sites as any[]) {
      if (!String(s.key).startsWith("existing_")) continue;
      if (typeof s.block1 === "boolean") wideBy.set(String(s.key).replace("existing_", ""), s.block1);
    }

    const FLOOR_H = 3.5, WIDE_M = 20, NARROW_M = 9;
    /** 간판 높이(m). 지상 N층이면 (N-1)x3.5, 1층·지하는 0(눈높이). */
    const signHeight = (st: any): number | null => {
      const f = Number(st.floor);
      if (!Number.isFinite(f)) return null;
      if (st.groundLevel === "지하") return 0;
      return Math.max(0, (f - 1) * FLOOR_H);
    };
    const roadW = (code: string): number | null => {
      const w = wideBy.get(code);
      return w == null ? null : (w ? WIDE_M : NARROW_M);
    };

    type V = { r: Row; h: number; w: number; see: number };
    const vs: V[] = [];
    for (const r of cmp) {
      const h = signHeight(r.store), w = roadW(r.store.storeCode);
      if (h == null || w == null) continue;
      vs.push({ r, h, w, see: w / (w + h) });
    }
    console.log(`\n══ (16) 가시성 재설계 — 올려보는 각도 ══`);
    console.log(`경쟁상권 ${cmp.length}곳 중 계산 가능 ${vs.length}곳`);
    if (vs.length < 15) { console.log("표본 부족."); expect(vs.length).toBeGreaterThanOrEqual(0); return; }
    const sig = 2 / Math.sqrt(vs.length);
    const see = vs.map((v) => v.see), obs = vs.map((v) => v.r.shareObs), tt = vs.map((v) => v.r.t);
    const tally = [...new Set(see.map((x) => x.toFixed(2)))].sort()
      .map((k) => `${k}:${see.filter((x) => x.toFixed(2) === k).length}곳`).join(" ");
    console.log(`  보임값 ${new Set(see.map((x) => x.toFixed(2))).size}가지 [${tally}]`);
    console.log(`  넓은 길 ${vs.filter((v) => v.w === WIDE_M).length}곳 · 좁은 길 ${vs.filter((v) => v.w === NARROW_M).length}곳`);
    console.log(`  유의선 ${sig.toFixed(3)}`);
    const rSee = pear(see, obs);
    console.log(`  보임 ↔ 실측점유율  r=${rSee.toFixed(3)}${Math.abs(rSee) > sig ? "*" : " "} · 시점통제 ${partial(see, obs, tt).toFixed(3)}`);
    console.log(`  -> 잘 보일수록 점유율이 높아야 하므로 **양(+)이 정상**이다.`);

    // 층수만 쓴 값(접근성이 이미 쓰는 것)과 얼마나 다른가 — 겹치면 새 정보가 아니다.
    const fsOk = vs.filter((v) => v.r.floorScore != null);
    if (fsOk.length >= 10) {
      console.log(`  겹침 — 접근성(층수자 점수)와 r=${pear(fsOk.map((v) => v.see), fsOk.map((v) => v.r.floorScore!)).toFixed(3)}`
        + ` · 층수 자체와 r=${pear(fsOk.map((v) => v.see), fsOk.map((v) => Number(v.r.store.floor))).toFixed(3)}`);
    }

    // ⭐ 핵심 — 접근성 κ를 켠 뒤의 **잔차**에 붙나. 도로폭이 진짜 정보면 여기 남아야 한다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const floAvg = (r: Row, rr: number): number | null => {
      const sel = F[`existing:${r.store.storeCode}`]?.radii?.[String(rr)]?.selected;
      return sel?.length ? mean(sel.slice(-12)) : null;
    };
    const centFlo = (r: Row) => {
      const i = floAvg(r, 300), o = floAvg(r, 1000);
      return i == null || o == null || !(o > 0) ? null : (i / o) * (1000 / 300) ** 2;
    };
    const qualShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const cRef = P.locationReferences.centrality, fRef = P.locationReferences.access;
    const gate = vs.filter((v) => centFlo(v.r) != null && v.r.floorScore != null);
    if (gate.length < 15) { console.log("  관문용 표본 부족."); expect(vs.length).toBeGreaterThan(0); return; }
    const baseOf = (r: Row) => qualShare(r)
      * Math.pow(centFlo(r)! / cRef, P.locationExponents.centrality)
      * Math.pow(r.floorScore! / fRef, P.locationExponents.access);
    const resid = gate.map((v) => Math.log(v.r.shareObs / baseOf(v.r)));
    const rRes = pear(gate.map((v) => v.see), resid);
    const sg = 2 / Math.sqrt(gate.length);
    console.log(`  ⭐ 중심도·접근성 켠 뒤 잔차 ↔ 보임  r=${rRes.toFixed(3)}${Math.abs(rRes) > sg ? "*  <- 도로폭이 새 정보다" : "   <- 남는 신호 없음"}  (n=${gate.length} 유의선 ${sg.toFixed(3)})`);

    // ⚠️ 넓은 길 = 왕복 4차선 이상 = **번화가 표식**일 수 있다. block1이 부호가 뒤집혔던
    //    이유가 그것이었다((14) 참고). 그렇다면 "넓은 길 매장이 점유율이 높다"는 건 도로폭
    //    때문이 아니라 중심가라서다. 중심도와 얼마나 엮였는지 직접 본다.
    {
      const wc = gate.filter((v) => centFlo(v.r) != null);
      if (wc.length >= 10) {
        const wide = wc.map((v) => (v.w === WIDE_M ? 1 : 0));
        const rc = pear(wide, wc.map((v) => Math.log(centFlo(v.r)!)));
        const rf = pear(wide, wc.map((v) => Number(v.r.store.floor)));
        console.log(`\n  ⚠️ 도로폭(넓음=1) ↔ 중심도 r=${rc.toFixed(3)}${Math.abs(rc) > sg ? "*  <- 넓은 길은 번화가 표식이다" : ""}`
          + ` · ↔ 층수 r=${rf.toFixed(3)}`);
        // 중심도까지 통제한 편상관 — 번화가 효과를 걷어내도 도로폭이 남나.
        const pr = partial(wide, gate.map((v) => Math.log(v.r.shareObs)), wc.map((v) => Math.log(centFlo(v.r)!)));
        console.log(`     중심도를 통제한 도로폭 ↔ 점유율  편상관 ${pr.toFixed(3)}`
          + (Math.abs(pr) > sg ? "*  <- 도로폭이 따로 일한다" : "   <- 번화가 효과였다"));
      }
    }

    // ⭐ 지표를 잘못 합쳤다 — 층수와 도로폭을 하나로 묶으니(보임 = 폭/(폭+높이)) 층수가
    //    다 먹는다(보임 ↔ 층수 r=-0.918). 접근성 κ가 이미 층수를 쓰므로 잔차에서 그 부분이
    //    빠지고 도로폭은 희석된다. **도로폭을 따로 떼어 재야 한다.**
    {
      const wideOnly = gate.map((v) => (v.w === WIDE_M ? 1 : 0));
      const rW = pear(wideOnly, resid);
      console.log(`\n  ⭐ 중심도·접근성 켠 뒤 잔차 ↔ **도로폭만**  r=${rW.toFixed(3)}`
        + (Math.abs(rW) > sg ? "*  <- 도로폭은 새 정보다" : "   <- 남는 신호 없음")
        + `  (n=${gate.length} 유의선 ${sg.toFixed(3)})`);
      const wideR = gate.filter((v) => v.w === WIDE_M).map((_, i) => resid[gate.findIndex((g) => g === gate.filter((x) => x.w === WIDE_M)[i])]);
      const narrowIdx = gate.map((v, i) => (v.w === NARROW_M ? i : -1)).filter((i) => i >= 0);
      const wideIdx = gate.map((v, i) => (v.w === WIDE_M ? i : -1)).filter((i) => i >= 0);
      if (wideIdx.length && narrowIdx.length) {
        const mw = mean(wideIdx.map((i) => resid[i])), mn = mean(narrowIdx.map((i) => resid[i]));
        console.log(`     잔차 평균 — 넓은 길 ${mw.toFixed(3)} (${wideIdx.length}곳) vs 좁은 길 ${mn.toFixed(3)} (${narrowIdx.length}곳)`);
        console.log(`     -> 넓은 길이 산식보다 ${(Math.exp(mw - mn) * 100 - 100).toFixed(0)}% 더 먹는다`);
      }
      void wideR;
    }

    // 도로폭이 진짜 일하는지 직접 가른다 — 같은 층수끼리 넓은 길/좁은 길을 비교한다.
    console.log(`\n  [같은 층수끼리 도로폭만 다를 때]`);
    console.log(`  층수   넓은길 곳수·평균점유율    좁은길 곳수·평균점유율`);
    for (const fl of [2, 3, 4]) {
      const g1 = vs.filter((v) => Number(v.r.store.floor) === fl && v.w === WIDE_M);
      const g2 = vs.filter((v) => Number(v.r.store.floor) === fl && v.w === NARROW_M);
      if (!g1.length && !g2.length) continue;
      const f = (g: V[]) => (g.length ? `${String(g.length).padStart(2)}곳 ${(mean(g.map((v) => v.r.shareObs)) * 100).toFixed(1)}%` : " 0곳     -");
      console.log(`  ${fl}층 ${f(g1).padStart(22)}${f(g2).padStart(24)}`);
    }

    // 관문
    const gmv = Math.exp(mean(gate.map((v) => Math.log(v.see))));
    type Pt = { base: number; see: number; obs: number };
    const pts: Pt[] = gate.map((v) => ({ base: baseOf(v.r), see: v.see, obs: v.r.shareObs }));
    const EXP = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
    const predV = (p: Pt, k: number) => p.base * Math.pow(p.see / gmv, k);
    const mapeV = (s: Pt[], k: number) => mean(s.map((p) => Math.abs(predV(p, k) / p.obs - 1)));
    const corrV = (s: Pt[], k: number) => pear(s.map((p) => predV(p, k)), s.map((p) => p.obs));
    const pickV = (s: Pt[], crit: "mape" | "r") => {
      let best = { k: EXP[0], v: Infinity };
      for (const k of EXP) { const v = crit === "mape" ? mapeV(s, k) : -corrV(s, k); if (v < best.v) best = { k, v }; }
      return best;
    };
    console.log(`\n  [지수 훑기] 기준값(기하평균) ${gmv.toFixed(3)}`);
    for (const k of EXP) console.log(`    지수=${String(k).padEnd(4)} MAPE ${(mapeV(pts, k) * 100).toFixed(2)}% · r ${corrV(pts, k).toFixed(3)}`);

    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuf = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };
    console.log(`\n  ══ LOO · 무작위 대조군 500회 ══`);
    for (const crit of ["mape", "r"] as const) {
      const errs: number[] = [], preds: number[] = [], picks: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const b = pickV(pts.filter((_, j) => j !== i), crit);
        picks.push(b.k);
        const ph = predV(pts[i], b.k);
        preds.push(ph); errs.push(Math.abs(ph / pts[i].obs - 1));
      }
      const ins = pickV(pts, crit);
      const sc = (s: Pt[], k: number) => (crit === "mape" ? mapeV(s, k) : -corrV(s, k));
      const gainOf = (s: Pt[]) => sc(s, 0) - sc(s, pickV(s, crit).k);
      const real = gainOf(pts);
      const gs: number[] = [];
      for (let i = 0; i < 500; i++) {
        const pool = shuf(pts.map((p) => p.see));
        gs.push(gainOf(pts.map((p, j) => ({ ...p, see: pool[j] }))));
      }
      gs.sort((a, b) => a - b);
      const pv = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
      const fm = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 지수=${ins.k} → LOO ${(mean(errs) * 100).toFixed(2)}% · LOO r=${pear(preds, pts.map((p) => p.obs)).toFixed(3)}`
        + ` (기준선 MAPE ${(mapeV(pts, 0) * 100).toFixed(2)}% · r ${corrV(pts, 0).toFixed(3)})`);
      console.log(`       대조군 실제 ${fm(real)} · 섞으면 중앙 ${fm(med(gs))} · 95퍼센타일 ${fm(gs[Math.floor(gs.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    expect(vs.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  // (17) 상권 분리(길건너) — 2026-09-18 눈가림 판정
  //
  // 사용자가 153쌍을 카카오 지도로 보고 `같은편`/`길건너`로 판정했다. **성적을 보기 전에**
  // 했고(페이지에 잔차·매출이 한 글자도 없다), 자동 판정은 OSM 도로 자료로 따로 돌려
  // 봉인해 뒀다가 사람 판정이 끝난 뒤 열었다. 자료원이 갈려 있어야 "둘이 맞다"가 뜻을 갖는다.
  //
  // 판정 기준은 사용자 말 그대로다:
  //   *"거리가 좀 멀어도 두 매장 모두 해당 상권의 가장자리쪽에 있어서 거리가 멀다면 같은편"*
  //   *"거리가 비교적 가까워도 대로변 껴있고 통행이 불편하면 길건너"*
  // 즉 **거리가 아니라 같은 상권이냐**로 경쟁을 세자는 제안이다. 지금 산식은 `거리 ≤ 300m`
  // 계단 하나뿐이고, 그 계단이 오송점에서 342.5m -> 1m 차이로 예측을 31.7% 뒤집었다.
  // ────────────────────────────────────────────────────────────────────────
  it("(17) 상권 분리 — 사람 판정이 관문을 통과하나", () => {
    const FILLED = ".local-tools/market-split-judgment-filled.csv";
    const OSM = ".local-tools/market-split-osm.json";
    if (!existsSync(FILLED)) { console.log("\n사람 판정 CSV가 없다. scripts/mergeMarketSplitJudgment.mjs 먼저."); return; }

    const parseCsv = (text: string) => {
      const out: string[][] = []; let row: string[] = [], f = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true;
        else if (c === ",") { row.push(f); f = ""; }
        else if (c === "\n") { row.push(f); out.push(row); row = []; f = ""; }
        else if (c !== "\r") f += c;
      }
      if (f.length || row.length) { row.push(f); out.push(row); }
      return out.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
    };

    const csv = parseCsv(readFileSync(FILLED, "utf8").replace(/^﻿/, ""));
    if ((csv[0][0] ?? "").startsWith("#")) csv.shift();
    const head = csv.shift() as string[];
    const ci = (n: string) => head.indexOf(n);
    const kk = (a: string, b: string) => `${a}|||${b}`;

    /** 사람 판정 — 길건너 true / 같은편 false / 모르겠음은 넣지 않는다(결측). */
    const human = new Map<string, boolean>();
    for (const r of csv) {
      const v = r[ci("판정")];
      if (v === "길건너") human.set(kk(r[ci("매장명")], r[ci("경쟁점명")]), true);
      else if (v === "같은편") human.set(kk(r[ci("매장명")], r[ci("경쟁점명")]), false);
    }

    const auto = new Map<string, boolean>();
    const autoRoads = new Map<string, string[]>();
    if (existsSync(OSM)) {
      for (const r of JSON.parse(readFileSync(OSM, "utf8")).rows as Record<string, unknown>[]) {
        const k = kk(String(r["매장명"]), String(r["경쟁점명"]));
        auto.set(k, r["자동판정"] === "길건너");
        autoRoads.set(k, (r["가로지른도로"] as string[]) ?? []);
      }
    }

    // ── 1) 사람 vs OSM 자동 ────────────────────────────────────────────
    let a11 = 0, a10 = 0, a01 = 0, a00 = 0;
    for (const [k, h] of human) {
      if (!auto.has(k)) continue;
      const a = auto.get(k)!;
      if (h && a) a11++; else if (h && !a) a10++; else if (!h && a) a01++; else a00++;
    }
    const n = a11 + a10 + a01 + a00;
    const agree = n ? (a11 + a00) / n : 0;
    const pe = n ? (((a11 + a10) / n) * ((a11 + a01) / n) + ((a01 + a00) / n) * ((a10 + a00) / n)) : 0;
    const kappa = pe < 1 ? (agree - pe) / (1 - pe) : 0;
    console.log(`\n══ (17) 사람 판정 vs OSM 자동 판정 — n=${n} ══`);
    console.log(`                  자동:길건너   자동:같은편`);
    console.log(`  사람:길건너  ${String(a11).padStart(10)}${String(a10).padStart(14)}`);
    console.log(`  사람:같은편  ${String(a01).padStart(10)}${String(a00).padStart(14)}`);
    console.log(`  일치율 ${(agree * 100).toFixed(1)}% · 카파 ${kappa.toFixed(3)} ` +
      `(0.2↓ 없음 · 0.4↓ 약함 · 0.6↓ 보통 · 0.8↓ 높음)`);
    const humanN = [...human.values()].filter(Boolean).length;
    const autoN = [...auto.values()].filter(Boolean).length;
    console.log(`  길건너 비율 — 사람 ${humanN}/${human.size} · 자동 ${autoN}/${auto.size}`);

    // ── 2) 관문 — 길건너 경쟁점을 할인하면 점유율이 더 잘 맞나 ──────────
    // W: 길건너 경쟁점에 곱하는 가중. W=1이면 지금과 같고, W=0이면 아예 안 센다.
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const WS = [0, 0.25, 0.5, 0.75, 1];
    type Design = { label: string; useDist: boolean };
    const DESIGNS: Design[] = [
      { label: "거리 계단 유지 + 길건너 할인", useDist: true },
      { label: "거리 버리고 상권 분리만", useDist: false },
    ];

    const shareWith = (r: Row, W: number, useDist: boolean, lab: (k: string) => boolean | undefined) => {
      const oq = computeQualityScore(r.parts, W2);
      let riv = 0;
      for (const x of r.rivals) {
        if (useDist && x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W2) ?? oq) / oq;
        // 판정이 없으면 **세는 쪽**으로 둔다 — 결측을 유리하게 쓰지 않는다.
        const across = lab(kk(r.n, x.name)) === true;
        riv += x.ip * Math.pow(q, P.qualityExponent) * (across ? W : 1);
      }
      return r.pc / (r.pc + riv);
    };

    const W2 = DEFAULT_TEXTBOOK_PARAMS.qualityWeights;
    const obs = cmp.map((r) => r.shareObs);
    const scoreW = (W: number, useDist: boolean, lab: (k: string) => boolean | undefined) => {
      const pred = cmp.map((r) => shareWith(r, W, useDist, lab));
      return { mape: mean(pred.map((v, i) => Math.abs(v / obs[i] - 1))), r: pear(pred, obs) };
    };

    for (const src of [["사람", (k: string) => human.get(k)] as const,
                       ["OSM", (k: string) => auto.get(k)] as const]) {
      const [srcName, lab] = src;
      if (srcName === "OSM" && !auto.size) continue;
      console.log(`\n  ── ${srcName} 판정으로 ──`);
      for (const d of DESIGNS) {
        const line = WS.map((W) => {
          const s = scoreW(W, d.useDist, lab);
          return `W=${W} ${(s.mape * 100).toFixed(1)}%/${s.r.toFixed(3)}`;
        }).join("  ");
        console.log(`    ${d.label.padEnd(24)} ${line}`);
      }
    }

    // 대조군 — 길건너 라벨을 쌍끼리 섞는다. 길건너 곳수는 보존한다.
    let seed = 20260918 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n══ 무작위 대조군 500회 — 길건너 라벨을 쌍끼리 섞는다 ══`);
    for (const d of DESIGNS) {
      for (const crit of ["mape", "r"] as const) {
        const keys = [...human.keys()];
        const pick = (lab: (k: string) => boolean | undefined) => {
          let best = { W: 1, v: Infinity };
          for (const W of WS) {
            const s = scoreW(W, d.useDist, lab);
            const v = crit === "mape" ? s.mape : -s.r;
            if (v < best.v) best = { W, v };
          }
          return best;
        };
        const gainOf = (lab: (k: string) => boolean | undefined) => {
          const base = scoreW(1, d.useDist, lab);
          const b = pick(lab);
          return crit === "mape" ? base.mape - scoreW(b.W, d.useDist, lab).mape
                                 : scoreW(b.W, d.useDist, lab).r - base.r;
        };
        const real = gainOf((k) => human.get(k));
        const gains: number[] = [];
        for (let i = 0; i < 500; i++) {
          const pool = shuffled(keys.map((k) => human.get(k)!));
          const m = new Map(keys.map((k, j) => [k, pool[j]]));
          gains.push(gainOf((k) => m.get(k)));
        }
        gains.sort((x, y) => x - y);
        const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
        const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
        console.log(`  ${d.label.padEnd(24)} [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)}` +
          ` · 섞으면 중앙 ${f(med(gains))} · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])}` +
          ` · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
      }
    }
    expect(human.size).toBeGreaterThan(100);
  });

  // ────────────────────────────────────────────────────────────────────────
  // (18) 길건너를 둘로 가른다 — "어느 편에 사람이 많은가"를 자료로 답한다
  //
  // (17)은 길건너 33건을 전부 "경쟁이 약해진다"로 취급해 할인했다. 그런데 길건너에는
  // 반대 방향 둘이 섞여 있다:
  //   갑  경쟁점이 길 건너라 우리 손님을 못 뺏는다        -> 경쟁 약해짐
  //   을  경쟁점이 길 건너 **수요 쪽**이고 우리만 반대편   -> 경쟁 세짐 (오송점이 이 경우)
  // 둘을 한 칸에 넣으면 서로 상쇄된다. (17)이 p=0.078에서 멈춘 이유로 의심된다.
  //
  // 가르는 자는 사용자가 제안한 것이다(2026-09-18):
  //   *"경쟁점이랑 우리중에 사람 어디가 더 많은지 제대로 알려면 상권365에서 100미터로
  //     경쟁점 뽑아보면 될 거 아냐"*
  // 사람한테 물었더니 길건너 16건 중 12건이 "모르겠음"이었다. 자료가 답할 질문이 맞았다.
  // ────────────────────────────────────────────────────────────────────────
  it("(18) 길건너 x 유동인구 비 — 갑·을을 갈라 다시 건다", () => {
    const FILLED = ".local-tools/market-split-judgment-filled.csv";
    const SBIZ = ".local-tools/sbiz-floating-population.json";
    if (!existsSync(FILLED) || !existsSync(SBIZ)) { console.log("\n판정 CSV나 유동인구 자료가 없다."); return; }

    const parseCsv = (text: string) => {
      const out: string[][] = []; let row: string[] = [], f = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true;
        else if (c === ",") { row.push(f); f = ""; }
        else if (c === "\n") { row.push(f); out.push(row); row = []; f = ""; }
        else if (c !== "\r") f += c;
      }
      if (f.length || row.length) { row.push(f); out.push(row); }
      return out.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
    };
    const csv = parseCsv(readFileSync(FILLED, "utf8").replace(/^﻿/, ""));
    if ((csv[0][0] ?? "").startsWith("#")) csv.shift();
    const head = csv.shift() as string[];
    const ci = (n: string) => head.indexOf(n);
    const kk = (a: string, b: string) => `${a}|||${b}`;
    const human = new Map<string, boolean>();
    for (const r of csv) {
      const v = r[ci("판정")];
      if (v === "길건너") human.set(kk(r[ci("매장명")], r[ci("경쟁점명")]), true);
      else if (v === "같은편") human.set(kk(r[ci("매장명")], r[ci("경쟁점명")]), false);
    }

    // 100m 유동인구 — 최근 달 값을 쓴다(selected 배열의 끝).
    const sites = (JSON.parse(readFileSync(SBIZ, "utf8")).sites ?? {}) as Record<string, {
      radii?: Record<string, { selected?: number[] }>;
    }>;
    const flow100 = (key: string): number | null => {
      const sel = sites[key]?.radii?.["100"]?.selected;
      if (!sel || !sel.length) return null;
      const v = sel[sel.length - 1];
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    const W2 = DEFAULT_TEXTBOOK_PARAMS.qualityWeights;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const obs = cmp.map((r) => r.shareObs);

    // 쌍마다 비(경쟁점 100m ÷ 자사 100m). 자료가 없으면 null -> 중립(비=1)으로 둔다.
    let haveRatio = 0, wantRatio = 0;
    const ratioOf = (storeCode: string, rivalId: string): number | null => {
      const a = flow100(`existing:${storeCode}`), b = flow100(`competitor:${rivalId}`);
      if (a == null || b == null) return null;
      return b / a;
    };
    for (const r of cmp) for (const x of r.rivals) {
      if (human.get(kk(r.n, x.name)) !== true) continue;
      wantRatio++;
      if (ratioOf(r.store.storeCode, x.id) != null) haveRatio++;
    }
    console.log(`\n══ (18) 길건너 x 유동인구 비 ══`);
    console.log(`  길건너 경쟁점 중 100m 유동 자료가 있는 것 ${haveRatio}/${wantRatio}`);
    if (haveRatio < wantRatio) {
      console.log(`  ⚠️ 수집이 아직 안 끝났다. 끝난 뒤 다시 돌려야 결론이 선다.`);
    }

    // 분포를 먼저 본다 — 갑·을이 실제로 갈리나.
    const ratios: { store: string; rival: string; ratio: number }[] = [];
    for (const r of cmp) for (const x of r.rivals) {
      if (human.get(kk(r.n, x.name)) !== true) continue;
      const v = ratioOf(r.store.storeCode, x.id);
      if (v != null) ratios.push({ store: r.n, rival: x.name, ratio: v });
    }
    ratios.sort((a, b) => a.ratio - b.ratio);
    if (ratios.length) {
      const lo = ratios.filter((v) => v.ratio < 1).length;
      console.log(`  경쟁점 쪽이 한산(비<1) ${lo}건 · 붐빔(비≥1) ${ratios.length - lo}건`);
      console.log(`  비 범위 ${ratios[0].ratio.toFixed(2)} ~ ${ratios[ratios.length - 1].ratio.toFixed(2)}`);
    }

    // 설계 C — 계수 하나. 길건너 경쟁점 가중 x= 비^ψ.
    //   ψ=0  지금과 같다 (길건너를 무시)
    //   ψ>0  경쟁점 쪽이 붐빌수록 더 세게 센다(을), 한산할수록 덜 센다(갑)
    // 2026-09-18: 처음 [-1..1]로 훑었더니 최선이 **끝값 -1**이었고 LOO가 100% 그걸 골랐다.
    // 끝으로 달리는 계수는 이 저장소가 두 번 속은 징후다(밀집도 r=0.660 · gamma=4).
    // 범위를 넓혀 진짜 바닥이 안에 있는지 본다.
    const PSIS = [-3, -2, -1.5, -1, -0.5, -0.25, 0, 0.25, 0.5, 1];
    const shareWith = (r: Row, psi: number, lab: (k: string) => boolean | undefined) => {
      const oq = computeQualityScore(r.parts, W2);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W2) ?? oq) / oq;
        let w = 1;
        if (lab(kk(r.n, x.name)) === true) {
          const ratio = ratioOf(r.store.storeCode, x.id);
          w = ratio == null ? 1 : Math.pow(ratio, psi);
        }
        riv += x.ip * Math.pow(q, P.qualityExponent) * w;
      }
      return r.pc / (r.pc + riv);
    };
    const scorePsi = (psi: number, lab: (k: string) => boolean | undefined) => {
      const pred = cmp.map((r) => shareWith(r, psi, lab));
      return { mape: mean(pred.map((v, i) => Math.abs(v / obs[i] - 1))), r: pear(pred, obs) };
    };

    console.log(`\n  ψ 훑기 (길건너 경쟁점 가중 = 비^ψ)`);
    for (const psi of PSIS) {
      const s = scorePsi(psi, (k) => human.get(k));
      console.log(`    ψ=${String(psi).padStart(5)}  MAPE ${(s.mape * 100).toFixed(2)}%  r ${s.r.toFixed(3)}${psi === 0 ? "   <- 지금(길건너 무시)" : ""}`);
    }

    let seed = 20260918 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n══ LOO 홀드아웃 — 한 곳 빼고 ψ 고른 뒤 뺀 곳에서 채점 ══`);
    for (const crit of ["mape", "r"] as const) {
      const pickPsi = (idxs: number[]) => {
        let best = { psi: 0, v: Infinity };
        for (const psi of PSIS) {
          const pred = idxs.map((i) => shareWith(cmp[i], psi, (k) => human.get(k)));
          const o = idxs.map((i) => obs[i]);
          const v = crit === "mape" ? mean(pred.map((p, j) => Math.abs(p / o[j] - 1))) : -pear(pred, o);
          if (v < best.v) best = { psi, v };
        }
        return best.psi;
      };
      const all = cmp.map((_, i) => i);
      const errs: number[] = [], picks: number[] = [];
      for (let i = 0; i < cmp.length; i++) {
        const psi = pickPsi(all.filter((j) => j !== i));
        picks.push(psi);
        errs.push(Math.abs(shareWith(cmp[i], psi, (k) => human.get(k)) / obs[i] - 1));
      }
      const ins = pickPsi(all);
      const tally = [...new Set(picks)].map((p) => [p, picks.filter((x) => x === p).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 ψ=${ins} ${(scorePsi(ins, (k) => human.get(k)).mape * 100).toFixed(2)}% → LOO ${(mean(errs) * 100).toFixed(2)}%`);
      console.log(`     훈련이 고른 ψ: ${tally.map(([p, c]) => `${p} ${Math.round(c / picks.length * 100)}%`).join(" · ")}`);
    }

    console.log(`\n══ 무작위 대조군 500회 — 길건너 라벨을 쌍끼리 섞는다 ══`);
    for (const crit of ["mape", "r"] as const) {
      const pick = (lab: (k: string) => boolean | undefined) => {
        let best = { psi: 0, v: Infinity };
        for (const psi of PSIS) {
          const s = scorePsi(psi, lab);
          const v = crit === "mape" ? s.mape : -s.r;
          if (v < best.v) best = { psi, v };
        }
        return best;
      };
      const gainOf = (lab: (k: string) => boolean | undefined) => {
        const base = scorePsi(0, lab);
        const b = pick(lab);
        const s = scorePsi(b.psi, lab);
        return crit === "mape" ? base.mape - s.mape : s.r - base.r;
      };
      const keys = [...human.keys()];
      const real = gainOf((k) => human.get(k));
      const gains: number[] = [];
      for (let i = 0; i < 500; i++) {
        const pool = shuffled(keys.map((k) => human.get(k)!));
        const m = new Map(keys.map((k, j) => [k, pool[j]]));
        gains.push(gainOf((k) => m.get(k)));
      }
      gains.sort((x, y) => x - y);
      const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
      const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gains))}` +
        ` · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    // ── 위약 검정 ────────────────────────────────────────────────────────
    // 같은 가중을 **같은편 경쟁점에** 걸어 본다. 거기서도 비슷하게 좋아지면 이 항이 하는 일은
    // "길 건너"와 상관없이 그냥 **유동인구 비**를 쓰는 것이다. 그러면 경쟁 항이 아니라
    // 수요식 반경의 그림자다(⑧에서 중심도에 물었던 것과 같은 질문).
    const flipped = (k: string) => { const v = human.get(k); return v === undefined ? undefined : !v; };
    console.log(`\n══ 위약 — 같은 가중을 '같은편' 경쟁점에 걸면 ══`);
    for (const psi of [-3, -2, -1, 0]) {
      const real = scorePsi(psi, (k) => human.get(k));
      const plac = scorePsi(psi, flipped);
      console.log(`    ψ=${String(psi).padStart(4)}  길건너에 ${(real.mape * 100).toFixed(2)}%` +
        `   같은편에 ${(plac.mape * 100).toFixed(2)}%`);
    }
    const bestReal = Math.min(...PSIS.map((p) => scorePsi(p, (k) => human.get(k)).mape));
    const bestPlac = Math.min(...PSIS.map((p) => scorePsi(p, flipped).mape));
    const base0 = scorePsi(0, (k) => human.get(k)).mape;
    console.log(`  최선 이득 — 길건너 ${((base0 - bestReal) * 100).toFixed(2)}%p · 같은편(위약) ${((base0 - bestPlac) * 100).toFixed(2)}%p`);
    console.log(`  위약이 비슷하거나 더 크면, 이 항은 '길 건너'가 아니라 유동인구 비를 쓰는 것이다.`);

    expect(cmp.length).toBeGreaterThan(20);
  });

  // ────────────────────────────────────────────────────────────────────────
  // (19) 상권이 갈리면 **수요도 줄어든다** — 2026-09-18 사용자 정정
  //
  // 사용자: *"난 길건너니까 약하다고 체크한 게 아니라, 길건너편에 있으니까 상권이
  //          분리되어 있다라고 보는 거였는데? 두 매장 간 영향력이 적다라고 체크한 거야."*
  //
  // (17)(18)은 **경쟁만** 깎았다. 그런데 상권이 갈렸다는 건 두 가지를 같이 뜻한다:
  //   ㄱ  경쟁점이 우리 손님을 못 뺏는다        -> 우리 몫이 커진다 (예측 ↑)
  //   ㄴ  길 건너 사람도 우리 손님이 아니다      -> 우리 수요가 준다 (예측 ↓)
  // 방향이 반대라, ㄱ만 넣으면 서로 상쇄돼 아무 일도 안 일어난다. (17)(18)이 그랬다.
  //
  // 수요식은 매장 중심 **반경 400m 원**으로 센다. 그 원이 대로를 넘어가면 길 건너 사람이
  // 우리 손님으로 들어와 있다. 오송점이 그 경우다(아파트 54동 중 51동이 길 건너).
  //
  // 갈렸나 여부는 로드뷰 판정 block1을 쓴다 — "제일 붐비는 쪽과 우리 사이에 왕복 4차선
  // 이상 도로·철길·하천이 있는가". 매장 단위 사실 질문이고 41곳 중 13곳이 '예'다.
  // ────────────────────────────────────────────────────────────────────────
  it("(19) 갈린 상권은 수요도 깎아야 하나", () => {
    const RV = ".local-tools/roadview-judgments.json";
    if (!existsSync(RV)) { console.log("\n로드뷰 판정 자료가 없다."); return; }
    const raw = JSON.parse(readFileSync(RV, "utf8"));
    const split = new Map<string, boolean>();
    for (const s of raw.sites as Record<string, unknown>[]) {
      const key = String(s.key ?? "");
      if (!key.startsWith("existing_")) continue;
      if (typeof s.block1 === "boolean") split.set(key.replace("existing_", ""), s.block1);
    }
    const isSplit = (r: Row) => split.get(String(r.store.storeCode)) === true;
    const nSplit = rows.filter(isSplit).length;
    console.log(`\n══ (19) 갈린 상권의 수요 할인 ══`);
    console.log(`  전체 ${rows.length}곳 중 갈림 ${nSplit}곳 · 경쟁상권 ${cmp.length}곳 중 ${cmp.filter(isSplit).length}곳`);

    // λ만큼 수요를 깎는다. 축척 A도 같이 다시 잡는다 — A는 독점매장에서 재는 값이라
    // 그중에도 갈린 곳이 있으면 같이 움직인다. 안 고치면 깎은 만큼이 A로 되밀려 들어간다.
    const W2 = DEFAULT_TEXTBOOK_PARAMS.qualityWeights;
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const predShare = (r: Row) => {
      const oq = computeQualityScore(r.parts, W2);
      let riv = 0;
      for (const x of r.rivals) {
        if (x.d > P.effectiveRadiusM) continue;
        const q = oq == null ? 1 : (computeQualityScore(x.parts, W2) ?? oq) / oq;
        riv += x.ip * Math.pow(q, P.qualityExponent);
      }
      return r.pc / (r.pc + riv);
    };
    const pred = cmp.map(predShare);

    const obsWith = (lam: number, flag: (r: Row) => boolean) => {
      const dem = (r: Row) => r.demand * (flag(r) ? 1 - lam : 1);
      const mono2 = rows.filter((r) => !r.rivals.length);
      const A2 = med(mono2.map((r) => r.util / (dem(r) / (r.pc * 720))));
      return cmp.map((r) => r.util / (A2 * dem(r) / (r.pc * 720)));
    };
    const scoreLam = (lam: number, flag: (r: Row) => boolean) => {
      const o = obsWith(lam, flag);
      return { mape: mean(pred.map((v, i) => Math.abs(v / o[i] - 1))), r: pear(pred, o) };
    };

    const LAMS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    console.log(`\n  λ 훑기 (갈린 매장의 수요 x (1-λ))`);
    for (const lam of LAMS) {
      const s = scoreLam(lam, isSplit);
      console.log(`    λ=${lam.toFixed(1)}  MAPE ${(s.mape * 100).toFixed(2)}%  r ${s.r.toFixed(3)}${lam === 0 ? "   <- 지금(안 깎음)" : ""}`);
    }

    let seed = 20260918 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    console.log(`\n══ LOO 홀드아웃 ══`);
    for (const crit of ["mape", "r"] as const) {
      const pickLam = (idxs: number[]) => {
        let best = { lam: 0, v: Infinity };
        for (const lam of LAMS) {
          const o = obsWith(lam, isSplit);
          const v = crit === "mape"
            ? mean(idxs.map((i) => Math.abs(pred[i] / o[i] - 1)))
            : -pear(idxs.map((i) => pred[i]), idxs.map((i) => o[i]));
          if (v < best.v) best = { lam, v };
        }
        return best.lam;
      };
      const all = cmp.map((_, i) => i);
      const errs: number[] = [], picks: number[] = [];
      for (let i = 0; i < cmp.length; i++) {
        const lam = pickLam(all.filter((j) => j !== i));
        picks.push(lam);
        const o = obsWith(lam, isSplit);
        errs.push(Math.abs(pred[i] / o[i] - 1));
      }
      const ins = pickLam(all);
      const base = scoreLam(0, isSplit);
      const tally = [...new Set(picks)].map((p) => [p, picks.filter((x) => x === p).length] as const).sort((a, b) => b[1] - a[1]);
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 표본 안 λ=${ins} ${(scoreLam(ins, isSplit).mape * 100).toFixed(2)}%` +
        ` → LOO ${(mean(errs) * 100).toFixed(2)}%   (안 깎으면 ${(base.mape * 100).toFixed(2)}%)`);
      console.log(`     훈련이 고른 λ: ${tally.map(([p, c]) => `${p} ${Math.round(c / picks.length * 100)}%`).join(" · ")}`);
    }

    console.log(`\n══ 무작위 대조군 500회 — '갈림' 딱지를 매장끼리 섞는다 ══`);
    for (const crit of ["mape", "r"] as const) {
      const gainOf = (flag: (r: Row) => boolean) => {
        const base = scoreLam(0, flag);
        let best = Infinity, bl = 0;
        for (const lam of LAMS) {
          const s = scoreLam(lam, flag);
          const v = crit === "mape" ? s.mape : -s.r;
          if (v < best) { best = v; bl = lam; }
        }
        const s = scoreLam(bl, flag);
        return crit === "mape" ? base.mape - s.mape : s.r - base.r;
      };
      const real = gainOf(isSplit);
      const codes = rows.map((r) => String(r.store.storeCode));
      const gains: number[] = [];
      for (let i = 0; i < 500; i++) {
        const pool = shuffled(codes.map((c) => split.get(c) === true));
        const m = new Map(codes.map((c, j) => [c, pool[j]]));
        gains.push(gainOf((r) => m.get(String(r.store.storeCode)) === true));
      }
      gains.sort((x, y) => x - y);
      const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
      const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gains))}` +
        ` · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    expect(cmp.length).toBeGreaterThan(20);
  });
});
