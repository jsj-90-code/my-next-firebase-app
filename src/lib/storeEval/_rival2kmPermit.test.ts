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
