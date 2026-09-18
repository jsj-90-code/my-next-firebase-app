// 사양(하드웨어) 검정 — 진단 1단계 (2026-09-18).
// 실행: npx vitest run src/lib/storeEval/_specScore.test.ts --disable-console-intercept

import { describe, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook, type TextbookParams } from "./textbookModel";
import {
  computeSpecScore, scoreFromVgaSpec, scoreFromCpuSpec, scoreFromRamSpec, scoreFromMonitorSpec,
  scoreFromVga, scoreFromCpu, scoreFromRam, scoreFromMonitor,
} from "./calc";
import { labScoreFromVga, labScoreFromCpu, labGpuKey, labCpuKey, labComputeSpecScore, LAB_GPU_PERF_INDEX, LAB_CPU_PERF_INDEX, LAB_PERF_LOG_STEP_UP, labScoreFromMonitorCell, labScoreFromMonitorUnit, type LabSpecOptions } from "./labSpecScore";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

describeIf("사양 — 자료 생김새", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const rivals = allCompetitors.filter((c) => c.investigationStatus !== "경쟁점없음");

  it("(1) 칸이 얼마나 채워져 있나 — 자사 vs 경쟁점", () => {
    const ownKeys = ["ownVgaBase", "ownVgaTop", "ownVgaTop2", "ownCpu", "ownCpuTop1", "ownCpuTop2", "ownRam", "ownRamTop", "ownMonitorBase", "ownMonitorTop"];
    const rivalKeys = ["vgaBase", "vgaTop", "vgaTop2", "cpu", "cpuTop1", "cpuTop2", "ram", "ramTop", "monitorBase", "monitorTop"];
    console.log(`\n[채움률] 자사 ${stores.length}곳 · 경쟁점 ${rivals.length}건`);
    console.log("  칸            자사           경쟁점");
    for (let i = 0; i < ownKeys.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = (stores as any[]).filter((s) => s[ownKeys[i]] != null && String(s[ownKeys[i]]).trim() !== "").length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (rivals as any[]).filter((c) => c[rivalKeys[i]] != null && String(c[rivalKeys[i]]).trim() !== "").length;
      console.log(`  ${rivalKeys[i].padEnd(12)} ${String(o).padStart(3)}/${stores.length} (${((o / stores.length) * 100).toFixed(0).padStart(3)}%)   ${String(r).padStart(3)}/${rivals.length} (${((r / rivals.length) * 100).toFixed(0).padStart(3)}%)`);
    }
  });

  it("(2) 항목별 점수 분포 — 자사 vs 경쟁점", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownSub = (s: any) => ({
      vga: scoreFromVgaSpec(s.ownVgaBase ?? null, s.ownVgaTop ?? null, s.ownVgaTop2 ?? null),
      cpu: scoreFromCpuSpec(s.ownCpu ?? null, s.ownCpuTop1 ?? null, s.ownCpuTop2 ?? null),
      ram: scoreFromRamSpec(s.ownRam ?? null, s.ownRamTop ?? null),
      monitor: scoreFromMonitorSpec(s.ownMonitorBase ?? null, s.ownMonitorTop ?? null),
      total: computeSpecScore({
        vgaBase: s.ownVgaBase ?? null, vgaTop: s.ownVgaTop ?? null, vgaTop2: s.ownVgaTop2 ?? null,
        cpu: s.ownCpu ?? null, cpuTop1: s.ownCpuTop1 ?? null, cpuTop2: s.ownCpuTop2 ?? null,
        ram: s.ownRam ?? null, ramTop: s.ownRamTop ?? null,
        monitorBase: s.ownMonitorBase ?? null, monitorTop: s.ownMonitorTop ?? null,
      }, settings),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalSub = (c: any) => ({
      vga: scoreFromVgaSpec(c.vgaBase ?? null, c.vgaTop ?? null, c.vgaTop2 ?? null),
      cpu: scoreFromCpuSpec(c.cpu ?? null, c.cpuTop1 ?? null, c.cpuTop2 ?? null),
      ram: scoreFromRamSpec(c.ram ?? null, c.ramTop ?? null),
      monitor: scoreFromMonitorSpec(c.monitorBase ?? null, c.monitorTop ?? null),
      total: computeSpecScore({
        vgaBase: c.vgaBase ?? null, vgaTop: c.vgaTop ?? null, vgaTop2: c.vgaTop2 ?? null,
        cpu: c.cpu ?? null, cpuTop1: c.cpuTop1 ?? null, cpuTop2: c.cpuTop2 ?? null,
        ram: c.ram ?? null, ramTop: c.ramTop ?? null,
        monitorBase: c.monitorBase ?? null, monitorTop: c.monitorTop ?? null,
      }, settings),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const O = (stores as any[]).map(ownSub), R = (rivals as any[]).map(rivalSub);
    const w = settings.specWeights;
    console.log(`\n[분포] 하드웨어 내부비중 GPU ${w.vga} · 모니터 ${w.monitor} · CPU ${w.cpu} · RAM ${w.ram}`);
    console.log("  항목      자사 n  최소  중앙  최대 | 경쟁 n  최소  중앙  최대");
    for (const k of ["vga", "cpu", "ram", "monitor", "total"] as const) {
      const o = O.map((x) => x[k]).filter((v): v is number => v != null);
      const r = R.map((x) => x[k]).filter((v): v is number => v != null);
      const fmt = (a: number[]) => (a.length ? `${String(a.length).padStart(3)}  ${Math.min(...a).toFixed(2)} ${median(a).toFixed(2)} ${Math.max(...a).toFixed(2)}` : "  0     -    -    -");
      console.log(`  ${k.padEnd(8)} ${fmt(o)} | ${fmt(r)}`);
    }
    const ot = O.map((x) => x.total).filter((v): v is number => v != null);
    const rt = R.map((x) => x.total).filter((v): v is number => v != null);
    console.log(`\n  자사 total 평균 ${mean(ot).toFixed(3)} · 경쟁점 ${mean(rt).toFixed(3)}`);
    const ownMin = Math.min(...ot);
    const below = rt.filter((v) => v < ownMin).length;
    console.log(`  자사 최소(${ownMin.toFixed(2)})보다 낮은 경쟁점 ${below}/${rt.length}건 (${((below / rt.length) * 100).toFixed(0)}%)`);
  });

  it("(3) 원자료 값 목록 — 어떤 텍스트가 들어 있나", () => {
    const tally = (vals: (string | null | undefined)[]) => {
      const m = new Map<string, number>();
      for (const v of vals) { const k = (v ?? "").trim(); if (!k) continue; m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const blocks: [string, unknown[], unknown[], (t: string | null) => number | null][] = [
      ["GPU 기본", S.map((s) => s.ownVgaBase), C.map((c) => c.vgaBase), scoreFromVga],
      ["CPU 기본", S.map((s) => s.ownCpu), C.map((c) => c.cpu), scoreFromCpu],
      ["RAM 기본", S.map((s) => s.ownRam), C.map((c) => c.ram), scoreFromRam],
    ];
    for (const [label, ov, rv, scorer] of blocks) {
      const os = ov as (string | null)[], rs = rv as (string | null)[];
      console.log(`\n[${label}] 자사`);
      for (const [k, n] of tally(os)) console.log(`    ${String(n).padStart(3)}건  ${scorer(k) == null ? " -  " : scorer(k)!.toFixed(2)}  ${k}`);
      console.log(`  [${label}] 경쟁점 (상위 15종)`);
      for (const [k, n] of tally(rs).slice(0, 15)) console.log(`    ${String(n).padStart(3)}건  ${scorer(k) == null ? " -  " : scorer(k)!.toFixed(2)}  ${k}`);
      const nullOwn = os.filter((v) => v && scorer(v) == null), nullRiv = rs.filter((v) => v && scorer(v) == null);
      if (nullOwn.length || nullRiv.length) console.log(`  ⚠️ 못 읽은 텍스트 자사 ${nullOwn.length}건 · 경쟁점 ${nullRiv.length}건: ${[...new Set([...nullOwn, ...nullRiv])].slice(0, 10).join(" | ")}`);
    }
  });

  it("(4) 모니터 — Hz가 얼마나 읽히나", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const rows: [string, string, number | null][] = [];
    for (const s of S) if (s.ownMonitorBase) rows.push(["자사", String(s.ownMonitorBase), scoreFromMonitor(String(s.ownMonitorBase))]);
    for (const c of C) if (c.monitorBase) rows.push(["경쟁", String(c.monitorBase), scoreFromMonitor(String(c.monitorBase))]);
    const unread = rows.filter(([, , v]) => v == null);
    console.log(`\n[모니터 기본] 기입 ${rows.length}건 중 점수 못 뽑은 것 ${unread.length}건`);
    const m = new Map<string, number>();
    for (const [side, t] of unread) m.set(`${side} | ${t}`, (m.get(`${side} | ${t}`) ?? 0) + 1);
    for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${String(n).padStart(3)}건  ${k}`);
    console.log(`\n[모니터 특화] 자사 ${S.filter((s) => s.ownMonitorTop).length}건 · 경쟁 ${C.filter((c) => c.monitorTop).length}건`);
    const mt = new Map<string, number>();
    for (const s of S) if (s.ownMonitorBase) mt.set(`자사 | ${String(s.ownMonitorBase).trim()}`, (mt.get(`자사 | ${String(s.ownMonitorBase).trim()}`) ?? 0) + 1);
    console.log("\n[모니터 기본 — 자사 값 목록]");
    for (const [k, n] of [...mt.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}건  ${(scoreFromMonitor(k.split("| ")[1]) ?? NaN).toFixed(2)}  ${k.split("| ")[1]}`);
  });

  // ── 여기부터 검정 ────────────────────────────────────────────────────────
  // 존구성과 **같은 절차**다(_zoneComposition.test.ts). 기여가 크다고 채택하는 게 아니라
  // (가) 매장별 **순서**를 맞히는지 (나) 자사를 한 번 띄우는 **수준 보정**인지를 가른다.
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const qscByStoreCode = new Map<string, number>();
  for (const d of (snap.labQscScores ?? []) as { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] }[]) {
    const code = d.storeCode ?? d.id;
    if (!code) continue;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS };

  function pearson(xs: number[], ys: number[]): number {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  /** 자사·경쟁점 spec을 갈아끼운 행을 만든다. 원본은 안 건드린다. */
  function withSpec(
    own: (v: number | null, i: number) => number | null,
    rival: (v: number | null, i: number) => number | null,
  ): LabRow[] {
    let ri = -1;
    return rows.map((r, i) => ({
      actualRevenue: r.actualRevenue,
      input: {
        ...r.input,
        ownQualityParts: r.input.ownQualityParts
          ? { ...r.input.ownQualityParts, spec: own(r.input.ownQualityParts.spec, i) }
          : r.input.ownQualityParts,
        rivals: (r.input.rivals ?? []).map((v) => {
          ri += 1;
          return v.parts ? { ...v, parts: { ...v.parts, spec: rival(v.parts.spec, ri) } } : v;
        }),
      },
    }));
  }

  const f = (v: number | null | undefined, d = 2) => (v == null ? "-" : (v * 100).toFixed(d));

  function line(label: string, rs: LabRow[], p: TextbookParams = P) {
    const sc = scoreTextbook(rs, p);
    const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
    const r = pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual));
    console.log(`  ${label.padEnd(30)} MAPE ${f(sc.mape).padStart(6)}%  중앙 ${f(sc.medianAbsErr, 1).padStart(5)}%  r ${r.toFixed(3)}`);
    return { mape: sc.mape ?? 0, r };
  }

  it("(5) 바닥 포화 — 1.00에 몇 건이 깔려 있나", () => {
    const ownSpec = rows.map((r) => r.input.ownQualityParts?.spec).filter((v): v is number => v != null);
    const rivalSpec = rows.flatMap((r) => r.input.rivals ?? []).map((v) => v.parts?.spec).filter((v): v is number => v != null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const C = rivals as any[];
    const cpuAtFloor = C.map((c) => scoreFromCpu(c.cpu ?? null)).filter((v) => v === 1).length;
    const cpuN = C.map((c) => scoreFromCpu(c.cpu ?? null)).filter((v): v is number => v != null).length;
    const vgaAtFloor = C.map((c) => scoreFromVga(c.vgaBase ?? null)).filter((v) => v === 1).length;
    const vgaN = C.map((c) => scoreFromVga(c.vgaBase ?? null)).filter((v): v is number => v != null).length;
    console.log(`\n[바닥 포화] 경쟁점 CPU 1.00이 ${cpuAtFloor}/${cpuN}건 (${((cpuAtFloor / cpuN) * 100).toFixed(0)}%)`);
    console.log(`            경쟁점 GPU 1.00이 ${vgaAtFloor}/${vgaN}건 (${((vgaAtFloor / vgaN) * 100).toFixed(0)}%)`);
    console.log(`  하네스 행: 자사 spec ${ownSpec.length}곳 · 경쟁점 spec ${rivalSpec.length}건`);
    // 바닥에 깔린 텍스트가 실제로는 서로 다른 물건인가
    const floorTexts = new Map<string, number>();
    for (const c of C) {
      const t = String(c.cpu ?? "").trim();
      if (t && scoreFromCpu(t) === 1) floorTexts.set(`CPU ${t}`, (floorTexts.get(`CPU ${t}`) ?? 0) + 1);
      const g = String(c.vgaBase ?? "").trim();
      if (g && scoreFromVga(g) === 1) floorTexts.set(`GPU ${g}`, (floorTexts.get(`GPU ${g}`) ?? 0) + 1);
    }
    console.log("  1.00으로 뭉개진 서로 다른 물건들:");
    for (const [k, n] of [...floorTexts.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}건  ${k}`);
  });

  it("(6) 수준인가 순서인가 — 상수로 바꿔치기", () => {
    const ownSpec = rows.map((r) => r.input.ownQualityParts?.spec).filter((v): v is number => v != null);
    const rivalSpec = rows.flatMap((r) => r.input.rivals ?? []).map((v) => v.parts?.spec).filter((v): v is number => v != null);
    const oMed = median(ownSpec), rMed = median(rivalSpec);
    console.log(`\n[상수 바꿔치기] 자사 중앙 ${oMed.toFixed(2)} · 경쟁점 중앙 ${rMed.toFixed(2)}`);
    line("실험실 기본", rows);
    line("자사만 상수", withSpec(() => oMed, (v) => v));
    line("경쟁점만 상수", withSpec((v) => v, () => rMed));
    line("둘 다 상수 (수준만)", withSpec(() => oMed, () => rMed));
    line("사양 비중 0 (아예 뺌)", rows, { ...P, qualityWeights: { ...P.qualityWeights, spec: 0 } });
  });

  it("(7) 무작위 대조군 — 순서가 진짜인가", () => {
    const base = scoreTextbook(rows, P);
    const off = scoreTextbook(rows, { ...P, qualityWeights: { ...P.qualityWeights, spec: 0 } });
    const gain = (off.mape ?? 0) - (base.mape ?? 0); // 사양을 켜서 좋아진 폭
    const ownSpec = rows.map((r) => r.input.ownQualityParts?.spec ?? null);
    const rivalSpec = rows.flatMap((r) => r.input.rivals ?? []).map((v) => v.parts?.spec ?? null);
    let rng = 20260918;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const gains: number[] = [];
    for (let t = 0; t < 500; t++) {
      const so = shuffle(ownSpec), sr = shuffle(rivalSpec);
      const sc = scoreTextbook(withSpec((_, i) => so[i], (_, i) => sr[i]), P);
      gains.push((off.mape ?? 0) - (sc.mape ?? 0));
    }
    const sorted = [...gains].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const pv = gains.filter((g) => g >= gain).length / gains.length;
    console.log(`\n[대조군 · 매출 38곳] 사양을 켜서 좋아진 폭 ${f(gain)}%p`);
    console.log(`  뒤섞은 값 500회: 중앙 ${f(median(gains))}%p · 95퍼센타일 ${f(p95)}%p`);
    console.log(`  p = ${pv.toFixed(3)}  ${pv < 0.05 ? "통과 ✅" : "미달 ❌"}`);
  });

  it("(9) 바닥을 풀면 신호가 있나 — 세대당 기울기를 낮춰본다", () => {
    // ⚠️ **측정만 한다.** 여기서 MAPE가 내려가도 채택 근거가 아니다(대조군은 따로 본다).
    // 지금은 세대 하나당 1점이라 9세대 이하 CPU·GTX 세대 GPU가 전부 1.00에 깔린다.
    // 기울기를 낮추면 그 뭉치가 풀리는데, 풀린 순서가 매출을 맞히는지 보는 것이다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specOf = (o: any, own: boolean, slope: number) => {
      // 기존 점수에서 "4점 앵커로부터 몇 계단 아래인가"를 역산해 기울기만 갈아끼운다.
      // 깔끔하진 않지만 변환표를 새로 쓰기 전에 신호 유무만 보는 자리다.
      const rescale = (v: number | null) => (v == null ? null : Math.max(1, Math.min(5, 4 + (v - 4) * slope)));
      const g = rescale(own ? scoreFromVgaSpec(o.ownVgaBase ?? null, o.ownVgaTop ?? null, o.ownVgaTop2 ?? null)
        : scoreFromVgaSpec(o.vgaBase ?? null, o.vgaTop ?? null, o.vgaTop2 ?? null));
      const c = rescale(own ? scoreFromCpuSpec(o.ownCpu ?? null, o.ownCpuTop1 ?? null, o.ownCpuTop2 ?? null)
        : scoreFromCpuSpec(o.cpu ?? null, o.cpuTop1 ?? null, o.cpuTop2 ?? null));
      const m = own ? scoreFromMonitorSpec(o.ownMonitorBase ?? null, o.ownMonitorTop ?? null)
        : scoreFromMonitorSpec(o.monitorBase ?? null, o.monitorTop ?? null);
      const ra = own ? scoreFromRamSpec(o.ownRam ?? null, o.ownRamTop ?? null) : scoreFromRamSpec(o.ram ?? null, o.ramTop ?? null);
      const w = settings.specWeights;
      const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([s]) => s != null) as [number, number][];
      const tw = items.reduce((a, [, x]) => a + x, 0);
      return tw > 0 ? items.reduce((a, [s, x]) => a + s * x, 0) / tw : null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeByCode = new Map((stores as any[]).map((s) => [s.storeCode, s]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalList = (code: string) => (compsByCode.get(code) ?? []).filter((c: any) => c.investigationStatus !== "경쟁점없음").filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
    console.log("\n[기울기] ⚠️ 전체 눈금을 같이 압축한다 — 바닥만 푸는 게 아니라 사양 비중을 줄이는 것과 섞인다");
    for (const slope of [1, 0.75, 0.5, 0.35]) {
      const rs: LabRow[] = rows.map((r) => {
        const s = storeByCode.get(r.input.storeCode);
        const rl = rivalList(r.input.storeCode);
        let i = -1;
        return {
          actualRevenue: r.actualRevenue,
          input: {
            ...r.input,
            ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: specOf(s, true, slope) } : r.input.ownQualityParts,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: specOf(rl[i] as any, false, slope) } } : v; }),
          },
        };
      });
      const atFloor = rs.flatMap((r) => r.input.rivals ?? []).map((v) => v.parts?.spec).filter((v) => v != null && v <= 1.01).length;
      line(`기울기 ${slope.toFixed(2)} (바닥 ${atFloor}건)`, rs);
    }
  });

  it("(10) 바닥만 푼다 — 위쪽 눈금은 그대로 두고 1.00 뭉치의 순서만 살린다", () => {
    // (9)는 전체를 압축해서 "사양을 약하게 하기"와 섞였다. 여기서는 **1.00 위쪽을 한 톨도
    // 안 건드리고**, 지금 1.00에 깔린 것들만 raw 순서대로 [0.40, 1.00]에 편다.
    // 위쪽이 그대로니 격차가 줄지 않는다 — 오직 "낡은 PC 사이의 순서가 정보인가"만 묻는다.
    const rawCpu = (t: string | null): number | null => {
      const v = scoreFromCpu(t);
      if (v == null) return null;
      if (v > 1) return v;
      const m = (t ?? "").match(/(\d{1,2})\s*세대/);
      if (m) return Number(m[1]) - 10;
      if (/(?:울트라|ultra|ryzen|라이젠)/i.test(t ?? "")) return v;
      const d = (t ?? "").match(/(\d{4,5})/);
      if (!d) return v;
      const gen = d[1].length === 5 ? Number(d[1].slice(0, 2)) : Number(d[1].slice(0, 1));
      return gen - 10;
    };
    const rawVga = (t: string | null): number | null => {
      const v = scoreFromVga(t);
      if (v == null) return null;
      if (v > 1) return v;
      const cleaned = (t ?? "").toUpperCase().replace(/\s/g, "");
      const m = cleaned.match(/(\d{4})/);
      if (!m) return v;
      const num = Number(m[1]);
      const tier = num % 100;
      return 4 + (Math.floor(num / 1000) - 5) + (tier >= 80 ? 1 : tier >= 70 ? 0.5 : 0) + (/\d{3,4}\s*TI/.test(cleaned) ? 0.25 : 0);
    };
    /** raw<1을 [0.40,1.00]에 편다. raw>=1은 그대로. */
    const spread = (raw: number | null) => (raw == null ? null : raw >= 1 ? Math.min(5, raw) : Math.max(0.4, 1 + (raw - 1) * 0.15));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specOf2 = (o: any, own: boolean, on: boolean) => {
      const w = settings.specWeights;
      const gTexts = own ? [o?.ownVgaBase, o?.ownVgaTop, o?.ownVgaTop2] : [o?.vgaBase, o?.vgaTop, o?.vgaTop2];
      const cTexts = own ? [o?.ownCpu, o?.ownCpuTop1, o?.ownCpuTop2] : [o?.cpu, o?.cpuTop1, o?.cpuTop2];
      const comb = (vs: (number | null)[]) => {
        const base = vs[0], sp = vs.slice(1).filter((v): v is number => v != null);
        if (base == null) return sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : null;
        return sp.length ? base * 0.8 + (sp.reduce((a, b) => a + b, 0) / sp.length) * 0.2 : base;
      };
      const g = on ? comb(gTexts.map((t) => spread(rawVga(t ?? null)))) : comb(gTexts.map((t) => scoreFromVga(t ?? null)));
      const c = on ? comb(cTexts.map((t) => spread(rawCpu(t ?? null)))) : comb(cTexts.map((t) => scoreFromCpu(t ?? null)));
      const m = own ? scoreFromMonitorSpec(o?.ownMonitorBase ?? null, o?.ownMonitorTop ?? null) : scoreFromMonitorSpec(o?.monitorBase ?? null, o?.monitorTop ?? null);
      const ra = own ? scoreFromRamSpec(o?.ownRam ?? null, o?.ownRamTop ?? null) : scoreFromRamSpec(o?.ram ?? null, o?.ramTop ?? null);
      const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([s]) => s != null) as [number, number][];
      const tw = items.reduce((a, [, x]) => a + x, 0);
      return tw > 0 ? items.reduce((a, [s, x]) => a + s * x, 0) / tw : null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeByCode = new Map((stores as any[]).map((s) => [s.storeCode, s]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalList = (code: string) => (compsByCode.get(code) ?? []).filter((c: any) => c.investigationStatus !== "경쟁점없음").filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
    const build = (on: boolean): LabRow[] => rows.map((r) => {
      const s = storeByCode.get(r.input.storeCode);
      const rl = rivalList(r.input.storeCode);
      let i = -1;
      return {
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: specOf2(s, true, on) } : r.input.ownQualityParts,
          rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: specOf2(rl[i], false, on) } } : v; }),
        },
      };
    });
    console.log("\n[바닥만 풀기] 위쪽 눈금 그대로 · 1.00 뭉치만 [0.40, 1.00]에 편다");
    line("재현 확인 (바닥 그대로)", build(false));
    line("바닥 품", build(true));
    const spreadVals = (rivals as never as Record<string, string | null>[])
      .map((c) => spread(rawCpu(c.cpu ?? null))).filter((v): v is number => v != null && v < 1);
    console.log(`  풀린 경쟁점 CPU ${spreadVals.length}건: 최소 ${Math.min(...spreadVals).toFixed(2)} ~ 최대 ${Math.max(...spreadVals).toFixed(2)}`);
  });

  // ── 새 변환표를 끼운 행 만들기 ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeByCode = new Map((stores as any[]).map((s) => [s.storeCode, s]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rivalListOf = (code: string) => (compsByCode.get(code) ?? []).filter((c: any) => c.investigationStatus !== "경쟁점없음").filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labSpecOf = (o: any, own: boolean, opts: LabSpecOptions) => (o == null ? null : labComputeSpecScore({
    vgaBase: (own ? o.ownVgaBase : o.vgaBase) ?? null,
    vgaTop: (own ? o.ownVgaTop : o.vgaTop) ?? null,
    vgaTop2: (own ? o.ownVgaTop2 : o.vgaTop2) ?? null,
    cpu: (own ? o.ownCpu : o.cpu) ?? null,
    cpuTop1: (own ? o.ownCpuTop1 : o.cpuTop1) ?? null,
    cpuTop2: (own ? o.ownCpuTop2 : o.cpuTop2) ?? null,
    ram: (own ? o.ownRam : o.ram) ?? null,
    ramTop: (own ? o.ownRamTop : o.ramTop) ?? null,
    monitorBase: (own ? o.ownMonitorBase : o.monitorBase) ?? null,
    monitorTop: (own ? o.ownMonitorTop : o.monitorTop) ?? null,
  }, settings, opts));
  const labRows = (opts: LabSpecOptions): LabRow[] => rows.map((r) => {
    const s = storeByCode.get(r.input.storeCode);
    const rl = rivalListOf(r.input.storeCode);
    let i = -1;
    return {
      actualRevenue: r.actualRevenue,
      input: {
        ...r.input,
        ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: labSpecOf(s, true, opts) } : r.input.ownQualityParts,
        rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: labSpecOf(rl[i], false, opts) } } : v; }),
      },
    };
  });

  it("(14) 새 변환표 측정 — 하나씩 켜 본다", () => {
    // 운영 표만 쓰는 변환표(= 지금)로 되돌린 옵션. 재현이 맞는지 먼저 확인한다.
    const OLD_GPU = {} as Record<string, number>;
    console.log("\n[새 변환표] 하나씩 켠다 (모니터·RAM은 운영 그대로)");
    line("운영 변환표 (기준선)", opRows);
    line("재현 확인", labRows({ gpuTable: OLD_GPU }));
    line("GPU만 성능지수", labRows({}));
    line("CPU만 성능지수", labRows({ gpuTable: OLD_GPU, useCpuPerfIndex: true }));
    line("GPU+CPU 성능지수", labRows({ useCpuPerfIndex: true }));

    // 아래 훑기는 **채택 후보인 GPU만 켠 바닥** 위에서 잰다(CPU 표는 순서를 못 고쳤다 — (15)).
    console.log("\n[RAM 격차] 16GB↔32GB를 얼마나 벌릴까 (32GB=4.00 고정 · GPU 성능지수 바닥)");
    for (const gap of [0, 0.25, 0.5, 1, 1.5, 2]) {
      line(`격차 ${gap.toFixed(2)} (16GB=${(4 - gap).toFixed(2)})`, labRows({ ramGap: gap }));
    }

    console.log("\n[모니터] 특화 칸 비대칭 처리 (GPU 성능지수 바닥)");
    line("지금대로 (특화 포함)", labRows({}));
    line("기본만 (특화 무시)", labRows({ monitorBaseOnly: true }));
    line("모니터 뺌 ⚠️항목 자르기", labRows({ dropMonitor: true }));
  });

  // 임의의 GPU/CPU 채점함수로 행을 만든다. 대조군에서 표를 통째로 갈아끼우기 위한 것.
  const rowsWithScorers = (
    gpuScore: (t: string | null) => number | null,
    cpuScore: (t: string | null) => number | null,
    ramScore?: (t: string | null) => number | null,
  ): LabRow[] => {
    const w = settings.specWeights;
    const comb = (vs: (number | null)[]) => {
      const base = vs[0], sp = vs.slice(1).filter((v): v is number => v != null);
      if (base == null) return sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : null;
      return sp.length ? base * 0.8 + (sp.reduce((a, b) => a + b, 0) / sp.length) * 0.2 : base;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specOf = (o: any, own: boolean) => {
      if (o == null) return null;
      const g = comb((own ? [o.ownVgaBase, o.ownVgaTop, o.ownVgaTop2] : [o.vgaBase, o.vgaTop, o.vgaTop2]).map((t) => gpuScore(t ?? null)));
      const c = comb((own ? [o.ownCpu, o.ownCpuTop1, o.ownCpuTop2] : [o.cpu, o.cpuTop1, o.cpuTop2]).map((t) => cpuScore(t ?? null)));
      const ramBase = own ? (o.ownRam ?? null) : (o.ram ?? null);
      const ramTop = own ? (o.ownRamTop ?? null) : (o.ramTop ?? null);
      const ra = ramScore ? comb([ramScore(ramBase), ramScore(ramTop)]) : scoreFromRamSpec(ramBase, ramTop);
      const m = scoreFromMonitorSpec(own ? (o.ownMonitorBase ?? null) : (o.monitorBase ?? null), own ? (o.ownMonitorTop ?? null) : (o.monitorTop ?? null));
      const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([s]) => s != null) as [number, number][];
      const tw = items.reduce((a, [, x]) => a + x, 0);
      return tw > 0 ? items.reduce((a, [s, x]) => a + s * x, 0) / tw : null;
    };
    return rows.map((r) => {
      const s = storeByCode.get(r.input.storeCode);
      const rl = rivalListOf(r.input.storeCode);
      let i = -1;
      return {
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: specOf(s, true) } : r.input.ownQualityParts,
          rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: specOf(rl[i], false) } } : v; }),
        },
      };
    });
  };

  // ⚠️ `rows`는 이제 **실험실 기본**(GPU 성능지수 켜짐)이다 — labInput이 labComputeSpecScore를
  //    쓰기 때문이다. 운영 변환표 기준선이 필요하면 반드시 이 행을 쓴다.
  const opRows = rowsWithScorers(scoreFromVga, scoreFromCpu);

  it("(17) 앵커 위쪽 기울기 훑기 — 3080이 5.00인 게 과하다 (2026-09-18 사용자 지적)", () => {
    // ⚠️ "3060-4060-5060 간격을 늘린다"는 **반대 효과**다 — 간격을 늘리면 기울기가 작아지고
    //    3080이 상한에 더 세게 박힌다. 아래 첫 줄(0.18 = 지금, 대칭)이 그 증거다.
    const tops = ["RTX 5080", "RTX 5070", "RTX 4070", "RTX 3080", "RTX 5060Ti", "RTX 3070 Ti", "RTX 3070", "RTX 5060"];
    console.log("\n[앵커 위 기울기] 클수록 완만 · 앵커 아래(4060·3060·2060 등)는 한 톨도 안 바뀐다");
    console.log(`  기울기   ${tops.map((t) => t.replace("RTX ", "").padStart(6)).join(" ")}`);
    for (const up of [0.1816, 0.30, 0.45, 0.60, 0.854]) {
      const cells = tops.map((t) => (labScoreFromVga(t, LAB_GPU_PERF_INDEX, up) ?? NaN).toFixed(2).padStart(6));
      console.log(`  ${up.toFixed(3).padStart(6)}   ${cells.join(" ")}`);
    }
    console.log("  (0.1816 = 위아래 대칭 = 어제까지의 값 · 0.854 = RTX 5080이 딱 5.00이 되는 값)");
    console.log("\n  성적:");
    line("운영 변환표 (기준선)", opRows);
    for (const up of [0.1816, 0.30, 0.45, 0.60, 0.854]) {
      line(`  위 기울기 ${up.toFixed(3)}`, labRows({ gpuLogStepUp: up }));
    }
    // 이 값이 자사를 얼마나 건드리나 — 자사엔 앵커 위 카드가 5070 1 · 5060Ti 4 · 4070 3뿐이다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const cnt = (arr: unknown[], keys: string[]) => (arr as Record<string, string | null>[])
      .flatMap((o) => keys.map((k) => o[k])).filter((t) => {
        const idx = LAB_GPU_PERF_INDEX[labGpuKey(t ?? null) ?? ""];
        return idx != null && idx > 100;
      }).length;
    console.log(`\n  앵커보다 빠른 카드: 자사 ${cnt(S, ["ownVgaBase", "ownVgaTop", "ownVgaTop2"])}건 · 경쟁점 ${cnt(C, ["vgaBase", "vgaTop", "vgaTop2"])}건`);
  });

  it("(18) 세대 벌점 훑기 — 성능 말고 '얼마나 최신인가'를 같이 본다", () => {
    // 사용자 방향(2026-09-18): "성능외에 세대별 차등도 적용이 되는구조가 좋을것같은데"
    // 점수 = 4 + ln(성능/100)/기울기 − 세대벌점 × (5 − 세대)
    const show = ["RTX 5080", "RTX 5070", "RTX 5060Ti", "RTX 5060", "RTX 4070", "RTX 4060Ti", "RTX 4060",
      "RTX 3080", "RTX 3070", "RTX 3060Ti", "RTX 3060", "RTX 2080", "RTX 2060", "GTX 1080"];
    for (const up of [0.1816, 0.45]) {
      console.log(`\n[세대 벌점] 위 기울기 ${up} 에서`);
      console.log(`  벌점   ${show.map((t) => t.replace("RTX ", "").replace("GTX ", "G").padStart(6)).join("")}`);
      for (const gp of [0, 0.1, 0.15, 0.2, 0.3]) {
        const cells = show.map((t) => (labScoreFromVga(t, LAB_GPU_PERF_INDEX, up, gp) ?? NaN).toFixed(2).padStart(6));
        console.log(`  ${gp.toFixed(2).padStart(5)}  ${cells.join("")}`);
      }
    }
    console.log("\n[성적] 위 기울기 × 세대 벌점");
    line("운영 변환표 (기준선)", opRows);
    for (const up of [0.1816, 0.45]) {
      for (const gp of [0, 0.1, 0.15, 0.2, 0.3]) {
        line(`  위 ${up.toFixed(3)} · 벌점 ${gp.toFixed(2)}`, labRows({ gpuLogStepUp: up, gpuGenPenalty: gp }));
      }
    }
  });

  it("(19) 대조군 — 세대 벌점까지 넣은 표가 여전히 관문을 넘나", () => {
    // (16)과 같은 방식이다. 채택하려는 **최종 표**로 다시 돌린다 — 표를 손볼 때마다
    // 이걸 다시 돌리지 않으면 "대조군을 넘었다"는 말이 낡는다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const texts = [...new Set([
      ...S.flatMap((s) => [s.ownVgaBase, s.ownVgaTop, s.ownVgaTop2]),
      ...C.flatMap((c) => [c.vgaBase, c.vgaTop, c.vgaTop2]),
    ].map((t) => (t ?? "").trim()).filter(Boolean))];
    const deltas: number[] = [], keys: string[] = [];
    for (const t of texts) {
      const a = scoreFromVga(t), b = labScoreFromVga(t);
      if (a == null || b == null) continue;
      keys.push(t); deltas.push(b - a);
    }
    const rOf = (rs: LabRow[]) => {
      const sc = scoreTextbook(rs, P);
      const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
      return { r: pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual)), mape: sc.mape ?? 0 };
    };
    const base = rOf(opRows);
    const real = rOf(rowsWithScorers((t) => labScoreFromVga(t), scoreFromCpu));
    const gain = real.r - base.r;
    console.log(`\n[대조군 · 최종 GPU 표(성능+세대)] 모델 ${keys.length}종`);
    console.log(`  실제: r ${base.r.toFixed(3)} -> ${real.r.toFixed(3)} (좋아진 폭 ${gain.toFixed(3)}) · MAPE ${f(base.mape)}% -> ${f(real.mape)}%`);
    let rng = 20260918;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const gains: number[] = [];
    for (let t = 0; t < 300; t++) {
      const sh = [...deltas];
      for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
      const map = new Map(keys.map((k, i) => [k, sh[i]]));
      const scorer = (text: string | null) => {
        const a = scoreFromVga(text);
        if (a == null) return null;
        const d = map.get((text ?? "").trim());
        return d == null ? a : Math.max(1, Math.min(5, a + d));
      };
      gains.push(rOf(rowsWithScorers(scorer, scoreFromCpu)).r - base.r);
    }
    const sorted = [...gains].sort((a, b) => a - b);
    const pv = gains.filter((g) => g >= gain).length / gains.length;
    console.log(`  델타를 모델끼리 뒤섞기 300회: 중앙 ${median(gains).toFixed(3)} · 95퍼센타일 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(3)}`);
    console.log(`  p = ${pv.toFixed(3)}  ${pv < 0.05 ? "통과 ✅" : "미달 ❌"}`);
  });

  it("(20) RAM — 그대로 둬도 되나 (2026-09-18, 항목별로 하나씩)", () => {
    // 자료가 사실상 두 값이다: 16GB 계열(자사 35 · 경쟁 102) · 32GB 계열(자사 8 · 경쟁 75).
    // 운영 표는 3.50 / 4.00으로 **0.5점** 차이를 준다.
    //
    // 물을 것이 셋이다.
    //   (가) 격차를 얼마로 둘까 — 훑기
    //   (나) "32GB가 낫다"는 **방향**이 자료에 있나 — 뒤집어 본다
    //   (다) 순서인가 수준인가 — 상수 바꿔치기 + 무작위 대조군
    const gpu = (t: string | null) => labScoreFromVga(t);
    const ramWith = (gb32: number, gb16: number) => (t: string | null) => {
      const base = scoreFromRam(t);
      if (base == null) return null;
      return base >= 4 ? gb32 : base >= 3.5 ? gb16 : Math.max(1, gb16 - 2);
    };
    console.log("\n[RAM (가) 격차 훑기] 채택된 GPU 표(성능+세대) 위에서 · 32GB=4.00 고정");
    for (const gap of [0, 0.25, 0.5, 1, 1.5, 2]) {
      line(`  격차 ${gap.toFixed(2)} (16GB=${(4 - gap).toFixed(2)})`, rowsWithScorers(gpu, scoreFromCpu, ramWith(4, 4 - gap)));
    }
    console.log("\n[RAM (나) 방향] 32GB가 낫다는 게 자료에 있나 — 뒤집어 본다");
    line("  지금 (32GB 4.00 · 16GB 3.50)", rowsWithScorers(gpu, scoreFromCpu, ramWith(4, 3.5)));
    line("  뒤집기 (32GB 3.50 · 16GB 4.00)", rowsWithScorers(gpu, scoreFromCpu, ramWith(3.5, 4)));

    console.log("\n[RAM (다) 순서인가 수준인가]");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownRam = (stores as any[]).map((s) => scoreFromRamSpec(s.ownRam ?? null, s.ownRamTop ?? null)).filter((v): v is number => v != null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalRam = (rivals as any[]).map((c) => scoreFromRamSpec(c.ram ?? null, c.ramTop ?? null)).filter((v): v is number => v != null);
    console.log(`  자사 평균 ${mean(ownRam).toFixed(3)} · 경쟁점 평균 ${mean(rivalRam).toFixed(3)}  (경쟁점이 ${(mean(rivalRam) - mean(ownRam)).toFixed(3)} 높다)`);
    line("  지금 그대로", rowsWithScorers(gpu, scoreFromCpu));
    // ⚠️ 결측을 메우면 안 된다 — RAM이 없는 경쟁점 61건이 항목에서 빠지는 것이 원래 동작이다.
    //    처음에 `() => 4`로 썼다가 그 61건을 4.00으로 메워 25.14%라는 엉뚱한 값을 봤다.
    const constRam = (t: string | null) => (scoreFromRam(t) == null ? null : 4);
    line("  RAM 상수 (순서 지움)", rowsWithScorers(gpu, scoreFromCpu, constRam));

    // 무작위 대조군 — RAM 값을 자사끼리·경쟁점끼리 섞는다. 순서가 진짜면 실제가 나아야 한다.
    const base = scoreTextbook(rowsWithScorers(gpu, scoreFromCpu, (t) => (scoreFromRam(t) == null ? null : 4)), P);
    const real = scoreTextbook(rowsWithScorers(gpu, scoreFromCpu), P);
    const gain = (base.mape ?? 0) - (real.mape ?? 0);
    // 실제 16GB/32GB **비율은 그대로 두고** 어느 매장에 붙는지만 무작위로 바꾼다.
    // 자사(16GB 35 · 32GB 8)와 경쟁점(16GB 102 · 32GB 75)의 비율이 달라서 따로 뽑는다 —
    // 한 풀에서 뽑으면 수준까지 같이 흔들려 "순서만 지운" 게 아니게 된다.
    const ownP32 = ownRam.filter((v) => v >= 4).length / ownRam.length;
    const rivalP32 = rivalRam.filter((v) => v >= 4).length / rivalRam.length;
    let rng = 20260918;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const gains: number[] = [];
    for (let t = 0; t < 500; t++) {
      // 자사/경쟁점을 가려야 해서 텍스트가 아니라 호출 순서로 구분할 수 없다 —
      // 대신 두 비율의 평균을 쓴다. 비율 차이(0.19 vs 0.42)가 만드는 수준 효과는
      // 아래 "RAM 상수" 줄이 따로 보여준다.
      const p32 = (ownP32 + rivalP32) / 2;
      const randomRam = (t: string | null) => (scoreFromRam(t) == null ? null : rand() < p32 ? 4 : 3.5);
      gains.push((base.mape ?? 0) - (scoreTextbook(rowsWithScorers(gpu, scoreFromCpu, randomRam), P).mape ?? 0));
    }
    const sorted = [...gains].sort((a, b) => a - b);
    const pv = gains.filter((g) => g >= gain).length / gains.length;
    console.log(`\n  RAM을 켜서 좋아진 폭 ${f(gain)}%p`);
    console.log(`  무작위 RAM 500회: 중앙 ${f(median(gains))}%p · 95퍼센타일 ${f(sorted[Math.floor(sorted.length * 0.95)])}%p`);
    console.log(`  p = ${pv.toFixed(3)}  ${pv < 0.05 ? "통과 ✅" : "미달 ❌"}`);
  });

  it("(21) CPU 2차 — 갈라서 본다 (티어 / 세대 간격 / 둘 다)", () => {
    // 1차(15)에서 CPU 표를 통째로 끄면서 **두 변경을 같이 버렸다.**
    //   1. 티어 구분   i3 13100F가 i5 13400F와 같은 3.00점이던 것을 가른다 (자사 9곳)
    //   2. 세대 간격   세대당 1점이던 것이 성능차대로 압축된다 (13400F는 14400F의 97%)
    // 2번이 망친 것을 1번까지 같이 버렸는지 가른다.
    const gpu = (t: string | null) => labScoreFromVga(t);

    // (가) 티어만 — 운영 세대 산술은 그대로 두고 모델번호 백의 자리로 가산만 붙인다.
    //     인텔 모델번호가 티어를 담는다: 100=i3 · 400/500=i5 · 600=i5상위 · 700=i7 · 900=i9
    const tierBonus = (t: string | null, size: number) => {
      const key = labCpuKey(t);
      if (key == null) return 0;
      const m = key.match(/^(\d{4,5})$/);
      if (!m) return 0;
      const h = Number(m[1].slice(-3, -2)); // 백의 자리
      const rank = h <= 1 ? -1.5 : h <= 5 ? 0 : h <= 6 ? 0.5 : h <= 7 ? 1 : 1.5;
      return rank * size;
    };
    const cpuTierOnly = (size: number) => (t: string | null) => {
      const base = scoreFromCpu(t);
      return base == null ? null : Math.max(1, Math.min(5, base + tierBonus(t, size)));
    };

    console.log("\n[CPU (가) 티어만] 운영 세대 산술 + 모델번호 티어 가산 (i3 −1.5칸 · i7 +1칸 · i9 +1.5칸)");
    line("  운영 그대로 (기준선)", opRows);
    for (const size of [0.2, 0.4, 0.6]) {
      line(`  티어 한 칸 ${size.toFixed(1)}점`, rowsWithScorers(gpu, cpuTierOnly(size)));
    }

    console.log("\n[CPU (나) 성능지수 + 세대 벌점] 벌점 0 = 1차에서 껐던 그 표");
    for (const gp of [0, 0.15, 0.3, 0.5, 0.7, 1.0]) {
      line(`  세대 벌점 ${gp.toFixed(2)}`, rowsWithScorers(gpu, (t) => labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp)));
    }

    console.log("\n[점수가 어떻게 되나] 주요 모델");
    const show = ["i5 14400F", "울트라5 225F", "i5 14600K", "i5 13400F", "i3 13100F", "i5 12400F", "i7 12700F", "i5 11400F", "i5 9400F", "i9 9900KF"];
    console.log(`  ${"".padEnd(16)}${show.map((t) => t.replace("i5 ", "").replace("i3 ", "i3-").replace("i7 ", "i7-").replace("i9 ", "i9-").replace("울트라5 ", "U5-").padStart(8)).join("")}`);
    console.log(`  ${"운영".padEnd(14)}  ${show.map((t) => (scoreFromCpu(t) ?? NaN).toFixed(2).padStart(8)).join("")}`);
    for (const gp of [0, 0.3, 0.5, 0.7]) {
      console.log(`  ${("성능+벌점 " + gp.toFixed(2)).padEnd(14)}  ${show.map((t) => (labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp) ?? NaN).toFixed(2).padStart(8)).join("")}`);
    }
    console.log(`  ${"티어만 0.4".padEnd(14)}  ${show.map((t) => (cpuTierOnly(0.4)(t) ?? NaN).toFixed(2).padStart(8)).join("")}`);

    // 자사 9곳이 i3다 — 이 변경이 자사 변별에 얼마나 닿나
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[];
    const i3 = S.filter((s) => /i3/i.test(String(s.ownCpu ?? ""))).length;
    console.log(`\n  자사 CPU가 i3인 곳 ${i3}/${S.length}곳 · 경쟁점 i3는 ${(rivals as unknown as Record<string, string>[]).filter((c) => /i3/i.test(String(c.cpu ?? ""))).length}건`);
  });

  it("(22) i3 매장은 실제로 매출이 낮은가 — 티어 구분의 근거를 직접 본다", () => {
    // 티어 구분이 닿는 곳은 **자사뿐**이다(자사 i3 9곳 · 경쟁점 i3 0건). 그러면 산식을 거치기 전에
    // 실매출을 직접 갈라보는 게 제일 빠르다. PC당 월매출로 본다(매장 크기를 지운다).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[];
    const rowByCode = new Map(rows.map((r) => [r.input.storeCode, r]));
    const bucket = new Map<string, number[]>();
    for (const s of S) {
      const r = rowByCode.get(s.storeCode);
      if (!r) continue;
      const pc = r.input.pcCount;
      if (!pc || !(pc > 0) || !(r.actualRevenue > 0)) continue;
      const t = String(s.ownCpu ?? "");
      const k = /i3/i.test(t) ? "i3" : /i5/i.test(t) ? "i5" : /울트라|ultra/i.test(t) ? "울트라" : "기타";
      bucket.set(k, [...(bucket.get(k) ?? []), r.actualRevenue / pc]);
    }
    console.log("\n[자사 CPU 티어별 실매출] PC당 월매출");
    for (const [k, vs] of [...bucket.entries()].sort()) {
      console.log(`  ${k.padEnd(5)} ${String(vs.length).padStart(3)}곳  평균 ${(mean(vs) / 10000).toFixed(2)}만원 · 중앙 ${(median(vs) / 10000).toFixed(2)}만원`);
    }
    // 세대까지 갈라 본다 — i3 13100F는 13세대라, 13세대 i5와 견줘야 티어 효과만 남는다.
    const gen13 = new Map<string, number[]>();
    for (const s of S) {
      const r = rowByCode.get(s.storeCode);
      if (!r) continue;
      const pc = r.input.pcCount;
      if (!pc || !(pc > 0) || !(r.actualRevenue > 0)) continue;
      const t = String(s.ownCpu ?? "");
      if (!/13\d{3}/.test(t)) continue;
      const k = /i3/i.test(t) ? "13세대 i3" : "13세대 i5";
      gen13.set(k, [...(gen13.get(k) ?? []), r.actualRevenue / pc]);
    }
    console.log("  같은 13세대 안에서만:");
    for (const [k, vs] of [...gen13.entries()].sort()) {
      console.log(`  ${k.padEnd(10)} ${String(vs.length).padStart(3)}곳  평균 ${(mean(vs) / 10000).toFixed(2)}만원 · 중앙 ${(median(vs) / 10000).toFixed(2)}만원`);
    }

    // ── 교란인가 ────────────────────────────────────────────────────────────
    // 날것 차이는 구조를 증명하지 않는다([[feedback_raw_correlation_cannot_judge_structure]]).
    // i3를 넣은 매장이 애초에 저가·소형이면 매출이 낮은 건 CPU 탓이 아니다.
    const prof = new Map<string, { rate: number[]; pc: number[]; opened: number[]; resid: number[] }>();
    const sc = scoreTextbook(rows, P);
    const predByCode = new Map(sc.rows.map((r) => [r.storeCode, r.predicted]));
    for (const s of S) {
      const r = rowByCode.get(s.storeCode);
      if (!r) continue;
      const t = String(s.ownCpu ?? "");
      const k = /i3/i.test(t) ? "i3" : /i5/i.test(t) ? "i5" : null;
      if (!k) continue;
      const e = prof.get(k) ?? { rate: [], pc: [], opened: [], resid: [] };
      if (r.input.hourlyRate) e.rate.push(r.input.hourlyRate);
      if (r.input.pcCount) e.pc.push(r.input.pcCount);
      if (s.openedAt) { const d = new Date(s.openedAt); if (!isNaN(d.getTime())) e.opened.push(d.getFullYear() + d.getMonth() / 12); }
      const pred = predByCode.get(s.storeCode);
      if (pred != null && r.actualRevenue > 0) e.resid.push((pred - r.actualRevenue) / r.actualRevenue);
      prof.set(k, e);
    }
    console.log("\n[교란 확인] i3 매장이 애초에 다른 매장인가");
    console.log("  집단   요금      PC수     개점시기    모델 잔차(예측/실제−1)");
    for (const k of ["i3", "i5"]) {
      const e = prof.get(k)!;
      console.log(`  ${k.padEnd(5)}  ${mean(e.rate).toFixed(0).padStart(5)}원  ${mean(e.pc).toFixed(1).padStart(5)}대  ${mean(e.opened).toFixed(2)}년  ${(mean(e.resid) * 100).toFixed(1).padStart(6)}%`);
    }
    console.log("  ⚠️ 잔차가 이미 0에 가까우면 모델이 그 매장을 맞히고 있다는 뜻이다 —");
    console.log("     CPU를 더 낮추면 오히려 과소예측이 된다.");

    // ── 같은 13세대 안에서만 (2026-09-18 사용자 지적) ─────────────────────
    // 사용자: "i3라고 요금이낮은건아닌데? 요금은 사양에맞추는게아니라 상권에 맞추는형태임.
    //          우리가 당시 기본모델은 i3를 넣은거뿐."
    // 맞는 지적이다 — 요금은 i3의 결과가 아니다. 둘 다 **시기**에 붙어 있을 뿐이다.
    // 그러면 같은 세대 안에서 견주면 시기가 묶이니 교란이 빠진다.
    const g13 = new Map<string, { rev: number[]; rate: number[]; opened: number[]; resid: number[]; pc: number[] }>();
    for (const s of S) {
      const r = rowByCode.get(s.storeCode);
      if (!r) continue;
      const t = String(s.ownCpu ?? "");
      if (!/13\d{3}/.test(t)) continue;
      const pc = r.input.pcCount;
      if (!pc || !(pc > 0) || !(r.actualRevenue > 0)) continue;
      const k = /i3/i.test(t) ? "13세대 i3" : "13세대 i5";
      const e = g13.get(k) ?? { rev: [], rate: [], opened: [], resid: [], pc: [] };
      e.rev.push(r.actualRevenue / pc);
      e.pc.push(pc);
      if (r.input.hourlyRate) e.rate.push(r.input.hourlyRate);
      if (s.openedAt) { const d = new Date(s.openedAt); if (!isNaN(d.getTime())) e.opened.push(d.getFullYear() + d.getMonth() / 12); }
      const pred = predByCode.get(s.storeCode);
      if (pred != null) e.resid.push((pred - r.actualRevenue) / r.actualRevenue);
      g13.set(k, e);
    }
    console.log("\n[같은 13세대 안에서만] 시기를 묶으면 교란이 빠진다");
    console.log("  집단        곳수  PC당매출   요금     PC수    개점시기    모델 잔차");
    for (const k of ["13세대 i3", "13세대 i5"]) {
      const e = g13.get(k);
      if (!e) continue;
      console.log(`  ${k.padEnd(10)}  ${String(e.rev.length).padStart(3)}곳  ${(mean(e.rev) / 10000).toFixed(2).padStart(6)}만  ${mean(e.rate).toFixed(0).padStart(5)}원  ${mean(e.pc).toFixed(1).padStart(5)}대  ${mean(e.opened).toFixed(2)}년  ${(mean(e.resid) * 100).toFixed(1).padStart(6)}%`);
    }
    // 성능지수로 본 i3 13100F의 자리
    console.log(`\n  [참고] 성능지수  i3 13100F ${LAB_CPU_PERF_INDEX["13100"]} · i5 12400F ${LAB_CPU_PERF_INDEX["12400"]} · i5 13400F ${LAB_CPU_PERF_INDEX["13400"]} (i5 14400F = 100)`);
  });

  it("(23) CPU 3차 — 구조를 뜻으로 맞추면? (성능+세대, 대조군까지)", () => {
    // 사용자(2026-09-18): *"CPU 이거 정답맞아? 정답은 성능별로 점수 둬야하고,
    //                      세대별차이도 적용되야하는거아냐?"*
    // 맞는 지적이다. GPU엔 "성능+세대"를 채택해놓고 CPU엔 세대 산술만 쓰는 건 일관성이 없다.
    // 그리고 2차에서 내가 "기각"이라 한 근거는 MAPE였는데, 오늘 세운 기준은 **판정은 r**이다.
    const gpu = (t: string | null) => labScoreFromVga(t);
    const rOf = (rs: LabRow[]) => {
      const sc = scoreTextbook(rs, P);
      const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
      return { r: pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual)), mape: sc.mape ?? 0 };
    };
    const cur = rOf(rowsWithScorers(gpu, scoreFromCpu));
    console.log(`\n[CPU 3차] 바닥 = 채택된 GPU 표 + 운영 CPU: MAPE ${f(cur.mape)}% · r ${cur.r.toFixed(3)}`);
    console.log("\n  세대 벌점별 (성능지수 + 세대 벌점)");
    for (const gp of [0, 0.075, 0.15, 0.3, 0.5, 0.7, 1.0]) {
      line(`    벌점 ${gp.toFixed(3)}`, rowsWithScorers(gpu, (t) => labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp)));
    }
    console.log("\n  점수표 (i5 14400F = 4.00 앵커)");
    const show = ["i5 14400F", "i5 13400F", "i3 13100F", "i5 12400F", "i5 11400F", "i5 10400F", "i5 9400F", "i7 12700F", "i9 9900KF", "i5 14600K"];
    const hdr = show.map((t) => t.replace(/^i(\d) /, "i$1-").padStart(9)).join("");
    console.log(`  ${"".padEnd(14)}${hdr}`);
    console.log(`  ${"운영(지금)".padEnd(12)}  ${show.map((t) => (scoreFromCpu(t) ?? NaN).toFixed(2).padStart(9)).join("")}`);
    for (const gp of [0.075, 0.15, 0.3, 0.7]) {
      console.log(`  ${("성능+" + gp.toFixed(3)).padEnd(12)}  ${show.map((t) => (labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp) ?? NaN).toFixed(2).padStart(9)).join("")}`);
    }

    // 대조군 — GPU와 **같은 방식**이다. 델타의 크기는 그대로 두고 어느 모델에 붙는지만 뒤섞는다.
    console.log("\n  [대조군] 세대 벌점별 · 델타를 모델끼리 300회 뒤섞기");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const texts = [...new Set([
      ...S.flatMap((s) => [s.ownCpu, s.ownCpuTop1, s.ownCpuTop2]),
      ...C.flatMap((c) => [c.cpu, c.cpuTop1, c.cpuTop2]),
    ].map((t) => (t ?? "").trim()).filter(Boolean))];
    for (const gp of [0.075, 0.15, 0.3, 0.7]) {
      const keys: string[] = [], deltas: number[] = [];
      for (const t of texts) {
        const a = scoreFromCpu(t), b = labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp);
        if (a == null || b == null) continue;
        keys.push(t); deltas.push(b - a);
      }
      const real = rOf(rowsWithScorers(gpu, (t) => labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp)));
      const gain = real.r - cur.r;
      let rng = 20260918;
      const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const gains: number[] = [];
      for (let t = 0; t < 300; t++) {
        const sh = [...deltas];
        for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
        const map = new Map(keys.map((k, i) => [k, sh[i]]));
        const scorer = (text: string | null) => {
          const a = scoreFromCpu(text);
          if (a == null) return null;
          const d = map.get((text ?? "").trim());
          return d == null ? a : Math.max(1, Math.min(5, a + d));
        };
        gains.push(rOf(rowsWithScorers(gpu, scorer)).r - cur.r);
      }
      const sorted = [...gains].sort((a, b) => a - b);
      const pv = gains.filter((g) => g >= gain).length / gains.length;
      console.log(`    벌점 ${gp.toFixed(3)}  r ${cur.r.toFixed(3)} -> ${real.r.toFixed(3)} (${gain >= 0 ? "+" : ""}${gain.toFixed(3)}) · 뒤섞기 95%tile ${sorted[Math.floor(sorted.length * 0.95)].toFixed(3)} · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    }
  });

  it("(24) CPU 전체 점수표 — 벌점별로 어떻게 되나 (자료에 있는 것 전부)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const tally = (vals: (string | null)[]) => {
      const m = new Map<string, number>();
      for (const v of vals) { const k = (v ?? "").trim(); if (!k) continue; m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const o = tally(S.flatMap((s) => [s.ownCpu, s.ownCpuTop1, s.ownCpuTop2]));
    const r = tally(C.flatMap((c) => [c.cpu, c.cpuTop1, c.cpuTop2]));
    const gps = [0.075, 0.15, 0.3, 0.7];
    const keys = [...new Set([...o.keys(), ...r.keys()])]
      .filter((k) => scoreFromCpu(k) != null)
      .sort((a, b) => (labScoreFromCpu(b, LAB_CPU_PERF_INDEX, 0.3) ?? 0) - (labScoreFromCpu(a, LAB_CPU_PERF_INDEX, 0.3) ?? 0));
    console.log("\n[CPU 전체 점수표] 자료에 있는 모든 CPU · 벌점 0.30 기준 내림차순");
    console.log(`  자사  경쟁 |  운영 | ${gps.map((g) => ("+" + g).padStart(6)).join("")} | 값`);
    console.log(`  ${"-".repeat(76)}`);
    for (const k of keys) {
      const cells = gps.map((g) => (labScoreFromCpu(k, LAB_CPU_PERF_INDEX, g) ?? NaN).toFixed(2).padStart(6)).join("");
      const inTable = LAB_CPU_PERF_INDEX[labCpuKey(k) ?? ""] != null;
      console.log(`  ${String(o.get(k) ?? 0).padStart(4)}  ${String(r.get(k) ?? 0).padStart(4)} | ${(scoreFromCpu(k) ?? NaN).toFixed(2).padStart(5)} |${cells} | ${inTable ? " " : "⚠️"}${k}`);
    }
    console.log("  ⚠️ = 성능지수표에 없어 운영 세대 산술로 떨어지는 값 (벌점도 안 걸린다)");

    // 자사·경쟁점 평균이 어떻게 움직이나 — 수준 이동을 눈으로 본다
    console.log("\n[평균 이동] 수준이 얼마나 움직이나");
    const avg = (m: Map<string, number>, f: (t: string) => number | null) => {
      let sum = 0, n = 0;
      for (const [k, c] of m) { const v = f(k); if (v != null) { sum += v * c; n += c; } }
      return n ? sum / n : NaN;
    };
    console.log(`  ${"".padEnd(10)}  자사    경쟁점   격차`);
    const oOld = avg(o, scoreFromCpu), rOld = avg(r, scoreFromCpu);
    console.log(`  ${"운영".padEnd(9)} ${oOld.toFixed(3)}  ${rOld.toFixed(3)}  ${(oOld - rOld).toFixed(3)}`);
    for (const g of gps) {
      const a = avg(o, (t) => labScoreFromCpu(t, LAB_CPU_PERF_INDEX, g));
      const b = avg(r, (t) => labScoreFromCpu(t, LAB_CPU_PERF_INDEX, g));
      console.log(`  ${("벌점 " + g).padEnd(9)} ${a.toFixed(3)}  ${b.toFixed(3)}  ${(a - b).toFixed(3)}`);
    }
    console.log("  ⚠️ 격차가 줄면 자사 우위가 줄고 예상매출이 내려간다 — MAPE가 나빠지는 이유다.");
  });

  it("(25) 벌점을 매출 금액으로 번역한다 — 배수는 감이 안 온다", () => {
    // 존구성에서 쓴 방법이다(docs/releases/2026-09-17 6절). 점수 0.3이 뭔지는 감이 안 오지만
    // "경쟁점 CPU가 구형이면 우리 매출이 얼마 더 나오나"는 감이 온다.
    const gpu = (t: string | null) => labScoreFromVga(t);
    const cpuAt = (gp: number | null) => (t: string | null) =>
      gp == null ? scoreFromCpu(t) : labScoreFromCpu(t, LAB_CPU_PERF_INDEX, gp);

    // 경쟁상권 매장만 본다 — 독점 매장은 경쟁점 CPU를 바꿔도 점유율이 안 변한다.
    const competitive = rows.filter((r) => (r.input.competitorIp ?? 0) > 0);
    const models = ["i5 14400F", "i5 13400F", "i5 12400F", "i5 11400F", "i5 9400F"];

    const revAt = (gp: number | null, rivalCpu: string) => {
      const cs = cpuAt(gp);
      const rs: LabRow[] = competitive.map((r) => ({
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          // 자사는 그대로, 경쟁점 CPU만 이 모델로 통일해 본다.
          rivals: (r.input.rivals ?? []).map((v) => (v.parts ? { ...v, parts: { ...v.parts, spec: null } } : v)),
        },
      }));
      void rs; void cs;
      // 자사/경쟁점 사양을 제대로 다시 조립해야 하므로 rowsWithScorers를 쓰되,
      // 경쟁점 CPU 텍스트를 통일한 뒤 넣는다.
      const forced = rowsWithScorers(gpu, (t) => cs(t === "__RIVAL__" ? rivalCpu : t));
      const sc = scoreTextbook(forced.filter((r) => (r.input.competitorIp ?? 0) > 0), P);
      return sc;
    };
    void revAt;

    // 위 방식은 텍스트를 못 갈아끼운다(원자료를 읽어 조립하므로). 대신 **경쟁점 spec 점수를
    // 직접 계산해 넣는다** — 경쟁점 CPU만 지정 모델로 통일하고 나머지 항목은 실제값을 쓴다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalListOfCode = (code: string) => (compsByCode.get(code) ?? []).filter((c: any) => c.investigationStatus !== "경쟁점없음").filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
    const w = settings.specWeights;
    const comb = (vs: (number | null)[]) => {
      const base = vs[0], sp = vs.slice(1).filter((v): v is number => v != null);
      if (base == null) return sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : null;
      return sp.length ? base * 0.8 + (sp.reduce((a, b) => a + b, 0) / sp.length) * 0.2 : base;
    };
    const build = (gp: number | null, rivalCpu: string): number => {
      const cs = cpuAt(gp);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeByCodeL = new Map((stores as any[]).map((s) => [s.storeCode, s]));
      const rs: LabRow[] = rows.filter((r) => (r.input.competitorIp ?? 0) > 0).map((r) => {
        const s = storeByCodeL.get(r.input.storeCode);
        const rl = rivalListOfCode(r.input.storeCode);
        let i = -1;
        const ownSpec = (() => {
          const g = comb([s?.ownVgaBase, s?.ownVgaTop, s?.ownVgaTop2].map((t) => gpu(t ?? null)));
          const c = comb([s?.ownCpu, s?.ownCpuTop1, s?.ownCpuTop2].map((t) => cs(t ?? null)));
          const ra = scoreFromRamSpec(s?.ownRam ?? null, s?.ownRamTop ?? null);
          const m = scoreFromMonitorSpec(s?.ownMonitorBase ?? null, s?.ownMonitorTop ?? null);
          const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([x]) => x != null) as [number, number][];
          const tw = items.reduce((a, [, x]) => a + x, 0);
          return tw > 0 ? items.reduce((a, [x, y]) => a + x * y, 0) / tw : null;
        })();
        return {
          actualRevenue: r.actualRevenue,
          input: {
            ...r.input,
            ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: ownSpec } : r.input.ownQualityParts,
            rivals: (r.input.rivals ?? []).map((v) => {
              i += 1;
              const c0 = rl[i];
              if (!v.parts || !c0) return v;
              const g = comb([c0.vgaBase, c0.vgaTop, c0.vgaTop2].map((t: string | null) => gpu(t ?? null)));
              const c = cs(rivalCpu); // ← 경쟁점 CPU를 이 모델로 통일
              const ra = scoreFromRamSpec(c0.ram ?? null, c0.ramTop ?? null);
              const m = scoreFromMonitorSpec(c0.monitorBase ?? null, c0.monitorTop ?? null);
              const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([x]) => x != null) as [number, number][];
              const tw = items.reduce((a, [, x]) => a + x, 0);
              return { ...v, parts: { ...v.parts, spec: tw > 0 ? items.reduce((a, [x, y]) => a + x * y, 0) / tw : null } };
            }),
          },
        };
      });
      const sc = scoreTextbook(rs, P);
      const preds = sc.rows.map((x) => x.predicted).filter((v): v is number => v != null);
      return preds.reduce((a, b) => a + b, 0) / preds.length;
    };

    console.log(`\n[매출로 번역] 경쟁상권 ${rows.filter((r) => (r.input.competitorIp ?? 0) > 0).length}곳 · 경쟁점 CPU를 전부 같은 모델로 놓았을 때 우리 예상매출 평균`);
    console.log(`  경쟁점 CPU      ${["운영", "0.075", "0.15", "0.3", "0.7"].map((x) => x.padStart(10)).join("")}`);
    const base: Record<string, number> = {};
    for (const m of models) {
      const cells = [null, 0.075, 0.15, 0.3, 0.7].map((gp) => build(gp, m));
      base[m] = cells[0];
      console.log(`  ${m.padEnd(14)}${cells.map((v) => (Math.round(v / 10000).toLocaleString() + "만").padStart(10)).join("")}`);
    }
    console.log("\n  [차이] 경쟁점이 i5 14400F(최신)일 때 대비 — 구형일수록 우리 매출이 얼마나 오르나");
    for (const m of models.slice(1)) {
      const cells = [null, 0.075, 0.15, 0.3, 0.7].map((gp) => build(gp, m) - build(gp, "i5 14400F"));
      console.log(`  ${m.padEnd(14)}${cells.map((v) => ("+" + Math.round(v / 10000).toLocaleString() + "만").padStart(10)).join("")}`);
    }
  });

  it("(26) 모니터 원문 전수 — 조사 수준이 얼마나 갈리나 (2026-09-18)", () => {
    // 사용자 진단: *"자사는 우리가 발주했으니까 매장전체의 품목이 뭔지 정리가되어있는데,
    //  경쟁점조사는 모니터사양까지는 디테일하게안봐. 디테일하게보더라도 수준이 높지않고,
    //  조사자마다의 수준 편차가있어서. 내가 2차로 네이버같은곳에서 매장정보나 사진보고
    //  추가로 작성하는데, 이게 없는매장들도 있을거아냐."*
    //
    // 그러면 자사와 경쟁점은 **자료의 성격이 다르다** — 발주 기록(사실) 대 현장 관찰(불완전).
    // 얼마나 갈리는지 원문을 그대로 펴 본다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];

    /** 텍스트가 무엇을 담고 있나 — 조사 수준을 가른다. */
    const grade = (t: string | null) => {
      if (!t || !t.trim()) return "(빈칸)";
      const u = t.toUpperCase();
      const hasHz = /\d{2,3}\s*HZ/i.test(t);
      const hasRes = /FHD|QHD|UHD|4K|WQHD/.test(u);
      const hasInch = /\d{2}\s*(인치|IN\b)/.test(u);
      const hasModel = /[A-Z]{2,}\s*\d|\d{3,}[A-Z]/.test(u);
      if (hasHz && hasRes && hasInch) return "1. 인치+해상도+Hz";
      if (hasHz && hasRes) return "2. 해상도+Hz";
      if (hasHz) return "3. Hz만";
      if (hasRes || hasInch) return "4. 해상도·인치만 (Hz 없음)";
      if (hasModel) return "5. 모델명만";
      return "6. 그 밖";
    };

    for (const [label, vals] of [
      ["자사 기본", S.map((s) => s.ownMonitorBase ?? null)],
      ["자사 특화", S.map((s) => s.ownMonitorTop ?? null)],
      ["경쟁점 기본", C.map((c) => c.monitorBase ?? null)],
      ["경쟁점 특화", C.map((c) => c.monitorTop ?? null)],
    ] as [string, (string | null)[]][]) {
      const m = new Map<string, number>();
      for (const v of vals) m.set(grade(v), (m.get(grade(v)) ?? 0) + 1);
      const total = vals.length;
      console.log(`\n[${label}] ${total}건`);
      for (const [k, n] of [...m.entries()].sort()) {
        console.log(`    ${String(n).padStart(3)}건 (${((n / total) * 100).toFixed(0).padStart(3)}%)  ${k}`);
      }
    }

    console.log("\n[자사 기본 원문] 발주 기록이라 정리돼 있다");
    const tally = (vals: (string | null)[]) => {
      const m = new Map<string, number>();
      for (const v of vals) { const k = (v ?? "").trim(); if (!k) continue; m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    for (const [k, n] of tally(S.map((s) => s.ownMonitorBase ?? null))) {
      console.log(`    ${String(n).padStart(3)}건  ${(scoreFromMonitor(k) ?? NaN).toFixed(2)}  ${k}`);
    }

    console.log("\n[경쟁점 기본 원문] 조사자마다 수준이 갈린다 (전수)");
    for (const [k, n] of tally(C.map((c) => c.monitorBase ?? null))) {
      const sc = scoreFromMonitor(k);
      console.log(`    ${String(n).padStart(3)}건  ${sc == null ? " -  " : sc.toFixed(2)}  [${grade(k).slice(0, 2)}] ${k}`);
    }
  });

  it("(27) 모니터 분별력 — Hz 하나로 좁혀서 본다 + 비중 훑기", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    /** 텍스트에서 Hz를 다 뽑는다. 한 칸에 여러 모델이 있으면 여러 개가 나온다. */
    const hzOf = (t: string | null): number[] => (t ? [...t.matchAll(/(\d{2,3})\s*hz/gi)].map((m) => Number(m[1])) : []);
    const dist = (vals: (string | null)[]) => {
      const m = new Map<number, number>();
      let multi = 0, none = 0;
      for (const v of vals) {
        const hs = hzOf(v);
        if (hs.length === 0) { if (v && v.trim()) none += 1; continue; }
        if (hs.length > 1) multi += 1;
        for (const h of hs) m.set(h, (m.get(h) ?? 0) + 1);
      }
      return { m, multi, none };
    };
    for (const [label, vals] of [
      ["자사 기본", S.map((s) => s.ownMonitorBase ?? null)],
      ["경쟁점 기본", C.map((c) => c.monitorBase ?? null)],
    ] as [string, (string | null)[]][]) {
      const { m, multi, none } = dist(vals);
      console.log(`\n[${label}] Hz 분포`);
      for (const [hz, n] of [...m.entries()].sort((a, b) => b[0] - a[0])) {
        console.log(`    ${String(hz).padStart(3)}Hz  ${String(n).padStart(3)}건  ${"#".repeat(Math.min(40, n))}`);
      }
      console.log(`    (한 칸에 여러 모델이 적힌 곳 ${multi}건 · Hz를 못 뽑은 곳 ${none}건)`);
    }
    // 해상도·인치가 상수인지
    const res = (vals: (string | null)[]) => {
      let fhd = 0, qhd = 0, other = 0, inch32 = 0, total = 0;
      for (const v of vals) {
        if (!v || !v.trim()) continue;
        total += 1;
        const u = v.toUpperCase();
        if (/QHD|WQHD/.test(u)) qhd += 1; else if (/FHD/.test(u)) fhd += 1; else other += 1;
        if (/32\s*(인치|IN)/.test(u)) inch32 += 1;
      }
      return { fhd, qhd, other, inch32, total };
    };
    const ro = res(S.map((s) => s.ownMonitorBase ?? null)), rc = res(C.map((c) => c.monitorBase ?? null));
    console.log(`\n[해상도·인치가 상수인가]`);
    console.log(`  자사   기입 ${ro.total}건 중 FHD ${ro.fhd} · QHD ${ro.qhd} · 32인치 ${ro.inch32}`);
    console.log(`  경쟁점 기입 ${rc.total}건 중 FHD ${rc.fhd} · QHD ${rc.qhd} · 32인치 ${rc.inch32}`);

    // ── 비중 훑기 ───────────────────────────────────────────────────────────
    // 사용자 진단대로 자료 신뢰도가 자사(발주 기록)와 경쟁점(현장 관찰+2차 보충)에서 다르다면,
    // **비중을 낮추는 것**이 뜻에 맞는 대응이다. 얼마까지 낮출지 재 본다.
    console.log(`\n[모니터 비중 훑기] 지금 ${settings.specWeights.monitor} · 나머지 항목으로 재정규화`);
    for (const mw of [0.25, 0.2, 0.15, 0.1, 0.05, 0]) {
      const s2 = { ...settings, specWeights: { ...settings.specWeights, monitor: mw } };
      const r2 = buildLabRows({ stores, compsByCode, utilByStore, settings: s2, qscByStoreCode });
      line(`  비중 ${mw.toFixed(2)}`, r2);
    }
  });

  it("(28) 모니터 세부 재정립 — 구간표를 연속 눈금으로", () => {
    // 지금 구간표는 경계가 실제 값 바로 위에 걸려 있다(>=144 / >=166 / >=241).
    //   144Hz 36건 -> 3.00 · 140Hz 1건 -> 2.00   같은 물건인데 1점이 갈린다
    //   165Hz 35건 -> 3.00 · 166Hz면 3.25        1Hz에 0.25점
    // GPU·CPU와 같은 구조(연속 로그 눈금)로 맞춘다.
    //
    //   점수 = 앵커점수 + ln(Hz / 240) / step      (240Hz = 자사 표준)
    //
    // step은 "240 -> 144가 1점"이 되게 잡는다: ln(144/240) = -0.511.
    // 지금 표에서 240=3.50 · 144=3.00이 1점이 아니라 0.5점이므로, 두 벌을 다 재 본다.
    const HZ_STEP_1PT = 0.5108; // 240 -> 144 를 1점으로
    const HZ_STEP_HALF = 1.0217; // 240 -> 144 를 0.5점으로 (지금 간격 유지)
    const monoHz = (t: string | null): number | null => {
      if (!t) return null;
      const hs = [...t.matchAll(/(\d{2,3})\s*hz/gi)].map((m) => Number(m[1]));
      if (hs.length === 0) return null;
      return hs.reduce((a, b) => a + b, 0) / hs.length; // 한 칸에 여러 모델이면 평균(지금과 같다)
    };
    const contMonitor = (anchor: number, step: number) => (t: string | null): number | null => {
      if (!t) return null;
      const u = t.toUpperCase();
      if (/4K|UHD|OLED/.test(u)) return 5;
      const hz = monoHz(t);
      if (hz == null) return scoreFromMonitor(t); // Hz가 없으면 운영 처리(모델명 표 등)
      let sc = anchor + Math.log(hz / 240) / step;
      // QHD 가산은 그대로 둔다 — 32인치에서 FHD↔QHD는 실제 체감 차이가 크다(경쟁점 10건·자사 1건).
      const mentionsFhd = /FHD/.test(u);
      if (!mentionsFhd && /QHD/.test(u)) sc += 1;
      if (/ZOWIE/.test(u)) sc = Math.max(sc, 4.5);
      return Math.max(1, Math.min(5, sc));
    };
    // 기본/특화 결합은 운영과 같게(65/35 · 기본보다 낮은 특화는 제외)
    const specOf = (base: string | null, top: string | null, f: (t: string | null) => number | null) => {
      const b = f(base);
      if (!top) return b;
      const q = top.split(",").map((p) => f(p.trim())).filter((s): s is number => s != null && (b == null || s > b));
      if (q.length === 0) return b;
      const avg = q.reduce((a, c) => a + c, 0) / q.length;
      return b == null ? avg : b * 0.65 + avg * 0.35;
    };
    const gpu = (t: string | null) => labScoreFromVga(t);
    const w = settings.specWeights;
    const comb = (vs: (number | null)[]) => {
      const base = vs[0], sp = vs.slice(1).filter((v): v is number => v != null);
      if (base == null) return sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : null;
      return sp.length ? base * 0.8 + (sp.reduce((a, b) => a + b, 0) / sp.length) * 0.2 : base;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeByCodeL = new Map((stores as any[]).map((s) => [s.storeCode, s]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalListL = (code: string) => (compsByCode.get(code) ?? []).filter((c: any) => c.investigationStatus !== "경쟁점없음").filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
    const build = (mf: (t: string | null) => number | null): LabRow[] => rows.map((r) => {
      const s = storeByCodeL.get(r.input.storeCode);
      const rl = rivalListL(r.input.storeCode);
      let i = -1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mk = (o: any, own: boolean) => {
        if (!o) return null;
        const g = comb((own ? [o.ownVgaBase, o.ownVgaTop, o.ownVgaTop2] : [o.vgaBase, o.vgaTop, o.vgaTop2]).map((t) => gpu(t ?? null)));
        const c = comb((own ? [o.ownCpu, o.ownCpuTop1, o.ownCpuTop2] : [o.cpu, o.cpuTop1, o.cpuTop2]).map((t) => labScoreFromCpu(t ?? null)));
        const ra = scoreFromRamSpec(own ? (o.ownRam ?? null) : (o.ram ?? null), own ? (o.ownRamTop ?? null) : (o.ramTop ?? null));
        const m = specOf(own ? (o.ownMonitorBase ?? null) : (o.monitorBase ?? null), own ? (o.ownMonitorTop ?? null) : (o.monitorTop ?? null), mf);
        const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([x]) => x != null) as [number, number][];
        const tw = items.reduce((a, [, x]) => a + x, 0);
        return tw > 0 ? items.reduce((a, [x, y]) => a + x * y, 0) / tw : null;
      };
      return {
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: mk(s, true) } : r.input.ownQualityParts,
          rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: mk(rl[i], false) } } : v; }),
        },
      };
    });

    const hzList = [240, 200, 180, 165, 160, 144, 140, 120, 75, 60];
    console.log("\n[Hz -> 점수] 실제 자료에 있는 값들");
    console.log(`  ${"".padEnd(18)}${hzList.map((h) => (h + "Hz").padStart(8)).join("")}`);
    const fmtRow = (label: string, f: (t: string | null) => number | null) =>
      console.log(`  ${label.padEnd(16)}  ${hzList.map((h) => (f(`(32인치·FHD·${h}Hz)`) ?? NaN).toFixed(2).padStart(8)).join("")}`);
    fmtRow("운영 구간표", scoreFromMonitor);
    fmtRow("연속 240=4.00 1점", contMonitor(4, HZ_STEP_1PT));
    fmtRow("연속 240=3.50 1점", contMonitor(3.5, HZ_STEP_1PT));
    fmtRow("연속 240=3.50 0.5점", contMonitor(3.5, HZ_STEP_HALF));

    console.log("\n[성적] 비중은 지금 그대로(0.25)");
    line("  지금 (운영 구간표)", build(scoreFromMonitor));
    line("  연속 240=4.00 1점", build(contMonitor(4, HZ_STEP_1PT)));
    line("  연속 240=3.50 1점", build(contMonitor(3.5, HZ_STEP_1PT)));
    line("  연속 240=3.50 0.5점", build(contMonitor(3.5, HZ_STEP_HALF)));

    // 연속 눈금 + 비중 조정을 합쳐서 — 자료 신뢰도가 낮으니 비중을 낮추는 게 뜻에 맞는 대응이다.
    console.log("\n[연속 눈금 × 비중] 240=4.00 · 1점 간격 위에서");
    for (const mw of [0.25, 0.15, 0.1, 0.05]) {
      const w2 = { ...w, monitor: mw };
      const built = build(contMonitor(4, HZ_STEP_1PT)).map((r) => r); // 아래에서 비중만 갈아끼운다
      void built;
      // 비중이 바뀌면 spec 종합이 달라지므로 다시 조립한다.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mk = (o: any, own: boolean) => {
        if (!o) return null;
        const g = comb((own ? [o.ownVgaBase, o.ownVgaTop, o.ownVgaTop2] : [o.vgaBase, o.vgaTop, o.vgaTop2]).map((t) => gpu(t ?? null)));
        const c = comb((own ? [o.ownCpu, o.ownCpuTop1, o.ownCpuTop2] : [o.cpu, o.cpuTop1, o.cpuTop2]).map((t) => labScoreFromCpu(t ?? null)));
        const ra = scoreFromRamSpec(own ? (o.ownRam ?? null) : (o.ram ?? null), own ? (o.ownRamTop ?? null) : (o.ramTop ?? null));
        const m = specOf(own ? (o.ownMonitorBase ?? null) : (o.monitorBase ?? null), own ? (o.ownMonitorTop ?? null) : (o.monitorTop ?? null), contMonitor(4, HZ_STEP_1PT));
        const items = [[g, w2.vga], [m, w2.monitor], [ra, w2.ram], [c, w2.cpu]].filter(([x]) => x != null) as [number, number][];
        const tw = items.reduce((a, [, x]) => a + x, 0);
        return tw > 0 ? items.reduce((a, [x, y]) => a + x * y, 0) / tw : null;
      };
      const rs: LabRow[] = rows.map((r) => {
        const s = storeByCodeL.get(r.input.storeCode);
        const rl = rivalListL(r.input.storeCode);
        let i = -1;
        return {
          actualRevenue: r.actualRevenue,
          input: {
            ...r.input,
            ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: mk(s, true) } : r.input.ownQualityParts,
            rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: mk(rl[i], false) } } : v; }),
          },
        };
      });
      line(`  비중 ${mw.toFixed(2)}`, rs);
    }
  });

  it("(29) 모니터 — Hz 말고 뭐가 자료에 있나 (해상도·패널·브랜드·크기)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const ownAll = S.flatMap((s) => [s.ownMonitorBase, s.ownMonitorTop]).filter(Boolean).map(String);
    const rivAll = C.flatMap((c) => [c.monitorBase, c.monitorTop]).filter(Boolean).map(String);
    // 한 칸에 여러 모델이 줄바꿈/콤마로 들어간 경우가 있어 낱개로 편다.
    const split = (arr: string[]) => arr.flatMap((t) => t.split(/[\n,]/).map((x) => x.trim()).filter(Boolean));
    const O = split(ownAll), R = split(rivAll);
    // ⚠️ WQHD = QHD(2560x1440)로 **같은 것**이고, WWQHD/UWQHD가 울트라와이드(3440x1440)로 다른 것이다.
    //    (2026-09-18 사용자 정정 — 처음엔 WQHD를 울트라와이드로 잡아 자사 개수가 부풀려졌다)
    const UW = /WWQHD|UWQHD|울트라와이드|ULTRAWIDE|21:9/i;
    const keys: [string, RegExp][] = [
      ["4K·UHD", /4K|UHD(?!QHD)/i],
      ["OLED", /OLED/i],
      ["QHD(=WQHD)", /(?<!W)(?<!U)WQHD|(?<!W)QHD/i],
      ["  그중 울트라와이드(WWQHD)", UW],
      ["FHD", /FHD/i],
      ["울트라와이드", UW],
      ["커브드", /커브드|CURVED/i],
      ["HDR", /HDR/i],
      ["ZOWIE", /ZOWIE/i],
      ["BenQ", /BENQ/i],
      ["LG 울트라기어", /울트라기어|ULTRAGEAR/i],
      ["삼성 오디세이", /오디세이|ODYSSEY/i],
      ["ASUS", /ASUS|에이수스|TUF|ROG/i],
      ["DELL", /DELL|델\b/i],
      ["GIGABYTE·AORUS", /GIGABYTE|AORUS|기가바이트/i],
      ["MSI", /\bMSI\b/i],
      ["알파스캔·AOC", /알파스캔|\bAOC\b/i],
      ["27인치", /27\s*(인치|IN)/i],
      ["32인치", /32\s*(인치|IN)/i],
      ["34인치", /34\s*(인치|IN)/i],
    ];
    console.log(`\n[모니터 낱개 항목] 자사 ${O.length}개 · 경쟁점 ${R.length}개 (한 칸의 여러 모델을 낱개로 편 것)`);
    console.log("  항목               자사   경쟁점");
    for (const [label, re] of keys) {
      const o = O.filter((t) => re.test(t)).length, r = R.filter((t) => re.test(t)).length;
      console.log(`  ${label.padEnd(16)} ${String(o).padStart(4)}  ${String(r).padStart(6)}`);
    }
    // 지금 식에서 특례로 걸리는 것들이 실제로 몇 점을 받나
    console.log("\n[지금 식의 특례가 걸린 실제 값]");
    const special = [...new Set([...O, ...R])].filter((t) => /4K|UHD|OLED|ZOWIE/i.test(t) || /QHD/i.test(t));
    for (const t of special.slice(0, 30)) {
      console.log(`    ${(scoreFromMonitor(t) ?? NaN).toFixed(2)}  ${t}`);
    }
    console.log(`    (해상도·패널 특례가 걸리는 낱개 ${special.length}개)`);

    // 240Hz 초과 — 상한(5.00)에 몰릴 후보들. 사용자 지적: "벤큐 360상한이좀걸리네 벤큐 600인가 그정도급까지있는데"
    const hz1 = (t: string) => { const m = [...t.matchAll(/(\d{2,3})\s*hz/gi)].map((x) => Number(x[1])); return m.length ? Math.max(...m) : null; };
    const high = [...O.map((t) => ["자사", t] as const), ...R.map((t) => ["경쟁", t] as const)]
      .map(([side, t]) => [side, t, hz1(t)] as const)
      .filter(([, , h]) => h != null && h > 240);
    console.log(`\n[240Hz 초과] ${high.length}개 — 상한에 몰릴 후보`);
    for (const [side, t, h] of high) console.log(`    ${side}  ${h}Hz  ${t}`);
    const byHz = new Map<number, number>();
    for (const [, , h] of high) byHz.set(h!, (byHz.get(h!) ?? 0) + 1);
    console.log(`    Hz별: ${[...byHz.entries()].sort((a, b) => a[0] - b[0]).map(([h, n]) => `${h}Hz ${n}개`).join(" · ")}`);
  });

  it("(30) 모니터 최종안 — 연속 눈금 + 등급 가산 + 위쪽 기울기", () => {
    // 사용자 확정 방향(2026-09-18):
    //   - 연속 눈금 좋다
    //   - 가산 순서: OLED > BenQ·4K > 정품브랜드 > 울트라와이드 > QHD
    //   - QHD +1.0은 높다
    //   - BenQ도 등급이 있다 (ZOWIE vs 일반)
    //   - 240Hz 위가 상한에 몰린다 (600Hz까지 있다)
    const UW = /WWQHD|UWQHD|울트라와이드|ULTRAWIDE|21:9/i;
    const mk = (stepUp: number, benqZowie: number, benqPlain: number) => (t: string | null): number | null => {
      if (!t) return null;
      const u = t.toUpperCase();
      const hs = [...t.matchAll(/(\d{2,3})\s*hz/gi)].map((m) => Number(m[1]));
      if (hs.length === 0) return null;
      const hz = hs.reduce((a, b) => a + b, 0) / hs.length;
      const rel = Math.log(hz / 240);
      let sc = 4 + rel / (rel > 0 ? stepUp : 0.5108);
      // 해상도 — 세로 픽셀 기준. WWQHD(3440x1440)는 QHD(2560x1440)와 세로가 같다.
      if (/4K|UHD(?!QHD)/.test(u)) sc += 0.6;
      else if (/QHD/.test(u)) sc += 0.2;
      if (UW.test(u)) sc += 0.3;      // 시야(21:9)는 해상도와 별개
      if (/OLED/.test(u)) sc += 1.0;
      // 브랜드 — ZOWIE(e스포츠 전용)와 일반 BenQ를 가른다
      if (/ZOWIE/.test(u)) sc += benqZowie;
      else if (/BENQ/.test(u)) sc += benqPlain;
      else if (/ASUS|에이수스|TUF|ROG|DELL|ALIENWARE|에일리언웨어|울트라기어|ULTRAGEAR|오디세이|ODYSSEY|GIGABYTE|AORUS|\bMSI\b/.test(u)) sc += 0.4;
      return Math.max(1, Math.min(5, sc));
    };
    const show = [
      "제이씨현 (32인치·FHD·240Hz)",
      "무명 (32인치·FHD·165Hz)",
      "무명 (32인치·FHD·144Hz)",
      "무명 (32인치·FHD·60Hz)",
      "LG전자 울트라기어 32GP750 (32인치 QHD 165Hz)",
      "LG UltraWide 34WP65C (34인치·울트라와이드 WWQHD·160Hz)",
      "BenQ EX3200R (32인치·FHD·144Hz)",
      "BenQ MOBIUZ EX3210U (32인치·4K·144Hz)",
      "BenQ ZOWIE XL2546K (24.5인치·FHD·240Hz)",
      "BenQ ZOWIE XL2540X+ (24.1인치·FHD·280Hz)",
      "QNIX IPS (27인치·FHD·300Hz)",
      "DELL Alienware AW2523HF (25인치·FHD·360Hz)",
      "BenQ ZOWIE XL2566K (24.5인치·FHD·360Hz)",
      "BenQ ZOWIE XL2566X+ (24.1인치 FHD 400Hz)",
      "BenQ ZOWIE XL2586X+ (24.1인치 FHD 600Hz)",
    ];
    for (const su of [0.916, 1.5, 2.29]) {
      console.log(`\n[위 기울기 ${su}] ${su === 0.916 ? "600Hz가 Hz항만으로 +1.00" : su === 2.29 ? "600Hz ZOWIE가 딱 5.00" : "중간"}`);
      const f = mk(su, 0.6, 0.4);
      for (const t of show) console.log(`    ${(f(t) ?? NaN).toFixed(2)}  ${t}`);
    }
  });

  it("(31) 후보지가 실험실 산식을 돌릴 준비가 됐나 (2026-09-18)", () => {
    // 사용자: *"나 신규후보지 평가할건데, 기존산식이랑 지금만드는산식 두개다할거거든.
    //          평가항목이 추가된거있으니까 이거 반영해야할듯?"*
    // 실험실은 지금 **기존점만** 본다(buildLabRows가 ExistingStore[]만 받는다).
    // 후보지 경로를 만들려면 어떤 입력이 있고 없는지부터 세야 한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cands: any[] = snap.candidates ?? [];
    if (cands.length === 0) { console.log("\n[후보지] 스냅샷에 후보지가 없다"); return; }
    const compsBy = new Map<string, number>();
    for (const c of allCompetitors) compsBy.set(c.candidateCode, (compsBy.get(c.candidateCode) ?? 0) + 1);

    const need: [string, (c: Record<string, unknown>) => boolean, string][] = [
      ["PC수", (c) => c.pcCount != null, "수요·매출"],
      ["요금", (c) => c.hourlyRate != null, "단가"],
      ["주거 1km", (c) => c.pop1km != null, "1단계 수요"],
      ["유동 400m", (c) => c.floating400Avg != null, "1단계 수요 (확정 반경)"],
      ["유동 300m", (c) => c.floating300Avg != null, "2단계 중심도"],
      ["유동 1km", (c) => c.floating1000Avg != null, "2단계 중심도"],
      ["층·엘리베이터", (c) => c.floor != null, "2단계 접근성"],
      ["연령별 주거", (c) => c.age1km_20_29 != null, "연령가중"],
      ["자사 GPU", (c) => !!c.ownVgaBase, "4단계 사양"],
      ["자사 CPU", (c) => !!c.ownCpu, "4단계 사양"],
      ["자사 모니터", (c) => !!c.ownMonitorBase, "4단계 사양"],
      ["자사 팀룸", (c) => c.ownTeamRoom != null, "3단계 존구성"],
      ["경쟁점 조사", (c) => (compsBy.get(String(c.candidateCode ?? c.code ?? "")) ?? 0) > 0, "3단계 점유율"],
    ];
    console.log(`\n[후보지 ${cands.length}곳 — 실험실 산식 입력 준비도]`);
    console.log("  항목             갖춘 곳          쓰이는 곳");
    for (const [label, has, where] of need) {
      const n = cands.filter((c) => { try { return has(c); } catch { return false; } }).length;
      const mark = n === cands.length ? "✅" : n === 0 ? "❌" : "⚠️";
      console.log(`  ${mark} ${label.padEnd(14)} ${String(n).padStart(2)}/${cands.length}  ${where}`);
    }
    console.log("\n  ❌ 후보지에 원래 없는 것: 실측 가동률(예측 대상) · QSC(신규점은 점검 기록 없음)");
    console.log("     -> 가동률은 축척을 기존점으로 이미 맞춰 뒀으니 불필요하고,");
    console.log("        QSC는 labInput의 가맹점 평균 경로가 그대로 쓰인다.");
  });

  it("(32) 모니터 채택안 측정 + 대조군", () => {
    const gpu = (t: string | null) => labScoreFromVga(t);
    const rOf = (rs: LabRow[]) => {
      const sc = scoreTextbook(rs, P);
      const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
      return { r: pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual)), mape: sc.mape ?? 0 };
    };
    console.log("\n[모니터] 운영 구간표 -> 실험실 연속 눈금 + 등급 가산");
    line("  운영 구간표 (기준선)", labRows({ useOperationalMonitor: true }));
    line("  실험실 새 표", labRows({}));

    // 위 기울기 훑기 — 240Hz 초과 33개에만 걸린다.
    console.log("\n[앵커 위 기울기] 240Hz 초과 33개(자사 23 · 경쟁 10)에 걸린다");
    for (const su of [0.916, 1.5, 2.29, 3.5]) {
      line(`  위 기울기 ${su.toFixed(3)}`, labRows({ monitorStepUp: su }));
    }

    // 대조군 — GPU·CPU와 **같은 방식**. 낱개 텍스트마다 델타가 붙는다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const cells = [...new Set([
      ...S.flatMap((s) => [s.ownMonitorBase, s.ownMonitorTop]),
      ...C.flatMap((c) => [c.monitorBase, c.monitorTop]),
    ].map((t) => (t ?? "").trim()).filter(Boolean))];
    const keys: string[] = [], deltas: number[] = [];
    for (const t of cells) {
      const a = opMonitorSpec(t), b = labScoreFromMonitorCell(t);
      if (a == null || b == null) continue;
      keys.push(t); deltas.push(b - a);
    }
    const base = rOf(labRows({ useOperationalMonitor: true }));
    const real = rOf(labRows({}));
    const gain = real.r - base.r;
    console.log(`\n[대조군 · 모니터 새 표] 서로 다른 칸 ${keys.length}개에 델타가 붙는다`);
    console.log(`  실제: r ${base.r.toFixed(3)} -> ${real.r.toFixed(3)} (${gain >= 0 ? "+" : ""}${gain.toFixed(3)}) · MAPE ${f(base.mape)}% -> ${f(real.mape)}%`);
    let rng = 20260918;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const gains: number[] = [];
    for (let t = 0; t < 300; t++) {
      const sh = [...deltas];
      for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
      const map = new Map(keys.map((k, i) => [k, sh[i]]));
      // 델타를 칸끼리 뒤섞은 채점기 — 운영 점수 + 남의 델타
      const shuffled = (cell: string | null) => {
        const a = opMonitorSpec(cell);
        if (a == null) return null;
        const d = map.get((cell ?? "").trim());
        return d == null ? a : Math.max(1, Math.min(5, a + d));
      };
      gains.push(rOf(monitorRows(shuffled)).r - base.r);
    }
    const sorted = [...gains].sort((a, b) => a - b);
    const pv = gains.filter((g) => g >= gain).length / gains.length;
    console.log(`  델타를 칸끼리 뒤섞기 300회: 중앙 ${median(gains).toFixed(3)} · 95퍼센타일 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(3)}`);
    console.log(`  p = ${pv.toFixed(3)}  ${pv < 0.05 ? "통과 ✅" : "미달 ❌"}`);
    void gpu;
  });

  /** 운영 방식으로 모니터 칸 하나를 채점 — 칸 전체를 한 번에 본다(Hz를 먼저 평균낸다). */
  const opMonitorSpec = (cell: string | null) => scoreFromMonitor(cell);

  /** 임의의 모니터 **칸 채점기**로 행을 만든다. 대조군에서 델타를 뒤섞기 위한 것. */
  const monitorRows = (cellScore: (t: string | null) => number | null): LabRow[] => {
    const w = settings.specWeights;
    const comb = (vs: (number | null)[]) => {
      const b = vs[0], sp = vs.slice(1).filter((v): v is number => v != null);
      if (b == null) return sp.length ? sp.reduce((a, c) => a + c, 0) / sp.length : null;
      return sp.length ? b * 0.8 + (sp.reduce((a, c) => a + c, 0) / sp.length) * 0.2 : b;
    };
    /** 기본 + 특화 65/35 (기본보다 낮은 특화는 제외) — 운영과 같은 원칙. */
    const mon = (base: string | null, top: string | null) => {
      const b = cellScore(base);
      if (!top || !top.trim()) return b;
      const t = cellScore(top);
      if (t == null || (b != null && t <= b)) return b;
      return b == null ? t : b * 0.65 + t * 0.35;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specOf = (o: any, own: boolean) => {
      if (o == null) return null;
      const g = comb((own ? [o.ownVgaBase, o.ownVgaTop, o.ownVgaTop2] : [o.vgaBase, o.vgaTop, o.vgaTop2]).map((t) => labScoreFromVga(t ?? null)));
      const c = comb((own ? [o.ownCpu, o.ownCpuTop1, o.ownCpuTop2] : [o.cpu, o.cpuTop1, o.cpuTop2]).map((t) => labScoreFromCpu(t ?? null)));
      const ra = scoreFromRamSpec(own ? (o.ownRam ?? null) : (o.ram ?? null), own ? (o.ownRamTop ?? null) : (o.ramTop ?? null));
      const m = mon(own ? (o.ownMonitorBase ?? null) : (o.monitorBase ?? null), own ? (o.ownMonitorTop ?? null) : (o.monitorTop ?? null));
      const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([x]) => x != null) as [number, number][];
      const tw = items.reduce((a, [, x]) => a + x, 0);
      return tw > 0 ? items.reduce((a, [x, y]) => a + x * y, 0) / tw : null;
    };
    return rows.map((r) => {
      const s = storeByCode.get(r.input.storeCode);
      const rl = rivalListOf(r.input.storeCode);
      let i = -1;
      return {
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: specOf(s, true) } : r.input.ownQualityParts,
          rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: specOf(rl[i], false) } } : v; }),
        },
      };
    });
  };

  it("(33) ⚠️ 특화가 기본보다 낮은가 — 울트라와이드 점검 (2026-09-18 사용자 지적)", () => {
    // 사용자: *"특화모델에 165 울트라와이드 WWQHD 모니터 몇점인지 확인하고, 기본사양 FHD 240Hz랑
    //          차이얼만지 비교해보자. ... 특화인데 기본보다 낮은점수 일수도있으니"*
    // 결합 규칙이 "기본보다 낮은 특화는 제외"라, 낮게 나오면 그 특화는 **산식에서 사라진다.**
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[];
    const baseScores = new Map<string, number>();
    for (const s of S) {
      const b = labScoreFromMonitorCell(s.ownMonitorBase ?? null);
      if (b != null) baseScores.set(s.storeCode, b);
    }
    const bs = [...baseScores.values()];
    console.log(`\n[자사 기본] ${bs.length}곳 · 최소 ${Math.min(...bs).toFixed(2)} · 중앙 ${median(bs).toFixed(2)} · 최대 ${Math.max(...bs).toFixed(2)}`);

    // 자사 특화 낱개를 모아 점수와 "자격 여부"를 본다.
    const units = new Map<string, number>();
    for (const s of S) {
      for (const u of String(s.ownMonitorTop ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean)) {
        units.set(u, (units.get(u) ?? 0) + 1);
      }
    }
    const rowsOut = [...units.entries()].map(([t, n]) => ({ t, n, sc: labScoreFromMonitorUnit(t) }))
      .filter((x): x is { t: string; n: number; sc: number } => x.sc != null)
      .sort((a, b) => b.sc - a.sc);
    console.log("\n[자사 특화 낱개] 기본 4.00과 비교 · 낮으면 '제외'된다");
    console.log("  점수   건수  자격   값");
    let excluded = 0;
    for (const { t, n, sc } of rowsOut) {
      const ok = sc > 4.0;
      if (!ok) excluded += n;
      console.log(`  ${sc.toFixed(2)}  ${String(n).padStart(4)}  ${ok ? "  ✅" : "  ❌"}  ${t}`);
    }
    console.log(`\n  ⚠️ 기본(4.00)보다 낮아 제외되는 자사 특화 ${excluded}개`);

    // 아래쪽 기울기를 완만하게 하면 살아나나
    console.log("\n[아래 기울기를 바꾸면] 165Hz 울트라와이드(QHD+0.2 · UW+0.3)가 기본 4.00을 넘나");
    for (const [label, step] of [["0.5108 (240->144 1점 · 지금)", 0.5108], ["0.7662 (0.67점)", 0.7662], ["1.0217 (0.5점)", 1.0217]] as [string, number][]) {
      const hz = (h: number) => 4 + Math.log(h / 240) / step;
      console.log(`  ${label.padEnd(28)} 144Hz ${hz(144).toFixed(2)} · 165Hz ${hz(165).toFixed(2)} · 60Hz ${Math.max(1, hz(60)).toFixed(2)}  ->  UW165 ${(hz(165) + 0.5).toFixed(2)}`);
    }
  });

  it("(34) 모니터 전체 점수표 — 자료에 있는 모든 모니터 (낱개)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const split = (t: unknown) => String(t ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    const own = new Map<string, number>(), riv = new Map<string, number>();
    for (const s of S) for (const u of [...split(s.ownMonitorBase), ...split(s.ownMonitorTop)]) own.set(u, (own.get(u) ?? 0) + 1);
    for (const c of C) for (const u of [...split(c.monitorBase), ...split(c.monitorTop)]) riv.set(u, (riv.get(u) ?? 0) + 1);
    const keys = [...new Set([...own.keys(), ...riv.keys()])]
      .map((t) => ({ t, o: own.get(t) ?? 0, r: riv.get(t) ?? 0, nw: labScoreFromMonitorUnit(t), old: scoreFromMonitor(t) }))
      .sort((a, b) => (b.nw ?? -1) - (a.nw ?? -1));
    console.log(`\n[모니터 전체 점수표] 낱개 ${keys.length}종 · 새 점수 내림차순`);
    console.log("   운영  ->  새로   자사  경쟁   값");
    for (const k of keys) {
      const d = k.old != null && k.nw != null && Math.abs(k.nw - k.old) >= 0.005 ? ` (${k.nw > k.old ? "+" : ""}${(k.nw - k.old).toFixed(2)})` : "";
      console.log(`  ${(k.old == null ? " - " : k.old.toFixed(2)).padStart(5)}  -> ${(k.nw == null ? " - " : k.nw.toFixed(2)).padStart(5)}   ${String(k.o).padStart(4)}  ${String(k.r).padStart(4)}   ${k.t}${d}`);
    }
  });

  it("(15) CPU가 나빠진 건 순서인가 수준인가", () => {
    // 새 CPU 표는 경쟁점을 크게 올린다(12400F 41건 +1.30 · 11400F +1.63 · 10400F +1.04).
    // 축척은 **독점매장에서만** 맞추므로(textbookModel calibrationTarget) 이 수준 이동은
    // 축척이 안 먹어주고 MAPE에 그대로 찍힌다. 그래서 수준을 도로 맞춘 뒤 다시 본다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const C = rivals as any[];
    const oldAvg = mean(C.map((c) => scoreFromCpu(c.cpu ?? null)).filter((v): v is number => v != null));
    const newAvg = mean(C.map((c) => labScoreFromCpu(c.cpu ?? null)).filter((v): v is number => v != null));
    const shift = newAvg - oldAvg;
    console.log(`\n[CPU 수준] 경쟁점 CPU 평균 ${oldAvg.toFixed(3)} -> ${newAvg.toFixed(3)} (+${shift.toFixed(3)})`);
    line("운영 변환표 (기준선)", opRows);
    line("새 CPU 표", rowsWithScorers(scoreFromVga, (t) => labScoreFromCpu(t)));
    line("새 CPU 표 · 수준 되돌림", rowsWithScorers(scoreFromVga, (t) => {
      const v = labScoreFromCpu(t);
      return v == null ? null : Math.max(1, Math.min(5, v - shift));
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[];
    const oOld = mean(S.map((s) => scoreFromCpu(s.ownCpu ?? null)).filter((v): v is number => v != null));
    const oNew = mean(S.map((s) => labScoreFromCpu(s.ownCpu ?? null)).filter((v): v is number => v != null));
    console.log(`  (자사 CPU 평균은 ${oOld.toFixed(3)} -> ${oNew.toFixed(3)} · 경쟁점이 ${(shift - (oNew - oOld)).toFixed(3)}점 더 올랐다)`);
  });

  it("(16) 대조군 — 성능지수만 썼을 때 (세대 벌점 0) · 2026-09-18 1차", () => {
    // 표를 바꾸면 모델마다 점수가 얼마씩 움직인다. **그 움직임의 크기는 그대로 두고 어느 모델에
    // 붙는지만 뒤섞어** 본다. 새 표가 "실제 서열을 맞혔다"면 뒤섞은 것보다 나아야 한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = rivals as any[];
    const texts = [...new Set([
      ...S.flatMap((s) => [s.ownVgaBase, s.ownVgaTop, s.ownVgaTop2]),
      ...C.flatMap((c) => [c.vgaBase, c.vgaTop, c.vgaTop2]),
    ].map((t) => (t ?? "").trim()).filter(Boolean))];
    const deltas: number[] = [], keys: string[] = [];
    for (const t of texts) {
      const a = scoreFromVga(t), b = labScoreFromVga(t, LAB_GPU_PERF_INDEX, LAB_PERF_LOG_STEP_UP, 0);
      if (a == null || b == null) continue;
      keys.push(t); deltas.push(b - a);
    }
    const rOf = (rs: LabRow[]) => {
      const sc = scoreTextbook(rs, P);
      const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
      return { r: pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual)), mape: sc.mape ?? 0 };
    };
    const base = rOf(opRows);
    const real = rOf(rowsWithScorers((t) => labScoreFromVga(t, LAB_GPU_PERF_INDEX, LAB_PERF_LOG_STEP_UP, 0), scoreFromCpu));
    const gain = real.r - base.r;
    console.log(`\n[대조군 · 새 GPU 표] 서로 다른 모델 ${keys.length}종에 델타가 붙는다`);
    console.log(`  실제: r ${base.r.toFixed(3)} -> ${real.r.toFixed(3)} (좋아진 폭 ${gain.toFixed(3)}) · MAPE ${f(base.mape)}% -> ${f(real.mape)}%`);
    let rng = 20260918;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const gains: number[] = [];
    for (let t = 0; t < 300; t++) {
      const sh = [...deltas];
      for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
      const map = new Map(keys.map((k, i) => [k, sh[i]]));
      const scorer = (text: string | null) => {
        const a = scoreFromVga(text);
        if (a == null) return null;
        const d = map.get((text ?? "").trim());
        return d == null ? a : Math.max(1, Math.min(5, a + d));
      };
      gains.push(rOf(rowsWithScorers(scorer, scoreFromCpu)).r - base.r);
    }
    const sorted = [...gains].sort((a, b) => a - b);
    const pv = gains.filter((g) => g >= gain).length / gains.length;
    console.log(`  델타를 모델끼리 뒤섞기 300회: 중앙 ${median(gains).toFixed(3)} · 95퍼센타일 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(3)}`);
    console.log(`  p = ${pv.toFixed(3)}  ${pv < 0.05 ? "통과 ✅" : "미달 ❌"}`);
  });

  it("(13) 새 변환표 대조 — 모든 값이 표에 걸리나, 점수가 어떻게 움직이나", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = (rivals as any[]);
    const compare = (
      label: string,
      ownVals: (string | null)[], rivalVals: (string | null)[],
      oldS: (t: string | null) => number | null,
      newS: (t: string | null) => number | null,
      key: (t: string | null) => string | null,
      table: Record<string, number>,
    ) => {
      const tally = (vals: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const v of vals) { const k = (v ?? "").trim(); if (!k) continue; m.set(k, (m.get(k) ?? 0) + 1); }
        return m;
      };
      const o = tally(ownVals), r = tally(rivalVals);
      const keys = [...new Set([...o.keys(), ...r.keys()])].sort((a, b) => (newS(b) ?? -1) - (newS(a) ?? -1));
      console.log(`\n[${label} 변환표 대조]  ⚠️ = 표에 없어 세대 산술로 떨어진 값`);
      console.log("   지금  ->  새로   자사  경쟁   값");
      let missing = 0;
      for (const k of keys) {
        const inTable = key(k) != null && table[key(k)!] != null;
        if (!inTable) missing += (o.get(k) ?? 0) + (r.get(k) ?? 0);
        const a = oldS(k), b = newS(k);
        const diff = a != null && b != null && Math.abs(b - a) >= 0.005 ? ` (${b > a ? "+" : ""}${(b - a).toFixed(2)})` : "";
        console.log(`  ${(a == null ? " - " : a.toFixed(2)).padStart(5)}  -> ${(b == null ? " - " : b.toFixed(2)).padStart(5)}   ${String(o.get(k) ?? 0).padStart(4)}  ${String(r.get(k) ?? 0).padStart(4)}   ${inTable ? "  " : "⚠️"} ${k}${diff}`);
      }
      console.log(`  표에 없는 값 ${missing}건`);
    };
    compare("GPU",
      S.flatMap((s) => [s.ownVgaBase, s.ownVgaTop, s.ownVgaTop2]), C.flatMap((c) => [c.vgaBase, c.vgaTop, c.vgaTop2]),
      scoreFromVga, (t) => labScoreFromVga(t), labGpuKey, LAB_GPU_PERF_INDEX);
    compare("CPU",
      S.flatMap((s) => [s.ownCpu, s.ownCpuTop1, s.ownCpuTop2]), C.flatMap((c) => [c.cpu, c.cpuTop1, c.cpuTop2]),
      scoreFromCpu, (t) => labScoreFromCpu(t), labCpuKey, LAB_CPU_PERF_INDEX);
  });

  it("(12) 원자료 전수 — 기본·특화 칸을 다 합쳐서 어떤 물건이 몇 건인가", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = (rivals as any[]);
    const dump = (label: string, ownVals: (string | null)[], rivalVals: (string | null)[], scorer: (t: string | null) => number | null) => {
      const tally = (vals: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const v of vals) { const k = (v ?? "").trim(); if (!k) continue; m.set(k, (m.get(k) ?? 0) + 1); }
        return m;
      };
      const o = tally(ownVals), r = tally(rivalVals);
      const keys = [...new Set([...o.keys(), ...r.keys()])]
        .sort((a, b) => (scorer(b) ?? -1) - (scorer(a) ?? -1) || (r.get(b) ?? 0) + (o.get(b) ?? 0) - ((r.get(a) ?? 0) + (o.get(a) ?? 0)));
      console.log(`\n[${label}] 기본+특화 전부 · 점수 높은 순`);
      console.log("   점수   자사  경쟁   값");
      for (const k of keys) {
        const sc = scorer(k);
        console.log(`  ${(sc == null ? " -  " : sc.toFixed(2)).padStart(5)}  ${String(o.get(k) ?? 0).padStart(4)}  ${String(r.get(k) ?? 0).padStart(4)}   ${k}`);
      }
    };
    dump("GPU", S.flatMap((s) => [s.ownVgaBase, s.ownVgaTop, s.ownVgaTop2]), C.flatMap((c) => [c.vgaBase, c.vgaTop, c.vgaTop2]), scoreFromVga);
    dump("CPU", S.flatMap((s) => [s.ownCpu, s.ownCpuTop1, s.ownCpuTop2]), C.flatMap((c) => [c.cpu, c.cpuTop1, c.cpuTop2]), scoreFromCpu);
    dump("RAM", S.flatMap((s) => [s.ownRam, s.ownRamTop]), C.flatMap((c) => [c.ram, c.ramTop]), scoreFromRam);
  });

  it("(11) 모니터 — 특화 칸이 비대칭인가 (존구성 이름표와 같은 종류인지)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = stores as any[], C = (rivals as any[]);
    const oBase = S.filter((s) => s.ownMonitorBase), oTop = oBase.filter((s) => s.ownMonitorTop);
    const cBase = C.filter((c) => c.monitorBase), cTop = cBase.filter((c) => c.monitorTop);
    console.log(`\n[모니터 특화 채움률] 기본이 적힌 곳 중에서`);
    console.log(`  자사   ${oTop.length}/${oBase.length} (${((oTop.length / oBase.length) * 100).toFixed(0)}%)`);
    console.log(`  경쟁점 ${cTop.length}/${cBase.length} (${((cTop.length / cBase.length) * 100).toFixed(0)}%)`);
    const lift = (base: number | null, full: number | null) => (base == null || full == null ? null : full - base);
    const oLift = S.map((s) => lift(scoreFromMonitor(s.ownMonitorBase ?? null), scoreFromMonitorSpec(s.ownMonitorBase ?? null, s.ownMonitorTop ?? null))).filter((v): v is number => v != null);
    const cLift = C.map((c) => lift(scoreFromMonitor(c.monitorBase ?? null), scoreFromMonitorSpec(c.monitorBase ?? null, c.monitorTop ?? null))).filter((v): v is number => v != null);
    console.log(`\n[특화가 올린 폭] 자사 평균 +${mean(oLift).toFixed(3)}점 · 경쟁점 평균 +${mean(cLift).toFixed(3)}점`);
    const oB = S.map((s) => scoreFromMonitor(s.ownMonitorBase ?? null)).filter((v): v is number => v != null);
    const cB = C.map((c) => scoreFromMonitor(c.monitorBase ?? null)).filter((v): v is number => v != null);
    console.log(`  기본만: 자사 평균 ${mean(oB).toFixed(3)} · 경쟁점 ${mean(cB).toFixed(3)}  (격차 ${(mean(oB) - mean(cB)).toFixed(3)})`);
    const oF = S.map((s) => scoreFromMonitorSpec(s.ownMonitorBase ?? null, s.ownMonitorTop ?? null)).filter((v): v is number => v != null);
    const cF = C.map((c) => scoreFromMonitorSpec(c.monitorBase ?? null, c.monitorTop ?? null)).filter((v): v is number => v != null);
    console.log(`  특화까지: 자사 평균 ${mean(oF).toFixed(3)} · 경쟁점 ${mean(cF).toFixed(3)}  (격차 ${(mean(oF) - mean(cF)).toFixed(3)})`);
    console.log(`  자사 기본 값 가짓수 ${new Set(oB).size}가지 · 경쟁점 ${new Set(cB).size}가지`);

    // 변형: 특화를 양쪽 다 무시하고 **기본만** 쓴다 (조사 성실도 차이를 지운다)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specOf3 = (o: any, own: boolean, baseOnly: boolean) => {
      const w = settings.specWeights;
      const g = own ? scoreFromVgaSpec(o?.ownVgaBase ?? null, o?.ownVgaTop ?? null, o?.ownVgaTop2 ?? null) : scoreFromVgaSpec(o?.vgaBase ?? null, o?.vgaTop ?? null, o?.vgaTop2 ?? null);
      const c = own ? scoreFromCpuSpec(o?.ownCpu ?? null, o?.ownCpuTop1 ?? null, o?.ownCpuTop2 ?? null) : scoreFromCpuSpec(o?.cpu ?? null, o?.cpuTop1 ?? null, o?.cpuTop2 ?? null);
      const ra = own ? scoreFromRamSpec(o?.ownRam ?? null, o?.ownRamTop ?? null) : scoreFromRamSpec(o?.ram ?? null, o?.ramTop ?? null);
      const mBase = own ? (o?.ownMonitorBase ?? null) : (o?.monitorBase ?? null);
      const mTop = own ? (o?.ownMonitorTop ?? null) : (o?.monitorTop ?? null);
      const m = baseOnly ? scoreFromMonitor(mBase) : scoreFromMonitorSpec(mBase, mTop);
      const items = [[g, w.vga], [m, w.monitor], [ra, w.ram], [c, w.cpu]].filter(([s]) => s != null) as [number, number][];
      const tw = items.reduce((a, [, x]) => a + x, 0);
      return tw > 0 ? items.reduce((a, [s, x]) => a + s * x, 0) / tw : null;
    };
    const storeByCode = new Map(S.map((s) => [s.storeCode, s]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rivalList = (code: string) => (compsByCode.get(code) ?? []).filter((c: any) => c.investigationStatus !== "경쟁점없음").filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
    const build = (baseOnly: boolean): LabRow[] => rows.map((r) => {
      const s = storeByCode.get(r.input.storeCode);
      const rl = rivalList(r.input.storeCode);
      let i = -1;
      return {
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, spec: specOf3(s, true, baseOnly) } : r.input.ownQualityParts,
          rivals: (r.input.rivals ?? []).map((v) => { i += 1; return v.parts ? { ...v, parts: { ...v.parts, spec: specOf3(rl[i], false, baseOnly) } } : v; }),
        },
      };
    });
    console.log("");
    line("재현 확인 (특화 포함)", build(false));
    line("모니터 기본만 (특화 무시)", build(true));
  });

  it("(8) 하위항목 기여 — GPU·모니터·CPU·RAM 하나씩 꺼본다", () => {
    const w = settings.specWeights;
    console.log(`\n[하위항목] 하나씩 비중 0으로 돌리고 나머지로 재정규화`);
    line("실험실 기본", rows);
    for (const k of ["vga", "monitor", "cpu", "ram"] as const) {
      const s2 = { ...settings, specWeights: { ...w, [k]: 0 } };
      const r2 = buildLabRows({ stores, compsByCode, utilByStore, settings: s2, qscByStoreCode });
      line(`${k} 뺌`, r2);
    }
  });
});
