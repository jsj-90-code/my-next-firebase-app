// "지방 소도시는 상권이 시 전체다" — 5km까지 넓혀서 검정 (2026-09-20 밤, 무인작업)
//
// ── 가설 ──────────────────────────────────────────────────────────────────
// 필요 점유율이 100%를 넘는 두 곳(문경시청점 191% · 양주덕정점 121%)은 **점유율로는
// 못 고친다.** 동네 수요를 다 먹어도 실매출이 안 나온다는 뜻이라, 수요를 작게 센 것이다.
//
// 사용자 가설: *"지방 소도시는 상권이 1km가 아니라 시 전체다."* 그러면 반경을 넓히면
// 이 두 곳의 수요가 남들보다 많이 늘어야 한다.
//
// ── ⚠️ 이 가설은 **반경이 아니라 순위의 문제**다 ──────────────────────────
// 반경을 넓히면 **모든 매장의 수요가 늘고** 축척 A가 다시 맞춰진다. 그러니
// "문경 수요가 2.4배 늘었다"는 아무 뜻이 없다. 뜻이 있는 건 **남들보다 더 느는가**다.
//
//   문경 필요 점유율이 좋아진다  ⇔  문경의 (5km÷1km)이 **표본 중앙값보다 크다**
//
// 2026-09-19에 2km까지 받아 봤을 때 이미 **반대 방향**이 나왔다(문경 1.63배, 41곳 중 39위).
// 5km에서 뒤집히는지 보려고 2026-09-20 밤에 5000m를 추가 수집했다(54곳 53초).
//
// ⚠️ **측정만 한다.** 반경을 바꾸는 것은 채택이고 사용자 몫이다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_wideCatchment.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const SGIS_FILE = ".local-tools/sgis-resident-population.json";
const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = existsSync(SGIS_FILE) ? describe : describe.skip;
const num = (v: number | null | undefined) =>
  v == null ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: 0 });

type Radius = { totalPopulation?: number | null; areaSize?: number | null; areaOff?: number | null };
type Site = { code?: string | number; name?: string; kind?: string; radii?: Record<string, Radius> };

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

describeIf("넓힌 상권 — 5km 주거인구", () => {
  const sg = JSON.parse(readFileSync(SGIS_FILE, "utf8")) as { sites: Record<string, Site> };
  type Row = { name: string; p1: number; p2: number | null; p5: number; r2: number | null; r5: number; off: number | null };
  const rows: Row[] = [];
  for (const s of Object.values(sg.sites ?? {})) {
    const r = s.radii ?? {};
    const p1 = r["1000"]?.totalPopulation ?? null;
    const p2 = r["2000"]?.totalPopulation ?? null;
    const p5 = r["5000"]?.totalPopulation ?? null;
    if (!p1 || !p5) continue;
    rows.push({
      name: s.name ?? String(s.code ?? "?"),
      p1, p2, p5,
      r2: p2 ? p2 / p1 : null,
      r5: p5 / p1,
      off: r["5000"]?.areaOff ?? null,
    });
  }
  const rankOf = (name: string, key: "r2" | "r5" | "p1" | "p5") => {
    const s = [...rows].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
    return s.findIndex((x) => x.name === name) + 1;
  };
  const TARGETS = ["문경시청점", "양주덕정점"];

  it("(1) 5km가 제대로 받아졌나 — 면적 검증", () => {
    expect(rows.length).toBeGreaterThan(30);
    const bad = rows.filter((x) => x.off != null && x.off > 0.05);
    console.log(`\n[5km 수집 상태] ${rows.length}곳`);
    console.log(`  원 면적(π·5000²=78.54km²) 대비 5% 넘게 어긋난 곳: ${bad.length ? bad.map((b) => `${b.name} ${(b.off! * 100).toFixed(1)}%`).join(", ") : "없음"}`);
    console.log("  ⚠️ 어긋난 곳이 있으면 그 값은 '반경 5km'가 아니다 — SGIS가 면적을 잘라 준 것이다.");
    expect(bad.length).toBe(0);
  });

  it("(2) ⭐ 두 곳이 남들보다 많이 퍼지나 — 이게 가설의 전부다", () => {
    const m5 = med(rows.map((x) => x.r5));
    const m2 = med(rows.map((x) => x.r2).filter((x): x is number => x != null));
    console.log(`\n[퍼짐 배율] 5km÷1km 중앙값 ${m5.toFixed(2)}배 · 2km÷1km 중앙값 ${m2.toFixed(2)}배 · n=${rows.length}`);
    console.log("\n  매장          1km인구   2km인구   5km인구   2km배   5km배   5km배 순위   중앙 대비");
    for (const name of TARGETS) {
      const x = rows.find((y) => y.name === name);
      if (!x) { console.log(`  ${name} — 자료 없음`); continue; }
      console.log(
        `  ${name.padEnd(12)}${num(x.p1).padStart(9)}${num(x.p2).padStart(10)}${num(x.p5).padStart(10)}` +
        `${(x.r2 ?? 0).toFixed(2).padStart(8)}${x.r5.toFixed(2).padStart(8)}` +
        `${`${rankOf(name, "r5")}/${rows.length}`.padStart(13)}${(x.r5 / m5).toFixed(2).padStart(11)}배`,
      );
    }
    console.log("\n  📌 **판정** — 중앙 대비가 1보다 커야 가설이 산다.");
    for (const name of TARGETS) {
      const x = rows.find((y) => y.name === name);
      if (!x) continue;
      const rel = x.r5 / m5;
      const shareMul = m5 / x.r5;
      console.log(
        `    ${name.padEnd(12)}중앙 대비 ${rel.toFixed(2)}배 -> 반경을 5km로 바꾸면 필요 점유율이 ` +
        `**${shareMul.toFixed(2)}배**가 된다 ${rel >= 1.1 ? "(가설 지지)" : rel > 0.9 ? "(달라지는 게 없다)" : "**(더 나빠진다)**"}`,
      );
    }
  });

  it("(3) 퍼짐 배율 순위 — 위아래 끝", () => {
    const s5 = [...rows].sort((a, b) => b.r5 - a.r5);
    console.log("\n[5km÷1km 큰 순]");
    const show = (x: Row, i: number) =>
      console.log(
        `  ${String(i + 1).padStart(2)}. ${x.name.padEnd(14)}1km ${num(x.p1).padStart(7)}  5km ${num(x.p5).padStart(9)}  ` +
        `${x.r5.toFixed(2).padStart(6)}배${TARGETS.includes(x.name) ? "   <-" : ""}`,
      );
    s5.forEach((x, i) => {
      if (i < 5 || i >= s5.length - 5 || TARGETS.includes(x.name)) show(x, i);
      else if (i === 5) console.log("   ...");
    });
    console.log("\n  📌 위쪽은 전부 **수도권·광역시**다. 반경을 넓히면 도시가 압도적으로 유리해진다 —");
    console.log("     '지방 소도시를 살리려고' 반경을 넓히면 정확히 반대 결과가 난다.");
  });

  it("(5) ⚠️ 이 검정이 기각한 것과 **안** 기각한 것", () => {
    // 정직하게 짚어 둔다. (2)~(4)절은 **"모든 매장에 같은 반경을 쓴다"**를 기각한다.
    // 사용자 가설의 글자는 *"지방 소도시는 상권이 넓다"* 즉 **동네마다 다른 반경**이고,
    // 그건 다른 이야기다. 다만 그걸 모형으로 만들려면 **규칙**이 있어야 한다
    // (매장마다 손으로 고르는 건 모형이 아니라 41개의 자유계수다).
    //
    // 제일 그럴듯한 규칙이 **'고정 인구 상권'**이다 — "반경은 다르되 담는 사람 수는 같다."
    // 그러면 반경이 자동으로 밀도에 반응한다. 그 규칙이 문경에 먹히는지만 본다.
    const target = med(rows.map((x) => x.p1)); // 기준: 1km 주거인구의 중앙값
    console.log(`\n[고정 인구 상권 규칙] "반경은 다르되 담는 사람은 같게" · 기준 ${num(target)}명(1km 인구 중앙값)`);
    const reach: { name: string; need: string; p5: number }[] = [];
    for (const name of [...TARGETS, ...rows.slice(0, 0).map((x) => x.name)]) {
      const site = Object.values(sg.sites).find((s) => s.name === name);
      if (!site) continue;
      const radii = [100, 200, 300, 400, 500, 1000, 1500, 2000, 5000];
      let need = "5km로도 못 채운다";
      for (const r of radii) {
        const v = site.radii?.[String(r)]?.totalPopulation;
        if (v != null && v >= target) { need = `${r}m`; break; }
      }
      const p5 = site.radii?.["5000"]?.totalPopulation ?? 0;
      reach.push({ name, need, p5 });
    }
    for (const x of reach) {
      console.log(`  ${x.name.padEnd(12)}${num(target)}명을 담으려면 → **${x.need}**   (5km에 ${num(x.p5)}명)`);
    }
    const cannot = rows.filter((x) => x.p5 < target);
    console.log(`\n  5km로도 기준 인구를 못 채우는 매장: ${cannot.length}곳` +
      (cannot.length ? ` — ${cannot.map((c) => `${c.name}(${num(c.p5)})`).join(", ")}` : ""));
    console.log("\n  📌 **문경은 어떤 반경 규칙으로도 안 된다.** 5km에 44,935명이고 더 넓히면");
    console.log("     문경시를 벗어난다. 담을 사람이 없는데 반경만 넓히는 건 뜻이 없다.");
    console.log("\n  👉 그래서 '반경'이라는 갈래는 **규칙을 어떻게 만들든** 문경을 못 고친다.");
    console.log("     남는 건 반경이 아니라 **이용률**(같은 인구에서 더 많이 온다)이거나");
    console.log("     수요식 바깥이다.");
    console.log("\n  ⚠️ 그런데 '지방은 이용률이 높다'도 표본이 지지하지 않는다 —");
    console.log("     `_worstErrors`에서 log(주거1km) ↔ log(필요÷예측) r=−0.193으로 유의선 아래다.");
    console.log("     **인구 적은 동네를 체계적으로 작게 세고 있지 않다.** 문경은 규칙이 아니라");
    console.log("     **한 곳의 특이값**이다. 그 한 곳을 설명하려고 변수를 만들면 관문 1에 걸린다.");
  });

  it("(6) ⭐⭐ 자연 대조군 — 문경과 같은 처지인 두 곳은 멀쩡하다", () => {
    // (5)절에서 **5km로도 기준 인구를 못 채우는 매장이 셋**이라는 게 나왔다:
    //   영월점 · 문경시청점 · 증평점
    // 셋 다 "담을 사람이 없는 작은 동네"다. 사용자 가설이 **동네의 성질**에 관한 것이라면
    // **셋 다 똑같이 틀려야 한다.** 한 곳만 틀리면 그건 동네 성질이 아니라 그 매장 사정이다.
    //
    // 👉 이게 손으로 고른 대조군이 아니라 **자료가 골라 준 대조군**이라 값이 있다.
    if (!hasValidationSnapshot()) { console.log("\n  스냅샷이 없어 건너뛴다."); return; }
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
    const labRows = buildLabRows({
      stores, compsByCode: byCode, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores),
      settings, qscByStoreCode: qscBy,
    });
    const sc = scoreTextbook(labRows, DEFAULT_TEXTBOOK_PARAMS);

    const target = med(rows.map((x) => x.p1));
    const small = rows.filter((x) => x.p5 < target).map((x) => x.name);
    console.log(`\n[자연 대조군] 5km로도 기준 인구(${num(target)}명)를 못 채우는 ${small.length}곳`);
    console.log("  매장          5km인구   매출오차   필요점유율   예측점유율   1km인구");
    for (const name of small) {
      const r = sc.rows.find((y) => y.storeName === name);
      const w = rows.find((y) => y.name === name)!;
      if (!r || r.predicted == null || !(r.actual > 0)) {
        console.log(`  ${name.padEnd(12)}${num(w.p5).padStart(9)}   (검증 표본에 없다)`);
        continue;
      }
      const err = r.predicted / r.actual - 1;
      console.log(
        `  ${name.padEnd(12)}${num(w.p5).padStart(9)}${`${(err * 100).toFixed(1)}%`.padStart(11)}` +
        `${r.requiredShare != null ? `${(r.requiredShare * 100).toFixed(0)}%`.padStart(12) : "-".padStart(12)}` +
        `${r.share != null ? `${(r.share * 100).toFixed(0)}%`.padStart(13) : "-".padStart(13)}${num(w.p1).padStart(10)}`,
      );
    }
    console.log("\n  📌 **판정** — 영월점은 검증 표본 밖이라(학습 제외) 견줄 수 있는 건 증평점이다.");
    console.log("     그런데 **증평은 5km 인구가 40,292명으로 문경(44,935명)보다 오히려 적다.**");
    console.log("     그런데도 오차 +15.9% · 필요 점유율 65%로 멀쩡하다.");
    console.log("\n     즉 *'작은 동네라서 수요를 작게 센다'*는 **동네 성질이 아니다.**");
    console.log("     더 작은 동네가 더 잘 맞는다. 인구 크기로는 설명이 안 선다.");
    console.log("\n  ⛔ 문경은 **규칙이 아니라 한 곳의 특이값**이다. 그 한 곳을 설명하려고");
    console.log("     변수를 만들면 사전 등록 관문 1(두 곳 빼고도 되는가)에 걸린다.");
    console.log("     👉 다음에 볼 곳은 수요식이 아니라 **문경 그 매장의 자료**다 —");
    console.log("        실측 가동률·실매출·PC수·요금이 맞게 들어와 있는지.");
  });

  it("(4) 문경은 이미 시 전체를 담고 있다 — 가설이 깨지는 까닭", () => {
    const x = rows.find((y) => y.name === "문경시청점");
    if (!x) { console.log("\n  문경시청점 자료 없음"); return; }
    const site = Object.values(sg.sites).find((s) => s.name === "문경시청점");
    console.log("\n[문경시청점 반경별 주거인구]");
    for (const r of [100, 500, 1000, 1500, 2000, 5000]) {
      const v = site?.radii?.[String(r)]?.totalPopulation;
      if (v != null) console.log(`  ${String(r).padStart(5)}m   ${num(v).padStart(7)}명`);
    }
    console.log("\n  📌 5km까지 넓혀도 44,935명이다. **더 넓힐 사람이 없다** — 문경시 인구가 그만큼이다.");
    console.log("     즉 *'상권이 시 전체'*를 그대로 받아들여도 수요는 2.39배까지밖에 못 는다.");
    console.log("     그동안 도시 매장은 16~22배가 는다. **상대적으로는 더 굶는다.**");
    console.log("\n  ⛔ 이 갈래는 여기서 닫힌다. 문경의 필요 점유율 191%는 **반경으로 못 고친다.**");
    console.log("     남은 설명은 수요식 바깥이다 — 단가층(실효요금)·가동률 실측·매출 자료 자체 등.");
  });
});
