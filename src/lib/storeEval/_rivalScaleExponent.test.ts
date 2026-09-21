// 경쟁점 규모의 수익이 체감하나 — PC 대수 지수 δ (2026-09-21)
//
// ── 왜 ─────────────────────────────────────────────────────────────────────
// 꼬리 넷을 개별로 다 팠는데 원자료엔 문제가 없었고, 남은 건 전부 **경쟁 항이 과대**다.
//
//   광주첨단 -54.6% (비율 0.32) · 진주혁신 -52.9% (0.27) · 야당 -45.4% (0.52) · 수원인계 -38.5% (0.54)
//   ('비율' = `_worstErrors` (4)의 "경쟁무게를 실제의 몇 배로 세야 맞나")
//
// 지금 식은 경쟁점 PC 대수를 **그대로 더한다**:
//
//   점유율 = 자사PC ÷ (자사PC + Σ 경쟁PC_i x 품질비_i^θ + 바깥선택지)
//
// 이건 "400대짜리가 100대짜리의 4배로 손님을 끈다"는 가정이다. 그럴 이유가 없다 —
// 자리 선택·접근성·대기·브랜드는 대수에 비례하지 않는다. Huff 원형에서도 매력도는
// 규모의 **거듭제곱**이고 지수가 보통 1보다 작다.
//
// 관측과도 맞는다. 꼬리 넷은 **전부 자사가 경쟁 대비 작은** 매장이다:
//   야당 88 vs 183/302/110/144 · 수원인계 99 vs 370/400/170/204/62/84
//   진주혁신 83 vs 150/115/83  · 광주첨단 93 vs 150/91/130/120/175
//
// ── 무엇을 바꾸나 ─────────────────────────────────────────────────────────
//   점유율 = 자사PC^δ ÷ (자사PC^δ + Σ 경쟁PC_i^δ x 품질비_i^θ)
//
//   δ = 1  ->  **지금과 정확히 같다**(중첩 모형). 자유도는 δ 하나만 는다.
//   δ < 1  ->  큰 경쟁점을 덜 센다. 작은 자사가 상대적으로 유리해진다.
//
// 구현 요령 — `pcCount`는 가동률 분모(ownHours ÷ pc x 720)로도 쓰이므로 건드리면 안 된다.
// 대신 대수식으로 같은 값을 만든다:
//
//   자사PC^δ ÷ (자사PC^δ + Σ r^δ q^θ) = 자사PC ÷ (자사PC + Σ [r x (r/자사PC)^(δ-1)] q^θ)
//
// 즉 경쟁점 ip만 `r x (r/pc)^(δ-1)`로 바꿔 넣으면 된다. 자사 쪽은 손대지 않는다.
//
// ── 사전 등록 ─────────────────────────────────────────────────────────────
// 과녁에 재료가 들어가 있나: δ는 **기존 식의 지수**다. 새 자료를 안 들여온다. 순환 없음.
//
// 관문(먼저 박는다. 결과를 보고 고치지 않는다):
//   관문 0  중첩 확인 — δ=1이 지금 값과 소수점까지 같아야 한다. 안 같으면 구현이 틀린 것이다.
//   관문 1  **LOO 홀드아웃**에서 δ<1이 δ=1을 이기나. 축척까지 훈련겹에서만 맞춘다.
//   관문 2  ⚠️ **꼬리를 깎으면 가운데가 무너진다**(2026-09-20에 확인된 트레이드오프).
//           오차 절대값 4분위로 갈라, **1~2분위(가운데)가 나빠지지 않아야** 한다.
//   관문 3  무작위 대조군 — 경쟁점 PC 대수를 **매장 안에서 섞어** 200번 돌린다.
//           합은 그대로고 낱개 크기만 뒤바뀐다. δ가 하는 일이 '큰 곳을 덜 센다'라면
//           섞으면 이득이 줄어야 한다. 안 줄면 그냥 경쟁을 통째로 깎은 것이다.
//   관문 4  짝지은 부트스트랩 — 개선폭 95% 구간이 0을 품으면 자료가 못 고른 것이다.
//
// ⚠️ **측정만 한다.** 본체엔 δ가 없고, 이 파일이 만들지도 않는다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalScaleExponent.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };

describeIf("경쟁점 규모 지수 δ", () => {
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
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;

  /** 경쟁점 ip를 r x (r/pc)^(δ-1)로 바꾼 판. 자사 pcCount는 손대지 않는다(가동률 분모). */
  const withDelta = (d: number, src: LabRow[] = base): LabRow[] =>
    src.map((r) => {
      const pc = r.input.pcCount;
      if (!pc || pc <= 0 || d === 1) return r;
      return {
        ...r,
        input: {
          ...r.input,
          rivals: (r.input.rivals ?? []).map((v) =>
            v.ip > 0 ? { ...v, ip: v.ip * Math.pow(v.ip / pc, d - 1) } : v),
        },
      };
    });

  /** 표본 안 성적 + 매장별 부호 있는 오차. */
  const score = (rows: LabRow[]) => {
    const sc = scoreTextbook(rows, P);
    const full = fittedParams(P, sc);
    const err = new Map<string, number>();
    for (const r of rows) {
      const b = computeTextbook(r.input, full);
      if (b.monthlyRevenue != null && r.actualRevenue > 0) err.set(nameOf(r), b.monthlyRevenue / r.actualRevenue - 1);
    }
    return err;
  };
  /** LOO — 축척까지 훈련겹에서만. 매장별 절대오차. */
  const loo = (rows: LabRow[]) => {
    const out = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const full = fittedParams(P, scoreTextbook(rows.filter((_, k) => k !== i), P));
      const b = computeTextbook(rows[i].input, full);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) out.set(nameOf(rows[i]), Math.abs(b.monthlyRevenue - a) / a);
    }
    return out;
  };
  const mape = (m: Map<string, number>) => mean([...m.values()]);

  it("(0) 중첩 확인 — δ=1이 지금과 같은가", () => {
    const a = score(base), b = score(withDelta(1));
    let worst = 0;
    for (const [k, v] of a) worst = Math.max(worst, Math.abs(v - (b.get(k) ?? 0)));
    console.log(`\n[관문 0] δ=1 vs 지금 — 최대 차이 ${(worst * 100).toFixed(6)}%p  ${worst < 1e-9 ? "**같다**" : "❌ 구현이 틀렸다"}`);
    expect(worst).toBeLessThan(1e-9);
  });

  it("(1)(2) δ 훑기 — LOO와 '가운데가 무너지나'", () => {
    const DS = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5];
    const baseLoo = loo(base);
    // 가운데/꼬리는 **지금 기준**으로 가른다 — δ마다 다시 가르면 판이 움직여 비교가 안 된다.
    const ranked = [...baseLoo.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const q = Math.ceil(ranked.length / 4);
    const group = (i: number) => new Set(ranked.slice(i * q, (i + 1) * q));
    const gs = [group(0), group(1), group(2), group(3)];
    console.log(`\n[δ 훑기] LOO 홀드아웃 · n=${base.length} · δ=1이 지금`);
    console.log("    δ      MAPE     중앙   ±20%  │ 1분위(가운데) 2분위   3분위   4분위(꼬리)");
    for (const d of DS) {
      const L = loo(withDelta(d));
      const v = [...L.values()].sort((a, b) => a - b);
      const gm = gs.map((g) => mean([...L.entries()].filter(([k]) => g.has(k)).map(([, x]) => x)));
      console.log(`  ${d.toFixed(2)}  ${(mape(L) * 100).toFixed(2).padStart(7)}%  ${(v[Math.floor(v.length / 2)] * 100).toFixed(1).padStart(5)}%  ` +
        `${((v.filter((x) => x <= 0.2).length / v.length) * 100).toFixed(0).padStart(3)}%  │  ` +
        gm.map((x) => (x * 100).toFixed(1).padStart(7) + "%").join(" ") + (d === 1 ? "   <- 지금" : ""));
    }
    console.log(`\n  ⚠️ 관문 2 — 1·2분위(가운데)가 나빠지면서 4분위(꼬리)만 좋아지면 **트레이드오프**다.`);
    console.log(`     2026-09-20에 이미 그걸로 한 번 닫혔다. 넷이 같이 좋아져야 진짜다.`);
    expect(base.length).toBeGreaterThan(30);
  });

  it("(3) 무작위 대조군 — 경쟁점 대수를 매장 안에서 섞는다", () => {
    // 합은 그대로 두고 낱개 크기만 뒤바꾼다. δ가 '큰 곳을 덜 센다'로 일하는 거라면
    // 섞으면 이득이 줄어야 한다. 안 줄면 그냥 경쟁을 통째로 깎은 것이다.
    const D = 0.7;
    const realGain = mape(loo(base)) - mape(loo(withDelta(D)));
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const gains: number[] = [];
    for (let b = 0; b < 200; b++) {
      const shuffled = base.map((r) => {
        const rv = (r.input.rivals ?? []).filter((v) => v.ip > 0);
        if (rv.length < 2) return r;
        const ips = rv.map((v) => v.ip);
        for (let i = ips.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ips[i], ips[j]] = [ips[j], ips[i]]; }
        let k = 0;
        return { ...r, input: { ...r.input, rivals: (r.input.rivals ?? []).map((v) => (v.ip > 0 ? { ...v, ip: ips[k++] } : v)) } };
      });
      gains.push(mape(loo(shuffled)) - mape(loo(withDelta(D, shuffled))));
    }
    gains.sort((a, b) => a - b);
    const p = gains.filter((g) => g >= realGain).length / gains.length;
    console.log(`\n[관문 3] 무작위 대조군 200회 · δ=${D}`);
    console.log(`  실제 이득 ${(realGain * 100).toFixed(2)}%p  ·  섞으면 중앙 ${(gains[100] * 100).toFixed(2)}%p · 95퍼센타일 ${(gains[190] * 100).toFixed(2)}%p`);
    console.log(`  p = ${p.toFixed(3)}  ${p < 0.05 ? "**유의 — 거리가 아니라 크기 분포가 일한다**" : "미달 — 낱개 크기가 아니라 총량을 깎은 효과다"}`);
    expect(gains.length).toBe(200);
  });

  it("(4) 짝지은 부트스트랩 + 꼬리 낱개", () => {
    const D = 0.7;
    const a = loo(base), b = loo(withDelta(D));
    const names = [...a.keys()].filter((n) => b.has(n));
    const diff = names.map((n) => a.get(n)! - b.get(n)!); // 양수면 δ가 낫다
    let seed = 777;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const boot: number[] = [];
    for (let k = 0; k < 2000; k++) {
      let s = 0;
      for (let i = 0; i < diff.length; i++) s += diff[Math.floor(rnd() * diff.length)];
      boot.push(s / diff.length);
    }
    boot.sort((x, y) => x - y);
    const lo = boot[50], hi = boot[1949];
    console.log(`\n[관문 4] 짝지은 부트스트랩 · δ=${D} · 양수면 δ가 낫다`);
    console.log(`  평균 ${(mean(diff) * 100).toFixed(2)}%p  95% 구간 [${(lo * 100).toFixed(2)}, ${(hi * 100).toFixed(2)}]%p` +
      `  ${lo > 0 || hi < 0 ? "**0을 안 품는다**" : "0을 품는다 — 자료가 못 고른다"}`);
    const sErr = score(base), dErr = score(withDelta(D));
    console.log(`\n  꼬리 낱개 (부호 있는 오차)`);
    console.log("  매장              지금      δ=0.7");
    for (const n of ["광주첨단점", "진주혁신도시본점", "야당점", "수원인계점", "부천상동역점", "문산점"]) {
      if (!sErr.has(n)) continue;
      console.log(`  ${n.padEnd(16)}${(sErr.get(n)! * 100).toFixed(1).padStart(7)}%  ${(dErr.get(n)! * 100).toFixed(1).padStart(7)}%`);
    }
    console.log(`\n  반대편 (과대예측)`);
    for (const n of ["구미산동점", "청주터미널점", "창원남양점", "증평점"]) {
      if (!sErr.has(n)) continue;
      console.log(`  ${n.padEnd(16)}${(sErr.get(n)! * 100).toFixed(1).padStart(7)}%  ${(dErr.get(n)! * 100).toFixed(1).padStart(7)}%`);
    }
    console.log(`\n  전체 부호평균  ${(mean([...sErr.values()]) * 100).toFixed(1)}%  ->  ${(mean([...dErr.values()]) * 100).toFixed(1)}%   (0에 가까울수록 치우침이 적다)`);
    expect(names.length).toBeGreaterThan(30);
  });
});
