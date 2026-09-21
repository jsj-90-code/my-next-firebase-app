// 후보지 점검표 — 산식이 잘못 보고 있을 법한 곳을 개점 전에 찾는다 (2026-09-21)
//
// ── 왜 ─────────────────────────────────────────────────────────────────────
// 오송점(N016)에서 실제로 걸렸다. 산식이 이 매장을 이렇게 보고 있었다:
//   · 유일한 경쟁점 팀플PC가 **342m**라 유효거리 300m 밖 -> 점유율 100% 완전 독점
//   · 편심도 0.542(표본 2위 = 상권 끝)인데 **지수가 0이라 안 본다**
//   · 대신 중심도가 입지배율을 **x1.280**으로 올려준다
//   · 유동500÷주거500 = 13.06배라 "번화가" -> 수요 원천이 유동으로 확정,
//     **주거 12,643명이 통째로 빠진다**(주거가 적어서 번화가가 됐는데)
// 사용자가 현장 감으로 잡았다. 자료로 재보니 전부 맞았다.
//
// **개점하면 늦다.** 그래서 같은 점검을 후보지 전체에 한 번에 돌린다. 손으로 한 곳씩
// 파는 대신 표를 뽑고, 빨간 칸이 있는 곳만 사람이 들여다본다.
//
// ── 무엇을 점검하나 (전부 오늘까지 자료로 근거가 확인된 것만) ─────────────
//   1. 평지 밖 경쟁점       ⚠️ **2026-09-21에 뜻이 바뀌었다.** 거리 감쇠를 채택하기 전에는
//                          "300m 밖은 산식이 0으로 센다"였다. 지금은 exp로 깎아서 센다
//                          (300m 평지 · λ150 · 총량 정규화 0.90). 그래서 보는 것도 바뀌었다 —
//                          **예측이 감쇠 곡선에 얼마나 매달려 있나**를 본다. 평지 안이 비었는데
//                          밖에만 경쟁점이 있으면 그 매장의 예측은 곡선 모양이 전부다.
//                          곁들여 '장산형'(자사 1대당 새로 세진 경쟁 대수)도 같이 센다 —
//                          장산점이 3.52대로 표본 1위였고 감쇠를 켜자 오차가 2.2 -> 40.5%로 뛰었다.
//   2. 편심도              산식이 **안 본다**(direction 지수 0). 높으면 상권 끝인데 반영이 없다.
//   3. 번화가 판정          유동500÷주거500 >= 8이면 주거를 통째로 버린다. 주거가 적어서
//                          번화가가 된 곳은 뒤집혀 있는 것이다.
//   4. 외삽                주거·유동이 기존점 38곳 범위 밖이면 검증 안 된 자리다.
//   5. 유동 반경 결측        300/400/1km가 비면 수요와 중심도가 **말없이** 빠진다.
//   6. 경쟁점 조사 품질      간략·외관만 조사는 기본대수·기본점수가 들어간다.
//                          그리고 **대수 칸이 비면 그 경쟁점은 산식에서 통째로 빠진다**(1-d).
//                          거리 밖이라 0으로 세는 것과 다른 문제다 — 감쇠를 어떻게 켜도 안 세진다.
//   7. 실험실 vs V62       기준선은 **매번 다시 잰다**(후보지 중앙 편차). 표 머리에 찍힌다.
//                          숫자를 여기 적어 두면 산식이 바뀔 때마다 낡는다 — 실제로
//                          "-26.6%"라고 적혀 있었는데 감쇠 채택 뒤 중앙이 -17%로 옮겨 갔다.
//                          거기서 **많이 벗어나면**
//                          두 산식이 그 매장을 다르게 보는 것이다.
//
// ⚠️ **이건 판정이 아니라 표시다.** 빨간 칸이 "틀렸다"는 뜻이 아니라 "사람이 봐라"는 뜻이다.
//    점수를 매기거나 예측값을 고치지 않는다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_candidateRedFlags.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  utilizationByStore, qscInWindowAverage, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
// ⚠️ 2026-09-21 거리 감쇠 채택 이후로는 `effectiveRadiusM`(계단)이 안 쓰인다.
//    점검 기준도 **산식이 실제로 쓰는 값**에서 가져온다 — 여기에 300을 손으로 박아 두면
//    산식이 바뀌어도 점검표만 옛말을 하게 된다.
const DECAY = DEFAULT_TEXTBOOK_PARAMS.rivalDistanceDecay;
const PLATEAU = DECAY?.plateauM ?? DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM;
const NEARBY = 500; // 이 안까지를 "가까운 경쟁점"으로 보고 평지 밖을 따로 센다
/** 산식과 **같은 식**으로 경쟁점 하나의 무게를 잰다(정규화 포함). 감쇠가 꺼져 있으면 계단. */
const wDecay = (d: number | null): number => {
  if (!DECAY) return d == null || d <= DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM ? 1 : 0;
  const w = d == null || d <= DECAY.plateauM ? 1 : Math.exp(-(d - DECAY.plateauM) / DECAY.scaleM);
  return w * (DECAY.weightFactor ?? 1);
};

describeIf("후보지 점검표", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const candidates: CandidateInput[] = snap.candidates ?? [];
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const locByCode = new Map(locationEvaluations.map((l) => [l.candidateCode, l]));
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, locationEvaluations, settings);
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
  const existingRows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const sc = scoreTextbook(existingRows, DEFAULT_TEXTBOOK_PARAMS);
  const full = fittedParams(DEFAULT_TEXTBOOK_PARAMS, sc);
  const franchiseManagement = franchiseManagementFromRows(existingRows, qscByStoreCode);
  const candRows = buildLabCandidateRows({ candidates, compsByCode, locByCode, settings, franchiseManagement });

  // 기존점 분포 — 외삽 판정용
  const ex = stores.filter((s) => !s.excludedFromModel);
  const range = (f: (s: (typeof ex)[number]) => number | null | undefined) => {
    const v = ex.map(f).filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
    return { min: v[0], max: v[v.length - 1], med: v[Math.floor(v.length / 2)] };
  };
  const popR = range((s) => s.pop1km);
  const flowR = range((s) => (s as unknown as Record<string, number>).floating400Avg);
  const eccs = ex.map((s) => (s as unknown as Record<string, number>).flowEccentricity)
    .filter((x): x is number => x != null).sort((a, b) => a - b);
  const eccMed = eccs[Math.floor(eccs.length / 2)];
  const eccP80 = eccs[Math.floor(eccs.length * 0.8)];

  const v62 = new Map<string, number>();
  for (const r of (snap.results ?? []) as { candidateCode?: string; v62Final?: number | null }[]) {
    if (r.candidateCode && r.v62Final != null) v62.set(r.candidateCode, r.v62Final);
  }

  type Flag = { level: "🔴" | "🟡" | "⚪"; text: string };
  type Row = { code: string; name: string; lab: number | null; v62: number | null; gap: number | null; flags: Flag[] };

  const rows: Row[] = [];
  for (const r of candRows) {
    const code = r.input.storeCode;
    const c = candidates.find((x) => x.code === code);
    if (!c) continue;
    const b = computeTextbook(r.input, full);
    const lab = b.monthlyRevenue;
    const v = v62.get(code) ?? null;
    const gap = lab != null && v != null && v > 0 ? lab / v - 1 : null;
    const flags: Flag[] = [];

    // 1. 평지 밖 경쟁점 — **2026-09-21에 거리 감쇠를 채택하면서 이 항목을 다시 썼다.**
    //    ⚠️ 그 전에는 "300m 밖은 0으로 센다"였다. 지금은 아니다 — exp로 깎아서 센다.
    //       낡은 문구를 그대로 뒀다가 화면이 거짓말을 할 뻔했다(CLAUDE.md 낡은 설명 규칙).
    //    이제 볼 것은 "세지나 안 세지나"가 아니라 **예측이 감쇠 곡선에 얼마나 매달려 있나**다.
    const comps = (compsByCode.get(code) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음");
    const row = candRows.find((x) => x.input.storeCode === code);
    const rivals = row?.input.rivals ?? [];
    const ownPc = row?.input.pcCount ?? null;
    const inPlateau = rivals.filter((x) => x.ip > 0 && x.distanceM != null && x.distanceM <= PLATEAU);
    const band = rivals.filter((x) => x.ip > 0 && x.distanceM != null && x.distanceM > PLATEAU);
    /** 감쇠가 밖에서 새로 세는 무게(정규화 포함). 계단 시절에는 전부 0이었다. */
    const addedMass = band.reduce((s, x) => s + x.ip * wDecay(x.distanceM), 0);
    const counted = band.filter((x) => wDecay(x.distanceM) >= 0.2);
    if (band.length && !inPlateau.length) {
      // 계단 시절의 '가짜 독점'. 이제는 안 비지만, **예측 전체가 감쇠 곡선 하나에 달려 있다.**
      flags.push({
        level: "🔴",
        text: `평지(${PLATEAU}m) 안 0곳 — 예측이 감쇠 곡선에 통째로 달려 있다: `
          + band.map((x) => `${x.name ?? "?"} ${Math.round(x.distanceM as number)}m/${x.ip}대를 ${(wDecay(x.distanceM) * 100).toFixed(0)}%로 셈`).join(" · ")
          + ` (계단 시절엔 전부 0이었다)`,
      });
    } else if (counted.length) {
      flags.push({
        level: "🟡",
        text: `평지 밖 경쟁점 ${counted.length}곳을 부분으로 셈 — `
          + counted.map((x) => `${Math.round(x.distanceM as number)}m ${(wDecay(x.distanceM) * 100).toFixed(0)}%`).join(" · "),
      });
    }
    // 1-b. **장산형 위험** (2026-09-21 신설). 장산점은 감쇠를 켜자 오차가 2.2 -> 40.5%로 뛰었다.
    //      원인은 "자사 PC 1대당 새로 세진 경쟁 3.52대"로 표본 1위였던 것. `_jangsanDecay` 참고.
    if (ownPc && ownPc > 0) {
      const perOwn = addedMass / ownPc;
      if (perOwn >= 2) flags.push({ level: "🔴", text: `장산형 — 자사 1대당 새로 세진 경쟁 ${perOwn.toFixed(2)}대(장산점 3.52대). 감쇠가 이 자리를 과하게 누를 수 있다` });
      else if (perOwn >= 1) flags.push({ level: "🟡", text: `자사 1대당 새로 세진 경쟁 ${perOwn.toFixed(2)}대 — 장산점(3.52대)만큼은 아니지만 감쇠 의존이 크다` });
    }
    // 1-c. 평지 밖 **먼** 경쟁점은 여전히 사실상 0이다. 401m 문제의 바깥쪽 판이다.
    //      ⚠️ 거리는 `rivals`(좌표거리)로 잰다 — `comps`의 조사거리는 초기 데이터에 오류가 있다.
    const faded = band.filter((x) => (x.distanceM as number) <= NEARBY && wDecay(x.distanceM) < 0.2);
    if (faded.length) {
      flags.push({ level: "🟡", text: `${NEARBY}m 안인데 감쇠로 20% 미만으로 세지는 곳 ${faded.length}곳(${faded.map((x) => `${Math.round(x.distanceM as number)}m`).join(",")})` });
    }

    // 1-d. ⭐ **PC 대수가 없어 산식에서 통째로 빠지는 경쟁점** (2026-09-21 신설).
    //
    // 품질 모드는 경쟁점을 낱개(`rivals`)로 센다. 그런데 `ip`는 `appliedPcCount ?? totalPcCount`
    // 라서 **둘 다 비면 그 경쟁점은 배열에서 아예 빠진다**(`labInput`의 `.filter(r => r.ip > 0)`).
    // 거리도 품질도 멀쩡히 있는데 대수 한 칸이 비어서 **경쟁이 없는 셈**이 된다.
    //
    // ⚠️ 이건 "거리 밖이라 0으로 센다"와 전혀 다른 문제다. 2026-09-21에 이 둘을 헷갈렸다 —
    //    신중동점의 옛 경고("300~500m 3곳이 0으로 세짐")를 감쇠 기준으로 고쳐 다시 돌렸더니
    //    경고가 통째로 사라졌는데, 알고 보니 그 3곳은 거리 때문이 아니라 **대수가 없어서**
    //    빠지고 있었다. 감쇠를 어떻게 켜도 이 3곳은 영영 안 세진다.
    //
    // ⚠️ 방향이 한쪽이다 — 빠지면 경쟁이 **줄어** 예측이 **위로** 밀린다.
    //    기존점은 168곳 중 8곳(4.8%)뿐이라 축척은 거의 안 흔들리지만, 후보지는 훨씬 심하다.
    const dropped = comps.filter((x) => !(Number(x.appliedPcCount ?? x.totalPcCount ?? 0) > 0));
    if (dropped.length) {
      const near = dropped.filter((x) => x.distanceM != null && x.distanceM <= PLATEAU);
      const share = dropped.length / comps.length;
      flags.push({
        level: near.length >= 2 || share >= 0.5 ? "🔴" : "🟡",
        text: `경쟁점 ${comps.length}곳 중 ${dropped.length}곳이 **PC 대수가 없어 산식에서 통째로 빠진다**`
          + (near.length ? ` — 그중 ${near.length}곳은 평지 안(${near.map((x) => `${x.name ?? "?"} ${x.distanceM}m`).join(" · ")})` : "")
          + `. 경쟁이 덜 세져 예측이 위로 밀린다`,
      });
    }

    // 2. 편심도 — 산식이 안 본다
    const ecc = (c as unknown as Record<string, number | null>).flowEccentricity;
    if (ecc != null && ecc >= eccP80) {
      flags.push({ level: "🔴", text: `편심도 ${ecc.toFixed(3)} (기존점 상위 20% 기준 ${eccP80.toFixed(3)} 이상) — 상권 끝인데 산식이 안 봄` });
    } else if (ecc != null && ecc > eccMed) {
      flags.push({ level: "🟡", text: `편심도 ${ecc.toFixed(3)} (중앙 ${eccMed.toFixed(3)})` });
    }

    // 3. 번화가 판정으로 주거가 빠졌나
    const f500 = (c as unknown as Record<string, number | null>).floating500Avg;
    const p500 = (c as unknown as Record<string, number | null>).pop500m;
    if (f500 && p500 && p500 > 0) {
      const ratio = f500 / p500;
      if (ratio >= 8) {
        const lowPop = c.pop1km != null && c.pop1km < popR.med;
        flags.push({
          level: lowPop ? "🔴" : "🟡",
          text: `번화가 판정(유동÷주거 ${ratio.toFixed(1)}배) — V62가 주거 ${c.pop1km?.toLocaleString()}명을 통째로 버림` +
            (lowPop ? " · 주거가 표본 중앙 미만이라 뒤집힌 자리" : ""),
        });
      }
    }

    // 4. 외삽
    if (c.pop1km != null && c.pop1km > 0 && c.pop1km < popR.min) {
      flags.push({ level: "🔴", text: `주거 1km ${c.pop1km.toLocaleString()}명 — 기존점 최소 ${popR.min.toLocaleString()}명보다 적다(외삽)` });
    }
    const f400 = (c as unknown as Record<string, number | null>).floating400Avg;
    if (f400 != null && f400 > 0 && f400 > flowR.max) {
      flags.push({ level: "🟡", text: `유동 400m ${f400.toLocaleString()}명 — 기존점 최대 ${flowR.max.toLocaleString()}명보다 많다(외삽)` });
    }

    // 5. 유동 반경 결측
    const miss = ([300, 400, 1000] as const).filter((rad) => {
      const v2 = (c as unknown as Record<string, number | null>)[`floating${rad}Avg`];
      return v2 == null || !(v2 > 0);
    });
    if (miss.length) flags.push({ level: "🔴", text: `유동 ${miss.join("/")}m 없음 — 수요와 중심도가 말없이 빠진다(수집 스크립트 미실행)` });

    // 6. 경쟁점 조사 품질
    const brief = comps.filter((x) => x.surveyLevel !== "상세").length;
    if (comps.length && brief / comps.length >= 0.5) {
      flags.push({ level: "🟡", text: `경쟁점 ${comps.length}곳 중 ${brief}곳이 간략·외관 — 기본대수/기본점수가 들어감` });
    }

    // 7. 실험실 vs V62 괴리 (후보지 평균 편차에서 얼마나 벗어나나)
    rows.push({ code, name: c.name ?? code, lab, v62: v, gap, flags });
  }

  const gaps = rows.map((r) => r.gap).filter((x): x is number => x != null);
  const gapMed = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  for (const r of rows) {
    if (r.gap == null) continue;
    const d = r.gap - gapMed;
    if (Math.abs(d) >= 0.25) {
      r.flags.push({
        level: Math.abs(d) >= 0.4 ? "🔴" : "🟡",
        text: `두 산식이 다르게 본다 — 실험실이 V62 대비 ${(r.gap * 100).toFixed(0)}% (후보지 중앙 ${(gapMed * 100).toFixed(0)}%, ${d > 0 ? "+" : ""}${(d * 100).toFixed(0)}%p 벗어남)`,
      });
    }
  }

  it("(1) 점검표", () => {
    console.log(`\n[후보지 점검표] 후보지 ${rows.length}곳 · 기존점 ${ex.length}곳 분포와 대조`);
    console.log(`  기준: 주거1km ${popR.min.toLocaleString()}~${popR.max.toLocaleString()}(중앙 ${popR.med.toLocaleString()})` +
      ` · 유동400 ${flowR.min.toLocaleString()}~${flowR.max.toLocaleString()}` +
      ` · 편심도 중앙 ${eccMed.toFixed(3)} 상위20% ${eccP80.toFixed(3)}` +
      ` · 실험실÷V62 중앙 ${(gapMed * 100).toFixed(0)}%`);
    const order = { "🔴": 0, "🟡": 1, "⚪": 2 };
    rows.sort((a, b) => {
      const ra = Math.min(...a.flags.map((f) => order[f.level]), 3);
      const rb = Math.min(...b.flags.map((f) => order[f.level]), 3);
      return ra - rb || b.flags.length - a.flags.length;
    });
    for (const r of rows) {
      const red = r.flags.filter((f) => f.level === "🔴").length;
      console.log(`\n  ${r.code} ${r.name}   실험실 ${r.lab == null ? "-" : Math.round(r.lab / 1e4).toLocaleString() + "만"}` +
        ` · V62 ${r.v62 == null ? "-" : Math.round(r.v62 / 1e4).toLocaleString() + "만"}` +
        `${r.gap == null ? "" : ` (${(r.gap * 100).toFixed(0)}%)`}` +
        `   ${red ? `🔴 ${red}건` : r.flags.length ? "🟡" : "⚪ 이상 없음"}`);
      for (const f of r.flags) console.log(`      ${f.level} ${f.text}`);
    }
    const reds = rows.filter((r) => r.flags.some((f) => f.level === "🔴"));
    console.log(`\n  🔴 있는 후보지 ${reds.length}곳: ${reds.map((r) => r.name).join(" · ") || "없음"}`);
    console.log(`  ⚠️ 빨간 칸은 "틀렸다"가 아니라 "사람이 봐라"다. 예측값은 아무것도 안 고쳤다.`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
