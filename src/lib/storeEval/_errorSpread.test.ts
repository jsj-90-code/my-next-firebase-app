// 오차의 **퍼짐** — 실험실 산식을 못 쓰는 진짜 이유 (2026-09-20 밤)
//
// 사용자: *"지금 실험실 산식을 못 쓰는 이유가 가장 큰데, 오차 범위가 너무 커.
//   0~80%까지 가잖아. 이게 가장 큰 문제인 듯."*
//
// 맞는 지적이다. **평균(MAPE)이 아니라 퍼짐이 쓸 수 있느냐를 가른다.** 후보지 하나를
// 놓고 "6,000만원"이라고 했을 때 그게 ±20%일지 ±70%일지 모르면 결정에 못 쓴다.
//
// ── 두 갈래가 있다 ────────────────────────────────────────────────────────
//   (가) 오차를 줄인다            — 손잡이로 꼬리를 깎을 수 있나
//   (나) **못 미더운 걸 미리 안다** — 어느 후보지의 예측이 불안한지 **개점 전에** 가를 수 있나
//
// (나)가 되면 산식을 그대로 두고도 쓸 수 있게 된다 —
// *"6,000만원 · 신뢰 높음"* 과 *"6,000만원 · 참고만"* 은 결정에 쓰는 값이 다르다.
//
// ── ⚠️ 사전(ex-ante) 정보만 쓴다 ──────────────────────────────────────────
// **필요 점유율·실측 가동률은 못 쓴다.** 매출이 있어야 나오는 값이라, 새 후보지에는 없다.
// 그걸 쓰면 "매출로 매출의 오차를 맞히는" 순환이 된다. 여기서는
// **개점 전에 손에 있는 것만** 쓴다 — 인구·경쟁점·PC수·입지·조사 완성도.
//
// ── 관문 (자료를 보기 전에 정한다) ────────────────────────────────────────
//   관문 1. 부호가 뜻에 맞아야 한다 (예: 조사가 부실할수록 오차가 커야 한다)
//   관문 2. **훑기 보정 대조군** — 여러 개를 훑으므로 단일 유의선(±0.32)으로 판정하지
//           않는다. 과녁을 섞어 같은 훑기를 2,000번 하고 95분위를 넘어야 한다.
//           (근거: `_schoolInflow` (4)절 — 9가지만 훑어도 우연히 0.413이 나온다)
//   관문 3. 문경·양주덕정을 빼고도 남아야 한다
//
// ⚠️ **측정만 한다.**
//
// 실행:
//   npx vitest run src/lib/storeEval/_errorSpread.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

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

describeIf("오차의 퍼짐", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const comps: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, comps, snap.locationEvaluations, settings);
  const byCode = new Map<string, Competitor[]>();
  for (const c of comps) byCode.set(c.candidateCode, [...(byCode.get(c.candidateCode) ?? []), c]);
  const qscBy = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] })[]) {
    const code = doc.storeCode ?? doc.id;
    if (!code) continue;
    const a = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null);
    if (a != null) qscBy.set(code, a);
  }
  if (!qscBy.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, { openedAt?: string; records?: QscRecord[] }>;
    for (const [k, v] of Object.entries(sites)) {
      const a = qscInWindowAverage(v.records ?? [], v.openedAt ?? null);
      if (a != null) qscBy.set(k.replace(/^existing:/, ""), a);
    }
  }
  const rows: LabRow[] = buildLabRows({
    stores, compsByCode: byCode, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores),
    settings, qscByStoreCode: qscBy,
  });
  const P = DEFAULT_TEXTBOOK_PARAMS;

  /** 정직한 LOO — 축척까지 훈련겹에서만. 매장별 오차를 돌려준다. */
  const looRows = (p: TextbookParams) => {
    const out: { code: string; name: string; signed: number; abs: number; share: number | null }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const tr = rows.filter((_, k) => k !== i);
      const fp = fittedParams(p, scoreTextbook(tr, p));
      const b = computeTextbook(rows[i].input, fp);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue == null || !(a > 0)) continue;
      const s = b.monthlyRevenue / a - 1;
      out.push({ code: rows[i].input.storeCode, name: rows[i].input.storeName ?? "", signed: s, abs: Math.abs(s), share: b.share ?? null });
    }
    return out;
  };
  const stat = (e: number[]) => {
    const s = [...e].sort((a, b) => a - b);
    const q = (x: number) => s[Math.min(s.length - 1, Math.floor(s.length * x))];
    return {
      mape: e.reduce((a, b) => a + b, 0) / e.length, med: q(0.5), p90: q(0.9), worst: s[s.length - 1],
      w20: e.filter((x) => x <= 0.2).length / e.length, w30: e.filter((x) => x <= 0.3).length / e.length,
    };
  };

  const UNI = { ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, "대학가": 1.0 } };

  it("(1) 지금 퍼짐이 어떤 모양인가", () => {
    for (const [label, p] of [["지금 (대학가 1.45)", P], ["대학가 1.0으로만 내리면", UNI]] as [string, TextbookParams][]) {
      const r = looRows(p);
      const st = stat(r.map((x) => x.abs));
      const worst = [...r].sort((a, b) => b.abs - a.abs).slice(0, 6);
      console.log(`\n[${label}]  n=${r.length}  (정직한 LOO)`);
      console.log(`  MAPE ${pct(st.mape, 2)} · 중앙 ${pct(st.med)} · 90분위 ${pct(st.p90)} · **최악 ${pct(st.worst)}**`);
      console.log(`  ±20% ${pct(st.w20, 0)} · ±30% ${pct(st.w30, 0)}`);
      console.log(`  최악 6곳: ${worst.map((x) => `${x.name} ${x.signed >= 0 ? "+" : ""}${(x.signed * 100).toFixed(0)}%`).join(" · ")}`);
      const neg = worst.filter((x) => x.signed < 0).length;
      console.log(`  -> 최악 6곳 중 ${neg}곳이 **과소예측**이다.`);
    }
    console.log("\n  📌 꼬리가 **한쪽으로만** 몰려 있다. 가운데는 맞는데 몇 곳이 크게 모자란다.");
    console.log("     즉 '전체가 흔들린다'가 아니라 **'특정 매장이 설명이 안 된다'**는 문제다.");
    expect(rows.length).toBeGreaterThan(30);
  }, 300_000);

  it("(2) ⭐ 못 미더운 예측을 **개점 전에** 가릴 수 있나", () => {
    const r = looRows(UNI);
    const byCodeErr = new Map(r.map((x) => [x.code, x]));
    // ── 사전 정보만으로 만든 후보 지표들 ──────────────────────────────────
    type Feat = { name: string; dir: "+" | "-"; why: string; of: (row: LabRow, share: number | null) => number | null };
    const FEATS: Feat[] = [
      { name: "예측 점유율", dir: "+", why: "점유율이 높을수록 경쟁 항이 크게 작용 -> 틀릴 여지", of: (_r, s) => s },
      { name: "유효경쟁 점포수", dir: "-", why: "경쟁점이 적을수록 한 곳의 오차가 크게 남는다",
        of: (row) => (row.input.rivals ?? []).filter((v) => v.ip > 0 && (v.distanceM == null || v.distanceM <= P.effectiveRadiusM)).length },
      { name: "전체 경쟁 점포수", dir: "-", why: "위와 같다", of: (row) => (row.input.rivals ?? []).filter((v) => v.ip > 0).length },
      { name: "자사PC ÷ 경쟁IP", dir: "+", why: "우리가 상권을 다 먹는 구조일수록 흔들린다",
        of: (row) => {
          const ip = (row.input.rivals ?? []).filter((v) => v.ip > 0 && (v.distanceM == null || v.distanceM <= P.effectiveRadiusM)).reduce((a, b) => a + b.ip, 0);
          return ip > 0 ? (row.input.pcCount ?? 0) / ip : null;
        } },
      { name: "주거 1km", dir: "-", why: "인구가 적을수록 표본이 얇아 흔들린다", of: (row) => row.input.pop1km ?? null },
      { name: "경쟁점 조사 결측률", dir: "+", why: "조사가 부실할수록 경쟁 항이 못 미덥다",
        of: (row) => {
          const rv = (row.input.rivals ?? []).filter((v) => v.ip > 0);
          if (!rv.length) return null;
          return rv.filter((v) => !v.parts || Object.values(v.parts).every((x) => x == null)).length / rv.length;
        } },
      { name: "경쟁점 거리 결측률", dir: "+", why: "거리를 모르면 유효거리 판정이 못 미덥다",
        of: (row) => {
          const rv = (row.input.rivals ?? []).filter((v) => v.ip > 0);
          if (!rv.length) return null;
          return rv.filter((v) => v.distanceM == null).length / rv.length;
        } },
      { name: "자사 PC수", dir: "-", why: "작은 매장일수록 흔들린다", of: (row) => row.input.pcCount ?? null },
      { name: "입지 배율 이탈", dir: "+", why: "입지 보정이 1에서 멀수록 그 항에 기댄 예측이다",
        of: (row) => { const b = computeTextbook(row.input, P); return b.locationMultiplier != null ? Math.abs(Math.log(b.locationMultiplier)) : null; } },
      { name: "기본수요", dir: "-", why: "수요가 작을수록 한 명의 무게가 크다",
        of: (row) => { const b = computeTextbook(row.input, P); return b.totalDemandUsers ?? null; } },
    ];

    const data: { name: string; abs: number; f: Record<string, number | null> }[] = [];
    for (const row of rows) {
      const e = byCodeErr.get(row.input.storeCode);
      if (!e) continue;
      const f: Record<string, number | null> = {};
      for (const ft of FEATS) f[ft.name] = ft.of(row, e.share);
      data.push({ name: row.input.storeName ?? row.input.storeCode, abs: e.abs, f });
    }
    const TWO = /문경시청|양주덕정/;
    const sub = data.filter((d) => !TWO.test(d.name));
    const line = (n: number) => 2 / Math.sqrt(n);
    console.log(`\n[사전 정보 ↔ |오차|]  n=${data.length} · 단일 유의선 ±${line(data.length).toFixed(2)}`);
    console.log("  지표                   뜻한 부호    r(순위)   두 곳 뺌   비고");
    const res: { name: string; r: number; r2: number; dir: string }[] = [];
    for (const ft of FEATS) {
      const ok = data.filter((d) => d.f[ft.name] != null);
      if (ok.length < 10) { console.log(`  ${ft.name.padEnd(20)}(자료 부족 ${ok.length}곳)`); continue; }
      const r = spear(ok.map((d) => d.f[ft.name] as number), ok.map((d) => d.abs));
      const ok2 = sub.filter((d) => d.f[ft.name] != null);
      const r2 = spear(ok2.map((d) => d.f[ft.name] as number), ok2.map((d) => d.abs));
      res.push({ name: ft.name, r, r2, dir: ft.dir });
      const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
      const hit = Math.abs(r) >= line(ok.length) && ((ft.dir === "+" && r > 0) || (ft.dir === "-" && r < 0));
      console.log(`  ${ft.name.padEnd(20)}${ft.dir.padStart(8)}${sign(r).padStart(12)}${sign(r2).padStart(11)}   ${hit ? "**뜻대로 유의**" : ""}`);
    }

    // 관문 2 — 훑기 보정 대조군
    let seed = 20260920;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const N = 2000;
    const maxes: number[] = [];
    const absAll = data.map((d) => d.abs);
    for (let i = 0; i < N; i++) {
      const sh = [...absAll];
      for (let j = sh.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [sh[j], sh[k]] = [sh[k], sh[j]]; }
      let mx = 0;
      for (const ft of FEATS) {
        const idx = data.map((d, i2) => (d.f[ft.name] != null ? i2 : -1)).filter((x) => x >= 0);
        if (idx.length < 10) continue;
        mx = Math.max(mx, Math.abs(spear(idx.map((x) => data[x].f[ft.name] as number), idx.map((x) => sh[x]))));
      }
      maxes.push(mx);
    }
    maxes.sort((a, b) => a - b);
    const best = [...res].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
    const p95 = maxes[Math.floor(maxes.length * 0.95)];
    const ge = maxes.filter((m) => m >= Math.abs(best.r)).length;
    const pv = (ge + 1) / (maxes.length + 1);
    console.log(`\n[관문 2 — 훑기 보정 대조군] ${FEATS.length}가지를 ${N}번 섞어 훑었다 (시드 20260920)`);
    console.log(`  우연히 나오는 |r| 최대: 중앙 ${med(maxes).toFixed(3)} · 95분위 ${p95.toFixed(3)}`);
    console.log(`  관측 최대 ${best.name} |r|=${Math.abs(best.r).toFixed(3)} · p = ${pv.toFixed(4)}` + (pv < 0.05 ? "  <- 0.05 아래" : "  <- 유의선 위"));
    const dirOk = (best.dir === "+" && best.r > 0) || (best.dir === "-" && best.r < 0);
    const g3 = Math.abs(best.r2) >= line(sub.length) && ((best.dir === "+" && best.r2 > 0) || (best.dir === "-" && best.r2 < 0));
    console.log(`\n[판정]`);
    console.log(`  관문 1 부호가 뜻대로다                ${dirOk ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 2 훑기 보정 대조군을 넘는다        ${pv < 0.05 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 3 두 곳을 빼고도 남는다           ${g3 ? "통과" : "⛔ 미달"}`);
    if (dirOk && pv < 0.05 && g3) {
      console.log(`\n  ✅ **개점 전에 '못 미더운 예측'을 가릴 수 있다.** 신뢰 등급을 붙일 근거가 생겼다.`);
    } else {
      console.log(`\n  ⛔ **개점 전 정보로는 오차 크기를 못 가린다.**`);
      console.log(`     즉 "이 후보지는 예측이 불안하다"를 미리 말해 줄 방법이 지금은 없다.`);
      console.log(`     구간을 준다면 **전 매장에 같은 폭**(예: ±30%)을 줄 수밖에 없다.`);
    }
    expect(data.length).toBeGreaterThan(30);
  }, 600_000);

  it("(3) 그럼 구간을 준다면 얼마로 — 정직한 폭", () => {
    const r = looRows(UNI);
    const e = r.map((x) => x.abs).sort((a, b) => a - b);
    const q = (x: number) => e[Math.min(e.length - 1, Math.floor(e.length * x))];
    console.log(`\n[전 매장 같은 폭으로 구간을 준다면] (대학가 1.0 · 정직한 LOO · n=${e.length})`);
    console.log("  덮는 비율     필요한 폭");
    for (const p of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) console.log(`  ${pct(p, 0).padStart(6)}       ±${pct(q(p))}`);
    console.log(`\n  📌 읽는 법: "80%를 덮으려면 ±${pct(q(0.8))} 구간이 필요하다"는 뜻이다.`);
    console.log(`     V62는 지금 ±15%(conservativeSales~upperSales)를 쓴다 — 실험실로 같은 폭을 주면`);
    console.log(`     실제로 덮는 비율은 ${pct(e.filter((x) => x <= 0.15).length / e.length, 0)}밖에 안 된다.`);
    console.log(`\n  ⚠️ 이게 "지금은 못 쓴다"의 정확한 뜻이다 — 산식이 틀려서가 아니라`);
    console.log(`     **정직하게 구간을 주면 그 구간이 너무 넓어서** 결정에 못 쓴다.`);
  }, 300_000);
});
