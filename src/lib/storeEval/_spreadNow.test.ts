// 퍼짐 재측정 — **지금 채택 배선**으로 (2026-09-26 밤, 3단계 계획의 1단계 첫 일)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 인계에 "예측 퍼짐이 실측의 1.73배(09-21)"가 남아 있고, 09-22 _spreadLayers는 1.37배·수요 층이 퍼짐의 94%라고 했다.
// 그런데 _spreadLayers는 09-22 배선이다(MAE 4.51) — 그 뒤 특수수요·몫 상한 k0.18·가동률 창·상품몫·반경 사실이 채택됐다.
// 지금 배선(_layerSplit (6)과 같은 조립, MAE 4.04)에서 다시 잰다.
//
// ── 읽는 법 (결과 보기 전에 적어 둔다) ─────────────────────────────────────
//   log(예측 가동률) = log(수요시간) + log(몫) + log(입지배율) − log(PC×720)
//   · 층마다 퍼짐(log SD) · 실측과의 상관 · **오차(log 예측÷실측)와의 상관**을 잰다.
//   · 오차와 양(+)으로 크게 맞물리는 층 = 그 층이 클수록 과대 → **과장의 범인**.
//   · 실측과 상관이 높고 오차와는 약하면 그 층은 일을 하는 것 — 건드리면 나빠진다.
// ⚠️ 측정만 한다. 계수를 고르지 않는다. 운영 V62·실험실 설정 변경 0.
//
// 실행: npx vitest run src/lib/storeEval/_spreadNow.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const cor = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const cov = mean(a.map((x, i) => (x - ma) * (b[i] - mb)));
  return cov / (sd(a) * sd(b) || 1);
};
const f = (v: number, w = 7, d = 3) => v.toFixed(d).padStart(w);
const nm = (s: string, w = 10) => {
  const t = s.slice(0, w);
  const width = [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  return t + " ".repeat(Math.max(0, w * 2 - width - w));
};

describeIf("퍼짐 재측정 — 지금 배선", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const qscByStoreCode = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] }[]) {
    const code = doc.storeCode ?? doc.id;
    const avg = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null);
    if (code && avg != null) qscByStoreCode.set(code, avg);
  }
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) {
    const c = j.ringCutCount ?? j.blockedCount;
    if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c);
  }
  const residentRadiusByCode = residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []);
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode, residentRadiusByCode });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));

  it("층별 퍼짐·실측 상관·오차 상관 + 오차 큰 매장", () => {
    type Obs = { name: string; act: number; pred: number; demand: number; share: number; loc: number; cap: number; res: number | null; flo: number | null; capped: boolean };
    const obs: Obs[] = [];
    for (const r of rows) {
      if (r.excluded) continue;
      const act = r.input.actualUtilization;
      const b = computeTextbook(r.input, P);
      if (act == null || !(act > 0) || b.utilization == null || !(b.utilization > 0) || !b.totalDemandHours || !b.share || !b.locationMultiplier) continue;
      obs.push({
        name: r.input.storeName ?? r.input.storeCode, act, pred: b.utilization, demand: b.totalDemandHours, share: b.share, loc: b.locationMultiplier,
        cap: (r.input.pcCount ?? 0) * 720, res: b.residentDemandUsers, flo: b.floatingDemandUsers, capped: b.capped,
      });
    }
    const la = obs.map((o) => Math.log(o.act)), lp = obs.map((o) => Math.log(o.pred));
    const err = lp.map((p, i) => p - la[i]);
    const mae = mean(obs.map((o) => Math.abs(o.pred - o.act))) * 100;
    console.log(`\n[지금 배선] n=${obs.length} · 가동률 MAE ${mae.toFixed(2)}%p (기준선 _layerSplit (6) 전체 4.04와 같아야) · 몫 상한 걸린 곳 ${obs.filter((o) => o.capped).length}`);
    console.log(`  예측 퍼짐(log SD) ${f(sd(lp))} · 실측 ${f(sd(la))} · **퍼짐비 ${(sd(lp) / sd(la)).toFixed(2)}배** · 상관 r=${cor(lp, la).toFixed(3)}`);
    console.log(`  가동률 %p로: 예측 SD ${(sd(obs.map((o) => o.pred)) * 100).toFixed(2)} · 실측 SD ${(sd(obs.map((o) => o.act)) * 100).toFixed(2)}`);
    // 최소제곱 보정 기울기: 실측 log를 예측 log에 회귀했을 때 기울기. 1보다 작으면 예측이 과장이다(이 값만큼 눌러야 맞는다).
    const slope = cor(lp, la) * (sd(la) / sd(lp));
    console.log(`  보정 기울기(실측 log ~ 예측 log) ${slope.toFixed(3)} — 1이면 과장 없음. (09-21 b 보정이 이걸 흉내 냈다가 매출 ±20%를 잃고 제거됨)`);

    const layers: [string, number[]][] = [
      ["수요시간", obs.map((o) => Math.log(o.demand))],
      ["우리 몫", obs.map((o) => Math.log(o.share))],
      ["입지배율", obs.map((o) => Math.log(o.loc))],
      ["용량 PC×720(−)", obs.map((o) => -Math.log(o.cap))],
    ];
    console.log(`\n  층              퍼짐(SD)  실측과 r   오차와 r   예측 분산 몫`);
    const vp = sd(lp) ** 2, mp = mean(lp);
    for (const [k, v] of layers) {
      const mv = mean(v);
      const share = mean(v.map((x, i) => (x - mv) * (lp[i] - mp))) / vp;
      console.log(`  ${nm(k, 14)} ${f(sd(v))}  ${f(cor(v, la))}  ${f(cor(v, err))}   ${(share * 100).toFixed(0).padStart(5)}%`);
    }
    const withRes = obs.filter((o) => o.res != null && o.flo != null && o.res > 0 && o.flo > 0);
    if (withRes.length > 10) {
      const e2 = withRes.map((o) => Math.log(o.pred) - Math.log(o.act));
      const a2 = withRes.map((o) => Math.log(o.act));
      console.log(`  (수요 안) 주거 사람수  SD ${f(sd(withRes.map((o) => Math.log(o.res!))))} · 실측 r ${f(cor(withRes.map((o) => Math.log(o.res!)), a2))} · 오차 r ${f(cor(withRes.map((o) => Math.log(o.res!)), e2))}`);
      console.log(`  (수요 안) 유동 사람수  SD ${f(sd(withRes.map((o) => Math.log(o.flo!))))} · 실측 r ${f(cor(withRes.map((o) => Math.log(o.flo!)), a2))} · 오차 r ${f(cor(withRes.map((o) => Math.log(o.flo!)), e2))}`);
      console.log(`  (수요 안) 유동 비중   평균 ${(mean(withRes.map((o) => o.flo! / (o.res! + o.flo!))) * 100).toFixed(0)}% · 오차 r ${f(cor(withRes.map((o) => o.flo! / (o.res! + o.flo!)), e2))}`);
    }

    console.log(`\n  오차 큰 순(예측−실측 %p) · 수요시간/용량 = "동네를 다 먹으면" 가동률 · 몫 · 입지`);
    for (const o of [...obs].sort((a, b) => Math.abs(b.pred - b.act) - Math.abs(a.pred - a.act)).slice(0, 12)) {
      console.log(`    ${nm(o.name)} ${((o.pred - o.act) * 100).toFixed(1).padStart(6)}  실측 ${(o.act * 100).toFixed(1).padStart(5)}  예측 ${(o.pred * 100).toFixed(1).padStart(5)}  | 다먹으면 ${((o.demand / o.cap) * 100).toFixed(0).padStart(4)}%  몫 ${(o.share * 100).toFixed(0).padStart(3)}%${o.capped ? "(상한)" : "      "}  입지 ${o.loc.toFixed(2)}`);
    }
    expect(obs.length).toBeGreaterThan(30);
  });

  // 가설(결과 전 적음): 소상공인365 유동인구는 통신 기반 "그 원 안에 있던 사람"이라 **주민도 들어 있다**.
  //   그렇다면 수요 = 주거 + α·유동 은 주민을 두 번 센다. 확인할 것:
  //   (a) 유동 400m와 주거 500m가 같이 움직이나(log 상관) — 높으면 겹친다
  //   (b) 유동 ÷ (400m 안 주민 추정 = 주거500m × 0.64, 균일 가정) — 1 근처인 곳이 많으면 유동의 상당 몫이 주민이다
  //   (c) 주민 몫을 뺀 "순 유동"이 실측과 더 맞물리나
  it("유동인구에 주민이 들어 있나 — 겹침 확인(측정만)", () => {
    const xs: { name: string; act: number; flow: number; pop500: number; err: number }[] = [];
    for (const r of rows) {
      if (r.excluded) continue;
      const act = r.input.actualUtilization;
      const flow = r.input.floatingByRadius[400];
      const pop500 = r.input.pop500m;
      const b = computeTextbook(r.input, P);
      if (act == null || !(act > 0) || flow == null || !(flow > 0) || !pop500 || !b.utilization) continue;
      xs.push({ name: r.input.storeName ?? r.input.storeCode, act, flow, pop500, err: Math.log(b.utilization) - Math.log(act) });
    }
    const lf = xs.map((x) => Math.log(x.flow)), lr = xs.map((x) => Math.log(x.pop500)), la = xs.map((x) => Math.log(x.act));
    console.log(`\n[유동 vs 주민] n=${xs.length}`);
    console.log(`  (a) log 유동400 ~ log 주거500 상관 r = ${cor(lf, lr).toFixed(3)}`);
    const ratio = xs.map((x) => x.flow / (x.pop500 * 0.64)).sort((a, b) => a - b);
    const q = (p: number) => ratio[Math.min(ratio.length - 1, Math.floor(p * ratio.length))].toFixed(2);
    console.log(`  (b) 유동400 ÷ 400m 주민 추정: 최소 ${q(0)} · 25% ${q(0.25)} · 중앙 ${q(0.5)} · 75% ${q(0.75)} · 최대 ${ratio.at(-1)!.toFixed(2)} · 1.5 미만 ${ratio.filter((v) => v < 1.5).length}곳`);
    const net = xs.map((x) => Math.max(1, x.flow - x.pop500 * 0.64));
    console.log(`  (c) 실측 가동률과 r — 유동 그대로 ${cor(lf, la).toFixed(3)} · 순 유동(주민 뺌) ${cor(net.map(Math.log), la).toFixed(3)} · 주거500 ${cor(lr, la).toFixed(3)}`);
    console.log(`      오차와 r — 유동 그대로 ${cor(lf, xs.map((x) => x.err)).toFixed(3)} · 순 유동 ${cor(net.map(Math.log), xs.map((x) => x.err)).toFixed(3)}`);
    expect(xs.length).toBeGreaterThan(30);
  });

  // 잔차 훑기 — 입력의 숫자 사실 하나하나를 오차(log 예측÷실측)와 댄다. 유의선 ±0.41(여러 개 훑을 때의 자, _spreadLayers와 같음).
  // ⚠️ 넘는 게 나와도 **단서**일 뿐이다. 기전을 세우고 LOO로 재기 전에는 채택 후보가 아니다.
  it("잔차 훑기 — 오차가 어떤 사실과 같이 움직이나(측정만)", () => {
    const recs: { err: number; x: Record<string, number> }[] = [];
    for (const r of rows) {
      if (r.excluded) continue;
      const act = r.input.actualUtilization;
      const b = computeTextbook(r.input, P);
      if (act == null || !(act > 0) || !b.utilization) continue;
      const x: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.input)) if (typeof v === "number" && Number.isFinite(v) && k !== "actualUtilization") x[k] = v;
      for (const [k, v] of Object.entries(b)) if (typeof v === "number" && Number.isFinite(v)) x[`산식.${k}`] = v;
      if (b.totalDemandHours && r.input.pcCount) x["산식.다먹으면가동률"] = b.totalDemandHours / (r.input.pcCount * 720);
      recs.push({ err: Math.log(b.utilization) - Math.log(act), x });
    }
    const keys = [...new Set(recs.flatMap((r) => Object.keys(r.x)))];
    const out: { k: string; n: number; r: number }[] = [];
    for (const k of keys) {
      const have = recs.filter((r) => r.x[k] != null);
      if (have.length < 25) continue;
      const v = have.map((r) => r.x[k]);
      if (sd(v) === 0) continue;
      out.push({ k, n: have.length, r: cor(v, have.map((r) => r.err)) });
    }
    out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    console.log(`\n[잔차 훑기] 오차(log 예측÷실측)와의 상관 · 양수 = 값이 클수록 과대 · 유의선 ±0.41`);
    for (const o of out.slice(0, 20)) console.log(`  ${o.r >= 0 ? "+" : ""}${o.r.toFixed(3)}  n=${o.n}  ${o.k}${Math.abs(o.r) >= 0.41 ? "   ◀" : ""}`);
    expect(out.length).toBeGreaterThan(5);
  });
});
