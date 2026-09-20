// 광주첨단점 −54.6% — 꼬리 1등을 개별로 판다 (2026-09-21)
//
// 인계문 지시: *"(b) 전표가 아직이면 광주첨단점(-54.6%)을 열어라. 꼬리 6곳 중 제일 큰데
// 아무도 안 봤다."* 방식은 문경에서 한 그대로다 — **층을 가르고, 그 다음 원자료를 본다.**
//
// ── 사전 등록 ─────────────────────────────────────────────────────────────
//
// ⚠️ **측정만 한다. 계수를 고르지 않는다.** 여기 나온 건 전부 재고 표다.
//
// 과녁에 재료가 들어가 있나 — 한 줄씩 적어 둔다(인계문 규칙):
//
//   (1)(2)(3)  매출오차·점유율·입지배율은 **모델이 뱉는 값**이다. 순환 없음.
//   (4)  자사PC÷유효경쟁IP — 분모가 점유율식에 **들어가 있다**. 그래서 "오차와의 상관"으로
//        읽지 않고 **광주첨단점이 표본 어디쯤인가**만 본다(순위표).
//   (5)  완료월 — 목표값 `actualMonthlyRevenueAvg`의 **정의에 들어가 있다**
//        (오픈 2개월차~최신 완료월 평균). 재료가 들어간 축이므로 상관을 증거로 쓰지 않는다.
//        대신 **예측을 고정한 채 목표만 다시 만들어** 얼마나 움직이는지 잰다.
//   (6)  경쟁점 측정 좌석률 — 점유율식에 **안 들어간다**(경쟁무게는 PC수x품질뿐).
//        게다가 광주첨단 경쟁점 조사는 2025-10-30으로 **우리 개점(2026-07-17) 9개월 전**이라
//        우리 실적이 그 값을 만들 수 없다. 순환 없음. 다만 방문 시각이 매장마다 달라
//        **절대 수준은 못 견준다** — 그래서 시각을 같이 찍는다.
//
// 관문(미리 박아 둔다. 결과를 보고 고치지 않는다):
//
//   관문 1  원자료가 틀렸나 — PC수·요금·가동률·경쟁점 조사 중 **하나라도** 표본에서
//           벗어난 값이 있으면 "자료 문제"로 보고 산식을 건드리지 않는다.
//   관문 2  목표값을 믿을 수 있나 — 완료월 1~2인 6곳의 **부호 있는** 오차 평균이
//           나머지 32곳과 같은 쪽·같은 크기면 "어린 매장이라서"가 아니다.
//   관문 3  광주첨단점만의 사정인가 — (4) 순위에서 표본 끝(상·하위 3위 안)에 있지 않으면
//           "이 매장 고유"라는 설명은 못 쓴다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_gwangjuChumdan.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, computeQualityScore,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const TARGET = "광주첨단점";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("광주첨단점 −54.6% — 개별 조사", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const sc = scoreTextbook(rows, P);
  const full = fittedParams(P, sc);
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;
  const target = rows.find((r) => nameOf(r) === TARGET);
  const scored = sc.rows.find((x) => (x.storeName ?? x.storeCode) === TARGET);

  /** 점유율 분모에 실제로 들어가는 경쟁 — `competitorIp`가 아니다(유효거리로 걸러진다). */
  const rivalIp = (r: LabRow) => (r.input.rivals ?? [])
    .filter((x) => x.ip > 0 && (x.distanceM == null || x.distanceM <= P.effectiveRadiusM))
    .reduce((s, x) => s + x.ip, 0);

  it("(1) 층 가르기 — 어느 층에서 얼마가 어긋나나", () => {
    expect(target).toBeTruthy();
    expect(scored).toBeTruthy();
    if (!target || !scored) return;
    const b = computeTextbook(target.input, full);
    const i = target.input;
    const f = (v: number | null | undefined, d = 0) =>
      v == null || !Number.isFinite(v) ? "자료없음" : Math.round(v * 10 ** d) / 10 ** d;

    console.log(`\n[${TARGET}] 층 가르기 — 매출 = 수요 x 점유율 x 단가`);
    console.log(`  개점 ${(snap.existingStores.find((s: { storeName?: string }) => s.storeName === TARGET) ?? {}).openedAt}`
      + ` · 완료월 ${(snap.existingStores.find((s: { storeName?: string }) => s.storeName === TARGET) ?? {}).completedMonths}`);
    console.log(`\n  1층 수요   주거몫 ${f(b.residentDemandUsers)}명 + 유동몫 ${f(b.floatingDemandUsers)}명`
      + ` = ${f(b.totalDemandUsers)}명 -> ${f(b.totalDemandHours)}시간`);
    console.log(`             주거1km ${i.pop1km?.toLocaleString()} · 유동400m ${i.floatingByRadius[400]?.toLocaleString()}`
      + ` · 특수수요 ${i.specialDemandType}(배수 ${P.specialDemandMultipliers[i.specialDemandType ?? "없음"] ?? 1})`);
    console.log(`\n  2층 점유율 예측 ${((b.share ?? 0) * 100).toFixed(1)}%  ·  필요 ${scored.requiredShare == null ? "-" : (scored.requiredShare * 100).toFixed(1) + "%"}`
      + `  ·  입지배율 ${(b.locationMultiplier ?? 1).toFixed(3)}`);
    console.log(`             자사PC ${i.pcCount} · 유효경쟁IP ${rivalIp(target)} · 바깥선택지 ${P.outsideOptionIp}`);
    console.log(`             입지 분해: ${b.locationFactors.map((x) => `${x.key} x${x.value.toFixed(3)}`).join(" · ") || "(없음)"}`);
    console.log(`\n  3층 단가   총단가 ${f(b.unitPrice)}원/PC·시간 = PC몫 ${f(b.pcUnitPrice)} + 상품몫 ${f(full.productUnitPrice)}`);
    console.log(`             정가 ${i.hourlyRate}원 · 기준정가 ${P.referenceHourlyRate}원 · 탄력도 ${P.rateElasticity}`);
    console.log(`\n  결과       예측 ${f(scored.predicted)}원  vs  실측 ${f(scored.actual)}원`
      + `   오차 ${(((scored.predicted ?? 0) / scored.actual - 1) * 100).toFixed(1)}%`);
    console.log(`             예측가동률 ${((b.utilization ?? 0) * 100).toFixed(1)}%  vs  실측 ${((i.actualUtilization ?? 0) * 100).toFixed(1)}%`
      + `  (경쟁 빼면 ${((scored.utilizationNoShare ?? 0) * 100).toFixed(1)}%)`);
    console.log(`\n  ⚠️ 단가층 몫 = |매출오차| − 가동률오차 = ${((Math.abs((scored.predicted ?? 0) / scored.actual - 1) - (scored.utilErrPct ?? 0)) * 100).toFixed(1)}%p`);
  });

  it("(2) 경쟁점 다섯 곳 — 한 곳이 경쟁무게를 얼마씩 지고 있나", () => {
    expect(target).toBeTruthy();
    if (!target) return;
    const i = target.input;
    const oq = i.ownQualityParts ? computeQualityScore(i.ownQualityParts, P.qualityWeights) : null;
    console.log(`\n[${TARGET}] 경쟁무게 분해 — 자사품질 ${oq == null ? "자료없음" : oq.toFixed(3)} · 품질지수 θ=${P.qualityExponent} · 유효거리 ${P.effectiveRadiusM}m`);
    console.log("  경쟁점                거리   PC수   품질    품질비   비^θ    경쟁무게   분모몫");
    let total = 0;
    const parts: { name: string; w: number }[] = [];
    for (const r of i.rivals ?? []) {
      if (!(r.ip > 0)) continue;
      if (r.distanceM != null && r.distanceM > P.effectiveRadiusM) continue;
      const q = r.parts ? computeQualityScore(r.parts, P.qualityWeights) : null;
      const ratio = oq == null || !(oq > 0) || q == null || !(q > 0) ? 1 : q / oq;
      const w = r.ip * Math.pow(ratio, P.qualityExponent);
      total += w;
      parts.push({ name: r.name ?? "(이름없음)", w });
    }
    const denom = (i.pcCount ?? 0) + total + P.outsideOptionIp;
    for (const r of i.rivals ?? []) {
      if (!(r.ip > 0)) continue;
      if (r.distanceM != null && r.distanceM > P.effectiveRadiusM) continue;
      const q = r.parts ? computeQualityScore(r.parts, P.qualityWeights) : null;
      const ratio = oq == null || !(oq > 0) || q == null || !(q > 0) ? 1 : q / oq;
      const w = r.ip * Math.pow(ratio, P.qualityExponent);
      console.log(`  ${(r.name ?? "-").padEnd(20)}${(r.distanceM == null ? "-" : String(Math.round(r.distanceM))).padStart(5)}m` +
        `${String(r.ip).padStart(6)}  ${q == null ? "   -  " : q.toFixed(3)}  ${ratio.toFixed(3).padStart(7)}` +
        `  ${Math.pow(ratio, P.qualityExponent).toFixed(3).padStart(6)}  ${w.toFixed(0).padStart(8)}  ${((w / denom) * 100).toFixed(1).padStart(6)}%`);
    }
    console.log(`  ${"자사".padEnd(20)}    -${String(i.pcCount).padStart(6)}  ${oq == null ? "   -  " : oq.toFixed(3)}` +
      `  ${(1).toFixed(3).padStart(7)}  ${(1).toFixed(3).padStart(6)}  ${String(i.pcCount).padStart(8)}  ${(((i.pcCount ?? 0) / denom) * 100).toFixed(1).padStart(6)}%`);
    console.log(`  ${"바깥선택지".padEnd(20)}    -     -      -        -       -  ${String(P.outsideOptionIp).padStart(8)}  ${((P.outsideOptionIp / denom) * 100).toFixed(1).padStart(6)}%`);
    console.log(`\n  경쟁무게 합 ${total.toFixed(0)} (날 PC수 합 ${(i.rivals ?? []).filter((r) => r.ip > 0 && (r.distanceM == null || r.distanceM <= P.effectiveRadiusM)).reduce((s, r) => s + r.ip, 0)}대)` +
      ` · 분모 ${denom.toFixed(0)} · 날 점유율 ${(((i.pcCount ?? 0) / denom) * 100).toFixed(1)}%`);
    console.log(`  ⚠️ 품질비가 1보다 작으면 우리가 더 좋은 집이라 그 경쟁점을 덜 센다는 뜻이다.`);
  });

  it("(3) 표본 어디쯤인가 — 밀집도·자사몫 순위", () => {
    type R = { name: string; pc: number; rip: number; ratio: number; n: number; near: number | null; err: number | null };
    const xs: R[] = [];
    for (const r of rows) {
      const i = r.input;
      const near = (i.rivals ?? []).filter((z) => z.ip > 0 && z.distanceM != null).map((z) => z.distanceM as number);
      const x = sc.rows.find((y) => y.storeCode === i.storeCode);
      const rip = rivalIp(r);
      xs.push({
        name: nameOf(r), pc: i.pcCount ?? 0, rip,
        ratio: rip > 0 ? (i.pcCount ?? 0) / rip : Number.POSITIVE_INFINITY,
        n: (i.rivals ?? []).filter((z) => z.ip > 0 && (z.distanceM == null || z.distanceM <= P.effectiveRadiusM)).length,
        near: near.length ? Math.min(...near) : null,
        err: x && x.predicted != null && x.actual > 0 ? x.predicted / x.actual - 1 : null,
      });
    }
    const sorted = [...xs].sort((a, b) => a.ratio - b.ratio);
    const rank = sorted.findIndex((x) => x.name === TARGET) + 1;
    console.log(`\n[표본 위치] 자사PC ÷ 유효경쟁IP — 작을수록 경쟁에 눌린 자리 · n=${xs.length}`);
    console.log("   #  매장              자사PC  유효경쟁IP   비   경쟁점수  최근접   매출오차");
    for (let k = 0; k < sorted.length; k++) {
      const x = sorted[k];
      const mark = x.name === TARGET ? " <<<" : "";
      if (k >= 8 && k < sorted.length - 4 && x.name !== TARGET) continue;
      console.log(`  ${String(k + 1).padStart(2)}. ${x.name.padEnd(16)}${String(x.pc).padStart(6)}${String(x.rip).padStart(10)}` +
        `  ${Number.isFinite(x.ratio) ? x.ratio.toFixed(2).padStart(5) : "  inf"}  ${String(x.n).padStart(7)}` +
        `  ${x.near == null ? "    -" : String(Math.round(x.near)).padStart(5)}m` +
        `  ${x.err == null ? "      -" : (x.err * 100).toFixed(1).padStart(7) + "%"}${mark}`);
    }
    console.log(`\n  ${TARGET} 순위 ${rank}/${sorted.length}  (관문 3: 상·하위 3위 안이어야 "이 매장 고유"를 쓸 수 있다)`);
    expect(rank).toBeGreaterThan(0);
  });

  it("(4) 목표값을 믿을 수 있나 — 완료월 1~2인 여섯 곳", () => {
    // ⚠️ 완료월은 목표값 정의에 **들어간 재료**다. 상관을 증거로 쓰지 않는다(머리말 참고).
    //    여기서는 "어린 무리와 나머지가 같은 쪽으로 틀리나"만 본다.
    const meta = new Map<string, { months: number | null; opened: string | null }>();
    for (const s of (snap.existingStores ?? []) as { storeName?: string; completedMonths?: number | null; openedAt?: string | null }[]) {
      if (s.storeName) meta.set(s.storeName, { months: s.completedMonths ?? null, opened: s.openedAt ?? null });
    }
    type R = { name: string; months: number; err: number };
    const xs: R[] = [];
    for (const x of sc.rows) {
      const n = x.storeName ?? x.storeCode;
      const m = meta.get(n)?.months;
      if (m == null || x.predicted == null || !(x.actual > 0)) continue;
      xs.push({ name: n, months: m, err: x.predicted / x.actual - 1 });
    }
    const young = xs.filter((x) => x.months <= 2);
    const rest = xs.filter((x) => x.months > 2);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
    console.log(`\n[목표값 신뢰도] 완료월 ≤2 인 무리 vs 나머지`);
    console.log("  매장              완료월   매출오차");
    for (const x of [...young].sort((a, b) => a.err - b.err)) {
      console.log(`  ${x.name.padEnd(16)}${String(x.months).padStart(5)}   ${(x.err * 100).toFixed(1).padStart(7)}%${x.name === TARGET ? " <<<" : ""}`);
    }
    console.log(`\n  완료월 ≤2  ${String(young.length).padStart(2)}곳   부호평균 ${(mean(young.map((x) => x.err)) * 100).toFixed(1).padStart(6)}%  중앙 ${(med(young.map((x) => x.err)) * 100).toFixed(1).padStart(6)}%`);
    console.log(`  완료월 >2  ${String(rest.length).padStart(2)}곳   부호평균 ${(mean(rest.map((x) => x.err)) * 100).toFixed(1).padStart(6)}%  중앙 ${(med(rest.map((x) => x.err)) * 100).toFixed(1).padStart(6)}%`);
    console.log(`  ⚠️ 관문 2 — 두 줄이 같은 쪽·같은 크기면 "어린 매장이라서"는 설명이 못 된다.`);

    // 목표를 다시 만들어 본다 — **예측은 건드리지 않는다.** 실측만 "최근 12개월 평균"으로 바꾼다.
    const salesByStore = new Map<string, { ym: string; rev: number }[]>();
    for (const r of (snap.sales ?? []) as { storeCode?: string; yearMonth?: string; pcSales?: number; productSales?: number }[]) {
      if (!r.storeCode || !r.yearMonth) continue;
      const rev = (r.pcSales ?? 0) + (r.productSales ?? 0);
      if (!(rev > 0)) continue;
      salesByStore.set(r.storeCode, [...(salesByStore.get(r.storeCode) ?? []), { ym: r.yearMonth, rev }]);
    }
    console.log(`\n  [목표 다시 만들기] 지금 목표(2개월차~최신 평균) vs 최근 12개월 평균 — 예측은 고정`);
    console.log("  매장              완료월   지금목표     최근12평균    비   지금오차  바뀐오차");
    const shifts: { name: string; months: number; a: number; b: number }[] = [];
    for (const x of sc.rows) {
      const n = x.storeName ?? x.storeCode;
      const m = meta.get(n)?.months;
      const rs = salesByStore.get(x.storeCode);
      if (m == null || !rs || x.predicted == null || !(x.actual > 0)) continue;
      const sortedYm = [...rs].sort((a, b) => a.ym.localeCompare(b.ym));
      // 개점 달(첫 달)은 부분월이라 지금 목표도 뺀다 — 같은 규칙으로 맞춘다.
      const usable = sortedYm.slice(1);
      if (usable.length < 12) continue;
      const last12 = usable.slice(-12);
      const b12 = last12.reduce((s, v) => s + v.rev, 0) / 12;
      shifts.push({ name: n, months: m, a: x.actual, b: b12 });
      console.log(`  ${n.padEnd(16)}${String(m).padStart(5)}  ${Math.round(x.actual).toLocaleString().padStart(11)}` +
        `  ${Math.round(b12).toLocaleString().padStart(11)}  ${(b12 / x.actual).toFixed(2).padStart(5)}` +
        `  ${((x.predicted / x.actual - 1) * 100).toFixed(1).padStart(7)}%  ${((x.predicted / b12 - 1) * 100).toFixed(1).padStart(7)}%`);
    }
    if (shifts.length) {
      const rs = shifts.map((s) => s.b / s.a).sort((p, q) => p - q);
      console.log(`\n  최근12 ÷ 지금목표:  중앙 ${rs[Math.floor(rs.length / 2)].toFixed(3)} · 최소 ${rs[0].toFixed(3)} · 최대 ${rs[rs.length - 1].toFixed(3)} · n=${rs.length}`);
      console.log(`  ⚠️ 중앙이 1보다 크면 **지금 목표가 옛 달에 끌려 내려가 있다**는 뜻이다.`);
      console.log(`     그러면 오래된 매장이 과대예측으로 보이고, ${TARGET} 같은 어린 매장은 상대적으로`);
      console.log(`     과소예측으로 보인다 — 축척이 통째로 밀린다. **광주첨단점(완료월 1)은 이 표에 없다.**`);
    }
    expect(xs.length).toBeGreaterThan(30);
  });

  it("(5) 경쟁점이 비어 있었나 — 방문 측정 좌석률", () => {
    // 점유율식에 안 들어가는 축이다(경쟁무게 = PC수 x 품질). 광주첨단 경쟁점 조사는
    // 2025-10-30 — 우리 개점 9개월 전이라 우리 실적이 이 값을 만들 수 없다.
    // ⚠️ 방문 **시각**이 매장마다 다르다. 절대 수준을 견주면 안 된다 — 시각을 같이 찍는다.
    type C = { store: string; name: string; rate: number; at: string; pc: number };
    const xs: C[] = [];
    const nameByCode = new Map<string, string>();
    for (const s of (snap.existingStores ?? []) as { storeCode?: string; storeName?: string }[]) {
      if (s.storeCode && s.storeName) nameByCode.set(s.storeCode, s.storeName);
    }
    for (const c of snap.competitors as {
      candidateCode?: string; name?: string; measuredSeatRate?: number | null; visitedAt?: string | null; totalPcCount?: number | null;
    }[]) {
      const store = nameByCode.get(c.candidateCode ?? "");
      if (!store || c.measuredSeatRate == null || !(c.measuredSeatRate > 0)) continue;
      xs.push({ store, name: c.name ?? "-", rate: c.measuredSeatRate, at: c.visitedAt ?? "-", pc: c.totalPcCount ?? 0 });
    }
    const byStore = new Map<string, C[]>();
    for (const x of xs) byStore.set(x.store, [...(byStore.get(x.store) ?? []), x]);
    console.log(`\n[경쟁점 측정 좌석률] 측정된 경쟁점 ${xs.length}곳 / 전체 ${snap.competitors.length}곳 · 매장 ${byStore.size}곳`);
    const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
    const rank = [...byStore.entries()]
      .map(([s, v]) => ({ s, m: med(v.map((x) => x.rate)), n: v.length }))
      .sort((a, b) => a.m - b.m);
    console.log("   #  매장              측정경쟁점  좌석률중앙");
    for (let k = 0; k < rank.length; k++) {
      const r = rank[k];
      console.log(`  ${String(k + 1).padStart(2)}. ${r.s.padEnd(16)}${String(r.n).padStart(8)}${r.m.toFixed(1).padStart(12)}%${r.s === TARGET ? " <<<" : ""}`);
    }
    console.log(`\n  ${TARGET} 경쟁점 낱개 (방문 시각까지)`);
    for (const x of (byStore.get(TARGET) ?? []).sort((a, b) => a.rate - b.rate)) {
      console.log(`    ${x.name.padEnd(20)}PC ${String(x.pc).padStart(4)}대  좌석률 ${x.rate.toFixed(1).padStart(5)}%  방문 ${x.at}`);
    }
    console.log(`  ⚠️ 시각이 다르면 견줄 수 없다. 이 표는 **후보 표시**이지 판정이 아니다.`);
    expect(xs.length).toBeGreaterThan(0);
  });
});
