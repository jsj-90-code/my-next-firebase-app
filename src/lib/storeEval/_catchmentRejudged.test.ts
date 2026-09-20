// 유효 상권 재검정 — **사람이 지도로 폐업을 걸러낸 자료**로 (2026-09-20 밤)
//
// ── 무엇이 달라졌나 ───────────────────────────────────────────────────────
// `_catchment.test.ts`는 *"2km 안에 대체 PC방이 없다"*를 기각했는데, 그 근거 자료
// (`kakao-neighborhood.json`)에 **폐업이 섞여 있었다.** 사용자가 문경시청점을 지도로
// 대조해 7곳 중 3곳(43%)이 폐업인 걸 잡아냈다.
//
// 2026-09-20 밤에 사용자가 `docs/review-needed/`의 표로 **92행을 직접 판정했다**
// (A등급 19개 매장). 그 결과를 넣고 다시 돌린다.
//
//   판정 92행 중 **폐업 25행 — 오염률 27.2%**
//
// ── ⚠️⚠️ 관문은 `_catchment.test.ts` 머리에 사전 등록된 것을 **그대로 쓴다** ──
// 고치지 않는다. 자료가 바뀌었다고 기준을 같이 바꾸면 시험이 아니다.
//
//   관문 1. 문경·양주덕정을 **빼고도** 되는가   (제일 중요)
//   관문 2. 인구를 통제해도 남는가
//   관문 4. 예측 방향 — 대체 PC방이 **적을수록** 과소예측 = 부호오차와 **양의 상관**
//
// ── ⚠️⚠️ 판정이 **일부만** 끝났다. 그래서 세 가지로 본다 ────────────────────
// 판정한 건 희소 매장(500m 밖 10곳 이하) 19곳뿐이고, 조밀한 매장은 **한 행도 안 봤다.**
// 그대로 섞으면 **판정한 매장만 대체재가 줄어** 희소-조밀 차이가 인위적으로 벌어진다.
// 가설이 사는 쪽만 깎아내리는 셈이라 **가설에 유리한 편향**이다. 그래서 갈라 본다.
//
//   (가) 전체 38곳 · 부분 보정    <- 편향됨. 방향만 참고
//   (나) **판정이 끝난 매장만**    <- 깨끗하다. **이게 본 검정이다**
//   (다) 민감도 — 미판정 행에 관측 폐업률 27.2%를 무작위로 먹여 500번
//
// ⚠️ **측정만 한다.** 관문을 넘어도 채택하지 않는다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_catchmentRejudged.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const NBR_FILE = ".local-tools/kakao-neighborhood.json";
const JUDGE_FILE = ".local-tools/rival-judgments.json";
const describeIf = hasValidationSnapshot() && existsSync(NBR_FILE) && existsSync(JUDGE_FILE) ? describe : describe.skip;

const CLUSTER_M = 500;
const SELF_M = 30;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "     -" : `${(v * 100).toFixed(d)}%`.padStart(7));
const num = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: 0 }));

const rank = (v: number[]) => {
  const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array(v.length).fill(0);
  idx.forEach(([, i], k) => { out[i] = k; });
  return out;
};
const pear = (a: number[], b: number[]) => {
  const n = a.length;
  if (n < 3) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let s = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? s / Math.sqrt(da * db) : 0;
};
const spear = (a: number[], b: number[]) => pear(rank(a), rank(b));
const partial = (a: number[], b: number[], c: number[]) => {
  const rab = spear(a, b), rac = spear(a, c), rbc = spear(b, c);
  const den = Math.sqrt((1 - rac * rac) * (1 - rbc * rbc));
  return den > 1e-9 ? (rab - rac * rbc) / den : 0;
};
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
/** `_catchment.test.ts`와 **같은** t·임계값을 쓴다. 기준을 바꾸지 않는다. */
const tOf = (r: number, n: number, k = 0) => Math.abs(r) * Math.sqrt((n - 2 - k) / Math.max(1e-9, 1 - r * r));
const crit = (n: number) => (n > 40 ? 2.02 : n > 30 ? 2.03 : n > 25 ? 2.06 : n > 20 ? 2.09 : 2.13);
const line = (label: string, r: number, n: number, k = 0) => {
  const t = tOf(r, n, k);
  return `${label.padEnd(26)} r = ${r.toFixed(3).padStart(6)}  n=${String(n).padStart(2)}  t = ${t.toFixed(2).padStart(5)} (선 ${crit(n)})  ${t > crit(n) ? "**유의**" : "  -"}`;
};

describeIf("유효 상권 재검정 — 폐업을 걸러낸 뒤", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const comps: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, comps, snap.locationEvaluations, settings);
  const byCode = new Map<string, Competitor[]>();
  for (const c of comps) byCode.set(c.candidateCode, [...(byCode.get(c.candidateCode) ?? []), c]);
  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const d of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = d.storeCode ?? d.id;
    if (code) qscSites.set(code, d);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const s = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(s)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscBy = new Map<string, number>();
  for (const [c, s] of qscSites) {
    const a = qscInWindowAverage(s.records ?? [], s.openedAt ?? null);
    if (a != null) qscBy.set(c, a);
  }
  const rows: LabRow[] = buildLabRows({
    stores, compsByCode: byCode, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores),
    settings, qscByStoreCode: qscBy,
  });
  const score = scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);

  type Doc = { name: string | null; category: string | null; lat: number; lng: number; distanceM: number | null };
  const nbr = JSON.parse(readFileSync(NBR_FILE, "utf8")) as {
    sites: Record<string, { code?: string | number; name?: string; pcRooms?: { docs?: Doc[]; truncated?: boolean } }>;
  };
  const nbrByCode = new Map<string, { docs: Doc[]; truncated: boolean }>();
  for (const s of Object.values(nbr.sites ?? {})) {
    if (s.code == null) continue;
    nbrByCode.set(String(s.code), { docs: s.pcRooms?.docs ?? [], truncated: !!s.pcRooms?.truncated });
  }
  const judged = JSON.parse(readFileSync(JUDGE_FILE, "utf8")) as { judgments: Record<string, string> };
  const J = new Map(Object.entries(judged.judgments ?? {}));

  const isPc = (d: Doc) => (d.category ?? "").includes("PC방");
  const keyOf = (code: string, d: Doc) => `${code}|${d.lat.toFixed(6)},${d.lng.toFixed(6)}`;

  type Probe = {
    name: string; code: string; signed: number | null; req: number | null;
    pop1km: number | null;
    before: number; after: number;
    nearBefore: number; nearAfter: number;
    judgedRows: number; totalOutside: number; closed: number;
    complete: boolean;
    outsideDocs: Doc[];
  };
  const probes: Probe[] = [];
  for (const r of rows) {
    const nb = nbrByCode.get(r.input.storeCode);
    if (!nb) continue;
    const x = score.rows.find((y) => y.storeCode === r.input.storeCode);
    const others = nb.docs.filter(isPc).filter((d) => (d.distanceM ?? 9e9) > SELF_M);
    const out = others.filter((d) => (d.distanceM ?? 9e9) > CLUSTER_M);
    const marks = out.map((d) => J.get(keyOf(r.input.storeCode, d)) ?? null);
    const kept = out.filter((_, i) => marks[i] !== "폐업");
    probes.push({
      name: r.input.storeName ?? r.input.storeCode,
      code: r.input.storeCode,
      signed: x?.predicted != null && x.actual > 0 ? (x.predicted - x.actual) / x.actual : null,
      req: x?.requiredShare ?? null,
      pop1km: r.input.pop1km ?? null,
      before: out.length, after: kept.length,
      nearBefore: out.length ? Math.min(...out.map((d) => d.distanceM ?? 2000)) : 2000,
      nearAfter: kept.length ? Math.min(...kept.map((d) => d.distanceM ?? 2000)) : 2000,
      judgedRows: marks.filter((m) => m != null).length,
      totalOutside: out.length,
      closed: marks.filter((m) => m === "폐업").length,
      // 판정이 **끝난** 매장 = 500m 밖 행이 전부 판정됐거나, 애초에 0행이다
      complete: out.length === 0 || marks.every((m) => m != null),
      outsideDocs: out,
    });
  }

  const TWO = /문경시청|양주덕정/;
  const usable = probes.filter((p) => p.signed != null && p.pop1km != null);
  const complete = usable.filter((p) => p.complete);

  it("(1) 판정이 바꾼 것", () => {
    expect(probes.length).toBeGreaterThan(30);
    const tot = probes.reduce((s, p) => s + p.judgedRows, 0);
    const cl = probes.reduce((s, p) => s + p.closed, 0);
    console.log(`\n══ 사람 판정 반영 ══`);
    console.log(`  판정된 행 ${tot} · 그중 폐업 ${cl} — **오염률 ${((cl / tot) * 100).toFixed(1)}%**`);
    console.log(`  판정이 끝난 매장 ${probes.filter((p) => p.complete).length}곳 / ${probes.length}곳`);
    console.log(`\n  매장           대체재 전->후   최단 전->후          부호오차`);
    for (const p of probes.filter((x) => x.before !== x.after || TWO.test(x.name)).sort((a, b) => a.after - b.after)) {
      console.log(
        `  ${p.name.padEnd(13)}${String(p.before).padStart(6)} -> ${String(p.after).padStart(2)}` +
        `${`${p.nearBefore}m`.padStart(9)} -> ${`${p.nearAfter}m`.padStart(6)}   ${pct(p.signed)}${TWO.test(p.name) ? "   <-" : ""}`,
      );
    }
    const zero = probes.filter((p) => p.after === 0);
    console.log(`\n  📌 **500m 밖 대체재가 0곳인 매장: ${zero.length}곳** — ${zero.map((z) => z.name).join(" · ")}`);
    console.log(`     보정 전에는 ${probes.filter((p) => p.before === 0).length}곳이었다.`);
  });

  it("(2) ⭐ 관문 1·2 — 세 가지 판으로", () => {
    const run = (label: string, g: Probe[], useAfter: boolean) => {
      if (g.length < 5) { console.log(`  [${label}] n=${g.length} — 너무 적다`); return null; }
      const y = g.map((p) => p.signed as number);
      const xOut = g.map((p) => (useAfter ? p.after : p.before));
      const xNear = g.map((p) => (useAfter ? p.nearAfter : p.nearBefore));
      const xPop = g.map((p) => p.pop1km as number);
      console.log(`  [${label}] n=${g.length}`);
      console.log(`    ${line("대체 PC방 수", spear(xOut, y), g.length)}`);
      console.log(`    ${line("최단 대체재 거리", spear(xNear, y), g.length)}`);
      console.log(`    ${line("대체PC방 | 인구 통제", partial(xOut, y, xPop), g.length, 1)}`);
      return { r: spear(xOut, y), rp: partial(xOut, y, xPop) };
    };

    console.log(`\n══ 예측 방향: 대체 PC방이 **적을수록** 과소예측 -> **양의 상관** ══`);

    console.log(`\n─ (가) 전체 ${usable.length}곳 · 부분 보정 (⚠️ 가설에 유리하게 편향됨) ─`);
    console.log("  [보정 전]");
    run("보정 전 전체", usable, false);
    console.log("  [보정 후]");
    run("보정 후 전체", usable, true);
    console.log("  [보정 후 · 두 곳 뺌 = 관문 1]");
    const a1 = run("보정 후 두 곳 뺌", usable.filter((p) => !TWO.test(p.name)), true);

    console.log(`\n─ (나) ⭐ **판정이 끝난 ${complete.length}곳만** · 깨끗한 판 ─`);
    console.log("  [보정 전]");
    run("보정 전", complete, false);
    console.log("  [보정 후]");
    const b0 = run("보정 후", complete, true);
    console.log("  [보정 후 · 두 곳 뺌 = 관문 1]");
    const b1 = run("보정 후 두 곳 뺌", complete.filter((p) => !TWO.test(p.name)), true);

    console.log(`\n[판정 — 사전 등록한 관문 그대로]`);
    const ok = (v: { r: number; rp: number } | null, n: number) =>
      v != null && v.r > 0 && tOf(v.r, n) > crit(n);
    const nComplete = complete.filter((p) => !TWO.test(p.name)).length;
    const nAll = usable.filter((p) => !TWO.test(p.name)).length;
    console.log(`  (가) 전체 · 관문 1(두 곳 뺌)    ${ok(a1, nAll) ? "통과" : "⛔ 미달"}`);
    console.log(`  (나) 깨끗한 판 · 관문 1         ${ok(b1, nComplete) ? "통과" : "⛔ 미달"}`);
    console.log(`  (나) 깨끗한 판 · 관문 2(인구)   ${b0 != null && b0.rp > 0 && tOf(b0.rp, complete.length, 1) > crit(complete.length) ? "통과" : "⛔ 미달"}`);
    console.log(`\n  ⚠️ **(나)가 본 검정이다.** (가)는 판정한 매장만 대체재가 줄어 희소-조밀 차이가`);
    console.log(`     인위적으로 벌어진 판이라, 유의하게 나와도 그게 근거가 될 수 없다.`);
  });

  it("(3) 민감도 — 미판정 행에 관측 폐업률을 먹여 본다", () => {
    // 아직 안 본 행에도 같은 비율(관측 27.2%)로 폐업이 섞여 있다고 보면 어떻게 되나.
    // 무작위라 500번 돌려 분포를 본다. 이게 (가)의 편향을 대략 상쇄한다.
    const tot = probes.reduce((s, p) => s + p.judgedRows, 0);
    const cl = probes.reduce((s, p) => s + p.closed, 0);
    const rate = cl / tot;
    let seed = 20260920;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const rs: number[] = [], rs2: number[] = [];
    const g = usable, g2 = usable.filter((p) => !TWO.test(p.name));
    for (let i = 0; i < 500; i++) {
      const sim = (arr: Probe[]) => arr.map((p) => {
        let n = p.after;
        const unjudged = p.totalOutside - p.judgedRows;
        for (let k = 0; k < unjudged; k++) if (rnd() < rate) n--;
        return n;
      });
      rs.push(spear(sim(g), g.map((p) => p.signed as number)));
      rs2.push(spear(sim(g2), g2.map((p) => p.signed as number)));
    }
    rs.sort((a, b) => a - b); rs2.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
    console.log(`\n══ (3) 민감도 — 미판정 행에도 폐업률 ${(rate * 100).toFixed(1)}%를 먹인다 (500번) ══`);
    console.log(`  전체 ${g.length}곳      r 중앙 ${q(rs, 0.5).toFixed(3)}  (5~95분위 ${q(rs, 0.05).toFixed(3)} ~ ${q(rs, 0.95).toFixed(3)})`);
    console.log(`  두 곳 뺀 ${g2.length}곳   r 중앙 ${q(rs2, 0.5).toFixed(3)}  (5~95분위 ${q(rs2, 0.05).toFixed(3)} ~ ${q(rs2, 0.95).toFixed(3)})`);
    console.log(`  관문 1을 넘으려면 r > 0이고 t > ${crit(g2.length)} — 즉 r > ${(crit(g2.length) / Math.sqrt(g2.length - 2 + crit(g2.length) ** 2)).toFixed(3)} 쯤이어야 한다`);
  });

  it("(5) ⭐ 더 판정하면 결론이 갈리나 — 사람 품을 더 쓸 값이 있나", () => {
    // 관문 1의 알맹이는 **"0~2곳 무리에 문경·양주덕정 말고 몇 곳이 있나"**다.
    // 지금 2곳뿐이라 검정력이 없다. 그러면 더 판정해서 그 무리를 늘릴 수 있나?
    const tot = probes.reduce((s, p) => s + p.judgedRows, 0);
    const cl = probes.reduce((s, p) => s + p.closed, 0);
    const rate = cl / tot;
    const un = usable.filter((p) => p.judgedRows < p.totalOutside);
    console.log(`\n══ (5) 남은 판정이 결론을 바꿀 수 있나 ══`);
    console.log(`  아직 판정 안 한 매장 ${un.length}곳 · ${un.reduce((s, p) => s + (p.totalOutside - p.judgedRows), 0)}행`);
    console.log(`\n  매장           지금  관측폐업률(${(rate * 100).toFixed(0)}%)이면  0~2에 들려면 필요한 폐업률`);
    const need: string[] = [];
    for (const p of [...un].sort((a, b) => a.after - b.after).slice(0, 6)) {
      const unj = p.totalOutside - p.judgedRows;
      const expect = Math.round(p.after - unj * rate);
      const req = unj > 0 ? (p.after - 2) / unj : 0;
      console.log(
        `  ${p.name.padEnd(13)}${String(p.after).padStart(5)}${String(Math.max(0, expect)).padStart(14)}곳` +
        `${`${(req * 100).toFixed(0)}%`.padStart(22)}${req <= rate ? "   <- 들어올 만하다" : ""}`,
      );
      if (req <= rate) need.push(p.name);
    }
    console.log(`\n  📌 **관측 폐업률에서 0~2 무리에 새로 들어올 매장: ${need.length ? need.join(", ") : "없다"}**`);
    console.log(`     제일 적은 미판정 매장이 ${Math.min(...un.map((p) => p.after))}곳인데, 거기서 2곳까지 내려가려면`);
    console.log(`     폐업률이 ${(((Math.min(...un.map((p) => p.after)) - 2) / Math.min(...un.map((p) => p.totalOutside - p.judgedRows))) * 100).toFixed(0)}%는 돼야 한다. 관측은 ${(rate * 100).toFixed(1)}%다.`);
    console.log(`\n  ⛔ **더 판정해도 이 검정은 거의 확실히 안 갈린다.** 관문 1은 검정력이 없는 채로 남는다.`);
    console.log(`     이건 판정을 더 해서 풀 문제가 아니라 **표본이 더 필요한 문제**다 —`);
    console.log(`     '대체재가 없는 매장'이 지금 3곳뿐이라, 새 매장이 쌓여야 갈린다.`);
    console.log(`\n  📌 그래도 사장님 판정은 헛되지 않았다:`);
    console.log(`     1) 오염률 ${(rate * 100).toFixed(1)}%를 **실제로 확인**했다(추측이 아니다).`);
    console.log(`     2) 보정하니 신호가 **세졌다** — 최단거리 r −0.473 → −0.556.`);
    console.log(`     3) 양주덕정의 500m 밖 대체재가 **진짜로 0곳**임이 확인됐다(사장님 원래 관찰).`);
  });

  it("(4) 대체재 0~2곳 무리 — 보정 뒤에 누가 들어왔나", () => {
    console.log(`\n══ (4) 대체재로 갈라서 (보정 후) ══`);
    console.log(`    ${"구간".padEnd(14)}${"곳수".padStart(5)}${"부호오차 중앙".padStart(14)}${"필요점유율 중앙".padStart(15)}${"주거1km 중앙".padStart(13)}`);
    const buckets: [string, (p: Probe) => boolean][] = [
      ["대체재 0~2곳", (p) => p.after <= 2],
      ["3~7곳", (p) => p.after > 2 && p.after <= 7],
      ["8~19곳", (p) => p.after > 7 && p.after <= 19],
      ["20곳 이상", (p) => p.after > 19],
    ];
    for (const [label, f] of buckets) {
      const g = usable.filter(f);
      if (!g.length) continue;
      console.log(`    ${label.padEnd(14)}${String(g.length).padStart(5)}${pct(med(g.map((p) => p.signed as number))).padStart(14)}` +
        `${pct(med(g.map((p) => p.req).filter((v): v is number => v != null))).padStart(15)}` +
        `${num(med(g.map((p) => p.pop1km).filter((v): v is number => v != null))).padStart(13)}`);
    }
    const g0 = usable.filter((p) => p.after <= 2);
    console.log(`\n  0~2곳 무리: ${g0.map((p) => `${p.name}(${p.after})`).join(" · ")}`);
    const g0x = g0.filter((p) => !TWO.test(p.name));
    console.log(`  두 곳 뺀 0~2곳 ${g0x.length}곳: ${g0x.map((p) => `${p.name} ${pct(p.signed)}`).join(" · ")}`);
    console.log(`\n  ⚠️ 관문 1의 알맹이가 이 줄이다 — 문경·양주덕정을 빼고 남은 곳들이`);
    console.log(`     **같은 방향(과소예측 = 음수)**을 보이는가.`);
  });
});
