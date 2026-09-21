// 좋은 경쟁점은 멀어도 위협이다 — 유효거리 x 품질 상호작용 (2026-09-21)
//
// ── 사용자 착상 ───────────────────────────────────────────────────────────
// *"경쟁력이 낮은 경쟁PC방은 거리가 좀있으면 없는거나 마찬가지이긴한데, 경쟁력이 쌘PC방이
// 그런데있으면 영향력이 있을거아냐. 이런 개념으로접근하는건어떤데"*
//
// 지금은 **모든 경쟁점이 같은 300m**다. 품질은 무게에만 들어가고 도달 범위에는 안 들어간다.
// 사용자 착상은 Huff 원형 그대로다 — **매력도가 클수록 도달 범위가 넓다.**
//
//   R_i = R0 x (경쟁점품질 ÷ 자사품질)^ψ        ψ=0이면 전부 300m = 지금과 동일(중첩 모형)
//   무게 = ip_i x (품질비_i)^θ x [거리_i <= R_i ? 1 : 0]
//
// 자유도는 ψ 하나만 는다.
//
// ── 오늘 기각된 셋과 무엇이 다른가 ────────────────────────────────────────
//   δ (규모 지수)     경쟁점 **크기**만 봤다        대조군 p=0.980
//   거리 감쇠         경쟁점 **거리**만 봤다        대조군 p=0.960 (총량 고정해도)
//   θ (품질 지수)     품질을 **무게**에만 더 걸었다  r이 0.804 -> 0.713으로 떨어졌다
//   **이 파일**       거리 x 품질 **상호작용**      <- 셋 다 안 본 축이다
//
// ── 사전 등록 ─────────────────────────────────────────────────────────────
// 과녁은 b다(log 필요점유율 = a + b x log 예측점유율, 지금 0.765). 축척도 전역 상수도
// b를 못 바꾼다. r도 같이 본다 — b만 맞고 r이 떨어지면 순서를 망친 것이다.
//
//   관문 0  ψ=0이 지금과 소수점까지 같아야 한다.
//   관문 1  **b가 1로 가면서 r이 안 떨어지나.**
//   관문 2  LOO 홀드아웃에서 이기나(축척·상품몫까지 훈련겹에서만).
//   관문 3  ⚠️ 가운데가 안 무너지나. 오늘 δ·ν·감쇠가 전부 여기서 죽었다.
//   관문 4  **무작위 대조군 — 품질 점수를 경쟁점끼리 섞는다.** 거리는 그대로 둔다.
//           품질-거리 짝이 무작위여도 같은 이득이 나오면 **상호작용이 아니다.**
//           이게 이 착상에 딱 맞는 대조군이다.
//
// ⚠️ 총량은 전역 상수 하나로 계단300과 맞춘다(오늘 배운 것 — 총량이 결과를 지배한다).
// ⚠️ **측정만 한다.** 본체엔 ψ가 없고 이 파일이 만들지도 않는다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalReachByQuality.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fittedParams, scoreTextbook,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };

describeIf("유효거리 x 품질", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
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
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const R0 = P.effectiveRadiusM;
  /** computeTextbook이 effectiveRadiusM으로 한 번 더 거른다 — 그래서 계단을 꺼야 f가 산다. */
  const PINF = { ...P, effectiveRadiusM: Number.POSITIVE_INFINITY };
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;

  /** 경쟁점의 품질비 q_i ÷ 자사품질. 모르면 1(= 자사와 동급)로 본다 — 지금 코드와 같다. */
  const ratioOf = (r: LabRow, v: { parts: Parameters<typeof computeQualityScore>[0] | null }) => {
    const oq = r.input.ownQualityParts ? computeQualityScore(r.input.ownQualityParts, P.qualityWeights) : null;
    const q = v.parts ? computeQualityScore(v.parts, P.qualityWeights) : null;
    return oq == null || !(oq > 0) || q == null || !(q > 0) ? 1 : q / oq;
  };
  /** ψ에서의 그 경쟁점 유효거리 · 세는지 여부. */
  const keeps = (r: LabRow, v: { parts: Parameters<typeof computeQualityScore>[0] | null; distanceM: number | null }, psi: number) => {
    if (v.distanceM == null) return true;
    return v.distanceM <= R0 * Math.pow(ratioOf(r, v), psi);
  };
  const totalOf = (psi: number, src: LabRow[]) =>
    src.reduce((s, r) => s + (r.input.rivals ?? []).reduce((t, v) =>
      t + (v.ip > 0 && keeps(r, v, psi) ? v.ip * Math.pow(ratioOf(r, v), P.qualityExponent) : 0), 0), 0);

  /** ψ를 먹인 판. 총량은 전역 상수 하나로 ψ=0과 맞춘다. */
  const apply = (psi: number, src: LabRow[] = base): LabRow[] => {
    const a = totalOf(0, src), b = totalOf(psi, src);
    const k = b > 0 ? a / b : 1;
    return src.map((r) => ({
      ...r,
      input: { ...r.input, rivals: (r.input.rivals ?? []).map((v) => (v.ip > 0 ? { ...v, ip: keeps(r, v, psi) ? v.ip * k : 0 } : v)) },
    }));
  };

  const slope = (rows: LabRow[], p = PINF) => {
    const sc = scoreTextbook(rows, p);
    const X: number[] = [], Y: number[] = [], q: { share: number; req: number }[] = [];
    for (const x of sc.rows) {
      if (x.share == null || !(x.share > 0) || x.requiredShare == null || !(x.requiredShare > 0)) continue;
      X.push(Math.log(x.share)); Y.push(Math.log(x.requiredShare)); q.push({ share: x.share, req: x.requiredShare });
    }
    const mx = mean(X), my = mean(Y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
    return { b: sxx > 0 ? sxy / sxx : NaN, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, q };
  };
  const loo = (rows: LabRow[], p = PINF) => {
    const out = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const full = fittedParams(p, scoreTextbook(rows.filter((_, k) => k !== i), p));
      const b = computeTextbook(rows[i].input, full);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) out.set(nameOf(rows[i]), Math.abs(b.monthlyRevenue - a) / a);
    }
    return out;
  };
  const mape = (m: Map<string, number>) => mean([...m.values()]);
  const quart = (s: ReturnType<typeof slope>) => {
    const sorted = [...s.q].sort((a, b) => a.share - b.share);
    const k = Math.ceil(sorted.length / 4);
    return [0, 1, 2, 3].map((i) => {
      const g = sorted.slice(i * k, (i + 1) * k);
      return g.length ? med(g.map((x) => x.req / x.share)) : NaN;
    });
  };
  const PSIS = [0, 0.5, 1, 1.5, 2, 3];

  it("(0) 중첩 확인 + 무엇이 새로 세지나", () => {
    const a = slope(base, P), b = slope(apply(0), PINF);
    console.log(`\n[관문 0] ψ=0 vs 지금 — b ${a.b.toFixed(6)} vs ${b.b.toFixed(6)}  ${Math.abs(a.b - b.b) < 1e-9 ? "**같다**" : "❌"}`);
    console.log(`  지금 b = ${a.b.toFixed(3)} · r = ${a.r.toFixed(3)} · LOO ${(mape(loo(base, P)) * 100).toFixed(2)}%`);
    console.log(`\n[ψ가 바꾸는 경쟁점] 300m 밖인데 품질이 좋아 새로 세지거나, 안인데 품질이 나빠 빠지는 곳`);
    console.log("   ψ    세는 경쟁점 수   총무게(정규화 전)   k");
    for (const psi of PSIS) {
      let n = 0;
      for (const r of base) for (const v of r.input.rivals ?? []) if (v.ip > 0 && keeps(r, v, psi)) n++;
      const t = totalOf(psi, base);
      console.log(`  ${psi.toFixed(1).padStart(4)}  ${String(n).padStart(12)}  ${Math.round(t).toLocaleString().padStart(16)}  ${(totalOf(0, base) / Math.max(1e-9, t)).toFixed(2).padStart(5)}`);
    }
    expect(Math.abs(a.b - b.b)).toBeLessThan(1e-9);
  });

  it("(1)(2)(3) ψ 훑기", () => {
    const l0 = loo(base, P);
    const ranked = [...l0.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const q = Math.ceil(ranked.length / 4);
    const gs = [0, 1, 2, 3].map((i) => new Set(ranked.slice(i * q, (i + 1) * q)));
    console.log(`\n[ψ 훑기] R_i = 300m x (경쟁점품질÷자사품질)^ψ · 총량 고정`);
    console.log("     ψ  │    b       r    │ 4분위 필요÷예측          │ LOO MAPE │ 1분위(가운데) 4분위");
    for (const psi of PSIS) {
      const rows = apply(psi);
      const s = slope(rows), L = loo(rows);
      const gm = gs.map((g) => mean([...L.entries()].filter(([x]) => g.has(x)).map(([, v]) => v)));
      console.log(`  ${psi.toFixed(1).padStart(5)}  │ ${s.b.toFixed(3).padStart(6)} ${s.r.toFixed(3).padStart(7)} │  ` +
        quart(s).map((x) => x.toFixed(2).padStart(5)).join(" ") + `  │ ${(mape(L) * 100).toFixed(2).padStart(6)}%  │ ` +
        `${(gm[0] * 100).toFixed(1).padStart(7)}% ${(gm[3] * 100).toFixed(1).padStart(7)}%${psi === 0 ? "  <- 지금" : ""}`);
    }
    console.log(`\n  ⚠️ 관문 1 — b가 1로 가면서 **r이 안 떨어져야** 한다. 관문 3 — 1분위가 안 무너져야 한다.`);
    expect(PSIS.length).toBe(6);
  });

  it("(4) 대조군 — 품질 점수를 경쟁점끼리 섞는다 (거리는 그대로)", () => {
    // 이 착상의 핵심은 "품질과 거리의 **짝**"이다. 짝을 깨도 같은 이득이 나오면 상호작용이 아니다.
    const PSI = 1;
    const real = mape(loo(base, P)) - mape(loo(apply(PSI)));
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const gains: number[] = [];
    for (let b = 0; b < 200; b++) {
      const shuffled = base.map((r) => {
        const rv = (r.input.rivals ?? []).filter((v) => v.ip > 0);
        if (rv.length < 2) return r;
        const parts = rv.map((v) => v.parts);
        for (let i = parts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [parts[i], parts[j]] = [parts[j], parts[i]]; }
        let k = 0;
        return { ...r, input: { ...r.input, rivals: (r.input.rivals ?? []).map((v) => (v.ip > 0 ? { ...v, parts: parts[k++] } : v)) } };
      });
      gains.push(mape(loo(shuffled, P)) - mape(loo(apply(PSI, shuffled))));
    }
    gains.sort((a, b) => a - b);
    const p = gains.filter((g) => g >= real).length / gains.length;
    console.log(`\n[관문 4] 품질-거리 짝 섞기 200회 · ψ=${PSI}`);
    console.log(`  실제 이득 ${(real * 100).toFixed(2)}%p  ·  섞으면 중앙 ${(gains[100] * 100).toFixed(2)}%p · 95퍼센타일 ${(gains[190] * 100).toFixed(2)}%p`);
    console.log(`  p = ${p.toFixed(3)}  ${p < 0.05 ? "**유의 — 품질과 거리의 짝이 한 일이다**" : "미달 — 짝이 아니라 다른 게 한 일이다"}`);
    expect(gains.length).toBe(200);
  });

  it("(5) 오송점·하안금당 — 그 경쟁점이 세지나", () => {
    console.log(`\n[후보지] 사용자가 "말이 안 된다"고 한 자리가 ψ로 풀리나`);
    for (const code of ["N016", "N004"]) {
      const c = (snap.candidates ?? []).find((x: { code?: string }) => x.code === code);
      if (!c) continue;
      const comps = (compsByCode.get(code) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음");
      console.log(`\n  ${code} ${c.name}`);
      console.log("    경쟁점                거리   품질비   " + PSIS.map((p) => `ψ=${p}`.padStart(6)).join(""));
      for (const x of comps) {
        // 후보지 자사 품질은 표준 구성이라 경쟁점 점수만으로 비를 못 만든다 —
        // 기존점 평균 자사품질(약 3.9)을 기준으로 근사한다. **정확한 값이 아니라 방향 표시다.**
        const q = computeQualityScore(
          { spec: x.specScore ?? null, food: x.foodScore ?? null, zone: x.zoneScore ?? null,
            interior: x.interiorScore ?? null, management: x.managementScore ?? null } as never,
          P.qualityWeights,
        );
        const ratio = q != null && q > 0 ? q / 3.9 : 1;
        const cells = PSIS.map((psi) => ((x.distanceM ?? 0) <= R0 * Math.pow(ratio, psi) ? "  센다" : "     -").padStart(6)).join("");
        console.log(`    ${(x.name ?? "").padEnd(18)}${String(Math.round(x.distanceM ?? -1)).padStart(5)}m  ${ratio.toFixed(2).padStart(6)}   ${cells}`);
      }
    }
    console.log(`\n  ⚠️ 후보지 자사 품질은 표준 구성이라 기존점 평균(3.9)으로 근사했다. **방향 표시일 뿐이다.**`);
    expect(true).toBe(true);
  });
});
