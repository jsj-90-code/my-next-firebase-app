// 경쟁점을 "PC 대수"로 셀 것인가, "실제로 돌고 있는 대수"로 셀 것인가 (2026-09-18)
//
// ── 어디서 나온 질문인가 ──────────────────────────────────────────────────
// 사용자: *"양주덕정 문경시청 부경대 문산점 이런 데 예상매출이 너무 낮잖아… 수요가 문제야
// 경쟁점이 문제야?"* — 갈라 보니 경쟁상권 35곳 중 23곳에서 **산식이 실제보다 적게 준다**
// (중앙 비 0.84). 독점상권은 안 쏠린다(1.05). 경쟁 항의 계통편향이다.
//
// 점유율을 만드는 단계를 갈라 보면 범인이 1단계다(`_specialDemand.test.ts` (0-C)):
//
//   대수만 세면        18.6%   <- 실제의 0.31배. 여기서 이미 3배 틀려 있다
//   유효거리로 거르면   19.3%   <- 거의 안 바뀐다. 범인 아님
//   품질(θ=3) 반영     53.0%   <- θ가 혼자 34%p를 끌어올린다
//   입지 곱하면        53.6%   <- 배율 1.064, 거의 중립. 범인 아님
//   실제 먹은 몫       59.7%
//
// `textbookModel.ts`의 θ 주석이 이미 경고하고 있다: *"θ가 하는 일의 상당 부분은 수준
// 보정이다… θ가 줄인 건 수준이고 남긴 건 순서다."* 출발점이 3배 틀려 있어서 θ를 3제곱까지
// 올려 억지로 메우는 구조다. 그러고도 6.7%p 모자란다.
//
// ── 가설 ──────────────────────────────────────────────────────────────────
// **"경쟁점 PC 100대"는 그 매장의 수용력이지 실제 흡인력이 아니다.** 20%만 돌면 실제로
// 손님을 잡고 있는 건 20대치다. 자사는 실측 가동률을 아는데 경쟁점은 대수만 세고 있다.
//
// 자료가 실제로 그렇게 말한다 — 기존점에 딸린 경쟁점 171곳 중 100곳에 실측이 있고,
// 핑봇 가동률 중앙 20.1% · 현장 좌석점유율 중앙 18.1%다.
//
// ⚠️ **측정만 한다.** 통과해도 여기서 계수를 바꾸지 않는다.
// ⚠️ 자사는 PC 대수 그대로 둔다. 자사 가동률은 **예측 대상**이라 넣으면 순환이다.
//    비대칭이 맞다 — 경쟁점 쪽은 "지금 실제로 잡고 있는 양"을 관측으로 아는 것이고,
//    자사 쪽은 그걸 맞히려는 것이다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalCapacity.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, qscInWindowAverage, rivalDistanceM, utilizationByStore, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { existingStoreSourceCode } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeQualityScore, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "    -" : `${(v * 100).toFixed(d)}%`);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pear = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
};

describeIf("경쟁점을 대수로 셀까 실제 돌아가는 양으로 셀까", () => {
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
  const labRows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const score = scoreTextbook(labRows, P);
  const full = fittedParams(P, score);
  const W = full.qualityWeights;

  /**
   * 경쟁점 실측 가동률(0~1) — **핑봇만 쓴다.**
   *
   * ⚠️ 2026-09-18: 처음엔 핑봇이 없으면 현장 좌석점유율(`measuredSeatRate`)로 떨어지게
   *    했는데, 둘 다 있는 33곳을 대조해 보니 **상관 r=0.219로 서로 딴소리를 한다**
   *    (G7 핑봇 40.3 vs 좌석 10.0 · 브리즈 17.3 vs 54.8).
   *    사용자 확인: *"실측자료는 방문 당시 일시적인 가동률 체크한 거라 평균 가동률로 못 보지.
   *    핑봇은 그나마 신뢰할 만함."* — 좌석점유율은 한 시점 관측이라 월평균과 자가 다르다.
   *    자사 쪽은 월평균이므로 섞으면 비교가 성립하지 않는다. 그래서 핑봇만 남긴다.
   * ⚠️ %로 저장돼 있다(핑봇 20.1 = 20.1%). 100으로 나눈다.
   */
  const rawUtil = (c: Competitor): number | null => {
    const pb = c.pingbotUtilization == null ? null : Number(c.pingbotUtilization);
    if (pb != null && Number.isFinite(pb) && pb > 0) return pb / 100;
    return null;
  };

  // 기존점에 딸린 경쟁점만 모아 중앙값을 낸다.
  const storeCodes = new Set(stores.map((s) => existingStoreSourceCode(s)));
  const measured = allCompetitors
    .filter((c) => storeCodes.has(c.candidateCode))
    .map(rawUtil)
    .filter((v): v is number => v != null);
  const medUtil = measured.length ? med(measured) : 0.2;

  type Row = {
    name: string; pc: number; req: number;
    rivals: { ip: number; d: number; qratio: number; util: number; hasUtil: boolean }[];
  };
  const rows: Row[] = [];
  for (const lr of labRows) {
    const r = score.rows.find((x) => x.storeCode === lr.input.storeCode);
    if (!r || r.requiredShare == null) continue;
    const store = stores.find((s) => s.storeCode === lr.input.storeCode);
    if (!store) continue;
    const cs = (compsByCode.get(existingStoreSourceCode(store)) ?? [])
      .filter((c) => c.investigationStatus !== "경쟁점없음");
    const pc = lr.input.pcCount ?? 0;
    if (!pc) continue;
    const op = lr.input.ownQualityParts ?? null;
    const oq = op ? computeQualityScore(op, W) : null;
    const rivals = cs.map((c, i) => {
      const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
      const rp = lr.input.rivals?.[i]?.parts ?? null;
      // 품질을 모르면 자사와 같게 본다 — 산식이 하는 것과 같은 규칙이다(결측을 유불리로 안 읽는다).
      const v = rp ? computeQualityScore(rp, W) : null;
      const u = rawUtil(c);
      return {
        ip,
        d: rivalDistanceM(store, c) ?? 0,
        qratio: oq == null || !(oq > 0) || v == null || !(v > 0) ? 1 : v / oq,
        util: u ?? medUtil,
        hasUtil: u != null,
      };
    }).filter((x) => x.ip > 0);
    if (!rivals.length) continue;
    rows.push({ name: r.storeName ?? r.storeCode, pc, req: r.requiredShare, rivals });
  }

  /** 점유율 = 자사PC ÷ (자사PC + Σ 경쟁IP x 가동률^u x 품질비^θ). u=0이면 지금 방식. */
  const shareOf = (r: Row, theta: number, uExp: number) => {
    let riv = 0;
    for (const x of r.rivals) {
      if (x.d > full.effectiveRadiusM) continue;
      riv += x.ip * Math.pow(x.util, uExp) * Math.pow(x.qratio, theta);
    }
    return r.pc / (r.pc + riv);
  };
  const scoreOf = (theta: number, uExp: number) => {
    const pred = rows.map((r) => shareOf(r, theta, uExp));
    const obs = rows.map((r) => r.req);
    return {
      mape: mean(pred.map((v, i) => Math.abs(v / obs[i] - 1))),
      bias: mean(pred.map((v, i) => v / obs[i] - 1)),
      r: pear(pred, obs),
    };
  };

  it("(1) 경쟁점은 실제로 얼마나 돌고 있나", () => {
    const all = rows.flatMap((r) => r.rivals);
    const has = all.filter((x) => x.hasUtil);
    console.log(`\n══ 경쟁점 실측 가동률 ══`);
    console.log(`  대상 경쟁점 ${all.length}곳 중 실측 있는 곳 ${has.length}곳 (${((has.length / all.length) * 100).toFixed(0)}%)`);
    if (has.length) {
      const v = has.map((x) => x.util).sort((a, b) => a - b);
      console.log(`  가동률 최소 ${pct(v[0])} · 중앙 ${pct(v[Math.floor(v.length / 2)])} · 최대 ${pct(v[v.length - 1])}`);
    }
    console.log(`  결측에 넣는 값(있는 곳 중앙) ${pct(medUtil)}`);
    console.log(`\n  자사 실측 가동률 중앙 ${pct(med([...utilByStore.values()]))} — 경쟁점보다 훨씬 높다.`);
    console.log(`  즉 "PC 대수가 같으면 손님도 같다"는 전제가 자료와 안 맞는다.`);
    expect(rows.length).toBeGreaterThan(10);
  });

  it("(2) 대수로 셀 때 vs 실제 돌아가는 양으로 셀 때", () => {
    console.log(`\n══ 점유율 맞추기 — 경쟁상권 ${rows.length}곳, 목표는 '실제 먹은 몫' ══`);
    console.log(`  ${"경쟁 가중".padEnd(26)} ${"θ".padStart(4)}  ${"MAPE".padStart(8)} ${"편향".padStart(8)} ${"r".padStart(7)}`);
    const show = (label: string, theta: number, uExp: number) => {
      const s = scoreOf(theta, uExp);
      console.log(`  ${label.padEnd(26)} ${String(theta).padStart(4)}  ${pct(s.mape, 2).padStart(8)} ` +
        `${`${s.bias >= 0 ? "+" : ""}${(s.bias * 100).toFixed(1)}%`.padStart(8)} ${s.r.toFixed(3).padStart(7)}`);
    };
    for (const th of [0, 1, 2, 3, 4]) show("PC 대수 (지금)", th, 0);
    console.log("");
    for (const th of [0, 1, 2, 3, 4]) show("PC 대수 x 실측가동률", th, 1);
    console.log(
      `\n  편향이 음수면 산식이 실제보다 적게 주고 있다는 뜻이다.` +
        `\n  지금(θ=3·대수)의 편향과, 가동률을 넣었을 때 θ를 낮춰도 되는지를 같이 본다.`,
    );
    expect(true).toBe(true);
  });

  // 사용자(2026-09-18): *"상권에 매장이 두 개 있는데 우리 매장이 10석이고 상대 매장은
  // 30석이야. 우리가 점유율 70% 먹어. 우리는 7석 쓰고 상대는 9석. 점유 높은데 손님 더 적음.
  // 말이 안 됨."*
  //
  // 자리 수로 나누면 10/(10+30)=25%인데, 실제 손님으로 나누면 7/(7+9)=44%다.
  // **몫은 자리가 아니라 손님으로 세는 게 맞다.** 그 자를 그대로 재본다 —
  // 자사·경쟁점 양쪽 다 실측 가동률을 곱해 "실제로 쓰고 있는 자리 수"로 몫을 낸다.
  //
  // ⚠️ 이건 예측식이 아니다. 자사 가동률은 **예측 대상**이라 산식에 넣으면 순환이다.
  //    여기서는 **"실측끼리 계산한 몫"과 "필요 점유율"이 같은 값인지**만 본다.
  //    같으면 필요 점유율이라는 자가 실제 손님 몫을 제대로 재고 있다는 뜻이고,
  //    다르면 목표로 삼던 자 자체를 다시 봐야 한다.
  it("(2-B) 자리로 센 몫 vs 손님으로 센 몫", () => {
    const withAll = rows.filter((r) => {
      const own = utilByStore.get(labRows.find((l) => (l.input.storeName ?? l.input.storeCode) === r.name)?.input.storeCode ?? "");
      return own != null && r.rivals.every((x) => x.hasUtil || true);
    });
    console.log(`\n══ (2-B) 몫을 무엇으로 세나 — 경쟁상권 ${rows.length}곳 ══`);
    console.log(`  ${"매장".padEnd(14)}${"자리로".padStart(8)}${"손님으로".padStart(9)}${"필요점유율".padStart(10)}${"산식".padStart(8)}`);
    const bySeat: number[] = [], byGuest: number[] = [], req: number[] = [], model: number[] = [];
    for (const r of rows) {
      const lr = labRows.find((l) => (score.rows.find((x) => x.storeCode === l.input.storeCode)?.storeName ?? l.input.storeCode) === r.name);
      const ownUtil = lr ? utilByStore.get(lr.input.storeCode) ?? null : null;
      if (ownUtil == null) continue;
      const inR = r.rivals.filter((x) => x.d <= full.effectiveRadiusM);
      const seatOwn = r.pc, seatRiv = inR.reduce((a, x) => a + x.ip, 0);
      const guestOwn = r.pc * ownUtil, guestRiv = inR.reduce((a, x) => a + x.ip * x.util, 0);
      const s1 = seatOwn / (seatOwn + seatRiv);
      const s2 = guestOwn / (guestOwn + guestRiv);
      const s4 = shareOf(r, full.qualityExponent, 0);
      bySeat.push(s1); byGuest.push(s2); req.push(r.req); model.push(s4);
    }
    for (let i = 0; i < Math.min(rows.length, 0); i++) void i;
    console.log(`  ${"중앙값".padEnd(14)}${pct(med(bySeat)).padStart(8)}${pct(med(byGuest)).padStart(9)}` +
      `${pct(med(req)).padStart(10)}${pct(med(model)).padStart(8)}`);
    console.log(`\n  '손님으로'와 '필요 점유율'의 상관 r=${pear(byGuest, req).toFixed(3)}` +
      `  ·  '자리로'와 필요 점유율 r=${pear(bySeat, req).toFixed(3)}`);
    console.log(`  '손님으로' 대비 필요 점유율 비 중앙 ${(med(byGuest.map((v, i) => v / req[i]))).toFixed(2)}`);
    console.log(
      `\n  읽는 법: '손님으로' 센 몫이 '필요 점유율'과 가까우면, 사용자 말대로` +
        `\n  **몫은 자리가 아니라 손님으로 세는 게 맞다**는 뜻이다. 그러면 예측식이 맞춰야 할 것은` +
        `\n  자사 가동률이고, 경쟁점 쪽은 실측을 그대로 쓰면 된다.`,
    );
    expect(bySeat.length).toBeGreaterThan(10);
  });

  // (2-B)에서 '손님으로 센 몫'(31.6%)이 '필요 점유율'(59.7%)의 절반이었다. 중앙값끼리
  // 나눈 값이라 뜻이 애매하다 — **매장마다** 직접 재야 한다.
  //
  //   이 동네에서 실제로 쓰인 시간 = 자사 PC수 x 실측가동률 x 720 + Σ 경쟁 PC수 x 실측가동률 x 720
  //   산식이 센 동네 수요시간     = computeTextbook의 totalDemandHours
  //
  // 앞엣것이 뒤엣것보다 크면 **수요식이 작다**. 이건 경쟁 항으로는 못 고친다.
  it("(2-C) 이 동네에서 실제로 쓰인 시간 vs 산식이 센 수요", () => {
    const ratios: { name: string; obs: number; model: number; ratio: number; cover: number }[] = [];
    for (const lr of labRows) {
      const r = score.rows.find((x) => x.storeCode === lr.input.storeCode);
      if (!r) continue;
      const ownUtil = utilByStore.get(lr.input.storeCode);
      if (ownUtil == null) continue;
      const store = stores.find((s) => s.storeCode === lr.input.storeCode);
      if (!store) continue;
      const cs = (compsByCode.get(existingStoreSourceCode(store)) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음");
      const pc = lr.input.pcCount ?? 0;
      if (!pc) continue;
      const b = computeTextbook(lr.input, full).totalDemandHours;
      if (b == null || !(b > 0)) continue;

      let rivHours = 0, have = 0, total = 0;
      for (const c of cs) {
        const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
        if (!(ip > 0)) continue;
        if ((rivalDistanceM(store, c) ?? 0) > full.effectiveRadiusM) continue;
        total++;
        const u = rawUtil(c);
        if (u != null) have++;
        rivHours += ip * (u ?? medUtil) * 720;
      }
      const ownHours = pc * ownUtil * 720;
      ratios.push({
        name: r.storeName ?? r.storeCode,
        obs: ownHours + rivHours, model: b,
        ratio: (ownHours + rivHours) / b,
        cover: total ? have / total : 1,
      });
    }
    ratios.sort((a, b) => b.ratio - a.ratio);
    console.log(`\n══ (2-C) 실제로 쓰인 시간 ÷ 산식이 센 수요 — ${ratios.length}곳 ══`);
    console.log(`  1보다 크면 **산식이 수요를 작게 세고 있다**는 뜻이다.\n`);
    console.log(`  ${"매장".padEnd(14)}${"실제 시간".padStart(11)}${"산식 수요".padStart(11)}${"비".padStart(7)}  경쟁점 실측`);
    for (const x of ratios.slice(0, 8)) {
      console.log(`  ${x.name.slice(0, 13).padEnd(14)}${Math.round(x.obs).toLocaleString().padStart(11)}` +
        `${Math.round(x.model).toLocaleString().padStart(11)}${x.ratio.toFixed(2).padStart(7)}  ${pct(x.cover, 0)}`);
    }
    console.log(`  ...`);
    for (const x of ratios.slice(-4)) {
      console.log(`  ${x.name.slice(0, 13).padEnd(14)}${Math.round(x.obs).toLocaleString().padStart(11)}` +
        `${Math.round(x.model).toLocaleString().padStart(11)}${x.ratio.toFixed(2).padStart(7)}  ${pct(x.cover, 0)}`);
    }
    const rs = ratios.map((x) => x.ratio);
    console.log(`\n  비 — 최소 ${Math.min(...rs).toFixed(2)} · 중앙 ${med(rs).toFixed(2)} · 최대 ${Math.max(...rs).toFixed(2)}`);
    console.log(`  1을 넘는 곳 ${rs.filter((v) => v > 1).length}/${rs.length}곳`);
    // ⭐ 추정이 한 방울도 안 섞인 매장만 따로 본다. 이게 제일 믿을 값이다.
    const pure = ratios.filter((x) => x.cover >= 1);
    if (pure.length) {
      const pr = pure.map((x) => x.ratio);
      console.log(`\n  ⭐ 경쟁점 핑봇이 **전부** 있는 매장만 ${pure.length}곳 — 추정 0`);
      console.log(`     비 — 최소 ${Math.min(...pr).toFixed(2)} · 중앙 ${med(pr).toFixed(2)} · 최대 ${Math.max(...pr).toFixed(2)}` +
        `  ·  1을 넘는 곳 ${pr.filter((v) => v > 1).length}/${pr.length}`);
      for (const x of pure.slice(0, 12)) {
        console.log(`     ${x.name.slice(0, 13).padEnd(14)} 실제 ${Math.round(x.obs).toLocaleString().padStart(8)}` +
          ` · 산식 ${Math.round(x.model).toLocaleString().padStart(8)} · 비 ${x.ratio.toFixed(2)}`);
      }
    }
    console.log(
      `\n  ⚠️ 경쟁점 가동률 실측이 없는 곳엔 중앙값 ${pct(medUtil)}를 넣었다. 실측 비율이 낮은 매장은` +
        `\n     그만큼 추정이 섞여 있다(옆 칸에 적었다).`,
    );
    expect(ratios.length).toBeGreaterThan(10);
  });

  // 사용자 요청(2026-09-18): *"그 점유율 부분 지금과 바꾸려는 거 숫자 넣어서 이해하기 쉽게
  // 좀 보여줘 봐."* — 실제 매장 몇 곳의 계산을 두 방식으로 나란히 적는다.
  it("(2-D) 한 매장을 두 방식으로 — 자리로 vs 손님으로", () => {
    const want = ["양주덕정점", "부천상동역점", "시흥능곡점"];
    for (const nm of want) {
      const lr = labRows.find((l) => {
        const r = score.rows.find((x) => x.storeCode === l.input.storeCode);
        return (r?.storeName ?? "") === nm;
      });
      if (!lr) continue;
      const r = score.rows.find((x) => x.storeCode === lr.input.storeCode)!;
      const store = stores.find((s) => s.storeCode === lr.input.storeCode)!;
      const ownUtil = utilByStore.get(lr.input.storeCode);
      if (ownUtil == null) continue;
      const pc = lr.input.pcCount ?? 0;
      const cs = (compsByCode.get(existingStoreSourceCode(store)) ?? [])
        .filter((c) => c.investigationStatus !== "경쟁점없음")
        .map((c) => ({
          name: String(c.name ?? ""),
          ip: Number(c.appliedPcCount ?? c.totalPcCount ?? 0),
          d: rivalDistanceM(store, c) ?? 0,
          u: rawUtil(c),
        }))
        .filter((c) => c.ip > 0 && c.d <= full.effectiveRadiusM);

      console.log(`\n══════ ${nm} ══════`);
      console.log(`  우리      PC ${pc}대 · 실측 가동률 ${pct(ownUtil)}  ->  손님 ${(pc * ownUtil).toFixed(1)}명치`);
      for (const c of cs) {
        const u = c.u ?? medUtil;
        console.log(`  경쟁점    ${c.name.slice(0, 12).padEnd(13)} PC ${String(c.ip).padStart(3)}대 · ` +
          `가동률 ${pct(u)}${c.u == null ? "(추정)" : "(실측)"}  ->  손님 ${(c.ip * u).toFixed(1)}명치  [${Math.round(c.d)}m]`);
      }
      const seatOwn = pc, seatRiv = cs.reduce((a, c) => a + c.ip, 0);
      const guestOwn = pc * ownUtil, guestRiv = cs.reduce((a, c) => a + c.ip * (c.u ?? medUtil), 0);
      console.log(`\n  [자리로 세기]   ${seatOwn} ÷ (${seatOwn} + ${seatRiv}) = ${pct(seatOwn / (seatOwn + seatRiv))}`);
      console.log(`  [손님으로 세기] ${guestOwn.toFixed(1)} ÷ (${guestOwn.toFixed(1)} + ${guestRiv.toFixed(1)}) = ${pct(guestOwn / (guestOwn + guestRiv))}`);
      console.log(`  [지금 산식]     자리로 센 뒤 품질 θ=${full.qualityExponent}로 보정 -> ${pct(shareOf(rows.find((x) => x.name === nm)!, full.qualityExponent, 0))}`);
      console.log(`  [맞춰야 할 값]  필요 점유율 ${pct(r.requiredShare)}`);
    }
    expect(true).toBe(true);
  });

  it("(3) 관문 — LOO와 무작위 대조군", () => {
    const THETAS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4];
    const pickTheta = (idx: number[], uExp: number, crit: "mape" | "r") => {
      let best = { th: 3, v: Infinity };
      for (const th of THETAS) {
        const pred = idx.map((i) => shareOf(rows[i], th, uExp));
        const obs = idx.map((i) => rows[i].req);
        const v = crit === "mape" ? mean(pred.map((p, j) => Math.abs(p / obs[j] - 1))) : -pear(pred, obs);
        if (v < best.v) best = { th, v };
      }
      return best.th;
    };
    const all = rows.map((_, i) => i);
    console.log(`\n══ LOO — 한 곳 빼고 θ 고른 뒤 뺀 곳에서 채점 ══`);
    for (const uExp of [0, 1]) {
      for (const crit of ["mape", "r"] as const) {
        const errs: number[] = [], picks: number[] = [];
        for (let i = 0; i < rows.length; i++) {
          const th = pickTheta(all.filter((j) => j !== i), uExp, crit);
          picks.push(th);
          errs.push(Math.abs(shareOf(rows[i], th, uExp) / rows[i].req - 1));
        }
        const ins = pickTheta(all, uExp, crit);
        const tally = [...new Set(picks)].map((t) => [t, picks.filter((x) => x === t).length] as const).sort((a, b) => b[1] - a[1]);
        console.log(`  [${uExp === 0 ? "대수     " : "가동률반영"} · ${crit === "mape" ? "MAPE" : "r   "}]` +
          ` 표본 안 θ=${ins} ${pct(scoreOf(ins, uExp).mape, 2)} → LOO ${pct(mean(errs), 2)}` +
          `   훈련이 고른 θ: ${tally.slice(0, 3).map(([t, n]) => `${t} ${Math.round(n / picks.length * 100)}%`).join(" · ")}`);
      }
    }

    let seed = 20260918 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    // 대조군 — 가동률 값을 경쟁점끼리 섞는다. "가동률이라서" 좋아진 건지
    // "경쟁 IP를 그냥 줄여서" 좋아진 건지 가른다. 섞어도 총량은 그대로다.
    console.log(`\n══ 무작위 대조군 500회 — 가동률을 경쟁점끼리 섞는다 ══`);
    const flat = rows.flatMap((r, ri) => r.rivals.map((_, xi) => [ri, xi] as const));
    for (const crit of ["mape", "r"] as const) {
      const scoreWith = (assign: number[]) => {
        let k = 0;
        const saved = flat.map(([ri, xi]) => { const old = rows[ri].rivals[xi].util; rows[ri].rivals[xi].util = assign[k++]; return old; });
        let best = Infinity;
        for (const th of THETAS) {
          const s = scoreOf(th, 1);
          const v = crit === "mape" ? s.mape : -s.r;
          if (v < best) best = v;
        }
        k = 0; for (const [ri, xi] of flat) rows[ri].rivals[xi].util = saved[k++];
        return best;
      };
      const baseline = (() => {
        let best = Infinity;
        for (const th of THETAS) { const s = scoreOf(th, 0); const v = crit === "mape" ? s.mape : -s.r; if (v < best) best = v; }
        return best;
      })();
      const utils = flat.map(([ri, xi]) => rows[ri].rivals[xi].util);
      const real = baseline - scoreWith(utils);
      const gains: number[] = [];
      for (let i = 0; i < 500; i++) gains.push(baseline - scoreWith(shuffled(utils)));
      gains.sort((a, b) => a - b);
      const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
      const f = (v: number) => (crit === "mape" ? `${(v * 100).toFixed(2)}%p` : v.toFixed(3));
      console.log(`  [${crit === "mape" ? "MAPE" : "r"}] 실제 ${f(real)} · 섞으면 중앙 ${f(med(gains))}` +
        ` · 95퍼센타일 ${f(gains[Math.floor(gains.length * 0.95)])} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
    console.log(`\n  ⚠️ 섞어도 좋아지면 "가동률이라서"가 아니라 **경쟁 IP를 그냥 줄여서** 좋아진 것이다.`);
    expect(rows.length).toBeGreaterThan(10);
  });
});
