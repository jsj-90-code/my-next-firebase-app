// 2km 경쟁점을 넣으면 산식이 움직이나 — 상한/하한 구간 (2026-09-22)
//
// ── 왜 이걸 먼저 재나 ─────────────────────────────────────────────────────
// 오늘 제일 큰 일은 "2km 경쟁점을 인허가 자료로 자동 판정"이다. 그런데 그 일은 인증키와
// 좌표계 변환(EPSG:5174 -> WGS84)이 걸린 큰 공사다. **들이기 전에 값을 하는지 먼저 본다.**
//
// 판정을 기다리지 않고도 구간은 잴 수 있다:
//   하한 = 지금 (500m 밖을 아무것도 안 센다)
//   상한 = 카카오 2km 목록을 **전부 영업 중으로 치고 센다**
// 진짜 답은 반드시 이 사이에 있다. 구간이 좁으면 인허가 판정은 품값을 못 한다.
//
// ── ⚠️ 전체 매장에 한꺼번에 적용한다 ──────────────────────────────────────
// 사용자 규칙: *"2km로 갈려면 전체매장 다 적용해야 산식이 완성되는 거 아니냐?"* 맞다.
// 여기 세 시나리오는 전부 **40곳 전체에 똑같이** 적용한다. 판정된 93건만 넣는 식의
// 부분 적용은 하지 않는다 — 판정이 많이 된 매장만 불리해진다.
//
// ── 무엇을 어떻게 세나 ────────────────────────────────────────────────────
// · 대수: 운영과 같은 규칙인 미조사 기본대수(DEFAULT_UNSURVEYED_PC_COUNT)를 쓴다.
//   인허가 자료에도 **PC 대수는 없다** — 연결해도 이 규칙은 그대로다.
// · 품질: 모른다 -> `parts: null`. 산식이 비율 1(동급)로 본다. 500m 안 미조사 경쟁점이
//   이미 받는 대우와 같다. 잣대를 둘로 만들지 않는다.
// · 거리: 카카오가 준 직선거리. 감쇠(R200 λ200)가 그대로 걸린다.
// · 500m 안은 **뺀다.** 공식 경쟁점 DB가 이미 세고 있어서 두 번 세게 된다.
//   자기 자신(30m 안)도 뺀다.
//
// ── ⚠️ 이 측정이 못 하는 것 ───────────────────────────────────────────────
// 1. 카카오 목록에는 **폐업이 섞여 있다**(문경시청 7곳 중 3곳 = 43%). 그래서 상한은
//    진짜 상한이다. 가운데를 보려고 43% 무작위 솎기도 같이 찍지만 **참고값**이다.
// 2. 카카오가 목록을 **자른 매장이 5곳** 있다(전대후문·부천상동역·수원인계·신중동·전대상대).
//    그 매장들은 상한조차 하한이다.
// 3. 시점을 모른다. 인허가 자료가 필요한 진짜 이유가 이것이다 — 카카오는 "지금"만 안다.
// 4. 감쇠 정규화 상수(weightFactor 0.9593)는 **500m 경쟁점 집합에서 잰 값**이다.
//    경쟁점 집합이 늘면 다시 재야 한다. 여기서는 옛 값을 그대로 쓴다 — 채택 전 측정이라
//    비교의 일관성을 택했다. **채택한다면 반드시 다시 잰다.**
//
// ⚠️ 측정만 한다. 채택은 사용자가 정한다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rival2kmBounds.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_UNSURVEYED_PC_COUNT } from "./calc";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
  type TextbookInput, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const NEIGHBOR_FILE = ".local-tools/kakao-neighborhood.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
/** 공식 경쟁점 DB가 이미 세는 구간. 여기 안은 두 번 세면 안 된다. */
const OFFICIAL_RADIUS_M = 500;
/** 자기 자신(같은 건물의 우리 매장)을 거르는 자. 리뷰 생성기와 같은 값이다. */
const SELF_M = 30;
/** 문경시청점 실측 폐업률. 가운데를 가늠하는 **참고값**이지 측정값이 아니다. */
const OBSERVED_CLOSED_RATE = 3 / 7;

const has = hasValidationSnapshot() && existsSync(NEIGHBOR_FILE);
const describeIf = has ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;

type Neighbor = { name: string; lat: number; lng: number; distanceM: number; address?: string };
type Card = {
  n: number; mae: number; sd: number; worst: number; worstName: string;
  bias: number; within5: number; spread: number; capped: number;
};

/** 되풀이 가능한 난수 — 무작위 솎기를 매번 같은 결과로 만든다. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

describeIf("2km 경쟁점 — 상한/하한 구간", () => {
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
  /** ⚠️ `excluded`로 거르지 않는다 — 송도·동탄북광장이 빠진다(`_outsideOptionRemoval` 주석). */
  const rows = base.filter((r) => (r.input.actualUtilization ?? 0) > 0);

  const neighbor = JSON.parse(readFileSync(NEIGHBOR_FILE, "utf8")) as {
    collectedAt: string; radiusM: number;
    sites: Record<string, { kind: string; code: string; name: string; pcRooms?: { total: number; docs?: Neighbor[]; truncated?: boolean } }>;
  };

  /** 매장코드 -> 500m 밖 2km 안 PC방 목록(자기 자신 제외). */
  const outsideByCode = new Map<string, Neighbor[]>();
  for (const r of rows) {
    const site = neighbor.sites[`existing:${r.input.storeCode}`];
    const docs = site?.pcRooms?.docs ?? [];
    outsideByCode.set(
      r.input.storeCode,
      docs.filter((d) => d.distanceM > OFFICIAL_RADIUS_M && d.distanceM > SELF_M),
    );
  }

  /** 시나리오대로 2km 경쟁점을 붙인 입력을 만든다. keep이 false면 그 경쟁점은 안 센다. */
  const withOutside = (r: LabRow, keep: (n: Neighbor, i: number) => boolean): TextbookInput => {
    const extra = (outsideByCode.get(r.input.storeCode) ?? [])
      .filter(keep)
      .map((d) => ({
        // 인허가 자료에도 대수는 없다 — 운영과 같은 미조사 기본대수를 쓴다.
        ip: DEFAULT_UNSURVEYED_PC_COUNT,
        distanceM: d.distanceM,
        // 품질을 모른다. 산식이 비율 1(동급)로 본다 — 500m 안 미조사 경쟁점과 같은 대우다.
        parts: null,
        name: d.name,
      }));
    return { ...r.input, rivals: [...(r.input.rivals ?? []), ...extra] };
  };

  const card = (P: TextbookParams, make: (r: LabRow) => TextbookInput): Card => {
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

  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  it("(1) 자료 현황 — 얼마나 붙는가", () => {
    let total = 0, truncated = 0, missing = 0;
    const addedIp: number[] = [];
    for (const r of rows) {
      const site = neighbor.sites[`existing:${r.input.storeCode}`];
      if (!site) { missing++; continue; }
      if (site.pcRooms?.truncated) truncated++;
      const out = outsideByCode.get(r.input.storeCode) ?? [];
      total += out.length;
      addedIp.push(out.reduce((s, d) => s + DEFAULT_UNSURVEYED_PC_COUNT * rivalDistanceWeight(d.distanceM, P), 0));
    }
    console.log(`\n[자료] 카카오 수집 ${neighbor.collectedAt.slice(0, 10)} · 반경 ${neighbor.radiusM}m`);
    console.log(`  채점 매장 ${rows.length}곳 · 목록 없는 매장 ${missing}곳 · 카카오가 자른 매장 ${truncated}곳`);
    console.log(`  ${OFFICIAL_RADIUS_M}m 밖 ~ 2km 안 PC방 총 ${total}건 (매장당 평균 ${(total / rows.length).toFixed(1)}건)`);
    console.log(`  전부 영업으로 치면 매장당 유효경쟁IP가 평균 ${mean(addedIp).toFixed(1)}대 늘어난다` +
      ` (최소 ${Math.min(...addedIp).toFixed(1)} · 최대 ${Math.max(...addedIp).toFixed(1)})`);
    expect(total).toBeGreaterThan(0);
  });

  it("(2) 구간 — 하한(지금) vs 상한(전부 영업)", () => {
    const low = card(P, (r) => r.input);
    const high = card(P, (r) => withOutside(r, () => true));
    // 참고값. 관측 폐업률만큼 무작위로 솎아 200번 재고 평균을 낸다 — 자료에 맞춘 값이 아니다.
    const mid: Card[] = [];
    for (let s = 1; s <= 200; s++) {
      const rand = rng(s * 7919);
      mid.push(card(P, (r) => withOutside(r, () => rand() >= OBSERVED_CLOSED_RATE)));
    }
    const avg = (f: (c: Card) => number) => mean(mid.map(f));
    console.log(`\n[구간] 판정 기준 = 가동률 · 표본 ${low.n}곳 · 외부옵션 ${P.outsideOptionIp}대`);
    console.log(`  시나리오                    MAE       SD      최악            편향      ±5%p  퍼짐   점유율100%`);
    const line = (name: string, c: Card) => console.log(
      `  ${name.padEnd(24)}${pp(c.mae).padStart(8)} ${pp(c.sd).padStart(8)}` +
      ` ${(pp(c.worst) + " " + c.worstName).padEnd(22)} ${pp(c.bias).padStart(8)}` +
      `  ${String(c.within5).padStart(2)}/${c.n}  ${c.spread.toFixed(2)}배    ${String(c.capped).padStart(2)}곳`);
    line("하한 — 지금(안 센다)", low);
    line("상한 — 전부 영업", high);
    console.log(`  ${"참고 — 43% 무작위 폐업".padEnd(24)}${pp(avg((c) => c.mae)).padStart(8)} ${pp(avg((c) => c.sd)).padStart(8)}` +
      ` ${"—".padEnd(22)} ${pp(avg((c) => c.bias)).padStart(8)}  ${avg((c) => c.within5).toFixed(1)}/${low.n}` +
      `  ${avg((c) => c.spread).toFixed(2)}배    ${avg((c) => c.capped).toFixed(1)}곳   (200회 평균)`);
    console.log(`\n  ⚠️ 진짜 답은 하한과 상한 **사이**에 있다. 구간이 좁으면 인허가 판정은 품값을 못 한다.`);
    console.log(`  편향 ${pp(low.bias)} -> ${pp(high.bias)} · 퍼짐 ${low.spread.toFixed(2)}배 -> ${high.spread.toFixed(2)}배`);
  });

  it("(3) 곁가지 가설 — 수요가 큰 동네일수록 경쟁점이 많은가", () => {
    // 인계문 3절: 반경 밖 경쟁점을 안 세면 **도시 매장 예측이 부풀려진다** -> 퍼짐 과장의 일부.
    // 그게 사실이면 (가) 수요와 2km 경쟁점 수가 같이 가고 (나) 2km를 넣으면 퍼짐이 준다.
    const xs: number[] = [], ys: number[] = [];
    for (const r of rows) {
      const b = computeTextbook(r.input, P);
      if (b.totalDemandHours == null || !(b.totalDemandHours > 0)) continue;
      xs.push(Math.log(b.totalDemandHours));
      ys.push((outsideByCode.get(r.input.storeCode) ?? []).length);
    }
    const mx = mean(xs), my = mean(ys);
    const cov = mean(xs.map((v, i) => (v - mx) * (ys[i] - my)));
    const r0 = cov / (sdOf(xs) * sdOf(ys));
    console.log(`\n[곁가지] log(총수요) vs 500m 밖 2km 안 PC방 수 · n=${xs.length}`);
    console.log(`  상관 r = ${r0.toFixed(3)}  (⚠️ 유의선 ±0.41 — 여러 개를 훑을 때의 자다)`);
    console.log(`  ${Math.abs(r0) >= 0.41 ? "선을 넘는다 — 수요가 큰 동네일수록 경쟁점이 많다" : "선을 못 넘는다"}`);
    console.log(`  ⚠️ 상관만으로 판정하지 않는다. (2)번의 퍼짐 변화가 진짜 판정이다.`);
  });
});
