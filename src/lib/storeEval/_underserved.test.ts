// 전체 수요를 다 먹어도 실매출에 못 미치는 매장들 (2026-09-19)
//
// 사용자(2026-09-19): *"양주덕정,문경시청 이런데처럼 전체수요 다먹어도 실제매출 안뜨는
// 매장들 이런데를 봐야하는거겠지?"* — 맞다. 필요 점유율 100% 초과가 그 자다.
//
//   필요 점유율 = 실측 가동률 ÷ (경쟁이 없다고 볼 때의 예측 가동률)
//   100%를 넘으면 = 동네 수요를 우리가 **전부 다 먹어도** 실제 판 것에 못 미친다
//   -> 경쟁점을 어떻게 세든, 품질·입지를 어떻게 보든 못 고친다. **수요식이 작게 세고 있다.**
//
// ── 사용자의 가설 (2026-09-19, 네이버지도 직접 확인) ──────────────────────
// *"양주덕정점은 반경 2키로내에 인접 경쟁매장 빼고 PC방이 없어. 그렇다고 반경 2키로에
//   인구가 없는것도 아닌것같은데 (...) 아 양주덕정점 상가들이 학교근처에 있어서
//   못들어가네 다른 상권에 PC방이. 아마 예상이 얼추 맞을수도?"*
//
// 기전: 학교환경위생정화구역 때문에 주변 상권에 PC방이 **못 들어온다**
//       -> 그 동네 수요가 갈 곳이 우리밖에 없다
//       -> 400m 유동 · 1km 주거로 센 수요보다 **훨씬 넓은 데서 손님이 온다**
//       -> 산식이 수요를 작게 센다 (= 필요 점유율 100% 초과)
//
// ⚠️ 우리 경쟁점 자료는 **500m까지밖에 없다**(229곳 중 228곳이 0~500m). 2km 공백은
//    자료로 확인이 안 된다. 대신 **공급부족도**라는 대리자로 같은 기전을 잰다:
//
//      공급부족도 = 1km 주거인구 ÷ (자사 PC + 500m 경쟁 PC)
//                 = "이 동네 사람 몇 명당 PC 한 대인가"
//
//    높을수록 PC방 공급이 모자란 동네다. 가설이 맞다면 공급부족도가 높은 매장을
//    산식이 **과소예측**해야 한다.
//
// ⚠️ 함정 2 회피 — 필요 점유율은 분모에 예측값이 들어가 자기 자신과 상관이 난다.
//    그래서 가설 검정에는 **부호 있는 매출 오차**를 쓴다(분모가 실매출이라 안 얽힌다).
//
// 실행:
//   npx vitest run src/lib/storeEval/_underserved.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, qscInWindowAverage, utilizationByStore, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeCompetitorAppliedPcCount, describeAppliedPcCountBasis } from "./calc";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "    -" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 0) => (v == null ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: d }));

describeIf("수요를 다 먹어도 모자란 매장", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id; if (code) qscSites.set(code, doc);
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

  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, locationEvaluations, settings);
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  type Row = (typeof rows)[number];
  const nameOf = (r: Row) => r.input.storeName ?? r.input.storeCode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawByCode = new Map<string, any>();
  for (const s of snap.existingStores ?? []) rawByCode.set(s.storeCode, s);

  const score = scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);
  const full = fittedParams(DEFAULT_TEXTBOOK_PARAMS, score);

  /** 매장 한 곳의 공급·수요 지표를 한 벌로 모은다. */
  const probeOf = (r: Row) => {
    const raw = rawByCode.get(r.input.storeCode) ?? {};
    const sr = score.rows.find((x) => x.storeCode === r.input.storeCode);
    const ownPc = r.input.pcCount ?? 0;
    const rivalIp = r.input.competitorIp ?? 0;
    const rivals = (r.input.rivals ?? []).filter((x) => x.distanceM != null);
    const nearest = rivals.length ? Math.min(...rivals.map((x) => x.distanceM as number)) : null;
    const pop1km: number | null = raw.pop1km ?? null;
    const totalPc = ownPc + rivalIp;
    return {
      r, raw, name: nameOf(r),
      req: sr?.requiredShare ?? null,
      signed: sr?.predicted != null && r.actualRevenue > 0 ? (sr.predicted - r.actualRevenue) / r.actualRevenue : null,
      ownPc, rivalIp, rivalCount: rivals.length, nearest, pop1km,
      /** 이 동네 사람 몇 명당 PC 한 대인가. 높을수록 PC방이 모자란 동네다. */
      shortage: pop1km != null && totalPc > 0 ? pop1km / totalPc : null,
      f400: (raw.floating400Avg as number) ?? null,
      f1000: (raw.floating1000Avg as number) ?? null,
      special: r.input.specialDemandType ?? "없음",
      actualUtil: r.input.actualUtilization ?? null,
    };
  };
  const probes = rows.map(probeOf);

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const spear = (a: number[], b: number[]) => {
    const rank = (v: number[]) => {
      const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
      const out = new Array(v.length).fill(0);
      idx.forEach(([, i], k) => { out[i] = k; });
      return out;
    };
    const ra = rank(a), rb = rank(b);
    const ma = mean(ra), mb = mean(rb);
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < ra.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
  };

  // ────────────────────────────────────────────────────────────────────────
  it("(1) 수요를 다 먹어도 모자란 매장 명부", () => {
    const over = probes.filter((p) => p.req != null && p.req > 1).sort((a, b) => (b.req as number) - (a.req as number));
    console.log(`\n══ (1) 필요 점유율 100% 초과 ${over.length}곳 (지금 배수 켠 상태) ══`);
    console.log(`  ${"매장".padEnd(14)}${"필요점유율".padStart(9)}${"매출오차".padStart(9)}${"주거1km".padStart(9)}` +
      `${"유동400m".padStart(9)}${"자사PC".padStart(7)}${"경쟁PC".padStart(7)}${"최근접".padStart(7)}${"인구/PC".padStart(8)}  특수수요`);
    for (const p of over) {
      console.log(`  ${p.name.padEnd(14)}${pct(p.req).padStart(9)}${pct(p.signed).padStart(9)}${num(p.pop1km).padStart(9)}` +
        `${num(p.f400).padStart(9)}${String(p.ownPc).padStart(7)}${String(p.rivalIp).padStart(7)}` +
        `${(p.nearest == null ? "-" : `${Math.round(p.nearest)}m`).padStart(7)}${num(p.shortage).padStart(8)}  ${p.special}`);
    }
    const rest = probes.filter((p) => p.req != null && p.req <= 1);
    const medOf = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    console.log(`\n  견줌 — 100% 이하 ${rest.length}곳 중앙값`);
    console.log(`  ${"".padEnd(14)}${"".padStart(9)}${"".padStart(9)}${num(medOf(rest.map((p) => p.pop1km).filter((v): v is number => v != null))).padStart(9)}` +
      `${num(medOf(rest.map((p) => p.f400).filter((v): v is number => v != null))).padStart(9)}` +
      `${num(medOf(rest.map((p) => p.ownPc))).padStart(7)}${num(medOf(rest.map((p) => p.rivalIp))).padStart(7)}` +
      `${`${Math.round(medOf(rest.map((p) => p.nearest).filter((v): v is number => v != null)) ?? 0)}m`.padStart(7)}` +
      `${num(medOf(rest.map((p) => p.shortage).filter((v): v is number => v != null))).padStart(8)}`);
    console.log(`\n  '인구/PC' = 1km 주거인구 ÷ (자사PC + 500m 경쟁PC). 높을수록 PC방이 모자란 동네다.`);
    expect(over.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(2) 사용자 가설 — PC방이 모자란 동네를 산식이 과소예측하나", () => {
    // ⚠️ 여기서 재는 건 **부호 있는 매출 오차**다. 필요 점유율은 분모에 예측값이 들어가
    //    자기 자신과 상관이 나므로(어제 함정 2) 가설 검정에 쓰면 안 된다.
    const usable = probes.filter((p) => p.shortage != null && p.signed != null);
    const x = usable.map((p) => p.shortage as number);
    const y = usable.map((p) => p.signed as number);
    const r = spear(x, y);
    const n = usable.length;
    const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
    const crit = 2.03; // n≈38, 양측 5%

    console.log(`\n══ (2) 공급부족도 ↔ 부호 있는 매출 오차 (n=${n}) ══`);
    console.log(`  가설: PC방이 모자란 동네 -> 넓은 데서 손님이 온다 -> 산식이 **과소예측**한다`);
    console.log(`        (과소예측 = 매출오차가 음수) -> **음의 상관**이 나와야 한다\n`);
    console.log(`  순위상관 r = ${r.toFixed(3)}   t = ${t.toFixed(2)} (유의선 ${crit})  -> ${t > crit ? "유의하다" : "**유의하지 않다**"}`);

    // 4분위로 갈라서도 본다 — 상관 하나에 기대지 않는다.
    const sorted = [...usable].sort((a, b) => (a.shortage as number) - (b.shortage as number));
    const q = Math.ceil(sorted.length / 4);
    console.log(`\n  공급부족도 4분위별 (낮음 = PC방 흔한 동네)`);
    console.log(`    ${"구간".padEnd(10)}${"곳수".padStart(5)}${"인구/PC 중앙".padStart(13)}${"매출오차 중앙".padStart(14)}${"필요점유율 중앙".padStart(15)}`);
    const medOf = (a: number[]) => { const s = [...a].sort((p, v) => p - v); return s.length ? s[Math.floor(s.length / 2)] : null; };
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      console.log(`    ${`${i + 1}분위`.padEnd(10)}${String(g.length).padStart(5)}` +
        `${num(medOf(g.map((p) => p.shortage as number))).padStart(13)}` +
        `${pct(medOf(g.map((p) => p.signed as number))).padStart(14)}` +
        `${pct(medOf(g.map((p) => p.req).filter((v): v is number => v != null))).padStart(15)}`);
    }

    // 최근접 경쟁점 거리로도 같은 걸 본다 — 공백 상권의 다른 얼굴이다.
    const withNear = probes.filter((p) => p.nearest != null && p.signed != null);
    const rn = spear(withNear.map((p) => p.nearest as number), withNear.map((p) => p.signed as number));
    console.log(`\n  같은 걸 '최근접 경쟁점 거리'로도 — 순위상관 r = ${rn.toFixed(3)} (n=${withNear.length})`);
    console.log(`  (멀수록 공백 상권 -> 과소예측이라면 여기도 음수여야 한다)`);
    expect(n).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(3) 유동인구가 이 동네에서 제대로 잡히나 — 반경별 모양", () => {
    // 소상공인365 유동인구가 시골에서 과소 집계될 수 있다(인계 문서 4절 3번).
    // 반경을 넓힐 때 인구가 제대로 늘어나는지, 모양이 다른 매장과 다른지 본다.
    const radii = [100, 200, 300, 400, 500] as const;
    const pick = (raw: Record<string, unknown>, k: string) => (raw[k] as number) ?? null;
    const targets = probes.filter((p) => /문경시청|양주덕정|광주각화|강릉교동/.test(p.name));
    console.log(`\n══ (3) 유동인구 반경별 — 넓힐수록 제대로 늘어나나 ══`);
    console.log(`  ${"매장".padEnd(14)}${radii.map((v) => `${v}m`.padStart(9)).join("")}${"1000m".padStart(10)}   400m/100m  1000m/400m`);
    const showRow = (p: (typeof probes)[number]) => {
      const vs = radii.map((v) => pick(p.raw, `floating${v}Avg`));
      const f1000 = pick(p.raw, "floating1000Avg");
      const ratio1 = vs[0] && vs[3] ? (vs[3] as number) / (vs[0] as number) : null;
      const ratio2 = vs[3] && f1000 ? (f1000 as number) / (vs[3] as number) : null;
      console.log(`  ${p.name.padEnd(14)}${vs.map((v) => num(v).padStart(9)).join("")}${num(f1000).padStart(10)}` +
        `${(ratio1 == null ? "-" : ratio1.toFixed(2)).padStart(11)}${(ratio2 == null ? "-" : ratio2.toFixed(2)).padStart(12)}`);
    };
    for (const p of targets) showRow(p);
    console.log(`  ${"".padEnd(14)}${"".padEnd(55)}  --- 38곳 중앙 ---`);
    const r1 = probes.map((p) => {
      const a = pick(p.raw, "floating100Avg"), b = pick(p.raw, "floating400Avg");
      return a && b ? b / a : null;
    }).filter((v): v is number => v != null).sort((a, b) => a - b);
    const r2 = probes.map((p) => {
      const a = pick(p.raw, "floating400Avg"), b = pick(p.raw, "floating1000Avg");
      return a && b ? b / a : null;
    }).filter((v): v is number => v != null).sort((a, b) => a - b);
    console.log(`  ${"(38곳 중앙)".padEnd(14)}${"".padEnd(55)}${r1[Math.floor(r1.length / 2)].toFixed(2).padStart(11)}${r2[Math.floor(r2.length / 2)].toFixed(2).padStart(12)}`);
    console.log(`\n  기하학상 면적비는 400/100 = 16배 · 1000/400 = 6.25배다. 실제 비가 그보다 많이 작으면`);
    console.log(`  **바깥쪽 사람이 안 잡히고 있다**는 뜻이고, 반경 밖 손님을 못 세는 매장이 된다.`);
    expect(targets.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(4) 실측 가동률·단가가 원자료에서 멀쩡한가", () => {
    // 인계 문서 4절 2번·4번. 필요 점유율 226%가 산식 탓이 아니라 **원자료 탓**일 수도 있다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sales = (snap.sales ?? []) as any[];
    const byStore = new Map<string, { ym: string; util: number | null; pcSales: number; productSales: number }[]>();
    for (const s of sales) {
      const k = s.storeCode as string;
      byStore.set(k, [...(byStore.get(k) ?? []), {
        ym: s.yearMonth, util: s.utilizationRate ?? null,
        pcSales: s.pcSales ?? 0, productSales: s.productSales ?? 0,
      }]);
    }
    console.log(`\n══ (4) 평가창 원자료 ══`);
    const targets = probes.filter((p) => /문경시청|양주덕정|광주각화/.test(p.name));
    for (const p of targets) {
      const ms = (byStore.get(p.r.input.storeCode) ?? []).filter((m) => m.util != null)
        .sort((a, b) => a.ym.localeCompare(b.ym));
      const us = ms.map((m) => m.util as number);
      if (!us.length) { console.log(`  ${p.name} — 가동률 원자료 없음`); continue; }
      const mn = mean(us);
      const sd = Math.sqrt(mean(us.map((v) => (v - mn) ** 2)));
      console.log(`\n  ${p.name}  (평가창 ${ms.length}개월 · 산식이 쓰는 값 ${pct(p.actualUtil)})`);
      console.log(`    월별 가동률: ${ms.map((m) => `${m.ym.slice(2)} ${pct(m.util, 0)}`).join(" · ")}`);
      console.log(`    평균 ${pct(mn)} · 표준편차 ${pct(sd)} · 최소 ${pct(Math.min(...us))} · 최대 ${pct(Math.max(...us))}`);
      const pcS = ms.reduce((a, b) => a + b.pcSales, 0), prS = ms.reduce((a, b) => a + b.productSales, 0);
      const hours = p.ownPc * 720 * mn * ms.length;
      console.log(`    PC매출 ${num(pcS / 1e4)}만 · 상품매출 ${num(prS / 1e4)}만 · 상품비중 ${pct(prS / Math.max(1, pcS + prS), 0)}`);
      console.log(`    실효 총단가 = 실매출 ÷ (PC x 720 x 가동률) = ${num(hours > 0 ? (pcS + prS) / hours : null)}원/PC·시간` +
        `   (정가 ${num(p.r.input.hourlyRate)}원)`);
    }
    const allUnit: number[] = [];
    for (const p of probes) {
      const ms = (byStore.get(p.r.input.storeCode) ?? []).filter((m) => m.util != null);
      if (!ms.length || !p.ownPc) continue;
      const mn = mean(ms.map((m) => m.util as number));
      const hours = p.ownPc * 720 * mn * ms.length;
      const rev = ms.reduce((a, b) => a + b.pcSales + b.productSales, 0);
      if (hours > 0) allUnit.push(rev / hours);
    }
    allUnit.sort((a, b) => a - b);
    console.log(`\n  38곳 실효 총단가 — 중앙 ${num(allUnit[Math.floor(allUnit.length / 2)])}원 ·` +
      ` 최소 ${num(allUnit[0])}원 · 최대 ${num(allUnit[allUnit.length - 1])}원`);
    console.log(`  두 곳이 이 범위 안에 있으면 단가층은 범인이 아니다 — 수요층으로 간다.`);
    expect(byStore.size).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(5) 두 곳의 경쟁점 낱개 — 자료가 현장과 맞나", () => {
    // 사용자는 네이버지도로 *"양주덕정점은 반경 2키로내에 인접 경쟁매장 빼고 PC방이 없어"*라고
    // 봤는데, 우리 자료는 500m 안 경쟁 PC를 458대로 잡고 있다. 낱개를 펼쳐서 맞춰 본다.
    //
    // ⚠️ `competitorIp`는 **미조사 500m 점포를 100대로 추정해 채운다**(`computeCompetitorIp`).
    //    추정분이 많으면 "경쟁이 세다"가 자료가 아니라 가정일 수 있다.
    console.log(`\n══ (5) 경쟁점 낱개 ══`);
    for (const p of probes.filter((x) => /문경시청|양주덕정|강릉교동|인천서창/.test(x.name))) {
      const cs = (compsByCode.get(p.r.input.storeCode) ?? [])
        .slice()
        .sort((a, b) => (a.distanceM ?? 9e9) - (b.distanceM ?? 9e9));
      console.log(`\n  ${p.name}  (자사 PC ${p.ownPc}대 · 산식이 쓰는 경쟁 PC 합계 ${num(p.rivalIp)}대)`);
      if (!cs.length) { console.log(`    경쟁점 자료 없음`); continue; }
      console.log(`    ${"이름".padEnd(22)}${"거리".padStart(8)}${"적용PC".padStart(7)}   근거`);
      let sum = 0;
      for (const c of cs) {
        const pcs = computeCompetitorAppliedPcCount(c);
        if (pcs != null) sum += pcs;
        console.log(`    ${String(c.name ?? "-").slice(0, 21).padEnd(22)}` +
          `${(c.distanceM == null ? "-" : `${Math.round(c.distanceM)}m`).padStart(8)}` +
          `${(pcs == null ? "미상" : String(pcs)).padStart(7)}   ${describeAppliedPcCountBasis(c) ?? "-"}`);
      }
      const far = cs.filter((c) => (c.distanceM ?? 0) > 500);
      console.log(`    -> 합계 ${sum}대 (산식이 쓰는 값 ${num(p.rivalIp)}대)` +
        `${far.length ? ` · ⚠️ 500m 밖 ${far.length}곳 포함(${far.map((c) => `${c.name} ${Math.round(c.distanceM ?? 0)}m`).join(", ")})` : ""}`);
    }
    expect(probes.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(6) (2)의 상관은 경쟁 때문인가 인구 때문인가", () => {
    // (2)에서 공급부족도 ↔ 매출오차 r=+0.463이 나왔다 — 가설과 **반대** 방향이다.
    // 공급부족도 = 주거인구 ÷ (자사PC + 경쟁PC)라 위아래 둘 다 움직인다. 갈라 봐야 한다.
    //
    //   경쟁PC가 상관을 만든다 -> **경쟁 항이 과하다**. 경쟁이 셀수록 과소예측
    //   주거인구가 만든다     -> **큰 동네를 과소예측**. 어제 10번(수요 ∝ 인구^b)의 다른 얼굴
    const usable = probes.filter((p) => p.signed != null && p.pop1km != null);
    const y = usable.map((p) => p.signed as number);
    const rOf = (xs: number[]) => {
      const r = spear(xs, y);
      const n = xs.length;
      const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
      return `r = ${r.toFixed(3).padStart(6)}   t = ${t.toFixed(2).padStart(5)}  ${t > 2.03 ? "유의" : "  -"}`;
    };
    console.log(`\n══ (6) 부호 있는 매출 오차와 뭐가 상관있나 (n=${usable.length}) ══`);
    console.log(`  (음수 = 과소예측. 상관이 음수면 "그 값이 클수록 과소예측")\n`);
    console.log(`  공급부족도 (주거÷총PC)     ${rOf(usable.map((p) => (p.pop1km as number) / Math.max(1, p.ownPc + p.rivalIp)))}`);
    console.log(`  경쟁 PC 수               ${rOf(usable.map((p) => p.rivalIp))}`);
    console.log(`  주거인구 1km             ${rOf(usable.map((p) => p.pop1km as number))}`);
    console.log(`  유동인구 400m            ${rOf(usable.map((p) => p.f400 ?? 0))}`);
    console.log(`  경쟁PC ÷ 자사PC          ${rOf(usable.map((p) => p.rivalIp / Math.max(1, p.ownPc)))}`);
    console.log(`  산식 점유율               ${rOf(usable.map((p) => score.rows.find((x) => x.storeCode === p.r.input.storeCode)?.share ?? 0))}`);

    // 경쟁상권만 따로 — 독점 3곳이 상관을 끌지 않게
    const comp = usable.filter((p) => p.rivalIp > 0);
    const yc = comp.map((p) => p.signed as number);
    const rc = spear(comp.map((p) => p.rivalIp), yc);
    const tc = Math.abs(rc) * Math.sqrt((comp.length - 2) / Math.max(1e-9, 1 - rc * rc));
    console.log(`\n  경쟁상권 ${comp.length}곳만 — 경쟁 PC 수 ↔ 매출오차  r = ${rc.toFixed(3)}  t = ${tc.toFixed(2)}` +
      `  ${tc > 2.03 ? "유의" : "유의하지 않다"}`);

    // 경쟁 세기 4분위
    const sorted = [...comp].sort((a, b) => a.rivalIp - b.rivalIp);
    const q = Math.ceil(sorted.length / 4);
    const medOf = (a: number[]) => { const s = [...a].sort((p, v) => p - v); return s.length ? s[Math.floor(s.length / 2)] : null; };
    console.log(`\n  경쟁 세기 4분위 (경쟁상권 ${comp.length}곳)`);
    console.log(`    ${"구간".padEnd(10)}${"곳수".padStart(5)}${"경쟁PC 중앙".padStart(12)}${"매출오차 중앙".padStart(14)}${"산식점유율 중앙".padStart(15)}`);
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      console.log(`    ${`${i + 1}분위`.padEnd(10)}${String(g.length).padStart(5)}${num(medOf(g.map((p) => p.rivalIp))).padStart(12)}` +
        `${pct(medOf(g.map((p) => p.signed as number))).padStart(14)}` +
        `${pct(medOf(g.map((p) => score.rows.find((x) => x.storeCode === p.r.input.storeCode)?.share ?? 0))).padStart(15)}`);
    }
    console.log(`\n  ⚠️ '산식 점유율'은 예측값의 일부다 — 매출오차와 얽혀 있으니 증거로 쓰지 말 것.`);
    console.log(`     참고로만 둔다(어제 함정 2).`);
    expect(usable.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(7) 주거인구 상관이 진짜인가 — 교란 걷어내기", () => {
    // (6)에서 매출오차와 유의하게 붙은 건 **주거인구 1km**뿐이다(r=+0.340, t=2.17).
    // 양수 = 인구 많은 동네를 과대예측 = **작은 동네를 과소예측**한다는 뜻이다.
    //
    // ⚠️ 교란 둘을 걷어내야 한다.
    //   (가) 특수수요 배수 — 지금 켜져 있고 "없음" 매장 수요를 17% 낮춘다. 유형과 인구가
    //        엮여 있으면 가짜 상관이 난다. -> "없음" 매장만 따로, 배수 끔에서도 본다.
    //   (나) 어제 10번(수요 ∝ 인구^b)과 같은 것인가 — 그건 **전체 수요**에 지수를 걸었다.
    //        여기서는 유동 400m이 r=-0.038로 **아무 상관이 없다.** 주거층에만 있는 얘기다.
    const OFFMUL: Record<string, number> = {};
    for (const k of Object.keys(DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers)) OFFMUL[k] = 1;

    const signedWith = (mul: Record<string, number>) => {
      const s = scoreTextbook(rows, { ...DEFAULT_TEXTBOOK_PARAMS, specialDemandMultipliers: mul });
      const m = new Map<string, number>();
      for (const r of s.rows) {
        if (r.predicted != null && r.actual > 0) m.set(r.storeCode, (r.predicted - r.actual) / r.actual);
      }
      return m;
    };
    const rOf = (xs: number[], ys: number[]) => {
      const r = spear(xs, ys);
      const n = xs.length;
      const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
      const crit = n > 30 ? 2.03 : n > 20 ? 2.09 : 2.18;
      return `r = ${r.toFixed(3).padStart(6)}  t = ${t.toFixed(2).padStart(5)} (선 ${crit})  ${t > crit ? "유의" : "  -"}`;
    };

    console.log(`\n══ (7) 주거인구 ↔ 매출오차, 교란 걷어내고 ══`);
    console.log(`  (양수 = 인구 많은 동네 과대예측 = 작은 동네 과소예측)\n`);
    for (const [label, mul] of [
      ["지금 배수", DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers], ["배수 끔", OFFMUL],
    ] as const) {
      const sm = signedWith(mul);
      const all = probes.filter((p) => p.pop1km != null && sm.has(p.r.input.storeCode));
      const none = all.filter((p) => p.special === "없음");
      const sigOf = (g: typeof all) => (x: (p: (typeof all)[number]) => number) =>
        rOf(g.map(x), g.map((p) => sm.get(p.r.input.storeCode) as number));
      console.log(`  [${label}]`);
      console.log(`    전체 ${String(all.length).padStart(2)}곳    주거1km   ${sigOf(all)((p) => p.pop1km as number)}`);
      console.log(`    '없음' ${String(none.length).padStart(2)}곳   주거1km   ${sigOf(none)((p) => p.pop1km as number)}`);
      console.log(`    '없음' ${String(none.length).padStart(2)}곳   유동400m  ${sigOf(none)((p) => p.f400 ?? 0)}`);
    }

    // 작은 동네 / 큰 동네로 반 갈라서 — 상관 하나에 기대지 않는다
    const sm = signedWith(DEFAULT_TEXTBOOK_PARAMS.specialDemandMultipliers);
    const sorted = probes.filter((p) => p.pop1km != null && sm.has(p.r.input.storeCode))
      .sort((a, b) => (a.pop1km as number) - (b.pop1km as number));
    const medOf = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const half = Math.floor(sorted.length / 2);
    console.log(`\n  주거인구로 반 갈라서 (지금 배수)`);
    for (const [lab, g] of [["작은 동네", sorted.slice(0, half)], ["큰 동네", sorted.slice(half)]] as const) {
      console.log(`    ${lab.padEnd(10)} n=${String(g.length).padStart(2)}  주거 중앙 ${num(medOf(g.map((p) => p.pop1km as number))).padStart(7)}` +
        `  매출오차 중앙 ${pct(medOf(g.map((p) => sm.get(p.r.input.storeCode) as number)))}` +
        `  필요점유율 중앙 ${pct(medOf(g.map((p) => p.req).filter((v): v is number => v != null)))}`);
    }
    console.log(`\n  ⚠️ 여기서 지수 b를 고르지 말 것 — 어제 10번이 그렇게 기각됐다.`);
    console.log(`     지금 단계는 "주거층에만 있는 현상인가"를 확인하는 데까지다.`);
    expect(probes.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(8) 주거 반경을 넓히면 얼마나 움직이나 — 민감도", () => {
    // 사용자(2026-09-19): *"주변 반경 300미터 정도에 있는 PC방이 반경 2키로에 있는 전부다.
    // 그 2키로가 죽은 상권이 아니라 다 상권이 형성되어 있고 초중고가 다 있다. 경쟁점 없는
    // 이유는 학교정화구역 때문에 PC방 입점이 불가해서다."*
    //
    // -> 300m 뭉치 하나가 **2km 상권 전체를 먹는다**는 뜻이다. 산식은 주거 1km · 유동 400m만 센다.
    //
    // ⚠️ (2)에서 쓴 '공급부족도'가 왜 빗나갔는지도 이걸로 설명된다 — 분자(주거 1km)도
    //    분모(경쟁 500m)도 **둘 다 상권보다 좁은 반경**으로 쟀다. 뭉치 바로 옆만 보면
    //    "PC방 흔한 동네"로 보이지만, 상권 단위로 보면 정반대일 수 있다.
    //
    // 여기서는 자료 없이 답할 수 있는 것만 잰다: **수요에서 주거가 차지하는 몫**.
    // 그래야 "주거를 2km로 넓히면 수요가 몇 배 되나"를 말할 수 있다.
    console.log(`\n══ (8) 수요에서 주거·유동이 각각 얼마나 차지하나 ══`);
    console.log(`  ${"매장".padEnd(14)}${"주거 몫".padStart(8)}${"유동 몫".padStart(8)}` +
      `${"필요점유율".padStart(10)}   주거를 2배로 하면   3배로 하면`);
    const shareRows: { name: string; rs: number; req: number | null }[] = [];
    for (const p of probes) {
      const b = computeTextbook(p.r.input, full);
      const res = b.residentDemandUsers ?? 0, flo = b.floatingDemandUsers ?? 0;
      if (res + flo <= 0) continue;
      shareRows.push({ name: p.name, rs: res / (res + flo), req: p.req });
    }
    const over = probes.filter((x) => x.req != null && x.req > 1).map((x) => x.name);
    for (const s of shareRows.filter((x) => over.includes(x.name))
      .sort((a, b) => (b.req ?? 0) - (a.req ?? 0))) {
      // 주거만 k배 하면 수요는 (1 + (k-1)*주거몫)배가 된다. 필요 점유율은 그 역수만큼 내려간다.
      const f = (k: number) => 1 + (k - 1) * s.rs;
      console.log(`  ${s.name.padEnd(14)}${pct(s.rs, 0).padStart(8)}${pct(1 - s.rs, 0).padStart(8)}` +
        `${pct(s.req).padStart(10)}      ${pct(s.req == null ? null : s.req / f(2)).padStart(8)}` +
        `      ${pct(s.req == null ? null : s.req / f(3)).padStart(8)}`);
    }
    const rs = shareRows.map((x) => x.rs).sort((a, b) => a - b);
    console.log(`\n  38곳 주거 몫 — 중앙 ${pct(rs[Math.floor(rs.length / 2)], 0)} ·` +
      ` 최소 ${pct(rs[0], 0)} · 최대 ${pct(rs[rs.length - 1], 0)}`);
    console.log(`\n  읽는 법: 주거 몫이 절반쯤이면 주거를 2배로 해도 수요는 1.5배밖에 안 된다.`);
    console.log(`  유동인구(400m)는 그대로니까 **반경을 넓혀도 절반만 움직인다.**`);
    console.log(`  ⚠️ 이건 "2km로 넓히면 이렇게 된다"가 아니라 **민감도**다. 실제 2km 인구는`);
    console.log(`     아직 수집 안 됐다(sgis는 100~1000m만 있다).`);
    expect(shareRows.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(9) 주차 착상 — 지금 있는 자료로 닿을 수 있는 데까지", () => {
    // 사용자(2026-09-19): *"크라우드 주차가 안 돼, 근처에. 근데 보면 고객이 주거지역에서
    // 매장까지의 거리가 멀잖아. 이것도 고려하면 좋을 듯."*
    //
    // 착상은 둘로 갈린다:
    //   (가) **경쟁력 항목**으로서의 주차 — 우리는 되고 경쟁점은 안 된다
    //        -> 경쟁 항이다. 문경시청은 필요 점유율 226%라 경쟁 항 천장이 3.6%p뿐이다(backlog).
    //   (나) **상권 반경 요인**으로서의 주차 — 차로 오니까 먼 데서도 온다
    //        -> 수요 항이다. 천장이 없다. 오늘 나온 "저인구 동네 과소예측"과 결이 같다.
    //
    // ⚠️ **주차 자료가 한 건도 없다** — 기존점·경쟁점·입지평가 전부. 새 칸을 만들어야 한다.
    //    그래서 여기서는 "지금 있는 자료로 닿는 데까지"만 본다:
    //      1. 가장 가까운 개념인 `inflowRestriction`(유입제한)이 자국을 남기나
    //      2. (나)의 밑바탕인 "손님이 멀리서 온다"가 자료에 있나 — 주거 밀도로 대신 잰다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leByCode = new Map<string, any>();
    for (const l of (snap.locationEvaluations ?? [])) leByCode.set(l.candidateCode, l);
    const mean2 = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const med2 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const rank2 = (v: number[]) => {
      const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
      const o = new Array(v.length).fill(0); idx.forEach(([, i], k) => { o[i] = k; }); return o;
    };
    const spear2 = (a: number[], b: number[]) => {
      const ra = rank2(a), rb = rank2(b), ma = mean2(ra), mb = mean2(rb);
      let n = 0, da = 0, db = 0;
      for (let i = 0; i < ra.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
      return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
    };

    console.log(`\n══ (9) 주차 착상 — 자료가 없어 대신 잴 수 있는 것 ══`);
    console.log(`\n  [1] 가장 가까운 기존 항목: inflowRestriction(유입제한) ↔ 부호 있는 매출 오차`);
    const ORDER: Record<string, number> = { "없음": 0, "보통": 1, "강함": 2 };
    const g = probes.filter((p) => p.signed != null && ORDER[leByCode.get(p.r.input.storeCode)?.inflowRestriction] != null);
    if (g.length > 5) {
      const x = g.map((p) => ORDER[leByCode.get(p.r.input.storeCode).inflowRestriction]);
      const y = g.map((p) => p.signed as number);
      const r = spear2(x, y);
      const t = Math.abs(r) * Math.sqrt((g.length - 2) / Math.max(1e-9, 1 - r * r));
      console.log(`    r = ${r.toFixed(3)}  n=${g.length}  t = ${t.toFixed(2)} (선 2.03)  ${t > 2.03 ? "유의" : "**유의하지 않다**"}`);
      for (const k of ["없음", "보통", "강함"]) {
        const sub = g.filter((p) => leByCode.get(p.r.input.storeCode).inflowRestriction === k);
        if (!sub.length) continue;
        console.log(`      ${k.padEnd(4)} n=${String(sub.length).padStart(2)}  부호오차 중앙 ${pct(med2(sub.map((p) => p.signed as number)))}`);
      }
      console.log(`    ⚠️ 유입제한은 주차가 아니다(물리적 진입 장벽 쪽이다). 산식에도 안 쓰인다.`);
      console.log(`       "접근 편의"류가 자국을 남기는지 보는 참고 자료로만 읽을 것.`);
    }

    console.log(`\n  [2] (나)의 밑바탕 — "손님이 멀리서 온다"는 자료에 있나`);
    console.log(`      주거인구 1km ↔ 부호오차 r=+0.340 (유의 · (6)(7)절) — 저인구 동네를 과소예측한다.`);
    console.log(`      즉 **먼 거리에서 오는 상권을 산식이 작게 센다는 자국은 이미 있다.**`);
    console.log(`      빠진 건 "그 이유가 주차냐"다. 그건 주차 자료 없이는 못 가른다.`);

    console.log(`\n  [3] 그래서 재려면 무엇이 필요한가`);
    console.log(`      (나) 수요 쪽만 보려면 **자사 41곳 주차 가능 여부**만 있으면 된다 — 경쟁점 229곳은 필요 없다.`);
    console.log(`           우리 손님이 얼마나 멀리서 오느냐는 우리 주차 사정만의 문제이기 때문이다.`);
    console.log(`      (가) 경쟁력 쪽까지 보려면 경쟁점 229곳도 채워야 한다.`);
    console.log(`      ⚠️ 자사만 채우면 '자사 전용 이름표 함정'을 조심할 것 — 다만 (나)는 자사 안에서`);
    console.log(`         갈리는 값이라(되는 곳/안 되는 곳) 그 함정에 걸리지 않는다.`);
    expect(probes.length).toBeGreaterThan(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(10) 주거 반경을 1.5km·2km로 하면 문경 수요가 얼마가 되나", () => {
    // 사용자(2026-09-19): *"문경 주거수요를 반경 2키로 아님 1.5키로 이렇게 하면 수요 어떤데."*
    //
    // 주거인구만 갈아끼우고 나머지는 그대로 둔다. 유동인구(400m)는 못 바꾼다 — 소상공인365에
    // 1.5km·2km가 없다. 그래서 **수요는 주거 몫만큼만 움직인다.**
    const SGIS = ".local-tools/sgis-resident-population.json";
    if (!existsSync(SGIS)) { console.log("  sgis 자료 없음 — 건너뜀"); return; }
    const sg = JSON.parse(readFileSync(SGIS, "utf8")) as {
      sites: Record<string, { code?: string; radii?: Record<string, { totalPopulation?: number | null }> }>;
    };
    const popByCode = new Map<string, Record<string, number | null>>();
    for (const v of Object.values(sg.sites)) {
      if (!v.code) continue;
      const m: Record<string, number | null> = {};
      for (const [r, x] of Object.entries(v.radii ?? {})) m[r] = x?.totalPopulation ?? null;
      popByCode.set(String(v.code), m);
    }
    const RAD = ["500", "1000", "1500", "2000"] as const;

    console.log(`\n══ (10) 주거 반경별 — 필요 점유율이 어디까지 내려가나 ══`);
    console.log(`  (유동 400m은 그대로다. 수요는 주거 몫만큼만 움직인다)\n`);
    const targets = probes.filter((p) => p.req != null && p.req > 1)
      .sort((a, b) => (b.req as number) - (a.req as number));
    console.log(`  ${"매장".padEnd(14)}${"주거몫".padStart(7)}${"기준(1km)".padStart(11)}` +
      RAD.map((r) => `${r === "1000" ? "1km" : r === "500" ? "500m" : `${Number(r) / 1000}km`}`.padStart(11)).join(""));
    console.log(`  ${"".padEnd(14)}${"".padStart(7)}${"필요점유율".padStart(11)}` +
      RAD.map(() => "필요점유율".padStart(11)).join(""));
    for (const p of targets) {
      const pops = popByCode.get(p.r.input.storeCode);
      const base = pops?.["1000"];
      if (!pops || !base || p.req == null) continue;
      const b = computeTextbook(p.r.input, full);
      const res = b.residentDemandUsers ?? 0, flo = b.floatingDemandUsers ?? 0;
      const rs = res + flo > 0 ? res / (res + flo) : 0;
      const cells = RAD.map((r) => {
        const v = pops[r];
        if (v == null) return "-".padStart(11);
        const k = v / base;
        const f = 1 + (k - 1) * rs; // 수요 배수 — 주거 몫만큼만 움직인다
        return `${((p.req as number) / f * 100).toFixed(1)}%`.padStart(11);
      });
      console.log(`  ${p.name.padEnd(14)}${pct(rs, 0).padStart(7)}${pct(p.req).padStart(11)}${cells.join("")}`);
    }
    console.log(`\n  ── 문경시청점 주거인구 ──`);
    const mg = popByCode.get(probes.find((p) => /문경시청/.test(p.name))?.r.input.storeCode ?? "");
    if (mg) {
      console.log(`    500m ${num(mg["500"])} · 1km ${num(mg["1000"])} · 1.5km ${num(mg["1500"])} · 2km ${num(mg["2000"])}`);
      console.log(`    1km 대비:  1.5km ${(Number(mg["1500"]) / Number(mg["1000"])).toFixed(2)}배` +
        ` · 2km ${(Number(mg["2000"]) / Number(mg["1000"])).toFixed(2)}배`);
      console.log(`    (참고: 원 면적비는 1.5km 2.25배 · 2km 4배다. 그보다 훨씬 작다 =` +
        ` **1km 밖은 사람이 얇다**)`);
    }
    console.log(`\n  ⚠️ 이건 "반경을 바꾸면 이렇게 된다"는 산수지 채택 근거가 아니다.`);
    console.log(`     38곳 전체 성적·LOO·대조군은 _catchment.test.ts (5)(6)에 있고, 일률 2km는 거기서 기각됐다.`);
    expect(targets.length).toBeGreaterThan(0);
  });
});
