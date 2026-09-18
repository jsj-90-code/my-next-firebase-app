// 교과서식 — **세 다리를 다 붙인** 전체 성적 (2026-09-16)
//
// ── 왜 이 하네스가 필요한가 ────────────────────────────────────────────────
// 입지 5항목이 화면에 붙기 전에 만들어진 하네스(`_textbookScore.test.ts`)는 `location`을
// 아예 안 넘겼다. 그래서 거기 찍히던 MAPE 54.6%는 **입지가 빠진 숫자**였고, 입지를 붙인
// 전체 성적은 아무도 잰 적이 없었다(backlog.md 2026-09-16 저녁 3절).
//
// 여기서는 실험실 화면과 **같은 조립 함수**(labInput.ts의 buildLabRows)를 쓴다. 베끼지
// 않으므로 화면에 새 항목이 붙으면 이 하네스도 자동으로 같이 본다 — 같은 사고가 두 번
// 나지 않게 하는 게 이 파일의 절반이다.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────────
// 1) 입지를 통째로 뺀 성적(location: null)
// 2) 지금 계수 그대로 붙인 성적 (중심도 ν=0.25 · 접근성 κ=0.25 · 나머지 0)
// 3) 항목을 하나씩 켜 보며 각 항이 얼마를 하는지
// 4) 유동 방향 ω를 0에서 올려 보며 — **켤지 말지는 사용자 결정**이고 여기선 숫자만 낸다
//
// ⚠️ **측정만 한다. 채택하지 않는다.** MAPE가 내려갔다고 계수를 바꾸지 않는다 — 채택은
//    무작위 대조군을 둔 검정과 기전 설명이 있어야 하고, 그건 _locationRebuild.test.ts의
//    관문이다(backlog.md 산식 실험 판정 기준).
//
// 실행:
//   npx vitest run src/lib/storeEval/_textbookFull.test.ts --reporter=verbose --disable-console-intercept

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

/** QSC 수집물. gitignore라 PC마다 있을 수도 없을 수도 있다 — 없으면 관리가 4.00으로 남는다. */
const QSC_FILE = ".local-tools/qsc-scores.json";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** 피어슨 상관. 표본이 2곳 미만이거나 한쪽이 상수면 0을 돌려준다(값을 지어내지 않는다). */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

describeIf("교과서식 — 입지까지 붙인 전체 성적", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );

  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }

  // 실측 가동률 — 화면과 **같은 함수**를 쓴다. 스냅샷은 월매출 컬렉션을 통째로 담고 있어서
  // (41곳 850건) 평가창 밖 월이 섞인다. 거르는 일은 labInput.ts 안에 있다.
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  // QSC(관리 점수의 원자료)는 로컬 수집물에 있다. **화면과 같은 값을 넣어야 한다** —
  // 안 넣으면 화면은 관리 1.44~5.00으로, 여기는 4.00 고정으로 돌아 성적이 갈라진다.
  // 파일이 없는 PC에서는 그냥 빈 Map이 되고, 그때는 관리가 4.00으로 남는다(지어내지 않는다).
  // **스냅샷을 먼저 본다.** 2026-09-17에 dumpValidationSnapshot이 storeEvalLabQscScores도
  // 뜨게 했다 — 로컬 수집물은 gitignore라 PC를 옮기면 안 따라오고, 그러면 하네스는 관리
  // 4.00으로 화면은 QSC 값으로 돌아 성적이 조용히 갈라진다. 스냅샷에 없을 때만 파일로 떨어진다.
  // **원본 기록을 그대로 들고 있는다.** 창을 바꿔 다시 평균 내는 시험(아래 "QSC 창을 넓히면")이
  // 있어서, 평균 낸 값만 들고 있으면 그 시험이 원본 파일을 따로 읽어야 한다 — 그러면 파일이
  // 없는 PC에서만 붉어진다(2026-09-17 집 PC에서 실제로 그랬다).
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  const fromSnapshot = (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[];
  for (const doc of fromSnapshot) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [key, site] of Object.entries(sites)) {
      qscSites.set(key.startsWith("existing:") ? key.slice("existing:".length) : key, site);
    }
  }

  /** 창을 정해서 매장별 QSC 평균을 낸다. 창을 안 주면 채택된 규칙(전 기간)이다. */
  const qscAverages = (months?: number) => {
    const m = new Map<string, number>();
    for (const [code, site] of qscSites) {
      const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null, months);
      if (avg != null) m.set(code, avg);
    }
    return m;
  };

  const qscByStoreCode = qscAverages();

  // 로드뷰 판정은 Firestore에 있어 하네스(오프라인 스냅샷)에서는 안 읽는다. 계수가 0이라
  // 결과에 영향이 없다 — 켤 때가 오면 스냅샷에 같이 담아야 한다.
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  console.log(`\n[QSC] 관리 점수를 실측으로 채운 곳 ${qscByStoreCode.size}곳` +
    (qscByStoreCode.size ? ` (나머지는 가맹점 평균)` : ` — 수집물이 없어 전부 4.00 고정으로 돈다`));

  /** 입지 항목을 골라서 끈 행을 만든다. 원본은 안 건드린다. */
  function withLocation(keep: "none" | "all" | Array<"centrality" | "access" | "direction">): LabRow[] {
    if (keep === "all") return rows;
    return rows.map((r) => ({
      actualRevenue: r.actualRevenue,
      input: {
        ...r.input,
        location: keep === "none" ? null : {
          centrality: keep.includes("centrality") ? r.input.location?.centrality ?? null : null,
          access: keep.includes("access") ? r.input.location?.access ?? null : null,
          direction: keep.includes("direction") ? r.input.location?.direction ?? null : null,
          flowBlock: null,
          visibility: null,
        },
      },
    }));
  }

  const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS };
  const line = (label: string, rs: LabRow[], p: TextbookParams = P) => {
    const sc = scoreTextbook(rs, p);
    const f = (v: number | null | undefined, d = 2) => (v == null ? "-" : (v * 100).toFixed(d));
    console.log(
      `  ${label.padEnd(26)} MAPE ${f(sc.mape).padStart(6)}%  중앙 ${f(sc.medianAbsErr, 1).padStart(5)}%` +
      `  ±20% ${f(sc.within20, 0).padStart(3)}%  최대 ${f(sc.maxAbsErr, 0).padStart(4)}%  n=${sc.sampleCount}`,
    );
    return sc;
  };

  it("표본과 입지 자료가 다 잡힌다", () => {
    const withCentrality = rows.filter((r) => r.input.location?.centrality != null).length;
    const withAccess = rows.filter((r) => r.input.location?.access != null).length;
    const withDirection = rows.filter((r) => r.input.location?.direction != null).length;
    console.log(`\n표본 ${rows.length}곳 · 중심도 ${withCentrality}곳 · 접근성 ${withAccess}곳 · 유동방향 ${withDirection}곳`);
    expect(rows.length).toBeGreaterThan(30);
    // 유동 방향은 2026-09-16에 52곳 전부 채웠다. 하나라도 비면 배선이 끊긴 것이다.
    expect(withDirection).toBe(rows.length);

    // 중심도가 수요 다리와 겹치는지 — 수요식은 유동 400m를 쓰고 중심도는 유동 300m/1km다.
    // 겹치면 "상권 끝"이 아니라 **유동 총량을 한 번 더 곱하는 것**이 된다(이중계산).
    const pairs = rows
      .map((r) => [r.input.location?.centrality ?? null, r.input.floatingByRadius[400] ?? null] as const)
      .filter((x): x is readonly [number, number] => x[0] != null && x[1] != null);
    const r = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
    console.log(`중심도 ↔ 수요식 유동400m 상관 r=${r.toFixed(3)} (n=${pairs.length})`);
  });

  // ⚠️ 2026-09-17 — 점유율 잔차에서 고른 QSC 바닥(80)이 **매출에서는 최선이 아니다.**
  // _qscResidual.test.ts는 경쟁상권 23곳의 점유율만 봤고(22.09%가 최선), 여기는 38곳 매출을
  // 본다. 독점 매장은 나눌 상대가 없어 관리 점수를 내려도 점유율이 안 변하는데, 경쟁 매장만
  // 내려가면 **편향이 생긴다.** 그 편향이 매출 단계에서 드러난다.
  // 사용자 질문(2026-09-17): *"청주터미널 QSC체크리스트있는데"* — 있다. 다만 제일 이른
  // 점검이 개점 13개월째라 평가창(1~12개월) 밖이다. 같은 처지가 7곳이고 그중 4곳은
  // 13~14개월로 **한두 달 차이**다. 창을 넓히면 표본이 늘고 시점 통일이 흐려진다.
  // 사용자 방향: *"다른매장 개월수늘려서 별차이없으면 평균값으로 조지자고"*
  it("QSC 창을 넓히면 — 표본은 늘고 시점은 흐려진다. 값어치가 있나", () => {
    if (!qscByStoreCode.size) { console.log("\n[QSC] 수집물이 없다 — 건너뜀"); return; }
    const mapAt = (months: number) => qscAverages(months);
    const mg = (q: number) => Math.max(1, Math.min(5, 1 + (q - 60) * (4 / 40)));
    console.log("\n[QSC 창 훑기 — 바닥 60 고정 · 매출 기준]");
    console.log(`  ${"창".padStart(10)}${"실측 매장".padStart(10)}${"관리 평균".padStart(10)}${"MAPE".padStart(9)}${"중앙".padStart(8)}${"최대".padStart(8)}`);
    for (const months of [12, 15, 18, 24, Infinity]) {
      const qm = mapAt(months); // 원본 기록에서 창만 바꿔 다시 평균 낸다 — 스냅샷·로컬파일 어느 쪽이어도 된다
      const scores = [...qm.values()].map(mg);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const base = buildLabRows({ stores, compsByCode, utilByStore, settings });
      const rs = base.map((r) => {
        const q = qm.get(r.input.storeCode);
        const v = q == null ? avg : mg(q);
        return { ...r, input: { ...r.input, ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, management: v } : r.input.ownQualityParts } };
      });
      const sc = scoreTextbook(rs, P);
      const f = (v: number | null | undefined, d = 2) => (v == null ? "-" : (v * 100).toFixed(d));
      const label = months === Infinity ? "전체기간" : `${months}개월`;
      // 실측으로 채워진 매장 수는 **행에 들어간 것 기준**이다(표본 38곳 중 몇 곳).
      const covered = base.filter((r) => qm.has(r.input.storeCode)).length;
      console.log(`  ${label.padStart(10)}${`${covered}/${base.length}`.padStart(10)}${avg.toFixed(2).padStart(10)}${f(sc.mape).padStart(8)}%${f(sc.medianAbsErr, 1).padStart(7)}%${f(sc.maxAbsErr, 0).padStart(7)}%`);
    }
    console.log(`\n  판단거리: 창을 넓히면 "12개월 차 매출"을 "18개월 차 점검"으로 설명하게 된다.`);
    console.log(`  표본이 눈에 띄게 늘고 오차도 좋아지면 살 값어치가 있고, 아니면 12개월을 지킨다.`);
    expect(rows.length).toBeGreaterThan(30);
  }, 300_000);

  it("QSC 바닥을 매출 기준으로 다시 훑는다 — 점유율에서 고른 값이 여기서도 맞나", () => {
    if (!qscByStoreCode.size) { console.log("\n[QSC] 수집물이 없다 — 건너뜀"); return; }
    const mg = (q: number, floor: number) => Math.max(1, Math.min(5, 1 + (q - floor) * (4 / (100 - floor))));
    /** 바닥을 바꿔 행을 다시 만든다. floor=null이면 QSC를 아예 안 쓴다(전부 4.00). */
    const rowsAt = (floor: number | null): LabRow[] => {
      if (floor == null) return buildLabRows({ stores, compsByCode, utilByStore, settings });
      const mapped = new Map<string, number>();
      for (const [code, q] of qscByStoreCode) mapped.set(code, q);
      const scores = [...mapped.values()].map((q) => mg(q, floor));
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const base = buildLabRows({ stores, compsByCode, utilByStore, settings });
      return base.map((r) => {
        const q = mapped.get(r.input.storeCode);
        const m = q == null ? avg : mg(q, floor);
        return { ...r, input: { ...r.input, ownQualityParts: r.input.ownQualityParts ? { ...r.input.ownQualityParts, management: m } : r.input.ownQualityParts } };
      });
    };
    console.log("\n[QSC 바닥 — 매출 기준] 관리 = 1 + (QSC-바닥) x 4/(100-바닥)");
    line("QSC 안 씀 (전부 4.00)", rowsAt(null));
    for (const f of [50, 60, 65, 70, 75, 80, 85]) {
      const scores = [...qscByStoreCode.values()].map((q) => mg(q, f));
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      line(`바닥 ${f} (관리 평균 ${avg.toFixed(2)})`, rowsAt(f));
    }
    console.log("\n  ⚠️ 점유율 기준(_qscResidual, 경쟁상권 23곳)은 바닥 80을 골랐다. 두 자리가 갈리면");
    console.log("     그건 문제 제기지 채택 근거가 아니다 — 독점 매장이 안 움직여 편향이 생긴다.");

    // ── 관문 — 표본 안 최선을 그대로 고르면 안 된다 ────────────────────────
    // 이 저장소가 두 번 속은 방식이다(2026-09-15 밀집도 r=0.660 · 2026-09-16 gamma=4).
    // 매출 기준으로 LOO와 무작위 대조군을 건다.
    const FLOORS = [50, 60, 65, 70, 75, 80, 85];
    const errsOf = (rs: LabRow[]) => {
      const sc = scoreTextbook(rs, P);
      const byCode = new Map(sc.rows.map((r) => [r.storeCode, r]));
      return rs.map((r) => {
        const o = byCode.get(r.input.storeCode);
        return o?.absErrPct != null ? { code: r.input.storeCode, e: o.absErrPct } : null;
      }).filter((x): x is { code: string; e: number } => x != null);
    };
    // 바닥별 매장별 오차를 한 번씩만 계산해 둔다(재계산이 비싸다).
    const errByFloor = new Map<number | null, Map<string, number>>();
    for (const f of [null, ...FLOORS]) errByFloor.set(f, new Map(errsOf(rowsAt(f)).map((x) => [x.code, x.e])));
    const codes = [...errByFloor.get(null)!.keys()];
    const mapeOn = (cs: string[], f: number | null) => {
      const m = errByFloor.get(f)!;
      const vs = cs.map((c) => m.get(c)).filter((v): v is number => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN;
    };
    const pickOn = (cs: string[]) => FLOORS.reduce((a, b) => (mapeOn(cs, b) < mapeOn(cs, a) ? b : a), FLOORS[0]);

    const held: number[] = [], picks: number[] = [];
    for (const c of codes) {
      const rest = codes.filter((x) => x !== c);
      const f = pickOn(rest);
      picks.push(f);
      const v = errByFloor.get(f)!.get(c);
      if (v != null) held.push(v);
    }
    const ins = pickOn(codes);
    const tally = [...new Set(picks)].map((x) => [x, picks.filter((y) => y === x).length] as const).sort((a, b) => b[1] - a[1]);
    console.log(`\n[LOO · 매출] 표본 안 최선 바닥 ${ins} (${(mapeOn(codes, ins) * 100).toFixed(2)}%) -> 홀드아웃 ${(held.reduce((a, b) => a + b, 0) / held.length * 100).toFixed(2)}%` +
      ` (벌어짐 ${((held.reduce((a, b) => a + b, 0) / held.length - mapeOn(codes, ins)) * 100).toFixed(2)}%p)`);
    console.log(`  훈련겹이 고른 바닥: ${tally.slice(0, 3).map(([x, n]) => `${x}(${n}회)`).join(" · ")}`);

    // 대조군 — QSC 점수만 매장끼리 섞는다. 기준선은 "QSC 안 씀".
    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const gainReal = mapeOn(codes, null) - mapeOn(codes, ins);
    const withQsc = [...qscByStoreCode.keys()];
    const gains: number[] = [];
    for (let i = 0; i < 200; i++) {
      const pool = [...qscByStoreCode.values()];
      for (let j = pool.length - 1; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [pool[j], pool[k]] = [pool[k], pool[j]]; }
      const shuffled = new Map(withQsc.map((c, j) => [c, pool[j]]));
      const saved = new Map(qscByStoreCode);
      qscByStoreCode.clear();
      for (const [c, v] of shuffled) qscByStoreCode.set(c, v);
      const m = new Map<number, Map<string, number>>();
      for (const f of FLOORS) m.set(f, new Map(errsOf(rowsAt(f)).map((x) => [x.code, x.e])));
      const best = Math.min(...FLOORS.map((f) => {
        const mm = m.get(f)!;
        const vs = codes.map((c) => mm.get(c)).filter((v): v is number => v != null);
        return vs.reduce((a, b) => a + b, 0) / vs.length;
      }));
      gains.push(mapeOn(codes, null) - best);
      qscByStoreCode.clear();
      for (const [c, v] of saved) qscByStoreCode.set(c, v);
    }
    gains.sort((a, b) => a - b);
    const pv = (gains.filter((g) => g >= gainReal).length + 1) / (gains.length + 1);
    console.log(`[대조군 · 매출 · 바닥을 자료가 고름] 실제 좋아진 폭 ${(gainReal * 100).toFixed(2)}%p · 섞으면 중앙 ${(gains[Math.floor(gains.length / 2)] * 100).toFixed(2)}%p` +
      ` · 95퍼센타일 ${(gains[Math.floor(gains.length * 0.95)] * 100).toFixed(2)}%p · p=${pv.toFixed(3)} ${pv < 0.05 ? "✅" : "❌"}`);
    console.log(`  ⚠️ 이 검정에는 **바닥 8개 중 최선을 고르는 자유도**가 들어 있다. 무작위 QSC라도`);
    console.log(`     8개 중 제일 좋은 걸 고르면 우연히 좋아 보인다. 바닥을 뜻으로 고정하면 이 자유도가 없다.`);

    // ── 바닥을 고정한 대조군 — 계수를 [감각]으로 정할 때 맞는 검정 ──────────
    // 저장소 규칙: "검정은 '이 항목이 중요한가'가 아니라 '자료에서 주워온 숫자를 믿어도
    // 되나'를 묻는 것이라, 감각으로 정한 값에는 필요 없다." 그래도 **QSC 자체가 신호인지**는
    // 확인할 값어치가 있다 — 바닥을 박아두고 QSC 점수만 섞어 본다.
    console.log(`\n[대조군 · 매출 · 바닥 고정] 바닥을 박아두고 QSC 점수만 매장끼리 섞는다`);
    for (const f of [60, 70, 80]) {
      const real = mapeOn(codes, null) - mapeOn(codes, f);
      const gs: number[] = [];
      for (let i = 0; i < 200; i++) {
        const pool = [...qscByStoreCode.values()];
        for (let j = pool.length - 1; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); [pool[j], pool[k]] = [pool[k], pool[j]]; }
        const saved = new Map(qscByStoreCode);
        const shuffled = withQsc.map((c, j) => [c, pool[j]] as const);
        qscByStoreCode.clear();
        for (const [c, v] of shuffled) qscByStoreCode.set(c, v);
        const mm = new Map(errsOf(rowsAt(f)).map((x) => [x.code, x.e]));
        const vs = codes.map((c) => mm.get(c)).filter((v): v is number => v != null);
        gs.push(mapeOn(codes, null) - vs.reduce((a, b) => a + b, 0) / vs.length);
        qscByStoreCode.clear();
        for (const [c, v] of saved) qscByStoreCode.set(c, v);
      }
      gs.sort((a, b) => a - b);
      const p = (gs.filter((g) => g >= real).length + 1) / (gs.length + 1);
      console.log(`  바닥 ${f}: 실제 ${(real * 100).toFixed(2)}%p · 섞으면 중앙 ${(gs[Math.floor(gs.length / 2)] * 100).toFixed(2)}%p` +
        ` · 95퍼센타일 ${(gs[Math.floor(gs.length * 0.95)] * 100).toFixed(2)}%p · p=${p.toFixed(3)} ${p < 0.05 ? "✅" : "❌"}`);
    }
    expect(rows.length).toBeGreaterThan(30);
  }, 600_000);

  it("입지가 전체 성적에 얼마를 하는가", () => {
    console.log("\n[입지 항목별] 계수는 기본값 — 중심도 ν=0.25 · 접근성 κ=0.25 · 유동방향 ω=0");
    const none = line("입지 없음", withLocation("none"));
    line("중심도만", withLocation(["centrality"]));
    line("접근성만", withLocation(["access"]));
    const all = line("중심도+접근성 (지금)", withLocation("all"));
    console.log(`\n  직전 기록: 입지·새 경쟁항 이전 MAPE 29.42% · 운영 산식(V62) 9.26%`);
    console.log(`  입지를 붙여 ${((none.mape ?? 0) * 100).toFixed(2)}% -> ${((all.mape ?? 0) * 100).toFixed(2)}%`);
    expect(all.sampleCount).toBeGreaterThan(30);
  });

  // ⚠️ 여기가 이 파일의 핵심이다. 중심도 ν와 접근성 κ는 **점유율 잔차**에서 골라진 값이다
  // (_locationRebuild.test.ts, 경쟁상권 29곳). 매출까지 가는 전체 파이프라인에서도 같은
  // 값이 맞는지는 아무도 안 봤다. 두 자리에서 답이 갈리면 그게 문제 제기지 채택 근거가 아니다.
  it("중심도 ν · 접근성 κ를 훑는다 — 점유율에서 고른 값이 매출에서도 맞나", () => {
    console.log("\n[중심도 ν] 접근성 κ=0.25 고정");
    for (const nu of [0, 0.1, 0.25, 0.5]) {
      line(`ν=${nu}`, rows, { ...P, locationExponents: { ...P.locationExponents, centrality: nu } });
    }
    console.log("\n[접근성 κ] 중심도 ν=0.25 고정");
    for (const kappa of [0, 0.1, 0.25, 0.5]) {
      line(`κ=${kappa}`, rows, { ...P, locationExponents: { ...P.locationExponents, access: kappa } });
    }
    console.log("\n[둘 다 끔] 기준");
    line("ν=0 · κ=0", rows, { ...P, locationExponents: { ...P.locationExponents, centrality: 0, access: 0 } });
    expect(rows.length).toBeGreaterThan(30);
  });

  // ── 이중계산을 걷어낸 중심도 ─────────────────────────────────────────────
  //
  // 중심도의 뜻은 "동네 규모를 감안했을 때 우리가 상권 중심이냐 끝이냐"다. 그런데 지금 값에는
  // **동네 규모 자체가 섞여 있다**(수요식 유동400m와 r=0.605). 그래서 수요가 이미 센 것을
  // 점유율에서 한 번 더 곱한다.
  //
  // 섞인 부분만 빼낸다: log(중심도)를 log(유동400m)에 회귀시키고 **잔차만** 쓴다. 남는 건
  // "같은 규모의 동네끼리 비교했을 때 우리가 중심이냐 끝이냐"다 — 원래 재려던 그것이다.
  // 새로 모을 자료가 없다. 있는 값으로 계산만 다시 한다.
  //
  // 기하평균을 기준값에 맞춰 되돌린다. 곱셈 보정 (x/기준)^지수는 표본 전체에서 평균 1배여야
  // 중립인데, 그러려면 로그 공간의 중심 = 기하평균이 기준과 같아야 한다(2026-09-16 ⑫와 같은 이유).
  const residualCentralityRows: LabRow[] = (() => {
    const idx: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    rows.forEach((r, i) => {
      const c = r.input.location?.centrality ?? null;
      const f = r.input.floatingByRadius[400] ?? null;
      if (c != null && c > 0 && f != null && f > 0) { idx.push(i); xs.push(Math.log(f)); ys.push(Math.log(c)); }
    });
    const n = xs.length;
    if (n < 3) return rows;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const ref = Math.log(P.locationReferences.centrality);
    const fixed = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const resid = ys[i] - (my + slope * (xs[i] - mx));
      fixed.set(idx[i], Math.exp(resid + ref));
    }
    console.log(`\n[중심도 잔차화] log-log 기울기 ${slope.toFixed(3)} · n=${n}`);
    return rows.map((r, i) => ({
      actualRevenue: r.actualRevenue,
      input: { ...r.input, location: r.input.location ? { ...r.input.location, centrality: fixed.get(i) ?? null } : null },
    }));
  })();

  it("이중계산을 걷어낸 중심도 — 그래도 쓸모가 있나", () => {
    const before = rows
      .map((r) => [r.input.location?.centrality ?? null, r.input.floatingByRadius[400] ?? null] as const)
      .filter((x): x is readonly [number, number] => x[0] != null && x[1] != null);
    const after = residualCentralityRows
      .map((r) => [r.input.location?.centrality ?? null, r.input.floatingByRadius[400] ?? null] as const)
      .filter((x): x is readonly [number, number] => x[0] != null && x[1] != null);
    console.log(`  수요식 유동400m와의 겹침: ${pearson(before.map((x) => x[0]), before.map((x) => x[1])).toFixed(3)}` +
      ` -> ${pearson(after.map((x) => x[0]), after.map((x) => x[1])).toFixed(3)}`);

    console.log("\n[잔차화 중심도 ν] 접근성 κ=0.25 고정");
    for (const nu of [0, 0.1, 0.25, 0.5, 1]) {
      line(`ν=${nu}`, residualCentralityRows, { ...P, locationExponents: { ...P.locationExponents, centrality: nu } });
    }
    console.log("  (비교) 손 안 댄 중심도 ν=0.25 -> 45.86% · ν=0 -> 38.64%");
    expect(residualCentralityRows.length).toBe(rows.length);
  });

  // ── 관문 ──────────────────────────────────────────────────────────────────
  //
  // 36.36%가 진짜인지 묻는다. 기존 관문(_locationRebuild.test.ts)은 **점유율 공간**에만 있고,
  // 오늘 드러난 이중계산은 바로 그 공간에서 안 보이던 것이라 여기서 다시 세워야 한다.
  //
  // 1) 무작위 대조군 — 중심도 값을 매장끼리 **뒤섞어** 같은 절차를 밟는다. 뒤섞은 값도
  //    비슷하게 좋아진다면 그건 "자유 계수 하나를 더 준 효과"지 중심도가 한 일이 아니다.
  // 2) LOO — 한 곳을 빼고 ν를 고른 뒤, 안 본 그 한 곳을 맞혀본다. 표본 안 성적과 많이
  //    벌어지면 38곳에만 맞춘 것이다.
  //
  // ⚠️ LOO에서 축척(hoursPerUser/productUnitPrice)은 38곳 전부로 다시 맞춰진다. 계수 선택만
  //    홀드아웃이고 축척은 아니라, 벌어짐이 **실제보다 작게** 나온다. 낙관적인 쪽 편향이다.
  const NU_GRID = [0, 0.1, 0.25, 0.5, 0.75, 1];
  const mapeAt = (rs: LabRow[], nu: number) =>
    scoreTextbook(rs, { ...P, locationExponents: { ...P.locationExponents, centrality: nu } }).mape ?? Number.POSITIVE_INFINITY;

  /** 격자에서 MAPE가 제일 낮은 ν와 그때의 값. */
  const pickNu = (rs: LabRow[], grid = NU_GRID) => {
    let best = { nu: 0, mape: Number.POSITIVE_INFINITY };
    for (const nu of grid) {
      const m = mapeAt(rs, nu);
      if (m < best.mape) best = { nu, mape: m };
    }
    return best;
  };

  /** 중심도 값만 매장끼리 뒤섞는다. 다른 건 그대로 둔다. */
  function shuffleCentrality(rs: LabRow[], rand: () => number): LabRow[] {
    const vals = rs.map((r) => r.input.location?.centrality ?? null);
    for (let i = vals.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [vals[i], vals[j]] = [vals[j], vals[i]];
    }
    return rs.map((r, i) => ({
      actualRevenue: r.actualRevenue,
      input: { ...r.input, location: r.input.location ? { ...r.input.location, centrality: vals[i] } : null },
    }));
  }

  it("관문 1 — 무작위 대조군", () => {
    const base = mapeAt(residualCentralityRows, 0);
    const real = pickNu(residualCentralityRows);
    const realGain = base - real.mape;
    console.log(`\n[대조군] 진짜 중심도: ν=${real.nu} · MAPE ${(base * 100).toFixed(2)}% -> ${(real.mape * 100).toFixed(2)}% (좋아진 폭 ${(realGain * 100).toFixed(2)}%p)`);

    // 재현되는 난수 — 돌릴 때마다 p값이 흔들리면 판단을 못 한다.
    let seed = 20260916;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    const TRIALS = 200;
    const gains: number[] = [];
    for (let t = 0; t < TRIALS; t++) {
      const sh = shuffleCentrality(residualCentralityRows, rand);
      gains.push(mapeAt(sh, 0) - pickNu(sh).mape);
    }
    gains.sort((a, b) => a - b);
    const ge = gains.filter((g) => g >= realGain).length;
    const p = (ge + 1) / (TRIALS + 1);
    const q95 = gains[Math.floor(0.95 * (gains.length - 1))];
    console.log(`  뒤섞은 값 ${TRIALS}회: 좋아진 폭 중앙 ${(gains[Math.floor(gains.length / 2)] * 100).toFixed(2)}%p · 95퍼센타일 ${(q95 * 100).toFixed(2)}%p`);
    console.log(`  p = ${p.toFixed(3)}  ${p < 0.05 ? "통과 ✅" : "미달 ❌"}`);
    expect(gains.length).toBe(TRIALS);
  });

  it("관문 2 — 한 곳 빼고 고른 뒤 그 한 곳 맞히기 (LOO)", () => {
    const inSample = pickNu(residualCentralityRows);
    const errs: number[] = [];
    const picked = new Map<number, number>();
    for (let i = 0; i < residualCentralityRows.length; i++) {
      const train = residualCentralityRows.filter((_, k) => k !== i);
      const nu = pickNu(train).nu;
      picked.set(nu, (picked.get(nu) ?? 0) + 1);
      const sc = scoreTextbook(residualCentralityRows, { ...P, locationExponents: { ...P.locationExponents, centrality: nu } });
      const e = sc.rows[i]?.absErrPct;
      if (e != null) errs.push(e);
    }
    const loo = errs.reduce((a, b) => a + b, 0) / errs.length;
    const spread = loo - inSample.mape;
    console.log(`\n[LOO] 표본 안 ${(inSample.mape * 100).toFixed(2)}% (ν=${inSample.nu}) -> 홀드아웃 ${(loo * 100).toFixed(2)}%  벌어짐 ${(spread * 100).toFixed(2)}%p`);
    console.log(`  훈련겹이 고른 ν: ${[...picked.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v}회)`).join(" · ")}`);
    expect(errs.length).toBeGreaterThan(30);
  });

  it("경쟁상권 과소예측 — 자료 없는 경쟁점을 자사와 동급으로 세고 있다 (2026-09-18)", () => {
    // 사용자: *"상권내 경쟁점으로 보기 어려운? 영향력적은 매장들은 제거하고 다시보는거어떤데"*
    //
    // ⚠️ **지금 산식은 "모르면 자사와 동급"으로 본다.** textbookModel의 ratio()가 경쟁점
    //    품질을 못 구하면 1을 돌려준다 — 그러면 그 경쟁점은 PC수 전부가 무게로 들어간다.
    //    주석은 "결측을 유리/불리로 해석하지 않는다"고 적혀 있지만, 경쟁점 평균 경쟁력이
    //    자사보다 한참 낮으므로 **실제로는 가장 불리한 쪽(경쟁점 최대 강도)**을 고른 것이다.
    //
    //    그중 9곳은 조사자가 **"노후저경쟁력미조사"**로 적은 곳이다 — 약하다고 판단해서
    //    조사를 생략한 매장인데, 산식은 그걸 자사와 같은 힘으로 센다. 정보를 거꾸로 쓴 셈이다.
    //
    // 여기서 보는 건 MAPE가 아니라 **독점 대비 경쟁상권 잔차 격차**다. 경쟁 항이 너무 세면
    // 경쟁상권만 과소예측되고 독점은 멀쩡하다(축척을 독점에서 맞추므로).
    const gap = (rs: LabRow[], label: string, pp: TextbookParams = P) => {
      const sc = scoreTextbook(rs, pp);
      const monoBy = new Map(rs.map((r) => [r.input.storeCode, !(r.input.competitorIp ?? 0)]));
      const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0)
        .map((x) => ({ e: (x.predicted as number) / x.actual - 1, mono: monoBy.get(x.storeCode) === true }));
      const avg = (a: typeof ok) => a.length ? a.reduce((s2, x) => s2 + x.e, 0) / a.length : NaN;
      const mo = avg(ok.filter((x) => x.mono)), co = avg(ok.filter((x) => !x.mono));
      console.log(`  ${label.padEnd(30)} 독점 ${(mo * 100).toFixed(1).padStart(6)}% · 경쟁상권 ${(co * 100).toFixed(1).padStart(6)}%` +
        ` · 격차 ${((co - mo) * 100).toFixed(1).padStart(6)}%p · MAPE ${((sc.mape ?? 0) * 100).toFixed(2)}%`);
      return co - mo;
    };
    /** 경쟁점 목록을 손봐서 행을 다시 만든다. 원본은 안 건드린다. */
    const build = (fn: (cs: Competitor[]) => Competitor[]) => {
      const m = new Map<string, Competitor[]>();
      for (const [k, v] of compsByCode) m.set(k, fn(v));
      return buildLabRows({ stores, compsByCode: m, utilByStore, settings, qscByStoreCode });
    };
    const hasQ = (c: Competitor) =>
      [c.foodScore, c.interiorScore, c.managementScore, c.vgaBase, c.cpu].some((v) => v != null);

    // 경쟁점 평균 점수 — "모르면 평균"으로 채울 때 쓴다.
    const sv = allCompetitors.filter((c) => c.investigationStatus !== "경쟁점없음");
    const mean = (xs: (number | null | undefined)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    const avgFood = mean(sv.map((c) => c.foodScore));
    const avgInt = mean(sv.map((c) => c.interiorScore));
    const avgMgmt = mean(sv.map((c) => c.managementScore));

    console.log(`\n[경쟁상권 과소예측] 자료 없는 경쟁점을 어떻게 볼 것인가`);
    console.log(`  조사대상 ${sv.length}곳 중 품질자료 전무 ${sv.filter((c) => !hasQ(c)).length}곳` +
      ` (그중 노후저경쟁력미조사 ${sv.filter((c) => c.investigationStatus === "노후저경쟁력미조사").length}곳)`);
    console.log(`  경쟁점 평균 점수 — 먹거리 ${avgFood.toFixed(2)} · 인테리어 ${avgInt.toFixed(2)} · 관리 ${avgMgmt.toFixed(2)}\n`);

    // ⚠️ **자료 없는 20곳은 전부 후보지 경쟁점이고 기존점엔 0곳이다.** 그래서 아래 셋이
    //    기존점 성적을 한 칸도 안 바꾼다. 이 문제는 **후보지 예측 전용**이라
    //    `_labCandidate.test.ts`에서 잰다. 여기 남겨 두는 건 "기존점에선 원인이 아니다"를
    //    기록하려는 것이다 — 안 적어두면 다음에 또 여기서 찾는다.
    gap(rows, "지금 (모르면 자사와 동급)");
    gap(build((cs) => cs.filter((c) => c.investigationStatus !== "노후저경쟁력미조사")),
      "노후저경쟁력 빼기 (기존점 0곳)");
    gap(build((cs) => cs.map((c) => hasQ(c) ? c : ({
      ...c, foodScore: avgFood, interiorScore: avgInt, managementScore: avgMgmt,
    }))), "자료없으면 평균으로 (기존점 0곳)");

    // ── 그럼 기존점 경쟁상권 과소예측의 원인은 무엇인가 ────────────────────────
    // 과소예측 = 점유율이 너무 낮다 = 경쟁점 무게가 너무 크다. 무게를 줄이는 손잡이는 둘이다.
    //   θ ↑  — 자사보다 약한 경쟁점(비<1)이 더 빨리 작아진다
    //   유효거리 ↓ — 먼 경쟁점이 아예 빠진다
    console.log(`\n[손잡이 훑기] 격차를 0으로 가져가는 게 목표다 (지금 -15.6%p)`);
    for (const th of [3, 4, 5, 6]) gap(rows, `  θ=${th}`, { ...P, qualityExponent: th });
    for (const rr of [150, 200, 250, 300]) gap(rows, `  유효거리 ${rr}m`, { ...P, effectiveRadiusM: rr });
    // 바깥선택지 — "PC방을 아예 안 가는 몫". 분모에 더해지므로 점유율을 **낮춘다**.
    // 지금 0인데, 0이 아니면 과소예측이 더 심해진다. 방향 확인용으로만 찍는다.
    for (const oo of [0, 50, 100]) gap(rows, `  바깥선택지 ${oo}`, { ...P, outsideOptionIp: oo });

    // ── 두 문제가 묶여 있다 ────────────────────────────────────────────────
    // θ를 올리면 격차는 닫히는데 MAPE가 나빠진다. θ는 **경쟁력 비**를 증폭하는 손잡이라,
    // 자사 점수가 부풀려져 있으면 그 부풀림까지 같이 증폭한다. 그래서 자를 맞추기 전에는
    // θ를 못 올린다. 자를 맞추면 여지가 생기는지 본다.
    const sameRuler = (to: Record<string, number>) => rows.map((r) => {
      const q = r.input.ownQualityParts;
      if (!q) return r;
      const next = { ...q };
      for (const k of ["food", "interior", "management"] as const) if (next[k] != null) next[k] = to[k];
      return { actualRevenue: r.actualRevenue, input: { ...r.input, ownQualityParts: next } };
    });
    const maxOf = (xs: (number | null | undefined)[]) =>
      Math.max(...xs.filter((x): x is number => x != null));
    const topRuler = sameRuler({
      food: maxOf(sv.map((c) => c.foodScore)),
      interior: maxOf(sv.map((c) => c.interiorScore)),
      management: maxOf(sv.map((c) => c.managementScore)),
    });
    console.log(`\n[자를 맞춘 뒤 θ를 올리면] 자사 = 경쟁점 **최고값**(먹 3.5 / 인 4.5 / 관 4.5)`);
    for (const th of [3, 4, 5, 6]) gap(topRuler, `  θ=${th}`, { ...P, qualityExponent: th });

    // ── 어느 매장이 얼마나 어긋났나 — 치우침이 고르지 않다면 빠진 변수가 있다 ──────
    // 2026-09-18 사용자: *"강릉교동점은 라이킷, MX5 경쟁점 평가에서 뺴야할듯함"* —
    // 사람이 상권이 갈렸다고 본 사례다. 그런 매장이 잔차에서도 눈에 띄는지 본다.
    {
      const sc = scoreTextbook(rows, P);
      const monoBy = new Map(rows.map((r) => [r.input.storeCode, !(r.input.competitorIp ?? 0)]));
      const inR = (r: LabRow) => (r.input.rivals ?? []).filter((v) => v.distanceM == null || v.distanceM <= P.effectiveRadiusM);
      const byCode = new Map(rows.map((r) => [r.input.storeCode, r]));
      const list = sc.rows
        .filter((x) => x.predicted != null && x.actual > 0 && monoBy.get(x.storeCode) === false)
        .map((x) => {
          const r = byCode.get(x.storeCode);
          const rv = r ? inR(r) : [];
          return {
            name: x.storeName ?? x.storeCode,
            e: (x.predicted as number) / x.actual - 1,
            n: rv.length,
            ip: rv.reduce((a, v) => a + v.ip, 0),
            pc: r?.input.pcCount ?? null,
          };
        })
        .sort((a, b) => a.e - b.e);
      console.log(`\n[경쟁상권 ${list.length}곳 — 어긋난 순] 음수가 과소예측이다`);
      console.log("   매장                 잔차     유효거리내 경쟁점  경쟁PC  자사PC");
      for (const x of list) {
        console.log(`  ${x.name.slice(0, 18).padEnd(18)} ${(x.e * 100).toFixed(1).padStart(7)}%  ` +
          `${String(x.n).padStart(6)}곳       ${String(x.ip).padStart(5)}  ${String(x.pc ?? "-").padStart(5)}`);
      }
      console.log(`  ⚠️ 과소예측이 심한 곳일수록 "경쟁점을 너무 세게 본" 후보다 —`);
      console.log(`     사람이 상권이 갈렸다고 보는 매장과 겹치는지 대조할 것.`);

      // ── 사람이 "상권이 갈렸다"고 판정한 짝 — 2026-09-18 사용자 ────────────────
      //
      // ⚠️ **이건 아직 자료가 아니라 시험용 표본이다.** 두 매장만 사람이 봤고, 여기 박아
      //    둔 건 "이 방향이 값어치가 있나"를 재려는 것이다. 값어치가 확인되면 Firestore
      //    필드로 옮기고 나머지 매장도 같은 방식으로 판정해야 한다 — **코드에 남겨 두면
      //    안 된다**(숫자·자료를 글자로 박지 않는다는 이 저장소 규칙).
      //
      // 공통점: 둘 다 **한 방향으로 몰린 무리**다. 강릉교동은 남/남서, 부천상동역은 남서.
      // 그리고 그 방향에서 300m로 이미 빠진 매장이 또 있다(헌터 392m · 철구 309m).
      const SPLIT: Record<string, string[]> = {
        "강릉교동점(신)": ["라이킷", "MX5"],
        "부천상동역점": ["레벨업", "크리드", "더엑스"],
      };
      const splitRows = rows.map((r) => {
        const names = SPLIT[r.input.storeName ?? ""];
        if (!names) return r;
        return {
          actualRevenue: r.actualRevenue,
          input: {
            ...r.input,
            rivals: (r.input.rivals ?? []).filter((v) => !names.some((n) => (v.name ?? "").includes(n))),
          },
        };
      });
      const after = scoreTextbook(splitRows, P);
      console.log(`\n[상권 분리 시험] 사람이 "다른 상권"이라 본 경쟁점을 뺀다 (2곳만 판정됨)`);
      console.log("   매장                 지금      뺀 뒤     경쟁점");
      for (const name of Object.keys(SPLIT)) {
        const b = sc.rows.find((x) => x.storeName === name);
        const a = after.rows.find((x) => x.storeName === name);
        if (!b || !a || b.predicted == null || a.predicted == null) continue;
        const be = b.predicted / b.actual - 1, ae = a.predicted / a.actual - 1;
        const rv = byCode.get(b.storeCode);
        const n0 = rv ? inR(rv).length : 0;
        console.log(`  ${name.padEnd(18)} ${(be * 100).toFixed(1).padStart(7)}% -> ${(ae * 100).toFixed(1).padStart(7)}%` +
          `   ${n0}곳 -> ${n0 - SPLIT[name].length}곳`);
      }
      console.log(`  전체 MAPE ${((sc.mape ?? 0) * 100).toFixed(2)}% -> ${((after.mape ?? 0) * 100).toFixed(2)}%` +
        ` · 중앙 ${((sc.medianAbsErr ?? 0) * 100).toFixed(1)}% -> ${((after.medianAbsErr ?? 0) * 100).toFixed(1)}%` +
        ` · ±20% ${((sc.within20 ?? 0) * 100).toFixed(0)}% -> ${((after.within20 ?? 0) * 100).toFixed(0)}%`);
      console.log(`  ⚠️ 2곳만 고친 것이라 전체 성적이 크게 움직이면 오히려 이상하다.`);
      console.log(`     볼 것은 **그 두 매장이 제자리를 찾는가**다.`);

      // ── ⭐ 위 숫자는 아직 근거가 아니다 ────────────────────────────────────
      //
      // 사용자가 스스로 짚었다(2026-09-18): *"근대내가 지금 예상매출 낮은매장만 보고있긴함"*
      // **맞는 지적이다.** 과소예측 매장만 골라 경쟁점을 빼면 반드시 좋아진다 — 답안지를
      // 보고 고른 것이다(이 저장소에서 반복되는 함정: "걸러낸 자료로 검증하면 항상 통과한다").
      //
      // 그래서 묻는 질문을 바꾼다. "빼면 좋아지나"가 아니라
      //   **"하필 그 경쟁점들을 고른 것이 아무거나 고른 것보다 나은가"**
      // 같은 수를 빼는 조합을 **전부** 세어 사람 판정이 몇 등인지 본다. 1등에 가까우면
      // 사람이 옳은 것을 짚은 것이고, 중간이면 그냥 "빼면 좋아진다"일 뿐이다.
      const combos = <T,>(xs: T[], k: number): T[][] => {
        if (k === 0) return [[]];
        if (xs.length < k) return [];
        const [h, ...t] = xs;
        return [...combos(t, k - 1).map((c) => [h, ...c]), ...combos(t, k)];
      };
      console.log(`\n[대조군] 같은 수를 빼는 **모든 조합**에서 사람 판정이 몇 등인가`);
      for (const [name, picked] of Object.entries(SPLIT)) {
        const row = rows.find((r) => r.input.storeName === name);
        if (!row) continue;
        const rv = inR(row);
        const k = picked.length;
        const all = combos(rv.map((_, i) => i), k);
        const scoreOf = (drop: number[]) => {
          const keep = new Set(rv.filter((_, i) => !drop.includes(i)).map((v) => v.name ?? ""));
          const rs = rows.map((r) => r.input.storeName !== name ? r : ({
            actualRevenue: r.actualRevenue,
            input: { ...r.input, rivals: (r.input.rivals ?? []).filter((v) => keep.has(v.name ?? "")) },
          }));
          const x = scoreTextbook(rs, P).rows.find((y) => y.storeName === name);
          return x?.predicted != null && x.actual > 0 ? Math.abs(x.predicted / x.actual - 1) : Infinity;
        };
        const results = all.map((d) => ({ d, err: scoreOf(d) })).sort((a, b) => a.err - b.err);
        const humanIdx = rv.map((v, i) => picked.some((p) => (v.name ?? "").includes(p)) ? i : -1).filter((i) => i >= 0);
        const humanErr = scoreOf(humanIdx);
        const rank = results.filter((r) => r.err < humanErr - 1e-9).length + 1;
        console.log(`  ${name} — ${rv.length}곳 중 ${k}곳 빼기 · 조합 ${all.length}가지`);
        console.log(`     사람 판정 오차 ${(humanErr * 100).toFixed(1)}% -> **${rank}등 / ${all.length}**` +
          ` (최선 ${(results[0].err * 100).toFixed(1)}% · 중앙 ${(results[Math.floor(results.length / 2)].err * 100).toFixed(1)}%` +
          ` · 최악 ${(results[results.length - 1].err * 100).toFixed(1)}%)`);
        console.log(`     백분위 상위 ${((rank / all.length) * 100).toFixed(0)}%` +
          `${rank / all.length <= 0.2 ? "  ✅ 아무거나 고른 것보다 낫다" : "  ⚠️ 그냥 '빼면 좋아진다'와 구분이 안 된다"}`);
      }
      console.log(`\n  ⚠️ 이 검정도 **한계가 있다** — 판정한 2곳이 둘 다 과소예측 매장이다.`);
      console.log(`     제대로 하려면 **잔차를 안 보고** 지도만으로 전 매장을 판정한 뒤 한꺼번에 재야 한다.`);
      console.log(`     과대예측 매장(부경대 +56% · 수원망포 +32%)도 판정해야 가설이 시험된다 —`);
      console.log(`     거기서도 "상권이 갈렸다"가 잔뜩 나오면 이 변수는 잔차와 무관한 것이다.`);
    }

    console.log(`\n  격차가 0에 가까울수록 좋다 — 경쟁 항이 독점 대비 치우치지 않았다는 뜻이다.`);
    console.log(`  ⚠️ **빼는 것과 채우는 것은 다르다.** 빼면 그 상권이 통째로 헐거워져 점유율이`);
    console.log(`     올라가지만, 실제로 그 매장은 거기 있다. "모른다"를 "없다"로 바꾸면 안 된다.`);
    console.log(`  ⚠️ 여기서 격차가 줄어도 **채택 근거가 아니다.** 무작위 대조군을 따로 세울 것.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("자사와 경쟁점이 다른 자로 재고 있다 — 먹거리·인테리어·관리 (2026-09-18)", () => {
    // 사용자: *"관리같은경우 거의 하, 중하, 중, 중상, 상 이런형태로 평가하거든. 좀 모자라다하면
    //          중으로 표현한단말이지. 3점. 근대 우리는 자체 평균이 4.2잖아 이거 개념의 오류가있다.
    //          인테리어도마찬가지 ... 상이없어 애초에 이사람들 평가에. 먹거리는 객관적 평가가
    //          사실안되고 ... 근대 우리는 무조건 1점높지 거의"*
    //
    // ⚠️ **왜 이게 그냥 넘어가지지 않나.** 경쟁력은 `q_경쟁 / q_자사`의 **비**로만 쓰이고,
    //    거기에 θ=3 지수가 붙는다. 자사가 통째로 높으면 경쟁점이 전부 작아 보인다.
    //    그리고 **축척은 독점매장에서 맞춘다** — 독점은 경쟁 항이 약분돼 이 편향을 안 받는다.
    //    그래서 편향이 축척에 흡수되지 않고 **경쟁상권 매장만 과대예측**으로 남는다.
    //
    // 여기서는 두 가지를 잰다.
    //   1) 독점 vs 경쟁상권 잔차 — 위 가설이 맞으면 경쟁상권이 상대적으로 높아야 한다
    //   2) 자사를 조사자 자로 내렸을 때 성적이 어떻게 변하나
    const surveyed = allCompetitors.filter((c) => c.investigationStatus !== "경쟁점없음");
    const stat = (xs: (number | null | undefined)[]) => {
      const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
      return { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, med: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
    };
    const rf = stat(surveyed.map((c) => c.foodScore));
    const ri = stat(surveyed.map((c) => c.interiorScore));
    const rm = stat(surveyed.map((c) => c.managementScore));
    const own = (k: "food" | "interior" | "management") => stat(rows.map((r) => r.input.ownQualityParts?.[k] ?? null));
    console.log(`\n[자가 둘이다] 조사자가 매긴 경쟁점 vs 자사에 들어간 값`);
    console.log("   항목      경쟁점 평균/중앙/최고      자사 평균/중앙/최고");
    for (const [label, r, o] of [["먹거리", rf, own("food")], ["인테리어", ri, own("interior")], ["관리", rm, own("management")]] as const) {
      console.log(`  ${label.padEnd(6)} ${r.avg.toFixed(2)} / ${r.med.toFixed(2)} / ${r.max.toFixed(2)} (n=${r.n})` +
        `      ${o.avg.toFixed(2)} / ${o.med.toFixed(2)} / ${o.max.toFixed(2)} (n=${o.n})`);
    }

    // 1) 독점 vs 경쟁상권 잔차
    const base = scoreTextbook(rows, P);
    const isMono = new Map(rows.map((r) => [r.input.storeCode, !(r.input.competitorIp ?? 0)]));
    const resid = base.rows.filter((x) => x.predicted != null && x.actual > 0)
      .map((x) => ({ code: x.storeCode, e: (x.predicted as number) / x.actual - 1, mono: isMono.get(x.storeCode) === true }));
    const mAvg = (a: typeof resid) => a.length ? a.reduce((s2, x) => s2 + x.e, 0) / a.length : NaN;
    const mono = resid.filter((x) => x.mono), comp = resid.filter((x) => !x.mono);
    console.log(`\n[잔차] 독점 ${mono.length}곳 ${(mAvg(mono) * 100).toFixed(1)}%  vs  경쟁상권 ${comp.length}곳 ${(mAvg(comp) * 100).toFixed(1)}%` +
      `  차이 ${((mAvg(comp) - mAvg(mono)) * 100).toFixed(1)}%p`);
    console.log(`  자사 과대평가 가설이 맞으면 **경쟁상권이 독점보다 높게(과대예측)** 나와야 한다.`);

    // 2) 자사를 조사자 자로 내려 본다 — 항목별로 따로, 그리고 한꺼번에
    const shift = (keys: ("food" | "interior" | "management")[], to: Record<string, number>): LabRow[] =>
      rows.map((r) => {
        const q = r.input.ownQualityParts;
        if (!q) return r;
        const next = { ...q };
        for (const k of keys) if (next[k] != null) next[k] = to[k];
        return { actualRevenue: r.actualRevenue, input: { ...r.input, ownQualityParts: next } };
      });
    const avgTo = { food: rf.avg, interior: ri.avg, management: rm.avg };
    const medTo = { food: rf.med, interior: ri.med, management: rm.med };
    const topTo = { food: rf.max, interior: ri.max, management: rm.max };
    console.log(`\n[자사를 조사자 자로 내리면] 축척은 매번 다시 맞춘다`);
    line("  지금 (자사 4.00/4.00/4.20)", rows);
    line("  먹거리만 경쟁점 평균", shift(["food"], avgTo));
    line("  인테리어만 경쟁점 평균", shift(["interior"], avgTo));
    line("  관리만 경쟁점 평균", shift(["management"], avgTo));
    line("  셋 다 경쟁점 평균", shift(["food", "interior", "management"], avgTo));
    line("  셋 다 경쟁점 중앙", shift(["food", "interior", "management"], medTo));
    line("  셋 다 경쟁점 최고", shift(["food", "interior", "management"], topTo));
    // ── 자를 맞추면 무너진다. 그럼 무엇이 가려져 있었나 ─────────────────────
    // 경쟁상권이 이미 과소예측(-12.6%)인데 자사를 내리면 경쟁점이 더 커져 점유율이 더
    // 내려간다. **두 오류가 서로를 가리고 있었다는 뜻이다.** 자를 고치는 건 옳지만
    // 그것만 하면 숨어 있던 쪽이 드러난다. 같이 고칠 수 있는지 본다.
    const fixed = shift(["food", "interior", "management"], avgTo);
    console.log(`\n[자를 맞춘 뒤 경쟁 항을 다시 본다] 자사 = 경쟁점 평균으로 고정`);
    console.log(`  경쟁력 지수 θ (지금 ${P.qualityExponent}) — 올리면 약한 경쟁점이 더 빨리 작아진다`);
    for (const th of [3, 4, 5, 6, 8]) {
      line(`    θ=${th}`, fixed, { ...P, qualityExponent: th });
    }
    console.log(`  유효거리 (지금 ${P.effectiveRadiusM}m) — 줄이면 먼 경쟁점이 빠진다`);
    for (const rr of [150, 200, 250, 300] as const) {
      line(`    ${rr}m`, fixed, { ...P, effectiveRadiusM: rr });
    }
    console.log(`  (비교) 자를 안 맞춘 지금 상태`);
    line(`    θ=${P.qualityExponent} · ${P.effectiveRadiusM}m`, rows);

    console.log(`\n  ⚠️ **MAPE로 고르지 말 것.** 여기서 성적이 좋아지는 건 "자사를 낮추면 경쟁점이`);
    console.log(`     커져 점유율이 내려간다"는 수준 이동일 뿐이다. 무엇이 옳은 자인가는`);
    console.log(`     **자료가 아니라 뜻으로** 정한다 — 같은 문항·같은 척도로 재는 것이다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("정가가 매출에 충분히 반영되나 — 탄력도 β 검증 (2026-09-18)", () => {
    // 사용자: *"적용되는 요금이 실제예상매출에 충분히 적용되고있나? 예를들어 1000원요금 >
    //          1500원요금 요금제 33%정도차이나는데 이게 매출에 적용되었는가"*
    //
    // 정가는 **총단가의 PC몫에만** 들어가고 그것도 지수 β=0.546으로 눌려 들어간다.
    //   총단가 = 기준정가 x (정가/기준정가)^β  +  상품몫(상수)
    // 그래서 정가 차이가 매출 차이로 **그대로 옮겨가지 않는다.** 얼마나 옮겨가는지 먼저 찍고,
    // 그 눌림이 **자료에 맞는지**(β가 너무 낮지 않은지) 잔차로 판정한다.
    const { rateElasticity: beta0, referenceHourlyRate: ref } = P;
    const pcMok = (rate: number, b: number) => ref * Math.pow(rate / ref, b);
    const total = (rate: number, b: number, prod: number) => pcMok(rate, b) + prod;

    const base = scoreTextbook(rows, P);
    const prod = base.fittedProductUnitPrice;
    console.log(`\n[정가 -> 총단가] 기준정가 ${ref}원 · β=${beta0} · 상품몫 ${Math.round(prod)}원(상수)`);
    console.log("   정가     PC몫    상품몫    총단가   1000원 대비");
    const t1000 = total(1000, beta0, prod);
    for (const rate of [1000, 1200, 1343, 1500, 2000, 2500]) {
      const t = total(rate, beta0, prod);
      console.log(`  ${String(rate).padStart(5)}원 ${String(Math.round(pcMok(rate, beta0))).padStart(6)}원 ` +
        `${String(Math.round(prod)).padStart(6)}원 ${String(Math.round(t)).padStart(7)}원 ` +
        `${((t / t1000 - 1) * 100).toFixed(1).padStart(7)}%`);
    }
    // ── 억제가 두 겹인데, 겹치는 건 아닌가 (2026-09-18 사용자 질문) ─────────────
    // 사용자: *"먹거리 제외되어야 하기 때문에 절반만 적용된다 하면 지금이 적절한건가?"*
    //
    // 겹치지 않는다. **둘은 서로 다른 자로 따로 잰 값이다.**
    //   상품몫 상수 — 실매출 ÷ (PC x 720 x 실측가동률) − PC몫 으로 전 매장에서 직접 측정
    //   β=0.546   — **실효단가 = PC매출 ÷ 참이용시간**의 log-log 회귀 기울기(settings.ts).
    //               분자가 *PC매출*이라 **먹거리가 애초에 안 섞여 있다.**
    // 그래서 "β로 한 번, 상품몫으로 또 한 번" 이중으로 깎는 게 아니다. β는 PC몫 안에서만
    // 일하고, 상품몫은 요금과 무관한 몫을 따로 들고 있을 뿐이다.
    //
    // 그 증거: 이 PC몫 식은 운영 usageRevenue.ts effectiveHourlyRate와 글자 그대로 같고,
    // 실측 PC몫 ÷ 이 식의 기하평균이 1.005였다(backlog 2026-09-16 저녁(3)).
    //
    // 아래는 **측정된 실효단가 비율과 이 식이 그리는 곡선을 직접 댄 것**이다.
    // settings.ts에 적힌 38곳 측정값이 원자료다.
    const measured: [number, number, number][] = [ // [정가, 곳수, 실효/정가 %]
      [1000, 3, 112], [1200, 9, 101], [1300, 8, 97], [1500, 10, 90], [1700, 2, 88], [1800, 1, 83],
    ];
    console.log(`\n[β 검산] 측정된 실효단가 비율 vs 지금 식이 그리는 곡선 (38곳, settings.ts)`);
    console.log("   정가   곳수   실측 실효/정가   식의 실효/정가   차이");
    for (const [rate, n, pctMeasured] of measured) {
      const model = (pcMok(rate, beta0) / rate) * 100;
      console.log(`  ${String(rate).padStart(5)}원 ${String(n).padStart(3)}곳  ` +
        `${pctMeasured.toFixed(0).padStart(9)}% ${model.toFixed(1).padStart(14)}% ` +
        `${(model - pctMeasured >= 0 ? "+" : "")}${(model - pctMeasured).toFixed(1).padStart(5)}%p`);
    }
    console.log(`  (R²=0.346라 같은 1,500원도 매장별 72~108%로 벌어진다 — 낱개 차이는 잡음이다)`);

    const r15 = total(1500, beta0, prod) / t1000 - 1;
    console.log(`\n  => 정가 1,000 -> 1,500원(+50.0%)일 때 총단가는 ${(r15 * 100).toFixed(1)}%만 오른다.`);
    console.log(`     눌리는 이유 둘: (1) β=${beta0}<1 — 정가가 비쌀수록 정액권 할인이 커진다(건별 원장 8곳 실측)`);
    console.log(`                     (2) 상품몫 ${Math.round(prod)}원은 상수 — 라면 값은 PC요금을 안 따라간다`);

    // ── 판정: 눌림이 과한가? 잔차가 정가와 붙어 있으면 β가 낮은 것이다 ──────────────
    // β가 너무 낮으면 **비싼 매장을 과소예측**하고 싼 매장을 과대예측한다. 그러면
    // 잔차(예측/실제 - 1)가 정가와 **음의 상관**을 갖는다. 0에 가까우면 맞게 눌린 것이다.
    const resid = (sc: ReturnType<typeof scoreTextbook>) => {
      const xs: number[] = [], ys: number[] = [];
      for (const r of sc.rows) {
        const rate = rows.find((x) => x.input.storeCode === r.storeCode)?.input.hourlyRate;
        if (rate == null || r.predicted == null || !(r.actual > 0)) continue;
        xs.push(rate); ys.push(r.predicted / r.actual - 1);
      }
      return { r: pearson(xs, ys), n: xs.length };
    };

    console.log(`\n[β 훑기] 축척은 β마다 다시 맞춘다(상품몫이 같이 움직인다)`);
    console.log("    β     MAPE    중앙   ±20%   최대   상품몫   잔차↔정가 r");
    for (const b of [0, 0.25, 0.546, 0.75, 1.0, 1.5]) {
      const sc = scoreTextbook(rows, { ...P, rateElasticity: b });
      const rr = resid(sc);
      console.log(`  ${b.toFixed(3)}  ${((sc.mape ?? 0) * 100).toFixed(2)}%  ` +
        `${((sc.medianAbsErr ?? 0) * 100).toFixed(1)}%  ${((sc.within20 ?? 0) * 100).toFixed(0)}%  ` +
        `${((sc.maxAbsErr ?? 0) * 100).toFixed(0)}%  ${String(Math.round(sc.fittedProductUnitPrice)).padStart(5)}원  ` +
        `${rr.r >= 0 ? "+" : ""}${rr.r.toFixed(3)}${b === beta0 ? "   <- 지금 값" : ""}`);
    }
    const rb = resid(base);
    // 상관은 **유의수준을 같이 봐야** 판정이 된다(n=38에서 |r|<0.32면 p>0.05다).
    const tOf = (r: number, n: number) => Math.abs(r) * Math.sqrt(n - 2) / Math.sqrt(Math.max(1e-9, 1 - r * r));
    const t = tOf(rb.r, rb.n);
    const crit = 2.028; // t(36), 양측 5%
    console.log(`\n  판정 기준: **잔차↔정가 상관이 0에 가까워야** 눌림이 맞게 들어간 것이다.`);
    console.log(`    음수면 비싼 매장을 과소예측(β를 올려야) · 양수면 과대예측(β를 내려야).`);
    console.log(`    지금 β=${beta0}에서 r=${rb.r >= 0 ? "+" : ""}${rb.r.toFixed(3)} (n=${rb.n}) · ` +
      `t=${t.toFixed(2)} vs 임계 ${crit} -> ${t > crit ? "⚠️ 유의하게 어긋났다" : "유의하지 않다(어긋났다고 못 한다)"}`);
    console.log(`    n=${rb.n}에서는 |r|이 약 0.32는 돼야 유의하다 — 위 훑기의 r 차이는 전부 그 아래다.`);
    console.log(`    즉 **이 시험으로는 β를 0~1 사이에서 못 가른다.** 확실한 건 "너무 낮다는 증거는 없다"까지다`);
    console.log(`    (β가 낮으면 비싼 매장이 과소예측돼 r이 음수로 나와야 하는데, 전부 양수다).`);
    console.log(`\n  ⚠️ MAPE가 제일 낮은 β를 그냥 고르지 말 것 — 이 모델은 축척을 독점매장에서만`);
    console.log(`     맞춰서 수준 이동이 MAPE에 그대로 찍힌다([[feedback_lab_mape_follows_level]]).`);
    console.log(`     β는 건별 원장 실측(정가 1,700원 매장이 1,397원만 받는다)에서 나온 값이고,`);
    console.log(`     자료로 재선택하는 대상이 아니다. 여기서는 **어긋났는지만** 본다.`);
    expect(rb.n).toBeGreaterThan(30);
  });

  it("유동 방향 ω를 올리면 — 측정만 한다, 켜지 않는다", () => {
    console.log("\n[유동 방향 ω] 지금은 0이다. 대조군을 못 넘어서 값만 채워둔 항목이다.");
    for (const omega of [0, 0.1, 0.25, 0.5, 1]) {
      line(`ω=${omega}`, rows, { ...P, locationExponents: { ...P.locationExponents, direction: omega } });
    }
    console.log("\n  ⚠️ 여기서 MAPE가 내려가도 채택 근거가 아니다 — 무작위 대조군 검정은");
    console.log("     _locationRebuild.test.ts에 있고, 거기서 이미 못 넘었다(중심도가 이 신호를 먹는다).");
    expect(rows.length).toBeGreaterThan(30);
  });
});
