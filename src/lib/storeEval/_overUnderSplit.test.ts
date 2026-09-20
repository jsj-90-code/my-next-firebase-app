// 경쟁 과대 vs 경쟁 과소 — 무엇이 두 무리를 가르나 (2026-09-20 밤, 무인작업)
//
// 인계 문서가 **"이게 핵심 질문이다"**라고 찍어 둔 자리다.
// 2026-09-20 오후에 배수를 고친 뒤 20% 넘는 16곳의 구성이 이렇게 바뀌었다:
//
//   수요부족 2곳 · 경쟁 과대 8곳 · 경쟁 과소 6곳
//
//   **경쟁 과대** = 필요 > 예측 점유율 = 경쟁을 너무 세게 봤다 -> **과소예측**
//   **경쟁 과소** = 필요 < 예측 점유율 = 경쟁을 너무 약하게 봤다 -> **과대예측**
//
// `_worstErrors.test.ts` (6)절이 변수 22개를 훑지만 그건 **38곳 전체**의 연속 상관이다.
// 여기서는 **두 무리를 직접 갈라** 견준다. 무리 안이 한쪽으로 몰려 있으면 상관으로는
// 안 잡히는데 무리 비교로는 잡히는 경우가 있다.
//
// ── 판정 기준 (자료를 보기 전에 적는다) ───────────────────────────────────
//  1. 순위합(Mann-Whitney U의 정규근사)으로 잰다. n이 작고 분포를 모르니 순위로 간다.
//  2. **22개를 훑으면 우연히 1~2개는 유의선을 넘는다.** 나온 건 후보일 뿐이다.
//  3. 그래서 **무작위 대조군을 같이 돌린다** — 라벨을 섞어 2000번 뽑고,
//     "유의선을 넘은 변수 개수"가 우연 분포의 어디쯤인지 본다.
//     ⚠️ 개별 변수의 p가 아니라 **훑기 전체가 우연인가**를 묻는 것이다.
//  4. 무엇을 찾아도 **채택하지 않는다.** 재고 표로 남긴다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_overUnderSplit.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const num = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * 순위합 검정(Mann-Whitney U)의 정규근사 z. 동점은 평균순위로 처리한다.
 * 양수면 a 무리가 큰 쪽이다. |z| >= 1.96이 흔히 쓰는 0.05 선이다.
 */
function rankSumZ(a: number[], b: number[]): number | null {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return null;
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  // 평균순위 매기기 — 동점 구간은 같은 값을 준다.
  const ranks = new Array<number>(all.length);
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let ra = 0;
  all.forEach((x, i) => { if (x.g === 0) ra += ranks[i]; });
  const u = ra - (na * (na + 1)) / 2;
  const mu = (na * nb) / 2;
  // 동점 보정을 넣은 분산.
  const counts = new Map<number, number>();
  for (const x of all) counts.set(x.v, (counts.get(x.v) ?? 0) + 1);
  let tie = 0;
  for (const c of counts.values()) tie += c ** 3 - c;
  const n = na + nb;
  const sd = Math.sqrt((na * nb / 12) * ((n + 1) - tie / (n * (n - 1))));
  return sd > 0 ? (u - mu) / sd : null;
}

describeIf("경쟁 과대 vs 경쟁 과소 — 무엇이 가르나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { openedAt?: string; records?: QscRecord[] };
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

  const rows: LabRow[] = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const score = scoreTextbook(rows, P);
  const full = fittedParams(P, score);

  type Case = {
    name: string; kind: string; err: number; req: number; share: number;
    vars: Record<string, number | null>;
  };
  const cases: Case[] = [];
  for (const r of rows) {
    const x = score.rows.find((y) => y.storeCode === r.input.storeCode);
    if (!x || x.predicted == null || !(x.actual > 0) || x.requiredShare == null || x.share == null) continue;
    const b = computeTextbook(r.input, full);
    const err = x.predicted / x.actual - 1;
    const kind = x.requiredShare > 1 ? "수요부족" : x.share < x.requiredShare ? "경쟁 과대" : "경쟁 과소";
    const q = r.input.ownQualityParts ?? null;
    const rivals = (r.input.rivals ?? []).filter((v) => v.ip > 0);
    const eff = rivals.filter((v) => v.distanceM == null || v.distanceM <= P.effectiveRadiusM);
    const dists = rivals.map((v) => v.distanceM).filter((v): v is number => v != null);
    cases.push({
      name: r.input.storeName ?? r.input.storeCode,
      kind, err, req: x.requiredShare, share: x.share,
      vars: {
        "기본수요(배수전)": b.totalDemandUsers != null
          ? b.totalDemandUsers / (P.specialDemandMultipliers?.[r.input.specialDemandType ?? "없음"] ?? 1)
          : null,
        "주거 수요몫": b.residentDemandUsers ?? null,
        "유동 수요몫": b.floatingDemandUsers ?? null,
        "주거 1km": r.input.pop1km ?? null,
        "주거 500m÷1km": r.input.pop500m && r.input.pop1km ? r.input.pop500m / r.input.pop1km : null,
        "자사 PC수": r.input.pcCount ?? null,
        "유효경쟁 IP": eff.reduce((s, v) => s + v.ip, 0),
        "유효경쟁 점포수": eff.length,
        "전체경쟁 점포수": rivals.length,
        "자사PC ÷ 경쟁IP": eff.length ? (r.input.pcCount ?? 0) / Math.max(1, eff.reduce((s, v) => s + v.ip, 0)) : null,
        "최근접 경쟁점 거리": dists.length ? Math.min(...dists) : null,
        "경쟁점 평균 거리": dists.length ? dists.reduce((s, v) => s + v, 0) / dists.length : null,
        "실측 가동률": r.input.actualUtilization ?? null,
        "예측 점유율": x.share,
        "필요 점유율": x.requiredShare,
        "자사 사양": q?.spec ?? null,
        "자사 먹거리": q?.food ?? null,
        "자사 존구성": q?.zone ?? null,
        "자사 인테리어": q?.interior ?? null,
        "자사 관리(QSC)": q?.management ?? null,
        "입지 배율": b.locationMultiplier ?? null,
        "개점 후 개월": r.input.monthsOpen ?? null,
      },
    });
  }

  const big = cases.filter((c) => Math.abs(c.err) >= 0.2);
  const over = big.filter((c) => c.kind === "경쟁 과소");   // 과대예측
  const under = big.filter((c) => c.kind === "경쟁 과대");  // 과소예측
  const VARS = Object.keys(cases[0]?.vars ?? {});

  it("(1) 20% 넘는 매장 — 무리별로", () => {
    expect(cases.length).toBeGreaterThan(10);
    console.log(`\n[20% 넘는 ${big.length}곳] 전체 ${cases.length}곳 중`);
    for (const k of ["경쟁 과소", "경쟁 과대", "수요부족"]) {
      const g = big.filter((c) => c.kind === k);
      console.log(`\n  ${k} ${g.length}곳 ${k === "경쟁 과소" ? "(과대예측)" : k === "경쟁 과대" ? "(과소예측)" : ""}`);
      for (const c of [...g].sort((a, b) => b.err - a.err)) {
        console.log(
          `    ${c.name.padEnd(14)}${(c.err * 100).toFixed(1).padStart(7)}%   필요 ${(c.req * 100).toFixed(0).padStart(3)}%  예측 ${(c.share * 100).toFixed(0).padStart(3)}%` +
          `   기본수요 ${num(c.vars["기본수요(배수전)"]).padStart(7)}  경쟁IP ${num(c.vars["유효경쟁 IP"]).padStart(5)}`,
        );
      }
    }
  });

  it("(2) ⭐ 두 무리를 가르는 변수가 있나 — 순위합", () => {
    console.log(`\n[과소예측(경쟁 과대) ${under.length}곳  vs  과대예측(경쟁 과소) ${over.length}곳]`);
    console.log("  변수                 과소중앙    과대중앙     z      판정");
    const zs: { k: string; z: number }[] = [];
    for (const k of VARS) {
      const a = under.map((c) => c.vars[k]).filter((v): v is number => v != null);
      const b = over.map((c) => c.vars[k]).filter((v): v is number => v != null);
      const z = rankSumZ(a, b);
      if (z == null) { console.log(`  ${k.padEnd(20)}(표본 부족)`); continue; }
      zs.push({ k, z });
      const ma = med(a), mb = med(b);
      const d = ma < 10 ? 3 : 0;
      console.log(
        `  ${k.padEnd(20)}${num(ma, d).padStart(9)}${num(mb, d).padStart(11)}${z.toFixed(2).padStart(8)}` +
        `   ${Math.abs(z) >= 1.96 ? "**유의**" : ""}`,
      );
    }
    zs.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
    const hits = zs.filter((x) => Math.abs(x.z) >= 1.96);
    console.log(`\n  유의선(|z|>=1.96)을 넘은 변수: ${hits.length}개 / ${zs.length}개` +
      (hits.length ? ` — ${hits.map((h) => h.k).join(", ")}` : ""));
    console.log(`  제일 센 것: ${zs[0]?.k} z=${zs[0]?.z.toFixed(2)}`);

    // ── 무작위 대조군 ────────────────────────────────────────────────────
    // 개별 변수의 p가 아니라 **훑기 전체**가 우연인지 묻는다. 라벨을 섞어
    // 같은 크기 두 무리를 만들고, 유의선을 넘는 변수 개수의 분포를 본다.
    let seed = 20260920;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pool = [...under, ...over];
    const N = 2000;
    const counts: number[] = [];
    let ge = 0;
    for (let i = 0; i < N; i++) {
      const sh = [...pool];
      for (let j = sh.length - 1; j > 0; j--) {
        const k = Math.floor(rnd() * (j + 1));
        [sh[j], sh[k]] = [sh[k], sh[j]];
      }
      const a = sh.slice(0, under.length), b = sh.slice(under.length);
      let c = 0;
      for (const k of VARS) {
        const av = a.map((x) => x.vars[k]).filter((v): v is number => v != null);
        const bv = b.map((x) => x.vars[k]).filter((v): v is number => v != null);
        const z = rankSumZ(av, bv);
        if (z != null && Math.abs(z) >= 1.96) c++;
      }
      counts.push(c);
      if (c >= hits.length) ge++;
    }
    counts.sort((x, y) => x - y);
    const p = (ge + 1) / (counts.length + 1);
    console.log(`\n[무작위 대조군] 라벨을 섞어 ${N}번 (시드 20260920)`);
    console.log(`  우연히 유의선을 넘는 변수 개수:  중앙 ${med(counts)}개 · 95분위 ${counts[Math.floor(counts.length * 0.95)]}개 · 최대 ${counts[counts.length - 1]}개`);
    console.log(`  관측 ${hits.length}개 · p(우연 >= 관측) = ${p.toFixed(4)}` +
      (p < 0.05 ? "   <- 0.05 아래" : "   <- 유의선 위. **훑기 전체가 우연으로 설명된다**"));

    // ── ⚠️ 순환 경고 ──────────────────────────────────────────────────────
    // 무리를 가르는 기준이 "예측 점유율 < 필요 점유율"인데, **예측 점유율은 경쟁 IP로
    // 만든 값이다.** 그러니 경쟁 IP가 큰 매장이 '경쟁 과대'로 분류되는 건 자료가 아니라
    // **정의가 시키는 일**이다. 경쟁 규모 계열 변수는 증거로 쓸 수 없다.
    const CIRCULAR = new Set(["유효경쟁 IP", "유효경쟁 점포수", "전체경쟁 점포수", "자사PC ÷ 경쟁IP", "예측 점유율", "필요 점유율"]);
    const clean = hits.filter((h) => !CIRCULAR.has(h.k));
    console.log("\n  ⚠️ **순환 걸러내기** — 무리를 가른 기준(예측 점유율)이 경쟁 IP로 만들어진다.");
    console.log(`     경쟁 규모 계열은 증거가 아니다: ${hits.filter((h) => CIRCULAR.has(h.k)).map((h) => h.k).join(", ") || "(없음)"}`);
    console.log(`     남는 것: ${clean.map((h) => `${h.k}(z=${h.z.toFixed(2)})`).join(", ") || "(없음)"}`);
    if (clean.some((h) => h.k === "자사 사양")) {
      console.log("\n     📌 자사 사양은 **순환의 반대 방향**이라 그냥 인공물로 보기 어렵다.");
      console.log("        사양은 자사 품질에 들어가 예측 점유율을 **올린다.** 순환이라면 사양이 높은 매장이");
      console.log("        '경쟁 과소(과대예측)' 쪽에 쏠려야 하는데, 관측은 **반대로 '경쟁 과대(과소예측)'**");
      console.log("        쪽이 높다. 즉 *사양 좋은 매장을 산식이 덜 쳐 준다*는 쪽을 가리킨다.");
      console.log("     🛑 그래도 **후보일 뿐이다** — 19개를 훑었고 전체 p=" + p.toFixed(3) + "이다.");
      console.log("        채택하려면 대조군·홀드아웃을 따로 돌려야 하고, 그건 사용자 확인 뒤다.");
    }
  });

  it("(4) ⭐ 자사 사양 후보 — 견고한가 (판정)", () => {
    // (2)절에서 순환을 걸러내고 남은 유일한 후보다. 채택 전에 **값싼 검사부터** 한다.
    // 여기서 깨지면 대조군·홀드아웃을 돌릴 것도 없다.
    //
    //   가) 전체 38곳에서도 보이나   — 양끝 14곳에서만 보이면 꼬리 잡음일 공산이 크다
    //   나) 한 곳을 빼도 버티나       — z가 한두 매장에 업혀 있으면 끝이다
    //   다) 3분위로 갈라도 단조로운가 — 방향이 일관돼야 기전이 있다고 말할 수 있다
    const tgt = (c: Case) => Math.log(c.req / c.share); // log(필요÷예측) — 수요가 약분되는 과녁
    const spec = (c: Case) => c.vars["자사 사양"];

    // 가) 전체 표본 순위상관
    const all = cases.filter((c) => spec(c) != null && Number.isFinite(tgt(c)));
    const rank = (v: number[]) => {
      const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
      const out = new Array(v.length).fill(0);
      idx.forEach(([, i], k) => { out[i] = k; });
      return out;
    };
    const pear = (a: number[], b: number[]) => {
      const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
      let n = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
      return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
    };
    const rs = pear(rank(all.map((c) => spec(c)!)), rank(all.map(tgt)));
    const line = 2 / Math.sqrt(all.length);
    console.log(`\n[가) 전체 표본에서도 보이나]  n=${all.length}`);
    console.log(`  자사 사양 ↔ log(필요÷예측)   순위상관 r = ${rs.toFixed(3)}   (유의선 ±${line.toFixed(2)})` +
      `  ${Math.abs(rs) >= line ? "**유의**" : "<- 유의선 아래"}`);
    console.log("  📌 양끝 14곳에서만 z=2.45가 나오고 전체 38곳에서는 안 보이면,");
    console.log("     **양끝을 고른 행위 자체가 만든 것**일 수 있다(꼬리에서만 사는 효과).");

    // 나) 한 곳씩 빼 보기
    const zOf = (a: Case[], b: Case[]) => {
      const av = a.map(spec).filter((v): v is number => v != null);
      const bv = b.map(spec).filter((v): v is number => v != null);
      return rankSumZ(av, bv);
    };
    const base = zOf(under, over);
    const pool = [...under, ...over];
    const loo: { name: string; z: number }[] = [];
    for (const drop of pool) {
      const z = zOf(under.filter((c) => c !== drop), over.filter((c) => c !== drop));
      if (z != null) loo.push({ name: drop.name, z });
    }
    loo.sort((a, b) => a.z - b.z);
    console.log(`\n[나) 한 곳을 빼면]  기준 z = ${base?.toFixed(2)}`);
    console.log(`  최저 ${loo[0].z.toFixed(2)} (${loo[0].name} 뺐을 때) ~ 최고 ${loo[loo.length - 1].z.toFixed(2)} (${loo[loo.length - 1].name})`);
    const stillSig = loo.filter((x) => Math.abs(x.z) >= 1.96).length;
    console.log(`  14번 중 유의선을 지킨 횟수: ${stillSig}/${loo.length}` +
      (stillSig === loo.length ? "   <- 전부 버틴다" : "   <- 한두 매장에 업혀 있다"));

    // 다) 3분위
    console.log("\n[다) 사양 3분위별 log(필요÷예측)]  0보다 크면 과소예측");
    const sorted = [...all].sort((a, b) => spec(a)! - spec(b)!);
    const t = Math.ceil(sorted.length / 3);
    const labels = ["낮은 1/3", "가운데", "높은 1/3"];
    const bandMeds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const g = sorted.slice(i * t, (i + 1) * t);
      if (!g.length) continue;
      const m = med(g.map(tgt));
      bandMeds.push(m);
      console.log(
        `  ${labels[i].padEnd(9)}${String(g.length).padStart(3)}곳   사양 ${num(med(g.map((c) => spec(c)!)), 2).padStart(5)}` +
        `   log(필요÷예측) 중앙 ${m >= 0 ? "+" : ""}${m.toFixed(3)}   (배로 ${Math.exp(m).toFixed(2)})`,
      );
    }
    const mono = bandMeds.length === 3 &&
      ((bandMeds[0] <= bandMeds[1] && bandMeds[1] <= bandMeds[2]) || (bandMeds[0] >= bandMeds[1] && bandMeds[1] >= bandMeds[2]));
    console.log(`  단조로운가: ${mono ? "예" : "**아니다** — 방향이 가운데서 뒤집힌다"}`);

    // 판정
    console.log("\n[판정]");
    const passA = Math.abs(rs) >= line;
    const passB = stillSig === loo.length;
    console.log(`  가) 전체 표본에서도 보인다   ${passA ? "통과" : "⛔ 미달"}`);
    console.log(`  나) 한 곳을 빼도 버틴다      ${passB ? "통과" : "⛔ 미달"}`);
    console.log(`  다) 3분위가 단조롭다         ${mono ? "통과" : "⛔ 미달"}`);
    if (!passA || !passB || !mono) {
      console.log("\n  ⛔ **값싼 검사에서 깨진다. 대조군·홀드아웃까지 갈 것 없다.**");
      console.log("     (2)절의 z=2.45는 **20% 넘는 양끝 14곳만 골라서** 나온 값이고,");
      console.log("     그 고르기 자체가 효과를 만든 것으로 보인다. 후보에서 내린다.");
    } else {
      console.log("\n  ✅ 값싼 검사를 다 통과했다 -> 다음은 무작위 대조군 + 홀드아웃이다(사용자 확인 뒤).");
    }
    console.log("  ⚠️ 어느 쪽이든 **채택하지 않았다.**");
  });

  it("(3) 자사 품질 5항목 — 변별이 되나", () => {
    console.log("\n[자사 품질 항목의 변별력] 전 매장에서 값이 갈리는가");
    console.log("  항목              n   최소     중앙     최대   서로 다른 값  판정");
    for (const k of ["자사 사양", "자사 먹거리", "자사 존구성", "자사 인테리어", "자사 관리(QSC)"]) {
      const v = cases.map((c) => c.vars[k]).filter((x): x is number => x != null);
      if (!v.length) { console.log(`  ${k.padEnd(16)}(값 없음)`); continue; }
      const uniq = new Set(v.map((x) => x.toFixed(4))).size;
      console.log(
        `  ${k.padEnd(16)}${String(v.length).padStart(3)}${num(Math.min(...v), 2).padStart(8)}${num(med(v), 2).padStart(9)}` +
        `${num(Math.max(...v), 2).padStart(9)}${String(uniq).padStart(11)}   ${uniq <= 1 ? "⛔ 전부 같다 — 변별 0" : uniq <= 3 ? "⚠️ 값이 3개뿐" : "쓸 수 있다"}`,
      );
    }
    console.log("\n  📌 값이 하나뿐인 항목은 **점유율 비에서 약분된다** — 자사/경쟁 비만 작용하므로");
    console.log("     전 매장이 같은 값이면 매장 간 차이를 못 만든다. 넣어도 성적이 안 변한다.");
    console.log("     (자사가 경쟁점보다 높은지 낮은지는 여전히 작용한다. '매장 간' 변별이 0이라는 뜻이다.)");
  });
});
