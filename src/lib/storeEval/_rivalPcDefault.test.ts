// 경쟁점 PC 대수 결측 — 운영 규칙(90대)을 실험실에도 쓰면 어떻게 되나 (2026-09-21)
//
// ── 사용자 질문 ───────────────────────────────────────────────────────────
// *"경쟁점 PC 대수 결측 — 이건 무슨 말임? 대수 안 쓴 거 쓰라는 거야? 추가 실측은 어려움.
//  현장 나가야 해서"*
//
// **현장 나갈 일이 아니다.** 운영 V62에는 이미 규칙이 있다 —
// `computeCompetitorAppliedPcCount`(calc.ts)가 조사수준이 "간략"이거나 investigationStatus가
// "노후저경쟁력미조사"·"오픈예정"이면 **DEFAULT_UNSURVEYED_PC_COUNT(90대)**로 채운다.
// (2026-09-02에 실측 194곳의 25%ile로 정한 값이다.)
//
// 그런데 **실험실만 그 규칙을 안 쓴다.** `labInput.ts`가 `appliedPcCount ?? totalPcCount ?? 0`
// 으로 읽고 `.filter(r => r.ip > 0)`로 버린다. 그래서 거리·품질이 멀쩡한 경쟁점이
// 대수 칸 하나 때문에 **경쟁이 없는 셈**이 된다.
//
// 결측 33곳을 조사해 보니 **전부** 간략 또는 노후저경쟁력미조사다 — 운영 규칙으로 100% 채워진다.
// 못 채우는 곳 0곳. 즉 자료를 더 모을 필요가 없고, **실험실이 운영과 같은 함수를 쓰면 끝난다.**
//
// ⚠️ 이건 계수 고르기가 아니라 **잣대 통일**이다. labInput의 품질점수 쪽 주석이 이미 같은
//    말을 하고 있다: *"자사와 같은 함수를 쓴다. 잣대가 둘이면 비대칭이 또 생긴다."*
//    대수만 그 원칙에서 빠져 있었다.
//
// ── 그래도 재고 넣는다 ────────────────────────────────────────────────────
// 기존점은 168곳 중 8곳(4.8%)만 해당해서 성적이 크게 안 움직일 것이다. 그래도 **어느 쪽으로**
// 움직이는지는 봐야 한다. 후보지는 훨씬 크게 움직인다(산본 −66% 등, `_remainingCandidates`).
//
// 판정 기준은 **가동률**이다(2026-09-21 사용자 결정).
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalPcDefault.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, rivalDistanceM, rivalQualityParts, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeCompetitorAppliedPcCount } from "./calc";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

describeIf("경쟁점 대수 결측을 운영 규칙으로 채우면", () => {
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
  const before = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;

  /**
   * 결측 경쟁점을 **운영 규칙 그대로** 채운 판. `computeCompetitorAppliedPcCount`를 쓴다 —
   * 여기서 90을 손으로 적으면 운영과 또 갈라진다.
   */
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));
  const after: LabRow[] = before.map((r) => {
    const s = storeByCode.get(r.input.storeCode);
    const cs = (compsByCode.get(r.input.storeCode) ?? []).filter((c) => c.investigationStatus !== "경쟁점없음");
    if (!s) return r;
    const rivals = cs.map((c) => ({
      ip: computeCompetitorAppliedPcCount(c) ?? 0,
      distanceM: rivalDistanceM(s, c),
      parts: rivalQualityParts(c, settings),
      name: c.name ?? null,
    })).filter((x) => x.ip > 0);
    return { ...r, input: { ...r.input, rivals } };
  });

  const loo = (rows: LabRow[]) => {
    const out: { n: string; pred: number; act: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rest = rows.filter((_, k) => k !== i);
      const f = fittedParams(P, scoreTextbook(rest, P));
      const b = computeTextbook(rows[i].input, f);
      const a = rows[i].input.actualUtilization;
      if (b.utilization != null && a != null && a > 0) out.push({ n: rows[i].input.storeName ?? "", pred: b.utilization, act: a });
    }
    return out;
  };
  const mae = (v: { pred: number; act: number }[]) => mean(v.map((x) => Math.abs(x.pred - x.act)));
  const worst = (v: { pred: number; act: number }[]) => Math.max(...v.map((x) => Math.abs(x.pred - x.act) / x.act));
  const bias = (v: { pred: number; act: number }[]) => mean(v.map((x) => x.pred - x.act));

  it("(1) 무엇이 채워지나", () => {
    let filled = 0, unfillable = 0;
    const rows: string[] = [];
    for (const s of stores) {
      const cs = (compsByCode.get(s.storeCode) ?? []).filter((c) => c.investigationStatus !== "경쟁점없음");
      const miss = cs.filter((c) => !(Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0));
      if (!miss.length) continue;
      const got = miss.map((c) => computeCompetitorAppliedPcCount(c));
      filled += got.filter((x) => x != null && x > 0).length;
      unfillable += got.filter((x) => x == null || x <= 0).length;
      rows.push(`  ${(s.storeName ?? s.storeCode).padEnd(16)}${miss.length}곳 — ` +
        miss.map((c, i) => `${c.name} ${c.distanceM}m → ${got[i] ?? "못채움"}대`).join(" · "));
    }
    console.log(`\n[기존점에서 채워지는 경쟁점] 운영 규칙(computeCompetitorAppliedPcCount) 적용`);
    for (const r of rows) console.log(r);
    console.log(`\n  채워짐 ${filled}곳 · 못 채움 ${unfillable}곳`);
    console.log(`  ⚠️ 기존점은 168곳 중 ${filled + unfillable}곳뿐이라 축척은 거의 안 흔들린다.`);
    console.log(`     후보지는 훨씬 크다(25곳) — 거기가 진짜 영향받는 쪽이다.`);
    expect(unfillable).toBe(0);
  });

  it("(2) 가동률 성적이 어느 쪽으로 움직이나", () => {
    const A = loo(before), B = loo(after);
    console.log(`\n[가동률 성적] 판정 기준은 가동률이다(2026-09-21 사용자 결정)`);
    console.log(`  판                MAE        최악      편향       ±5%p`);
    for (const [k, v] of [["지금(결측 버림)", A], ["운영 규칙 적용", B]] as [string, typeof A][]) {
      console.log(`  ${k.padEnd(16)}${pp(mae(v)).padStart(9)}${pct(worst(v)).padStart(11)}${pp(bias(v)).padStart(10)}` +
        `${(v.filter((x) => Math.abs(x.pred - x.act) <= 0.05).length + "/" + v.length).padStart(10)}`);
    }
    console.log(`\n  바뀐 매장만`);
    console.log(`  매장              실측      지금 예측   채운 예측   변화`);
    for (const a of A) {
      const b = B.find((x) => x.n === a.n)!;
      if (Math.abs(b.pred - a.pred) < 1e-9) continue;
      console.log(`  ${a.n.padEnd(16)}${pct(a.act).padStart(8)}${pct(a.pred).padStart(11)}${pct(b.pred).padStart(11)}` +
        `${((Math.abs(b.pred - b.act) - Math.abs(a.pred - a.act)) * 100).toFixed(2).padStart(9)}%p ${Math.abs(b.pred - b.act) < Math.abs(a.pred - a.act) ? "좋아짐" : "나빠짐"}`);
    }
    console.log(`\n  ⚠️ 표본 8곳이라 성적으로 판정할 일이 아니다. 이건 **잣대 통일**이고,`);
    console.log(`     성적은 "크게 나빠지지 않는지"만 확인하는 용도다.`);
    expect(A.length).toBe(B.length);
  });
});
