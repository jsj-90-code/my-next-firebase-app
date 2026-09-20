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

const SGIS_FILE = ".local-tools/sgis-resident-population.json";
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
