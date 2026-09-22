// 2km 경쟁점을 **인허가 자료로 자동 판정**한다 (2026-09-22)
//
// ── 무엇이 달라지나 ───────────────────────────────────────────────────────
// 지도(카카오)는 "지금"만 안다. 산식이 필요한 건 **평가창 당시 영업 여부**다.
// 인허가 자료에는 `인허가일자`와 `폐업일자`가 있어 임의 시점의 상태가 정확히 나온다.
//   탕정역점 평가창 2024-07~2025-06 · 남악점 2025-03~2026-02 처럼 매장마다 창이 다르다.
//   탕정역 73m·90m(레벨업·레드포스)가 그 사례다 — 지금은 있지만 평가창엔 없었다.
//   반대 경우(평가창엔 있었는데 지금 폐업)도 똑같이 생긴다.
//
// ── 판정 규칙 (결과 보기 전에 고정한다) ───────────────────────────────────
// 1. 한 경쟁점의 무게 = **평가창 12달 중 영업한 달의 비중**(0~1)이다.
//    창 중간에 문을 닫았으면 그동안은 실제로 경쟁했으므로 그만큼만 센다.
//    ⚠️ "지금 영업 중인가"가 아니다. 켜고 끄는 이분법도 아니다.
// 2. 인허가일자가 없으면 **창 시작 전부터 있었다고 본다**(자료 결측을 경쟁점 제거로
//    바꾸지 않는다 — 빼는 쪽이 아니라 세는 쪽이 보수적이다).
// 3. 휴업 구간(TCBIZ_BGNG_YMD~TCBIZ_END_YMD)은 영업하지 않은 달로 뺀다.
// 4. **500m 안은 뺀다.** 공식 경쟁점 DB가 이미 세고 있어 두 번 세게 된다.
// 5. 자기 자신(50m 안)은 뺀다. 우리 매장도 인허가 대상이라 목록에 들어 있다.
// 6. 대수는 운영과 같은 미조사 기본대수. **인허가에 PC 대수는 없다**
//    (총게임기수는 채움률 71%에 중앙값 7대라 대수가 아니다).
// 7. 품질은 모른다 -> parts: null (비율 1). 500m 안 미조사 경쟁점과 같은 대우다.
//
// ── ⚠️ 전체 매장에 한꺼번에 적용한다 ──────────────────────────────────────
// 사용자 규칙: 판정이 많이 된 매장만 경쟁점이 늘면 그 매장만 불리해진다. 부분 적용 금지.
// 인허가 자료는 전국이라 **40곳 전부가 같은 자로 판정된다** — 그게 이 방법의 핵심이다.
//
// ⚠️ 측정만 한다. 채택은 사용자가 정한다.
//
// 준비:  node scripts/collectPcBangPermits.mjs     (.local-tools/pcbang-permits.json)
// 실행:  npx vitest run src/lib/storeEval/_rival2kmPermit.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_UNSURVEYED_PC_COUNT } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
  type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor, ExistingStore } from "./types";

const PERMIT_FILE = ".local-tools/pcbang-permits.json";
const NEIGHBOR_FILE = ".local-tools/kakao-neighborhood.json";
/** 소상공인 상가업소 — 전국 동일 기준. `scripts/collectSbizPcBangs.mjs`가 뜬다. */
const SBIZ_FILE = ".local-tools/sbiz-pcbang-2km.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
const OFFICIAL_RADIUS_M = 500;
const SELF_M = 50;
const OUTER_RADIUS_M = 2000;

const has = hasValidationSnapshot() && existsSync(PERMIT_FILE);
const describeIf = has ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;

type Permit = {
  id: string; name: string; lat: number; lng: number;
  open: string | null; close: string | null;
  status: string; detail: string;
  restFrom: string | null; restTo: string | null;
  addr: string; area: number | null; gameCount: number | null;
};

/** 하버사인. 수백 m 규모라 이걸로 충분하다. */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * 평가창 12달 중 이 경쟁점이 영업한 달의 비중(0~1).
 * `months`는 "YYYY-MM" 배열이다. 한 달이라도 영업했으면 그 달은 영업으로 센다
 * (달 안의 날짜까지 따지지 않는다 — 자료의 자가 달 단위다).
 */
export function operatingShare(p: Pick<Permit, "open" | "close" | "restFrom" | "restTo">, months: string[]): number {
  if (!months.length) return 0;
  // 인허가일자가 없으면 창 시작 전부터 있었다고 본다(결측을 제거로 바꾸지 않는다).
  const open = p.open ? p.open.slice(0, 7) : "0000-00";
  const close = p.close ? p.close.slice(0, 7) : null;
  const rf = p.restFrom ? p.restFrom.slice(0, 7) : null;
  const rt = p.restTo ? p.restTo.slice(0, 7) : null;
  let n = 0;
  for (const m of months) {
    if (m < open) continue;                       // 아직 안 열었다
    if (close && m > close) continue;             // 이미 닫았다
    if (rf && m >= rf && (!rt || m <= rt)) continue; // 휴업 중
    n++;
  }
  return n / months.length;
}

describeIf("2km 경쟁점 — 인허가 자동 판정", () => {
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
  /** ⚠️ `excluded`로 거르지 않는다 — 송도·동탄북광장이 빠진다. */
  const rows = base.filter((r) => (r.input.actualUtilization ?? 0) > 0);

  const permitFile = JSON.parse(readFileSync(PERMIT_FILE, "utf8")) as {
    collectedAt: string; totalCount: number; saved: number; rows: Permit[];
  };
  const permits = permitFile.rows;

  /** 매장 좌표 — 카카오 수집 때 쓴 것과 **같은 좌표**를 쓴다(자를 둘로 만들지 않는다). */
  const neighbor = existsSync(NEIGHBOR_FILE)
    ? JSON.parse(readFileSync(NEIGHBOR_FILE, "utf8")) as {
      sites: Record<string, { lat: number; lng: number; pcRooms?: { docs?: { distanceM: number }[] } }>;
    }
    : { sites: {} };
  const storeByCode = new Map<string, ExistingStore>(stores.map((s) => [s.storeCode, s]));
  const coordOf = (code: string) => {
    const site = neighbor.sites[`existing:${code}`];
    if (site && Number.isFinite(site.lat) && Number.isFinite(site.lng)) return { lat: site.lat, lng: site.lng };
    const s = storeByCode.get(code) as unknown as Record<string, number | undefined> | undefined;
    const lat = s?.lat ?? s?.latitude, lng = s?.lng ?? s?.longitude;
    return lat != null && lng != null ? { lat, lng } : null;
  };

  type Near = { p: Permit; distanceM: number; share: number };
  /** 매장코드 -> 500m 밖 2km 안 인허가 PC방(평가창 영업 비중 포함). */
  const nearByCode = new Map<string, Near[]>();
  const monthsByCode = new Map<string, string[]>();
  for (const r of rows) {
    const c = coordOf(r.input.storeCode);
    const months = evaluationMonths(storeByCode.get(r.input.storeCode)?.openedAt ?? null);
    monthsByCode.set(r.input.storeCode, months);
    if (!c) { nearByCode.set(r.input.storeCode, []); continue; }
    const out: Near[] = [];
    for (const p of permits) {
      const d = distanceM(c.lat, c.lng, p.lat, p.lng);
      if (d > OUTER_RADIUS_M || d <= OFFICIAL_RADIUS_M || d <= SELF_M) continue;
      out.push({ p, distanceM: d, share: operatingShare(p, months) });
    }
    nearByCode.set(r.input.storeCode, out);
  }

  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  /** 시나리오대로 2km 경쟁점을 붙인 입력. weight가 0이면 안 센다. */
  const withPermits = (r: LabRow, weight: (n: Near) => number): TextbookInput => {
    const extra = (nearByCode.get(r.input.storeCode) ?? [])
      .map((n) => ({ n, w: weight(n) }))
      .filter((x) => x.w > 0)
      .map((x) => ({
        // 인허가에 대수가 없다 — 운영과 같은 미조사 기본대수에 영업 비중을 곱한다.
        ip: DEFAULT_UNSURVEYED_PC_COUNT * x.w,
        distanceM: x.n.distanceM,
        parts: null,
        name: x.n.p.name,
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

  it("(1) 자료 대조 — 인허가가 지도보다 무엇을 더 아는가", () => {
    const openNow = permits.filter((p) => !p.close).length;
    console.log(`\n[인허가] 수집 ${permitFile.collectedAt.slice(0, 10)} · 전국 ${permitFile.totalCount.toLocaleString()}건 중`
      + ` 좌표 있는 ${permits.length.toLocaleString()}건`);
    console.log(`  지금 영업 ${openNow.toLocaleString()} · 폐업 ${(permits.length - openNow).toLocaleString()}`);
    let sumAll = 0, sumOpenNow = 0, sumInWindow = 0, partial = 0;
    for (const r of rows) {
      const near = nearByCode.get(r.input.storeCode) ?? [];
      sumAll += near.length;
      sumOpenNow += near.filter((n) => !n.p.close).length;
      sumInWindow += near.filter((n) => n.share > 0).length;
      partial += near.filter((n) => n.share > 0 && n.share < 1).length;
    }
    console.log(`\n  ${OFFICIAL_RADIUS_M}m 밖 ~ ${OUTER_RADIUS_M}m 안, 매장 ${rows.length}곳 합계`);
    console.log(`    인허가에 있는 전체(폐업 포함)   ${sumAll}건`);
    console.log(`    지금 영업 중                    ${sumOpenNow}건   <- 지도가 보여 주는 것`);
    console.log(`    **평가창에 영업**               ${sumInWindow}건   <- 산식이 필요한 것`);
    console.log(`    그중 창 중간에 열거나 닫은 것    ${partial}건  (0<비중<1)`);
    console.log(`  ⚠️ "지금 영업"과 "평가창에 영업"의 차이가 이 작업의 전부다.`);
    expect(sumInWindow).toBeGreaterThan(0);
  });

  it("(2) ⭐ 탕정역 검증 — 레벨업·레드포스가 평가창 밖으로 걸러지나", () => {
    const t = rows.find((r) => (r.input.storeName ?? "").includes("탕정역"));
    if (!t) { console.log("\n[탕정역] 표본에 없다 — 건너뛴다"); return; }
    const months = monthsByCode.get(t.input.storeCode) ?? [];
    const c = coordOf(t.input.storeCode);
    console.log(`\n[탕정역] 평가창 ${months[0]} ~ ${months[months.length - 1]} (${months.length}달)`);
    if (!c) { console.log("  좌표가 없다"); return; }
    // 이 검증만은 500m 안까지 본다 — 레벨업·레드포스가 73m·90m다.
    const all = permits
      .map((p) => ({ p, d: distanceM(c.lat, c.lng, p.lat, p.lng) }))
      .filter((x) => x.d <= OUTER_RADIUS_M && x.d > SELF_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    console.log(`  거리   상호                   인허가       폐업        평가창 영업비중`);
    for (const { p, d } of all) {
      console.log(`  ${String(Math.round(d)).padStart(5)}m ${p.name.slice(0, 20).padEnd(22)}`
        + `${(p.open ?? "-").padEnd(12)}${(p.close ?? "-").padEnd(12)}`
        + `${(operatingShare(p, months) * 100).toFixed(0).padStart(4)}%`);
    }
    console.log(`  ⚠️ 인계문: 73m·90m(레벨업·레드포스)는 **최근 개점이라 평가창 대상이 아니다**(사용자 확인).`);
    console.log(`     위 표의 인허가일자가 평가창 끝(${months[months.length - 1]})보다 늦으면 자동으로 걸러진 것이다.`);
  });

  it("(3) 성적표 — 지금 vs 인허가 판정", () => {
    const now = card((r) => r.input);
    const judged = card((r) => withPermits(r, (n) => n.share));
    const openNow = card((r) => withPermits(r, (n) => (n.p.close ? 0 : 1)));
    const all = card((r) => withPermits(r, () => 1));
    console.log(`\n[성적표] 판정 기준 = 가동률 · 표본 ${now.n}곳 · 외부옵션 ${P.outsideOptionIp}대`);
    console.log(`  시나리오                      MAE       SD      최악            편향      ±5%p  퍼짐   점유율100%`);
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(26)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}`
      + ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}`
      + `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배    ${String(c.capped).padStart(2)}곳`);
    line("지금 — 안 센다", now);
    line("⭐ 인허가 — 평가창 영업", judged);
    line("참고 — 지금 영업 중만", openNow);
    line("참고 — 폐업까지 전부", all);
    console.log(`\n  ⚠️ '지금 영업 중만'과 '평가창 영업'의 차이가 **시점을 맞춰서 생긴 몫**이다.`);
    console.log(`  ⚠️ '폐업까지 전부'는 틀린 계산이다 — 상한이 어디인지 보이려고만 찍는다.`);
  });

  it("(3-나) ⚠️ 재고 표 — 90대 일괄이 문제다. 면적으로 대수를 재면", () => {
    // 진단(2026-09-22): 인허가가 찾아내는 500m 밖 경쟁점은 **대부분 영세하다.**
    //   면적 중앙 66㎡ (1사분 39 · 3사분 156). 우리 매장은 90~110대에 160~330㎡다.
    //   우리 매장 36곳을 인허가에 맞대어 재면 **대수÷면적 중앙 0.380대/㎡**다.
    //   66㎡면 25대쯤이다 — 90대를 붙이면 3.6배로 세는 셈이고, 그게 과소예측의 정체다.
    // ⚠️ 면적→대수는 **기전**이다(PC 한 대가 차지하는 넓이는 물리적으로 정해져 있다).
    //    다만 등록 면적이 부실한 곳이 있어 퍼짐이 크다(0.145~4.228대/㎡).
    //    ⛔ **여기서 값을 고르지 않는다.** 사용자가 정할 자리라 재고 표로만 남긴다.
    const OUR_MEDIAN_PER_M2 = 0.380;   // 우리 매장 36곳 실측 중앙값(적합값이 아니다)
    const pcFromArea = (p: Permit, perM2: number) => {
      // 면적이 없거나 터무니없으면 지어내지 않고 기본대수로 돌아간다.
      if (p.area == null || !(p.area >= 20)) return DEFAULT_UNSURVEYED_PC_COUNT;
      return Math.min(200, Math.max(10, p.area * perM2));
    };
    const cardArea = (perM2: number) => card((r) => {
      const extra = (nearByCode.get(r.input.storeCode) ?? [])
        .filter((n) => n.share > 0)
        .map((n) => ({ ip: pcFromArea(n.p, perM2) * n.share, distanceM: n.distanceM, parts: null, name: n.p.name }));
      return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
    });
    console.log(`\n[재고 표] 인허가 판정 + 경쟁점 대수를 어떻게 잡을까 · 표본 ${rows.length}곳`);
    console.log(`  대수 규칙                    MAE       SD      최악            편향      ±5%p  퍼짐`);
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(24)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}`
      + ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}`
      + `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배`);
    line("지금 — 2km를 안 센다", card((r) => r.input));
    line(`일괄 ${DEFAULT_UNSURVEYED_PC_COUNT}대(운영 규칙)`, card((r) => withPermits(r, (n) => n.share)));
    for (const v of [0.25, OUR_MEDIAN_PER_M2, 0.50]) {
      line(`면적 × ${v.toFixed(3)}대/㎡${v === OUR_MEDIAN_PER_M2 ? " ← 우리 실측" : ""}`, cardArea(v));
    }
    // ── 실체 확인 — 인허가와 지도를 **엇갈리게** 쓴다 ──────────────────────
    // 진단: 인허가에 "영업"인 2,108건 중 지도에 있는 건 39%뿐이다. 나머지 61%는
    // 폐업 신고를 안 한 유령이거나 간판도 없는 영세 등록일 수 있다. 둘은 서로 다른 것을 안다:
    //   지도   = "지금 실체가 있는가"      (시점은 지금뿐)
    //   인허가 = "그때 영업했는가"          (실체 여부는 모름)
    // 그래서 이렇게 엇갈려 쓴다 — **버리는 건 '지금 영업인데 지도에 없는 것'뿐**이다.
    //   · 지도에 있다            -> 실체 있음. 인허가 시점으로 무게를 잰다
    //   · 지도에 없는데 폐업일자가 있다 -> 그래서 지도에 없는 것이다. 평가창에 걸치면 센다
    //   · 지도에 없는데 영업 중이다   -> **유령 의심. 뺀다**
    const kakaoNear = (code: string) => {
      const docs = (neighbor.sites[`existing:${code}`] as { pcRooms?: { docs?: { lat: number; lng: number }[] } } | undefined)
        ?.pcRooms?.docs ?? [];
      return docs;
    };
    const realBody = (code: string, p: Permit) => {
      if (p.close) return true;                         // 닫혔으니 지도에 없는 게 당연하다
      return kakaoNear(code).some((d) => distanceM(d.lat, d.lng, p.lat, p.lng) <= 80);
    };
    const cardReal = (perM2: number | null) => card((r) => {
      const extra = (nearByCode.get(r.input.storeCode) ?? [])
        .filter((n) => n.share > 0 && realBody(r.input.storeCode, n.p))
        .map((n) => ({
          ip: (perM2 == null ? DEFAULT_UNSURVEYED_PC_COUNT : pcFromArea(n.p, perM2)) * n.share,
          distanceM: n.distanceM, parts: null, name: n.p.name,
        }));
      return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
    });
    line("⭐ 실체확인 + 일괄 90대", cardReal(null));
    line(`⭐ 실체확인 + 면적×${OUR_MEDIAN_PER_M2}`, cardReal(OUR_MEDIAN_PER_M2));
    console.log(`\n  ⚠️ 채택하지 않는다. 계수는 사용자가 정한다.`);
    console.log(`  ⚠️ 운영 V62도 같은 상수(DEFAULT_UNSURVEYED_PC_COUNT)를 쓴다 — 바꾸면 결재 숫자가 움직인다.`);
    console.log(`     실험실에서만 바꿀 길을 따로 내야 한다.`);
  });

  it("(3-다) ⭐ 규칙을 우리가 답을 아는 구간에서 채점한다 — 500m 안", () => {
    // 500m 안은 **사람이 직접 조사했다**(경쟁점 DB 219곳). 거기서는 진실을 안다.
    // 그러니 "인허가가 영업이라는데 실재하는가"와 "실체확인 규칙이 맞는가"를 채점할 수 있다.
    // 성적에 맞추는 게 아니라 **진실 라벨로 규칙을 시험하는 것**이다.
    const surveyed = (allCompetitors as unknown as { lat?: number; lng?: number; investigationStatus?: string }[])
      .filter((c) => c.lat != null && c.lng != null && c.investigationStatus !== "경쟁점없음");
    let real = 0, realInMap = 0, noSurvey = 0, noSurveyInMap = 0;
    const realAreas: number[] = [], ghostAreas: number[] = [];
    for (const r of rows) {
      const c = coordOf(r.input.storeCode);
      if (!c) continue;
      const docs = (neighbor.sites[`existing:${r.input.storeCode}`] as { pcRooms?: { docs?: { lat: number; lng: number }[] } } | undefined)
        ?.pcRooms?.docs ?? [];
      for (const p of permits) {
        const d = distanceM(c.lat, c.lng, p.lat, p.lng);
        if (d > OFFICIAL_RADIUS_M || d <= SELF_M || p.close) continue;
        const isReal = surveyed.some((q) => distanceM(q.lat!, q.lng!, p.lat, p.lng) <= 80);
        const inMap = docs.some((q) => distanceM(q.lat, q.lng, p.lat, p.lng) <= 80);
        if (isReal) { real++; if (inMap) realInMap++; if (p.area) realAreas.push(p.area); }
        else { noSurvey++; if (inMap) noSurveyInMap++; else if (p.area) ghostAreas.push(p.area); }
      }
    }
    const med = (a: number[]) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
    console.log(`\n[500m 채점] 사람이 조사한 구간에서 인허가 "영업"을 채점한다`);
    console.log(`  조사로 실재 확인   ${real}건 · 그중 지도에도 있다 ${realInMap}건 (${(realInMap / real * 100).toFixed(0)}%)`);
    console.log(`  조사DB에 없음      ${noSurvey}건 · 그중 지도엔 있다 ${noSurveyInMap}건 · 지도에도 없다 ${noSurvey - noSurveyInMap}건`);
    console.log(`  시설면적 중앙: 실재 ${med(realAreas).toFixed(0)}㎡ vs 조사DB에 없음 ${med(ghostAreas).toFixed(0)}㎡`);
    console.log(`\n  ⭐ 읽는 법 — 보증되는 것과 안 되는 것이 다르다.`);
    console.log(`     보증된다 : "지도에 있으면 실재한다"(${(realInMap / real * 100).toFixed(0)}%).`);
    console.log(`     보증 안 된다 : "지도에 없으면 없다". 카카오는 **매장당 40건쯤에서 잘린다**`);
    console.log(`        (전대후문 인허가 216건 vs 카카오 32건).`);
    console.log(`\n  ⚠️ **2026-09-22 정정.** 처음엔 그 잘림이 "조밀한 도시 매장만 덜 세게 만든다"고 보고`);
    console.log(`     이 규칙을 기각했다. **근거가 약했다** — 밀도 높은 몇 곳(전대후문 26%)과 낮은 몇 곳`);
    console.log(`     (장산 67%)만 눈으로 비교한 것이다. 38곳 전체로 상관을 재면 **r=-0.14로 유의선 아래**다`);
    console.log(`     (한산한 곳도 적중률이 낮은 데가 많다 — 남악 13% · 양주덕정 17% · 진주혁신 0%).`);
    console.log(`     편향 검정은 3-사에서 제대로 한다. **눈으로 고르지 말고 재라.**`);
    console.log(`\n     그리고 작은 곳은 유령이 아니라 **조사를 안 한 소형 PC방**일 수 있다`);
    console.log(`     (우리 DB에 "노후저경쟁력미조사"가 따로 있다). 그러면 답은 빼는 게 아니라 작게 세는 것이다.`);
    expect(real).toBeGreaterThan(50);
  });

  it("(3-라) ⛔ 면적으로 대수를 잡는 건 우리 자료로 검증이 안 된다", () => {
    // 면적 -> 대수는 **기전은 있다**(PC 한 대가 차지하는 넓이는 물리적으로 정해져 있다).
    // 그런데 계수를 우리 자료가 못 고른다. 이유 둘을 여기 박아 둔다 — 또 파지 않도록.
    const pairs: { name: string; pc: number; area: number }[] = [];
    for (const r of rows) {
      const c = coordOf(r.input.storeCode);
      const pc = r.input.pcCount;
      if (!c || !pc) continue;
      let best: { p: Permit; d: number } | null = null;
      for (const p of permits) {
        const d = distanceM(c.lat, c.lng, p.lat, p.lng);
        if (d <= 60 && p.area && (!best || d < best.d)) best = { p, d };
      }
      if (best?.p.area) pairs.push({ name: r.input.storeName ?? r.input.storeCode, pc, area: best.p.area });
    }
    // 대당 2㎡ 미만은 등록 면적이 틀린 것이다(PC 한 대에 2㎡는 물리적으로 불가능하다).
    const bad = pairs.filter((x) => x.area / x.pc < 2);
    const ok = pairs.filter((x) => x.area / x.pc >= 2);
    const n = ok.length;
    const sx = ok.reduce((a, b) => a + b.area, 0), sy = ok.reduce((a, b) => a + b.pc, 0);
    const sxx = ok.reduce((a, b) => a + b.area ** 2, 0), sxy = ok.reduce((a, b) => a + b.area * b.pc, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icept = (sy - slope * sx) / n;
    const my = sy / n;
    const r2 = 1 - ok.reduce((a, b) => a + (b.pc - (slope * b.area + icept)) ** 2, 0)
      / ok.reduce((a, b) => a + (b.pc - my) ** 2, 0);
    console.log(`\n[면적->대수] 우리 매장 ${pairs.length}곳을 인허가에 맞대어 잰다`);
    console.log(`  ⚠️ 등록면적이 말이 안 되는 곳 ${bad.length}곳 (대당 2㎡ 미만 — 예: ${bad[0]?.name} ${bad[0]?.pc}대에 ${bad[0]?.area}㎡)`);
    console.log(`  남은 ${n}곳: 대수 = ${slope.toFixed(4)} × 면적 + ${icept.toFixed(1)}  ·  **R² = ${r2.toFixed(3)}**`);
    console.log(`\n  ⛔ 못 고른다. 이유 둘:`);
    console.log(`     1. 우리 매장은 전부 90~110대 규격형이라 **대수 방향으로 퍼져 있지 않다.**`);
    console.log(`        기울기를 잴 지렛대가 없다(R²=${r2.toFixed(3)}).`);
    console.log(`     2. 등록면적 자체가 ${(bad.length / pairs.length * 100).toFixed(0)}% 구멍이다.`);
    console.log(`  => 우리 매장으로는 못 잰다. **경쟁점 쪽 표본으로 넘어간다**(아래 3-마).`);
    expect(r2).toBeLessThan(0.5);   // 잘 되면 이 잠금이 깨지고, 그때 다시 본다
  });

  it("(3-마) ⭐ 경쟁점 표본에서는 면적→대수가 실재한다 — 다만 구간이 좁다", () => {
    // 우리 매장은 규격형이라 못 쟀다. **조사한 경쟁점은 대수가 넓게 퍼져 있다**(61~400대).
    // 거기서 재면 관계가 분명히 나온다.
    const surveyed = (allCompetitors as unknown as {
      name?: string; lat?: number; lng?: number; totalPcCount?: number | null; appliedPcCount?: number | null;
    }[]).filter((c) => c.lat != null && c.lng != null);
    const pairs: { pc: number; area: number }[] = [];
    for (const c of surveyed) {
      const pc = (c.totalPcCount && c.totalPcCount > 0 ? c.totalPcCount : null)
        ?? (c.appliedPcCount && c.appliedPcCount > 0 ? c.appliedPcCount : null);
      if (!pc) continue;
      let best: { p: Permit; d: number } | null = null;
      for (const p of permits) {
        const d = distanceM(c.lat!, c.lng!, p.lat, p.lng);
        if (d <= 80 && p.area && (!best || d < best.d)) best = { p, d };
      }
      if (best?.p.area) pairs.push({ pc, area: best.p.area });
    }
    // 대당 2㎡ 미만은 등록 면적이 틀린 것이다(위와 같은 자).
    const ok = pairs.filter((x) => x.area / x.pc >= 2);
    const n = ok.length;
    const sx = ok.reduce((a, b) => a + b.area, 0), sy = ok.reduce((a, b) => a + b.pc, 0);
    const sxx = ok.reduce((a, b) => a + b.area ** 2, 0), sxy = ok.reduce((a, b) => a + b.area * b.pc, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icept = (sy - slope * sx) / n;
    const mx = sx / n, my = sy / n;
    const sdx = Math.sqrt(ok.reduce((a, b) => a + (b.area - mx) ** 2, 0) / n);
    const sdy = Math.sqrt(ok.reduce((a, b) => a + (b.pc - my) ** 2, 0) / n);
    const r = ok.reduce((a, b) => a + (b.area - mx) * (b.pc - my), 0) / n / (sdx * sdy);
    const pcSorted = [...ok].map((x) => x.pc).sort((a, b) => a - b);
    const areaSorted = [...ok].map((x) => x.area).sort((a, b) => a - b);
    console.log(`\n[면적->대수 · 경쟁점] 대수 실측이 있고 인허가에 면적까지 붙은 ${pairs.length}곳`
      + ` (등록면적 오류 ${pairs.length - n}곳 제외 -> ${n}곳)`);
    console.log(`  대수 = ${slope.toFixed(4)} × 면적 + ${icept.toFixed(1)}   R² = `
      + `${(r * r).toFixed(3)} · r = ${r.toFixed(3)}  (유의선 ±0.41 — **넘는다**)`);
    console.log(`  표본 범위: 대수 ${pcSorted[0]}~${pcSorted[n - 1]}대 · 면적 ${areaSorted[0].toFixed(0)}~${areaSorted[n - 1].toFixed(0)}㎡`);
    console.log(`\n  ⚠️ **그런데 쓸 수가 없다 — 구간이 안 맞는다.**`);
    console.log(`     우리가 조사한 경쟁점은 **최소가 ${pcSorted[0]}대**다. 작은 곳은 조사를 안 했다.`);
    console.log(`     그래서 절편 ${icept.toFixed(1)}대는 "조사할 만한 크기" 안에서만 뜻이 있다.`);
    console.log(`     500m 밖 인허가의 면적 중앙은 49㎡라 **측정 구간 한참 아래**다.`);
    console.log(`     거기에 이 식을 대면 ${(slope * 49 + icept).toFixed(0)}대가 나오는데 그건 외삽이다.`);
    console.log(`  => 다음 과녁은 **소형 경쟁점의 대수**다. 그게 풀리면 2km가 바로 들어온다.`);
    expect(Math.abs(r)).toBeGreaterThan(0.41);
  });

  it("(3-바) ⭐ 총게임기수는 **조건부로** 정확하다 — 70 이상이면 실측 대수다", () => {
    // 2026-09-22. 어제 인계문은 "인허가에 PC 대수는 없다"였고, 오늘 처음엔 나도 그렇게 봤다
    // (채움률 71%·중앙 7대). **틀렸다. 구간을 나눠 보면 갈린다.**
    const surveyed = (allCompetitors as unknown as {
      lat?: number; lng?: number; totalPcCount?: number | null; appliedPcCount?: number | null;
    }[]).filter((c) => c.lat != null && c.lng != null);
    const pairs: { pc: number; g: number | null; area: number | null }[] = [];
    for (const c of surveyed) {
      const pc = (c.totalPcCount && c.totalPcCount > 0 ? c.totalPcCount : null)
        ?? (c.appliedPcCount && c.appliedPcCount > 0 ? c.appliedPcCount : null);
      if (!pc) continue;
      let best: { p: Permit; d: number } | null = null;
      for (const p of permits) {
        const d = distanceM(c.lat!, c.lng!, p.lat, p.lng);
        if (d <= 80 && (!best || d < best.d)) best = { p, d };
      }
      if (best) pairs.push({ pc, g: best.p.gameCount, area: best.p.area });
    }
    const withG = pairs.filter((x) => x.g != null && x.g > 0) as { pc: number; g: number; area: number | null }[];
    console.log(`\n[총게임기수] 대수 실측이 있는 경쟁점 ${pairs.length}곳 · 게임기수가 적힌 곳 ${withG.length}곳`);
    console.log(`  게임기 구간      n    비율(게임기÷실측) 중앙   ±20% 적중`);
    for (const [lo, hi] of [[1, 40], [40, 70], [70, 120], [120, 1e9]] as [number, number][]) {
      const g = withG.filter((x) => x.g >= lo && x.g < hi);
      if (!g.length) continue;
      const r = g.map((x) => x.g / x.pc).sort((a, b) => a - b);
      const ok = g.filter((x) => Math.abs(x.g / x.pc - 1) <= 0.2).length;
      console.log(`  ${String(lo).padStart(4)}~${(hi > 1e8 ? "∞" : String(hi)).padEnd(5)}${String(g.length).padStart(5)}`
        + `${r[Math.floor(r.length / 2)].toFixed(2).padStart(16)}${(ok + "/" + g.length).padStart(14)}`);
    }
    console.log(`\n  ⭐ **70 이상이면 실측 대수와 사실상 같다.** 40 미만은 다른 걸 적은 것이다.`);
    console.log(`  ⚠️ 우리 표본은 전부 61대 이상이라 "게임기 7"이 등록 부실인지 진짜 7대인지는 못 가린다.`);
    const lowG = withG.filter((x) => x.g < 40);
    const lowGSmallArea = lowG.filter((x) => x.area != null && x.area < 100).length;
    console.log(`  ⛔ 면적으로도 못 가린다 — 게임기<40인 ${lowG.length}곳 중 ${lowGSmallArea}곳은 **면적도 100㎡ 미만**이다.`);
    console.log(`     61대 이상인 걸 아는데 면적 32㎡로 등록된 곳이 있다. **면적·게임기수를 둘 다 줄여 적은 무리**다.`);
    console.log(`     그 무리를 식별할 방법이 없다 -> 작은 값은 통째로 못 믿는다.`);

    // 그래서 "믿을 수 있는 것만 센다"를 재 본다. 전 매장에 같은 자를 대므로 부분 적용이 아니다.
    const TRUST = 70;
    const trusted = (n: Near) => (n.p.gameCount != null && n.p.gameCount >= TRUST ? n.p.gameCount : 0);
    const cardTrusted = card((r) => {
      const extra = (nearByCode.get(r.input.storeCode) ?? [])
        .filter((n) => n.share > 0 && trusted(n) > 0)
        .map((n) => ({ ip: trusted(n) * n.share, distanceM: n.distanceM, parts: null, name: n.p.name }));
      return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
    });
    const now = card((r) => r.input);
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(26)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}`
      + ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}`
      + `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배`);
    console.log(`\n[재고 표] 게임기수 ${TRUST} 이상만 센다 — 실체도 대수도 아는 경쟁점만`);
    console.log(`  시나리오                      MAE       SD      최악            편향      ±5%p  퍼짐`);
    line("지금 — 2km를 안 센다", now);
    line(`게임기 ${TRUST}+ 만, 그 대수로`, cardTrusted);
    // ── ⛔ 그런데 기각했다 — 지역 편향이 매장 특성과 상관된다 ────────────────
    const ratios: number[] = [], counts: number[] = [];
    for (const r of rows) {
      const near = (nearByCode.get(r.input.storeCode) ?? []).filter((n) => !n.p.close);
      if (near.length < 5) continue;
      ratios.push(near.filter((n) => (n.p.gameCount ?? 0) >= TRUST).length / near.length);
      counts.push(Math.log(near.length));
    }
    const mr = mean(ratios), mc = mean(counts);
    const rBias = mean(ratios.map((v, i) => (v - mr) * (counts[i] - mc))) / (sdOf(ratios) * sdOf(counts));
    console.log(`\n  ⛔ **기각한다 — 지역 편향이 매장 특성과 붙어 있다.**`);
    console.log(`     지자체마다 등록 관행이 다르다: 게임기 70+ 비율이 부산 43% · 대구 31% vs 충북 13% · 울산 9%`);
    console.log(`     (게임기를 아예 안 적는 비율도 서울 53% vs 울산 4%로 갈린다).`);
    console.log(`     70+ 비율 vs 2km 경쟁점 수(log)  **r = ${rBias.toFixed(3)}** (유의선 ±0.41) — 넘는다.`);
    console.log(`     => **경쟁점이 많은 동네일수록 등록이 부실하다.** 조밀한 도시 매장만 덜 세어진다.`);
    console.log(`        편향 +0.07%p가 좋아 보인 건 도시 매장을 덜 세서 우연히 맞아떨어진 것일 수 있다.`);
    console.log(`\n  ⚠️ **오늘 기각한 셋이 전부 같은 병이다:**`);
    console.log(`       카카오 40건 상한 · 인허가 면적 축소등록 · 인허가 게임기 미등록`);
    console.log(`       셋 다 **조밀한 도시 매장의 경쟁점을 덜 세게** 만든다. 그리고 그 방향이 하필`);
    console.log(`       퍼짐 과장의 원인으로 지목한 바로 그것이다 — 그래서 성적이 좋아 보여도 못 믿는다.`);
    console.log(`  => 다음 과녁: **전국 동일 기준으로 수집된 2km 경쟁점 자료**. 후보는 소상공인 상가업소 DB`);
    console.log(`     (이미 collectSbiz*로 쓰고 있다 — 건수 상한도 지자체 관행도 안 탄다).`);
    expect(withG.length).toBeGreaterThan(50);
    expect(Math.abs(rBias)).toBeGreaterThan(0.41);   // 편향이 사라지면 이 잠금이 깨지고, 그때 다시 본다
  });

  it("(3-사) ⭐⭐ 소상공인 상가업소로 실체를 본다 — 편향 검정을 통과한 첫 조합", () => {
    // 오늘 셋을 기각한 병은 하나였다: **자료의 결측이 매장 밀도와 붙어 있다.**
    // 소상공인 상가업소는 매장마다 반경 조회를 따로 하므로 건수 상한이 안 걸리고,
    // 전국을 한 기관이 같은 기준으로 모으므로 지자체 관행도 안 탄다.
    if (!existsSync(SBIZ_FILE)) {
      console.log(`\n[상가업소] ${SBIZ_FILE}이 없다 — node scripts/collectSbizPcBangs.mjs 먼저.`);
      return;
    }
    const sbiz = JSON.parse(readFileSync(SBIZ_FILE, "utf8")) as {
      collectedAt: string; radiusM: number;
      sites: Record<string, { lat: number; lng: number; stores: { lat: number; lng: number; name: string }[] }>;
    };
    /** 그 매장 반경 안에 상가업소가 아는 PC방이 있나(80m 안이면 같은 가게로 본다). */
    const inSbiz = (code: string, p: Permit) => {
      const site = sbiz.sites[`existing:${code}`];
      if (!site) return false;
      return site.stores.some((q) => distanceM(q.lat, q.lng, p.lat, p.lng) <= 80);
    };

    // ── 편향 검정을 먼저 한다. 통과 못 하면 성적은 볼 것도 없다 ──────────────
    const ratioSbiz: number[] = [], ratioKakao: number[] = [], dens: number[] = [];
    for (const r of rows) {
      const near = (nearByCode.get(r.input.storeCode) ?? []).filter((n) => !n.p.close);
      if (near.length < 5) continue;
      const docs = (neighbor.sites[`existing:${r.input.storeCode}`] as { pcRooms?: { docs?: { lat: number; lng: number }[] } } | undefined)
        ?.pcRooms?.docs ?? [];
      ratioSbiz.push(near.filter((n) => inSbiz(r.input.storeCode, n.p)).length / near.length);
      ratioKakao.push(near.filter((n) => docs.some((q) => distanceM(q.lat, q.lng, n.p.lat, n.p.lng) <= 80)).length / near.length);
      dens.push(Math.log(near.length));
    }
    const corr = (a: number[], b: number[]) => {
      const ma = mean(a), mb = mean(b);
      return mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / (sdOf(a) * sdOf(b));
    };
    const rS = corr(ratioSbiz, dens), rK = corr(ratioKakao, dens);
    console.log(`\n[편향 검정] 실체 자료가 잡아내는 비율 vs 2km 경쟁점 밀도(log) · n=${dens.length} · 유의선 ±0.41`);
    console.log(`  소상공인 상가업소   적중률 평균 ${(mean(ratioSbiz) * 100).toFixed(0)}%   r = ${rS.toFixed(3)}   ${Math.abs(rS) >= 0.41 ? "⛔ 넘는다" : "✅ 통과"}`);
    console.log(`  카카오 장소        적중률 평균 ${(mean(ratioKakao) * 100).toFixed(0)}%   r = ${rK.toFixed(3)}   ${Math.abs(rK) >= 0.41 ? "⛔ 넘는다" : "✅ 통과"}`);
    console.log(`  (참고) 인허가 게임기 70+ 규칙은 같은 검정에서 **r=-0.486으로 탈락**했다 — 3-바.`);
    console.log(`\n  ⚠️ **둘 다 통과한다.** 처음에 카카오를 "도시 편향"으로 기각했는데 그건 눈대중이었다(3-다 정정).`);
    console.log(`     둘의 진짜 차이는 편향이 아니라 **적중률**이다 — 상가업소가 더 많이 찾아낸다.`);

    // ── 실체 × 시점 — 둘은 서로 다른 것을 안다 ──────────────────────────────
    // 상가업소 = 지금 실체가 있는가 (시점은 모름) · 인허가 = 그때 영업했는가 (실체는 모름)
    // 폐업한 곳은 상가업소에 **없는 게 당연**하므로 실체 확인을 면제한다.
    const keep = (code: string, n: Near) => n.p.close != null || inSbiz(code, n.p);
    const cardSbiz = card((r) => {
      const extra = (nearByCode.get(r.input.storeCode) ?? [])
        .filter((n) => n.share > 0 && keep(r.input.storeCode, n))
        .map((n) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * n.share, distanceM: n.distanceM, parts: null, name: n.p.name }));
      return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
    });
    const now = card((r) => r.input);
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(28)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}`
      + ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}`
      + `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배    ${String(c.capped).padStart(2)}곳`);
    // 카카오 쪽도 같은 자로 재서 나란히 놓는다 — 편향 검정을 둘 다 통과했으니 비교가 성립한다.
    const cardKakao = card((r) => {
      const docs = (neighbor.sites[`existing:${r.input.storeCode}`] as { pcRooms?: { docs?: { lat: number; lng: number }[] } } | undefined)
        ?.pcRooms?.docs ?? [];
      const extra = (nearByCode.get(r.input.storeCode) ?? [])
        .filter((n) => n.share > 0
          && (n.p.close != null || docs.some((q) => distanceM(q.lat, q.lng, n.p.lat, n.p.lng) <= 80)))
        .map((n) => ({ ip: DEFAULT_UNSURVEYED_PC_COUNT * n.share, distanceM: n.distanceM, parts: null, name: n.p.name }));
      return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
    });
    console.log(`\n[성적표] 시점=인허가 · 대수=운영과 같은 ${DEFAULT_UNSURVEYED_PC_COUNT}대 일괄 · 실체 자료만 바꾼다`);
    console.log(`  시나리오                        MAE       SD      최악            편향      ±5%p  퍼짐   점유율100%`);
    line("지금 — 2km를 안 센다", now);
    line("실체=카카오 + 인허가 시점", cardKakao);
    line("⭐ 실체=상가업소 + 인허가 시점", cardSbiz);
    line("실체 안 봄 — 인허가만", card((r) => withPermits(r, (n) => n.share)));
    console.log(`\n  ⚠️ 대수는 일괄 ${DEFAULT_UNSURVEYED_PC_COUNT}대다 — 전 매장에 같은 자를 대므로 편향은 안 생기지만`);
    console.log(`     **수준은 틀릴 수 있다.** 네 줄의 편향이 전부 음수인 게 그 증거다(-2.5 ~ -6.5%p).`);
    console.log(`     많이 찾을수록 더 음수다 — 소형 경쟁점을 ${DEFAULT_UNSURVEYED_PC_COUNT}대로 세니 그렇다.`);
    console.log(`\n  ⛔ **그래서 자료원을 성적으로 고르면 안 된다.** 카카오가 제일 좋아 보이는 건`);
    console.log(`     적중률이 낮아(43% vs 47%) 대수 과대를 덜 타기 때문일 수 있다. 덜 찾는 게 상이 된다.`);
    console.log(`     => 자료원 선택은 **대수를 바로잡은 뒤에** 한다. 지금 고르면 틀린 이유로 고르는 것이다.`);
    expect(Math.abs(rS)).toBeLessThan(0.41);   // 편향이 생기면 여기서 걸린다
  });

  it("(4) 매장별로 얼마나 붙었나 — 독점이라던 3곳 포함", () => {
    console.log(`\n[매장별] 평가창 영업으로 판정된 ${OFFICIAL_RADIUS_M}m 밖 경쟁점`);
    console.log(`  매장                건수  유효경쟁IP   예측변화(가동률)`);
    const list = rows.map((r) => {
      const near = (nearByCode.get(r.input.storeCode) ?? []).filter((n) => n.share > 0);
      const addedIp = near.reduce((s, n) => s + DEFAULT_UNSURVEYED_PC_COUNT * n.share * rivalDistanceWeight(n.distanceM, P), 0);
      const before = computeTextbook(r.input, P).utilization;
      const after = computeTextbook(withPermits(r, (n) => n.share), P).utilization;
      return { name: r.input.storeName ?? r.input.storeCode, n: near.length, addedIp, before, after };
    }).sort((a, b) => b.addedIp - a.addedIp);
    for (const x of list) {
      const d = x.before != null && x.after != null ? (x.after - x.before) * 100 : NaN;
      console.log(`  ${x.name.padEnd(18)}${String(x.n).padStart(4)}  ${x.addedIp.toFixed(1).padStart(9)}`
        + `   ${Number.isFinite(d) ? d.toFixed(2).padStart(7) + "%p" : "      -"}`);
    }
  });
});
