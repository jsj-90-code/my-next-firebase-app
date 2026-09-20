// 축척 기준점(독점 3곳)에 특수수요 배수를 안 걸면 어떻게 되나 (2026-09-20)
//
// ── 왜 이걸 재나 ───────────────────────────────────────────────────────────
// 수요 축척 A(`hoursPerUserPerMonth`)는 **독점매장 3곳**에서만 맞춰진다(`calibrationTarget`).
// 그런데 그 3곳 중 2곳이 특수수요 배수를 갖고 있다:
//
//     탕정역점  산업단지 1.39   ← 배수가 기준점을 부풀린다
//     남악점    기타    1.25   ← 배수가 기준점을 부풀린다
//     광주각화점 없음    1.00   ← 유일하게 깨끗한 기준점
//
// 배수를 켜면 그 2곳의 수요가 커져 **A가 내려가고**(6.885 -> 5.727, −16.8%), 배수가 없는
// 매장 22곳은 가만히 있는데 수요가 16.8% 줄어든다. 그리고 **필요 점유율 100% 초과 6곳이
// 전부 "없음" 유형**이다(`_underserved` (1)절). 즉 지금 구조는 **제일 굶는 쪽에서 걷어다
// 특수수요 쪽에 얹어 준다.**
//
// ⚠️ 이 순환은 2026-09-16에 이미 주석으로 경고돼 있었다(`specialDemandMultipliers`):
//    *"축척이 순환한다 — 2차 가공 때 꼭 볼 것. (...) 순수 기준점은 광주각화점 하나뿐이다."*
//    2026-09-19에 고치는 법 넷을 시도해 전부 기각했는데(docs/releases/2026-09-19-수요축척.md 5절),
//    **그 넷에 "기준점만 면제"는 없었다.** 3번 "배수 유도에서 독점 빼기"는 배수 **값을 뽑을 때**
//    독점을 뺀 것이고, 여기서는 **배수를 적용할 때** 기준점을 뺀다. 다른 수술이다.
//
// ── 갈래가 둘이다. 섞으면 안 된다 ─────────────────────────────────────────
//   (다) **기준점 면제** — 독점 3곳은 축척에서도 예측에서도 배수 1로 본다.
//        자가 반듯해지고(3곳이 한 줄), 나머지 35곳 수요가 다 같이 올라간다.
//   (라) **축척에서만 면제** — 축척은 배수 없이 잡고, 예측에는 독점에도 배수를 건다.
//        사실상 **전 매장 수요를 20% 올리는 것**과 같다. 기준점 흩어짐은 그대로 남는다.
//
// ⚠️ **측정만 한다. 채택하지 않는다.** 값은 사용자가 고른다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_anchorExemption.test.ts --disable-console-intercept
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

describeIf("축척 기준점에 배수를 안 걸면", () => {
  // 조립은 화면과 **같은 함수**(buildLabRows)를 쓴다 — _textbookFull.test.ts와 같다.
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

  /** 독점상권인가 — 축척이 여기서 맞춰진다(`calibrationTarget`과 같은 잣대). */
  const isMono = (r: LabRow) => !(r.input.competitorIp ?? 0);

  /**
   * 배수를 끄는 건 **유형을 "없음"으로 바꾸는 것**으로 한다. 파라미터 표를 손대면
   * 다른 시험까지 끌려가고, 유형을 바꾸면 모델 코드를 한 줄도 안 고치고 같은 일이 된다.
   */
  const asNone = (rs: LabRow[], which: (r: LabRow) => boolean): LabRow[] =>
    rs.map((r) => (which(r) ? { actualRevenue: r.actualRevenue, input: { ...r.input, specialDemandType: "없음" } } : r));
  const monoAsNone = (rs: LabRow[]) => asNone(rs, isMono);
  const allAsNone = (rs: LabRow[]) => asNone(rs, () => true);

  type Metrics = {
    label: string; mape: number; median: number; within20: number;
    hours: number; overOne: number;
    monoReq: { name: string; type: string; req: number }[];
  };

  /** 독점 3곳의 필요 점유율 — 자가 반듯한지 보는 자리다. */
  const monoReqFrom = (sc: ReturnType<typeof scoreTextbook>) =>
    rows.filter(isMono).map((r) => ({
      name: r.input.storeName ?? r.input.storeCode,
      type: r.input.specialDemandType ?? "없음",
      req: sc.rows.find((x) => x.storeCode === r.input.storeCode)?.requiredShare ?? NaN,
    }));

  /** (가)(나)(다)처럼 **행만 바꿔서** 통째로 채점하는 갈래. */
  const scored = (label: string, rs: LabRow[]): Metrics => {
    const sc = scoreTextbook(rs, P);
    return {
      label,
      mape: sc.mape ?? NaN, median: sc.medianAbsErr ?? NaN, within20: sc.within20 ?? NaN,
      hours: sc.fittedHoursPerUser, overOne: sc.requiredShare?.overOne ?? NaN,
      monoReq: monoReqFrom(sc),
    };
  };

  /**
   * (라) 축척만 배수 없이 잡고 **예측에는 배수를 건다.**
   *
   * `scoreTextbook`은 넘긴 행에서 축척을 다시 맞추므로 한 번에 못 한다. 배수를 끈 행으로
   * 축척을 뽑아 `fittedParams`로 굳힌 뒤, **원본 행**에 `computeTextbook`을 돌린다.
   * (필요 점유율의 정의는 `scoreTextbook`과 같게 맞춘다 — shareMode "off" · 상한 해제.)
   */
  const scoredFixedScale = (label: string, fitRows: LabRow[]): Metrics => {
    const full = fittedParams(P, scoreTextbook(fitRows, P));
    const errs: number[] = [];
    const reqs: { code: string; req: number }[] = [];
    for (const r of rows) {
      const b = computeTextbook(r.input, full);
      if (b.monthlyRevenue != null && r.actualRevenue > 0) {
        errs.push(Math.abs(b.monthlyRevenue - r.actualRevenue) / r.actualRevenue);
      }
      const bNo = computeTextbook(r.input, { ...full, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY });
      const au = r.input.actualUtilization;
      if (bNo.utilization != null && bNo.utilization > 0 && au != null && au > 0) {
        reqs.push({ code: r.input.storeCode, req: au / bNo.utilization });
      }
    }
    const sorted = [...errs].sort((a, b) => a - b);
    return {
      label,
      mape: errs.reduce((a, b) => a + b, 0) / errs.length,
      median: sorted[Math.floor(sorted.length / 2)],
      within20: errs.filter((v) => v <= 0.2).length / errs.length,
      hours: full.hoursPerUserPerMonth,
      overOne: reqs.filter((x) => x.req > 1).length,
      monoReq: rows.filter(isMono).map((r) => ({
        name: r.input.storeName ?? r.input.storeCode,
        type: r.input.specialDemandType ?? "없음",
        req: reqs.find((x) => x.code === r.input.storeCode)?.req ?? NaN,
      })),
    };
  };

  const VARIANTS = () => [
    scored("가) 지금 — 배수 켬", rows),
    scored("나) 배수 완전히 끔", allAsNone(rows)),
    scored("다) 기준점 면제 — 독점은 축척·예측 모두 배수 1", monoAsNone(rows)),
    scoredFixedScale("라) 축척에서만 면제 — 예측엔 독점에도 배수", monoAsNone(rows)),
  ];

  it("(1) 네 갈래 나란히", () => {
    const vs = VARIANTS();
    console.log(`\n[네 갈래] 표본 ${rows.length}곳 · 독점 ${rows.filter(isMono).length}곳`);
    console.log("  갈래                                    MAPE     중앙   ±20%    축척A   100%초과");
    for (const v of vs) {
      console.log(`  ${v.label.padEnd(38)}${(v.mape * 100).toFixed(2).padStart(6)}%  ` +
        `${(v.median * 100).toFixed(1).padStart(5)}%  ${(v.within20 * 100).toFixed(0).padStart(3)}%  ` +
        `${v.hours.toFixed(3).padStart(7)}  ${String(v.overOne).padStart(5)}곳`);
    }

    console.log(`\n[자가 반듯한가] 축척 기준점 3곳의 필요 점유율 — 셋이 한 줄이어야 한다`);
    for (const v of vs) {
      const rs = v.monoReq;
      const vals = rs.map((x) => x.req).filter((x) => Number.isFinite(x));
      const spread = vals.length ? Math.max(...vals) / Math.min(...vals) : NaN;
      console.log(`  ${v.label}`);
      for (const x of rs) {
        console.log(`      ${x.name.padEnd(12)} ${x.type.padEnd(6)} ${(x.req * 100).toFixed(1).padStart(6)}%`);
      }
      console.log(`      -> 최대÷최소 ${spread.toFixed(3)}배`);
    }
    expect(vs.length).toBe(4);
  });

  it("(2) 굶던 6곳은 어떻게 되나", () => {
    const base = scoreTextbook(rows, P);
    const starving = base.rows
      .filter((x) => (x.requiredShare ?? 0) > 1)
      .map((x) => x.storeCode);
    const sets: { label: string; sc: ReturnType<typeof scoreTextbook> }[] = [
      { label: "지금", sc: base },
      { label: "배수끔", sc: scoreTextbook(allAsNone(rows), P) },
      { label: "기준점면제", sc: scoreTextbook(monoAsNone(rows), P) },
    ];
    console.log(`\n[굶던 ${starving.length}곳의 필요 점유율] 100% 아래로 내려오나`);
    console.log("  매장                " + sets.map((s) => s.label.padStart(10)).join(" "));
    for (const code of starving) {
      const name = rows.find((r) => r.input.storeCode === code)?.input.storeName ?? code;
      const cells = sets.map((s) => {
        const v = s.sc.rows.find((x) => x.storeCode === code)?.requiredShare;
        return `${v == null ? "-" : (v * 100).toFixed(1) + "%"}`.padStart(10);
      });
      console.log(`  ${name.padEnd(18)}${cells.join(" ")}`);
    }
    console.log("  ⚠️ (라)는 (다)와 같은 축척이라 비독점 매장의 필요 점유율이 (다)와 같다 — 생략했다.");

    // ⚠️ **원래 굶던 곳만 보면 안 된다.** 배수를 끄면 배수를 받던 매장이 수요를 잃어
    //    **새로 굶는 곳**이 생긴다. 갈래마다 100% 초과를 통째로 다시 센다.
    console.log(`\n[갈래별 100% 초과 전체 명단]`);
    for (const s of sets) {
      const over = s.sc.rows
        .filter((x) => (x.requiredShare ?? 0) > 1)
        .map((x) => {
          const r = rows.find((y) => y.input.storeCode === x.storeCode);
          return `${r?.input.storeName ?? x.storeCode}(${r?.input.specialDemandType ?? "없음"} ${((x.requiredShare ?? 0) * 100).toFixed(0)}%)`;
        });
      console.log(`  ${s.label.padEnd(10)} ${over.length}곳 — ${over.join(" · ")}`);
    }
    expect(starving.length).toBeGreaterThan(0);
  });

  it("(3) 유형별로 수요가 얼마나 옮겨가나", () => {
    const A = (rs: LabRow[]) => scoreTextbook(rs, P).fittedHoursPerUser;
    const aNow = A(rows), aOff = A(allAsNone(rows)), aExempt = A(monoAsNone(rows));
    const mul = P.specialDemandMultipliers;
    const types = ["군부대", "대학가", "산업단지", "기타", "없음"];
    const count = (t: string) => rows.filter((r) => (r.input.specialDemandType ?? "없음") === t).length;
    console.log(`\n[수요가 어디로 가나] 축척 A: 지금 ${aNow.toFixed(3)} · 배수끔 ${aOff.toFixed(3)} · 기준점면제 ${aExempt.toFixed(3)}`);
    console.log("  유형        곳수   배수    지금 수요   배수끔 대비   기준점면제 대비 지금");
    for (const t of types) {
      const m = mul[t] ?? 1;
      const now = aNow * m, off = aOff * 1, ex = aExempt * m;
      console.log(`  ${t.padEnd(8)}${String(count(t)).padStart(4)}곳  ${m.toFixed(2)}  ` +
        `${now.toFixed(3).padStart(9)}  ${(((now / off) - 1) * 100).toFixed(1).padStart(10)}%  ` +
        `${(((ex / now) - 1) * 100).toFixed(1).padStart(14)}%`);
    }
    console.log("  ⚠️ '배수끔 대비'가 음수인 유형 = 배수를 켜서 **수요를 빼앗긴** 유형이다.");
    console.log("     굶는 6곳이 전부 '없음'이므로, 빼앗기는 쪽이 정확히 제일 모자란 쪽이다.");
    expect(aNow).toBeGreaterThan(0);
  });

  it("(4) LOO 홀드아웃 — 축척까지 훈련겹에서만", () => {
    // ⚠️ 표본 안 성적만 보면 안 된다. 갈래마다 안 본 매장을 맞혀 본다.
    const looOf = (transform: (rs: LabRow[]) => LabRow[]) => {
      const errs: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const train = transform(rows.filter((_, k) => k !== i));
        const full = fittedParams(P, scoreTextbook(train, P));
        // 홀드아웃 행도 같은 규칙을 받는다(독점이면 면제 대상일 수 있다).
        const one = transform([rows[i]])[0];
        const b = computeTextbook(one.input, full);
        const a = rows[i].actualRevenue;
        if (b.monthlyRevenue != null && a > 0) errs.push(Math.abs(b.monthlyRevenue - a) / a);
      }
      const sorted = [...errs].sort((x, y) => x - y);
      return {
        mape: errs.reduce((x, y) => x + y, 0) / errs.length,
        median: sorted[Math.floor(sorted.length / 2)],
        within20: errs.filter((v) => v <= 0.2).length / errs.length,
      };
    };
    const cases: [string, (rs: LabRow[]) => LabRow[]][] = [
      ["가) 지금 — 배수 켬", (rs) => rs],
      ["나) 배수 완전히 끔", allAsNone],
      ["다) 기준점 면제", monoAsNone],
    ];
    console.log(`\n[LOO 홀드아웃] 축척까지 훈련겹에서만 맞춘다`);
    console.log("  갈래                        MAPE     중앙   ±20%");
    for (const [label, fn] of cases) {
      const r = looOf(fn);
      console.log(`  ${label.padEnd(26)}${(r.mape * 100).toFixed(2).padStart(6)}%  ` +
        `${(r.median * 100).toFixed(1).padStart(5)}%  ${(r.within20 * 100).toFixed(0).padStart(3)}%`);
    }
    expect(rows.length).toBeGreaterThan(30);
  });
});
