// "2km 안에 대체 PC방이 없다" — 유효 상권 가설 검정 (2026-09-19)
//
// 사용자(2026-09-19): *"양주덕정의 특징은 2키로내에 고객이 우리상권 외에 대체 PC방이 없다는
// 거야. 그게 쟁점이라고 생각함. 문경도 비슷한 맥락."*
//
// ══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 사전 등록 — **자료를 보기 전에** 정한 판정 기준이다. 고치지 말 것.
// ══════════════════════════════════════════════════════════════════════════
//
// 사용자 본인이 경고했다: *"여기 매장이 문제가 있으니 그 문제를 찾기 위한 결과맞추기일
// 수도 있으니 너가 잘 검토해봐라."* 맞는 걱정이다. 우리는 **틀린 매장 두 곳에서 출발해서
// 그 둘을 설명하는 이야기를 찾고 있다.** 그래서 아래를 미리 못 박는다.
//
//   관문 1. **두 곳을 빼고도 되는가** (제일 중요)
//           문경시청·양주덕정을 뺀 36곳에서도 유의해야 한다.
//           빼면 사라진다 = **그 두 곳을 설명하려고 만든 변수다. 기각.**
//
//   관문 2. **인구를 통제해도 남는가**
//           대체 PC방 수는 도시일수록 많다. 주거인구도 도시일수록 많다.
//           이미 주거인구 ↔ 부호오차가 r=+0.340으로 유의하다(_underserved (6)).
//           인구 순위를 통제한 편상관에서도 유의해야 한다.
//           안 남으면 = **인구의 다른 얼굴일 뿐이다. 기각.**
//
//   관문 3. **무작위 대조군**
//           대체 PC방 수 라벨을 매장들 사이에서 섞어도 같은 이득이 나오면 기각.
//
//   관문 4. **세 자를 같이 본다** (MAPE·중앙·±20%)
//           하나만 좋아지면 눈금 옮기기다(2026-09-18에 두 번 밟았다).
//
//   관문 5. **LOO** — 표본 안에서만 되는 건 안 친다.
//
//   ⚠️ 부호오차(=(예측−실매출)/실매출)로 잰다. 필요 점유율은 분모에 예측값이 들어가
//      자기 자신과 상관이 난다(2026-09-18 함정 2).
//
//   예측 방향: 대체 PC방이 **적을수록** 상권이 넓어 산식이 과소예측(부호오차 음수)
//             -> 대체 PC방 수와 부호오차는 **양의 상관**이어야 한다.
//
// ── 자료 ──────────────────────────────────────────────────────────────────
//   .local-tools/kakao-neighborhood.json  — 반경 2km 안 PC방·학교 낱개 좌표 (2026-09-19 수집)
//   sgis 주거인구에 1500·2000m 추가 수집 (2026-09-19)
//
// 실행:
//   npx vitest run src/lib/storeEval/_catchment.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, qscInWindowAverage, utilizationByStore, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, scoreTextbook, type TextbookInput } from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const NBR_FILE = ".local-tools/kakao-neighborhood.json";
const SGIS_FILE = ".local-tools/sgis-resident-population.json";
const describeIf = hasValidationSnapshot() && existsSync(NBR_FILE) ? describe : describe.skip;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "    -" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 0) => (v == null ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: d }));

/** 우리 '상권 뭉치'의 반경. 이 안은 같은 상권, 밖은 대체재로 본다. */
const CLUSTER_M = 500;

describeIf("유효 상권 — 2km 안 대체 PC방", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const locationEvaluations: LocationEvaluation[] = snap.locationEvaluations ?? [];
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  type QscSite = { openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id; if (code) qscSites.set(code, doc);
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

  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, locationEvaluations, settings);
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  type Row = (typeof rows)[number];

  // ── 이웃 자료 ────────────────────────────────────────────────────────────
  type Doc = { name: string | null; category: string | null; lat: number; lng: number; distanceM: number | null };
  type NbrSite = {
    code: string | null; name: string | null; lat: number; lng: number;
    pcRooms: { total: number | null; docs: Doc[]; truncated: boolean };
    schools: { total: number | null; docs: Doc[]; truncated: boolean };
  };
  const nbrRaw = JSON.parse(readFileSync(NBR_FILE, "utf8")) as { sites: Record<string, NbrSite> };
  const nbrByCode = new Map<string, NbrSite>();
  for (const v of Object.values(nbrRaw.sites)) if (v.code) nbrByCode.set(String(v.code), v);

  const sgis = existsSync(SGIS_FILE)
    ? (JSON.parse(readFileSync(SGIS_FILE, "utf8")) as { sites: Record<string, { code?: string; radii?: Record<string, { totalPopulation?: number | null }> }> })
    : null;
  const popByCode = new Map<string, Record<string, number | null>>();
  for (const v of Object.values(sgis?.sites ?? {})) {
    if (!v.code) continue;
    const m: Record<string, number | null> = {};
    for (const [r, x] of Object.entries(v.radii ?? {})) m[r] = x?.totalPopulation ?? null;
    popByCode.set(String(v.code), m);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawByCode = new Map<string, any>();
  for (const s of snap.existingStores ?? []) rawByCode.set(s.storeCode, s);

  const score = scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);

  const isPcRoom = (d: Doc) => (d.category ?? "").includes("PC방");
  const haversine = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const R = 6371000, toRad = (v: number) => (v * Math.PI) / 180;
    const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };

  type Probe = {
    r: Row; name: string; signed: number | null; req: number | null;
    /** 우리 뭉치(500m) 안 PC방 수 — 지금 산식이 경쟁으로 세는 범위 */
    inCluster: number;
    /** 500m 밖 2km 안 PC방 수 — **대체재**. 사용자가 말한 쟁점이다 */
    outside: number;
    /** 대체재까지의 최단거리. 없으면 2000 */
    nearestOutsideM: number;
    truncated: boolean;
    pop1km: number | null; pop2km: number | null; popRatio: number | null;
    schools: Doc[]; pcDocs: Doc[]; lat: number; lng: number;
  };

  const probes: Probe[] = [];
  for (const r of rows) {
    const nb = nbrByCode.get(r.input.storeCode);
    if (!nb) continue;
    const sr = score.rows.find((x) => x.storeCode === r.input.storeCode);
    const pcs = (nb.pcRooms?.docs ?? []).filter(isPcRoom);
    // 자기 자신은 뺀다 — 카카오가 우리 매장도 PC방으로 잡는다
    const others = pcs.filter((d) => (d.distanceM ?? 9e9) > 30);
    const inC = others.filter((d) => (d.distanceM ?? 9e9) <= CLUSTER_M);
    const out = others.filter((d) => (d.distanceM ?? 9e9) > CLUSTER_M);
    const pops = popByCode.get(r.input.storeCode) ?? {};
    const p1 = pops["1000"] ?? (rawByCode.get(r.input.storeCode)?.pop1km ?? null);
    const p2 = pops["2000"] ?? null;
    probes.push({
      r, name: r.input.storeName ?? r.input.storeCode,
      signed: sr?.predicted != null && r.actualRevenue > 0 ? (sr.predicted - r.actualRevenue) / r.actualRevenue : null,
      req: sr?.requiredShare ?? null,
      inCluster: inC.length, outside: out.length,
      nearestOutsideM: out.length ? Math.min(...out.map((d) => d.distanceM ?? 2000)) : 2000,
      truncated: !!nb.pcRooms?.truncated,
      pop1km: p1, pop2km: p2, popRatio: p1 && p2 ? p2 / p1 : null,
      schools: nb.schools?.docs ?? [], pcDocs: others, lat: nb.lat, lng: nb.lng,
    });
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const out = new Array(v.length).fill(0);
    idx.forEach(([, i], k) => { out[i] = k; });
    return out;
  };
  const pear = (a: number[], b: number[]) => {
    const ma = mean(a), mb = mean(b);
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
  };
  const spear = (a: number[], b: number[]) => pear(rank(a), rank(b));
  /** 편상관 — c를 통제하고 a↔b. 순위로 계산한다. */
  const partial = (a: number[], b: number[], c: number[]) => {
    const rab = spear(a, b), rac = spear(a, c), rbc = spear(b, c);
    const den = Math.sqrt((1 - rac * rac) * (1 - rbc * rbc));
    return den > 0 ? (rab - rac * rbc) / den : 0;
  };
  const tOf = (r: number, n: number, k = 0) => Math.abs(r) * Math.sqrt((n - 2 - k) / Math.max(1e-9, 1 - r * r));
  const crit = (n: number) => (n > 40 ? 2.02 : n > 30 ? 2.03 : n > 25 ? 2.06 : 2.09);
  const line = (label: string, r: number, n: number, k = 0) => {
    const t = tOf(r, n, k);
    return `${label.padEnd(30)} r = ${r.toFixed(3).padStart(6)}  n=${String(n).padStart(2)}  t = ${t.toFixed(2).padStart(5)} (선 ${crit(n)})  ${t > crit(n) ? "**유의**" : "  -"}`;
  };

  // ────────────────────────────────────────────────────────────────────────
  it("(1) 대체 PC방 명부 — 38곳", () => {
    console.log(`\n══ (1) 반경 2km 안 PC방 (우리 뭉치 = ${CLUSTER_M}m 안) ══`);
    const sorted = [...probes].sort((a, b) => a.outside - b.outside);
    console.log(`  ${"매장".padEnd(14)}${"뭉치안".padStart(7)}${"대체재".padStart(7)}${"최단대체".padStart(9)}` +
      `${"주거1km".padStart(9)}${"주거2km".padStart(9)}${"2km/1km".padStart(9)}${"부호오차".padStart(9)}${"필요점유율".padStart(10)}`);
    for (const p of sorted) {
      console.log(`  ${p.name.padEnd(14)}${String(p.inCluster).padStart(7)}${String(p.outside).padStart(7)}` +
        `${`${Math.round(p.nearestOutsideM)}m`.padStart(9)}${num(p.pop1km).padStart(9)}${num(p.pop2km).padStart(9)}` +
        `${(p.popRatio == null ? "-" : p.popRatio.toFixed(2)).padStart(9)}${pct(p.signed).padStart(9)}${pct(p.req).padStart(10)}` +
        `${p.truncated ? "  ⚠️45건잘림" : ""}`);
    }
    expect(probes.length).toBeGreaterThan(30);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(2) 관문 1·2 — 두 곳 빼고도 되나, 인구 통제해도 남나", () => {
    const usable = probes.filter((p) => p.signed != null && p.pop1km != null);
    const TWO = /문경시청|양주덕정/;
    console.log(`\n══ (2) 사전 등록한 관문 1·2 ══`);
    console.log(`  예측 방향: 대체 PC방이 적을수록 과소예측 -> **양의 상관**이어야 한다\n`);

    const run = (label: string, g: Probe[]) => {
      const y = g.map((p) => p.signed as number);
      const xOut = g.map((p) => p.outside);
      const xNear = g.map((p) => p.nearestOutsideM);
      const xPop = g.map((p) => p.pop1km as number);
      console.log(`  [${label}] n=${g.length}`);
      console.log(`    ${line("대체 PC방 수", spear(xOut, y), g.length)}`);
      console.log(`    ${line("최단 대체재 거리", spear(xNear, y), g.length)}`);
      console.log(`    ${line("주거인구 1km (견줌)", spear(xPop, y), g.length)}`);
      console.log(`    ${line("대체 PC방 수 | 인구 통제", partial(xOut, y, xPop), g.length, 1)}`);
      console.log(`    ${line("주거인구 | 대체PC방 통제", partial(xPop, y, xOut), g.length, 1)}`);
    };
    run("전체", usable);
    console.log("");
    run("문경시청·양주덕정 뺀 나머지", usable.filter((p) => !TWO.test(p.name)));

    console.log(`\n  ⚠️ 관문 1: 두 곳을 빼면 사라지는가. 관문 2: 인구를 통제해도 남는가.`);
    console.log(`     둘 중 하나라도 못 넘으면 기각이다 — 파일 머리에 사전 등록해 뒀다.`);
    expect(usable.length).toBeGreaterThan(30);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(3) 대체재 유무로 갈라서 — 상관 하나에 기대지 않는다", () => {
    const usable = probes.filter((p) => p.signed != null);
    console.log(`\n══ (3) 대체 PC방 수로 갈라서 ══`);
    console.log(`    ${"구간".padEnd(16)}${"곳수".padStart(5)}${"대체재 중앙".padStart(12)}${"부호오차 중앙".padStart(14)}` +
      `${"필요점유율 중앙".padStart(15)}${"주거1km 중앙".padStart(13)}`);
    const buckets: [string, (p: Probe) => boolean][] = [
      ["대체재 0~2곳", (p) => p.outside <= 2],
      ["3~7곳", (p) => p.outside > 2 && p.outside <= 7],
      ["8~19곳", (p) => p.outside > 7 && p.outside <= 19],
      ["20곳 이상", (p) => p.outside > 19],
    ];
    for (const [label, f] of buckets) {
      const g = usable.filter(f);
      if (!g.length) continue;
      console.log(`    ${label.padEnd(16)}${String(g.length).padStart(5)}${num(med(g.map((p) => p.outside))).padStart(12)}` +
        `${pct(med(g.map((p) => p.signed as number))).padStart(14)}` +
        `${pct(med(g.map((p) => p.req).filter((v): v is number => v != null))).padStart(15)}` +
        `${num(med(g.map((p) => p.pop1km).filter((v): v is number => v != null))).padStart(13)}`);
    }
    console.log(`\n  ⚠️ 맨 왼쪽 칸(대체재 0~2곳)에 문경·양주덕정이 들어 있다. 그 둘을 빼고도`);
    console.log(`     같은 모양이 남는지가 관문 1이다.`);
    const g0 = usable.filter((p) => p.outside <= 2 && !/문경시청|양주덕정/.test(p.name));
    console.log(`    ${"(두 곳 뺀 0~2곳)".padEnd(16)}${String(g0.length).padStart(5)}${num(med(g0.map((p) => p.outside))).padStart(12)}` +
      `${pct(med(g0.map((p) => p.signed as number))).padStart(14)}` +
      `${pct(med(g0.map((p) => p.req).filter((v): v is number => v != null))).padStart(15)}` +
      `${num(med(g0.map((p) => p.pop1km).filter((v): v is number => v != null))).padStart(13)}`);
    console.log(`      -> ${g0.map((p) => p.name).join(" · ")}`);
    expect(usable.length).toBeGreaterThan(30);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(4) 문경 관찰 재현 — 학교에서 본 거리", () => {
    // 사용자: *"점촌고, 문경여중, 점촌중에서 최단거리 PC방이 우리 문경시청점이랑 크라우드가
    // 거리 차이가 얼마 안 난다. 우리 매장이랑 크라우드는 1.5km 떨어져 있는데."*
    //
    // 매장↔매장 거리로 경쟁을 세면 클라우드는 "멀어서 경쟁 아님"인데, **학교에서 보면** 둘 다
    // 비슷한 거리다. 그게 사실이면 경쟁도 수요도 매장 중심 반경으로 세면 안 된다는 뜻이다.
    console.log(`\n══ (4) 학교에서 본 거리 — 우리 vs 가장 가까운 다른 PC방 ══`);
    for (const p of probes.filter((x) => /문경시청|양주덕정/.test(x.name))) {
      const schools = p.schools.filter((s) => /고등학교|중학교|초등학교/.test(s.name ?? ""));
      // ⚠️ 우리 뭉치(500m 안) 경쟁점은 뺀다. 그들은 우리와 사실상 같은 자리라 "학교에서 보면
      //    누가 가깝나"를 물어도 늘 몇십 m 차이로 갈릴 뿐, 사용자가 물은 건 그게 아니다.
      //    물음은 **"멀리 있는 다른 뭉치와 견주면 어떠냐"**다(문경의 클라우드가 그 예다).
      const alts = p.pcDocs.filter((d) => (d.distanceM ?? 0) > CLUSTER_M);
      console.log(`\n  ${p.name} — 2km 안 학교 ${schools.length}곳` +
        ` · 우리 뭉치 밖 대체 PC방 ${alts.length}곳 (뭉치 안 ${p.inCluster}곳은 뺐다)`);
      if (!alts.length) { console.log(`    대체재가 없다 — 2km 안에서는 우리 뭉치가 유일하다.`); continue; }
      console.log(`    ${"학교".padEnd(20)}${"우리까지".padStart(9)}${"가장가까운 대체재".padStart(18)}${"거리차".padStart(8)}   그 PC방`);
      const advs: number[] = [];
      for (const s of schools.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0)).slice(0, 12)) {
        const dUs = haversine(s.lat, s.lng, p.lat, p.lng);
        let best: { d: number; name: string } | null = null;
        for (const c of alts) {
          const d = haversine(s.lat, s.lng, c.lat, c.lng);
          if (!best || d < best.d) best = { d, name: c.name ?? "-" };
        }
        if (!best) continue;
        advs.push(best.d / dUs);
        console.log(`    ${String(s.name ?? "-").slice(0, 19).padEnd(20)}${`${Math.round(dUs)}m`.padStart(9)}` +
          `${`${Math.round(best.d)}m`.padStart(18)}${`${best.d > dUs ? "+" : ""}${Math.round(best.d - dUs)}m`.padStart(8)}   ${best.name}`);
      }
      if (advs.length) {
        const closer = advs.filter((v) => v > 1).length;
        const tie = advs.filter((v) => Math.abs(v - 1) <= 0.2).length;
        console.log(`    -> 우리가 더 가까운 학교 ${closer}/${advs.length}곳 · 거리비 중앙 ${med(advs)?.toFixed(2)}배` +
          ` · 사실상 등거리(±20%) ${tie}곳`);
      }
    }
    console.log(`\n  읽는 법: 거리비가 1 언저리면 학생 입장에선 **둘 다 선택지**다(사용자 관찰).`);
    console.log(`  1보다 크게 높으면 그 학교 수요는 우리가 독점에 가깝다는 뜻이다.`);
    expect(probes.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(5) 관문 3·4·5 — 수요 반경을 2km로 바꾸면 38곳이 어떻게 되나", () => {
    // 근사다: 주거인구만 2km 값으로 갈아끼운다(연령 분포는 1km 것을 비율로 늘린다).
    // 유동인구(400m)는 그대로다 — 소상공인365에 2km가 없다.
    const scaled = (mode: "none" | "all" | "byGap") => rows.map((r) => {
      const p = probes.find((x) => x.r.input.storeCode === r.input.storeCode);
      if (!p || p.popRatio == null || mode === "none") return r;
      // byGap: 대체재가 적은 매장만 넓힌다 — 사용자 기전을 글자 그대로 옮긴 것
      const k = mode === "all" ? p.popRatio : (p.outside <= 2 ? p.popRatio : 1);
      const ages = r.input.residentAges;
      const input: TextbookInput = {
        ...r.input,
        pop1km: (r.input.pop1km ?? 0) * k,
        residentAges: ages ? Object.fromEntries(Object.entries(ages).map(([a, v]) => [a, (v as number) * k])) as typeof ages : ages,
      };
      return { ...r, input };
    });

    const show = (label: string, rs: typeof rows) => {
      const s = scoreTextbook(rs, DEFAULT_TEXTBOOK_PARAMS);
      console.log(`  ${label.padEnd(28)} A=${s.fittedHoursPerUser.toFixed(3)}  MAPE ${pct(s.mape, 2)}  중앙 ${pct(s.medianAbsErr)}` +
        `  ±20% ${pct(s.within20, 0)}  최대 ${pct(s.maxAbsErr, 0)}  100%초과 ${s.requiredShare?.overOne}곳`);
      return s;
    };
    console.log(`\n══ (5) 주거 반경을 넓히면 (유동 400m은 그대로) ══`);
    show("지금 (주거 1km)", rows);
    show("전부 2km로", scaled("all"));
    show("대체재 0~2곳만 2km로", scaled("byGap"));

    // 관문 3 — 무작위 대조군. "대체재 적은 곳"을 아무 데나 골라도 같은 이득이 나오나
    const TRIALS = 300;
    let seed = 20260919;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const realTargets = probes.filter((p) => p.outside <= 2).map((p) => p.r.input.storeCode);
    const codes = rows.map((r) => r.input.storeCode);
    const scoreWithTargets = (targets: Set<string>) => {
      const rs = rows.map((r) => {
        const p = probes.find((x) => x.r.input.storeCode === r.input.storeCode);
        if (!p || p.popRatio == null || !targets.has(r.input.storeCode)) return r;
        const ages = r.input.residentAges;
        const input: TextbookInput = {
          ...r.input, pop1km: (r.input.pop1km ?? 0) * p.popRatio,
          residentAges: ages ? Object.fromEntries(Object.entries(ages).map(([a, v]) => [a, (v as number) * p.popRatio!])) as typeof ages : ages,
        };
        return { ...r, input };
      });
      return scoreTextbook(rs, DEFAULT_TEXTBOOK_PARAMS);
    };
    const real = scoreWithTargets(new Set(realTargets));
    const mapes: number[] = [], meds: number[] = [], w20s: number[] = [];
    for (let k = 0; k < TRIALS; k++) {
      const pool = [...codes];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const s = scoreWithTargets(new Set(pool.slice(0, realTargets.length)));
      if (s.mape != null) mapes.push(s.mape);
      if (s.medianAbsErr != null) meds.push(s.medianAbsErr);
      if (s.within20 != null) w20s.push(s.within20);
    }
    const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
    const pv = (a: number[], v: number, low: boolean) => (low ? a.filter((x) => x <= v).length : a.filter((x) => x >= v).length) / a.length;
    console.log(`\n  [관문 3] 무작위 대조군 ${TRIALS}회 — 같은 개수(${realTargets.length}곳)를 아무 데나 골라 2km로 넓힌다`);
    console.log(`    ${"".padEnd(8)}${"섞음 5%".padStart(9)}${"섞음 중앙".padStart(10)}${"섞음 95%".padStart(9)}${"진짜 고름".padStart(10)}   p값`);
    console.log(`    ${"MAPE".padEnd(8)}${pct(q(mapes, 0.05), 2).padStart(9)}${pct(q(mapes, 0.5), 2).padStart(10)}${pct(q(mapes, 0.95), 2).padStart(9)}` +
      `${pct(real.mape, 2).padStart(10)}   ${pv(mapes, real.mape as number, true).toFixed(3)}`);
    console.log(`    ${"중앙".padEnd(8)}${pct(q(meds, 0.05)).padStart(9)}${pct(q(meds, 0.5)).padStart(10)}${pct(q(meds, 0.95)).padStart(9)}` +
      `${pct(real.medianAbsErr).padStart(10)}   ${pv(meds, real.medianAbsErr as number, true).toFixed(3)}`);
    console.log(`    ${"±20%".padEnd(8)}${pct(q(w20s, 0.05), 0).padStart(9)}${pct(q(w20s, 0.5), 0).padStart(10)}${pct(q(w20s, 0.95), 0).padStart(9)}` +
      `${pct(real.within20, 0).padStart(10)}   ${pv(w20s, real.within20 as number, false).toFixed(3)}`);
    console.log(`\n  ⚠️ 관문 4(세 자 같이) · 관문 5(LOO)도 같이 볼 것. MAPE만 좋아지면 기각이다.`);
    expect(mapes.length).toBe(TRIALS);
  });

  // ────────────────────────────────────────────────────────────────────────
  it("(6) 관문 5 + 결과맞추기 검사 — 이게 제일 중요하다", () => {
    // (5)에서 "대체재 0~2곳만 2km로"가 MAPE 22.51->20.53%, ±20% 63->66%, 최대 62->59%로
    // 세 자가 같이 좋아졌고 대조군도 넘었다. 그런데 **그 셋 중 하나가 양주덕정**이다.
    // 우리가 출발한 문제 매장이다. 그리고 문턱 "2곳 이하"도 자료를 보고 정한 것이다.
    //
    // 사용자 경고를 그대로 옮기면: *"여기 매장이 문제가 있으니 그 문제를 찾기 위한
    // 결과맞추기일 수도 있다."* 그래서 셋을 더 본다.
    //
    //   (가) 양주덕정을 빼고 나머지 둘만 넓혀도 좋아지나  <- 독립 증거가 있나
    //   (나) 그냥 "제일 과소예측된 3곳"을 넓히면 얼마나 좋아지나  <- 상한선. 여기 가까우면
    //        대체재 지표가 기전이 아니라 **과소예측의 다른 이름**일 뿐이다
    //   (다) LOO — 한 곳 빼고 축척 맞춘 뒤 그 곳 맞히기
    const widen = (targets: Set<string>) => rows.map((r) => {
      const p = probes.find((x) => x.r.input.storeCode === r.input.storeCode);
      if (!p || p.popRatio == null || !targets.has(r.input.storeCode)) return r;
      const ages = r.input.residentAges;
      const input: TextbookInput = {
        ...r.input, pop1km: (r.input.pop1km ?? 0) * p.popRatio,
        residentAges: ages ? Object.fromEntries(Object.entries(ages).map(([a, v]) => [a, (v as number) * p.popRatio!])) as typeof ages : ages,
      };
      return { ...r, input };
    });
    const codeOf = (re: RegExp) => probes.filter((p) => re.test(p.name)).map((p) => p.r.input.storeCode);
    const gap2 = probes.filter((p) => p.outside <= 2);
    const show = (label: string, rs: typeof rows) => {
      const s = scoreTextbook(rs, DEFAULT_TEXTBOOK_PARAMS);
      console.log(`  ${label.padEnd(34)} MAPE ${pct(s.mape, 2)}  중앙 ${pct(s.medianAbsErr)}  ±20% ${pct(s.within20, 0)}` +
        `  최대 ${pct(s.maxAbsErr, 0)}  100%초과 ${s.requiredShare?.overOne}곳`);
    };

    console.log(`\n══ (6) 결과맞추기 검사 ══`);
    console.log(`  대체재 0~2곳: ${gap2.map((p) => p.name).join(" · ")}\n`);
    show("지금", rows);
    show("대체재 0~2곳 전부 (3곳)", widen(new Set(gap2.map((p) => p.r.input.storeCode))));
    show("  └ 양주덕정 빼고 (2곳)", widen(new Set(gap2.map((p) => p.r.input.storeCode).filter((c) => !codeOf(/양주덕정/).includes(c)))));
    show("  └ 양주덕정만 (1곳)", widen(new Set(codeOf(/양주덕정/))));

    // (나) 상한선 — 과소예측 큰 순서로 3곳
    const worst3 = [...probes].filter((p) => p.signed != null)
      .sort((a, b) => (a.signed as number) - (b.signed as number)).slice(0, 3);
    console.log("");
    show(`[상한선] 과소예측 3곳 (${worst3.map((p) => p.name).join("·")})`, widen(new Set(worst3.map((p) => p.r.input.storeCode))));
    console.log(`     -> 대체재 지표가 이 상한선에 가까우면 기전이 아니라 "과소예측의 다른 이름"이다`);

    // (다) LOO — 넓히는 규칙은 고정, 축척만 한 곳 빼고 맞춘 뒤 그 곳 채점
    console.log(`\n  [관문 5] LOO — 한 곳 빼고 축척 맞춘 뒤 그 곳을 맞힌다`);
    const looOf = (label: string, rs: typeof rows) => {
      const errs: number[] = [];
      for (let i = 0; i < rs.length; i++) {
        const train = rs.filter((_, j) => j !== i);
        const s = scoreTextbook(train, DEFAULT_TEXTBOOK_PARAMS);
        const full = { ...DEFAULT_TEXTBOOK_PARAMS, hoursPerUserPerMonth: s.fittedHoursPerUser, productUnitPrice: s.fittedProductUnitPrice };
        // ⚠️ `scoreTextbook`은 넘긴 행으로 축척을 **다시 맞춘다.** 뺀 한 곳만 넘기면 그 곳에
        //    딱 맞춰져 오차가 0이 된다(2026-09-19에 실제로 그렇게 짜서 LOO 0.00%가 나왔다).
        //    학습 표본으로 맞춘 파라미터로 **직접** 계산해야 한다.
        const b = computeTextbook(rs[i].input, full);
        if (b.monthlyRevenue != null && rs[i].actualRevenue > 0) {
          errs.push(Math.abs(b.monthlyRevenue - rs[i].actualRevenue) / rs[i].actualRevenue);
        }
      }
      const s = [...errs].sort((a, b) => a - b);
      console.log(`    ${label.padEnd(32)} LOO MAPE ${pct(s.reduce((a, b) => a + b, 0) / s.length, 2)}` +
        `  중앙 ${pct(s[Math.floor(s.length / 2)])}  ±20% ${pct(s.filter((v) => v <= 0.2).length / s.length, 0)}`);
    };
    looOf("지금", rows);
    looOf("대체재 0~2곳 전부", widen(new Set(gap2.map((p) => p.r.input.storeCode))));
    looOf("양주덕정 빼고", widen(new Set(gap2.map((p) => p.r.input.storeCode).filter((c) => !codeOf(/양주덕정/).includes(c)))));

    console.log(`\n  ⚠️ LOO는 축척만 홀드아웃한다 — "대체재 0~2곳" 규칙 자체는 38곳을 보고 만든 게`);
    console.log(`     아니라 카카오 자료에서 바로 나오는 값이라 홀드아웃 대상이 아니다.`);
    console.log(`     다만 **문턱 2곳은 내가 자료를 보고 정했다.** 그건 여전히 자유도다.`);
    expect(gap2.length).toBeGreaterThan(0);
  });
});
