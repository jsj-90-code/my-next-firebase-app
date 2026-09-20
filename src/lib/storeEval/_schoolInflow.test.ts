// 통학 유입 — 학교가 수요를 데려오나 (2026-09-20 밤, 무인작업)
//
// ══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 사전 등록 — **자료를 보기 전에** 정한 판정 기준이다. 고치지 말 것.
// ══════════════════════════════════════════════════════════════════════════
//
// ── 왜 이 변수인가 ────────────────────────────────────────────────────────
// 수요식은 **거주지 기준**이다. 주거 1km 인구를 연령별 이용률로 섞는다
// (`useResidentAgeWeights` — 10대 거주인구는 이미 세고 있다).
//
// 그런데 중·고등학생은 **거주지가 아니라 학교 옆에서** PC방에 간다. 학구가 넓은
// 동네일수록 1km 밖에 살면서 1km 안 학교에 다니는 학생이 많고, 그 수요는
// **주거인구에도 유동인구에도 안 잡힌다.** 이게 아직 안 훑은 물리적 변수다.
//
// 문경시청점이 이 이야기에 딱 맞는 모양이다 — 2km 안에 학교가 12곳(중·고만 6곳)인데
// 5km 주거인구가 44,935명뿐이다(`_wideCatchment.test.ts`). 학교가 인구에 비해 촘촘하다.
//
// ── 예측 방향 (먼저 못 박는다) ────────────────────────────────────────────
//   학교가 많을수록 **모델이 못 세는 수요**가 있다 -> **과소예측**
//   과녁 log(필요÷예측)과 **양의 상관**이어야 한다. 음수면 가설과 반대다.
//
// ⚠️ 과녁은 반드시 **필요÷예측**을 쓴다. 필요 점유율만 쓰면 수요(∝인구)로 나눈 값이라
//    인구와 자동으로 상관이 난다(2026-09-18 나눗셈 함정).
//
// ── 관문 ──────────────────────────────────────────────────────────────────
//   관문 1. **문경·양주덕정을 빼고도 되는가** (제일 중요)
//           두 곳을 뺀 36곳에서도 유의해야 한다.
//           빼면 사라진다 = 그 둘을 설명하려고 만든 변수다. **기각.**
//
//   관문 2. **주거인구·10대 인구를 통제해도 남는가**
//           학교는 인구 따라 늘어난다. 편상관에서도 남아야 한다.
//           안 남으면 = 인구의 다른 얼굴일 뿐이다. **기각.**
//
//   관문 3. **훑기 보정** — 정의를 9가지(반경 3 x 종류 3) 훑는다.
//           그중 제일 센 것이 **무작위 대조군에서 같은 훑기를 했을 때의 95분위**를
//           넘어야 한다. 안 넘으면 우연이다. **기각.**
//
//   관문 4. **부호가 예측과 같아야 한다.** 반대면 이야기가 달라진 것이므로 기각한다.
//
// ⚠️ **측정만 한다.** 통과해도 채택하지 않는다 — 홀드아웃은 사용자 확인 뒤다.
//
// 자료: `.local-tools/kakao-neighborhood.json` (2km 안 학교 낱개 좌표, 2026-09-19 수집)
// ⚠️ 이 자료는 PC방 쪽에 폐업 오염이 있었다. **학교는 폐업이 거의 없어** 그 문제는
//    작지만, 목록이 잘린 매장이 1곳 있다(아래 (1)절에서 표시한다).
//
// 실행:
//   npx vitest run src/lib/storeEval/_schoolInflow.test.ts --disable-console-intercept
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
const describeIf = hasValidationSnapshot() && existsSync(NBR_FILE) ? describe : describe.skip;
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
/** 편상관 — c들을 차례로 통제하고 a↔b. 순위로 계산한다. */
const partial = (a: number[], b: number[], c: number[]) => {
  const rab = spear(a, b), rac = spear(a, c), rbc = spear(b, c);
  const den = Math.sqrt((1 - rac * rac) * (1 - rbc * rbc));
  return den > 1e-9 ? (rab - rac * rbc) / den : 0;
};

describeIf("통학 유입 — 학교가 수요를 데려오나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { openedAt?: string; records?: QscRecord[] };
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

  const rows: LabRow[] = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const score = scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);

  type Doc = { name: string | null; category: string | null; distanceM: number | null };
  const nbr = JSON.parse(readFileSync(NBR_FILE, "utf8")) as {
    sites: Record<string, { code?: string | number; name?: string; schools?: { docs?: Doc[]; truncated?: boolean } }>;
  };
  const schoolsByCode = new Map<string, { docs: Doc[]; truncated: boolean }>();
  for (const s of Object.values(nbr.sites ?? {})) {
    if (s.code == null) continue;
    schoolsByCode.set(String(s.code), { docs: s.schools?.docs ?? [], truncated: !!s.schools?.truncated });
  }

  const isHigh = (d: Doc) => /고등학교/.test(d.category ?? "") || /고등학교/.test(d.name ?? "");
  const isMid = (d: Doc) => /중학교/.test(d.category ?? "") || /중학교/.test(d.name ?? "");
  const isElem = (d: Doc) => /초등학교/.test(d.category ?? "") || /초등학교/.test(d.name ?? "");

  type Probe = {
    name: string; code: string; target: number;
    pop1km: number | null; teen1km: number | null;
    truncated: boolean;
    counts: Record<string, number>;
  };

  // 정의 9가지 — 반경 3(500·1000·2000m) x 종류 3(중고 / 전체 / 초등)
  const RADII = [500, 1000, 2000];
  const KINDS: [string, (d: Doc) => boolean][] = [
    ["중·고", (d) => isMid(d) || isHigh(d)],
    ["전체", () => true],
    ["초등", isElem],
  ];
  const DEFS: string[] = [];
  for (const r of RADII) for (const [k] of KINDS) DEFS.push(`${k} ${r}m`);

  const probes: Probe[] = [];
  for (const r of rows) {
    const x = score.rows.find((y) => y.storeCode === r.input.storeCode);
    if (!x || x.requiredShare == null || x.share == null || !(x.share > 0)) continue;
    const sc = schoolsByCode.get(r.input.storeCode);
    if (!sc) continue;
    const counts: Record<string, number> = {};
    for (const rad of RADII) {
      for (const [kind, f] of KINDS) {
        counts[`${kind} ${rad}m`] = sc.docs.filter((d) => f(d) && (d.distanceM ?? 9e9) <= rad).length;
      }
    }
    const ages = r.input.residentAges;
    probes.push({
      name: r.input.storeName ?? r.input.storeCode,
      code: r.input.storeCode,
      target: Math.log(x.requiredShare / x.share),
      pop1km: r.input.pop1km ?? null,
      teen1km: ages?.age10s ?? null,
      truncated: sc.truncated,
      counts,
    });
  }

  const TARGETS = ["문경시청점", "양주덕정점"];
  const line = (n: number) => 2 / Math.sqrt(n);

  it("(1) 자료 상태 · 문경은 정말 학교가 촘촘한가", () => {
    expect(probes.length).toBeGreaterThan(20);
    const tr = probes.filter((p) => p.truncated);
    console.log(`\n[자료] ${probes.length}곳 · 목록 잘린 매장 ${tr.length}곳${tr.length ? ` (${tr.map((t) => t.name).join(", ")})` : ""}`);
    console.log("\n  매장          중고2km  전체2km  중고1km  주거1km   10대1km   중고2km ÷ 10대천명");
    const per = (p: Probe) => (p.teen1km && p.teen1km > 0 ? (p.counts["중·고 2000m"] / p.teen1km) * 1000 : null);
    const sorted = [...probes].sort((a, b) => (per(b) ?? 0) - (per(a) ?? 0));
    sorted.forEach((p, i) => {
      if (i < 5 || i >= sorted.length - 3 || TARGETS.includes(p.name)) {
        console.log(
          `  ${p.name.padEnd(12)}${String(p.counts["중·고 2000m"]).padStart(7)}${String(p.counts["전체 2000m"]).padStart(9)}` +
          `${String(p.counts["중·고 1000m"]).padStart(9)}${num(p.pop1km).padStart(9)}${num(p.teen1km).padStart(10)}` +
          `${num(per(p), 2).padStart(16)}${TARGETS.includes(p.name) ? "   <-" : ""}`,
        );
      } else if (i === 5) console.log("   ...");
    });
    console.log("\n  📌 마지막 칸이 '10대 1,000명당 중·고교 수'다 — 인구 대비 학교 밀도.");
    console.log("     가설이 맞다면 이 값이 큰 매장이 과소예측이어야 한다.");
  });

  it("(2) ⭐ 정의 9가지 훑기 — 과녁은 log(필요÷예측)", () => {
    const t = probes.map((p) => p.target);
    console.log(`\n[훑기] n=${probes.length} · 유의선 ±${line(probes.length).toFixed(2)} · 예측 방향은 **양수**`);
    console.log("  정의            r(순위)   관문1(두곳 뺀 36곳)   관문2(주거1km 통제)   관문2(10대 통제)");
    const res: { def: string; r: number; r1: number; r2a: number; r2b: number }[] = [];
    const sub = probes.filter((p) => !TARGETS.includes(p.name));
    for (const def of DEFS) {
      const v = probes.map((p) => p.counts[def]);
      const r = spear(v, t);
      const r1 = spear(sub.map((p) => p.counts[def]), sub.map((p) => p.target));
      const withPop = probes.filter((p) => p.pop1km != null);
      const r2a = partial(withPop.map((p) => p.counts[def]), withPop.map((p) => p.target), withPop.map((p) => p.pop1km!));
      const withTeen = probes.filter((p) => p.teen1km != null);
      const r2b = partial(withTeen.map((p) => p.counts[def]), withTeen.map((p) => p.target), withTeen.map((p) => p.teen1km!));
      res.push({ def, r, r1, r2a, r2b });
      const mark = (x: number, n: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}${Math.abs(x) >= line(n) ? "*" : " "}`;
      console.log(
        `  ${def.padEnd(14)}${mark(r, probes.length).padStart(9)}${mark(r1, sub.length).padStart(18)}` +
        `${mark(r2a, withPop.length).padStart(20)}${mark(r2b, withTeen.length).padStart(18)}`,
      );
    }
    console.log("  (* = 그 표본 크기의 유의선을 넘음)");
    const best = [...res].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
    console.log(`\n  제일 센 정의: ${best.def}  r=${best.r.toFixed(3)}`);

    // ── 관문 3: 훑기 보정 무작위 대조군 ──────────────────────────────────
    // 과녁을 매장들 사이에서 섞고 **같은 9가지 훑기**를 해서 |r| 최대값을 모은다.
    // 관측한 최대값이 그 분포의 95분위를 넘어야 한다.
    let seed = 20260920;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const N = 2000;
    const maxes: number[] = [];
    for (let i = 0; i < N; i++) {
      const sh = [...t];
      for (let j = sh.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        [sh[j], sh[k]] = [sh[k], sh[j]];
      }
      let mx = 0;
      for (const def of DEFS) mx = Math.max(mx, Math.abs(spear(probes.map((p) => p.counts[def]), sh)));
      maxes.push(mx);
    }
    maxes.sort((a, b) => a - b);
    const p95 = maxes[Math.floor(maxes.length * 0.95)];
    const ge = maxes.filter((m) => m >= Math.abs(best.r)).length;
    const pv = (ge + 1) / (maxes.length + 1);
    console.log(`\n[관문 3 — 훑기 보정 대조군] 과녁을 ${N}번 섞고 같은 9가지를 훑었다 (시드 20260920)`);
    console.log(`  우연히 나오는 |r| 최대값:  중앙 ${maxes[Math.floor(maxes.length / 2)].toFixed(3)} · 95분위 ${p95.toFixed(3)}`);
    console.log(`  관측 |r| 최대 ${Math.abs(best.r).toFixed(3)} · p = ${pv.toFixed(4)}` +
      (pv < 0.05 ? "   <- 0.05 아래" : "   <- 유의선 위"));

    // ── 판정 ──────────────────────────────────────────────────────────────
    const g4 = best.r > 0;
    const g1 = Math.abs(best.r1) >= line(sub.length) && best.r1 > 0;
    const g2 = Math.abs(best.r2a) >= line(probes.length) && Math.abs(best.r2b) >= line(probes.length) && best.r2a > 0 && best.r2b > 0;
    const g3 = pv < 0.05;
    console.log("\n[판정] 사전 등록한 관문 넷");
    console.log(`  관문 4 부호가 예측(양수)과 같다              ${g4 ? "통과" : "⛔ 미달 — 반대 방향이다"}`);
    console.log(`  관문 1 문경·양주덕정을 빼고도 유의하다        ${g1 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 2 주거·10대 인구를 통제해도 남는다       ${g2 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 3 훑기 보정 대조군을 넘는다             ${g3 ? "통과" : "⛔ 미달"}`);
    if (g1 && g2 && g3 && g4) {
      console.log("\n  ✅ 넷 다 통과. **그래도 채택하지 않는다** — 홀드아웃(LOO)이 남았고 그건 사용자 확인 뒤다.");
    } else {
      console.log("\n  ⛔ **기각.** 통학 유입은 이 표본에서 근거가 없다.");
      console.log("     문경의 필요 점유율 191%는 학교로도 설명되지 않는다.");
    }
  });

  it("(4) 📏 곁다리 — 훑을 때의 진짜 유의선은 ±0.32가 아니다", () => {
    // (2)절 대조군에서 공짜로 나온 값이다. 프로젝트 전체에 쓰이는 보정이라 따로 찍어 둔다.
    //
    // 우리는 n=38에서 유의선을 ±0.32(=2/√n)로 써 왔다. **그건 변수 하나를 볼 때의 선이다.**
    // 여러 개를 훑고 그중 제일 센 것을 고르면 최대값의 분포를 봐야 한다.
    const t = probes.map((p) => p.target);
    let seed = 20260921;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const shuffled = () => {
      const sh = [...t];
      for (let j = sh.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        [sh[j], sh[k]] = [sh[k], sh[j]];
      }
      return sh;
    };
    const N = 2000;
    const one: number[] = [], nine: number[] = [];
    for (let i = 0; i < N; i++) {
      const sh = shuffled();
      one.push(Math.abs(spear(probes.map((p) => p.counts["중·고 2000m"]), sh)));
      let mx = 0;
      for (const def of DEFS) mx = Math.max(mx, Math.abs(spear(probes.map((p) => p.counts[def]), sh)));
      nine.push(mx);
    }
    one.sort((a, b) => a - b); nine.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
    console.log(`\n[유의선 보정] n=${probes.length} · 섞기 ${N}번`);
    console.log("  훑은 개수    |r| 중앙   |r| 95분위   쓰던 선(±0.32)과 견주면");
    console.log(`  1개 (단일)${q(one, 0.5).toFixed(3).padStart(10)}${q(one, 0.95).toFixed(3).padStart(12)}      ` +
      `${q(one, 0.95) <= 0.34 ? "대체로 맞다" : "이미 느슨하다"}`);
    console.log(`  9개 (훑기)${q(nine, 0.5).toFixed(3).padStart(10)}${q(nine, 0.95).toFixed(3).padStart(12)}      ` +
      `**${(q(nine, 0.95) / 0.32).toFixed(1)}배 느슨했다**`);
    console.log("\n  📌 뜻: **훑을 때 ±0.32를 넘는 건 유의한 게 아니다.** 9가지만 훑어도 우연히");
    console.log(`     ${q(nine, 0.95).toFixed(2)}까지 나온다. 우리 정의 9개는 서로 많이 겹치는데도 이렇다 —`);
    console.log("     _worstErrors의 22개처럼 **서로 다른** 변수를 훑으면 선은 더 올라간다.");
    console.log("     즉 이 값은 22개 훑기의 **하한**이다.");
    console.log("\n  👉 되돌아보면: _worstErrors 22개 훑기에서 제일 센 게 예측 점유율 r=−0.350이었다.");
    console.log(`     그건 이 하한(${q(nine, 0.95).toFixed(3)})에도 못 미친다. '가르는 변수가 없다'가 더 단단해진다.`);
    console.log("     (게다가 그 변수는 과녁의 분모라 순환이다.)");
  });

  it("(3) 문경·양주덕정만 따로 — 가설이 맞으면 어디쯤이어야 하나", () => {
    const def = "중·고 2000m";
    const v = probes.map((p) => p.counts[def]);
    const sorted = [...probes].sort((a, b) => b.counts[def] - a.counts[def]);
    console.log(`\n['${def}' 순위]  n=${probes.length}`);
    for (const name of TARGETS) {
      const p = probes.find((x) => x.name === name);
      if (!p) { console.log(`  ${name} — 없음`); continue; }
      const r = sorted.findIndex((x) => x.name === name) + 1;
      console.log(
        `  ${name.padEnd(12)}${p.counts[def]}곳  ${r}/${probes.length}위   ` +
        `과녁 log(필요÷예측) ${p.target >= 0 ? "+" : ""}${p.target.toFixed(3)} (배로 ${Math.exp(p.target).toFixed(2)})`,
      );
    }
    const mx = Math.max(...v), mn = Math.min(...v);
    console.log(`\n  '${def}' 범위: ${mn} ~ ${mx}곳 · 중앙 ${num(v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)])}곳`);
    console.log("  📌 가설이 맞다면 두 곳이 **상위권**이어야 한다. 중하위면 이야기가 안 선다.");
  });
});
