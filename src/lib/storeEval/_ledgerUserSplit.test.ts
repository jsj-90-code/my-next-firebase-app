// 가동률 오차가 **이용자 수** 탓인가 **1인당 시간** 탓인가 — 원장으로 가른다 (2026-09-22)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 산식의 가동률은 정확히 두 조각의 곱이다:
//
//     가동률 = (우리 매장 이용자 수 × 1인당 월 이용시간) ÷ (PC수 × 720)
//               ─────────┬────────    ──────┬─────────
//          총수요 이용자 × 점유율            산식은 8.20h 고정
//
// **원장에 둘 다 있다.** 고유 회원 수가 이용자 수고, 총시간÷고유회원이 1인당 시간이다.
// 그러니 가동률 오차를 두 조각으로 **완전히 쪼갤 수 있다.** 지금까지는 뭉쳐 있었다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 원장이 없으면 **skip**한다. 조용히 통과시키지 않는다.
// 2. 관문: 원장 총시간 ÷ (PC×720)이 그 달 가동률 필드와 15% 안에서 맞아야 한다.
//    `_ledgerPerUser`가 이미 쓰는 관문이고, 여기서도 통과한 매장만 판정에 쓴다.
// 3. 비교 대상은 **그 달 실측 가동률**이다(평가창 평균이 아니다). 원장이 그 달 것이라서다.
//    ⚠️ 산식 예측은 시점이 없다(인구·경쟁은 현재값). 그래서 이건 "같은 달끼리"가 아니라
//       "산식의 정상상태 vs 그 달 실측"이다. 그 한계를 안고 읽는다.
// 4. 비회원은 인원에서 빠진다(번호를 돌려쓴다). 시간 비중이 2~9%라 **이용자 수가 그만큼
//    과소**하다. 보정하지 않고 **비중을 같이 찍어** 읽는 사람이 감안하게 한다.
//    ⚠️ 보정하면 그게 곧 계수를 하나 고르는 것이다. 안 한다.
// 5. **오픈 1년 안과 1년 초과를 나눠 본다.** 1인당 시간이 개점 경과와 함께 늘기 때문이다
//    (1년 안 8.20h vs 1년 초과 11.58h — `_ledgerPerUser`). 섞으면 시간 오차를 잘못 읽는다.
//
// ⚠️ 측정만 한다. 계수를 고르지 않는다.
//
// 실행: npx vitest run src/lib/storeEval/_ledgerUserSplit.test.ts --disable-console-intercept
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { findLedgerDir, isGuest, sameStore, readLedgerFile, ledgerMonths } from "./_ledgerRead";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
} from "./textbookModel";
import type { Competitor, ExistingStore, ExistingStoreMonthlySales } from "./types";

const DIR = findLedgerDir();
const QSC_FILE = ".local-tools/qsc-scores.json";
/** 파일명에 매장명이 들어 있어야 매칭된다. `_ledgerPerUser`와 **같은 표**를 쓴다. */
const MONTHS_OF: Record<string, string[]> = {
  광주첨단점: ["2026-08"],
  발산역점: ["2026-06", "2026-07", "2026-08"],
  문산점: ["2026-07"],
};
const DEFAULT_MONTHS = ["2025-07"];
/** 관문 — 원장이 가동률 필드와 이만큼 넘게 어긋나면 그 매장은 판정에서 뺀다. */
const GATE = 0.15;

const describeIf = DIR && hasValidationSnapshot() ? describe : describe.skip;
const sum = (a: number[]) => a.reduce((p, q) => p + q, 0);
const mean = (a: number[]) => sum(a) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const geo = (a: number[]) => Math.exp(mean(a.map(Math.log)));

describeIf("원장 — 가동률 오차를 이용자 수와 1인당 시간으로 가른다", () => {
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
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));
  const rowByName = new Map(base.map((r) => [r.input.storeName ?? "", r]));
  const allStores: ExistingStore[] = snap.existingStores;
  const sales: ExistingStoreMonthlySales[] = snap.sales ?? [];

  type Row = {
    name: string; pc: number; age: number | null;
    users: number; guestPct: number; perUser: number;
    fieldUtil: number; ledgerUtil: number; gate: number;
    predUsers: number; predUtil: number; rivalIp: number;
  };

  const load = async (): Promise<Row[]> => {
    const all = readdirSync(DIR!).filter((f) => /\.(csv|xlsx)$/.test(f) && !f.includes("상품"));
    const files = all.filter((f) => f.endsWith(".csv")
      || !all.some((g) => g.endsWith(".csv") && sameStore(g, f, allStores)));
    const out: Row[] = [];
    for (const file of files.sort()) {
      const name = allStores.map((s) => s.storeName).find((n) => file.includes(n));
      if (!name) continue;
      const store = allStores.find((s) => s.storeName === name)!;
      const lab = rowByName.get(name);
      const pc = store.pcCount ?? null;
      if (!lab || !pc) continue;

      const { recs, days } = await readLedgerFile(`${DIR}/${file}`);
      const perMonth = ledgerMonths(recs, days);
      if (!perMonth.length || perMonth.some((m) => !(m.uniq > 0))) continue;

      const totalH = sum(recs.map((r) => r.min)) / 60;
      const daysCovered = sum(perMonth.map((m) => m.nDays));
      const monthlyH = totalH / daysCovered * 30;
      const ledgerUtil = monthlyH / (pc * 720);

      const yms = MONTHS_OF[name] ?? DEFAULT_MONTHS;
      const fields = yms.map((ym) => sales.find((s) => s.storeCode === store.storeCode && s.yearMonth === ym)?.utilizationRate ?? null)
        .filter((v): v is number => v != null);
      if (!fields.length) continue;
      const fieldUtil = mean(fields);

      // 인원은 **달마다 따로 센 뒤 평균**한다. 누적하면 고유회원이 부풀려진다.
      // ⚠️ 부분월은 인원이 그만큼 적게 잡힌다(30일 환산을 인원에 하면 안 된다) — nDays로 표시만.
      const users = mean(perMonth.map((m) => m.uniq * (30 / m.nDays)));
      const perUser = mean(perMonth.map((m) => m.per));
      const guestPct = sum(recs.filter((r) => isGuest(r.id)).map((r) => r.min)) / 60 / totalH;

      const b = computeTextbook(lab.input, P);
      if (b.totalDemandUsers == null || b.share == null || b.utilization == null) continue;
      const rivalIp = (lab.input.rivals ?? []).reduce((a, r) => a + r.ip * rivalDistanceWeight(r.distanceM, P), 0);
      const age = (() => {
        if (!store.openedAt) return null;
        const o = new Date(store.openedAt);
        const [y, m] = yms[0].split("-").map(Number);
        return (y - o.getFullYear()) * 12 + (m - (o.getMonth() + 1));
      })();

      out.push({
        name, pc, age, users, guestPct, perUser,
        fieldUtil, ledgerUtil, gate: ledgerUtil / fieldUtil - 1,
        predUsers: b.totalDemandUsers * b.share, predUtil: b.utilization, rivalIp,
      });
    }
    return out;
  };

  it("(1) 관문 — 원장이 가동률 필드와 맞는가", async () => {
    const rows = await load();
    console.log(`\n[관문] 원장 ${rows.length}곳 · 원장 총시간÷(PC×720) vs 그 달 가동률 필드`);
    console.log(`  매장              PC   원장%   필드%   어긋남`);
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(16)}${String(r.pc).padStart(4)}`
        + `${(r.ledgerUtil * 100).toFixed(2).padStart(8)}${(r.fieldUtil * 100).toFixed(2).padStart(8)}`
        + `${(r.gate * 100).toFixed(1).padStart(8)}%`);
    }
    const bad = rows.filter((r) => Math.abs(r.gate) > GATE);
    console.log(`  통과 ${rows.length - bad.length}/${rows.length}${bad.length ? " · 실패 " + bad.map((r) => r.name).join(", ") : ""}`);
    expect(bad.length).toBe(0);
  });

  it("(2) ⭐ 가동률 오차를 두 조각으로 쪼갠다", async () => {
    const rows = (await load()).filter((r) => Math.abs(r.gate) <= GATE);
    console.log(`\n[분해] 가동률 어긋남 = **이용자 수 어긋남 × 1인당 시간 어긋남**  (전부 예측÷실측)`);
    console.log(`  산식의 1인당 시간은 ${P.hoursPerUserPerMonth}h 고정이다.`);
    console.log(`\n  매장            개월차  이용자(예측/실측)   1인당시간(산식/실측)   가동률(예측/실측)  비회원%`);
    const show = (r: Row) => {
      const du = r.predUsers / r.users;
      const dh = P.hoursPerUserPerMonth / r.perUser;
      const dz = r.predUtil / r.fieldUtil;
      console.log(`  ${r.name.padEnd(16)}${String(r.age ?? "-").padStart(4)}`
        + `${(r.predUsers).toFixed(0).padStart(8)}/${r.users.toFixed(0).padEnd(6)}${du.toFixed(3).padStart(6)}배`
        + `${P.hoursPerUserPerMonth.toFixed(2).padStart(8)}/${r.perUser.toFixed(2).padEnd(6)}${dh.toFixed(3).padStart(6)}배`
        + `${dz.toFixed(3).padStart(8)}배${(r.guestPct * 100).toFixed(1).padStart(7)}%`);
      return { du, dh, dz };
    };
    const young = rows.filter((r) => r.age != null && r.age <= 12);
    const old = rows.filter((r) => !(r.age != null && r.age <= 12));
    console.log(`  ── 오픈 1년 안 ${young.length}곳 ──`);
    const y = young.map(show);
    console.log(`  ── 1년 초과 ${old.length}곳 ──`);
    const o = old.map(show);
    const line = (label: string, a: { du: number; dh: number; dz: number }[]) => {
      if (!a.length) return;
      console.log(`  ${label.padEnd(16)}이용자 ${geo(a.map((x) => x.du)).toFixed(3)}배(퍼짐 ${sdOf(a.map((x) => Math.log(x.du))).toFixed(3)})`
        + ` · 시간 ${geo(a.map((x) => x.dh)).toFixed(3)}배(퍼짐 ${sdOf(a.map((x) => Math.log(x.dh))).toFixed(3)})`
        + ` · 가동률 ${geo(a.map((x) => x.dz)).toFixed(3)}배`);
    };
    console.log("");
    line("1년 안 기하평균", y);
    line("1년 초과 기하평균", o);
    line("전체 기하평균", [...y, ...o]);
    console.log(`\n  ⭐ 읽는 법 — **퍼짐이 큰 쪽이 범인이다.** 평균이 1에서 벗어난 건 축척으로 흡수되지만`);
    console.log(`     퍼짐은 흡수되지 않는다(매장마다 다르게 틀린다는 뜻이라서다).`);
    console.log(`  ⚠️ 비회원은 인원에서 빠졌다 — 이용자 수 실측이 위 비회원% 만큼 과소하다.`);
    console.log(`     보정하지 않았다(보정하면 그게 계수를 하나 고르는 것이다).`);
    expect(rows.length).toBeGreaterThan(3);
  });

  it("(3) 이용자 수 어긋남이 경쟁 강도와 붙어 있나 — 수요층인가 점유율층인가", async () => {
    const rows = (await load()).filter((r) => Math.abs(r.gate) <= GATE);
    const du = rows.map((r) => Math.log(r.predUsers / r.users));
    const ip = rows.map((r) => Math.log(1 + r.rivalIp));
    const m1 = mean(du), m2 = mean(ip);
    const r0 = mean(du.map((v, i) => (v - m1) * (ip[i] - m2))) / (sdOf(du) * sdOf(ip));
    console.log(`\n[층 가르기] 이용자 수 어긋남(log) vs 유효경쟁IP(log) · n=${rows.length}`);
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(16)}경쟁IP ${r.rivalIp.toFixed(0).padStart(5)}`
        + ` · 이용자 어긋남 ${(r.predUsers / r.users).toFixed(3)}배`);
    }
    console.log(`  상관 r = ${r0.toFixed(3)}`);
    console.log(`\n  ⚠️ n=${rows.length}은 **너무 작다.** 유의선을 말할 표본이 아니다 — 방향만 본다.`);
    console.log(`     경쟁 센 곳에서 더 과대예측이면(양의 상관) **점유율층**이 범인이고,`);
    console.log(`     경쟁과 무관하게 흩어지면 **수요층**이 범인이다.`);
    console.log(`  ⚠️ 그리고 여기 8곳엔 **경쟁점 없는 매장이 하나도 없다** — 수요층만 따로 볼 자리가 없다.`);
    console.log(`     독점 3곳(탕정역·광주각화·남악) 원장을 받으면 그 자리가 생긴다.`);
    expect(rows.length).toBeGreaterThan(3);
  });
});
