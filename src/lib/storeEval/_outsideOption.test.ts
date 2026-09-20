// 바깥선택지(outsideOptionIp) — 경쟁상권 과소예측을 겨냥한 손잡이인가 (2026-09-20)
//
// ── 왜 이걸 파나 ───────────────────────────────────────────────────────────
// 실험실의 제일 큰 구조적 결함이 **경쟁상권 과소예측**이다(독점은 +3%대로 잘 맞는다).
// `_textbookFull.test.ts`의 [손잡이 훑기]에서 바깥선택지만 **격차와 MAPE를 같이** 개선했다.
// 거기서는 0/50/100 **셋만** 봤다. 여기서 촘촘히 훑고, 관문을 세운다.
//
// ⚠️ **2026-09-20 잔차화 중심도가 본체에 들어가면서 기준선이 옮겨졌다.** 인계 문서에 적힌
//    "바깥선택지 50이 둘 다 좋아진다"는 **그 전 기준선**의 이야기다. 지금은 이렇다:
//
//                    옛 기준선(잔차화 전)        지금(잔차화 후)
//      OO=0     경쟁상권 −12.6% · MAPE 22.51%   경쟁상권 −16.9% · MAPE 21.59%
//      최선     OO=30 · MAPE 21.24%             OO=75 · MAPE 19.81%
//
//    잔차화가 MAPE는 낮췄는데 **격차는 오히려 벌렸다**(−15.6%p -> −19.7%p). 두 성적이
//    같은 방향으로 안 움직인다는 뜻이라, 무엇을 고칠 것인지부터 정해야 한다.
//
// ── 먼저 기전을 적어둔다 (이게 판정의 핵심이다) ────────────────────────────
// 바깥선택지는 분모에 상수로 더해지므로 **모든 매장의 점유율을 낮춘다.** 그런데 성적이
// 좋아지는 경로는 그게 아니다. 축척(hoursPerUserPerMonth)이 **독점매장에서만** 맞춰지기
// 때문이다(`calibrationTarget`).
//
//   분모 D = own + rival 일 때 OO를 더하면 점유율이 D/(D+OO)배가 된다.
//   독점매장   D = pc ≈ 100.   OO=50이면 0.67배 — **크게 깎인다**
//   경쟁상권   D = own+rival.  rival이 클수록 D/(D+OO)가 1에 가깝다 — **덜 깎인다**
//   그 다음 축척이 독점을 실측 가동률에 도로 맞추려고 수요를 그만큼 끌어올린다
//   => 덜 깎인 경쟁상권이 **상대적으로 떠오른다**. 과소예측이 닫히는 건 이 되밀림이다.
//
// ⚠️ 방향을 헷갈리기 쉽다 — 뜨는 정도는 경쟁점이 **많을수록 크다**(분모가 커서 덜 깎이므로).
//    "경쟁점이 적어서 OO 몫이 크니까 더 뜬다"가 아니다. 아래 [기전]에서 실측으로 확인한다.
//
// ⚠️ 그래서 이 손잡이는 **"경쟁상권을 독점 대비 얼마나 띄울까"와 거의 같은 뜻**이다.
//    자유도 1개짜리 수준 보정과 구분이 안 될 위험이 크다. 관문을 그 지점에 세운다.
//
// ── 관문 셋 ────────────────────────────────────────────────────────────────
//   1. 자유도 맞춘 가짜 손잡이 — "경쟁상권 예측에 상수 k를 곱한다"(뜻이 없는 1자유도).
//      바깥선택지가 이걸 못 이기면, 기전이 아니라 **수준차를 흡수한 것**이다.
//   2. 무작위 대조군 — 경쟁 구조(경쟁점 목록·IP·점포수)를 매장끼리 통째로 섞는다.
//      가짜 구조에서도 같은 이득이 나오면 그 이득은 구조가 아니라 자유도에서 온 것이다.
//   3. LOO 홀드아웃 — 축척까지 훈련겹에서만 맞춘다(`fittedParams`). 표본 안에서 고른 값이
//      홀드아웃에서 유지되나. **OO를 고정한 채**로도 재서, 고르는 자유도와 값 자체를 가른다.
//
// ⚠️ **측정만 한다. 채택하지 않는다.** 값은 사용자가 고른다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_outsideOption.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS,
  computeTextbook,
  fittedParams,
  scoreTextbook,
  type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** 결정적 난수 — 돌릴 때마다 같은 답이 나와야 근거로 쓸 수 있다. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describeIf("바깥선택지 — 경쟁상권 과소예측", () => {
  // ── 조립 ─────────────────────────────────────────────────────────────────
  // **화면과 같은 조립 함수**(labInput.ts의 buildLabRows)를 쓴다. 베끼지 않는다 —
  // 화면에 항목이 붙으면 이 하네스도 자동으로 같이 본다(_textbookFull.test.ts와 같은 이유).
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

  // QSC — 스냅샷 우선, 없으면 로컬 수집물(_textbookFull.test.ts와 같은 순서).
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  const fromSnapshot = (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[];
  for (const doc of fromSnapshot) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [key, site] of Object.entries(sites)) {
      qscSites.set(key.startsWith("existing:") ? key.slice("existing:".length) : key, site);
    }
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const withOO = (oo: number): TextbookParams => ({ ...P, outsideOptionIp: oo });

  /** 독점상권인가 — 축척이 여기서 맞춰진다(`calibrationTarget`과 같은 잣대). */
  const isMono = (r: LabRow) => !(r.input.competitorIp ?? 0);

  /** 훑을 격자. 50 근처를 촘촘히 본다(지금까지는 0/50/100 셋뿐이었다). */
  const GRID = [0, 10, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 85, 100];

  type Stat = {
    mape: number; median: number; within20: number;
    mono: number; comp: number; gap: number; hours: number;
  };
  const stat = (rs: LabRow[], oo: number): Stat => {
    const sc = scoreTextbook(rs, withOO(oo));
    const monoBy = new Map(rs.map((r) => [r.input.storeCode, isMono(r)]));
    const ok = sc.rows
      .filter((x) => x.predicted != null && x.actual > 0)
      .map((x) => ({ e: (x.predicted as number) / x.actual - 1, mono: monoBy.get(x.storeCode) === true }));
    const avg = (a: typeof ok) => (a.length ? a.reduce((s, x) => s + x.e, 0) / a.length : NaN);
    const mono = avg(ok.filter((x) => x.mono));
    const comp = avg(ok.filter((x) => !x.mono));
    return {
      mape: sc.mape ?? Number.POSITIVE_INFINITY,
      median: sc.medianAbsErr ?? NaN,
      within20: sc.within20 ?? NaN,
      mono, comp, gap: comp - mono,
      hours: sc.fittedHoursPerUser,
    };
  };

  /** 격자에서 MAPE 최선을 고른다. 고르는 자유도가 관문의 대상이다. */
  const pickOO = (rs: LabRow[]) => {
    let best = { oo: 0, mape: Number.POSITIVE_INFINITY };
    for (const oo of GRID) {
      const m = scoreTextbook(rs, withOO(oo)).mape ?? Number.POSITIVE_INFINITY;
      if (m < best.mape) best = { oo, mape: m };
    }
    return best;
  };

  /**
   * 훈련겹에서 **축척까지** 맞춘 뒤 홀드아웃 한 곳을 예측한다.
   *
   * ⚠️ `scoreTextbook`은 넘긴 행에서 축척을 맞춘다. 전체 행으로 채점하면 홀드아웃 매장이
   *    자기 축척을 본다(누수). `fittedParams`로 훈련겹 축척을 굳혀서 넘긴다.
   */
  const holdoutPred = (i: number, oo: number): number | null => {
    const train = rows.filter((_, k) => k !== i);
    const sc = scoreTextbook(train, withOO(oo));
    return computeTextbook(rows[i].input, fittedParams(withOO(oo), sc)).monthlyRevenue ?? null;
  };
  const absErr = (pred: number | null, actual: number) =>
    pred != null && actual > 0 ? Math.abs(pred - actual) / actual : null;

  /** 경쟁상권 예측에 곱할 상수 k를 훈련겹에서 고른다 — 뜻이 없는 1자유도짜리 가짜 손잡이. */
  const pickK = (rs: LabRow[]) => {
    const sc = scoreTextbook(rs, withOO(0));
    const monoBy = new Map(rs.map((r) => [r.input.storeCode, isMono(r)]));
    const pairs = sc.rows
      .filter((x) => x.predicted != null && x.actual > 0)
      .map((x) => ({ p: x.predicted as number, a: x.actual, mono: monoBy.get(x.storeCode) === true }));
    let best = { k: 1, mape: Number.POSITIVE_INFINITY };
    for (let k = 0.8; k <= 1.6001; k += 0.01) {
      const m = pairs.reduce((s, x) => s + Math.abs((x.mono ? x.p : x.p * k) - x.a) / x.a, 0) / pairs.length;
      if (m < best.mape) best = { k, mape: m };
    }
    return best;
  };

  it("촘촘한 훑기 — 50 근처", () => {
    console.log(`\n[바깥선택지 훑기] 표본 ${rows.length}곳 (독점 ${rows.filter(isMono).length}곳)`);
    console.log("     OO      독점     경쟁상권      격차      MAPE      중앙    ±20%   수요축척");
    for (const oo of GRID) {
      const s = stat(rows, oo);
      console.log(
        `  ${String(oo).padStart(5)}  ${(s.mono * 100).toFixed(1).padStart(6)}%  ` +
        `${(s.comp * 100).toFixed(1).padStart(7)}%  ${(s.gap * 100).toFixed(1).padStart(7)}%p  ` +
        `${(s.mape * 100).toFixed(2).padStart(6)}%  ${(s.median * 100).toFixed(1).padStart(5)}%  ` +
        `${(s.within20 * 100).toFixed(0).padStart(3)}%  ${s.hours.toFixed(3).padStart(7)}`,
      );
    }
    console.log("  ⚠️ 수요축척이 OO를 따라 커지는 게 보이면, 격차가 닫히는 경로가");
    console.log("     '독점에서 되밀린 축척'이라는 뜻이다 — 기전 그대로다.");
    expect(rows.length).toBeGreaterThan(30);
  });

  // ── 왜 작은 OO는 오히려 나쁜가 — 점유율 상한 ─────────────────────────────
  //
  // 훑기 표에서 OO=10~30이 OO=0보다 **나쁘다**(비단조). 기전대로면 단조여야 한다.
  // 원인은 `share = Math.min(1, rawShare x 입지배율)`의 **상한**이다.
  //
  //   독점매장의 rawShare는 OO=0에서 정확히 1이다. 입지배율이 1보다 크면 상한에 걸려
  //   share=1로 잘린다. OO를 조금 넣어 rawShare가 0.91이 돼도 **입지배율을 곱하면 아직
  //   1을 넘어** 여전히 상한에 걸린다 — 독점은 한 칸도 안 움직인다.
  //   그런데 경쟁상권은 상한 근처가 아니라 그대로 깎인다.
  //   ⇒ 축척이 안 올라가는데 경쟁상권만 내려가서 **과소예측이 더 심해진다.**
  //
  // 독점이 상한에서 떨어져 나오는 지점부터 비로소 기전대로 움직인다.
  it("비단조 구간의 정체 — 독점매장이 점유율 상한에 걸려 있다", () => {
    const monos = rows.filter(isMono);
    console.log(`\n[점유율 상한] 독점 ${monos.length}곳이 언제 상한에서 떨어지나`);
    console.log("     OO   " + monos.map((r) => (r.input.storeName ?? "").padStart(12)).join(" "));
    for (const oo of [0, 10, 20, 30, 40, 50, 60, 75, 100]) {
      const sc = scoreTextbook(rows, withOO(oo));
      const cells = monos.map((r) => {
        const x = sc.rows.find((y) => y.storeCode === r.input.storeCode);
        // ⚠️ `capped`는 **가동률** 상한(maxUtilization) 표시다. 여기서 볼 것은 **점유율**
        //    상한이라 1.000에 붙었는지로 직접 본다.
        const s = x?.share;
        return `${s == null ? "-" : s.toFixed(3)}${s != null && s >= 0.9995 ? "*" : " "}`.padStart(12);
      });
      console.log(`  ${String(oo).padStart(5)}   ${cells.join(" ")}`);
    }
    console.log("  (* = 상한에 걸림) 전부 *인 구간에서는 OO가 독점을 못 깎아 축척이 안 올라간다.");
    console.log("  ⚠️ 그 구간에서는 경쟁상권만 깎여 **과소예측이 더 심해진다** — 훑기 표의 비단조가 이것이다.");
    expect(monos.length).toBeGreaterThan(0);
  });

  // ── 관문 1 — 자유도 맞춘 가짜 손잡이 ──────────────────────────────────────
  //
  // "경쟁상권 매장의 예측에 상수 k를 곱한다"는 손잡이를 만든다. 뜻이 전혀 없다. 자유도는
  // 바깥선택지와 똑같이 **1개**다. 바깥선택지가 이걸 못 이기면 기전이 일한 게 아니라
  // 경쟁/독점 사이 **수준차 한 칸**을 흡수한 것이다.
  it("관문 1 — 뜻 없는 1자유도(경쟁상권 상수배율)와 홀드아웃에서 견준다", () => {
    // ⚠️ **표본 안에서 견주면 안 된다.** 둘 다 자유도가 1이라 표본 안에서는 둘 다 좋아진다.
    //    가르는 자리는 홀드아웃이다 — 겹마다 값을 다시 고르고, 안 본 매장에서 잰다.
    const errBase: number[] = [];
    const errOO: number[] = [];
    const errK: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const train = rows.filter((_, k) => k !== i);
      const actual = rows[i].actualRevenue;

      const e0 = absErr(holdoutPred(i, 0), actual);
      if (e0 != null) errBase.push(e0);

      const oo = pickOO(train).oo;
      const eo = absErr(holdoutPred(i, oo), actual);
      if (eo != null) errOO.push(eo);

      // 가짜 손잡이는 OO=0 위에서 예측을 곱하기만 한다. 독점은 손대지 않는다(수준차 전용).
      const k = pickK(train).k;
      const raw = holdoutPred(i, 0);
      const ek = absErr(raw == null ? null : (isMono(rows[i]) ? raw : raw * k), actual);
      if (ek != null) errK.push(ek);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const b = mean(errBase), o = mean(errOO), k = mean(errK);
    console.log(`\n[관문 1] 자유도 1개짜리 둘 — **홀드아웃** MAPE (겹마다 값을 다시 고른다)`);
    console.log(`  기준 (OO=0, 손잡이 없음)          ${(b * 100).toFixed(2)}%`);
    console.log(`  뜻 없는 상수배율 k               ${(k * 100).toFixed(2)}%  (${((b - k) * 100).toFixed(2)}%p 좋아짐)`);
    console.log(`  바깥선택지 OO                   ${(o * 100).toFixed(2)}%  (${((b - o) * 100).toFixed(2)}%p 좋아짐)`);
    console.log(`  => 바깥선택지가 가짜 손잡이보다 ${((k - o) * 100).toFixed(2)}%p 낫다`);
    console.log("  ⚠️ 이 차이가 0 근처면 '기전'이 아니라 경쟁/독점 수준차를 흡수한 것이다.");
    expect(errBase.length).toBeGreaterThan(30);
  });

  // ── 관문 2 — 무작위 대조군 ────────────────────────────────────────────────
  //
  // 경쟁 구조(경쟁점 목록·합계IP·점포수)를 **매장끼리 통째로** 섞는다. 상권의 경쟁 구조가
  // 가짜가 되므로, 바깥선택지가 기전으로 일한다면 가짜 구조에서는 이득이 줄어야 한다.
  // 이득이 그대로면 그건 자유도가 만든 것이다.
  it("관문 2 — 경쟁 구조를 섞어도 같은 이득이 나오나", () => {
    // ⚠️ **독점 집합은 고정한다.** 독점/경쟁 라벨까지 섞으면 축척을 맞추는 매장이 바뀌어
    //    기준선이 통째로 무너진다. 그러면 "이득 폭"이 커지는 게 당연해서 나란히 못 놓는다.
    //    여기서 깨뜨릴 것은 **어느 매장에 어느 경쟁 구조가 붙어 있나**뿐이다.
    const compIdx = rows.map((_, i) => i).filter((i) => !isMono(rows[i]));
    const shuffled = (rand: () => number): LabRow[] => {
      const perm = [...compIdx];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      const srcOf = new Map<number, number>();
      compIdx.forEach((dst, k) => srcOf.set(dst, perm[k]));
      return rows.map((r, i) => {
        const s = srcOf.get(i);
        if (s == null) return r;
        const src = rows[s].input;
        return {
          actualRevenue: r.actualRevenue,
          input: {
            ...r.input,
            rivals: src.rivals,
            competitorIp: src.competitorIp,
            competitorCount: src.competitorCount,
          },
        };
      });
    };

    const realBase = scoreTextbook(rows, withOO(0)).mape ?? Number.POSITIVE_INFINITY;
    const realBest = pickOO(rows);
    const realGain = realBase - realBest.mape;

    const rand = mulberry32(20260920);
    const gains: number[] = [];
    const bases: number[] = [];
    for (let t = 0; t < 200; t++) {
      const sh = shuffled(rand);
      const b = scoreTextbook(sh, withOO(0)).mape ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(b)) continue;
      bases.push(b);
      gains.push(b - pickOO(sh).mape);
    }
    const sortedG = [...gains].sort((a, b) => a - b);
    const sortedB = [...bases].sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    const pValue = (gains.filter((g) => g >= realGain).length + 1) / (gains.length + 1);
    console.log(`\n[관문 2] 경쟁 구조를 매장끼리 섞는다 — 독점 ${rows.length - compIdx.length}곳은 고정 (${gains.length}회)`);
    console.log(`  기준선    실제 ${(realBase * 100).toFixed(2)}%   vs  섞으면 중앙 ${(q(sortedB, 0.5) * 100).toFixed(2)}%`);
    console.log(`  좋아진 폭  실제 ${(realGain * 100).toFixed(2)}%p (OO=${realBest.oo})` +
      `  vs  섞으면 중앙 ${(q(sortedG, 0.5) * 100).toFixed(2)}%p · 95퍼센타일 ${(q(sortedG, 0.95) * 100).toFixed(2)}%p`);
    console.log(`  p = ${pValue.toFixed(3)}  ${pValue <= 0.05 ? "통과 ✅" : "미달 ❌"}`);
    console.log("  ⚠️ **기준선 두 줄을 먼저 볼 것.** 섞은 쪽 기준선이 크게 나쁘면 고칠 여지도 그만큼");
    console.log("     커져서 '좋아진 폭'을 나란히 못 놓는다. 그때 이 p값은 판정이 아니라 참고다.");
    expect(gains.length).toBeGreaterThan(100);
  });

  // ── 관문 3 — LOO 홀드아웃 ────────────────────────────────────────────────
  //
  // ⚠️ **축척까지 훈련겹에서만 맞춘다.** `scoreTextbook`은 넘긴 행에서 축척을 맞추므로,
  //    전체 행으로 채점하면 홀드아웃 매장이 자기 축척을 본다(누수). `fittedParams`로
  //    훈련겹 축척을 굳힌 뒤 홀드아웃 한 곳에 `computeTextbook`을 돌린다.
  it("관문 3 — LOO 홀드아웃 (축척도 훈련겹에서만)", () => {
    const holdoutErr = (i: number, oo: number) => absErr(holdoutPred(i, oo), rows[i].actualRevenue);

    // (가) OO를 **고정**했을 때의 정직한 홀드아웃 곡선 — 고르는 자유도가 없다.
    console.log(`\n[관문 3-가] OO를 고정했을 때 홀드아웃 MAPE (자유도 없음)`);
    console.log("     OO   홀드아웃 MAPE   표본 안 MAPE    벌어짐");
    const fixedCurve: { oo: number; loo: number; inS: number }[] = [];
    for (const oo of GRID) {
      const errs: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const e = holdoutErr(i, oo);
        if (e != null) errs.push(e);
      }
      const loo = errs.reduce((a, b) => a + b, 0) / errs.length;
      const inS = scoreTextbook(rows, withOO(oo)).mape ?? NaN;
      fixedCurve.push({ oo, loo, inS });
      console.log(`  ${String(oo).padStart(5)}   ${(loo * 100).toFixed(2).padStart(9)}%   ` +
        `${(inS * 100).toFixed(2).padStart(9)}%   ${((loo - inS) * 100).toFixed(2).padStart(6)}%p`);
    }
    const bestFixed = fixedCurve.reduce((a, b) => (b.loo < a.loo ? b : a));
    console.log(`  홀드아웃 최선: OO=${bestFixed.oo} (${(bestFixed.loo * 100).toFixed(2)}%)` +
      ` · OO=0은 ${(fixedCurve[0].loo * 100).toFixed(2)}%`);

    // (나) 겹마다 OO를 **고른다** — 고르는 자유도까지 포함한 정직한 값.
    const picked = new Map<number, number>();
    const errs: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const train = rows.filter((_, k) => k !== i);
      const oo = pickOO(train).oo;
      picked.set(oo, (picked.get(oo) ?? 0) + 1);
      const e = holdoutErr(i, oo);
      if (e != null) errs.push(e);
    }
    const loo = errs.reduce((a, b) => a + b, 0) / errs.length;
    const inSample = pickOO(rows);
    console.log(`\n[관문 3-나] 겹마다 OO를 고른다 (자유도 포함)`);
    console.log(`  표본 안 ${(inSample.mape * 100).toFixed(2)}% (OO=${inSample.oo})` +
      ` -> 홀드아웃 ${(loo * 100).toFixed(2)}%  벌어짐 ${((loo - inSample.mape) * 100).toFixed(2)}%p`);
    console.log(`  훈련겹이 고른 OO: ` +
      [...picked.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}(${n}회)`).join(" · "));
    expect(errs.length).toBeGreaterThan(30);
  });

  // ── 기전 확인 ────────────────────────────────────────────────────────────
  //
  // 바깥선택지가 진짜로 "경쟁점 무게"에 작용한다면, **경쟁점이 많은 매장일수록 덜 뜨고**
  // 적은 매장일수록 더 떠야 한다(분모에서 OO가 차지하는 몫이 다르므로). 잔차가 경쟁 규모와
  // 어떻게 움직이는지 본다 — 뜻 없는 상수배율은 이 기울기를 못 만든다.
  it("기전 — 경쟁 규모에 따라 다르게 뜨는가", () => {
    // ⚠️ **`competitorIp`를 쓰면 안 된다.** 점유율 분모에 들어가는 건 유효거리(300m) 안
    //    경쟁점의 IP 합이고, `competitorIp`는 미조사 500m 점포를 100대로 추정해 채운 **다른
    //    값**이다(타입 주석). 문경시청점은 경쟁IP 385인데 유효거리 안에는 0곳이라, 분모로는
    //    사실상 독점이다. 저 값으로 가로축을 잡으면 기전이 거꾸로 보인다.
    const rivalIpOf = (r: LabRow) =>
      (r.input.rivals ?? [])
        .filter((x) => x.ip > 0 && (x.distanceM == null || x.distanceM <= P.effectiveRadiusM))
        .reduce((s, x) => s + x.ip, 0);
    const lift = (oo: number) => {
      const b0 = scoreTextbook(rows, withOO(0));
      const b1 = scoreTextbook(rows, withOO(oo));
      const m0 = new Map(b0.rows.map((x) => [x.storeCode, x.predicted]));
      const m1 = new Map(b1.rows.map((x) => [x.storeCode, x.predicted]));
      return rows
        .filter((r) => !isMono(r))
        .map((r) => {
          const a = m0.get(r.input.storeCode), b = m1.get(r.input.storeCode);
          return a != null && b != null && a > 0
            ? { ip: rivalIpOf(r), ratio: b / a, name: r.input.storeName ?? r.input.storeCode }
            : null;
        })
        .filter((x): x is { ip: number; ratio: number; name: string } => x !== null);
    };

    // ⚠️ 독점 3곳이 전부 상한에서 떨어진 뒤라야 기전이 깨끗하게 보인다(위 [점유율 상한]).
    //    상한 구간(OO≲30)에서 재면 기전과 반대로 찍힌다.
    const AT = 75; // 홀드아웃 최선 자리
    console.log(`\n[기전] OO=${AT}가 경쟁상권 매장을 얼마나 띄우나 (유효경쟁IP 적은 순)`);
    const xs = lift(AT).sort((a, b) => a.ip - b.ip);
    for (const x of xs) {
      console.log(`  ${x.name.padEnd(14)} 유효경쟁IP ${String(x.ip).padStart(5)}  ${((x.ratio - 1) * 100).toFixed(1).padStart(6)}% 뜸`);
    }
    const span = xs.length ? (xs[xs.length - 1].ratio - xs[0].ratio) * 100 : 0;
    console.log(`  => 경쟁 많은 곳이 적은 곳보다 ${span.toFixed(1)}%p 더 뜬다` +
      ` ${span > 0 ? "(기전대로: 분모가 커서 덜 깎인다)" : "(기전과 반대다 — 다시 볼 것)"}`);
    console.log("  ⚠️ 이 폭이 0 근처면 사실상 상수배율과 같다는 뜻이다.");
    expect(xs.length).toBeGreaterThan(20);
  });

  // ── 누가 좋아지고 누가 나빠지나 ───────────────────────────────────────────
  //
  // MAPE는 평균이라 **꼬리 몇 곳**이 통째로 끌어내릴 수 있다. 훑기에서 MAPE는 좋아지는데
  // ±20%와 중앙은 나빠지는 모양이 보였다 — 그러면 "가운데가 흐트러지고 꼬리만 붙은" 것이라
  // 채택 근거가 아니다. 매장별로 열어서 확인한다.
  it("MAPE가 어디서 좋아지나 — 꼬리인가 가운데인가", () => {
    const OO = 75; // 홀드아웃 최선 자리(훑기 표 참고). 상한 구간을 지난 뒤라야 뜻이 있다.
    const before = scoreTextbook(rows, withOO(0));
    const after = scoreTextbook(rows, withOO(OO));
    const mb = new Map(before.rows.map((x) => [x.storeCode, x]));
    const ma = new Map(after.rows.map((x) => [x.storeCode, x]));
    type D = { name: string; e0: number; e1: number; d: number };
    const ds: D[] = [];
    for (const r of rows) {
      const a = mb.get(r.input.storeCode), b = ma.get(r.input.storeCode);
      if (!a || !b || a.absErrPct == null || b.absErrPct == null) continue;
      ds.push({
        name: r.input.storeName ?? r.input.storeCode,
        e0: a.absErrPct, e1: b.absErrPct, d: b.absErrPct - a.absErrPct,
      });
    }
    const better = ds.filter((x) => x.d < 0), worse = ds.filter((x) => x.d > 0);
    const sum = (a: D[]) => a.reduce((s, x) => s + x.d, 0);
    console.log(`\n[누가 움직이나] OO=0 -> OO=${OO} (${ds.length}곳)`);
    console.log(`  좋아진 곳 ${better.length}곳 (합 ${(sum(better) * 100).toFixed(1)}%p)` +
      ` · 나빠진 곳 ${worse.length}곳 (합 +${(sum(worse) * 100).toFixed(1)}%p)`);
    const top = [...ds].sort((a, b) => a.d - b.d);
    console.log("  제일 좋아진 5곳:");
    for (const x of top.slice(0, 5)) {
      console.log(`    ${x.name.padEnd(14)} ${(x.e0 * 100).toFixed(1).padStart(5)}% -> ${(x.e1 * 100).toFixed(1).padStart(5)}%`);
    }
    console.log("  제일 나빠진 5곳:");
    for (const x of top.slice(-5).reverse()) {
      console.log(`    ${x.name.padEnd(14)} ${(x.e0 * 100).toFixed(1).padStart(5)}% -> ${(x.e1 * 100).toFixed(1).padStart(5)}%`);
    }
    console.log("  ⚠️ 좋아진 곳이 원래 오차가 컸던 꼬리에 몰려 있고 나빠진 곳이 가운데면,");
    console.log("     MAPE는 내려가도 **±20%·중앙은 나빠진다**. 훑기 표에서 그 모양을 확인할 것.");
    expect(ds.length).toBeGreaterThan(30);
  });
});
