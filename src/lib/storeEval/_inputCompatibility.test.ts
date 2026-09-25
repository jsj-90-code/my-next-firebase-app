// 입력 단계 호환성 점검 — 두 산식(V62 · 실험실)이 후보지에서 쓰는 입력이 실제로 채워져 있나 (2026-09-25 밤, 사용자 "실험실 입력이 V62엔 입력항목이 없을 수도 있으니 체크"). 읽기전용.
// 후보지 13곳과 그 경쟁점을 항목 묶음별로 센다. 비어 있으면 그 산식은 기본값·가정으로 계산한다 — 조용히 틀리는 자리.
// 실행: npx vitest run src/lib/storeEval/_inputCompatibility.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("입력 호환성", () => {
  it("후보지 13곳 — 항목 묶음별 채움", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const has = (o: any, k: string) => o != null && o[k] != null && o[k] !== "";
    const radii = [100, 200, 300, 400, 500];
    const ages = ["10s", "20s", "30s", "40s", "50s", "60plus"];
    // [묶음, 쓰는 산식, 검사]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groups: { label: string; who: string; test: (c: any, loc: any, comps: any[], code: string) => boolean | string }[] = [
      { label: "PC수·정가", who: "둘 다", test: (c) => has(c, "expectedPcCount") && has(c, "hourlyRate") },
      { label: "주거 1km·500m 인구", who: "둘 다", test: (c) => has(c, "pop1km") && has(c, "pop500m") },
      { label: "주거 1km 연령(age1km_*)", who: "실험실", test: (c) => ["0_9", "10_19", "20_29", "30_39", "40_49", "50_59", "60_69", "70_79", "80plus"].every((a) => has(c, `age1km_${a}`)) },
      { label: "남성 비율 1km", who: "실험실", test: (c) => has(c, "male1kmRatio") },
      { label: "유동 반경별 평균(100~500m)", who: "실험실(V62는 상권수요 경유)", test: (c) => radii.every((r) => has(c, `floating${r}Avg`)) },
      { label: "유동 반경별 연령·남성", who: "실험실", test: (c) => radii.every((r) => ages.every((a) => has(c, `floating${r}_${a}`)) && has(c, `floating${r}Male`)) },
      { label: "유동 1km 평균", who: "실험실", test: (c) => has(c, "floating1000Avg") },
      { label: "유동 편심도", who: "실험실(점검표)", test: (c) => has(c, "flowEccentricity") },
      { label: "층·지상/지하·엘리베이터", who: "둘 다", test: (c) => has(c, "floor") && has(c, "groundLevel") && c.hasElevator != null },
      { label: "500m 영업 PC방 수", who: "실험실", test: (c) => has(c, "operatingPcStores500m") },
      { label: "입지평가(가시성·선점)", who: "V62", test: (_c, loc) => has(loc, "visibilityScore") && has(loc, "preemptionScore") },
      { label: "외부유입제한", who: "V62", test: (_c, loc) => has(loc, "inflowRestriction") },
      { label: "특수수요 유형·강도", who: "둘 다(강도는 실험실 배수·V62 더미)", test: (_c, loc) => has(loc, "specialDemandType") && has(loc, "specialDemandIntensity") },
      { label: "경쟁점 좌표", who: "실험실(거리 감쇠)", test: (_c, _l, comps) => comps.filter((x) => x.investigationStatus !== "경쟁점없음").every((x) => x.lat != null && x.lng != null) || `${comps.filter((x) => x.lat == null || x.lng == null).length}/${comps.length} 없음` },
      { label: "경쟁점 PC수", who: "둘 다 — 빈칸은 같은 90대 규칙", test: (_c, _l, comps) => comps.filter((x) => x.investigationStatus !== "경쟁점없음").every((x) => (x.totalPcCount ?? x.appliedPcCount) != null) || "일부 없음" },
      { label: "경쟁점 사양·존·먹거리·인테리어", who: "둘 다(V62 경쟁력점수·실험실 품질)", test: (_c, _l, comps) => { const cs = comps.filter((x) => x.investigationStatus !== "경쟁점없음"); const ok = cs.filter((x) => x.investigationStatus === "조사완료").length; return ok === cs.length || `조사완료 ${ok}/${cs.length}`; } },
      { label: "경쟁점 시간당환산요금", who: "두 산식 모두 안 씀(참고)", test: (_c, _l, comps) => comps.filter((x) => x.investigationStatus !== "경쟁점없음").every((x) => x.hourlyRateConverted != null) || "일부 없음" },
      { label: "[실험실 전용] 1km 밖 고리 인구", who: "실험실(λ0이라 지금은 안 씀)", test: (_c, _l, _x, code) => ((snap.labResidentRings ?? []) as { code?: string }[]).some((d) => String(d.code) === code) },
      { label: "[실험실 전용] 주거 반경 2km 사실", who: "실험실", test: (_c, _l, _x, code) => ((snap.labResidentRadius ?? []) as { code?: string; residentRadiusM?: number }[]).some((d) => String(d.code) === code && (d.residentRadiusM === 2000 || d.residentRadiusM === 1500)) ? "2km" : "기본 1km" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cands = snap.candidates as any[];
    console.log(`\n[후보지 ${cands.length}곳 × 입력 묶음] ✓ 채움 · ✗ 비어 있음(그 산식은 기본값·가정으로 계산)`);
    const tally: string[] = [];
    for (const g of groups) {
      const cells = cands.map((c) => {
        const loc = (snap.locationEvaluations as { candidateCode: string }[]).find((l) => l.candidateCode === c.code) ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const comps = (snap.competitors as any[]).filter((x) => x.candidateCode === c.code);
        const r = g.test(c, loc, comps, c.code);
        return { name: c.name as string, ok: r === true || (typeof r === "string" && (r === "2km" || r === "기본 1km")), note: typeof r === "string" ? r : "" };
      });
      const miss = cells.filter((x) => !x.ok);
      tally.push(`  ${pad(g.label, 32)} ${pad(g.who, 30)} ${String(cells.length - miss.length).padStart(2)}/${cells.length}  ${miss.map((x) => `${x.name}${x.note ? `(${x.note})` : ""}`).join(" · ")}${cells.some((x) => x.note === "2km") ? `  2km: ${cells.filter((x) => x.note === "2km").map((x) => x.name).join("·")}` : ""}`);
    }
    for (const l of tally) console.log(l);
    expect(cands.length).toBeGreaterThan(0);
  });
});
