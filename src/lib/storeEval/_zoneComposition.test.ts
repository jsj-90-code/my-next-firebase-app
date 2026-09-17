// 존구성 검정 — **지금 점유율에서 제일 세게 일하는 항목인데 검정을 안 거쳤다** (2026-09-17 밤).
//
// ── 왜 이걸 재나 ───────────────────────────────────────────────────────────
// 경쟁력점수 다섯 항목을 하나씩 빼보면 존구성이 압도적이다(비중 0으로 돌릴 때 MAPE +4.72%p ·
// 사양 +1.86%p · 관리 +0.39%p · 인테리어 +0.15%p · 먹거리 −0.09%p). 그런데 값의 생김새가
// 수상하다 — 경쟁점 153건 중 116건(75.8%)이 최저점 1.00이고, 자사 최소(2.35)보다 낮은
// 경쟁점이 136/153건(89%)이다. 사양은 같은 기준으로 73/122건(60%)이라 훨씬 자연스럽다.
//
// 즉 존구성은 **"우리는 거의 항상 이긴다"**에 가깝다. 그러면 저 4.72%p가
//   (가) 매장마다 다른 **순서**를 맞히고 있는 것인지,
//   (나) 자사 전체를 한 번 띄워주는 **수준 보정**인지 (상수배율 λ가 하는 일)
// 를 갈라야 한다. (나)라면 존구성은 지금 "자사 보정상수"라는 이름이 더 맞고, 매장별 변별을
// 존구성이 하고 있다고 읽으면 안 된다. 같은 함정을 품질 지수 θ에서 한 번 겪었다 —
// θ가 줄인 건 수준이고 남긴 건 순서였다(textbookModel.ts qualityExponent 주석).
//
// ── 어떻게 가르나 ──────────────────────────────────────────────────────────
// (1) 바닥 1.00의 내역 — 규칙으로 1.0을 준 미조사 경쟁점인지, 조사해보니 존이 없는 곳인지
// (2) 상수로 바꿔치기 — 수준은 그대로 두고 **순서만** 지운다
//       자사 상수: 자사 zone을 자사 중앙값으로 고정(경쟁점은 실제값)
//       경쟁점 상수: 경쟁점 zone을 경쟁점 중앙값으로 고정(자사는 실제값)
//       둘 다 상수: 수준만 남는다 — 여기서 성적이 안 나빠지면 (나)가 답이다
// (3) 무작위 대조군 500회 — zone 값을 매장끼리 섞는다. 순서가 진짜면 실제가 섞은 것보다 낫다
//
// ⚠️ **측정만 한다.** 여기 숫자로 비중을 바꾸지 않는다(backlog.md 산식 실험 판정 기준).
//
// 실행:
//   npx vitest run src/lib/storeEval/_zoneComposition.test.ts --disable-console-intercept

import { describe, it, expect } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook, type TextbookParams } from "./textbookModel";
import { UNSURVEYED_COMPETITOR_ZONE_SCORE } from "./calc";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

describeIf("존구성 — 수준인가 순서인가", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);

  // 관리 점수는 실험실 화면과 같게 QSC로 채운다 — 안 그러면 다른 산식을 검정하는 셈이 된다.
  const qscByStoreCode = new Map<string, number>();
  for (const d of (snap.labQscScores ?? []) as { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] }[]) {
    const code = d.storeCode ?? d.id;
    if (!code) continue;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS };

  const ownZones = rows.map((r) => r.input.ownQualityParts?.zone).filter((v): v is number => v != null);
  const rivalZones = rows.flatMap((r) => r.input.rivals ?? []).map((v) => v.parts?.zone).filter((v): v is number => v != null);

  /** 자사·경쟁점 zone을 갈아끼운 행을 만든다. 원본은 안 건드린다. */
  function withZone(
    own: (v: number | null, i: number) => number | null,
    rival: (v: number | null, i: number) => number | null,
  ): LabRow[] {
    let ri = -1;
    return rows.map((r, i) => ({
      actualRevenue: r.actualRevenue,
      input: {
        ...r.input,
        ownQualityParts: r.input.ownQualityParts
          ? { ...r.input.ownQualityParts, zone: own(r.input.ownQualityParts.zone, i) }
          : r.input.ownQualityParts,
        rivals: (r.input.rivals ?? []).map((v) => {
          ri += 1;
          return v.parts ? { ...v, parts: { ...v.parts, zone: rival(v.parts.zone, ri) } } : v;
        }),
      },
    }));
  }

  const f = (v: number | null | undefined, d = 2) => (v == null ? "-" : (v * 100).toFixed(d));

  /** MAPE와 r을 같이 낸다 — MAPE는 수준에 끌려다니고 r은 순서만 본다. 판정은 r이 한다. */
  function line(label: string, rs: LabRow[], p: TextbookParams = P) {
    const sc = scoreTextbook(rs, p);
    const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
    const r = pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual));
    console.log(`  ${label.padEnd(30)} MAPE ${f(sc.mape).padStart(6)}%  중앙 ${f(sc.medianAbsErr, 1).padStart(5)}%  r ${r.toFixed(3)}`);
    return { mape: sc.mape ?? 0, r };
  }

  it("(1) 바닥 1.00의 내역 — 규칙인가 실측인가", () => {
    const zoneKeys = ["singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone", "friendsZone", "firstClassZone"] as const;
    let unsurveyed = 0;
    const statusOfFloor = new Map<string, number>();
    for (const r of rows) {
      for (const c of compsByCode.get(r.input.storeCode) ?? []) {
        if (c.investigationStatus === "경쟁점없음") continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const none = zoneKeys.every((k) => (c as any)[k] == null);
        if (!none) continue;
        unsurveyed += 1;
        const key = c.investigationStatus ?? "(없음)";
        statusOfFloor.set(key, (statusOfFloor.get(key) ?? 0) + 1);
      }
    }
    const atFloor = rivalZones.filter((z) => z <= UNSURVEYED_COMPETITOR_ZONE_SCORE).length;
    console.log("");
    console.log(`[바닥 1.00] 경쟁점 ${rivalZones.length}건 중 ${atFloor}건이 바닥 · 그 위 ${rivalZones.length - atFloor}건`);
    console.log(`  존구성을 아예 안 적은 경쟁점(규칙으로 1.0)   ${unsurveyed}건`);
    console.log(`  조사했는데 존이 없어서 1.0인 곳             ${atFloor - unsurveyed}건`);
    for (const [k, v] of statusOfFloor) console.log(`    미조사 내역 · ${k} ${v}건`);
    console.log(`  자사 ${ownZones.length}곳 중앙 ${median(ownZones).toFixed(2)} · 경쟁점 중앙 ${median(rivalZones).toFixed(2)}`);
    expect(rivalZones.length).toBeGreaterThan(100);
  });

  it("(2) 상수로 바꿔치기 — 수준만 남기면 성적이 어디까지 버티나", () => {
    const ownMid = median(ownZones), rivalMid = median(rivalZones);
    console.log("");
    console.log(`[상수 바꿔치기] 자사 중앙 ${ownMid.toFixed(2)} · 경쟁점 중앙 ${rivalMid.toFixed(2)}`);
    const base = line("지금 그대로", rows);
    line("자사만 상수 (순서 지움)", withZone(() => ownMid, (v) => v));
    line("경쟁점만 상수", withZone((v) => v, () => rivalMid));
    const flat = line("둘 다 상수 (수준만)", withZone(() => ownMid, () => rivalMid));
    line("존구성 비중 0 (항목 제거)", rows, { ...P, qualityWeights: { ...P.qualityWeights, zone: 0 } });
    console.log("");
    console.log(`  읽는 법: '둘 다 상수'가 '지금 그대로'와 비슷하면 존구성이 하는 일은 **수준**이다.`);
    console.log(`  r이 ${base.r.toFixed(3)} -> ${flat.r.toFixed(3)}로 거의 안 떨어지면 순서는 존구성이 만든 게 아니다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(3) 무작위 대조군 500회 — zone을 매장끼리 섞는다", () => {
    let seed = 20260917 >>> 0;
    const rng = () => { seed += 0x6d2b79f5; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const shuffled = <T,>(a: T[]) => { const s = [...a]; for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

    // 기준선은 **수준만 남긴 것**이다. "존구성 없음"이 아니라 "값은 있는데 순서가 없음"과
    // 비교해야 순서의 값어치만 떨어져 나온다.
    const ownMid = median(ownZones), rivalMid = median(rivalZones);
    const flatSc = scoreTextbook(withZone(() => ownMid, () => rivalMid), P);
    const flatOk = flatSc.rows.filter((x) => x.predicted != null && x.actual > 0);
    const baseline = { mape: flatSc.mape ?? 0, r: pearson(flatOk.map((x) => x.predicted as number), flatOk.map((x) => x.actual)) };

    console.log("");
    const real = line("실제 zone", rows);
    const gainMape: number[] = [], gainR: number[] = [];
    for (let t = 0; t < 500; t++) {
      const op = shuffled(ownZones), rp = shuffled(rivalZones);
      const rs = withZone((_, i) => op[i] ?? ownMid, (_, i) => rp[i] ?? rivalMid);
      const sc = scoreTextbook(rs, P);
      const ok = sc.rows.filter((x) => x.predicted != null && x.actual > 0);
      gainMape.push(baseline.mape - (sc.mape ?? 0));
      gainR.push(pearson(ok.map((x) => x.predicted as number), ok.map((x) => x.actual)) - baseline.r);
    }
    console.log(`[대조군 500회] 기준선 = 둘 다 상수(수준만) · MAPE ${f(baseline.mape)}% · r ${baseline.r.toFixed(3)}`);
    const report = (name: string, realGain: number, gains: number[], fmt: (v: number) => string) => {
      const s = [...gains].sort((a, b) => a - b);
      const p = (s.filter((v) => v >= realGain).length + 1) / (s.length + 1);
      console.log(`  [${name}] 실제 ${fmt(realGain)} · 섞으면 중앙 ${fmt(median(s))} · 95퍼센타일 ${fmt(s[Math.floor(s.length * 0.95)])} · p=${p.toFixed(3)} ${p < 0.05 ? "✅" : "❌"}`);
    };
    report("MAPE", baseline.mape - real.mape, gainMape, (v) => `${(v * 100).toFixed(2)}%p`);
    report("r", real.r - baseline.r, gainR, (v) => v.toFixed(3));
    console.log("");
    console.log(`  ⚠️ 여기서 못 넘으면 존구성의 4.72%p는 **매장별 변별이 아니라 수준**이다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  // 순서가 안 나오는 이유가 **산식이 뭉개서**일 수도 있다. 지금 존구성은 두 번 계단을 탄다:
  //   다양성 = 1 + (1+존종류수) x 0.5   — 종류 수가 정수라 값이 띄엄띄엄
  //   수용력 = 특화좌석비율을 5칸으로 자름 (0.1 / 0.2 / 0.3 / 0.5 경계)
  // 그래서 자사 38곳의 존구성이 **서로 다른 값 9개**뿐이다. 원자료인 특화좌석비율은 연속인데
  // 계단이 그걸 버린다. 계단을 펴면 순서가 살아나는지 본다.
  it("(4) 계단을 펴면 — 뭉개서 순서가 안 나온 건가", () => {
    const zoneKeys = ["singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone", "friendsZone", "firstClassZone"] as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contScore = (o: any, pc: number | null, teamSeats: number | null): number | null => {
      if (zoneKeys.every((k) => o[k] == null)) return null;
      const distinct = zoneKeys.filter((k) => (o[k] ?? 0) > 0).length;
      const diversity = Math.min(5, 1 + (1 + distinct) * 0.5);
      if (pc == null || pc <= 0) return null;
      const seats = (o.singleSeatCount ?? 0) + (o.room1 ?? 0) + (o.room2 ?? 0) * 2
        + (teamSeats ?? (o.teamRoom ?? 0) * 5) + (o.coupleZone ?? 0) * 2
        + (o.vipZone ?? 0) + (o.friendsZone ?? 0) + (o.firstClassZone ?? 0);
      // 계단(1/2/3/4/5) 대신 비율을 그대로 편다. 0.5에서 만점 — 계단의 마지막 경계와 같다.
      const capacity = 1 + 4 * Math.min(1, seats / pc / 0.5);
      return diversity * 0.7 + capacity * 0.3;
    };

    const ownCont = new Map<string, number | null>();
    for (const s of stores) {
      ownCont.set(s.storeCode, contScore(
        { singleSeatCount: s.ownSingleSeatCount, room1: s.ownRoom1, room2: s.ownRoom2, teamRoom: s.ownTeamRoom,
          coupleZone: s.ownCoupleZone, vipZone: s.ownVipZone, friendsZone: s.ownFriendsZone, firstClassZone: s.ownFirstClassZone },
        s.evaluationPcCount ?? s.pcCount ?? null, s.ownTeamRoomTotalSeats ?? null,
      ));
    }
    // 경쟁점은 buildLabRows와 **같은 차례**로 훑어야 자리가 맞는다(상태 거르기 -> ip>0 거르기).
    const rivalCont: (number | null)[] = [];
    for (const r of rows) {
      for (const c of (compsByCode.get(r.input.storeCode) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음")) {
        const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
        if (!(ip > 0)) continue;
        rivalCont.push(contScore(c, ip, c.teamRoomTotalSeats ?? null) ?? UNSURVEYED_COMPETITOR_ZONE_SCORE);
      }
    }
    const spread = [...ownCont.values()].filter((v): v is number => v != null);
    console.log("");
    console.log(`[계단 펴기] 자사 서로 다른 값 ${new Set(spread.map((v) => v.toFixed(3))).size}개 (지금 9개) · 경쟁점 ${rivalCont.length}건`);
    const base = line("지금 (계단)", rows);
    const cont = line("계단 펴기", withZone((v, i) => ownCont.get(rows[i].input.storeCode) ?? v, (v, i) => rivalCont[i] ?? v));
    console.log(`  MAPE ${((cont.mape - base.mape) * 100).toFixed(2)}%p · r ${(cont.r - base.r >= 0 ? "+" : "")}${(cont.r - base.r).toFixed(3)}`);
    expect(rows.length).toBeGreaterThan(30);
  });

  // ── (5) 이름표 비대칭 ──────────────────────────────────────────────────
  // 사용자 지적(2026-09-17 밤): *"VIP존은 ... 사실상 파티션 처져있는 1인석이란말이지"* ·
  // *"프렌즈존도 ... 개방형 팀룸이라는 허울좋은 마케팅적인 표현이지"* ·
  // *"커플존의 차별성은 2인용 의자가 있다는거거든 ... 그렇다면 우리만 이득보는거잖아"*
  //
  // 자료가 그대로 지지한다 — **VIP존·프렌즈존·퍼스트클래스존은 경쟁점 228건 전부 0이다.**
  // 조사표에 칸은 있는데 아무도 안 적는다. 우리 브랜드 용어라서 조사자가 경쟁점의 같은
  // 실체(파티션 1인석·유리파티션 다인석)를 보고도 그 칸에 안 넣는다. 그래서 이 세 칸은
  // 좌석 종류가 아니라 사실상 **"블랙라벨인가" 표시등**이다.
  //
  // 여기서는 이름표를 걷어내고 **인원 구간**으로만 센다(양쪽 같은 잣대):
  //   1인 계열 = 1인석 + VIP존 + 퍼스트클래스존
  //   2인 계열 = 커플존 + 일반2인석
  //   다인 계열 = 프렌즈존
  //   룸 = 1인룸 · 2인룸 (완전차폐라 별개로 둔다)
  //   팀룸 = 팀룸
  // 차폐도(개방/파티션/룸)는 **경쟁점에 조사된 적이 없어** 여기서 못 넣는다. 그게 다음 과제다.
  it("(5) 이름표를 걷어내면 — 우리만 종류가 많은 게 아니었나", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byPartySize = (o: any, own: boolean): number => {
      const one = (o.singleSeatCount ?? 0) + (o.vipZone ?? 0) + (o.firstClassZone ?? 0);
      const two = (o.coupleZone ?? 0) + (own ? 0 : (o.regularCoupleSeatCount ?? 0));
      const many = (o.friendsZone ?? 0);
      return [one, two, many, o.room1 ?? 0, o.room2 ?? 0, o.teamRoom ?? 0].filter((v) => v > 0).length;
    };
    const zoneKeys = ["singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone", "friendsZone", "firstClassZone"] as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const relabeled = (o: any, own: boolean, pc: number | null, teamSeats: number | null): number | null => {
      if (zoneKeys.every((k) => o[k] == null)) return own ? null : UNSURVEYED_COMPETITOR_ZONE_SCORE;
      const diversity = Math.min(5, 1 + (1 + byPartySize(o, own)) * 0.5);
      if (pc == null || pc <= 0) return null;
      const seats = (o.singleSeatCount ?? 0) + (o.room1 ?? 0) + (o.room2 ?? 0) * 2
        + (teamSeats ?? (o.teamRoom ?? 0) * 5) + (o.coupleZone ?? 0) * 2 + (own ? 0 : (o.regularCoupleSeatCount ?? 0))
        + (o.vipZone ?? 0) + (o.friendsZone ?? 0) + (o.firstClassZone ?? 0);
      const ratio = seats / pc;
      const capacity = ratio < 0.1 ? 1 : ratio < 0.2 ? 2 : ratio < 0.3 ? 3 : ratio < 0.5 ? 4 : 5;
      return diversity * 0.7 + capacity * 0.3;
    };

    const ownNew = new Map<string, number | null>();
    const ownTypes: number[] = [];
    for (const s of stores) {
      const o = { singleSeatCount: s.ownSingleSeatCount, room1: s.ownRoom1, room2: s.ownRoom2, teamRoom: s.ownTeamRoom,
        coupleZone: s.ownCoupleZone, vipZone: s.ownVipZone, friendsZone: s.ownFriendsZone, firstClassZone: s.ownFirstClassZone };
      ownNew.set(s.storeCode, relabeled(o, true, s.evaluationPcCount ?? s.pcCount ?? null, s.ownTeamRoomTotalSeats ?? null));
      if (!zoneKeys.every((k) => o[k] == null)) ownTypes.push(byPartySize(o, true));
    }
    const rivalNew: (number | null)[] = [];
    for (const r of rows) {
      for (const c of (compsByCode.get(r.input.storeCode) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음")) {
        const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
        if (!(ip > 0)) continue;
        rivalNew.push(relabeled(c, false, ip, c.teamRoomTotalSeats ?? null));
      }
    }
    const oldTypes = stores
      .filter((s) => !zoneKeys.every((k) => (s as unknown as Record<string, unknown>)[`own${k[0].toUpperCase()}${k.slice(1)}`] == null))
      .map((s) => [s.ownSingleSeatCount, s.ownRoom1, s.ownRoom2, s.ownTeamRoom, s.ownCoupleZone, s.ownVipZone, s.ownFriendsZone, s.ownFirstClassZone]
        .filter((v) => (v ?? 0) > 0).length);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    console.log("");
    console.log(`[이름표 걷어내기] 자사 존 종류 평균 ${avg(oldTypes).toFixed(2)}개 -> ${avg(ownTypes).toFixed(2)}개`);
    const newOwn = [...ownNew.values()].filter((v): v is number => v != null);
    console.log(`  자사 존구성 점수 중앙 ${median(ownZones).toFixed(2)} -> ${median(newOwn).toFixed(2)}`);
    const base = line("지금 (이름표 그대로)", rows);
    const fixed = line("이름표 걷어냄", withZone((v, i) => ownNew.get(rows[i].input.storeCode) ?? v, (v, i) => rivalNew[i] ?? v));
    console.log(`  MAPE ${((fixed.mape - base.mape) * 100 >= 0 ? "+" : "")}${((fixed.mape - base.mape) * 100).toFixed(2)}%p · r ${(fixed.r - base.r >= 0 ? "+" : "")}${(fixed.r - base.r).toFixed(3)}`);
    console.log(`  ⚠️ 차폐도(개방/파티션/룸)는 경쟁점에 조사된 적이 없어 여기 안 들어갔다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  // ── (6) 퍼스트클래스존 — 10~12석 룸을 1석으로 세고 있다 ────────────────
  // 사용자 설명(2026-09-17 밤): *"퍼스트클래스존이 룸인데 많은고객이 이용할수있는 거야,
  // 안에한 10좌석인가 12좌석인가 매장마다 틀린데 ... 내부를 고급지게해놔서 비싼요금받을려고
  // 만든건데 뭐이제안들어감. 망했으니까 안들어가겠지 수요없으니"*
  //
  // 자사 19곳이 값 **1**을 갖고 있다(전부 1이다 — 룸 하나라는 뜻). 그런데 `convertedZoneSeats`는
  // `firstClassZone x 1`로 센다. **10~12석 룸이 1석으로 환산된다.**
  //
  // 그리고 격자에 얹으면 퍼스트클래스존은 (5인 이상 · 완전차폐)로 **팀룸과 같은 칸**이다.
  // 고급 인테리어와 비싼 요금은 인테리어 항목과 단가가 이미 보는 것이라, 존구성에서 별도
  // 종류로 세면 이중계산이다. 지금은 별도 종류라 19곳이 다양성 +1을 받고 있다 —
  // **수요가 없어 접은 존이 평가에서 가점을 받는 중이다.**
  //
  // 두 교정이 반대 방향이라 따로 재고 합쳐서도 잰다.
  it("(6) 퍼스트클래스존 — 종류는 팀룸과 한 칸, 좌석은 11석", () => {
    const zoneKeys = ["singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone", "friendsZone", "firstClassZone"] as const;
    const FC_SEATS = 11; // 사용자: 10~12석, 매장마다 다름. 중간값을 쓴다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const score = (o: any, own: boolean, pc: number | null, teamSeats: number | null, mergeType: boolean, fixSeats: boolean): number | null => {
      if (zoneKeys.every((k) => o[k] == null)) return own ? null : UNSURVEYED_COMPETITOR_ZONE_SCORE;
      if (pc == null || pc <= 0) return null;
      const types = mergeType
        ? [o.singleSeatCount ?? 0, o.room1 ?? 0, o.room2 ?? 0, o.coupleZone ?? 0, o.vipZone ?? 0, o.friendsZone ?? 0,
           (o.teamRoom ?? 0) + (o.firstClassZone ?? 0)].filter((v) => v > 0).length
        : zoneKeys.filter((k) => (o[k] ?? 0) > 0).length;
      const diversity = Math.min(5, 1 + (1 + types) * 0.5);
      const seats = (o.singleSeatCount ?? 0) + (o.room1 ?? 0) + (o.room2 ?? 0) * 2
        + (teamSeats ?? (o.teamRoom ?? 0) * 5) + (o.coupleZone ?? 0) * 2 + (own ? 0 : (o.regularCoupleSeatCount ?? 0))
        + (o.vipZone ?? 0) + (o.friendsZone ?? 0) + (o.firstClassZone ?? 0) * (fixSeats ? FC_SEATS : 1);
      const ratio = seats / pc;
      const capacity = ratio < 0.1 ? 1 : ratio < 0.2 ? 2 : ratio < 0.3 ? 3 : ratio < 0.5 ? 4 : 5;
      return diversity * 0.7 + capacity * 0.3;
    };

    const variant = (mergeType: boolean, fixSeats: boolean) => {
      const ownMap = new Map<string, number | null>();
      for (const s of stores) {
        ownMap.set(s.storeCode, score(
          { singleSeatCount: s.ownSingleSeatCount, room1: s.ownRoom1, room2: s.ownRoom2, teamRoom: s.ownTeamRoom,
            coupleZone: s.ownCoupleZone, vipZone: s.ownVipZone, friendsZone: s.ownFriendsZone, firstClassZone: s.ownFirstClassZone },
          true, s.evaluationPcCount ?? s.pcCount ?? null, s.ownTeamRoomTotalSeats ?? null, mergeType, fixSeats));
      }
      const rivalArr: (number | null)[] = [];
      for (const r of rows) {
        for (const c of (compsByCode.get(r.input.storeCode) ?? []).filter((x) => x.investigationStatus !== "경쟁점없음")) {
          const ip = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
          if (!(ip > 0)) continue;
          rivalArr.push(score(c, false, ip, c.teamRoomTotalSeats ?? null, mergeType, fixSeats));
        }
      }
      return withZone((v, i) => ownMap.get(rows[i].input.storeCode) ?? v, (v, i) => rivalArr[i] ?? v);
    };

    const fcStores = stores.filter((s) => (s.ownFirstClassZone ?? 0) > 0);
    console.log("");
    console.log(`[퍼스트클래스존] 자사 ${fcStores.length}곳이 갖고 있다 (값은 전부 1 = 룸 하나)`);
    console.log(`  지금 환산: 1석 · 실제: ${FC_SEATS}석 -> 매장당 ${FC_SEATS - 1}석이 특화좌석에서 빠져 있다`);
    const base = line("지금 그대로", rows);
    line("종류만 팀룸과 합침", variant(true, false));
    line("좌석만 11석으로", variant(false, true));
    const both = line("둘 다 교정", variant(true, true));
    console.log(`  둘 다 교정: MAPE ${((both.mape - base.mape) * 100 >= 0 ? "+" : "")}${((both.mape - base.mape) * 100).toFixed(2)}%p · r ${(both.r - base.r >= 0 ? "+" : "")}${(both.r - base.r).toFixed(3)}`);
    console.log(`  ⚠️ 프렌즈존 환산(지금 x1)은 "개수가 구역인가 좌석인가"가 안 정해져 손대지 않았다.`);
    expect(rows.length).toBeGreaterThan(30);
  });
});
