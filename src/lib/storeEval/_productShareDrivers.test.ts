// 상품몫(먹거리 단가) 사실 확인 — 실측 상품단가가 무엇과 관계 있나 (2026-09-25). 읽기전용.
// 본체/운영/Firestore 미변경. **계수를 고르지 않는다.**
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 인계(docs/handoff-20260929.md 최종 블록) 다음 할 일 2번:
//   "실측 상품단가(38곳 1,065~2,076원 vs 상수 1,493)가 먹거리 점수·인테리어·특수수요 유형·가동률·PC수·개점 시기와
//    관계 있나 사실만 찍는다. 설명되면 상수 → 자료로 가는 재고 표, 안 되면 '상품몫 예측 불가 ±14%'로 못 박고 끝."
//
// 앞선 측정과의 관계(중복 아님):
//   `_productShareFormula`(09-21) — 표적 **상품비중**, 변수는 **후보지에서 아는 것만** 20개. 유동 500m만 r 0.434,
//     LOO에서 상수를 못 이김(189 vs 204원). QSC·실측가동률 같은 기존점 전용 값은 일부러 뺐다.
//   `_productShareByType`(09-21) — 유형별 상품비중. 대학가 5곳만 판정 가능했다.
//   여기서는 표적을 **실측 상품단가(원/PC·시간)** 그대로 두고(산식이 쓰는 값이 이것이라), 인계가 지목한 변수 6개에
//   기존점 전용 값(QSC 종합점수)까지 **사실로만** 센다. 후보지에 없는 값이 설명해도 예측엔 못 쓴다 — 그건 결론에 적는다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 실측 상품단가 = Σ상품매출 ÷ Σ(PC×720×실측가동률), 창은 개점 **2~12개월차**, 가동률 있는 달만 — `_unitPriceLayer`와 같은 정의.
//    산식 상품몫 1,493 상수. 상품몫 오차 = 1,493 ÷ 실측 − 1.
// 2. ⚠️ 상품단가는 **가동률로 나눈 값**이다. 상품매출이 가동률과 무관하면 단가는 저절로 1/가동률로 움직인다(분모 효과).
//    그래서 가동률에 대해서는 **상품매출/PC/월**(분모에 가동률 없음)도 같이 본다. 둘이 반대로 나오면 분모 효과다.
// 3. 변수(인계 지목 6 + 참고 2). 먹거리·인테리어 점수는 **값이 하나뿐이면 "변별 없음"으로 찍고 통계를 내지 않는다.**
//    기존점 원본에 이 두 점수는 실측이 없고 표준값 4로 채워진다(calc.ts 2984행 주석) — 사전에 알고 시작한다.
//    특수수요 유형은 표본 5곳 미만이면 표에만 찍고 판정 안 함(`_productShareByType` 관문 0과 같음).
//    참고 2개: QSC 종합점수 평가창 평균(기존점 전용) · ln 유동 500m(09-21 신호의 재확인).
//    ⛔ 정가는 안 잰다 — 정가 상관(r −0.48)으로 가는 길은 09-16 결정으로 닫혔다. 경쟁력점수도 09-16 결정으로 안 쓴다.
// 4. 유의선 |r| ≥ 0.41(09-21과 같음) **그리고** 무작위 대조군 2,000회 p < 0.05. 훑는 개수(연속 변수 6개) 본페로니 0.05/6 = 0.0083도 적는다.
//    유형은 '없음' 대비 순위합(Mann-Whitney) p < 0.05, n ≥ 5인 유형만.
// 5. 유의선을 넘는 변수가 있으면 **LOO 홀드아웃**으로 상수 1,493과 대본다(한 곳 빼고 맞춰 그 곳을 예측). 상품몫 |오차| 평균(%)과
//    MAE(원)를 상수와 나란히. LOO에서 상수를 못 이기면 "설명은 되나 예측은 안 된다"로 적는다.
// 6. 판정 잣대는 여기 없다. 채택은 재고 표 + 추천 후 사용자 결정. 여기서는 사실만.
//
// 실행:
//   npx vitest run src/lib/storeEval/_productShareDrivers.test.ts --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS } from "./textbookModel";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const MONTH_HOURS = 720;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
};
const ranks = (a: number[]) => {
  const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
  }
  return r;
};
const spearman = (x: number[], y: number[]) => corr(ranks(x), ranks(y));
// 결정적 난수(표가 실행마다 안 흔들리게)
const rng = (() => { let s = 20260925; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const permP = (x: number[], y: number[], n = 2000) => {
  const obs = Math.abs(corr(x, y)); let hit = 0;
  for (let i = 0; i < n; i++) if (Math.abs(corr(x, shuffle(y))) >= obs) hit++;
  return hit / n;
};
// Mann-Whitney U (정규 근사, 동점 보정 없음 — 표본 5~30이라 참고용)
const mannWhitneyP = (a: number[], b: number[]) => {
  const all = ranks([...a, ...b]); const ra = all.slice(0, a.length).reduce((p, q) => p + q, 0);
  const n1 = a.length, n2 = b.length; const u = ra - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2, sd = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = Math.abs((u - mu) / sd);
  const erf = (t: number) => { const s = Math.sign(t); t = Math.abs(t); const p = 0.3275911, a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429; const q = 1 / (1 + p * t); return s * (1 - (((((a5 * q + a4) * q) + a3) * q + a2) * q + a1) * q * Math.exp(-t * t)); };
  return 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
};
const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const f3 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(3);

type Sale = { storeCode: string; yearMonth: string; pcSales?: number | null; productSales?: number | null; utilizationRate?: number | null };
type Store = {
  storeCode: string; storeName?: string | null; pcCount?: number | null; evaluationPcCount?: number | null;
  hourlyRate?: number | null; openedAt?: string | null; excludedFromModel?: boolean | null;
  ownFoodScore?: number | null; ownInteriorScore?: number | null;
  specialDemandType?: string | null; specialDemandIntensity?: string | null;
  floating500Avg?: number | null;
};
type Qsc = { storeCode: string; records: { date: string; score: number }[] };

type Row = {
  code: string; name: string; pc: number; rate: number; months: number;
  actU: number; prodUnit: number; prodErr: number; prodPerPcMonth: number; prodShare: number;
  food: number | null; interior: number | null; type: string; intensity: string;
  openIdx: number | null;     // 개점 시기: 2023-01을 0으로 둔 개월 수
  qsc: number | null;         // QSC 종합점수 평가창 평균
  lnFlow: number | null;      // ln 유동 500m
  excluded: boolean;
};

describeIf("상품몫 사실 확인 — 실측 상품단가가 무엇과 관계 있나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const sales: Sale[] = snap.sales ?? [];
  const stores: Store[] = snap.existingStores ?? [];
  const qscs: Qsc[] = snap.labQscScores ?? [];
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const byCode = new Map<string, Sale[]>();
  for (const s of sales) byCode.set(s.storeCode, [...(byCode.get(s.storeCode) ?? []), s]);
  const qscBy = new Map(qscs.map((q) => [q.storeCode, q.records]));
  const normType = (t: string | null | undefined) => (t ?? "없음").replace("·", "");

  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const s of stores) {
    const pc = s.evaluationPcCount ?? s.pcCount ?? null;
    const rate = s.hourlyRate ?? null;
    const name = s.storeName ?? s.storeCode;
    const evalMonths = evaluationMonths(s.openedAt ?? null);
    const all = byCode.get(s.storeCode) ?? [];
    const from2 = new Set(evalMonths.slice(1));
    let ms = all.filter((m) => from2.has(m.yearMonth) && ((m.pcSales ?? 0) + (m.productSales ?? 0)) > 0);
    if (!ms.length) { const w = new Set(evalMonths); ms = all.filter((m) => w.has(m.yearMonth)); }
    if (!pc || !(pc > 0) || rate == null || !(rate > 0) || !ms.length) { skipped.push(`${name}(${!pc ? "PC수" : rate == null ? "정가" : "매출월"} 없음)`); continue; }
    let pcSum = 0, prodSum = 0, hours = 0; const us: number[] = [];
    for (const m of ms) {
      const u = m.utilizationRate;
      if (u == null || !(u > 0) || !((m.pcSales ?? 0) > 0)) continue;
      pcSum += m.pcSales ?? 0; prodSum += m.productSales ?? 0; hours += pc * MONTH_HOURS * u; us.push(u);
    }
    if (!(hours > 0)) { skipped.push(`${name}(가동률 있는 달 없음)`); continue; }
    const prodUnit = prodSum / hours;
    // 개점 시기
    const openIdx = s.openedAt ? (Number(s.openedAt.slice(0, 4)) - 2023) * 12 + (Number(s.openedAt.slice(5, 7)) - 1) : null;
    // QSC 평가창 평균(창 안 기록 없으면 null — 전체기간은 안 섞는다)
    const recs = qscBy.get(s.storeCode) ?? [];
    const win = new Set(evalMonths);
    const inWin = recs.filter((r) => win.has(r.date.slice(0, 7).replace(".", "-"))).map((r) => r.score);
    rows.push({
      code: s.storeCode, name, pc, rate, months: us.length, actU: mean(us),
      prodUnit, prodErr: P.productUnitPrice / prodUnit - 1,
      prodPerPcMonth: prodSum / (pc * us.length), prodShare: prodSum / (pcSum + prodSum),
      food: s.ownFoodScore ?? null, interior: s.ownInteriorScore ?? null,
      type: normType(s.specialDemandType), intensity: s.specialDemandIntensity ?? "없음",
      openIdx, qsc: inWin.length ? mean(inWin) : null,
      lnFlow: s.floating500Avg && s.floating500Avg > 0 ? Math.log(s.floating500Avg) : null,
      excluded: s.excludedFromModel === true,
    });
  }
  const inc = rows.filter((r) => !r.excluded);

  // ── 달별 자료(전 기간, 개점 달 제외) — (6)(7) 달력 vs 세대 분리용 ─────────────────────────
  // 매출DB는 평가창 밖(13개월차 이후)도 2026-08까지 이어진다. 같은 매장을 여러 달력 시점에서 보면 "시간이 가서 오른 것"과
  // "늦게 연 매장이 원래 높은 것"을 가를 수 있다.
  const calIdx = (ym: string) => (Number(ym.slice(0, 4)) - 2023) * 12 + (Number(ym.slice(5, 7)) - 1);
  type M = { code: string; name: string; ym: string; cal: number; unit: number; openIdx: number; inWin: boolean; age: number };
  const monthly: M[] = [];
  const incBy = new Map(inc.map((r) => [r.code, r]));
  for (const s of stores) {
    const r = incBy.get(s.storeCode); if (!r || r.openIdx == null) continue;
    const win = new Set(evaluationMonths(s.openedAt ?? null).slice(1));
    const openYm = (s.openedAt ?? "").slice(0, 7);
    for (const m of byCode.get(s.storeCode) ?? []) {
      const u = m.utilizationRate; if (u == null || !(u > 0) || !((m.pcSales ?? 0) > 0) || m.yearMonth === openYm) continue;
      monthly.push({ code: r.code, name: r.name, ym: m.yearMonth, cal: calIdx(m.yearMonth), unit: (m.productSales ?? 0) / (r.pc * MONTH_HOURS * u), openIdx: r.openIdx, inWin: win.has(m.yearMonth), age: calIdx(m.yearMonth) - r.openIdx });
    }
  }
  const ymLabel = (cal: number) => `${2023 + Math.floor(cal / 12)}-${String((cal % 12) + 1).padStart(2, "0")}`;

  it("(1) 매장별 표 — 실측 상품단가와 변수들을 나란히", () => {
    const sorted = [...rows].sort((a, b) => a.prodUnit - b.prodUnit);
    console.log(`\n[매장별] 실측 상품단가 = Σ상품매출 ÷ Σ(PC×720×가동률), 개점 2~12개월차. 상품오차 = 1,493 ÷ 실측 − 1 (+면 산식이 높다)`);
    console.log(`  ${pad("매장", 12)} ${pad("유형/강도", 12)} ${padL("PC", 4)} ${padL("정가", 6)} ${padL("달", 3)} ${padL("가동률", 6)} | ${padL("실측상품", 8)} ${padL("상품오차", 8)} ${padL("상품/PC/월", 10)} ${padL("상품비중", 8)} | ${padL("먹거리", 6)} ${padL("인테리어", 8)} ${padL("개점", 8)} ${padL("QSC", 5)} ${padL("유동500", 7)}`);
    for (const r of sorted) {
      const tag = r.excluded ? " (모델 제외·참고)" : "";
      console.log(`  ${pad(r.name, 12)} ${pad(`${r.type}/${r.intensity}`, 12)} ${padL(String(r.pc), 4)} ${padL(won(r.rate), 6)} ${padL(String(r.months), 3)} ${padL((r.actU * 100).toFixed(1) + "%", 6)} | ${padL(won(r.prodUnit), 8)} ${padL(pct(r.prodErr), 8)} ${padL(won(r.prodPerPcMonth), 10)} ${padL((r.prodShare * 100).toFixed(1) + "%", 8)} | ${padL(r.food == null ? "-" : String(r.food), 6)} ${padL(r.interior == null ? "-" : String(r.interior), 8)} ${padL(r.openIdx == null ? "-" : `${2023 + Math.floor(r.openIdx / 12)}-${String((r.openIdx % 12) + 1).padStart(2, "0")}`, 8)} ${padL(r.qsc == null ? "-" : r.qsc.toFixed(0), 5)} ${padL(r.lnFlow == null ? "-" : won(Math.exp(r.lnFlow)), 7)}${tag}`);
    }
    if (skipped.length) console.log(`  뺀 매장: ${skipped.join(" · ")}`);
    const pu = inc.map((r) => r.prodUnit);
    console.log(`  모델 포함 ${inc.length}곳 · 실측 상품단가 중앙 ${won(median(pu))} · 범위 ${won(Math.min(...pu))}~${won(Math.max(...pu))} · 상품몫 |오차| 평균 ${pct(mean(inc.map((r) => Math.abs(r.prodErr))))}`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(2) 먹거리·인테리어 점수 — 변별이 있나", () => {
    console.log(`\n[먹거리·인테리어 점수]`);
    for (const [label, key] of [["먹거리 ownFoodScore", "food"], ["인테리어 ownInteriorScore", "interior"]] as const) {
      const vals = inc.map((r) => r[key]).filter((v): v is number => v != null);
      const distinct = [...new Set(vals)].sort();
      console.log(`  ${pad(label, 24)} 값 있는 매장 ${vals.length}/${inc.length} · 서로 다른 값 ${distinct.length}개 ${JSON.stringify(distinct)}` +
        (distinct.length <= 1 ? `  → **변별 없음** — 전부 같은 값이라 상품단가와의 관계를 잴 수 없다` : ""));
      if (distinct.length > 1) {
        const rs = inc.filter((r) => r[key] != null);
        console.log(`    r=${f3(corr(rs.map((r) => r[key] as number), rs.map((r) => r.prodUnit)))} (n=${rs.length})`);
      }
    }
    console.log(`  사실: 기존점 원본에 이 두 점수는 실측이 없고 표준값 4로 채워진다(calc.ts 2984행 주석). 09-18 사용자 말대로 "먹거리는 프차 자체브랜드라 통일"이므로`);
    console.log(`        자사끼리는 애초에 같은 값이다. 상품단가가 매장마다 1,065~2,076원으로 다른 건 **먹거리 점수로는 설명할 수 없다**(자료가 없어서가 아니라 값이 하나뿐이라).`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(3) 연속 변수 — 가동률·PC수·개점 시기 + 참고(QSC·유동)", () => {
    const vars: { label: string; x: (r: Row) => number | null; note: string; ref?: boolean }[] = [
      { label: "실측 가동률", x: (r) => r.actU, note: "⚠️ 상품단가 분모에 가동률이 있다 — 아래 상품/PC/월 줄과 같이 볼 것" },
      { label: "PC 수", x: (r) => r.pc, note: "" },
      { label: "개점 시기(개월)", x: (r) => r.openIdx, note: "늦게 연 매장일수록 +. 기간 효과·상권 세대 효과가 섞인다" },
      { label: "QSC 종합점수(평가창)", x: (r) => r.qsc, note: "기존점 전용 — 설명돼도 후보지 예측엔 못 쓴다", ref: true },
      { label: "ln 유동 500m", x: (r) => r.lnFlow, note: "09-21 상품비중 r 0.434의 재확인(표적이 다르다)", ref: true },
    ];
    const nTests = vars.length + 1; // + 아래 상품/PC/월 vs 가동률
    console.log(`\n[연속 변수 → 실측 상품단가(원/PC·시간)] 유의선 |r| ≥ 0.41 · 대조군 2,000회 p < 0.05 · 본페로니 ${(0.05 / nTests).toFixed(4)}`);
    console.log(`  ${pad("변수", 22)} ${padL("n", 3)} ${padL("r", 7)} ${padL("ρ", 7)} ${padL("p", 7)} ${padL("→오차 r", 8)}  판정`);
    const passed: string[] = [];
    for (const v of vars) {
      const rs = inc.filter((r) => v.x(r) != null);
      const x = rs.map((r) => v.x(r) as number), y = rs.map((r) => r.prodUnit), e = rs.map((r) => r.prodErr);
      const r = corr(x, y), rho = spearman(x, y), p = permP(x, y);
      const ok = Math.abs(r) >= 0.41 && p < 0.05;
      if (ok && !v.ref) passed.push(v.label);
      console.log(`  ${pad(v.label + (v.ref ? " (참고)" : ""), 22)} ${padL(String(rs.length), 3)} ${padL(f3(r), 7)} ${padL(f3(rho), 7)} ${padL(p.toFixed(4), 7)} ${padL(f3(corr(x, e)), 8)}  ${ok ? "유의선 넘음" : "미달"}${v.note ? "  · " + v.note : ""}`);
    }
    // 분모 효과 확인: 상품매출/PC/월(가동률 없음) vs 가동률
    const x = inc.map((r) => r.actU), y2 = inc.map((r) => r.prodPerPcMonth);
    const r2 = corr(x, y2), p2 = permP(x, y2);
    console.log(`  ${pad("가동률 → 상품/PC/월", 22)} ${padL(String(inc.length), 3)} ${padL(f3(r2), 7)} ${padL(f3(spearman(x, y2)), 7)} ${padL(p2.toFixed(4), 7)} ${padL("", 8)}  ${Math.abs(r2) >= 0.41 && p2 < 0.05 ? "유의선 넘음" : "미달"}  · 분모에 가동률 없음. 상품단가 r과 부호가 다르면 위 줄은 분모 효과다`);
    console.log(`  가동률 → 상품비중  r=${f3(corr(x, inc.map((r) => r.prodShare)))}   (구성비 — 가동률·PC수 약분)`);
    // 개점 연도별 중앙(참고)
    const byYear = new Map<number, number[]>();
    for (const r of inc) if (r.openIdx != null) { const yr = 2023 + Math.floor(r.openIdx / 12); byYear.set(yr, [...(byYear.get(yr) ?? []), r.prodUnit]); }
    console.log(`  개점 연도별 실측 상품단가 중앙: ` + [...byYear].sort((a, b) => a[0] - b[0]).map(([yr, v]) => `${yr}년 ${v.length}곳 ${won(median(v))}`).join(" · "));
    console.log(`  → 유의선 넘은 후보지-사용 가능 변수: ${passed.length ? passed.join(", ") : "없음"}`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(4) 특수수요 유형·강도 — 유형별 실측 상품단가", () => {
    const groups = new Map<string, Row[]>();
    for (const r of inc) groups.set(r.type, [...(groups.get(r.type) ?? []), r]);
    const none = groups.get("없음") ?? [];
    console.log(`\n[특수수요 유형별 실측 상품단가] n ≥ 5만 판정('없음' 대비 순위합 p). 09-25 정정(강릉·부천 관광유흥/높음, 증평 군부대/낮음) 반영된 값`);
    console.log(`  ${pad("유형", 8)} ${padL("n", 3)} ${padL("중앙", 7)} ${padL("평균", 7)} ${padL("범위", 15)} ${padL("상품오차중앙", 12)} ${padL("p", 7)}  매장`);
    const order = ["없음", "대학가", "산업단지", "관광유흥", "군부대", "기타"];
    for (const t of [...order, ...[...groups.keys()].filter((k) => !order.includes(k))]) {
      const rs = groups.get(t); if (!rs) continue;
      const v = rs.map((r) => r.prodUnit);
      const p = t !== "없음" && rs.length >= 5 && none.length >= 5 ? mannWhitneyP(v, none.map((r) => r.prodUnit)) : null;
      console.log(`  ${pad(t, 8)} ${padL(String(rs.length), 3)} ${padL(won(median(v)), 7)} ${padL(won(mean(v)), 7)} ${padL(`${won(Math.min(...v))}~${won(Math.max(...v))}`, 15)} ${padL(pct(median(rs.map((r) => r.prodErr))), 12)} ${padL(p == null ? (t === "없음" ? "기준" : "n<5") : p.toFixed(4), 7)}  ${rs.map((r) => `${r.name} ${won(r.prodUnit)}`).join(" · ")}`);
    }
    // 강도별(유형 무관)
    const byInt = new Map<string, number[]>();
    for (const r of inc) byInt.set(r.intensity, [...(byInt.get(r.intensity) ?? []), r.prodUnit]);
    console.log(`  강도별 중앙: ` + ["없음", "낮음", "보통", "높음"].filter((k) => byInt.has(k)).map((k) => `${k} ${byInt.get(k)!.length}곳 ${won(median(byInt.get(k)!))}`).join(" · "));
    // 유형 있음(어떤 유형이든) vs 없음
    const any = inc.filter((r) => r.type !== "없음").map((r) => r.prodUnit);
    const noneV = none.map((r) => r.prodUnit);
    if (any.length >= 5 && noneV.length >= 5) console.log(`  유형 있음 ${any.length}곳 중앙 ${won(median(any))} vs 없음 ${noneV.length}곳 ${won(median(noneV))} · 순위합 p=${mannWhitneyP(any, noneV).toFixed(4)}`);
    // ⚠️ 유형은 개점 시기와 얽힌다(2025~26 개점에 특수수요 유형이 몰림) — (6)에서 개점 시기를 통제한 뒤 다시 본다
    const openOf = (rs: Row[]) => rs.map((r) => r.openIdx).filter((v): v is number => v != null);
    console.log(`  개점 시기 중앙(2023-01=0 개월): 유형 있음 ${median(openOf(inc.filter((r) => r.type !== "없음"))).toFixed(0)} · 없음 ${median(openOf(none)).toFixed(0)}  ← 차이가 크면 유형 차이는 개점 시기 차이일 수 있다`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(5) LOO 홀드아웃 — 상수 1,493 vs 변수로 낸 값 (설명되는 게 있을 때만 뜻이 있다)", () => {
    // 한 곳을 빼고 나머지로 맞춘 뒤 그 곳을 예측. 상수는 1,493 고정(지금 산식) + LOO 평균(공정 비교)을 둘 다.
    const score = (pred: (i: number) => number) => {
      const errs = inc.map((r, i) => pred(i) / r.prodUnit - 1);
      return { mape: mean(errs.map(Math.abs)), mae: mean(inc.map((r, i) => Math.abs(pred(i) - r.prodUnit))), bias: mean(errs), within10: errs.filter((e) => Math.abs(e) <= 0.1).length };
    };
    const fmt = (l: string, s: ReturnType<typeof score>) => `  ${pad(l, 30)} |오차| ${pct(s.mape)} · MAE ${won(s.mae)}원 · 편향 ${pct(s.bias)} · ±10% 안 ${s.within10}/${inc.length}`;
    console.log(`\n[LOO 홀드아웃 — 상품몫] 표본 ${inc.length}곳. 상수를 못 이기면 그 변수는 "설명은 돼도 예측은 안 된다"`);
    console.log(fmt("상수 1,493(지금)", score(() => P.productUnitPrice)));
    console.log(fmt("LOO 평균", score((i) => mean(inc.filter((_, j) => j !== i).map((r) => r.prodUnit)))));
    const linear = (label: string, x: (r: Row) => number | null) => {
      const rs = inc.filter((r) => x(r) != null); if (rs.length < 10) return;
      const errs: number[] = [], aes: number[] = [];
      for (let i = 0; i < rs.length; i++) {
        const tr = rs.filter((_, j) => j !== i); const tx = tr.map((r) => x(r) as number), ty = tr.map((r) => r.prodUnit);
        const mx = mean(tx), my = mean(ty); const b = tx.reduce((a, v, k) => a + (v - mx) * (ty[k] - my), 0) / tx.reduce((a, v) => a + (v - mx) ** 2, 0);
        const pred = my + b * ((x(rs[i]) as number) - mx);
        errs.push(pred / rs[i].prodUnit - 1); aes.push(Math.abs(pred - rs[i].prodUnit));
      }
      const cst = rs.map((r) => Math.abs(P.productUnitPrice / r.prodUnit - 1));
      console.log(`  ${pad(label, 30)} |오차| ${pct(mean(errs.map(Math.abs)))} · MAE ${won(mean(aes))}원 · 편향 ${pct(mean(errs))} · ±10% 안 ${errs.filter((e) => Math.abs(e) <= 0.1).length}/${rs.length}   (같은 ${rs.length}곳 상수 |오차| ${pct(mean(cst))})`);
    };
    linear("선형 · 실측 가동률", (r) => r.actU);
    linear("선형 · PC 수", (r) => r.pc);
    linear("선형 · 개점 시기", (r) => r.openIdx);
    linear("선형 · QSC(참고·후보지 없음)", (r) => r.qsc);
    linear("선형 · ln 유동 500m(참고)", (r) => r.lnFlow);
    // 유형별 중앙(LOO) — 유형 n<3이면 전체 LOO 중앙으로
    const typePred = (i: number) => {
      const tr = inc.filter((_, j) => j !== i); const same = tr.filter((r) => r.type === inc[i].type).map((r) => r.prodUnit);
      return same.length >= 3 ? median(same) : median(tr.map((r) => r.prodUnit));
    };
    console.log(fmt("특수수요 유형별 중앙(LOO, n<3은 전체)", score(typePred)));
    const intPred = (i: number) => {
      const tr = inc.filter((_, j) => j !== i); const same = tr.filter((r) => r.intensity === inc[i].intensity).map((r) => r.prodUnit);
      return same.length >= 3 ? median(same) : median(tr.map((r) => r.prodUnit));
    };
    console.log(fmt("강도별 중앙(LOO)", score(intPred)));
    console.log(`  ⭐ 읽는 법 — 지금 상수의 |오차| 14%대가 어느 줄에서 얼마나 주나. 후보지에 없는 값(가동률·QSC)은 줄어도 못 쓴다 — 그 줄은 "기존점 오차의 정체"만 말한다.`);
    expect(inc.length).toBeGreaterThan(30);
  });

  it("(6) 개점 시기 r 0.72의 정체 — 달력(시간이 가서 오름)인가 세대(늦게 연 매장이 원래 높음)인가", () => {
    console.log(`\n[달력 vs 세대] 달별 자료 ${monthly.length}건 · ${new Set(monthly.map((m) => m.code)).size}곳 · ${ymLabel(Math.min(...monthly.map((m) => m.cal)))}~${ymLabel(Math.max(...monthly.map((m) => m.cal)))}`);
    // (a) 매장 고정효과 — 같은 매장 안에서 달력이 갈수록 단가가 오르나(매장 평균에서의 편차끼리)
    const byStore = new Map<string, M[]>();
    for (const m of monthly) byStore.set(m.code, [...(byStore.get(m.code) ?? []), m]);
    const dx: number[] = [], dy: number[] = [], slopes: { name: string; slope: number; n: number }[] = [];
    for (const [, ms] of byStore) {
      if (ms.length < 6) continue;
      const mc = mean(ms.map((m) => m.cal)), mu = mean(ms.map((m) => m.unit));
      for (const m of ms) { dx.push(m.cal - mc); dy.push(m.unit - mu); }
      const b = ms.reduce((a, m) => a + (m.cal - mc) * (m.unit - mu), 0) / ms.reduce((a, m) => a + (m.cal - mc) ** 2, 0);
      slopes.push({ name: ms[0].name, slope: b, n: ms.length });
    }
    const pooled = dx.reduce((a, v, i) => a + v * dy[i], 0) / dx.reduce((a, v) => a + v * v, 0);
    console.log(`  (a) 매장 안 달력 기울기(고정효과, 6달 이상 ${slopes.length}곳 ${dx.length}건): 합동 ${won(pooled)}원/월 = ${won(pooled * 12)}원/년 · r=${f3(corr(dx, dy))} · 매장별 기울기 중앙 ${won(median(slopes.map((s) => s.slope)))}원/월 · 양수 ${slopes.filter((s) => s.slope > 0).length}/${slopes.length}곳`);
    console.log(`      ⚠️ 매장 안 기울기에는 "나이(개점 후 개월)" 효과도 섞인다 — 아래 (b)에서 나이를 통제한다`);
    // (b) 나이 통제 — 같은 나이(개점 후 n개월)에서 달력이 다른 매장끼리: unit ~ age + cal 2변수 회귀(합동)
    const X = monthly.map((m) => [1, m.age, m.cal]); const Y = monthly.map((m) => m.unit);
    const solve3 = (X: number[][], Y: number[]) => {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
      for (let i = 0; i < X.length; i++) for (let p = 0; p < 3; p++) { B[p] += X[i][p] * Y[i]; for (let q = 0; q < 3; q++) A[p][q] += X[i][p] * X[i][q]; }
      // 가우스 소거
      for (let c = 0; c < 3; c++) { const piv = A[c][c]; for (let q = 0; q < 3; q++) A[c][q] /= piv; B[c] /= piv; for (let r2 = 0; r2 < 3; r2++) if (r2 !== c) { const f = A[r2][c]; for (let q = 0; q < 3; q++) A[r2][q] -= f * A[c][q]; B[r2] -= f * B[c]; } }
      return B;
    };
    const [b0, bAge, bCal] = solve3(X, Y);
    console.log(`  (b) 합동 회귀 단가 = ${won(b0)} + 나이×${bAge.toFixed(1)} + 달력×${bCal.toFixed(1)}  (원/월 · n=${monthly.length}) → 달력 ${won(bCal * 12)}원/년 · 나이 ${won(bAge * 12)}원/년`);
    // (c) 최근 6달 단면 — 2026-03~08에 자료 있는 매장끼리 개점 시기와 단가
    const recentFrom = calIdx("2026-03"), recentTo = calIdx("2026-08");
    const recent: { r: Row; unit: number; n: number }[] = [];
    for (const r of inc) {
      const ms = (byStore.get(r.code) ?? []).filter((m) => m.cal >= recentFrom && m.cal <= recentTo);
      if (ms.length >= 3) recent.push({ r, unit: mean(ms.map((m) => m.unit)), n: ms.length });
    }
    const rx = recent.map((q) => q.r.openIdx as number), ry = recent.map((q) => q.unit);
    console.log(`  (c) 최근 단면(2026-03~08, 3달 이상 ${recent.length}곳): 개점 시기 ↔ 그 기간 상품단가 r=${f3(corr(rx, ry))} · ρ=${f3(spearman(rx, ry))} · p=${permP(rx, ry).toFixed(4)}   (평가창 값끼리는 r +0.72)`);
    const cohort = new Map<number, number[]>();
    for (const q of recent) { const yr = 2023 + Math.floor((q.r.openIdx as number) / 12); cohort.set(yr, [...(cohort.get(yr) ?? []), q.unit]); }
    console.log(`      개점 연도별 **최근 단면** 중앙: ` + [...cohort].sort((a, b) => a[0] - b[0]).map(([yr, v]) => `${yr}년 ${v.length}곳 ${won(median(v))}`).join(" · ") + `   ← 평가창 중앙은 2023 1,287 · 2024 1,421 · 2025 1,626 · 2026 1,665`);
    console.log(`      → 최근 단면에서 연도 차이가 사라지면 달력(물가·메뉴 개편)이고, 남으면 세대(늦게 연 매장이 원래 높다)다`);
    // (d) 달력 분기별 전 매장 중앙 — 시계열
    const byQ = new Map<string, number[]>();
    for (const m of monthly) { const q = `${2023 + Math.floor(m.cal / 12)}Q${Math.floor((m.cal % 12) / 3) + 1}`; byQ.set(q, [...(byQ.get(q) ?? []), m.unit]); }
    console.log(`  (d) 달력 분기별 전 매장 상품단가 중앙(매장 수): ` + [...byQ].sort().map(([q, v]) => `${q} ${won(median(v))}(${v.length})`).join(" · "));
    // (e) 개점 시기를 통제한 뒤 특수수요 유형 — 평가창 단가에서 개점 시기 선형을 뺀 잔차
    const ox = inc.map((r) => r.openIdx as number), oy = inc.map((r) => r.prodUnit);
    const mox = mean(ox), moy = mean(oy); const bo = ox.reduce((a, v, i) => a + (v - mox) * (oy[i] - moy), 0) / ox.reduce((a, v) => a + (v - mox) ** 2, 0);
    const resid = inc.map((r, i) => r.prodUnit - (moy + bo * ((r.openIdx as number) - mox)));
    const byType = new Map<string, number[]>();
    inc.forEach((r, i) => byType.set(r.type, [...(byType.get(r.type) ?? []), resid[i]]));
    const noneRes = byType.get("없음") ?? [];
    console.log(`  (e) 개점 시기 통제 후 유형별 잔차 중앙(원): ` + ["없음", "대학가", "산업단지", "관광유흥", "군부대", "기타"].filter((t) => byType.has(t)).map((t) => { const v = byType.get(t)!; const p = t !== "없음" && v.length >= 5 ? ` p=${mannWhitneyP(v, noneRes).toFixed(3)}` : ""; return `${t} ${v.length}곳 ${won(median(v))}${p}`; }).join(" · "));
    const anyRes = inc.map((r, i) => [r.type, resid[i]] as const).filter(([t]) => t !== "없음").map(([, v]) => v);
    console.log(`      유형 있음 ${anyRes.length}곳 잔차 중앙 ${won(median(anyRes))} vs 없음 ${won(median(noneRes))} · p=${mannWhitneyP(anyRes, noneRes).toFixed(4)}   (통제 전 p 0.0000)`);
    // (f) 개점 시기가 다른 변수와 얽혀 있나 — 세대 효과의 정체를 자료가 말해 주는지(사실만)
    const withFlow = inc.filter((r) => r.lnFlow != null);
    console.log(`  (f) 개점 시기 ↔ 다른 변수 r: ln유동500 ${f3(corr(withFlow.map((r) => r.openIdx as number), withFlow.map((r) => r.lnFlow as number)))} · 정가 ${f3(corr(ox, inc.map((r) => r.rate)))} · PC수 ${f3(corr(ox, inc.map((r) => r.pc)))} · 가동률 ${f3(corr(ox, inc.map((r) => r.actU)))} · 상품비중 ${f3(corr(ox, inc.map((r) => r.prodShare)))}`);
    const residFlow = withFlow.map((r) => resid[inc.indexOf(r)]);
    console.log(`      개점 시기 통제 후 잔차 ↔ ln유동500 r=${f3(corr(residFlow, withFlow.map((r) => r.lnFlow as number)))} · ↔ 정가 r=${f3(corr(resid, inc.map((r) => r.rate)))}   ← 개점 시기가 유동·정가를 대신 말하고 있는 건지, 따로인지`);
    expect(monthly.length).toBeGreaterThan(300);
  });

  it("(7) 상수 대신 달력 추세를 쓰면 — LOO + 지금 여는 매장이 마주할 값", () => {
    // 다른 매장의 평가창 달들로 단가 ~ 달력 직선을 맞추고, 이 매장 평가창 달들의 추세값 평균을 예측으로 쓴다.
    const winM = monthly.filter((m) => m.inWin);
    const fit = (ms: M[]) => { const x = ms.map((m) => m.cal), y = ms.map((m) => m.unit); const mx = mean(x), my = mean(y); const b = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0) / x.reduce((a, v) => a + (v - mx) ** 2, 0); return (c: number) => my + b * (c - mx); };
    const errs: number[] = [], aes: number[] = [];
    for (const r of inc) {
      const own = winM.filter((m) => m.code === r.code); if (!own.length) continue;
      const f = fit(winM.filter((m) => m.code !== r.code));
      const pred = mean(own.map((m) => f(m.cal)));
      errs.push(pred / r.prodUnit - 1); aes.push(Math.abs(pred - r.prodUnit));
    }
    console.log(`\n[LOO — 달력 추세(평가창 달별 합동 직선)] ${errs.length}곳: |오차| ${pct(mean(errs.map(Math.abs)))} · MAE ${won(mean(aes))}원 · 편향 ${pct(mean(errs))} · ±10% 안 ${errs.filter((e) => Math.abs(e) <= 0.1).length}/${errs.length}   (상수 1,493: |오차| 14.4% · MAE 201 · ±10% 안 17/38)`);
    const fAll = fit(winM);
    const now = calIdx("2026-08");
    console.log(`  전 매장 직선: ${ymLabel(calIdx("2023-10"))} ${won(fAll(calIdx("2023-10")))} → ${ymLabel(now)} ${won(fAll(now))} → 2027-04(지금 여는 매장의 평가창 가운데) ${won(fAll(calIdx("2027-04")))}원  · 상수 1,493은 ${ymLabel(Math.round(winM.reduce((a, m) => a + m.cal, 0) / winM.length))} 무렵의 값`);
    const recent12 = monthly.filter((m) => m.cal > now - 12);
    console.log(`  최근 12달(2025-09~2026-08) 전 매장 달별 단가 중앙 ${won(median(recent12.map((m) => m.unit)))}원 (${new Set(recent12.map((m) => m.code)).size}곳 ${recent12.length}건) · 최근 6달 중앙 ${won(median(monthly.filter((m) => m.cal > now - 6).map((m) => m.unit)))}원`);
    console.log(`  ⭐ 읽는 법 — (6)(c)에서 달력이면 후보지 상품몫은 "여는 시점의 수준"이 맞고 1,493(2023~26 평균)은 지금 여는 매장에 낮다. 세대면 개점 시기는 후보지에서도 아는 값이라 그대로 넣을 수 있다.`);
    console.log(`     어느 쪽이든 **채택은 아니다** — 재고 표는 성적표(가동률 판정)에 안 걸리고 매출 환산 폭만 바꾼다. 사용자 결정.`);
    expect(errs.length).toBeGreaterThan(30);
  });
});
