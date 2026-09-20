// 상권 끝에 선 매장을 산식이 과대예측하나 — 편심도 (2026-09-21)
//
// ── 왜 ─────────────────────────────────────────────────────────────────────
// 사용자(오송점 평가 중): *"여기 안좋다고 보는데? 점포위치가? 상권 끝에있고 북쪽 배후지
// 과학단지는 PC방고객이 없을거같은데? 매장바로옆에 스타벅스가 사람이 많아서, 데이터적으로
// 좀 유리할수있긴한데 직장/유동이 좋은 입지는아닌것같은데"*  ·  *"여기그냥 항아리상권인듯한데"*
//
// 오송점은 **편심도 0.542로 표본 39곳 중 2위**다(중앙 0.246의 2.2배). 그런데 산식은
// 편심도 지수가 0이라 이걸 **아예 안 본다**. 대신 중심도 4.596을 보고 입지배율을
// x1.280으로 올려준다 — 사용자 판단과 정반대 방향이다.
//
// 편심도가 0인 사유는 "버렸다"가 아니라 이렇게 적혀 있다(textbookModel 타입 주석):
//   "자료는 모았고 부호도 맞다(음수). 다만 중심도가 이미 먹고 있다 — 잔차 상관이
//    -0.280 -> -0.069로 사라지고, 편심도↔중심도가 r=-0.335로 겹친다. (...)
//    **항목을 버린 게 아니라 자료가 계수를 못 정한 것이다. 사용자가 정하면 그날 켜진다.**"
//
// **그 사유가 오송점에 통하는지가 이 파일의 질문이다.** "중심도가 대신 먹는다"는 논리는
// 둘이 반대로 움직일 때만 성립하는데, 오송점은 **편심도도 높고 중심도도 높다**. 표본에서
// 그 조합은 8곳뿐이고, 오송점 편심도는 그 8곳 어느 곳보다도 높다.
//
// ── 사전 등록 ─────────────────────────────────────────────────────────────
//
// 과녁에 재료가 들어가 있나 — 한 줄씩:
//   중심도  **들어가 있다**(입지배율 x(중심도/3.22)^0.5). 그래서 "중심도 높은 무리가
//           과대예측"은 증거가 못 된다. 올려준 만큼 넘치는 건 당연하다.
//   편심도  **안 들어가 있다**(지수 0). 이 축은 깨끗하다.
//
// 그래서 진짜 검정은 **중심도를 통제한 뒤 편심도가 오차와 관계있나**다.
//
// 관문(먼저 박는다. 결과를 보고 고치지 않는다):
//   관문 1  편심도 ↔ 부호 있는 오차. 유의선 ±2/√n. **양수여야** 가설과 맞는다
//           (편심도 높다 = 상권 끝 = 예측이 실측보다 높다 = 과대예측).
//   관문 2  중심도를 통제한 편상관에서도 남아야 한다. 사라지면 주석 말이 맞는 것이다.
//   관문 3  편심도 4분위 부호 평균이 **단조로워야** 한다. 들쭉날쭉하면 잡음이다.
//   ⚠️ 단일 사전 가설이라 훑기 보정은 안 한다. 대신 **다른 축을 덧붙여 훑지 않는다.**
//   ⚠️ 표본 안 오차다(축척을 전원으로 맞춘 판). 채택하려면 LOO와 대조군이 따로 필요하다.
//
// ⚠️ **측정만 한다.** `locationExponents.direction: 0`은 이 파일이 안 건드린다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_osongEccentricity.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("편심도 — 상권 끝 매장을 과대예측하나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
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

  /** 중심도 날값 = (유동300 ÷ 유동1km) x (1000/300)². 입지배율에 들어가는 그 값이다. */
  const centralityOf = (s: { floating300Avg?: number | null; floating1000Avg?: number | null }) =>
    s.floating300Avg != null && s.floating1000Avg != null && s.floating1000Avg > 0
      ? (s.floating300Avg / s.floating1000Avg) * Math.pow(1000 / 300, 2)
      : null;

  type Pt = { name: string; ecc: number; cen: number; loc: number; err: number };
  const pts: Pt[] = [];
  for (const st of (snap.existingStores ?? []) as Record<string, number | string | null>[]) {
    const code = st.storeCode as string;
    const x = sc.rows.find((y) => y.storeCode === code);
    const r = rows.find((y) => y.input.storeCode === code);
    const ecc = st.flowEccentricity as number | null;
    const cen = centralityOf(st as { floating300Avg?: number | null; floating1000Avg?: number | null });
    if (!x || !r || x.predicted == null || !(x.actual > 0) || ecc == null || cen == null) continue;
    const b = computeTextbook(r.input, full);
    pts.push({
      name: (st.storeName as string) ?? code,
      ecc, cen, loc: b.locationMultiplier ?? 1,
      err: x.predicted / x.actual - 1,
    });
  }

  const pear = (a: number[], b: number[]) => {
    const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  /** y에서 x의 직선 성분을 뺀 잔차. 통제용. */
  const resid = (y: number[], x: number[]) => {
    const n = y.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const s = sxx > 0 ? sxy / sxx : 0;
    return y.map((v, i) => v - (my + s * (x[i] - mx)));
  };

  it("(1)(2) 편심도 ↔ 오차 · 중심도를 통제해도 남나", () => {
    const lim = 2 / Math.sqrt(pts.length);
    const e = pts.map((p) => p.ecc), er = pts.map((p) => p.err);
    const lc = pts.map((p) => Math.log(p.cen));
    const r1 = pear(e, er);
    const r2 = pear(resid(e, lc), resid(er, lc));
    console.log(`\n[편심도] n=${pts.length} · 유의선 ±${lim.toFixed(2)} · 양수면 상권 끝 매장을 **과대예측**`);
    console.log(`  편심도 ↔ 부호 있는 오차          r = ${r1.toFixed(3).padStart(7)}  ${Math.abs(r1) > lim ? "**유의**" : "미달"}`);
    console.log(`  중심도(로그)를 통제한 편상관       r = ${r2.toFixed(3).padStart(7)}  ${Math.abs(r2) > lim ? "**유의**" : "미달"}`);
    console.log(`  (참고) 편심도 ↔ 중심도           r = ${pear(e, lc).toFixed(3).padStart(7)}`);
    console.log(`  (참고) 편심도 ↔ 입지배율          r = ${pear(e, pts.map((p) => p.loc)).toFixed(3).padStart(7)}`);
    console.log(`\n  ⚠️ 관문 2 — 통제 후 사라지면 "중심도가 이미 먹고 있다"는 주석 말이 맞는 것이다.`);
    expect(pts.length).toBeGreaterThan(30);
  });

  it("(3) 편심도 4분위 — 단조로운가", () => {
    const sorted = [...pts].sort((a, b) => a.ecc - b.ecc);
    const q = Math.ceil(sorted.length / 4);
    console.log(`\n[편심도 4분위] 낮은 쪽부터 · 부호 있는 오차 평균`);
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      const m = g.reduce((s, x) => s + x.err, 0) / g.length;
      const me = g.reduce((s, x) => s + x.ecc, 0) / g.length;
      console.log(`  ${i + 1}분위 ${String(g.length).padStart(2)}곳   편심도 평균 ${me.toFixed(3)}` +
        `   오차 평균 ${(m * 100).toFixed(1).padStart(6)}%   과대 ${g.filter((x) => x.err > 0).length}곳 / 과소 ${g.filter((x) => x.err < 0).length}곳`);
    }
    console.log(`  ⚠️ 관문 3 — 위로 갈수록 오차가 양(과대)으로 올라가야 가설과 맞는다.`);
    expect(pts.length).toBeGreaterThan(30);
  });

  it("(4) 오송점이 선 칸 — 편심 높고 중심도 높은 매장들", () => {
    const c0 = (snap.candidates ?? []).find((x: { code?: string }) => x.code === "N016") as
      { flowEccentricity?: number; floating300Avg?: number; floating1000Avg?: number } | undefined;
    const medE = [...pts].map((p) => p.ecc).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
    const medC = [...pts].map((p) => p.cen).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
    const box = pts.filter((p) => p.ecc > medE && p.cen > medC).sort((a, b) => b.ecc - a.ecc);
    console.log(`\n[오송점이 선 칸] 편심도 > ${medE.toFixed(3)} 이고 중심도 > ${medC.toFixed(3)} 인 기존점 ${box.length}곳`);
    console.log("  매장              편심도   중심도   입지배율   매출오차");
    for (const x of box) {
      console.log(`  ${x.name.padEnd(16)}${x.ecc.toFixed(3).padStart(6)}${x.cen.toFixed(3).padStart(9)}` +
        `${x.loc.toFixed(3).padStart(10)}${(x.err * 100).toFixed(1).padStart(10)}%`);
    }
    const m = box.length ? box.reduce((s, x) => s + x.err, 0) / box.length : 0;
    const rest = pts.filter((p) => !(p.ecc > medE && p.cen > medC));
    const mr = rest.reduce((s, x) => s + x.err, 0) / rest.length;
    console.log(`\n  이 칸 ${box.length}곳 오차 평균 ${(m * 100).toFixed(1)}%  ·  나머지 ${rest.length}곳 ${(mr * 100).toFixed(1)}%`);
    if (c0?.flowEccentricity != null) {
      const cen = c0.floating300Avg != null && c0.floating1000Avg
        ? (c0.floating300Avg / c0.floating1000Avg) * Math.pow(1000 / 300, 2) : null;
      console.log(`  오송점(후보)  편심도 ${c0.flowEccentricity.toFixed(3)} · 중심도 ${cen?.toFixed(3) ?? "-"}` +
        `  -> 이 칸 최고 편심도(${box[0]?.ecc.toFixed(3)})보다 ${c0.flowEccentricity > (box[0]?.ecc ?? 0) ? "**높다**" : "낮다"}`);
      console.log(`  ⚠️ 표본 밖이면 이 칸의 평균으로 오송점을 보정할 수 없다 — 외삽이다.`);
    }
    expect(pts.length).toBeGreaterThan(30);
  });
});
