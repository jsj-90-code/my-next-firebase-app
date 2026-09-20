// 시장이 깐 PC 대수로 수요를 다시 읽는다 (2026-09-20 밤, 무인작업)
//
// ══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 사전 등록 — **자료를 보기 전에** 정한 판정 기준이다. 고치지 말 것.
// ══════════════════════════════════════════════════════════════════════════
//
// ── 착안 ──────────────────────────────────────────────────────────────────
// 문경시청점을 파다 나왔다. 우리 수요식은 문경 상권의 수요를 **1,666명**으로 센다.
// 그런데 그 동네에는 **우리 98대 + 경쟁 3곳 258대 = 356대**가 실제로 깔려 있다
// (전부 360~440m, 그래서 `effectiveRadiusM: 300` 밖이라 점유율 분모에는 안 들어간다).
//
// **경쟁점 PC 대수는 우리 매출과 무관한 독립 관측치다.** 남이 자기 돈으로 깐 설비다.
// 장사가 안 되는 동네에 356대를 깔아 두고 버틸 수는 없다. 그러니
//
//   시장 PC 대수 ÷ 우리가 센 수요
//
// 가 유난히 큰 매장은 **우리가 그 동네 수요를 작게 센 것**이다.
//
// ── 예측 방향 (먼저 못 박는다) ────────────────────────────────────────────
//   이 비가 클수록 수요를 작게 센 것 -> **과소예측**
//   과녁 log(필요÷예측)과 **양의 상관**이어야 한다. 음수면 가설과 반대다.
//
// ── ⚠️ 부분 순환이 있다. 그래서 두 벌로 잰다 ──────────────────────────────
// 예측 점유율의 분모에 **유효거리(300m) 안 경쟁 IP**가 들어간다. 그러니 시장 PC에
// 그걸 포함하면 과녁과 재료가 겹친다(2026-09-20 밤에 `_overUnderSplit`에서 밟은 함정).
//
//   (가) 전부      = 자사 + 경쟁 전부        <- 부분 순환. 참고용
//   (나) 바깥만    = 자사 + **300m 밖** 경쟁  <- 예측 점유율과 무관. **이게 본 검정이다**
//
// 문경은 경쟁점이 전부 300m 밖이라 (가)와 (나)가 같다.
//
// ── 관문 ──────────────────────────────────────────────────────────────────
//   관문 1. 문경·양주덕정을 빼고도 유의한가 (두 곳을 설명하려 만든 변수면 기각)
//   관문 2. 훑기 보정 대조군 — 정의 4가지를 훑으므로 그만큼 보정한다
//           (`_schoolInflow` (4)절: n=38에서 9가지 훑으면 우연히 0.413까지 나온다)
//   관문 3. 부호가 예측(양수)과 같아야 한다
//   관문 4. **(나) 바깥만**에서도 살아야 한다. (가)에서만 되면 순환이다
//
// ⚠️ **측정만 한다.** 통과해도 채택하지 않는다.
// ⚠️ 이건 "경쟁을 더 세자"가 아니다 — 2026-09-20에 이미 기각된 갈래다(`_rivalDecay`).
//    **경쟁점 PC를 수요의 증거로 읽는 것**이지 경쟁무게로 넣자는 게 아니다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_marketSupply.test.ts --disable-console-intercept
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
const num = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

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
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

describeIf("시장 공급 — 깔린 PC가 수요를 말해 주나", () => {
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
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const score = scoreTextbook(rows, P);
  const full = fittedParams(P, score);

  type Probe = {
    name: string; target: number;
    ownPc: number; rivalAll: number; rivalOut: number;
    demand: number; pop1km: number | null;
    defs: Record<string, number>;
  };
  const probes: Probe[] = [];
  for (const r of rows) {
    const x = score.rows.find((y) => y.storeCode === r.input.storeCode);
    if (!x || x.requiredShare == null || x.share == null || !(x.share > 0)) continue;
    const b = computeTextbook(r.input, full);
    const demand = b.totalDemandUsers;
    if (demand == null || !(demand > 0)) continue;
    const rivals = (r.input.rivals ?? []).filter((v) => v.ip > 0);
    const rivalAll = rivals.reduce((s, v) => s + v.ip, 0);
    const rivalOut = rivals.filter((v) => v.distanceM != null && v.distanceM > P.effectiveRadiusM).reduce((s, v) => s + v.ip, 0);
    const ownPc = r.input.pcCount ?? 0;
    probes.push({
      name: r.input.storeName ?? r.input.storeCode,
      target: Math.log(x.requiredShare / x.share),
      ownPc, rivalAll, rivalOut, demand, pop1km: r.input.pop1km ?? null,
      defs: {
        "(가) 전부÷수요": (ownPc + rivalAll) / demand,
        "(나) 바깥만÷수요": (ownPc + rivalOut) / demand,
        "(가) 전부÷1km인구": r.input.pop1km ? (ownPc + rivalAll) / r.input.pop1km : NaN,
        "(나) 바깥만÷1km인구": r.input.pop1km ? (ownPc + rivalOut) / r.input.pop1km : NaN,
      },
    });
  }
  const DEFS = ["(가) 전부÷수요", "(나) 바깥만÷수요", "(가) 전부÷1km인구", "(나) 바깥만÷1km인구"];
  const TARGETS = ["문경시청점", "양주덕정점"];
  const line = (n: number) => 2 / Math.sqrt(n);

  it("(1) 문경은 정말 유난한가", () => {
    expect(probes.length).toBeGreaterThan(20);
    const key = "(나) 바깥만÷수요";
    const usable = probes.filter((p) => Number.isFinite(p.defs[key]));
    const sorted = [...usable].sort((a, b) => b.defs[key] - a.defs[key]);
    console.log(`\n[시장 PC ÷ 우리가 센 수요]  n=${usable.length} · 중앙 ${med(usable.map((p) => p.defs[key])).toFixed(3)}`);
    console.log("  매장          자사PC  경쟁PC(전부)  경쟁PC(300m밖)  센 수요   (나)비   순위");
    sorted.forEach((p, i) => {
      if (i < 5 || i >= sorted.length - 3 || TARGETS.includes(p.name)) {
        console.log(
          `  ${p.name.padEnd(12)}${String(p.ownPc).padStart(7)}${String(p.rivalAll).padStart(13)}${String(p.rivalOut).padStart(15)}` +
          `${num(p.demand).padStart(10)}${p.defs[key].toFixed(3).padStart(9)}${`${i + 1}/${sorted.length}`.padStart(8)}` +
          `${TARGETS.includes(p.name) ? "   <-" : ""}`,
        );
      } else if (i === 5) console.log("   ...");
    });
    const mk = usable.find((p) => p.name === "문경시청점");
    if (mk) {
      const m = med(usable.map((p) => p.defs[key]));
      console.log(`\n  📌 문경: 시장이 깐 PC가 우리가 센 수요 대비 중앙의 **${(mk.defs[key] / m).toFixed(2)}배**다.`);
      console.log(`     필요 점유율이 191%(=1.91배)인 것과 견줘 볼 값이다.`);
    }
  });

  it("(2) ⭐ 정의 4가지 훑기 · 사전 등록 관문", () => {
    const t0 = probes.map((p) => p.target);
    console.log(`\n[훑기] 과녁 = log(필요÷예측) · 예측 방향 **양수** · 단일 유의선 ±${line(probes.length).toFixed(2)}`);
    console.log("  정의                    r(순위)   관문1(두 곳 뺀 36곳)");
    const sub = probes.filter((p) => !TARGETS.includes(p.name));
    const res: { def: string; r: number; r1: number; n: number }[] = [];
    for (const def of DEFS) {
      const ok = probes.filter((p) => Number.isFinite(p.defs[def]));
      const r = spear(ok.map((p) => p.defs[def]), ok.map((p) => p.target));
      const ok1 = sub.filter((p) => Number.isFinite(p.defs[def]));
      const r1 = spear(ok1.map((p) => p.defs[def]), ok1.map((p) => p.target));
      res.push({ def, r, r1, n: ok.length });
      const mk = (x: number, n: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}${Math.abs(x) >= line(n) ? "*" : " "}`;
      console.log(`  ${def.padEnd(22)}${mk(r, ok.length).padStart(9)}${mk(r1, ok1.length).padStart(20)}`);
    }
    console.log("  (* = 그 표본 크기의 단일 유의선을 넘음)");

    const main = res.find((x) => x.def === "(나) 바깥만÷수요")!;
    const best = [...res].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
    console.log(`\n  본 검정 (나) 바깥만÷수요:  r=${main.r.toFixed(3)}  ·  제일 센 정의: ${best.def} r=${best.r.toFixed(3)}`);

    // 관문 2 — 훑기 보정 대조군
    let seed = 20260920;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const N = 2000;
    const maxes: number[] = [];
    for (let i = 0; i < N; i++) {
      const sh = [...t0];
      for (let j = sh.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        [sh[j], sh[k]] = [sh[k], sh[j]];
      }
      let mx = 0;
      for (const def of DEFS) {
        const idx = probes.map((p, i2) => (Number.isFinite(p.defs[def]) ? i2 : -1)).filter((i2) => i2 >= 0);
        mx = Math.max(mx, Math.abs(spear(idx.map((i2) => probes[i2].defs[def]), idx.map((i2) => sh[i2]))));
      }
      maxes.push(mx);
    }
    maxes.sort((a, b) => a - b);
    const p95 = maxes[Math.floor(maxes.length * 0.95)];
    const ge = maxes.filter((m) => m >= Math.abs(best.r)).length;
    const pv = (ge + 1) / (maxes.length + 1);
    console.log(`\n[관문 2 — 훑기 보정 대조군] 과녁을 ${N}번 섞고 같은 4가지를 훑었다 (시드 20260920)`);
    console.log(`  우연히 나오는 |r| 최대값: 중앙 ${med(maxes).toFixed(3)} · 95분위 ${p95.toFixed(3)}`);
    console.log(`  관측 |r| 최대 ${Math.abs(best.r).toFixed(3)} · p = ${pv.toFixed(4)}` + (pv < 0.05 ? "   <- 0.05 아래" : "   <- 유의선 위"));

    const g3 = best.r > 0;
    const g1 = Math.abs(best.r1) >= line(36) && best.r1 > 0;
    const g2 = pv < 0.05;
    const g4 = Math.abs(main.r) >= line(main.n) && main.r > 0;
    console.log("\n[판정] 사전 등록한 관문 넷");
    console.log(`  관문 3 부호가 예측(양수)과 같다         ${g3 ? "통과" : "⛔ 미달 — 반대 방향이다"}`);
    console.log(`  관문 1 두 곳을 빼고도 유의하다          ${g1 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 2 훑기 보정 대조군을 넘는다        ${g2 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 4 순환 없는 (나)에서도 산다        ${g4 ? "통과" : "⛔ 미달"}`);
    if (g1 && g2 && g3 && g4) {
      console.log("\n  ✅ 넷 다 통과 -> **후보다.** 그래도 채택하지 않는다(홀드아웃은 사용자 확인 뒤).");
    } else {
      console.log("\n  ⛔ **기각.** 일반 변수로는 못 쓴다.");
      console.log("\n  📌 **이 판이 값진 이유** — 관문 4가 없었으면 채택 후보로 올렸을 그림이다.");
      console.log(`     (가) 전부÷수요는 r=+${res.find((x) => x.def === "(가) 전부÷수요")!.r.toFixed(3)}에 두 곳을 빼도 살고 훑기 대조군도 p=${pv.toFixed(4)}로 넘는다.`);
      console.log("     관문 셋을 통과한다. 그런데 **순환을 걷어낸 (나)에서 죽는다.**");
      console.log("     까닭: 300m 안 경쟁 IP는 예측 점유율의 **분모**다. 경쟁점이 많으면");
      console.log("     예측 점유율이 내려가고 필요÷예측이 자동으로 올라간다. 자료가 아니라 산식이다.");
      console.log("\n  ⚠️ 그런데 **(나)도 완전히 깨끗하지는 않다.** '300m 밖 경쟁점'만 세면");
      console.log("     경쟁점이 멀리 있는 매장이 자동으로 높게 나온다(문경이 1위인 것도 그 탓이 크다).");
      console.log("     즉 (가)는 순환이고 (나)는 치우쳐 있다 — **이 과녁으로는 깨끗하게 못 잰다.**");
      console.log("     제대로 재려면 경쟁 항이 안 들어간 과녁이 필요하다.");
    }

    // 문경 한 곳에 대해서는 따로 적어 둔다 — 일반 변수가 아니어도 사실은 사실이다.
    const mk = probes.find((p) => p.name === "문경시청점");
    if (mk) {
      console.log("\n[문경 한 곳에 대해서만]");
      console.log(`  우리가 센 수요 ${num(mk.demand)}명 · 그 동네에 실제로 깔린 PC ${mk.ownPc + mk.rivalAll}대`);
      console.log("  (자사 98 + 쨈나 61 + 치루치루 97 + 콤마 100 + 클라우드 127)");
      console.log("  📌 경쟁점 PC는 **남이 자기 돈으로 깐 설비**이고 우리 매출과 무관한 관측치다.");
      console.log("     수요 1,665명짜리 동네에 483대가 깔려 돌아가지는 않는다.");
      console.log("  🛑 다만 **위에서 일반 변수로는 기각됐다.** 이건 n=1짜리 정황이고,");
      console.log("     문경 하나를 설명하려고 변수를 만들면 관문 1에 걸린다.");
      console.log("     👉 쓸 데가 있다면 '문경 자료를 다시 보라'는 **단서**로서다.");
    }
  });
});
