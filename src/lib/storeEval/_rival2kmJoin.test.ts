// 2km 경쟁점 — **상가업소가 실체, 인허가가 시점** (2026-09-22 밤)
//
// ── 앞의 시도에서 틀린 것 (`_rival2kmPermit.test.ts`) ─────────────────────
// 거기서는 **인허가를 기준으로** 돌면서 "상가업소에 있으면 실체가 있다"고 봤다. 틀렸다.
// 한 건물에 PC방 인허가가 대여섯 개씩 겹쳐 있는데(문정프라자·서울프라자), 그 건물 안에
// 진짜 가게 하나만 있으면 **80m 반경 매칭이 죽은 등록을 전부 살려 준다.**
//
// 안산선부점 500m 안이 그 증거다 — 그 방식으로는 34건이 잡히는데, 상호를 열어 보면:
//     "럭셔리 PC방(10.03.16 ...)" · "퍼니PC방(적발:2010.3월경)" · "해피데이PC (유선통보 2009.)"
// **2009~2010년에 단속·통보된 가게가 폐업 신고를 안 한 채 "영업"으로 남아 있다.**
// 상가업소가 아는 같은 구간 PC방은 **12건**이다.
//
// ── 그래서 결합 방향을 뒤집는다 ───────────────────────────────────────────
//   실체 = **소상공인 상가업소** (전국 동일 기준. 매장마다 반경조회라 건수 상한이 없다)
//   시점 = **인허가**를 상가업소 항목에 붙여서 본다 (상호 + 60m로 짝을 찾는다)
// 인허가는 이제 **목록을 만들지 않는다.** 이미 실체가 확인된 가게에 날짜만 달아 준다.
//
// ── 시점을 모르는 가게 (인허가 짝이 없는 37%) ─────────────────────────────
// 상가업소 ID(`MA0101 202208 ...`)에 **DB 등재 연월**이 박혀 있다. 인허가일자가 아니다
// (1:1 매칭된 533건 중 연월이 같은 건 6%뿐이고, 2022년에 570건이 한꺼번에 등재됐다).
// 그래서 **존재의 하한**으로만 쓴다: 등재 연월보다 앞선 평가창에는 없었다고 보지 않는다
// — 반대로 **세는 쪽**으로 둔다. 자료가 없다고 경쟁점을 빼면 그게 편향이 된다.
//
// ── ⚠️ 대수는 여전히 안 풀렸다 ────────────────────────────────────────────
// 운영과 같은 미조사 기본대수를 일괄로 쓴다. 전 매장에 같은 자라 **편향은 안 생기지만
// 수준은 틀릴 수 있다.** 편향(bias) 지표가 그걸 보여 준다.
//
// 준비: node scripts/collectPcBangPermits.mjs · node scripts/collectSbizPcBangs.mjs
// 실행: npx vitest run src/lib/storeEval/_rival2kmJoin.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord,
} from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_UNSURVEYED_PC_COUNT } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor, ExistingStore } from "./types";

const PERMIT_FILE = ".local-tools/pcbang-permits.json";
const SBIZ_FILE = ".local-tools/sbiz-pcbang-2km.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
const OFFICIAL_RADIUS_M = 500;
const SELF_M = 50;
/** 상가업소 항목에 인허가를 붙일 때의 자. 같은 건물 안이면 이 정도다. */
const JOIN_M = 60;
/** 상호 유사도 문턱. 이보다 낮으면 짝으로 안 본다. */
const JOIN_SIM = 0.6;

const has = hasValidationSnapshot() && existsSync(PERMIT_FILE) && existsSync(SBIZ_FILE);
const describeIf = has ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;

type Permit = {
  id: string; name: string; lat: number; lng: number;
  open: string | null; close: string | null;
  restFrom: string | null; restTo: string | null; area: number | null; gameCount: number | null;
};
type SbizStore = { id: string; name: string; lat: number; lng: number; addr: string };

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 상호 정규화 — 피시/피씨/PC를 하나로, 괄호 안(단속 메모 등)은 버린다. */
export function normalizeName(t: string | null | undefined): string {
  return String(t ?? "").replace(/\(.*?\)/g, "").replace(/피씨|피시/gi, "PC")
    .replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();
}
/** 0~1. 같으면 1, 한쪽이 다른 쪽을 품으면 0.9, 아니면 앞에서부터 겹치는 비율. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const n = Math.min(x.length, y.length);
  let c = 0;
  for (let i = 0; i < n; i++) if (x[i] === y[i]) c++;
  return c / Math.max(x.length, y.length);
}

/** 평가창 12달 중 영업한 달의 비중(0~1). 인허가 짝이 없으면 **센다**(1). */
export function operatingShare(p: Pick<Permit, "open" | "close" | "restFrom" | "restTo"> | null, months: string[]): number {
  if (!months.length) return 0;
  if (!p) return 1;                                // 시점을 모른다 -> 빼지 않는다
  const open = p.open ? p.open.slice(0, 7) : "0000-00";
  const close = p.close ? p.close.slice(0, 7) : null;
  const rf = p.restFrom ? p.restFrom.slice(0, 7) : null;
  const rt = p.restTo ? p.restTo.slice(0, 7) : null;
  let n = 0;
  for (const m of months) {
    if (m < open) continue;
    if (close && m > close) continue;
    if (rf && m >= rf && (!rt || m <= rt)) continue;
    n++;
  }
  return n / months.length;
}

describeIf("2km 경쟁점 — 상가업소가 실체, 인허가가 시점", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
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
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const rows = base.filter((r) => (r.input.actualUtilization ?? 0) > 0);
  const storeByCode = new Map<string, ExistingStore>(stores.map((s) => [s.storeCode, s]));

  const permits = (JSON.parse(readFileSync(PERMIT_FILE, "utf8")) as { rows: Permit[] }).rows;
  const sbiz = JSON.parse(readFileSync(SBIZ_FILE, "utf8")) as {
    collectedAt: string; radiusM: number;
    sites: Record<string, { lat: number; lng: number; name: string; stores: SbizStore[] }>;
  };

  type Joined = { q: SbizStore; distanceM: number; permit: Permit | null; share: number };
  const joinedByCode = new Map<string, Joined[]>();
  let totalSbiz = 0, totalMatched = 0;
  for (const r of rows) {
    const site = sbiz.sites[`existing:${r.input.storeCode}`];
    const months = evaluationMonths(storeByCode.get(r.input.storeCode)?.openedAt ?? null);
    if (!site) { joinedByCode.set(r.input.storeCode, []); continue; }
    const out: Joined[] = [];
    for (const q of site.stores) {
      const d = distanceM(site.lat, site.lng, q.lat, q.lng);
      // 500m 안은 공식 경쟁점 DB가 이미 센다 — 두 번 세지 않는다. 자기 자신도 뺀다.
      if (d <= OFFICIAL_RADIUS_M || d <= SELF_M) continue;
      totalSbiz++;
      const cand = permits
        .map((p) => ({ p, d: distanceM(q.lat, q.lng, p.lat, p.lng) }))
        .filter((x) => x.d <= JOIN_M);
      const best = cand
        .map((x) => ({ ...x, sc: nameSimilarity(q.name, x.p.name) }))
        .sort((a, b) => b.sc - a.sc || a.d - b.d)[0];
      // 상호가 맞거나, 그 자리에 인허가가 딱 하나면 그걸로 본다.
      const permit = best && (best.sc >= JOIN_SIM || cand.length === 1) ? best.p : null;
      if (permit) totalMatched++;
      out.push({ q, distanceM: d, permit, share: operatingShare(permit, months) });
    }
    joinedByCode.set(r.input.storeCode, out);
  }

  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  const withJoined = (r: LabRow, weight: (j: Joined) => number): TextbookInput => {
    const extra = (joinedByCode.get(r.input.storeCode) ?? [])
      .map((j) => ({ j, w: weight(j) }))
      .filter((x) => x.w > 0)
      .map((x) => ({
        ip: DEFAULT_UNSURVEYED_PC_COUNT * x.w,
        distanceM: x.j.distanceM, parts: null, name: x.j.q.name,
      }));
    return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
  };

  type Card = {
    n: number; mae: number; sd: number; worst: number; worstName: string;
    bias: number; within5: number; spread: number; capped: number;
  };
  const card = (make: (r: LabRow) => TextbookInput): Card => {
    const errs: { name: string; e: number; pred: number; act: number; share: number | null }[] = [];
    for (const r of rows) {
      const b = computeTextbook(make(r), P);
      const act = r.input.actualUtilization as number;
      if (b.utilization == null || !(b.utilization > 0)) continue;
      errs.push({ name: r.input.storeName ?? r.input.storeCode, e: b.utilization - act, pred: b.utilization, act, share: b.share });
    }
    const abs = errs.map((x) => Math.abs(x.e));
    const wi = abs.indexOf(Math.max(...abs));
    return {
      n: errs.length, mae: mean(abs), sd: sdOf(errs.map((x) => x.e)),
      worst: abs[wi], worstName: errs[wi].name, bias: mean(errs.map((x) => x.e)),
      within5: abs.filter((v) => v <= 0.05).length,
      spread: sdOf(errs.map((x) => x.pred)) / sdOf(errs.map((x) => x.act)),
      capped: errs.filter((x) => x.share != null && x.share >= 0.9999).length,
    };
  };

  it("(1) 결합 현황", () => {
    console.log(`\n[결합] 상가업소 ${sbiz.collectedAt.slice(0, 10)} · 인허가로 시점을 붙인다`);
    console.log(`  ${OFFICIAL_RADIUS_M}m 밖 ~ ${sbiz.radiusM}m 안 상가업소 PC방 ${totalSbiz}건`);
    console.log(`    인허가 짝을 찾음 ${totalMatched}건 (${(totalMatched / totalSbiz * 100).toFixed(0)}%) — 시점을 안다`);
    console.log(`    못 찾음 ${totalSbiz - totalMatched}건 — 시점을 모른다 -> **세는 쪽**으로 둔다`);
    const inWin = [...joinedByCode.values()].flat().filter((j) => j.share > 0).length;
    const partial = [...joinedByCode.values()].flat().filter((j) => j.share > 0 && j.share < 1).length;
    console.log(`  평가창에 영업 ${inWin}건 · 그중 창 중간에 열거나 닫은 것 ${partial}건`);
    expect(totalSbiz).toBeGreaterThan(0);
  });

  it("(2) ⭐ 성적표 — 결합 방향을 바로잡은 뒤", () => {
    const now = card((r) => r.input);
    const joined = card((r) => withJoined(r, (j) => j.share));
    const allNow = card((r) => withJoined(r, () => 1));
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(30)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}`
      + ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}`
      + `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배    ${String(c.capped).padStart(2)}곳`);
    console.log(`\n[성적표] 실체=상가업소 · 시점=인허가 · 대수=${DEFAULT_UNSURVEYED_PC_COUNT}대 일괄 · 표본 ${now.n}곳`);
    console.log(`  시나리오                          MAE       SD      최악            편향      ±5%p  퍼짐   점유율100%`);
    line("지금 — 2km를 안 센다", now);
    line("⭐ 상가업소 + 인허가 시점", joined);
    line("참고 — 시점 안 봄(전부 셈)", allNow);
    console.log(`\n  ⚠️ 대수는 일괄 ${DEFAULT_UNSURVEYED_PC_COUNT}대다. 편향이 음수로 크면 그게 과하다는 뜻이다.`);
  });

  it("(2-나) ⚠️ 편향 검정 둘 — 채택 전에 반드시 통과해야 한다", () => {
    const corr = (a: number[], b: number[]) => {
      const ma = mean(a), mb = mean(b);
      return mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / (sdOf(a) * sdOf(b));
    };
    // (가) 시점을 아는 비율이 밀도와 붙어 있나 — 붙어 있으면 시점 판정이 편향된다.
    const knownRatio: number[] = [], dens: number[] = [];
    // (나) 500m(우리 조사)와 2km(상가업소)의 **자가 다르다.** 그 차이가 밀도와 붙어 있나.
    //     붙어 있으면 도시 매장만 2km에서 더/덜 세어진다.
    const rulerRatio: number[] = [], dens2: number[] = [];
    for (const r of rows) {
      const j = joinedByCode.get(r.input.storeCode) ?? [];
      if (j.length >= 5) {
        knownRatio.push(j.filter((x) => x.permit).length / j.length);
        dens.push(Math.log(j.length));
      }
      const site = sbiz.sites[`existing:${r.input.storeCode}`];
      const mine = (r.input.rivals ?? []).length;
      if (site && mine > 0) {
        const in500 = site.stores.filter((q) => {
          const d = distanceM(site.lat, site.lng, q.lat, q.lng);
          return d > SELF_M && d <= OFFICIAL_RADIUS_M;
        }).length;
        if (in500 > 0) { rulerRatio.push(in500 / mine); dens2.push(Math.log(j.length + 1)); }
      }
    }
    const rA = corr(knownRatio, dens), rB = corr(rulerRatio, dens2);
    console.log(`\n[편향 검정] 유의선 ±0.41`);
    console.log(`  (가) 인허가 짝을 찾은 비율 vs 2km 밀도(log) · n=${dens.length}`);
    console.log(`       r = ${rA.toFixed(3)}   ${Math.abs(rA) >= 0.41 ? "⛔ 넘는다 — 시점 판정이 편향된다" : "✅ 통과"}`);
    console.log(`  (나) 500m에서 상가업소÷우리조사 건수비 vs 2km 밀도(log) · n=${dens2.length}`);
    console.log(`       중앙 ${[...rulerRatio].sort((a, b) => a - b)[Math.floor(rulerRatio.length / 2)].toFixed(2)}배`
      + ` · r = ${rB.toFixed(3)}   ${Math.abs(rB) >= 0.41 ? "⛔ 넘는다 — 500m와 2km의 자가 매장마다 다르게 어긋난다" : "✅ 통과"}`);
    console.log(`\n  ⚠️ (나)가 뜻하는 것: 500m는 사람이 고른 경쟁점만, 2km는 상가업소 전부를 센다.`);
    console.log(`     **자가 둘이다.** 중앙 비율이 1보다 크면 2km 쪽을 더 촘촘히 세는 것이고,`);
    console.log(`     그게 매장마다 같은 비율이면(r이 낮으면) 축척이 흡수한다. 다르면 편향이 된다.`);
    expect(Math.abs(rA)).toBeLessThan(0.41);
    expect(Math.abs(rB)).toBeLessThan(0.41);
  });

  it("(2-다) 내가 고른 값들의 민감도 — 결합 거리·상호 유사도", () => {
    // 이 규칙에 자유 계수는 없지만 **내가 고른 값이 셋** 있다: JOIN_M · JOIN_SIM · 500m 경계.
    // 성적이 그 값에 크게 흔들리면 그건 규칙이 아니라 손잡이다. 흔들리는지 본다.
    const rebuild = (joinM: number, joinSim: number) => {
      const map = new Map<string, Joined[]>();
      for (const r of rows) {
        const site = sbiz.sites[`existing:${r.input.storeCode}`];
        const months = evaluationMonths(storeByCode.get(r.input.storeCode)?.openedAt ?? null);
        if (!site) { map.set(r.input.storeCode, []); continue; }
        const out: Joined[] = [];
        for (const q of site.stores) {
          const d = distanceM(site.lat, site.lng, q.lat, q.lng);
          if (d <= OFFICIAL_RADIUS_M || d <= SELF_M) continue;
          const cand = permits.map((p) => ({ p, d: distanceM(q.lat, q.lng, p.lat, p.lng) })).filter((x) => x.d <= joinM);
          const best = cand.map((x) => ({ ...x, sc: nameSimilarity(q.name, x.p.name) }))
            .sort((a, b) => b.sc - a.sc || a.d - b.d)[0];
          const permit = best && (best.sc >= joinSim || cand.length === 1) ? best.p : null;
          out.push({ q, distanceM: d, permit, share: operatingShare(permit, months) });
        }
        map.set(r.input.storeCode, out);
      }
      return card((r) => {
        const extra = (map.get(r.input.storeCode) ?? []).filter((j) => j.share > 0)
          .map((j) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * j.share, distanceM: j.distanceM, parts: null, name: j.q.name }));
        return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
      });
    };
    console.log(`\n[민감도] 결합 거리와 상호 유사도를 흔들어 본다`);
    console.log(`  결합거리  유사도     MAE       최악      편향      ±5%p  퍼짐`);
    for (const [m, s] of [[30, 0.6], [60, 0.6], [100, 0.6], [60, 0.4], [60, 0.8], [60, 1.0]] as [number, number][]) {
      const c = rebuild(m, s);
      console.log(`  ${String(m).padStart(6)}m  ${s.toFixed(1).padStart(5)}  ${pp(c.mae).padStart(8)}`
        + ` ${pp(c.worst).padStart(9)} ${pp(c.bias).padStart(9)}  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배`);
    }
    console.log(`\n  ⚠️ 여기서 크게 안 흔들리면 그건 손잡이가 아니라 **결합 방식일 뿐**이다.`);
    console.log(`     흔들리면 값을 고르는 일이 되므로 사용자 확인이 필요하다.`);
  });

  it("(2-라) ⭐ 신규 후보지는 어떻게 되나 — 실제로 쓰이는 자리다", () => {
    // 사용자 물음(2026-09-22): *"이거 넣었을 때 신규후보지는 어케 되는데?"*
    // 기존점 성적이 좋아져도 **후보지 예상값이 말이 안 되게 움직이면 못 쓴다.**
    // 후보지는 실측이 없으므로 성적을 못 재고, **얼마나·어느 쪽으로 움직이는지**를 본다.
    const locByCode = new Map((snap.locationEvaluations ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => [l.candidateCode ?? l.code ?? l.id, l],
    ));
    const candRows = buildLabCandidateRows({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      candidates: (snap.candidates ?? []) as any, compsByCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      locByCode: locByCode as any, settings,
      franchiseManagement: franchiseManagementFromRows(base),
    });
    console.log(`\n[후보지] ${candRows.length}곳 · 2km를 넣으면 예상값이 어떻게 움직이나`);
    console.log(`  후보지              2km경쟁점  가동률(전->후)        예상매출(전->후)      변화`);
    const moves: number[] = [];
    const ranked: { name: string; before: number; after: number }[] = [];
    for (const c of candRows) {
      const site = sbiz.sites[`candidate:${c.input.storeCode}`];
      // 후보지는 아직 개점 전이라 평가창이 없다 -> **시점 판정을 못 한다.**
      // 지금 영업 중인 것만 세는 게 맞다(그게 개점 시점의 경쟁 환경이다).
      const extra = (site?.stores ?? [])
        .map((q) => ({ q, d: distanceM(site!.lat, site!.lng, q.lat, q.lng) }))
        .filter((x) => x.d > OFFICIAL_RADIUS_M && x.d > SELF_M)
        .map((x) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT, distanceM: x.d, parts: null, name: x.q.name }));
      const before = computeTextbook(c.input, P);
      const after = computeTextbook({ ...c.input, rivals: [...(c.input.rivals ?? []), ...extra] }, P);
      if (before.utilization == null || after.utilization == null) {
        console.log(`  ${(c.input.storeName ?? "").padEnd(18)}${String(extra.length).padStart(7)}   값이 안 나온다`);
        continue;
      }
      const bR = before.monthlyRevenue ?? 0, aR = after.monthlyRevenue ?? 0;
      const pct = bR > 0 ? (aR / bR - 1) * 100 : NaN;
      moves.push(pct);
      ranked.push({ name: c.input.storeName ?? c.input.storeCode, before: bR, after: aR });
      console.log(`  ${(c.input.storeName ?? "").padEnd(18)}${String(extra.length).padStart(7)}`
        + `   ${(before.utilization * 100).toFixed(1).padStart(5)}% -> ${(after.utilization * 100).toFixed(1).padStart(5)}%`
        + `   ${(bR / 1e4).toFixed(0).padStart(6)} -> ${(aR / 1e4).toFixed(0).padStart(6)}만`
        + `   ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
    }
    // 순위가 바뀌는가 — 후보지 결정은 대개 **줄 세우기**라 이게 실무에서 제일 중요하다.
    const rankOf = (key: "before" | "after") =>
      [...ranked].sort((a, b) => b[key] - a[key]).map((x) => x.name);
    const rb = rankOf("before"), ra = rankOf("after");
    let moved = 0;
    for (let i = 0; i < rb.length; i++) if (rb[i] !== ra[i]) moved++;
    console.log(`\n  예상매출 변화: 중앙 ${[...moves].sort((a, b) => a - b)[Math.floor(moves.length / 2)].toFixed(1)}%`
      + ` · 최소 ${Math.min(...moves).toFixed(1)}% · 최대 ${Math.max(...moves).toFixed(1)}%`);
    console.log(`  순위가 바뀐 자리 ${moved}/${rb.length}`);
    console.log(`  전  ${rb.join(" > ")}`);
    console.log(`  후  ${ra.join(" > ")}`);
    console.log(`\n  ⚠️ 후보지는 **평가창이 없다**(아직 개점 전) — 시점 판정을 못 하고 "지금 영업 중"만 센다.`);
    console.log(`     기존점과 자가 살짝 다르다. 다만 후보지는 개점 시점의 경쟁 환경이 맞는 값이라 이게 옳다.`);
    console.log(`  ⚠️ 후보지엔 실측이 없다 — **이 표는 성적이 아니라 "얼마나 움직이나"다.**`);
    expect(ranked.length).toBeGreaterThan(5);
  });

  it("(2-마) ⭐ 사용자 지적 — 성인PC방과 영세점이 섞인다. 규모로 가른다", () => {
    // 사용자(2026-09-22): *"불독은 500미터로 보면 경쟁점 4개(레드포스·녹스·불독·지원)다.
    //   게임랜드 이런 데는 성인PC방인데 오락기 있는 거."*
    //
    // 맞는 지적이고 둘 다 걸러야 한다:
    //  (가) **성인PC방/오락실** — 상가업소 업종 R10406에 섞여 있다. 그런데 인허가 자료는
    //       "인터넷컴퓨터게임시설제공업"만 담으므로 **인허가 짝이 없으면 자동으로 빠진다.**
    //       구리돌다리에서 진주게임랜드·꽃길PC라운지·세븐스타PCCAFE가 그렇게 걸렸다.
    //  (나) **영세점** — 인허가에도 있지만 우리가 경쟁으로 안 치는 급이다.
    //       우리 조사 DB의 최소가 61대인 게 그 기준선이다.
    //
    // 규모가 깨끗하게 가른다(500m · 상가업소∩인허가 영업분):
    //     우리 DB에 있음 118곳 — 면적 중앙 283㎡ · 게임기 중앙 **105대**
    //     우리 DB에 없음  35곳 — 면적 중앙  86㎡ · 게임기 중앙 **8대**
    // 구리돌다리가 그 축소판이다: 불독 458㎡/128 · 녹스 300/116 · 지원 499/145 vs
    //     물라 119/20 · 툰 109/21 · 뉴스타 113/8 · 마카오 87/7 · 교문 73/8 · 대박 55/7 · 또와 32/6
    //
    // ⛔ **문턱은 사용자가 정한다.** 여기서는 재고 표만 만든다.
    const big = (p: Permit | null, gameMin: number, areaMin: number) =>
      p != null && ((p.gameCount != null && p.gameCount >= gameMin) || (p.area != null && p.area >= areaMin));
    const cardBig = (gameMin: number, areaMin: number) => card((r) => {
      const extra = (joinedByCode.get(r.input.storeCode) ?? [])
        .filter((j) => j.share > 0 && big(j.permit, gameMin, areaMin))
        .map((j) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * j.share, distanceM: j.distanceM, parts: null, name: j.q.name }));
      return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
    });
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(30)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}`
      + ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}`
      + `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배`);
    console.log(`\n[재고 표] 규모 문턱을 바꿔 가며 — 대수는 ${DEFAULT_UNSURVEYED_PC_COUNT}대 일괄`);
    console.log(`  규칙                              MAE       SD      최악            편향      ±5%p  퍼짐`);
    line("지금 — 2km를 안 센다", card((r) => r.input));
    line("규모 안 봄(전부 셈)", card((r) => withJoined(r, (j) => j.share)));
    for (const [g, a] of [[60, 180], [70, 200], [70, 250], [100, 300]] as [number, number][]) {
      const n = [...joinedByCode.values()].flat().filter((j) => j.share > 0 && big(j.permit, g, a)).length;
      line(`게임기>=${g} 또는 면적>=${a} (${n}건)`, cardBig(g, a));
    }
    console.log(`\n  ⚠️ 우리 500m 조사를 얼마나 재현하나(같은 구간에서 잰 값):`);
    console.log(`     규모 안 봄  재현 100% · 오탐 100%(정의상)   F 0.871`);
    console.log(`     >=70/200    재현  87% · 오탐  29%           F 0.892`);
    console.log(`     >=60/180    재현  88% · 오탐  31%           F 0.893`);
    console.log(`  => 규모 필터의 추가 이득은 작다. **실체(상가업소)+업종(인허가)+영업(폐업일자)**`);
    console.log(`     세 필터가 이미 대부분 거른다. 다만 구리돌다리처럼 소형이 몰린 곳에서는 크게 갈린다.`);
  });

  it("(3) 매장별로 얼마나 붙었나", () => {
    console.log(`\n[매장별] 평가창에 영업으로 판정된 ${OFFICIAL_RADIUS_M}m 밖 경쟁점`);
    console.log(`  매장                건수  예측변화(가동률)`);
    const list = rows.map((r) => {
      const j = (joinedByCode.get(r.input.storeCode) ?? []).filter((x) => x.share > 0);
      const before = computeTextbook(r.input, P).utilization;
      const after = computeTextbook(withJoined(r, (x) => x.share), P).utilization;
      return { name: r.input.storeName ?? r.input.storeCode, n: j.length, before, after };
    }).sort((a, b) => b.n - a.n);
    for (const x of list) {
      const d = x.before != null && x.after != null ? (x.after - x.before) * 100 : NaN;
      console.log(`  ${x.name.padEnd(18)}${String(x.n).padStart(4)}   ${Number.isFinite(d) ? d.toFixed(2).padStart(7) + "%p" : "      -"}`);
    }
  });
});
