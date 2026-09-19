// 경쟁점이 **유동이 몰리는 방향**에 있으면 더 위협적인가 (2026-09-20)
//
// ── 사용자 착상 ────────────────────────────────────────────────────────────
//   *"상권에서 어느쪽에 인구가 쏠리는지 알 수 있잖아, 여기에 경쟁점 위치 대입해서
//     동선방해 데이터 기입 가능하지 않나? 상권에서 유동이 높이 있는데 그 동선에
//     경쟁점이 존재하면 우리에게 안좋은 영향 가잖아"*
//
// ── 왜 이걸 지금 파나 ──────────────────────────────────────────────────────
// 실험실의 제일 큰 구조적 결함이 **경쟁상권 과소예측 −12.6%**다(독점은 +3.0%로 잘 맞는다).
// 과소예측 = 경쟁점을 실제보다 **세게** 보고 있다는 뜻이다. 지금은 유효거리(300m) 안의
// 경쟁점을 **방향과 무관하게 똑같이** 센다. 붐비는 쪽에 있는 경쟁점만 세게 세고 반대쪽은
// 약하게 세면, 경쟁상권 예측이 **올라가** 그 오차를 정확히 겨냥한다.
//
// ── 자료 ───────────────────────────────────────────────────────────────────
//   `.local-tools/kakao-directional.json` — 54곳(기존점 41 + 후보지 13)의 8방위별 유동량
//     `byDir` {북 51, 북동 86, 동 144, ...} · `eccentricity` 쏠림 정도 · `busiestDir`
//   경쟁점 좌표 229/232곳 · 자사 좌표 41/41곳
//
// ⚠️ **이 파일은 진단이다. 아직 산식을 안 고친다.** 신호가 있는지부터 본다.
//    실험실 본체에 `locationExponents.direction` 칸이 이미 있지만 계수가 0이라 안 쓰인다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalDirection.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, rivalDistanceM, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook } from "./textbookModel";
import type { Competitor, ExistingStore } from "./types";

const DIR_FILE = ".local-tools/kakao-directional.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() && existsSync(DIR_FILE) ? describe : describe.skip;

/** 8방위 이름 — 자료(`dirs`)와 같은 순서·같은 이름이어야 한다. */
const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"] as const;

/** 자사 -> 경쟁점 방위각(도, 북=0 시계방향). 짧은 거리라 등거리원통 근사로 충분하다. */
function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const dLat = toLat - fromLat;
  const dLng = (toLng - fromLng) * Math.cos((fromLat * Math.PI) / 180);
  const deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** 방위각 -> 8방위 이름. 45도 폭으로 자르되 북은 -22.5~+22.5다. */
function dirOf(deg: number): (typeof DIRS)[number] {
  return DIRS[Math.round(deg / 45) % 8];
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** 스피어만(순위) 상관 — 이상치에 덜 휘둘린다. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(xs), rank(ys));
}

describeIf("경쟁점이 유동 쏠림 방향에 있으면 더 위협적인가 — 진단", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores: ExistingStore[] = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  // QSC — 화면과 같은 값을 넣어야 성적이 안 갈라진다(_textbookFull과 같은 규칙).
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [key, site] of Object.entries(sites)) {
      qscSites.set(key.startsWith("existing:") ? key.slice("existing:".length) : key, site);
    }
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const score = scoreTextbook(rows.filter((r) => !r.excluded), DEFAULT_TEXTBOOK_PARAMS);

  // ── 방향 자료 ────────────────────────────────────────────────────────────
  const dirRaw = JSON.parse(readFileSync(DIR_FILE, "utf8")) as {
    radiusM: number; stepM: number;
    sites: Record<string, { name: string; lat: number; lng: number; byDir: Record<string, number>; eccentricity: number; busiestDir: string; sum: number }>;
  };
  const dirByStore = new Map<string, (typeof dirRaw.sites)[string]>();
  for (const [key, v] of Object.entries(dirRaw.sites)) {
    if (key.startsWith("existing:")) dirByStore.set(key.slice("existing:".length), v);
  }

  const EFFECTIVE_M = DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM;

  /**
   * 매장별 "경쟁점이 붐비는 쪽에 있는 정도".
   *  - `share` = 경쟁PC로 가중한 **그 방향 유동 비중**의 평균. 균등이면 1/8 = 0.125.
   *  - `tilt`  = share ÷ 0.125 − 1. 0이면 균등, +면 붐비는 쪽, −면 한산한 쪽.
   *  - `weighted` = tilt × eccentricity. 쏠림이 없는 상권에서는 방향이 뜻이 없으므로 깎는다.
   */
  const rivalTilt = (store: ExistingStore) => {
    const d = dirByStore.get(store.storeCode);
    if (!d || store.lat == null || store.lng == null || !d.sum) return null;
    const comps = compsByCode.get(existingStoreSourceCode(store)) ?? [];
    let wSum = 0, sSum = 0, used = 0;
    const perDir: Record<string, number> = {};
    for (const c of comps) {
      if (c.lat == null || c.lng == null) continue;
      const dist = rivalDistanceM(store, c);
      if (dist == null || dist > EFFECTIVE_M) continue;
      const ip = c.appliedPcCount ?? c.totalPcCount ?? 0;
      if (!ip) continue;
      const dir = dirOf(bearingDeg(store.lat, store.lng, c.lat, c.lng));
      const share = (d.byDir[dir] ?? 0) / d.sum;
      perDir[dir] = (perDir[dir] ?? 0) + ip;
      wSum += ip; sSum += ip * share; used++;
    }
    if (!used || wSum <= 0) return null;
    const share = sSum / wSum;
    const tilt = share / (1 / 8) - 1;
    return { share, tilt, weighted: tilt * d.eccentricity, rivals: used, ecc: d.eccentricity, busiest: d.busiestDir, perDir };
  };

  it("(1) 자료 충족도 · 경쟁점 방향 분포", () => {
    console.log(`\n══ (1) 자료가 있나 ══`);
    console.log(`  방향 자료: 기존점 ${dirByStore.size}곳 (반경 ${dirRaw.radiusM}m · 격자 ${dirRaw.stepM}m)`);
    const tilts = stores.map((s) => ({ s, t: rivalTilt(s) }));
    const withRivals = tilts.filter((x) => x.t != null);
    console.log(`  유효거리 ${EFFECTIVE_M}m 안에 좌표 있는 경쟁점을 가진 매장: ${withRivals.length}/${stores.length}곳`);
    const ecc = stores.map((s) => dirByStore.get(s.storeCode)?.eccentricity).filter((v): v is number => v != null).sort((a, b) => a - b);
    console.log(`  유동 쏠림(eccentricity) 최소 ${ecc[0]?.toFixed(3)} · 중앙 ${ecc[Math.floor(ecc.length / 2)]?.toFixed(3)} · 최대 ${ecc.at(-1)?.toFixed(3)}`);
    console.log(`\n  ⚠️ 쏠림이 0에 가까우면 사방이 고르다 = 방향이 뜻이 없는 상권이다.`);
    expect(dirByStore.size).toBeGreaterThan(20);
  });

  it("(2) ⭐ 경쟁점이 붐비는 쪽에 있을수록 우리가 과소예측되나", () => {
    // 부호 있는 오차 = (예측 − 실제) ÷ 실제. **음수 = 과소예측**.
    const byCode = new Map(score.rows.map((r) => [r.storeCode, r]));
    const data: { name: string; err: number; tilt: number; weighted: number; rivals: number; ecc: number }[] = [];
    for (const s of stores) {
      const r = byCode.get(s.storeCode);
      const t = rivalTilt(s);
      if (!r || !t || r.predicted == null || !(r.actual > 0)) continue;
      data.push({
        name: s.storeName ?? s.storeCode, err: (r.predicted - r.actual) / r.actual,
        tilt: t.tilt, weighted: t.weighted, rivals: t.rivals, ecc: t.ecc,
      });
    }
    console.log(`\n══ (2) 경쟁 상권 ${data.length}곳 — 방향 쏠림 ↔ 부호 있는 오차 ══`);
    console.log(`  (오차 음수 = 과소예측. 착상이 맞다면 tilt가 클수록 오차가 **더 음수**여야 한다)`);
    const errs = data.map((d) => d.err);
    console.log(`  평균 오차 ${(errs.reduce((a, b) => a + b, 0) / errs.length * 100).toFixed(1)}%`);
    console.log(`\n  ${"지표".padEnd(28)}${"피어슨".padStart(9)}${"스피어만".padStart(10)}`);
    const show = (label: string, xs: number[]) =>
      console.log(`  ${label.padEnd(28)}${pearson(xs, errs).toFixed(3).padStart(9)}${spearman(xs, errs).toFixed(3).padStart(10)}`);
    show("tilt (붐비는 쪽 정도)", data.map((d) => d.tilt));
    show("tilt x 쏠림", data.map((d) => d.weighted));
    show("(대조) 경쟁점 수", data.map((d) => d.rivals));
    show("(대조) 쏠림만", data.map((d) => d.ecc));

    console.log(`\n  ── 매장별 (tilt 큰 순 = 경쟁점이 붐비는 쪽에 몰린 순) ──`);
    console.log(`  ${"매장".padEnd(16)}${"tilt".padStart(8)}${"쏠림".padStart(8)}${"경쟁".padStart(6)}${"오차".padStart(9)}`);
    for (const d of [...data].sort((a, b) => b.tilt - a.tilt)) {
      console.log(`  ${d.name.padEnd(16)}${d.tilt.toFixed(2).padStart(8)}${d.ecc.toFixed(2).padStart(8)}${String(d.rivals).padStart(6)}${(d.err * 100).toFixed(1).padStart(8)}%`);
    }
    expect(data.length).toBeGreaterThan(10);
  });

  it("(3) 공식을 바꿔가며 — 한 가지로 재고 기각하면 성급하다", () => {
    const byCode = new Map(score.rows.map((r) => [r.storeCode, r]));

    /** 변형마다 매장별 지표를 만든다. null이면 그 매장은 그 변형에서 빠진다. */
    const variants: { label: string; f: (s: ExistingStore) => number | null }[] = [
      {
        // (a) 제일 가까운 경쟁점 하나만 본다 — 동선을 실제로 막는 건 코앞의 한 곳일 수 있다.
        label: "최근접 경쟁점 방향 비중",
        f: (s) => {
          const d = dirByStore.get(s.storeCode);
          if (!d || s.lat == null || s.lng == null || !d.sum) return null;
          const comps = (compsByCode.get(existingStoreSourceCode(s)) ?? [])
            .map((c) => ({ c, dist: c.lat != null && c.lng != null ? rivalDistanceM(s, c) : null }))
            .filter((x): x is { c: Competitor; dist: number } => x.dist != null && x.dist <= EFFECTIVE_M)
            .sort((a, b) => a.dist - b.dist);
          if (!comps.length) return null;
          const dir = dirOf(bearingDeg(s.lat, s.lng, comps[0].c.lat!, comps[0].c.lng!));
          return (d.byDir[dir] ?? 0) / d.sum / (1 / 8) - 1;
        },
      },
      {
        // (b) 거리로 가중한다 — 가까운 경쟁점이 같은 방향에 있을수록 더 막는다.
        label: "거리가중 방향 비중",
        f: (s) => {
          const d = dirByStore.get(s.storeCode);
          if (!d || s.lat == null || s.lng == null || !d.sum) return null;
          let w = 0, acc = 0;
          for (const c of compsByCode.get(existingStoreSourceCode(s)) ?? []) {
            if (c.lat == null || c.lng == null) continue;
            const dist = rivalDistanceM(s, c);
            if (dist == null || dist > EFFECTIVE_M) continue;
            const ip = c.appliedPcCount ?? c.totalPcCount ?? 0;
            if (!ip) continue;
            const wt = ip / Math.max(50, dist); // 가까울수록 크게
            const dir = dirOf(bearingDeg(s.lat, s.lng, c.lat, c.lng));
            acc += wt * ((d.byDir[dir] ?? 0) / d.sum); w += wt;
          }
          return w > 0 ? acc / w / (1 / 8) - 1 : null;
        },
      },
      {
        // (c) 제일 붐비는 방위 ±1칸 안에 경쟁점이 있나 (0/1) — 제일 거친 형태.
        label: "붐비는 방위에 경쟁점 있나(0/1)",
        f: (s) => {
          const d = dirByStore.get(s.storeCode);
          if (!d || s.lat == null || s.lng == null) return null;
          const bi = DIRS.indexOf(d.busiestDir as (typeof DIRS)[number]);
          if (bi < 0) return null;
          let any = false, seen = false;
          for (const c of compsByCode.get(existingStoreSourceCode(s)) ?? []) {
            if (c.lat == null || c.lng == null) continue;
            const dist = rivalDistanceM(s, c);
            if (dist == null || dist > EFFECTIVE_M) continue;
            seen = true;
            const di = DIRS.indexOf(dirOf(bearingDeg(s.lat, s.lng, c.lat, c.lng)));
            const gap = Math.min((di - bi + 8) % 8, (bi - di + 8) % 8);
            if (gap <= 1) any = true;
          }
          return seen ? (any ? 1 : 0) : null;
        },
      },
      {
        // (d) 경쟁PC 중 붐비는 쪽에 있는 비율 — "얼마나 많이" 막고 있나.
        label: "붐비는 쪽 경쟁PC 비율",
        f: (s) => {
          const d = dirByStore.get(s.storeCode);
          if (!d || s.lat == null || s.lng == null) return null;
          const bi = DIRS.indexOf(d.busiestDir as (typeof DIRS)[number]);
          if (bi < 0) return null;
          let tot = 0, hit = 0;
          for (const c of compsByCode.get(existingStoreSourceCode(s)) ?? []) {
            if (c.lat == null || c.lng == null) continue;
            const dist = rivalDistanceM(s, c);
            if (dist == null || dist > EFFECTIVE_M) continue;
            const ip = c.appliedPcCount ?? c.totalPcCount ?? 0;
            if (!ip) continue;
            tot += ip;
            const di = DIRS.indexOf(dirOf(bearingDeg(s.lat, s.lng, c.lat, c.lng)));
            if (Math.min((di - bi + 8) % 8, (bi - di + 8) % 8) <= 1) hit += ip;
          }
          return tot > 0 ? hit / tot : null;
        },
      },
    ];

    const errOf = (s: ExistingStore) => {
      const r = byCode.get(s.storeCode);
      return r && r.predicted != null && r.actual > 0 ? (r.predicted - r.actual) / r.actual : null;
    };

    const report = (title: string, pool: ExistingStore[]) => {
      console.log(`\n  ── ${title} (n=${pool.length}) ──`);
      console.log(`  ${"공식".padEnd(30)}${"n".padStart(5)}${"피어슨".padStart(9)}${"스피어만".padStart(10)}`);
      for (const v of variants) {
        const xs: number[] = [], ys: number[] = [];
        for (const s of pool) {
          const x = v.f(s), y = errOf(s);
          if (x != null && y != null) { xs.push(x); ys.push(y); }
        }
        console.log(`  ${v.label.padEnd(30)}${String(xs.length).padStart(5)}${pearson(xs, ys).toFixed(3).padStart(9)}${spearman(xs, ys).toFixed(3).padStart(10)}`);
      }
    };

    console.log(`\n══ (3) 공식 변형 · 쏠림이 뚜렷한 상권만 따로 ══`);
    console.log(`  착상이 맞다면 상관이 **음수**여야 한다(붐비는 쪽에 경쟁점 -> 더 과소예측).`);
    const withDir = stores.filter((s) => dirByStore.has(s.storeCode));
    report("전체", withDir);

    // 쏠림이 거의 없는 상권은 방향이 뜻이 없다 — 섞이면 신호를 덮는다.
    const ecc = (s: ExistingStore) => dirByStore.get(s.storeCode)?.eccentricity ?? 0;
    const sortedEcc = withDir.map(ecc).sort((a, b) => a - b);
    const medEcc = sortedEcc[Math.floor(sortedEcc.length / 2)];
    report(`쏠림 상위 절반만 (eccentricity > ${medEcc.toFixed(2)})`, withDir.filter((s) => ecc(s) > medEcc));
    report(`쏠림 상위 1/3만`, withDir.filter((s) => ecc(s) > sortedEcc[Math.floor(sortedEcc.length * 2 / 3)]));

    console.log(`\n  ⚠️ n이 10~20곳으로 줄면 상관 0.4도 우연히 난다. 부호가 일관되게 음수인지를 본다.`);
    expect(variants.length).toBe(4);
  });
});
