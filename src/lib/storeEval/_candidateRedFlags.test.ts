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
//   1. 유효거리 밖 경쟁점   300m 밖 500m 안에 경쟁점이 있으면 산식이 **0으로 센다**.
//                          있는데 300m 안이 비면 '가짜 독점'이다.
//   2. 편심도              산식이 **안 본다**(direction 지수 0). 높으면 상권 끝인데 반영이 없다.
//   3. 번화가 판정          유동500÷주거500 >= 8이면 주거를 통째로 버린다. 주거가 적어서
//                          번화가가 된 곳은 뒤집혀 있는 것이다.
//   4. 외삽                주거·유동이 기존점 38곳 범위 밖이면 검증 안 된 자리다.
//   5. 유동 반경 결측        300/400/1km가 비면 수요와 중심도가 **말없이** 빠진다.
//   6. 경쟁점 조사 품질      간략·외관만 조사는 기본대수·기본점수가 들어간다.
//   7. 실험실 vs V62       후보지 13곳 평균 편차가 -26.6%다. 거기서 **많이 벗어나면**
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
const R = DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM; // 300
const NEARBY = 500; // 이 안까지를 "가까운 경쟁점"으로 보고 300m 밖을 따로 센다

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

    // 1. 유효거리 밖 경쟁점
    const comps = (compsByCode.get(code) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음");
    const inR = comps.filter((x) => x.distanceM != null && x.distanceM <= R);
    const band = comps.filter((x) => x.distanceM != null && x.distanceM > R && x.distanceM <= NEARBY);
    if (band.length && !inR.length) {
      flags.push({ level: "🔴", text: `가짜 독점 — ${R}m 안 0곳인데 ${R}~${NEARBY}m에 ${band.length}곳(${band.map((x) => `${Math.round(x.distanceM as number)}m`).join(",")})` });
    } else if (band.length) {
      flags.push({ level: "🟡", text: `${R}~${NEARBY}m 경쟁점 ${band.length}곳이 0으로 세짐` });
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
