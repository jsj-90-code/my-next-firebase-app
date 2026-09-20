// 대학가 5곳 — 왜 부경대가 +70%인가 (2026-09-20 밤, 무인작업)
//
// 2026-09-20 오후에 산업단지·기타 배수를 1.00으로 끈 뒤 오차 구성이 바뀌었다.
// 수요부족은 4곳 -> 2곳으로 줄었는데 **대학가가 과대예측으로 밀렸다:**
//
//   부경대점    +69.7%    전대상대점  +41.7%    전대후문점  +40.2%
//
// 대학가 배수 1.45는 5곳의 **중앙값**이라, 맞아도 개별 매장이 틀릴 수 있다.
//
// ── 이 파일이 재는 것 ─────────────────────────────────────────────────────
// 사용자 지적(2026-09-20): *"같은 군부대라도 규모가 다를 수 있다."*
// 물리적으로는 **덧셈**이 맞다 — 대학이 데려오는 건 "동네 수요의 45%"가 아니라
// **재학생 몇 명**이다. 지금 산식은 곱셈이라, 주거인구가 큰 동네일수록 보너스도
// 같이 커진다. 부경대는 주거인구가 표본 최대급이다. **그래서 제일 많이 받는다.**
//
// 그게 맞는지를 자료로 가른다:
//
//   각 매장이 **필요로 하는 수요**를 역산한다.   필요수요 = 지금총수요 ÷ (1+오차)
//   거기서 두 수를 뽑는다:
//     함축 배수      = 필요수요 ÷ 기본수요        <- 곱셈이 맞으면 5곳이 비슷해야 한다
//     함축 추가이용자 = 필요수요 - 기본수요        <- 덧셈이 맞으면 5곳이 비슷해야 한다
//
//   둘의 **변동계수(CV)**를 나란히 놓으면 어느 쪽이 덜 흔들리는지 보인다.
//
// ⚠️ **대조 기준선을 같이 찍는다.** 배수가 1.00인 "없음" 24곳에서도 같은 두 수를
//    뽑는다. 거기서도 덧셈 쪽 CV가 작으면 그건 대학가 이야기가 아니라 **산식 전체의
//    성질**(또는 이 분해법의 성질)이다. 2026-09-20에 대조군 기준선을 안 찍어서
//    두 번 헛짚었다.
//
// ⚠️ **측정만 한다. 계수를 고르지 않는다.** 배수를 바꾸는 것도, 덧셈으로 바꾸는 것도
//    채택이고 사용자 몫이다.
//
// ⚠️ 이 역산은 **점유율층과 단가층이 맞다**고 볼 때만 성립한다. 상한에 걸린 매장
//    (capped)은 매출이 수요에 비례하지 않으므로 따로 표시하고 계산에서 뺀다.
//
// ── ✅ 2026-09-20 밤에 재고 나온 것 (요약) ────────────────────────────────
// 1. **배수를 낮추는 것으로는 안 된다.** 1.45 -> 1.00까지 내려도 부경대는 +17.0%로
//    홀로 남고, 그 사이 청주대 −21.6% · 울산대 −18.5%가 반대편으로 넘어간다.
//    한 배수로 5곳을 같이 맞출 수 없다. (6)절.
// 2. **덧셈 형태가 대학가에서 곱셈보다 45.4% 덜 흔들린다**(로그 수요오차 SD
//    0.1842 -> 0.1005). 대조군 '없음' 22곳에서는 8.6%뿐이다. 그런데
//    **무작위 대조군에서 p=0.1899다** — 아무 4곳이나 뽑아도 중앙 16.8%가 나오고
//    19%는 45.4%를 넘는다. **n=4에서는 못 가른다.** (2)절.
// 3. **재학생 수로 더하는 형태도 이 표본에서는 안 맞는다.** 함축 추가이용자와
//    재학생 수의 상관이 r=−0.474로 **부호가 반대**다. (7)절.
// 4. 부경대는 대학가 안에서 특이한 게 아니라 **표본 전체에서 특이하다** — 기본수요
//    1/38(최대) · 필요 점유율 38/38(최소) · 경쟁 IP 3/38 · PC 32/38(적다).
//    필요(18%) < 예측(28%)이라 분류상 **'경쟁 과소'**다. (4)절.
//    👉 즉 "대학가 배수가 과하다"보다 **"수요 큰 동네에서 경쟁을 약하게 센다"**는
//       쪽에 가깝다. 이건 인계 문서가 말한 '경쟁 과소 6곳'과 같은 갈래다.
// 5. 전대상대·전대후문은 1,015m 떨어져 **같은 전남대를 각자 1.45씩** 받는다. (5)절.
//
// ⚠️ 위 다섯은 **잰 것**이고, 무엇을 채택할지는 정하지 않았다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_universityTowns.test.ts --disable-console-intercept
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
const SGIS_FILE = ".local-tools/sgis-resident-population.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

const pct = (v: number | null | undefined, d = 1) => (v == null ? "      -" : `${(v * 100).toFixed(d)}%`.padStart(7));
const num = (v: number | null | undefined, d = 0) =>
  v == null ? "-" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

// ⚠️ 한때 변동계수(CV)로 곱셈/덧셈을 견줬는데 **틀린 자였다** — 덧셈 쪽 '추가 이용자'는
//    평균이 0 근처라 CV가 발산한다(없음 무리 중앙 −72명 -> CV 6.0). (2)절의 로그오차 SD로 바꿨다.
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

describeIf("대학가 5곳 — 배수가 곱셈이어야 하나 덧셈이어야 하나", () => {
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

  /** SGIS 주거인구 — 반경별. 있으면 쓰고 없으면 스냅샷의 pop1km로 떨어진다. */
  const popByCode = new Map<string, Record<string, number | null>>();
  if (existsSync(SGIS_FILE)) {
    const sg = JSON.parse(readFileSync(SGIS_FILE, "utf8")) as {
      sites: Record<string, { code?: string; radii?: Record<string, { totalPopulation?: number | null }> }>;
    };
    for (const v of Object.values(sg.sites ?? {})) {
      if (!v.code) continue;
      const m: Record<string, number | null> = {};
      for (const [r, x] of Object.entries(v.radii ?? {})) m[r] = x?.totalPopulation ?? null;
      popByCode.set(String(v.code), m);
    }
  }

  type Probe = {
    name: string; code: string; type: string;
    err: number; req: number | null; share: number | null; capped: boolean;
    pcCount: number | null; actualUtil: number | null;
    resident: number | null; floating: number | null;
    /** 배수를 곱하기 **전**의 수요(흡인력·밀집도 보정은 이미 들어 있다). */
    baseUsers: number;
    /** 지금 산식이 쓰는 총수요 = baseUsers x 배수. */
    totalUsers: number;
    sdMul: number;
    /** 실매출이 나오려면 있었어야 할 수요 = totalUsers ÷ (1+오차). */
    neededUsers: number;
    /** 그 수요를 곱셈으로 설명하면 몇 배인가. */
    impliedMul: number;
    /** 그 수요를 덧셈으로 설명하면 몇 명인가. */
    impliedAdd: number;
    pop1km: number | null; pop2km: number | null;
    rivalIp: number; rivalCount: number;
  };

  const probes: Probe[] = [];
  for (const r of rows) {
    const x = score.rows.find((y) => y.storeCode === r.input.storeCode);
    if (!x || x.predicted == null || !(x.actual > 0)) continue;
    const b = computeTextbook(r.input, full);
    if (b.totalDemandUsers == null || !(b.totalDemandUsers > 0)) continue;
    const type = r.input.specialDemandType ?? "없음";
    const sdMul = P.specialDemandMultipliers?.[type] ?? 1;
    const totalUsers = b.totalDemandUsers;
    const baseUsers = totalUsers / (sdMul || 1);
    const err = x.predicted / x.actual - 1;
    const neededUsers = totalUsers / (1 + err);
    const pops = popByCode.get(r.input.storeCode) ?? {};
    probes.push({
      name: r.input.storeName ?? r.input.storeCode,
      code: r.input.storeCode,
      type,
      err, req: x.requiredShare ?? null, share: x.share ?? null, capped: !!x.capped,
      pcCount: r.input.pcCount ?? null, actualUtil: r.input.actualUtilization ?? null,
      resident: b.residentDemandUsers ?? null, floating: b.floatingDemandUsers ?? null,
      baseUsers, totalUsers, sdMul, neededUsers,
      impliedMul: neededUsers / baseUsers,
      impliedAdd: neededUsers - baseUsers,
      pop1km: pops["1000"] ?? (r.input.pop1km ?? null),
      pop2km: pops["2000"] ?? null,
      rivalIp: r.input.competitorIp ?? 0,
      rivalCount: (r.input.rivals ?? []).filter((v) => v.ip > 0).length,
    });
  }

  const uni = probes.filter((p) => p.type === "대학가");
  const none = probes.filter((p) => p.type === "없음");
  const army = probes.filter((p) => p.type === "군부대");

  it("(1) 대학가 5곳 — 한 줄씩", () => {
    expect(uni.length).toBeGreaterThan(0);
    console.log(`\n[대학가 ${uni.length}곳] 배수 ${P.specialDemandMultipliers?.["대학가"]} 적용 중`);
    console.log("  매장          매출오차  필요점유  예측점유   PC   실측가동   주거몫   유동몫  기본수요  총수요  주거1km  경쟁IP 경쟁수");
    for (const p of [...uni].sort((a, b) => b.err - a.err)) {
      console.log(
        `  ${p.name.padEnd(12)}${pct(p.err)}  ${pct(p.req, 0)}  ${pct(p.share, 0)}` +
        `${num(p.pcCount).padStart(5)}  ${pct(p.actualUtil, 0)}` +
        `${num(p.resident).padStart(9)}${num(p.floating).padStart(9)}${num(p.baseUsers).padStart(9)}${num(p.totalUsers).padStart(8)}` +
        `${num(p.pop1km).padStart(9)}${num(p.rivalIp).padStart(8)}${num(p.rivalCount).padStart(5)}` +
        (p.capped ? "  [상한]" : ""),
      );
    }
    console.log("\n  ⚠️ 상한(capped)에 걸린 매장은 매출이 수요에 비례하지 않는다 — 아래 역산에서 뺀다.");
  });

  it("(2) ⭐ 곱셈이냐 덧셈이냐 — 같은 눈금에서 · 대조 기준선과 같이", () => {
    // ⚠️ **변동계수(CV)로 견주면 안 된다.** 덧셈 쪽 '추가 이용자'는 평균이 0 근처라
    //    (없음 무리 중앙값 −72명) CV가 발산한다. 2026-09-20 첫 판에서 이걸 밟았다.
    //    그래서 **둘 다 같은 눈금 — 상수 하나를 맞춘 뒤 남는 로그 수요오차 — 으로 잰다.**
    //
    //      곱셈 안:  수요 = 기본수요 x m      오차 = ln(기본수요 x m ÷ 필요수요)
    //      덧셈 안:  수요 = 기본수요 + a      오차 = ln((기본수요 + a) ÷ 필요수요)
    //
    //    자유도가 둘 다 1개(m 하나, a 하나)라 공평하다. 남는 흔들림(SD)이 작은 쪽이 이긴다.
    const usable = (xs: Probe[]) => xs.filter((p) => !p.capped && p.baseUsers > 0 && p.neededUsers > 0);
    const sd = (xs: number[]) => {
      if (xs.length < 2) return NaN;
      const m = mean(xs);
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    /** 상수 하나를 맞춘 뒤 남는 로그오차의 SD. 곱셈은 닫힌 해, 덧셈은 격자탐색. */
    const fitMul = (g: Probe[]) => {
      const lg = g.map((p) => Math.log(p.neededUsers / p.baseUsers));
      return { k: Math.exp(mean(lg)), sd: sd(lg) };
    };
    const fitAdd = (g: Probe[]) => {
      const lo = -Math.min(...g.map((p) => p.baseUsers)) * 0.95;
      const hi = Math.max(...g.map((p) => p.neededUsers)) * 2;
      let best = { k: NaN, sd: Infinity };
      // 거친 격자 -> 그 둘레를 다시 촘촘히. 1차원이라 이걸로 충분하다.
      for (let pass = 0, a0 = lo, a1 = hi; pass < 4; pass++) {
        const step = (a1 - a0) / 400;
        for (let a = a0; a <= a1; a += step) {
          const e = g.map((p) => Math.log((p.baseUsers + a) / p.neededUsers));
          if (!e.every(Number.isFinite)) continue;
          const s = sd(e);
          if (s < best.sd) best = { k: a, sd: s };
        }
        a0 = best.k - step * 5; a1 = best.k + step * 5;
      }
      return best;
    };

    const groups: [string, Probe[]][] = [
      ["대학가", usable(uni)],
      ["없음(대조 기준선)", usable(none)],
      ["군부대", usable(army)],
      ["전체", usable(probes)],
    ];
    console.log("\n[곱셈 vs 덧셈] 상수 하나를 맞춘 뒤 남는 **로그 수요오차의 SD** — 작을수록 그 형태가 맞다");
    console.log("  무리                 n   곱셈 m*    SD      덧셈 a*(명)    SD     이긴 쪽   이득");
    for (const [label, g] of groups) {
      if (g.length < 3) { console.log(`  ${label.padEnd(20)}${String(g.length).padStart(3)}   (표본 3곳 미만 — 안 잰다)`); continue; }
      const m = fitMul(g), a = fitAdd(g);
      const win = a.sd < m.sd ? "덧셈" : "곱셈";
      const gain = Math.abs(a.sd - m.sd) / Math.max(m.sd, a.sd);
      console.log(
        `  ${label.padEnd(20)}${String(g.length).padStart(3)}${m.k.toFixed(3).padStart(9)}${m.sd.toFixed(4).padStart(8)}` +
        `${num(a.k).padStart(13)}${a.sd.toFixed(4).padStart(8)}${win.padStart(9)}${pct(gain, 1)}`,
      );
    }
    console.log("\n  📌 읽는 법 — **대조 기준선('없음')과 견줘야 뜻이 선다.**");
    console.log("     '없음'은 배수가 1.00이라 곱셈/덧셈 논쟁이 없는 무리다. 거기서도 같은 쪽이");
    console.log("     이기면 그건 대학가 이야기가 아니라 **이 역산법(또는 산식 전체)의 성질**이다.");
    console.log("     대학가에서만 덧셈이 뚜렷이 이겨야 사용자 가설('재학생 수를 더해라')의 근거가 된다.");
    console.log("  ⚠️ 대학가는 상한 제외 후 n=4다. 어느 쪽이 이기든 **표본이 셀 수준이 아니다.**");

    // ── 무작위 대조군 ──────────────────────────────────────────────────────
    // n=4에서 '덧셈이 45% 덜 흔들린다'가 나와도, 아무 4곳이나 뽑아도 그만큼 나오면
    // 뜻이 없다. **라벨을 섞어서** 같은 크기 무리를 2000번 뽑아 견준다.
    const pool = usable(probes);
    const uniG = usable(uni);
    if (uniG.length >= 3 && pool.length > uniG.length) {
      const gainOf = (g: Probe[]) => {
        const m = fitMul(g), a = fitAdd(g);
        if (!Number.isFinite(m.sd) || !Number.isFinite(a.sd)) return null;
        // 양수면 덧셈이 그만큼 덜 흔들린다는 뜻.
        return (m.sd - a.sd) / Math.max(m.sd, a.sd);
      };
      const obs = gainOf(uniG);
      // 되풀이 가능한 난수 — 시드 고정(2026-09-20). 돌릴 때마다 p가 바뀌면 판정이 안 된다.
      let seed = 20260920;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const N = 2000;
      let ge = 0;
      const sample: number[] = [];
      for (let i = 0; i < N; i++) {
        const pick = [...pool];
        for (let j = pick.length - 1; j > 0; j--) {
          const k = Math.floor(rnd() * (j + 1));
          [pick[j], pick[k]] = [pick[k], pick[j]];
        }
        const g = gainOf(pick.slice(0, uniG.length));
        if (g == null) continue;
        sample.push(g);
        if (obs != null && g >= obs) ge++;
      }
      const p = (ge + 1) / (sample.length + 1);
      sample.sort((a, b) => a - b);
      console.log(`\n[무작위 대조군] 같은 크기(${uniG.length}곳) 무리를 ${sample.length}번 뽑아 같은 이득을 잰다 (시드 20260920)`);
      console.log(`  관측된 대학가 이득   ${pct(obs)}`);
      console.log(`  무작위 중앙값        ${pct(med(sample))}   ·  95분위 ${pct(sample[Math.floor(sample.length * 0.95)])}`);
      console.log(`  p(무작위 >= 관측)    ${p.toFixed(4)}${p < 0.05 ? "   <- 0.05 아래" : "   <- 유의선 위. 우연으로 설명된다"}`);
      console.log("  ⚠️ 이건 **형태(덧셈)가 대학가에서 특별한가**만 본다. 덧셈이 옳다는 증명이 아니다.");
    }
  });

  it("(3) 대학가 매장별 — 곱셈과 덧셈이 각각 요구하는 값", () => {
    console.log("\n[대학가 매장별 역산]");
    console.log("  매장          기본수요   지금총수요(x1.45)   필요수요   함축배수   함축추가이용자   주거1km");
    for (const p of [...uni].sort((a, b) => b.err - a.err)) {
      console.log(
        `  ${p.name.padEnd(12)}${num(p.baseUsers).padStart(9)}${num(p.totalUsers).padStart(16)}` +
        `${num(p.neededUsers).padStart(12)}${p.impliedMul.toFixed(3).padStart(11)}${num(p.impliedAdd).padStart(16)}` +
        `${num(p.pop1km).padStart(10)}` + (p.capped ? "  [상한·제외]" : ""),
      );
    }
    const g = uni.filter((p) => !p.capped);
    const muls = g.map((p) => p.impliedMul);
    const adds = g.map((p) => p.impliedAdd);
    console.log(`\n  함축배수      최소 ${Math.min(...muls).toFixed(3)} ~ 최대 ${Math.max(...muls).toFixed(3)}  (${(Math.max(...muls) / Math.min(...muls)).toFixed(2)}배 벌어짐)`);
    console.log(`  함축추가이용자 최소 ${num(Math.min(...adds))} ~ 최대 ${num(Math.max(...adds))}  (${(Math.max(...adds) / Math.min(...adds)).toFixed(2)}배 벌어짐)`);
    console.log("\n  ⚠️ 여기 나온 값 중 어느 것도 **채택하지 않았다.** 채택은 사용자 몫이다.");
  });

  it("(4) 부경대는 무엇이 다른가 — 대학가 안에서 견주기", () => {
    const keys: [string, (p: Probe) => number | null][] = [
      ["주거인구 1km", (p) => p.pop1km],
      ["주거인구 2km", (p) => p.pop2km],
      ["주거 수요몫", (p) => p.resident],
      ["유동 수요몫", (p) => p.floating],
      ["기본수요", (p) => p.baseUsers],
      ["PC 대수", (p) => p.pcCount],
      ["실측 가동률", (p) => p.actualUtil],
      ["경쟁 IP", (p) => p.rivalIp],
      ["경쟁점 수", (p) => p.rivalCount],
      ["예측 점유율", (p) => p.share],
      ["필요 점유율", (p) => p.req],
    ];
    const bk = uni.find((p) => p.name.includes("부경대"));
    console.log("\n[부경대 vs 다른 대학가 4곳]");
    if (!bk) { console.log("  부경대점을 표본에서 못 찾았다."); return; }
    const others = uni.filter((p) => p !== bk);
    console.log("  항목             부경대     다른 4곳(중앙)   비(부경대÷중앙)   전체 38곳 중 순위");
    for (const [label, f] of keys) {
      const v = f(bk);
      const o = others.map(f).filter((x): x is number => x != null);
      const allv = probes.map(f).filter((x): x is number => x != null);
      if (v == null || !o.length) { console.log(`  ${label.padEnd(14)}  (값 없음)`); continue; }
      const m = med(o);
      const rank = allv.filter((x) => x > v).length + 1;
      console.log(
        `  ${label.padEnd(14)}${num(v, v < 10 ? 3 : 0).padStart(10)}${num(m, m < 10 ? 3 : 0).padStart(15)}` +
        `${(m !== 0 ? (v / m).toFixed(2) : "-").padStart(16)}${`${rank}/${allv.length}`.padStart(16)}`,
      );
    }
  });

  it("(5) ⚠️ 전남대 두 매장이 같은 대학을 나눠 먹는다", () => {
    const jn = uni.filter((p) => p.name.includes("전대"));
    console.log("\n[같은 대학을 보는 매장]");
    if (jn.length < 2) { console.log("  해당 없음."); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = new Map<string, any>();
    for (const s of snap.existingStores ?? []) raw.set(s.storeCode, s);
    const hav = (a: number, b: number, c: number, d: number) => {
      const R = 6371000, toRad = (v: number) => (v * Math.PI) / 180;
      const dLat = toRad(c - a), dLng = toRad(d - b);
      const s2 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s2));
    };
    const [a, b] = jn;
    const ra = raw.get(a.code), rb = raw.get(b.code);
    const dist = ra?.lat && rb?.lat ? Math.round(hav(ra.lat, ra.lng, rb.lat, rb.lng)) : null;
    console.log(`  ${a.name} ↔ ${b.name} : ${dist == null ? "좌표 없음" : `${num(dist)}m`}`);
    console.log(`  둘 다 배수 ${a.sdMul}를 **각자** 받는다. 덧셈으로 보면 같은 재학생을 두 번 세는 꼴이다.`);
    console.log(`  각자 함축 추가이용자: ${a.name} ${num(a.impliedAdd)}명 · ${b.name} ${num(b.impliedAdd)}명 (합 ${num(a.impliedAdd + b.impliedAdd)}명)`);
    console.log("  📌 곱셈이면 이 문제가 안 보인다 — 각자 자기 동네 수요의 45%라서 겹침이 드러나지 않는다.");
  });

  it("(7) 재학생 수와 맞춰 보기 — 덧셈 가설의 물리적 자", () => {
    // ── 출처 ────────────────────────────────────────────────────────────────
    // 한국어 위키백과 학교 문서의 학생 수 칸 (2026-09-20 조회).
    // ⚠️ **권위 있는 자료가 아니다.** 기준연도가 제각각이고(2023~2025) 대학알리미
    //    (academyinfo.go.kr) 공시값과 다를 수 있다. 채택 전에는 대학알리미로 갈아야 한다.
    // ⚠️ 전남대는 **캠퍼스별로 안 나뉘어 있다** — 24,422명은 광주+여수 합계다.
    //    전대상대점·전대후문점은 둘 다 광주캠퍼스라 실제 값은 이보다 작다.
    const ENROLL: Record<string, { n: number; year: string; note?: string }> = {
      "부경대점": { n: 18351, year: "2023", note: "대연·용당 합계" },
      "전대상대점": { n: 24422, year: "2025.10", note: "광주+여수 합계 · 두 매장이 나눠 먹는다" },
      "전대후문점": { n: 24422, year: "2025.10", note: "위와 같은 대학" },
      "울산대점": { n: 14037, year: "연도 불명" },
      "청주대점": { n: 11491, year: "2024" },
    };
    console.log("\n[재학생 수 vs 함축 추가이용자] 출처: 한국어 위키백과 (2026-09-20 조회)");
    console.log("  매장          재학생수   기준연도    함축추가이용자   기본수요   비고");
    const xs: number[] = [], ys: number[] = [];
    for (const p of [...uni].sort((a, b) => (ENROLL[b.name]?.n ?? 0) - (ENROLL[a.name]?.n ?? 0))) {
      const e = ENROLL[p.name];
      console.log(
        `  ${p.name.padEnd(12)}${num(e?.n).padStart(9)}   ${(e?.year ?? "-").padEnd(10)}${num(p.impliedAdd).padStart(12)}` +
        `${num(p.baseUsers).padStart(11)}   ${e?.note ?? ""}${p.capped ? " [상한]" : ""}`,
      );
      if (e && !p.capped) { xs.push(e.n); ys.push(p.impliedAdd); }
    }
    if (xs.length >= 3) {
      const mx = mean(xs), my = mean(ys);
      let n = 0, dx = 0, dy = 0;
      for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
      const r = dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0;
      console.log(`\n  상관 r = ${r.toFixed(3)}  (n=${xs.length}, 상한 제외)`);
      console.log("  📌 덧셈 가설이 맞다면 **양의 상관**이어야 한다 — 재학생이 많을수록 더 많이 더해야 하니까.");
      if (r < 0) {
        console.log("  ⛔ 부호가 **반대**다. 재학생이 제일 많은 쪽(전남대·부경대)이 오히려 덜 필요하다고 나온다.");
        console.log("     즉 '재학생 수를 수요에 더한다'는 형태도 이 표본에서는 안 맞는다.");
      }
      console.log("  ⚠️ n=4다. 이 상관으로는 아무것도 못 정한다. **방향만** 본다.");
    }
  });

  it("(6) 대학가를 끄면 전체 성적이 어떻게 되나 — 참고용", () => {
    // ⚠️ 이 숫자로 값을 고르지 말 것. "배수를 내리면 좋아진다"는 것까지만 보이려고 찍는다.
    const base = scoreTextbook(rows, P);
    const muls = [1.45, 1.3, 1.2, 1.1, 1.0];
    const lines: string[] = [];
    const perStore = new Map<string, string[]>();
    for (const mul of muls) {
      const p2 = { ...P, specialDemandMultipliers: { ...P.specialDemandMultipliers, "대학가": mul } };
      const s = scoreTextbook(rows, p2);
      const uniErrs: number[] = [];
      for (const u of uni) {
        const r = s.rows.find((y) => y.storeCode === u.code);
        const e = r?.predicted != null && r.actual > 0 ? r.predicted / r.actual - 1 : null;
        if (e != null) uniErrs.push(e);
        perStore.set(u.name, [...(perStore.get(u.name) ?? []), pct(e)]);
      }
      lines.push(
        `  ${mul.toFixed(2)}${pct(s.mape)}${pct(s.medianAbsErr)}` +
        `${pct(s.within20)}${pct(mean(uniErrs))}${pct(med(uniErrs))}`,
      );
    }
    console.log("\n[대학가 배수를 낮춰 보면 — 참고용. 표본 안 성적이다]");
    console.log(`  기준선(지금 1.45): MAPE ${pct(base.mape)} · 중앙 ${pct(base.medianAbsErr)} · ±20% ${pct(base.within20)}`);
    console.log("  배수    MAPE     중앙    ±20%   대학가평균오차  대학가중앙오차");
    lines.forEach((l) => console.log(l));
    console.log("\n  매장별 매출오차:");
    console.log(`  매장          ${muls.map((m) => m.toFixed(2).padStart(7)).join("")}`);
    for (const [nm, es] of perStore) console.log(`  ${nm.padEnd(12)}${es.join("")}`);
    console.log("\n  ⚠️ 배수를 1.00까지 내려도 **부경대만 홀로 남는다면** 원인은 배수가 아니다.");
    console.log("\n  🛑 **여기서 멈춘다.** 표본 안 성적은 눈금이고 근거가 아니다.");
    console.log("     채택하려면 LOO·무작위 대조군·세 자를 같이 봐야 하고, 그건 사용자 확인 뒤에 한다.");
    console.log("\n  📌 이 표가 말하는 것: **배수를 낮추는 것으로는 안 된다.**");
    console.log("     1.00까지 내려도 부경대는 +17.0%로 홀로 남고, 그 사이 청주대 −21.6% ·");
    console.log("     울산대 −18.5%가 반대편으로 넘어간다. 한 배수로 5곳을 같이 맞출 수 없다.");
  });
});
