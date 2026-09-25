// 가동률 창을 2~12개월차로 바꾼 뒤 — **실측에서 나온 값들을 같은 창으로 다시 재면** 어디로 가나 (2026-09-25). 읽기전용.
// 본체/운영/Firestore 미변경. **계수를 고르지 않는다.** 재고 표 + 권고 → 사용자 결정.
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 사용자(2026-09-25 낮): *"가동률 기준값 수정했으니까 산식 검토해서 맞출 수 있는 건 다시 맞추는 게 좋겠네."*
// 산식엔 "고르는 계수"는 없지만 **실측에서 나온 값**이 넷 있고, 넷 다 옛 창(1~12개월차)에서 쟀다:
//   ① 축척 8.20h        — 원장 "오픈 1년 안 4곳"(광주첨단 1개월차 · 문산 개점 달 · 증평 6 · 발산역 7~9). 새 창(2~12)엔 증평·발산역만 든다
//   ② 상품몫 1,493원     — 38곳 직접 측정(09-21, 1~12 창)
//   ③ 몫 상한 80%(k0.25) — 독점 자사 4곳 실제 몫 68~83%(탕정역·구미산동·남악·광주각화) → 실측 가동률이 오르면 몫도 오른다
//   ④ 특수수요 배수 2.0/1.3/1.4/1.4 — 높음 매장의 함의(실측÷배수 없는 예측)에서 정함
// θ3·존구성·λ0·gravity·β0.546은 실측 창과 무관한 선택/운영값이라 여기서 안 건드린다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 각 값을 새 창에서 **다시 잰다**(재측정값). 표본이 줄면(축척 n=2) 그 사실을 크게 적는다.
// 2. 재고 표: 지금 · ①만 · ③만 · ④만 · ①③④ 합 — `_layerSplit` (6) 잣대(전체 MAE · 이해되는 오차 · ±5%p · 33곳 편향) + 후보지 13곳 평균 이동.
//    ②는 가동률 성적에 안 걸린다(매출 환산만) — 값만 적는다.
// 3. 권고 기준(고정): 재측정이 "정의를 맞춘 것"이면 성적과 무관하게 권고. 다만 표본이 2곳이면 "재측정값"이 아니라 "참고"로 낮춘다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_windowRefit.test.ts --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { LAB_UPSIDE_STORE_CODES, buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, productUnitPriceOfStore, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, utilizationWindowMonths, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const MONTH_HOURS = 720;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pp = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}`;
const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

// ① 원장 1인당 월 이용시간(h) — `_ledgerPerUser.test.ts` 2026-09-25 실행값(관문 8/8 통과). 개월차는 그 하네스 출력.
const LEDGER_HOURS: { name: string; monthIdx: number; hours: number }[] = [
  { name: "광주첨단점", monthIdx: 1, hours: 8.58 },
  { name: "문산점", monthIdx: 0, hours: 9.39 },
  { name: "증평점", monthIdx: 6, hours: 7.88 },
  { name: "발산역점", monthIdx: 7, hours: 6.95 }, // 2026-06~08 = 7~9개월차 합산
];

describeIf("가동률 창 2~12개월차 — 실측 유래 값 재측정 + 재고 표", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const qscByStoreCode = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as QscSite[]) { const code = doc.storeCode ?? doc.id; const avg = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null); if (code && avg != null) qscByStoreCode.set(code, avg); }
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
  const residentRadiusByCode = residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []);
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
  const P: TextbookParams = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locByCode = new Map<string, LocationEvaluation>(((snap.locationEvaluations ?? []) as LocationEvaluation[]).map((l) => [l.candidateCode, l]));
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement: franchiseManagementFromRows(rows), residentRingsByCode, ringBlockedByCode, residentRadiusByCode });

  const own = rows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
  const isUp = (code: string) => LAB_UPSIDE_STORE_CODES.has(code);
  const errsOf = (p: TextbookParams) => own.map((r) => ({ code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(r.input, p).utilization ?? NaN) - (r.input.actualUtilization as number) })).filter((x) => Number.isFinite(x.e));
  type E = ReturnType<typeof errsOf>;
  const okErr = (x: E[number]) => (isUp(x.code) && x.e < 0 ? 0 : Math.abs(x.e));
  const score = (p: TextbookParams) => {
    const xs = errsOf(p);
    const cand = candRows.map((r) => computeTextbook(r.input, p).utilization ?? NaN).filter(Number.isFinite);
    const cand0 = candRows.map((r) => computeTextbook(r.input, P).utilization ?? NaN).filter(Number.isFinite);
    return { maeAll: mean(xs.map((x) => Math.abs(x.e))), maeOk: mean(xs.map(okErr)), w5: xs.filter((x) => okErr(x) <= 0.05).length, biasEx: mean(xs.filter((x) => !isUp(x.code)).map((x) => x.e)),
      over10: xs.filter((x) => Math.round(Math.abs(x.e) * 1000) >= 100).length, candShift: mean(cand) - mean(cand0), n: xs.length };
  };

  // ── 재측정 ──────────────────────────────────────────────────────────────
  // ① 축척
  const ledgerNew = LEDGER_HOURS.filter((l) => l.monthIdx >= 2 && l.monthIdx <= 12);
  const hoursNew = mean(ledgerNew.map((l) => l.hours));
  // ② 상품몫 — _unitPriceLayer와 같은 정의(2~12개월차 Σ÷Σ), 모델 포함 매장만
  type Sale = { storeCode: string; yearMonth: string; pcSales?: number | null; productSales?: number | null; utilizationRate?: number | null };
  const salesBy = new Map<string, Sale[]>(); for (const s of (snap.sales ?? []) as Sale[]) salesBy.set(s.storeCode, [...(salesBy.get(s.storeCode) ?? []), s]);
  const prodUnits: number[] = [];
  for (const s of snap.existingStores as { storeCode: string; openedAt: string | null; pcCount?: number | null; evaluationPcCount?: number | null; excludedFromModel?: boolean | null }[]) {
    if (s.excludedFromModel) continue; const pc = s.evaluationPcCount ?? s.pcCount; if (!pc) continue;
    const sum = (months: string[]) => { const w = new Set(months); let prod = 0, hours = 0; for (const m of salesBy.get(s.storeCode) ?? []) { if (!w.has(m.yearMonth) || !(m.utilizationRate && m.utilizationRate > 0) || !((m.pcSales ?? 0) > 0)) continue; prod += m.productSales ?? 0; hours += pc * MONTH_HOURS * m.utilizationRate; } return hours > 0 ? prod / hours : null; };
    const v = sum(utilizationWindowMonths(s.openedAt)) ?? sum(evaluationMonths(s.openedAt)); // 2개월차 이후 없으면 1개월차(저장 로직 폴백)
    if (v != null) prodUnits.push(v);
  }
  // 옛 창(1~12) 행 — ③④가 창 때문에 움직였는지, 09-24 이후 산식 변경 때문인지 가르기 위해
  const util1 = new Map<string, number>();
  for (const s of snap.existingStores as { storeCode: string; openedAt: string | null }[]) { const w = new Set(evaluationMonths(s.openedAt)); const vs = ((snap.sales ?? []) as Sale[]).filter((x) => x.storeCode === s.storeCode && w.has(x.yearMonth) && x.utilizationRate != null && (x.utilizationRate as number) > 0).map((x) => x.utilizationRate as number); if (vs.length) util1.set(s.storeCode, mean(vs)); }
  const rowsOld = buildLabRows({ stores, compsByCode, utilByStore: util1, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
  const ownOld = rowsOld.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0);
  // ③ 독점 4곳 실제 몫 = 실측 ÷ (수요시간÷(PC×720)) — _layerSplit requiredShare와 같은 정의
  const monopolyOf = (list: typeof own) => list.filter((r) => !(r.input.competitorIp ?? 0)).map((r) => { const b = computeTextbook(r.input, P); const act = r.input.actualUtilization as number; const utilIfAll = b.totalDemandHours / ((r.input.pcCount ?? 0) * MONTH_HOURS); return { name: r.input.storeName ?? "", act, utilIfAll, share: act / utilIfAll }; });
  const monopoly = monopolyOf(own), monopolyOld = monopolyOf(ownOld);
  // ④ 특수수요 높음 매장 함의 = 실측 ÷ 배수 없는 예측
  const noMul: TextbookParams = { ...P, specialDemandMultipliers: Object.fromEntries(Object.keys(P.specialDemandMultipliers).map((k) => [k, 1])) };
  const impliedOf = (list: typeof own) => list.filter((r) => r.input.specialDemandIntensity === "높음" && r.input.specialDemandType && r.input.specialDemandType !== "없음")
    .map((r) => ({ name: r.input.storeName ?? "", type: (r.input.specialDemandType as string).replace("·", ""), implied: (r.input.actualUtilization as number) / (computeTextbook(r.input, noMul).utilization ?? NaN), nowMul: P.specialDemandMultipliers[r.input.specialDemandType as string] ?? 1 }));
  const implied = impliedOf(own), impliedOld = impliedOf(ownOld);
  const impliedOldByName = new Map(impliedOld.map((x) => [x.name, x.implied]));
  const impliedByType = new Map<string, number[]>(); for (const x of implied) impliedByType.set(x.type, [...(impliedByType.get(x.type) ?? []), x.implied]);
  const mulNew: Record<string, number> = { ...P.specialDemandMultipliers };
  for (const [t, v] of impliedByType) { const m = Math.round(median(v) * 10) / 10; mulNew[t] = m; if (t === "관광유흥") mulNew["관광·유흥"] = m; }

  it("(1) 새 창에서 다시 잰 값 — 축척 · 상품몫 · 독점 몫 · 특수수요 함의", () => {
    console.log(`\n[① 축척 — 원장 1인당 월 이용시간(h)] 옛 창(1~12, 개점 달 포함) 4곳 평균 ${mean(LEDGER_HOURS.map((l) => l.hours)).toFixed(2)} = 지금 8.20`);
    for (const l of LEDGER_HOURS) console.log(`     ${pad(l.name, 10)} ${String(l.monthIdx).padStart(2)}개월차  ${l.hours.toFixed(2)}h  ${l.monthIdx >= 2 ? "← 새 창 안" : "✗ 새 창 밖(첫 달·개점 달)"}`);
    console.log(`   새 창(2~12개월차) ${ledgerNew.length}곳 평균 **${hoursNew.toFixed(2)}h** (${ledgerNew.map((l) => l.hours.toFixed(2)).join(" · ")}) · 지금 대비 ${pp(hoursNew / P.hoursPerUserPerMonth - 1)}%`);
    console.log(`   ⚠️ 표본 2곳. 개점 달·첫 달의 1인당 시간(9.39 · 8.58)이 뒤 달(7.88 · 6.95)보다 길다 — 오픈 초기 손님이 오래 앉는다(단골 축적과 반대 방향). 축척을 옮기려면 원장 2~3곳이 더 있어야 한다.`);
    console.log(`\n[② 상품몫 — 2~12개월차 Σ상품매출÷Σ(PC×720×가동률), 모델 포함 ${prodUnits.length}곳] 평균 **${won(mean(prodUnits))}** · 중앙 ${won(median(prodUnits))} · 지금 1,493 (옛 창 38곳 평균) · 차 ${pp(mean(prodUnits) / P.productUnitPrice - 1)}%`);
    console.log(`\n[③ 독점 자사 실제 몫(필요 점유율) — 새 창 실측] 상한 80% = 1/(1+k0.25). 옛 창: 탕정역 68 · 구미산동 72 · 남악 83 · 광주각화 83`);
    const oldShareByName = new Map(monopolyOld.map((m) => [m.name, m.share]));
    for (const m of monopoly) console.log(`     ${pad(m.name, 10)} 실측 ${(m.act * 100).toFixed(1)}% ÷ 전부 먹으면 ${(m.utilIfAll * 100).toFixed(1)}% = 몫 ${(m.share * 100).toFixed(0)}%   (옛 창 실측으로는 ${((oldShareByName.get(m.name) ?? NaN) * 100).toFixed(0)}%)`);
    const shares = monopoly.map((m) => m.share), sharesOld = monopolyOld.map((m) => m.share);
    console.log(`   새 창 중앙 ${(median(shares) * 100).toFixed(0)}% → k ${(1 / median(shares) - 1).toFixed(2)} · 옛 창 중앙 ${(median(sharesOld) * 100).toFixed(0)}% → k ${(1 / median(sharesOld) - 1).toFixed(2)} (지금 0.25 = 80%)`);
    console.log(`   ⚠️ 옛 창으로도 몫이 09-24 기록(68~83)과 다르면 그건 창이 아니라 그 뒤 산식 변경(강도 문·반경·배수) 때문이다 — 구미산동은 경쟁 IP가 생겨 독점에서 빠짐.`);
    console.log(`\n[④ 특수수요 높음 매장 함의 — 실측 ÷ 배수 없는 예측] 지금 배수 군부대 2.0 · 대학가 1.3 · 산업단지 1.4 · 관광유흥 1.4`);
    for (const x of implied) console.log(`     ${pad(x.name, 12)} ${pad(x.type, 6)} 함의 ${x.implied.toFixed(2)}  (옛 창 ${(impliedOldByName.get(x.name) ?? NaN).toFixed(2)} · 지금 배수 ${x.nowMul.toFixed(1)})`);
    for (const [t, v] of impliedByType) console.log(`   ${pad(t, 6)} ${v.length}곳 중앙 ${median(v).toFixed(2)} → 0.1 단위 ${mulNew[t].toFixed(1)}  (지금 ${(P.specialDemandMultipliers[t] ?? P.specialDemandMultipliers[t.replace("유흥", "·유흥")] ?? 1).toFixed(1)})`);
    console.log(`   ⚠️ 함의는 "그 매장을 딱 맞히는 배수"라 채택 기준이 아니다(09-24 규칙: 유형·강도는 자료, 배수는 높음 매장 여럿의 중앙). 옛 창과 0.1 이상 다른 유형만 뜻이 있다.`);
    expect(monopoly.length).toBeGreaterThan(2);
  });

  it("(2) 재고 표 — 재측정값을 하나씩·같이 넣으면 (가동률 잣대)", () => {
    const kNew = Math.round((1 / median(monopoly.map((m) => m.share)) - 1) * 100) / 100;
    // 유형별로 하나씩만 바꾼 변형 + 자기 제외(LOO) 배수 — "지금 배수가 최적인가"(사용자 2026-09-25)
    const oneType = (t: string, v: number): TextbookParams => ({ ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, [t]: v, ...(t === "관광유흥" ? { "관광·유흥": v } : {}) } });
    const variants: { label: string; p: TextbookParams; note: string }[] = [
      { label: `지금(${P.hoursPerUserPerMonth} · k${P.ownShareCapK} · 배수 현행)`, p: P, note: "기준선" },
      ...[...impliedByType].filter(([t]) => t !== "기타" && t !== "없음").map(([t, v]) => { const m = Math.round(median(v) * 10) / 10; const now = P.specialDemandMultipliers[t] ?? P.specialDemandMultipliers[t.replace("유흥", "·유흥")] ?? 1; return { label: `  ${t} ${now} → ${m}만`, p: oneType(t, m), note: `${v.length}곳 함의 ${v.map((x) => x.toFixed(2)).join("·")}` }; }),
      { label: "  기타 1.0 → 1.1만", p: oneType("기타", 1.1), note: `${(impliedByType.get("기타") ?? []).length}곳 함의 ${(impliedByType.get("기타") ?? []).map((x) => x.toFixed(2)).join("·")}` },
      { label: `① 축척 ${hoursNew.toFixed(2)}h`, p: { ...P, hoursPerUserPerMonth: hoursNew }, note: "원장 2곳뿐 — 참고" },
      { label: `③ 몫 상한 k${kNew.toFixed(2)}`, p: { ...P, ownShareCapK: kNew }, note: "독점 4곳 새 창 몫 중앙" },
      { label: "④ 배수 재측정(중앙, 0.1 단위)", p: { ...P, specialDemandMultipliers: mulNew }, note: Object.entries(mulNew).filter(([k]) => !k.includes("·")).map(([k, v]) => `${k} ${v}`).join(" ") },
      { label: "①③④ 같이", p: { ...P, hoursPerUserPerMonth: hoursNew, ownShareCapK: kNew, specialDemandMultipliers: mulNew }, note: "" },
      { label: "③④ 같이(축척 제외)", p: { ...P, ownShareCapK: kNew, specialDemandMultipliers: mulNew }, note: "" },
    ];
    console.log(`\n[재고 표 — 자사 ${own.length}곳 · 후보지 ${candRows.length}곳] 전체 MAE · 이해되는 오차 · ±5%p · 33곳 편향 · 10%p↑ · 후보지 평균 이동`);
    console.log(`  ${pad("변형", 32)} ${"전체".padStart(6)} ${"이해".padStart(6)} ${"±5".padStart(5)} ${"편향".padStart(7)} ${"10↑".padStart(4)} ${"후보지Δ".padStart(8)}  비고`);
    for (const v of variants) {
      const s = score(v.p);
      console.log(`  ${pad(v.label, 32)} ${(s.maeAll * 100).toFixed(2).padStart(6)} ${(s.maeOk * 100).toFixed(2).padStart(6)} ${`${s.w5}/${s.n}`.padStart(5)} ${pp(s.biasEx, 2).padStart(7)} ${String(s.over10).padStart(4)} ${(pp(s.candShift, 1) + "p").padStart(8)}  ${v.note}`);
    }
    // 자기 제외(LOO) 배수 — 각 높음 매장에 "같은 유형의 다른 높음 매장 함의 중앙"을 배수로. 자기 함의로 자기를 맞히지 않는 공정한 잣대. 같은 유형이 자기뿐이면 지금 배수.
    {
      const errs = own.map((r) => {
        const t = (r.input.specialDemandType ?? "").replace("·", "");
        const hi = r.input.specialDemandIntensity === "높음" && t && t !== "없음";
        let p = P;
        if (hi) { const others = implied.filter((x) => x.type === t && x.name !== (r.input.storeName ?? "")).map((x) => x.implied); if (others.length >= 1) p = oneType(t, Math.round(median(others) * 10) / 10); }
        return { code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(r.input, p).utilization ?? NaN) - (r.input.actualUtilization as number) };
      }).filter((x) => Number.isFinite(x.e));
      console.log(`  ${pad("  배수 LOO(다른 매장 함의 중앙)", 32)} ${(100 * mean(errs.map((x) => Math.abs(x.e)))).toFixed(2).padStart(6)} ${(100 * mean(errs.map(okErr))).toFixed(2).padStart(6)} ${`${errs.filter((x) => okErr(x) <= 0.05).length}/${errs.length}`.padStart(5)} ${pp(mean(errs.filter((x) => !isUp(x.code)).map((x) => x.e)), 2).padStart(7)} ${String(errs.filter((x) => Math.round(Math.abs(x.e) * 1000) >= 100).length).padStart(4)} ${"-".padStart(8)}  공정 잣대 — 지금 줄보다 나쁘면 재측정 배수는 그 매장 맞히기`);
    }
    // 강도 "보통"인 특수수요 매장 — 지금은 문에 막혀 배수 1. 함의가 1보다 크게 높으면 "보통에도 일부" 여지, 1 근처면 문이 맞다.
    const mid = own.filter((r) => r.input.specialDemandIntensity === "보통" && r.input.specialDemandType && r.input.specialDemandType !== "없음")
      .map((r) => ({ name: r.input.storeName ?? "", type: (r.input.specialDemandType as string).replace("·", ""), implied: (r.input.actualUtilization as number) / (computeTextbook(r.input, noMul).utilization ?? NaN) }));
    console.log(`  강도 보통 매장 함의(배수 없는 예측 대비): ` + mid.map((x) => `${x.name} ${x.type} ${x.implied.toFixed(2)}`).join(" · ") + `  ← 1 근처면 "높음에만" 문이 맞다`);
    console.log(`  ⭐ 읽는 법 — 정의를 맞춘 재측정(③④)은 성적이 아니라 뜻으로 고른다. ①은 표본 2곳이라 성적이 좋아져도 채택 근거가 못 된다. ②(상품몫)는 가동률에 안 걸린다.`);
    expect(variants.length).toBeGreaterThan(6);
  });

  it("(3) 상품몫 상수별 기존점 매출 환산 — 전체와 개점 세대별 (규칙 1,721은 새 매장을 겨냥해 옛 세대엔 높게 나온다)", () => {
    // 사용자(2026-09-25): "상품몫 올리면서 개선된 건 뭐임?" — 기존점 성적표 전체로는 좋아질 리 없다. 예측 대상(최근 세대)에서만 좋아진다. 그걸 숫자로.
    const yearOf = new Map((snap.existingStores as { storeCode: string; openedAt: string | null }[]).map((s) => [s.storeCode, (s.openedAt ?? "").slice(0, 4)]));
    const withRev = own.filter((r) => r.actualRevenue > 0);
    const line = (label: string, c: number) => {
      const p = { ...P, productUnitPrice: c };
      const errs = withRev.map((r) => ({ yr: yearOf.get(r.input.storeCode) ?? "?", e: (computeTextbook(r.input, p).monthlyRevenue ?? NaN) / r.actualRevenue - 1 })).filter((x) => Number.isFinite(x.e));
      const byY = new Map<string, number[]>(); for (const x of errs) byY.set(x.yr, [...(byY.get(x.yr) ?? []), x.e]);
      const recent = errs.filter((x) => x.yr >= "2025").map((x) => x.e);
      console.log(`  ${pad(label, 14)} 전체 ${errs.length}곳 MAPE ${(100 * mean(errs.map((x) => Math.abs(x.e)))).toFixed(1)}% · 편향 ${pp(mean(errs.map((x) => x.e)))}% | 세대별 편향 ` +
        [...byY].sort().map(([y, v]) => `${y} ${pp(mean(v))}%(${v.length})`).join(" · ") +
        ` | 2025~26 ${recent.length}곳 MAPE ${(100 * mean(recent.map(Math.abs))).toFixed(1)}% · 편향 ${pp(mean(recent))}%`);
    };
    console.log(`\n[매출 환산 — 예측 가동률 × PC × 720 × (PC몫 + 상품몫) vs 실매출] 가동률 오차가 섞여 있다(단가층만 보려면 _unitPriceLayer)`);
    line("상품몫 1,493", 1493); line("상품몫 1,471", 1471); line("상품몫 1,721(규칙)", 1721);
    // 사용자(2026-09-25): "개점 당시 12개월이니까 시점별로 적용하는 건 어떤데" — 기존점은 자기 세대 수준으로, 후보지는 최신 규칙값으로.
    // 세대 수준 = 같은 개점 연도 매장의 실측 중앙, **자기 자신은 뺀다**(LOO — 자기 값으로 자기를 맞히지 않게). 그 해에 자기 말고 3곳 미만이면 앞뒤 해까지.
    const unitOf = new Map<string, number>();
    for (const s of snap.existingStores as { storeCode: string; openedAt: string | null; pcCount?: number | null; evaluationPcCount?: number | null; excludedFromModel?: boolean | null }[]) {
      if (s.excludedFromModel) continue; const r = productUnitPriceOfStore((snap.sales ?? []) as Sale[], s); if (r) unitOf.set(s.storeCode, r.unit);
    }
    const cohortValue = (code: string): number => {
      const yr = Number(yearOf.get(code));
      for (const span of [0, 1, 2]) {
        const peers = [...unitOf].filter(([c]) => c !== code && Math.abs(Number(yearOf.get(c)) - yr) <= span).map(([, v]) => v);
        if (peers.length >= 3) return median(peers);
      }
      return 1721;
    };
    {
      const errs = withRev.map((r) => ({ yr: yearOf.get(r.input.storeCode) ?? "?", c: cohortValue(r.input.storeCode), e: (computeTextbook(r.input, { ...P, productUnitPrice: cohortValue(r.input.storeCode) }).monthlyRevenue ?? NaN) / r.actualRevenue - 1 })).filter((x) => Number.isFinite(x.e));
      const byY = new Map<string, number[]>(); for (const x of errs) byY.set(x.yr, [...(byY.get(x.yr) ?? []), x.e]);
      const recent = errs.filter((x) => x.yr >= "2025").map((x) => x.e);
      const cv = new Map<string, number[]>(); for (const x of errs) cv.set(x.yr, [...(cv.get(x.yr) ?? []), x.c]);
      console.log(`  ${pad("세대별(자기 제외 중앙)", 14)} 전체 ${errs.length}곳 MAPE ${(100 * mean(errs.map((x) => Math.abs(x.e)))).toFixed(1)}% · 편향 ${pp(mean(errs.map((x) => x.e)))}% | 세대별 편향 ` +
        [...byY].sort().map(([y, v]) => `${y} ${pp(mean(v))}%(${v.length})`).join(" · ") +
        ` | 2025~26 ${recent.length}곳 MAPE ${(100 * mean(recent.map(Math.abs))).toFixed(1)}% · 편향 ${pp(mean(recent))}%`);
      console.log(`     세대별 적용값 중앙: ` + [...cv].sort().map(([y, v]) => `${y} ${won(median(v))}`).join(" · ") + ` · 후보지는 최신 규칙값 1,721`);
    }
    console.log(`  ⭐ 읽는 법 — 규칙 상수는 "새로 여는 매장"을 겨냥한 값이라 2023~24 세대 기존점은 높게 나오는 게 맞다. 기존점 전체 MAPE로 이 상수를 고르면 다시 전 세대 평균으로 돌아간다(되짚기 편향 −11%).`);
    expect(withRev.length).toBeGreaterThan(30);
  });
});
