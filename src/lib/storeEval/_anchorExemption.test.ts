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
  fitProductUnitPrice,
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

  // ── 배수를 **다시** 뽑는다 ───────────────────────────────────────────────
  //
  // 지금 배수(군부대 2.25 · 대학가 1.45 · 산업단지 1.39 · 기타 1.25)는 2026-09-16에
  // **오염된 자 위에서** 뽑은 값이다 — 그때도 축척 기준점 2곳이 배수를 받고 있었다.
  //
  // ⚠️ **기준점을 면제하면 순환이 끊긴다.** 독점 3곳이 배수를 안 받으므로 축척 A가
  //    배수와 **무관**해진다(어떤 배수를 넣어도 A=6.796 고정). 그래서 이제 배수를
  //    자유롭게 다시 뽑아도 자가 안 흔들린다. 2026-09-19에 "순환"이라고 지목했던 자리가
  //    바로 여기다(docs/releases/2026-09-19-수요축척.md 5절 3번).
  //
  // 뽑는 법은 2026-09-16과 **같다** — 유형별 필요 점유율 중앙값을 "없음" 대비로 나눈다.
  // 사용자(2026-09-20): *"값은 수요 다시잡아보고 전체값중 가장 중간값으로 적용하는쪽으로?
  // 검증이안되니"* — 중앙값을 쓰는 건 검증이 안 될 때의 보수적 선택이다.
  //
  // ⚠️ **유도에서 독점 3곳을 뺀다.** 그 셋은 필요 점유율이 100%에 **박혀 있다**(A가 그렇게
  //    맞춰진다). 넣으면 그 유형만 근거 없이 높게 잡힌다. 기준점 면제와 짝이 맞는 처리다.
  const deriveMultipliers = () => {
    // 배수를 전부 끈 상태에서 잰다 — 축척은 기준점 면제와 **같은 값**(6.796)이다.
    const sc = scoreTextbook(allAsNone(rows), P);
    const byType = new Map<string, number[]>();
    for (const r of rows) {
      if (isMono(r)) continue; // 유도에서 독점 제외
      const req = sc.rows.find((x) => x.storeCode === r.input.storeCode)?.requiredShare;
      if (req == null || !Number.isFinite(req)) continue;
      const t = r.input.specialDemandType ?? "없음";
      byType.set(t, [...(byType.get(t) ?? []), req]);
    }
    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    const baseline = median(byType.get("없음") ?? [1]);
    const out = new Map<string, { n: number; med: number; mul: number }>();
    for (const [t, vals] of byType) {
      out.set(t, { n: vals.length, med: median(vals), mul: median(vals) / baseline });
    }
    return { out, baseline, hours: sc.fittedHoursPerUser };
  };

  it("(5) 자를 고친 뒤 배수를 다시 뽑으면 얼마가 나오나", () => {
    const { out, baseline, hours } = deriveMultipliers();
    console.log(`\n[배수 재도출] 배수 끈 상태 · 축척 A=${hours.toFixed(3)} · 독점 3곳은 유도에서 제외`);
    console.log(`  "없음" 중앙 필요점유율 ${(baseline * 100).toFixed(1)}% 를 1.00으로 놓는다`);
    console.log("  유형        곳수   중앙 필요점유율   새 배수    지금 배수");
    const order = ["군부대", "대학가", "산업단지", "기타", "관광·유흥", "없음"];
    for (const t of order) {
      const v = out.get(t);
      if (!v) continue;
      const now = P.specialDemandMultipliers[t] ?? 1;
      console.log(`  ${t.padEnd(9)}${String(v.n).padStart(3)}곳  ${(v.med * 100).toFixed(1).padStart(12)}%  ` +
        `${v.mul.toFixed(2).padStart(8)}  ${now.toFixed(2).padStart(9)}`);
    }
    console.log("  ⚠️ 곳수 2~5곳이다. 중앙값이라도 **한 곳이 빠지면 크게 흔들린다.**");
    console.log("     방향(군부대 > 나머지 > 없음)만 보고, 값은 보수적으로 잡을 자리다.");
    expect(out.size).toBeGreaterThan(1);
  });

  it("(6) 새 배수를 기준점 면제와 같이 쓰면", () => {
    const { out } = deriveMultipliers();
    // 관광·유흥은 n=2라 지금처럼 1.00으로 둔다(값을 지어내지 않는다).
    const fresh: Record<string, number> = { ...P.specialDemandMultipliers };
    for (const t of ["군부대", "대학가", "산업단지", "기타"]) {
      const v = out.get(t);
      if (v) fresh[t] = Number(v.mul.toFixed(2));
    }
    const freshP: TextbookParams = { ...P, specialDemandMultipliers: fresh };

    const show = (label: string, rs: LabRow[], p: TextbookParams) => {
      const sc = scoreTextbook(rs, p);
      const over = sc.rows.filter((x) => (x.requiredShare ?? 0) > 1).length;
      console.log(`  ${label.padEnd(34)}${((sc.mape ?? 0) * 100).toFixed(2).padStart(6)}%  ` +
        `${((sc.medianAbsErr ?? 0) * 100).toFixed(1).padStart(5)}%  ${((sc.within20 ?? 0) * 100).toFixed(0).padStart(3)}%  ` +
        `${sc.fittedHoursPerUser.toFixed(3).padStart(7)}  ${String(over).padStart(5)}곳`);
      return sc;
    };
    console.log(`\n[새 배수 적용] ` + Object.entries(fresh)
      .filter(([k]) => ["군부대", "대학가", "산업단지", "기타"].includes(k))
      .map(([k, v]) => `${k} ${v}`).join(" · "));
    console.log("  갈래                                MAPE     중앙   ±20%    축척A   100%초과");
    // ⚠️ **배수가 1 아래로 내려가면 뜻이 안 맞는다.** 배수는 "인구 통계에 안 잡히는 수요원"이라
    //    최소가 1이다(추가 수요원이 있는데 수요가 줄 수는 없다). 1 아래는 "그 유형은 특수수요가
    //    아니다"로 읽고 1.00으로 올린다 — 값을 지어내지 않되, 뜻에 어긋나는 값도 안 쓴다.
    const floored: Record<string, number> = { ...fresh };
    for (const t of ["군부대", "대학가", "산업단지", "기타"]) floored[t] = Math.max(1, fresh[t] ?? 1);
    const flooredP: TextbookParams = { ...P, specialDemandMultipliers: floored };

    show("가) 지금 배수 · 기준점 안 면제", rows, P);
    show("다) 지금 배수 · 기준점 면제", monoAsNone(rows), P);
    show("마) 새 배수 · 기준점 면제", monoAsNone(rows), freshP);
    show("바) 새 배수(1 아래는 1로) · 기준점 면제", monoAsNone(rows), flooredP);
    console.log(`     바) 값: ` + ["군부대", "대학가", "산업단지", "기타"].map((t) => `${t} ${floored[t].toFixed(2)}`).join(" · "));

    // LOO — 배수를 **겹마다 다시 뽑으면** 얼마나 흔들리나. 여기가 진짜 관문이다.
    const errs: number[] = [];
    const picked: Record<string, number[]> = { 군부대: [], 대학가: [], 산업단지: [], 기타: [] };
    for (let i = 0; i < rows.length; i++) {
      const trainRaw = rows.filter((_, k) => k !== i);
      const sc0 = scoreTextbook(allAsNone(trainRaw), P);
      const byType = new Map<string, number[]>();
      for (const r of trainRaw) {
        if (isMono(r)) continue;
        const req = sc0.rows.find((x) => x.storeCode === r.input.storeCode)?.requiredShare;
        if (req == null || !Number.isFinite(req)) continue;
        const t = r.input.specialDemandType ?? "없음";
        byType.set(t, [...(byType.get(t) ?? []), req]);
      }
      const med = (a: number[]) => {
        const s = [...a].sort((x, y) => x - y);
        return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 1;
      };
      const base = med(byType.get("없음") ?? [1]);
      const m: Record<string, number> = { ...P.specialDemandMultipliers };
      for (const t of Object.keys(picked)) {
        const vals = byType.get(t);
        // 표본 2곳 미만이면 유도하지 않는다 — 지금 값을 그대로 쓴다.
        if (vals && vals.length >= 2) { m[t] = med(vals) / base; picked[t].push(m[t]); }
      }
      const p2: TextbookParams = { ...P, specialDemandMultipliers: m };
      const full = fittedParams(p2, scoreTextbook(monoAsNone(trainRaw), p2));
      const one = monoAsNone([rows[i]])[0];
      const b = computeTextbook(one.input, full);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) errs.push(Math.abs(b.monthlyRevenue - a) / a);
    }
    const loo = errs.reduce((a, b) => a + b, 0) / errs.length;
    console.log(`\n[LOO] 겹마다 배수를 **다시 뽑는다** -> 홀드아웃 MAPE ${(loo * 100).toFixed(2)}%`);
    console.log("  겹마다 뽑힌 배수의 흔들림 폭:");
    for (const [t, vals] of Object.entries(picked)) {
      if (!vals.length) { console.log(`    ${t.padEnd(6)} — 유도 못 함(표본 2곳 미만)`); continue; }
      console.log(`    ${t.padEnd(6)} ${Math.min(...vals).toFixed(2)} ~ ${Math.max(...vals).toFixed(2)}  (${vals.length}겹)`);
    }
    console.log("  ⚠️ 흔들림이 크면 **중앙값으로 잡아도 값을 못 믿는다**는 뜻이다.");
    expect(errs.length).toBeGreaterThan(30);
  });

  // ── 축척 표본에 "100% 초과 매장"을 같이 넣는다 (2026-09-20 사용자 착상) ──────
  //
  // 사용자: *"배수끄고 실제매출이 점유율 100퍼 초과하는애들이 있으니까, 이런 매장들까지
  // 포함해서 수요식 다시잡고 배수를 거기에맞춰 넣어보자"*
  //
  // ── 왜 말이 되나 ───────────────────────────────────────────────────────
  // 지금 축척은 **독점 3곳**에서만 맞춘다. 독점은 점유율이 1이라 수요식을 직접 잴 수 있어서다.
  // 그런데 **필요 점유율 100% 초과도 수요식을 직접 재는 자다** — 경쟁을 아예 없다고 쳐도
  // 예측이 실매출에 못 미친다는 뜻이라, 경쟁 항과 무관하게 **"수요가 최소한 이만큼은 있다"**는
  // 하한을 준다. 독점이 등식 제약이라면 이쪽은 부등식 제약이다. 버릴 정보가 아니다.
  //
  // ⚠️ 2026-09-19에 기각한 "축척 표본 넓히기"와 **다르다.** 그때는 독점도(경쟁이 얼마나
  //    적은가) 문턱을 낮춰 표본을 넓혔고, 여기서는 **필요 점유율이 넘친 매장**을 넣는다.
  //    고르는 자가 다르다.
  //
  // ⚠️ 대가가 있다. A를 올리면 독점 3곳이 **과대예측**으로 간다(점유율 100%를 못 채운다).
  //    그게 틀린 건 아니다 — 독점이라고 동네 수요를 다 먹으란 법은 없다(집·모바일·다른 동네).
  //    다만 **지금까지 세워 온 "독점은 100%를 먹는다"는 가정을 버리는 것**이라 크게 갈린다.
  it("(7) 축척을 올리면 — 100% 초과를 자에 같이 넣는다", () => {
    // 배수를 끈 상태에서 본다(사용자 순서: 끄고 -> 수요 다시 -> 배수 다시).
    const off = allAsNone(rows);
    const A0 = scoreTextbook(off, P).fittedHoursPerUser;
    const base = scoreTextbook(off, P);
    const reqAt0 = new Map(base.rows.map((x) => [x.storeCode, x.requiredShare ?? NaN]));

    /** 축척 A를 **고정**해서 채점한다. 상품몫은 실측 가동률로 재므로 A와 무관하다. */
    const at = (A: number) => {
      const p: TextbookParams = { ...P, hoursPerUserPerMonth: A };
      const full: TextbookParams = { ...p, productUnitPrice: fitProductUnitPrice(off, p) };
      const errs: number[] = [];
      const signed: { e: number; mono: boolean }[] = [];
      let over = 0, maxReq = 0;
      for (const r of off) {
        const b = computeTextbook(r.input, full);
        if (b.monthlyRevenue != null && r.actualRevenue > 0) {
          errs.push(Math.abs(b.monthlyRevenue - r.actualRevenue) / r.actualRevenue);
          signed.push({ e: b.monthlyRevenue / r.actualRevenue - 1, mono: isMono(r) });
        }
        const req = (reqAt0.get(r.input.storeCode) ?? NaN) * (A0 / A); // 필요점유율 ∝ 1/A
        if (Number.isFinite(req)) { if (req > 1) over++; maxReq = Math.max(maxReq, req); }
      }
      const sorted = [...errs].sort((a, b) => a - b);
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      return {
        mape: avg(errs), median: sorted[Math.floor(sorted.length / 2)],
        within20: errs.filter((v) => v <= 0.2).length / errs.length,
        mono: avg(signed.filter((x) => x.mono).map((x) => x.e)),
        comp: avg(signed.filter((x) => !x.mono).map((x) => x.e)),
        over, maxReq,
      };
    };

    // 자를 어디까지 올릴 수 있나 — 후보 셋을 뜻으로 정한다.
    const reqs = [...reqAt0.values()].filter(Number.isFinite);
    const monoReqs = off.filter(isMono).map((r) => reqAt0.get(r.input.storeCode) ?? 1);
    const geo = (a: number[]) => Math.exp(a.reduce((x, y) => x + Math.log(y), 0) / a.length);
    const overSet = off.filter((r) => (reqAt0.get(r.input.storeCode) ?? 0) > 1)
      .map((r) => reqAt0.get(r.input.storeCode) as number);
    const A_now = A0;                                   // 지금 — 독점 3곳만
    const A_union = A0 * geo([...monoReqs, ...overSet]); // 독점 + 100%초과를 같이 기하평균
    const A_all = A0 * Math.max(...reqs);                // 전부 100% 이하가 되는 최소 A

    console.log(`\n[축척을 올리면] 배수 끈 상태 · 지금 A=${A0.toFixed(3)}`);
    console.log(`  후보:  지금 ${A_now.toFixed(2)} · 독점+초과 같이 ${A_union.toFixed(2)} · 전부 100%이하 ${A_all.toFixed(2)}`);
    console.log("      A     A배율     독점잔차   경쟁상권잔차     MAPE     중앙   ±20%  100%초과  최대필요점유율");
    const grid = [...new Set([A_now, A_now * 1.1, A_union, A_now * 1.4, A_now * 1.6, A_now * 1.8, A_all])]
      .sort((a, b) => a - b);
    for (const A of grid) {
      const s = at(A);
      const tag = Math.abs(A - A_now) < 1e-9 ? " <- 지금" : Math.abs(A - A_union) < 1e-9 ? " <- 독점+초과" :
        Math.abs(A - A_all) < 1e-9 ? " <- 전부 100%이하" : "";
      console.log(`  ${A.toFixed(2).padStart(6)}  ${(A / A_now).toFixed(2).padStart(6)}배  ` +
        `${(s.mono * 100).toFixed(1).padStart(8)}%  ${(s.comp * 100).toFixed(1).padStart(10)}%  ` +
        `${(s.mape * 100).toFixed(2).padStart(7)}%  ${(s.median * 100).toFixed(1).padStart(5)}%  ` +
        `${(s.within20 * 100).toFixed(0).padStart(3)}%  ${String(s.over).padStart(6)}곳  ` +
        `${(s.maxReq * 100).toFixed(0).padStart(11)}%${tag}`);
    }
    console.log("  ⚠️ 독점잔차가 양수로 커지는 게 대가다 — '독점은 동네 수요를 다 먹는다'를 버리는 것이다.");
    console.log("     경쟁상권잔차가 0에 붙는 자리와 독점잔차가 버틸 수 있는 자리 사이에서 고른다.");
    expect(grid.length).toBeGreaterThan(3);
  });

  it("(8) 올린 축척 위에서 배수를 다시 뽑으면", () => {
    const off = allAsNone(rows);
    const A0 = scoreTextbook(off, P).fittedHoursPerUser;
    const reqAt0 = new Map(scoreTextbook(off, P).rows.map((x) => [x.storeCode, x.requiredShare ?? NaN]));
    const monoReqs = off.filter(isMono).map((r) => reqAt0.get(r.input.storeCode) ?? 1);
    const overSet = off.filter((r) => (reqAt0.get(r.input.storeCode) ?? 0) > 1)
      .map((r) => reqAt0.get(r.input.storeCode) as number);
    const geo = (a: number[]) => Math.exp(a.reduce((x, y) => x + Math.log(y), 0) / a.length);

    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 1;
    };
    /** 주어진 A에서 유형별 배수를 다시 뽑는다. 필요점유율은 A에 반비례하므로 비는 **A와 무관**하다. */
    const derive = (label: string, A: number) => {
      const byType = new Map<string, number[]>();
      for (const r of rows) {
        if (isMono(r)) continue;
        const req = (reqAt0.get(r.input.storeCode) ?? NaN) * (A0 / A);
        if (!Number.isFinite(req)) continue;
        const t = r.input.specialDemandType ?? "없음";
        byType.set(t, [...(byType.get(t) ?? []), req]);
      }
      const baseline = median(byType.get("없음") ?? [1]);
      console.log(`\n  ${label} (A=${A.toFixed(2)}) · "없음" 중앙 ${(baseline * 100).toFixed(1)}%`);
      for (const t of ["군부대", "대학가", "산업단지", "기타", "관광·유흥"]) {
        const v = byType.get(t);
        if (!v) continue;
        console.log(`    ${t.padEnd(9)}${String(v.length).padStart(3)}곳  중앙 ${(median(v) * 100).toFixed(1).padStart(6)}%` +
          `  -> 배수 ${(median(v) / baseline).toFixed(2)}  (지금 ${(P.specialDemandMultipliers[t] ?? 1).toFixed(2)})`);
      }
    };
    console.log(`\n[배수 재도출 — 축척을 올려도 값이 같은가]`);
    derive("지금 축척", A0);
    derive("독점+초과 같이", A0 * geo([...monoReqs, ...overSet]));
    console.log(`\n  ⚠️ **배수는 유형끼리의 비라서 A를 올려도 안 바뀐다.** 위 두 줄이 같은 게 그 증거다.`);
    console.log(`     즉 "수요를 다시 잡고 배수를 다시 뽑는다"에서 **배수는 축척과 따로 논다** —`);
    console.log(`     축척은 '전체 수준', 배수는 '유형 간 차이'라 서로 다른 것을 재기 때문이다.`);
    expect(A0).toBeGreaterThan(0);
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
