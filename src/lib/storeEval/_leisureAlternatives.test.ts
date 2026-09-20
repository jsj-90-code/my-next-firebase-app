// "PC방 말고 갈 곳이 없다" — 대체 여가시설 부족이 수요를 키우나 (2026-09-20 밤)
//
// ══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 사전 등록 — **자료를 받기 전에** 쓴 파일이다. 결과를 보고 고치지 말 것.
//      (작성 시각 2026-09-20 밤, `collectKakaoLeisure.mjs`를 돌리기 **전**)
// ══════════════════════════════════════════════════════════════════════════
//
// ── 가설 (사용자, 2026-09-20) ─────────────────────────────────────────────
// *"문경은 시가 되게 작은 곳인데 PC 말고 애들이 갈 곳이 없는 거야. 놀 데가 없어.
//   그래서 PC방만 주구장창 간다."*
//
// 즉 **대체 여가시설이 적은 동네일수록 같은 인구에서 PC방 수요가 크다.**
// 지금 수요식에는 이 변수가 한 글자도 없다.
//
// ── 왜 이건 순환이 아닌가 ─────────────────────────────────────────────────
// 2026-09-20 밤에 같은 얘기를 **'시장 공급'**(경쟁점이 깐 PC 대수)으로 재려다 기각했다
// (`_marketSupply.test.ts`) — 경쟁 PC가 예측 점유율의 **분모**라 과녁과 재료가 겹쳤다.
// **노래방·당구장 개수는 우리 산식 어디에도 안 들어간다.** 그래서 그 문제가 없다.
//
// ── 예측 방향 (먼저 못 박는다) ────────────────────────────────────────────
//   대체 여가시설이 **적을수록** PC방 수요가 크다 -> 우리가 수요를 작게 센 것 -> **과소예측**
//   과녁 log(필요÷예측)과 **음의 상관**이어야 한다.
//   ⚠️ 양수면 가설과 **반대**다. 그때는 "여가시설이 많은 동네가 과소예측"이라는 뜻이고,
//      그건 상권 활력(번화가) 이야기지 사용자 가설이 아니다. **기각한다.**
//
// ⚠️ 과녁은 반드시 **필요÷예측**이다. 필요 점유율만 쓰면 수요(∝인구)로 나눈 값이라
//    인구와 자동으로 상관이 난다(2026-09-18 나눗셈 함정).
//
// ── 관문 (다섯) ───────────────────────────────────────────────────────────
//   관문 1. **부호가 예측(음수)과 같아야 한다.**
//
//   관문 2. **문경·양주덕정을 빼고도 유의한가** (제일 중요)
//           두 곳을 뺀 36곳에서도 유의해야 한다.
//           빼면 사라진다 = 그 둘을 설명하려고 만든 변수다. **기각.**
//
//   관문 3. **인구를 통제해도 남는가**
//           여가시설은 인구 따라 늘어난다. 주거1km와 10대 인구를 각각 통제한
//           편상관에서도 남아야 한다. 안 남으면 = 인구의 다른 얼굴이다. **기각.**
//
//   관문 4. **훑기 보정 대조군**
//           정의를 여럿 훑으므로 단일 유의선(±0.32)으로 판정하지 않는다.
//           과녁을 섞어 **같은 훑기**를 2,000번 하고, 관측 |r| 최대가 그 분포의
//           95분위를 넘어야 한다. (근거: `_schoolInflow` (4)절 — n=38에서 9가지만
//           훑어도 우연히 0.413까지 나온다.)
//
//   관문 5. **PC방 밀도를 통제해도 남는가**
//           "여가시설이 적은 동네"는 "PC방도 적은 동네"일 수 있다. 그러면 이건
//           상권 규모의 다른 얼굴일 뿐이다. 2km 안 PC방 점포수를 통제해도 남아야 한다.
//
// ⚠️ **측정만 한다.** 다섯을 다 통과해도 **채택하지 않는다** — 홀드아웃(LOO)은
//    사용자 확인 뒤다. 통과하면 "후보"까지다.
//
// ⚠️ 자료 한계를 미리 적어 둔다:
//    - 카카오 키워드 검색은 최대 45건이라 번화가는 **잘린다**(개수가 하한이 된다).
//      잘린 지점이 많으면 "많은 쪽"이 눌려서 상관이 약해지는 방향으로 편향된다.
//    - 폐업이 섞여 있을 수 있다(2km PC방 자료에서 문경 43%가 폐업이었다).
//      여가시설도 같은 문제를 가질 수 있고, **확인할 방법이 지금은 없다.**
//
// 실행:
//   node scripts/collectKakaoLeisure.mjs      # 먼저 자료를 받는다
//   npx vitest run src/lib/storeEval/_leisureAlternatives.test.ts --disable-console-intercept
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
const LEISURE_FILE = ".local-tools/kakao-leisure.json";
const NBR_FILE = ".local-tools/kakao-neighborhood.json";
const describeIf = hasValidationSnapshot() && existsSync(LEISURE_FILE) ? describe : describe.skip;

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

/** 키워드 검색이 물고 온 딴 업소를 거른다 — 업종명으로 판정한다. */
const KEEP: Record<string, RegExp> = {
  "노래방": /노래방|노래연습장/,
  "당구장": /당구/,
  "볼링장": /볼링/,
  "오락실": /오락실|게임장|멀티방|게임방/,
  "만화카페": /만화|북카페/,
  "영화관": /영화/,
  "CT1": /문화시설|영화|공연|전시|박물관|미술관/,
};

describeIf("대체 여가시설 — PC방 말고 갈 곳이 없나", () => {
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

  type Doc = { name: string | null; category: string | null; distanceM: number | null; lat: number; lng: number };
  type Group = { total: number | null; docs: Doc[]; truncated: boolean };
  const leisure = JSON.parse(readFileSync(LEISURE_FILE, "utf8")) as {
    sites: Record<string, { code?: string | number; name?: string; groups?: Record<string, Group> }>;
  };
  const leisureBy = new Map<string, { groups: Record<string, Group>; truncated: boolean }>();
  for (const s of Object.values(leisure.sites ?? {})) {
    if (s.code == null) continue;
    const groups = s.groups ?? {};
    leisureBy.set(String(s.code), { groups, truncated: Object.values(groups).some((g) => g?.truncated) });
  }

  // 2km 안 PC방 점포수 — 관문 5(PC방 밀도 통제)에 쓴다.
  const pcBy = new Map<string, number>();
  if (existsSync(NBR_FILE)) {
    const nbr = JSON.parse(readFileSync(NBR_FILE, "utf8")) as {
      sites: Record<string, { code?: string | number; pcRooms?: { docs?: Doc[] } }>;
    };
    for (const s of Object.values(nbr.sites ?? {})) {
      if (s.code == null) continue;
      pcBy.set(String(s.code), (s.pcRooms?.docs ?? []).filter((d) => (d.category ?? "").includes("PC방") && (d.distanceM ?? 9e9) > 30).length);
    }
  }

  /** 낱개를 좌표로 합쳐 중복을 없앤다 — 키워드가 서로 겹쳐서 잡는다(영화관 ↔ CT1). */
  const dedup = (docs: Doc[]) => {
    const seen = new Set<string>();
    const out: Doc[] = [];
    for (const d of docs) {
      const k = `${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
    return out;
  };

  const RADII = [500, 1000, 2000];
  type Probe = {
    name: string; code: string; target: number;
    pop1km: number | null; teen1km: number | null; pcRooms: number;
    truncated: boolean;
    defs: Record<string, number>;
    byKind: Record<string, number>;
  };
  const probes: Probe[] = [];
  for (const r of rows) {
    const x = score.rows.find((y) => y.storeCode === r.input.storeCode);
    if (!x || x.requiredShare == null || x.share == null || !(x.share > 0)) continue;
    const L = leisureBy.get(r.input.storeCode);
    if (!L) continue;
    // 업종명으로 거른 낱개를 모두 모은다
    const all: Doc[] = [];
    const byKind: Record<string, number> = {};
    for (const [kw, re] of Object.entries(KEEP)) {
      const kept = (L.groups[kw]?.docs ?? []).filter((d) => re.test(d.category ?? "") || re.test(d.name ?? ""));
      byKind[kw] = dedup(kept).length;
      all.push(...kept);
    }
    const uniq = dedup(all);
    const ages = r.input.residentAges;
    const pop1km = r.input.pop1km ?? null;
    const defs: Record<string, number> = {};
    for (const rad of RADII) {
      const n = uniq.filter((d) => (d.distanceM ?? 9e9) <= rad).length;
      defs[`개수 ${rad}m`] = n;
      defs[`1만명당 ${rad}m`] = pop1km ? (n / pop1km) * 10000 : NaN;
    }
    probes.push({
      name: r.input.storeName ?? r.input.storeCode,
      code: r.input.storeCode,
      target: Math.log(x.requiredShare / x.share),
      pop1km, teen1km: ages?.age10s ?? null,
      pcRooms: pcBy.get(r.input.storeCode) ?? 0,
      truncated: L.truncated,
      defs, byKind,
    });
  }
  const DEFS = RADII.flatMap((r) => [`개수 ${r}m`, `1만명당 ${r}m`]);
  const TARGETS = ["문경시청점", "양주덕정점"];
  const line = (n: number) => 2 / Math.sqrt(n);

  it("(1) 자료 상태 · 문경은 정말 갈 곳이 없나", () => {
    expect(probes.length).toBeGreaterThan(20);
    const tr = probes.filter((p) => p.truncated);
    console.log(`\n[자료] ${probes.length}곳 · 목록 잘린 매장 ${tr.length}곳`);
    if (tr.length) console.log(`  잘림: ${tr.map((t) => t.name).join(", ")}`);
    console.log("  ⚠️ 잘린 곳은 개수가 **하한**이다 — 많은 쪽이 눌려 상관이 약해지는 방향으로 편향된다.");

    const key = "1만명당 2000m";
    const usable = probes.filter((p) => Number.isFinite(p.defs[key]));
    const sorted = [...usable].sort((a, b) => a.defs[key] - b.defs[key]);
    console.log(`\n[1km 인구 1만명당 2km 안 여가시설]  중앙 ${med(usable.map((p) => p.defs[key])).toFixed(2)}곳 · 적은 순`);
    console.log("  매장          2km개수  1km인구   1만명당   노래방 당구 볼링 오락 만화 영화");
    sorted.forEach((p, i) => {
      if (i < 6 || i >= sorted.length - 3 || TARGETS.includes(p.name)) {
        console.log(
          `  ${p.name.padEnd(12)}${String(p.defs["개수 2000m"]).padStart(7)}${num(p.pop1km).padStart(9)}` +
          `${p.defs[key].toFixed(2).padStart(10)}` +
          `${String(p.byKind["노래방"] ?? 0).padStart(8)}${String(p.byKind["당구장"] ?? 0).padStart(5)}` +
          `${String(p.byKind["볼링장"] ?? 0).padStart(5)}${String(p.byKind["오락실"] ?? 0).padStart(5)}` +
          `${String(p.byKind["만화카페"] ?? 0).padStart(5)}${String(p.byKind["영화관"] ?? 0).padStart(5)}` +
          `${TARGETS.includes(p.name) ? "   <-" : ""}${p.truncated ? " [잘림]" : ""}`,
        );
      } else if (i === 6) console.log("   ...");
    });
    console.log("\n  📌 가설이 맞다면 **문경이 위쪽(적은 쪽)**에 있어야 한다.");
  });

  it("(2) ⭐ 훑기 · 사전 등록한 관문 다섯", () => {
    const t0 = probes.map((p) => p.target);
    console.log(`\n[훑기] 과녁 = log(필요÷예측) · **예측 방향은 음수** · n=${probes.length} · 단일선 ±${line(probes.length).toFixed(2)}`);
    console.log("  정의             r(순위)   관문2(두 곳 뺀 36곳)  관문3(주거 통제) 관문3(10대 통제) 관문5(PC방 통제)");
    const sub = probes.filter((p) => !TARGETS.includes(p.name));
    type Res = { def: string; r: number; r2: number; r3a: number; r3b: number; r5: number; n: number };
    const res: Res[] = [];
    for (const def of DEFS) {
      const ok = probes.filter((p) => Number.isFinite(p.defs[def]));
      const v = ok.map((p) => p.defs[def]), t = ok.map((p) => p.target);
      const r = spear(v, t);
      const ok2 = sub.filter((p) => Number.isFinite(p.defs[def]));
      const r2 = spear(ok2.map((p) => p.defs[def]), ok2.map((p) => p.target));
      const okP = ok.filter((p) => p.pop1km != null);
      const r3a = partial(okP.map((p) => p.defs[def]), okP.map((p) => p.target), okP.map((p) => p.pop1km!));
      const okT = ok.filter((p) => p.teen1km != null);
      const r3b = partial(okT.map((p) => p.defs[def]), okT.map((p) => p.target), okT.map((p) => p.teen1km!));
      const r5 = partial(v, t, ok.map((p) => p.pcRooms));
      res.push({ def, r, r2, r3a, r3b, r5, n: ok.length });
      const mk = (x: number, n: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}${Math.abs(x) >= line(n) ? "*" : " "}`;
      console.log(
        `  ${def.padEnd(15)}${mk(r, ok.length).padStart(9)}${mk(r2, ok2.length).padStart(20)}` +
        `${mk(r3a, okP.length).padStart(17)}${mk(r3b, okT.length).padStart(17)}${mk(r5, ok.length).padStart(17)}`,
      );
    }
    console.log("  (* = 그 표본 크기의 단일 유의선을 넘음. ⚠️ 훑기에서는 이 선이 느슨하다 — 관문 4를 볼 것)");

    // 관문 1은 "예측 방향(음수)"이므로, 제일 센 것을 **음수 중에서** 고르지 않는다.
    // 절대값이 제일 큰 것을 그대로 집어서 부호를 본다 — 유리하게 고르면 시험이 아니다.
    const best = [...res].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
    console.log(`\n  제일 센 정의(절대값): ${best.def}  r=${best.r >= 0 ? "+" : ""}${best.r.toFixed(3)}`);

    // 관문 4 — 훑기 보정 대조군
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
    console.log(`\n[관문 4 — 훑기 보정 대조군] 과녁을 ${N}번 섞고 같은 ${DEFS.length}가지를 훑었다 (시드 20260920)`);
    console.log(`  우연히 나오는 |r| 최대값: 중앙 ${med(maxes).toFixed(3)} · 95분위 ${p95.toFixed(3)}`);
    console.log(`  관측 |r| 최대 ${Math.abs(best.r).toFixed(3)} · p = ${pv.toFixed(4)}` + (pv < 0.05 ? "   <- 0.05 아래" : "   <- 유의선 위"));

    const g1 = best.r < 0;
    const g2 = g1 && Math.abs(best.r2) >= line(36) && best.r2 < 0;
    const g3 = g1 && best.r3a < 0 && best.r3b < 0 && Math.abs(best.r3a) >= line(best.n) && Math.abs(best.r3b) >= line(best.n);
    const g4 = pv < 0.05;
    const g5 = g1 && best.r5 < 0 && Math.abs(best.r5) >= line(best.n);
    console.log("\n[판정] 사전 등록한 관문 다섯");
    console.log(`  관문 1 부호가 예측(음수)과 같다          ${g1 ? "통과" : "⛔ 미달 — 방향이 반대다"}`);
    console.log(`  관문 2 문경·양주덕정을 빼고도 유의하다     ${g2 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 3 인구를 통제해도 남는다            ${g3 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 4 훑기 보정 대조군을 넘는다          ${g4 ? "통과" : "⛔ 미달"}`);
    console.log(`  관문 5 PC방 밀도를 통제해도 남는다        ${g5 ? "통과" : "⛔ 미달"}`);
    if (g1 && g2 && g3 && g4 && g5) {
      console.log("\n  ✅ 다섯 다 통과 -> **후보다.** 그래도 채택하지 않는다(홀드아웃은 사용자 확인 뒤).");
    } else {
      console.log("\n  ⛔ **기각.** 대체 여가시설 부족으로는 설명되지 않는다.");
    }
  });

  it("(3) 문경·양주덕정 순위 — 가설이 맞으면 어디쯤이어야 하나", () => {
    for (const key of ["개수 2000m", "1만명당 2000m"]) {
      const ok = probes.filter((p) => Number.isFinite(p.defs[key]));
      const sorted = [...ok].sort((a, b) => a.defs[key] - b.defs[key]); // 적은 순
      console.log(`\n['${key}' 적은 순]  n=${ok.length}`);
      for (const name of TARGETS) {
        const i = sorted.findIndex((x) => x.name === name);
        if (i < 0) { console.log(`  ${name} — 없음`); continue; }
        const p = sorted[i];
        console.log(
          `  ${name.padEnd(12)}${p.defs[key].toFixed(2).padStart(8)}   ${i + 1}/${ok.length}위(적은 쪽부터)   ` +
          `과녁 ${p.target >= 0 ? "+" : ""}${p.target.toFixed(3)} (배로 ${Math.exp(p.target).toFixed(2)})`,
        );
      }
      console.log("  📌 가설이 맞다면 두 곳이 **앞쪽(적은 쪽)**이어야 한다.");
    }
  });
});
