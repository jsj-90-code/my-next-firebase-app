// 경쟁점이 문을 열면 우리 가동률이 정말 내려가나 — **이중차분** (2026-09-24)
//
// ── 왜 이걸 하나 ──────────────────────────────────────────────────────────
// 매장 40곳을 **옆으로** 비교하는 걸로는 판정이 안 된다는 게 드러났다
// (`_underPredicted.test.ts` (Z)번: 바닥과의 1.02%p 격차를 가르려면 154곳 필요).
// 그런데 **시간축**은 아직 안 썼다. 자료가 이미 있다:
//   · 매장 월별 가동률 850건
//   · 2km 경쟁점의 인허가 개업일·폐업일 (`rival2km.json`)
//
// 경쟁점이 열고 닫을 때 우리 가동률이 얼마나 움직이나를 보면, **매장 고유 요인**
// (입지·수요·운영·개점 코호트)이 전후로 그대로라 저절로 통제된다. 옆으로 비교할 때
// 우리를 괴롭히던 교란이 통째로 빠지고, **경쟁 항을 직접 겨냥한다.**
//
// ── ⚠️ 그냥 전후 비교는 안 된다 ────────────────────────────────────────────
// 재고 조사(`_underPredicted` (AC)번)에서 **폐업인데 우리 가동률이 내렸다**(−1.84%p).
// 방향이 반대다. 업계가 통째로 내려가는 추세에 속은 것이다.
// 그래서 **이중차분**을 쓴다:
//
//   이중차분 = (그 매장의 전후 변화) − (같은 기간 아무 일 없던 매장들의 전후 변화)
//
// 뒤의 항이 추세·계절을 걷어낸다. 남는 게 "경쟁점 때문에 움직인 몫"이다.
//
// ⚠️ 측정만 한다. 계수를 고치지 않는다.
//
// 실행: npx vitest run src/lib/storeEval/_rivalEventDiD.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
} from "./textbookModel";
import { existingSiteKey, rival2kmRecords } from "./rival2km";
import { DEFAULT_UNSURVEYED_PC_COUNT } from "./calc";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
/** 표본표준편차(n−1) — 사건 수가 적어서 편의를 빼야 한다. */
const sdSample = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((p, q) => p + (q - m) ** 2, 0) / (a.length - 1));
};
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN;
};
const ymAdd = (ym: string, k: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const ymDiff = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (ay * 12 + am) - (by * 12 + bm);
};

/** 전후 몇 달을 볼 것인가. 짧으면 잡음, 길면 사건이 겹친다. */
const WIN = 3;
/** 개점 직후 몇 달은 자리잡는 중이라 뺀다. */
const RAMP_MONTHS = 6;

describeIf("경쟁점 개·폐업 이중차분", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  // ── 월별 가동률 판 ──────────────────────────────────────────────────────
  const sales = (snap.sales ?? []) as Array<{ storeCode: string; yearMonth: string; utilizationRate?: number | null }>;
  const panel = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const v = s.utilizationRate;
    if (v == null || !(v > 0)) continue;
    if (!panel.has(s.storeCode)) panel.set(s.storeCode, new Map());
    panel.get(s.storeCode)!.set(s.yearMonth, v);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openedByCode = new Map<string, string>((snap.existingStores ?? []).map((s: any) => [s.storeCode, s.openedAt]));
  const nameByCode = new Map<string, string>(base.map((r) => [r.input.storeCode, r.input.storeName ?? r.input.storeCode]));
  const inputByCode = new Map(base.map((r) => [r.input.storeCode, r.input]));

  // ── 사건 목록 ───────────────────────────────────────────────────────────
  type Ev = {
    store: string; name: string; ym: string; kind: "open" | "close";
    rival: string; distanceM: number;
    /** 날짜를 어디서 얻었나 — 2km 스냅샷인가, 조사 경쟁점에 인허가를 붙인 것인가. */
    src: "2km" | "500m";
  };
  const events: Ev[] = [];
  const addEvent = (store: string, ym: string, kind: "open" | "close", rival: string, distanceM: number, src: "2km" | "500m") => {
    events.push({ store, name: nameByCode.get(store) ?? store, ym, kind, rival, distanceM, src });
  };
  for (const code of panel.keys()) {
    if (!inputByCode.has(code)) continue;
    for (const rec of rival2kmRecords(existingSiteKey(code))) {
      const add = (d: string | null, kind: "open" | "close") => {
        if (!d || !/^\d{4}-\d{2}/.test(d)) return;
        addEvent(code, d.slice(0, 7), kind, rec.name ?? "(이름없음)", rec.distanceM, "2km");
      };
      add(rec.open, "open");
      add(rec.close, "close");
    }
  }

  // ── ⭐ 500m 안 경쟁점에도 날짜를 붙인다 (2026-09-24) ──────────────────────
  // 병목이 여기였다((0)번): 자료 기간 안 사건 25건 중 **0~500m가 0건**이다.
  // 조사DB(Competitor)에는 개업일 칸이 아예 없고, rival2km은 일부러 500m 밖만 담는다.
  // 그런데 조사 경쟁점에는 **좌표가 있다.** 2km 생성기와 **같은 방법**으로 인허가에 붙이면
  // 날짜를 얻을 수 있다(60m 안 · 이름 유사도 0.6). 잣대를 둘로 만들지 않는다.
  //
  // ⚠️ 이건 **경쟁점 목록을 바꾸는 게 아니다.** 이미 세고 있는 경쟁점에 **날짜만** 붙인다.
  //    운영 V62도 조사DB도 안 건드린다.
  let joined500 = 0, unjoined500 = 0;
  {
    const PERMITS = ".local-tools/pcbang-permits.json";
    if (existsSync(PERMITS)) {
      type Permit = { name: string; lat: number; lng: number; open?: string | null; close?: string | null };
      const permits = (JSON.parse(readFileSync(PERMITS, "utf8")).rows as Permit[])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const norm = (t: string | null | undefined) => String(t ?? "")
        .replace(/\(.*?\)/g, "").replace(/피씨|피시/gi, "PC").replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();
      const sim = (a: string | null | undefined, b: string | null | undefined) => {
        const x = norm(a), y = norm(b);
        if (!x || !y) return 0;
        if (x === y) return 1;
        if (x.includes(y) || y.includes(x)) return 0.9;
        const k = Math.min(x.length, y.length);
        let c = 0;
        for (let i = 0; i < k; i++) if (x[i] === y[i]) c++;
        return c / Math.max(x.length, y.length);
      };
      const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
        const R = 6371000, rad = Math.PI / 180;
        const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
        const s = Math.sin(dLat / 2) ** 2
          + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
      };
      const ymd = (s: string | null | undefined) => (s && /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storeByCode = new Map<string, any>((snap.existingStores ?? []).map((s: any) => [s.storeCode, s]));
      for (const code of panel.keys()) {
        const st = storeByCode.get(code);
        if (!st?.lat || !st?.lng) continue;
        for (const c of compsByCode.get(code) ?? []) {
          if (c.investigationStatus === "경쟁점없음") continue;
          if (c.lat == null || c.lng == null) continue;
          const d = distM(st.lat, st.lng, c.lat, c.lng);
          if (!(d > 0) || d > 500) continue;   // 500m 안만 — 밖은 rival2km이 이미 담는다
          const cand = permits
            .map((p) => ({ p, dd: distM(c.lat as number, c.lng as number, p.lat, p.lng) }))
            .filter((x) => x.dd <= 60)
            .map((x) => ({ ...x, sc: sim(c.name, x.p.name) }))
            .sort((a, b) => b.sc - a.sc || a.dd - b.dd)[0];
          if (!cand || cand.sc < 0.6) { unjoined500 += 1; continue; }
          joined500 += 1;
          const o = ymd(cand.p.open), cl = ymd(cand.p.close);
          if (o) addEvent(code, o, "open", c.name ?? "(이름없음)", d, "500m");
          if (cl) addEvent(code, cl, "close", c.name ?? "(이름없음)", d, "500m");
        }
      }
    }
  }

  /** 그 매장의 [ym−k, ym−1] 평균 log 가동률과 [ym+1, ym+k] 평균. 달이 하나라도 비면 null. */
  const beforeAfter = (code: string, ym: string, k = WIN) => {
    const m = panel.get(code);
    if (!m) return null;
    const b: number[] = [], a: number[] = [];
    for (let i = 1; i <= k; i++) {
      const bv = m.get(ymAdd(ym, -i)); if (bv == null) return null; b.push(Math.log(bv));
      const av = m.get(ymAdd(ym, i)); if (av == null) return null; a.push(Math.log(av));
    }
    return { before: mean(b), after: mean(a) };
  };

  /** 그 매장에 [ym−k, ym+k] 안에 다른 사건이 있나 — 있으면 창이 더럽다. */
  const hasOtherEvent = (code: string, ym: string, k: number, self?: Ev) =>
    events.some((e) => e.store === code && e !== self && Math.abs(ymDiff(e.ym, ym)) <= k);

  // ── 쓸 수 있는 사건 고르기 ──────────────────────────────────────────────
  type Used = Ev & { dS: number; dC: number; did: number; nCtrl: number; predD: number | null };
  const used: Used[] = [];
  const rejected = { noPanel: 0, ramp: 0, overlap: 0, noCtrl: 0 };
  for (const e of events) {
    const ba = beforeAfter(e.store, e.ym);
    if (!ba) { rejected.noPanel += 1; continue; }
    const opened = openedByCode.get(e.store);
    if (opened && ymDiff(e.ym, opened.slice(0, 7)) < RAMP_MONTHS) { rejected.ramp += 1; continue; }
    // 창이 겹치는 사건은 뺀다 — 무엇 때문에 움직였는지 못 가른다
    if (hasOtherEvent(e.store, e.ym, 2 * WIN, e)) { rejected.overlap += 1; continue; }

    // 대조군 — 같은 달에 창이 깨끗하고 자료가 다 있는 **다른** 매장들
    const ctrl: number[] = [];
    for (const code of panel.keys()) {
      if (code === e.store) continue;
      if (hasOtherEvent(code, e.ym, 2 * WIN)) continue;
      const o = openedByCode.get(code);
      if (o && ymDiff(e.ym, o.slice(0, 7)) < RAMP_MONTHS) continue;
      const c = beforeAfter(code, e.ym);
      if (!c) continue;
      ctrl.push(c.after - c.before);
    }
    if (ctrl.length < 5) { rejected.noCtrl += 1; continue; }

    // 산식이 예측하는 변화 — 그 경쟁점 하나를 넣고/빼고 가동률을 다시 낸다
    const inp = inputByCode.get(e.store)!;
    const w = rivalDistanceWeight(e.distanceM, P);
    let predD: number | null = null;
    if (w > 0) {
      const extra = { ip: DEFAULT_UNSURVEYED_PC_COUNT, distanceM: e.distanceM, parts: null, name: e.rival };
      const withRival = { ...inp, rivals: [...(inp.rivals ?? []), extra] };
      const withoutRival = inp;
      const a = computeTextbook(e.kind === "open" ? withoutRival : withRival, P).utilization;
      const b = computeTextbook(e.kind === "open" ? withRival : withoutRival, P).utilization;
      if (a != null && a > 0 && b != null && b > 0) predD = Math.log(b) - Math.log(a);
    }
    const dS = ba.after - ba.before;
    const dC = mean(ctrl);
    used.push({ ...e, dS, dC, did: dS - dC, nCtrl: ctrl.length, predD });
  }

  it("(0) ⭐ 무엇이 병목인가 — 월 자료 폭 vs 사건 시점 vs 거리", () => {
    // (1)에서 384건 중 360건이 "월 자료 부족"으로 걸렸다. 진짜 병목이 무엇인지 가른다:
    //   (가) 매장 월 자료가 **몇 달치**뿐인가
    //   (나) 사건이 그 기간 **밖에** 있나
    //   (다) 가까운 경쟁점 사건이 **아예 없나** (있어야 산식을 시험할 수 있다)
    const spans: { code: string; n: number; from: string; to: string }[] = [];
    for (const [code, m] of panel) {
      const ks = [...m.keys()].sort();
      if (!ks.length) continue;
      spans.push({ code, n: ks.length, from: ks[0], to: ks[ks.length - 1] });
    }
    const ns = spans.map((s) => s.n).sort((a, b) => a - b);
    console.log(`\n[병목 가리기]`);
    console.log(`  (가) 매장 월 자료: ${spans.length}곳 · 매장당 중앙 **${ns[Math.floor(ns.length / 2)]}달**`
      + ` · 범위 ${ns[0]}~${ns[ns.length - 1]}달`);
    console.log(`       전체 기간 ${[...spans.map((s) => s.from)].sort()[0]} ~ ${[...spans.map((s) => s.to)].sort().pop()}`);
    // 사건이 그 매장의 자료 기간 안에 있나
    let inSpan = 0, outSpan = 0;
    const inSpanByBand = new Map<string, number>();
    for (const e of events) {
      const m = panel.get(e.store);
      if (!m) { outSpan += 1; continue; }
      const ks = [...m.keys()].sort();
      const ok = e.ym >= ymAdd(ks[0], WIN) && e.ym <= ymAdd(ks[ks.length - 1], -WIN);
      if (!ok) { outSpan += 1; continue; }
      inSpan += 1;
      const band = e.distanceM < 500 ? "0~500m" : e.distanceM < 1000 ? "500~1000m" : "1km 밖";
      inSpanByBand.set(band, (inSpanByBand.get(band) ?? 0) + 1);
    }
    console.log(`  (나) 사건 ${events.length}건 중 그 매장 자료 기간 **안**에 있는 것: **${inSpan}건** (밖 ${outSpan}건)`);
    console.log(`  (다) 그 ${inSpan}건의 거리 분포: `
      + ["0~500m", "500~1000m", "1km 밖"].map((b) => `${b} ${inSpanByBand.get(b) ?? 0}건`).join(" · "));
    console.log(`  (라) 500m 안 조사 경쟁점에 인허가를 붙인 결과: 짝 찾음 **${joined500}곳** / 못 찾음 ${unjoined500}곳`);
    // 산식이 의미 있는 크기를 예측하는 건 얼마나 되나 — 감쇠 때문에 먼 건 사실상 0이다
    const wOf = (d: number) => rivalDistanceWeight(d, P);
    const meaningful = events.filter((e) => wOf(e.distanceM) >= 0.05).length;
    console.log(`\n  ⭐ 산식이 **의미 있는 크기**(거리무게 ≥5%)로 보는 사건은 전체 ${events.length}건 중 ${meaningful}건이다.`);
    console.log(`     감쇠 곡선상 그건 대략 **${Math.round(200 - 200 * Math.log(0.05 / 0.9593))}m 안**이다.`);
    console.log(`\n  ⚠️ **500m 안 경쟁점에는 개업일 자료가 아예 없다.** 조사DB(Competitor)에 그 칸이 없고,`);
    console.log(`     rival2km은 일부러 500m 밖만 담는다("같은 가게를 두 번 세면 안 된다").`);
    console.log(`     즉 **효과가 제일 클 구간의 사건을 우리가 못 보고 있다.**`);
    expect(spans.length).toBeGreaterThan(0);
  });

  it("(1) 쓸 수 있는 사건이 몇 건인가 — 걸러낸 이유까지", () => {
    console.log(`\n[사건 재고] 전후 ${WIN}달씩 · 개점 후 ${RAMP_MONTHS}달 지난 뒤 · 창 겹침 제외`);
    console.log(`  전체 사건 ${events.length}건 (개업 ${events.filter((e) => e.kind === "open").length}`
      + ` · 폐업 ${events.filter((e) => e.kind === "close").length})`);
    console.log(`  걸러냄 — 월 자료 부족 ${rejected.noPanel} · 개점 직후 ${rejected.ramp}`
      + ` · 창 겹침 ${rejected.overlap} · 대조군 부족 ${rejected.noCtrl}`);
    console.log(`  ⭐ **쓸 수 있는 사건 ${used.length}건**`
      + ` (개업 ${used.filter((e) => e.kind === "open").length} · 폐업 ${used.filter((e) => e.kind === "close").length})`);
    console.log(`  대조군 매장 수: 중앙 ${used.length ? [...used.map((u) => u.nCtrl)].sort((a, b) => a - b)[Math.floor(used.length / 2)] : 0}곳`);
    expect(events.length).toBeGreaterThan(0);
  });

  it("(2) ⭐⭐ 이중차분 — 경쟁점이 열면 우리가 내려가나", () => {
    const show = (label: string, xs: Used[], dir: string) => {
      if (xs.length < 2) { console.log(`\n  ${label}: 사건 ${xs.length}건 — 너무 적다`); return; }
      const raw = xs.map((x) => x.dS), ctrl = xs.map((x) => x.dC), did = xs.map((x) => x.did);
      const se = sdSample(did) / Math.sqrt(did.length);
      // 부호 검정 — 평균은 이상치에 끌리므로 같이 본다
      const neg = did.filter((v) => v < 0).length;
      console.log(`\n  ── ${label} ${xs.length}건 · 기대 방향: ${dir} ────────────────`);
      console.log(`    그냥 전후 (속는 값)   ${(mean(raw) * 100).toFixed(2).padStart(7)}%  ← 업계 추세가 섞여 있다`);
      console.log(`    같은 기간 대조군      ${(mean(ctrl) * 100).toFixed(2).padStart(7)}%  ← 이게 추세다`);
      console.log(`    **이중차분**          ${(mean(did) * 100).toFixed(2).padStart(7)}%`
        + `  (2SE = ${(2 * se * 100).toFixed(2)}%)`);
      console.log(`    내려간 건 ${neg}/${did.length}건 · 중앙 ${([...did].sort((a, b) => a - b)[Math.floor(did.length / 2)] * 100).toFixed(2)}%`);
      const sig = Math.abs(mean(did)) > 2 * se;
      console.log(`    ${sig ? "✅ **2SE를 넘는다 — 효과가 보인다**" : "⚠️ 2SE 안 — 자료가 효과를 못 본다"}`);
      return { m: mean(did), se };
    };
    console.log(`\n[이중차분] 값은 전부 **log 변화**다(×100 하면 대략 %)`);
    show("경쟁점 개업", used.filter((x) => x.kind === "open"), "우리 가동률이 **내려간다**(음수)");
    show("경쟁점 폐업", used.filter((x) => x.kind === "close"), "우리 가동률이 **올라간다**(양수)");
    // 개업을 −1, 폐업을 +1로 뒤집어 합치면 "경쟁이 세지면 내려간다"를 한 번에 본다
    const merged = used.map((x) => (x.kind === "open" ? x.did : -x.did));
    if (merged.length >= 2) {
      const se = sdSample(merged) / Math.sqrt(merged.length);
      console.log(`\n  ── 합쳐서 보기 (폐업은 부호를 뒤집는다) ${merged.length}건 ──────────`);
      console.log(`    **경쟁이 세질 때 가동률 변화 = ${(mean(merged) * 100).toFixed(2)}%**`
        + `  (2SE = ${(2 * se * 100).toFixed(2)}%)`);
      console.log(`    음수면 기대대로다(경쟁 ↑ -> 가동률 ↓). 내려간 건 ${merged.filter((v) => v < 0).length}/${merged.length}건`);
      console.log(`    ${Math.abs(mean(merged)) > 2 * se
        ? (mean(merged) < 0 ? "✅ **효과가 보이고 방향도 맞다**" : "⛔ 효과는 보이는데 **방향이 반대다**")
        : "⚠️ 2SE 안 — 자료가 효과를 못 본다"}`);
    }
    expect(used.length).toBeGreaterThanOrEqual(0);
  });

  it("(3) ⭐⭐⭐ 산식이 예측한 움직임과 대 본다 — 경쟁 항의 세기가 맞나", () => {
    const xs = used.filter((x) => x.predD != null);
    if (xs.length < 3) { console.log(`\n[산식 대조] 사건 ${xs.length}건 — 너무 적다`); return; }
    const obs = xs.map((x) => x.kind === "open" ? x.did : -x.did);
    const prd = xs.map((x) => (x.kind === "open" ? x.predD! : -x.predD!));
    console.log(`\n[산식 대조] ${xs.length}건 · 둘 다 "경쟁이 세질 때의 log 변화"로 맞췄다(음수가 정상)`);
    console.log(`  관측(이중차분) 평균 ${(mean(obs) * 100).toFixed(2)}%  ·  산식 예측 평균 ${(mean(prd) * 100).toFixed(2)}%`);
    const ratio = mean(prd) !== 0 ? mean(obs) / mean(prd) : NaN;
    console.log(`  **관측 ÷ 예측 = ${ratio.toFixed(2)}배**`);
    console.log(`    1에 가까우면 경쟁 항의 세기가 맞다`);
    console.log(`    1보다 작으면 산식이 **경쟁을 과하게 본다** · 크면 **약하게 본다**`);
    console.log(`  사건별 상관 r = ${corr(prd, obs).toFixed(3)} (사건마다 크기가 맞아떨어지나)`);
    const se = sdSample(obs) / Math.sqrt(obs.length);
    console.log(`  관측 2SE = ${(2 * se * 100).toFixed(2)}% -> 배율의 대략적 범위 `
      + `[${((mean(obs) - 2 * se) / mean(prd)).toFixed(2)}, ${((mean(obs) + 2 * se) / mean(prd)).toFixed(2)}]배`);
    console.log(`\n  사건 하나씩 (경쟁 세짐 기준 · 음수가 정상)`);
    console.log(`    매장            달       거리   경쟁점                 관측     예측`);
    for (const x of [...xs].sort((a, b) => a.distanceM - b.distanceM)) {
      const o = x.kind === "open" ? x.did : -x.did, p = x.kind === "open" ? x.predD! : -x.predD!;
      console.log(`    ${x.name.padEnd(14)}${x.ym}  ${String(Math.round(x.distanceM)).padStart(5)}m`
        + `  ${(x.kind === "open" ? "개업 " : "폐업 ") + x.rival.slice(0, 16)}`.padEnd(24)
        + `${(o * 100).toFixed(1).padStart(7)}%${(p * 100).toFixed(1).padStart(8)}%`);
    }
    console.log(`\n  ⚠️ 대수를 모른다 — 전부 ${DEFAULT_UNSURVEYED_PC_COUNT}대로 가정했다. 배율은 그만큼 흔들린다.`);
    console.log(`  ⚠️ 사건이 적어 **이 배율로 계수를 고르지 마라.** 방향과 대략의 크기만 읽는다.`);
    expect(xs.length).toBeGreaterThan(0);
  });

  it("(5) ⭐⭐⭐ 현장 감각과 대 본다 — \"경쟁점 하나 생기면 보통 20~30% 떨어진다\"", () => {
    // 사용자(2026-09-24): *"일단 생각나는 건 탕정역점이 오픈 후 경쟁매장 생겼음.
    //   독점에서 경쟁으로 바뀐 거라 좀 많이 떨어졌을 듯?"* + *"체감상 20~30% 정도
    //   떨어지더라 보통."*
    //
    // ⭐ **이건 사건 수가 필요 없는 시험이다.** 산식에 가상의 새 경쟁점을 하나 붙여 보고
    //    "몇 % 떨어진다고 말하나"를 현장 감각과 견주면 된다. 40곳 표본의 판정력 문제를
    //    통째로 비껴간다.
    //
    // ⚠️ 새로 문 연 경쟁점은 **새 가게다** — 인테리어도 사양도 최신이다. 그래서 품질비를
    //    조사 경쟁점 평균(낡은 가게들)으로 잡으면 안 된다. 두 경우를 다 찍는다:
    //      · 품질 같다(비=1.00) — 새 가게니까 이쪽이 자연스럽다
    //      · 품질이 조사 경쟁점 평균(비≈0.58) — 지금 산식이 세는 방식
    const DIST = 150;           // 평지(200m) 안 — 거리무게 1.0
    const results: { name: string; act: number | null; eq: number; avg: number; mono: boolean }[] = [];
    for (const r of base) {
      const before = computeTextbook(r.input, P).utilization;
      if (before == null || !(before > 0)) continue;
      const mk = (parts: typeof r.input.ownQualityParts) => {
        const add = { ip: DEFAULT_UNSURVEYED_PC_COUNT, distanceM: DIST, parts, name: "가상 신규" };
        const after = computeTextbook({ ...r.input, rivals: [...(r.input.rivals ?? []), add] }, P).utilization;
        return after == null || !(after > 0) ? NaN : (after / before - 1) * 100;
      };
      // 품질 같음 = 자사와 같은 항목 점수를 준다(비가 정확히 1이 된다)
      const eq = mk(r.input.ownQualityParts);
      // 조사 경쟁점 평균 품질 = parts를 모르는 것으로 두면 비가 1이 되어 버리므로,
      // 자사 점수에 표본 평균 품질비(0.581)를 곱한 항목표를 만들어 준다.
      const oq = r.input.ownQualityParts;
      const scaled = oq ? {
        spec: oq.spec == null ? null : oq.spec * 0.581,
        food: oq.food == null ? null : oq.food * 0.581,
        zone: oq.zone == null ? null : oq.zone * 0.581,
        interior: oq.interior == null ? null : oq.interior * 0.581,
        management: oq.management == null ? null : oq.management * 0.581,
      } : null;
      const avg = mk(scaled);
      if (!Number.isFinite(eq) || !Number.isFinite(avg)) continue;
      results.push({
        name: r.input.storeName ?? r.input.storeCode,
        act: r.input.actualUtilization, eq, avg,
        mono: !(r.input.competitorIp ?? 0),
      });
    }
    const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
    const eqs = results.map((x) => x.eq), avgs = results.map((x) => x.avg);
    console.log(`\n[현장 감각 대조] ${DEFAULT_UNSURVEYED_PC_COUNT}대짜리 경쟁점이 ${DIST}m에 새로 생기면`);
    console.log(`  산식은 가동률이 몇 % 떨어진다고 말하나 · n=${results.length}곳`);
    console.log(`\n  경우                     중앙      4분위 범위        최대 하락`);
    console.log(`  품질 같다(비 1.00)      ${q(eqs, 0.5).toFixed(1).padStart(7)}%`
      + `   ${q(eqs, 0.25).toFixed(1)} ~ ${q(eqs, 0.75).toFixed(1)}%`
      + `${Math.min(...eqs).toFixed(1).padStart(12)}%`);
    console.log(`  조사 평균 품질(비 0.58)  ${q(avgs, 0.5).toFixed(1).padStart(7)}%`
      + `   ${q(avgs, 0.25).toFixed(1)} ~ ${q(avgs, 0.75).toFixed(1)}%`
      + `${Math.min(...avgs).toFixed(1).padStart(12)}%`);
    console.log(`\n  ⭐ 현장 감각: **−20 ~ −30%**`);
    const within = (a: number[]) => a.filter((v) => v <= -20 && v >= -30).length;
    console.log(`     그 안에 드는 매장 — 품질 같다 ${within(eqs)}/${results.length}곳`
      + ` · 조사 평균 품질 ${within(avgs)}/${results.length}곳`);
    const verdict = (m: number) => m > -20 ? "⛔ **산식이 약하게 본다**(현장보다 덜 떨어진다고 말한다)"
      : m < -30 ? "⛔ 산식이 과하게 본다" : "✅ 현장 감각과 맞는다";
    console.log(`     품질 같다 중앙 ${q(eqs, 0.5).toFixed(1)}% -> ${verdict(q(eqs, 0.5))}`);
    console.log(`     조사 평균  중앙 ${q(avgs, 0.5).toFixed(1)}% -> ${verdict(q(avgs, 0.5))}`);

    // 독점매장은 특히 크게 떨어져야 한다 — 사용자가 짚은 탕정역이 그 경우다
    const mono = results.filter((x) => x.mono);
    if (mono.length) {
      console.log(`\n  독점매장(경쟁점 0곳)은 특히 크게 떨어져야 한다 — 사용자가 짚은 자리다`);
      console.log(`    매장            실측 가동률   품질같음   조사평균품질`);
      for (const x of mono) {
        console.log(`    ${x.name.padEnd(14)}${x.act == null ? "      —" : `${(x.act * 100).toFixed(1).padStart(8)}%`}`
          + `${x.eq.toFixed(1).padStart(11)}%${x.avg.toFixed(1).padStart(13)}%`);
      }
    }
    console.log(`\n  ⚠️ 이건 **감각과의 대조**지 검정이 아니다. 다만 방향이 크게 어긋나면`);
    console.log(`     그건 표본 40곳 문제가 아니라 **산식 자체의 문제**다 — 표본을 늘려도 안 고쳐진다.`);
    expect(results.length).toBeGreaterThan(30);
  });

  it("(6) 탕정역점 월별 가동률 — 사용자가 짚은 사례를 눈으로 본다", () => {
    // 사용자: *"탕정역점이 오픈 후 경쟁매장 생겼음. 독점에서 경쟁으로 바뀐 거라 좀 많이 떨어졌을 듯?"*
    // 메모에도 있다 — 2026-03부터 급락했는데 competitorIp가 0이다(경쟁점 미등록).
    // 그래서 **내 사건 목록에도 안 잡힌다.** 월별 값을 그대로 찍어 눈으로 본다.
    const target = [...nameByCode.entries()].find(([, nm]) => nm.includes("탕정"));
    if (!target) { console.log(`\n[탕정역점] 매장을 못 찾았다`); return; }
    const [code, nm] = target;
    const m = panel.get(code);
    if (!m) { console.log(`\n[${nm}] 월 자료가 없다`); return; }
    const ks = [...m.keys()].sort();
    console.log(`\n[${nm}] 월별 실측 가동률 · 개점 ${openedByCode.get(code) ?? "?"}`);
    let line = "  ";
    ks.forEach((k, i) => {
      line += `${k.slice(2)} ${(m.get(k)! * 100).toFixed(1)}%   `;
      if ((i + 1) % 4 === 0) { console.log(line); line = "  "; }
    });
    if (line.trim()) console.log(line);
    // 같은 기간 다른 매장 평균과 견준다 — 업계 추세를 빼고 봐야 한다
    console.log(`\n  같은 달 다른 매장 평균과 견주기 (추세를 빼고 본다)`);
    console.log(`    달        탕정역    다른매장평균    차이`);
    for (const k of ks) {
      const others: number[] = [];
      for (const [c2, m2] of panel) {
        if (c2 === code) continue;
        const v = m2.get(k);
        if (v != null && v > 0) others.push(v);
      }
      if (others.length < 5) continue;
      const t = m.get(k)!;
      console.log(`    ${k}${(t * 100).toFixed(1).padStart(9)}%${(mean(others) * 100).toFixed(1).padStart(13)}%`
        + `${((t - mean(others)) * 100).toFixed(1).padStart(9)}%p`);
    }
    console.log(`\n  ⚠️ **이 매장의 경쟁점은 DB에 없다**(competitorIp=0). 그래서 산식은 여전히`);
    console.log(`     독점으로 보고 있고, 축척 적합에도 이 매장이 쓰인다.`);

    // ── 이중차분으로 크기를 재고, 그 크기를 내는 품질비를 역산한다 ──────────
    // 그래프가 2026-03에 꺾인다. 그 앞뒤 6달씩으로 이중차분한다.
    const CUT = "2026-03", K = 6;
    const avgOf = (c2: string, from: number, to: number) => {
      const mm = panel.get(c2);
      if (!mm) return null;
      const vs: number[] = [];
      for (let i = from; i <= to; i++) {
        const v = mm.get(ymAdd(CUT, i));
        if (v != null && v > 0) vs.push(Math.log(v));
      }
      return vs.length >= K - 1 ? mean(vs) : null;
    };
    const tBefore = avgOf(code, -K, -1), tAfter = avgOf(code, 0, K - 1);
    const cBefore: number[] = [], cAfter: number[] = [];
    for (const c2 of panel.keys()) {
      if (c2 === code) continue;
      const b = avgOf(c2, -K, -1), a = avgOf(c2, 0, K - 1);
      if (b != null && a != null) { cBefore.push(b); cAfter.push(a); }
    }
    if (tBefore != null && tAfter != null && cBefore.length >= 5) {
      const dT = tAfter - tBefore;
      const dC = mean(cAfter) - mean(cBefore);
      const did = dT - dC;
      console.log(`\n  [이중차분] 꺾인 달 ${CUT} 기준 앞뒤 ${K}달씩 · 대조군 ${cBefore.length}곳`);
      console.log(`  ⚠️ 괄호 안 %는 **log 변화**다 — 실제 비율로는 log −30%가 약 −26%다.`
        + ` 산식 예측도 같은 자라 그대로 견주면 된다.`);
      console.log(`    탕정역     ${(Math.exp(tBefore) * 100).toFixed(1)}% -> ${(Math.exp(tAfter) * 100).toFixed(1)}%`
        + `  (${(dT * 100).toFixed(1)}%)`);
      console.log(`    대조군     ${(Math.exp(mean(cBefore)) * 100).toFixed(1)}% -> ${(Math.exp(mean(cAfter)) * 100).toFixed(1)}%`
        + `  (${(dC * 100).toFixed(1)}%)  ← 업계 추세`);
      console.log(`    **이중차분 = ${(did * 100).toFixed(1)}%**  (사용자 체감 −20~30%)`);

      // 그 하락을 내려면 새 경쟁점의 품질비가 얼마여야 하나 — 역산
      const inp = inputByCode.get(code);
      const before0 = inp ? computeTextbook(inp, P).utilization : null;
      if (inp && before0 != null && before0 > 0) {
        const oq = inp.ownQualityParts;
        const dropAt = (ratio: number, dist: number, ip: number) => {
          const parts = oq ? {
            spec: oq.spec == null ? null : oq.spec * ratio,
            food: oq.food == null ? null : oq.food * ratio,
            zone: oq.zone == null ? null : oq.zone * ratio,
            interior: oq.interior == null ? null : oq.interior * ratio,
            management: oq.management == null ? null : oq.management * ratio,
          } : null;
          const after = computeTextbook({ ...inp, rivals: [...(inp.rivals ?? []), { ip, distanceM: dist, parts, name: "미등록 신규" }] }, P).utilization;
          return after == null || !(after > 0) ? NaN : Math.log(after / before0);
        };
        console.log(`\n    이 하락을 내려면 새 경쟁점이 얼마나 세야 하나 (150m · ${DEFAULT_UNSURVEYED_PC_COUNT}대 가정)`);
        console.log(`      품질비    산식이 내는 하락`);
        for (const rr of [1.0, 0.9, 0.8, 0.7, 0.6, 0.581]) {
          const d = dropAt(rr, 150, DEFAULT_UNSURVEYED_PC_COUNT);
          console.log(`      ${rr.toFixed(3).padStart(6)}${(d * 100).toFixed(1).padStart(15)}%`
            + (Math.abs(d - did) < 0.02 ? "   ← 관측과 맞는 자리" : rr === 0.581 ? "   ← 지금 산식이 세는 방식" : ""));
        }
        console.log(`\n    ⚠️ **대수도 거리도 모른다**(경쟁점이 DB에 없다). 위 역산은 150m·90대 가정이다.`);
        console.log(`       그 가정이 틀리면 품질비도 틀린다 — 이 값으로 계수를 고르지 마라.`);
        console.log(`    📌 **할 일: 탕정역 경쟁점을 조사해서 등록한다.** 대수·거리·품질이 들어오면`);
        console.log(`       이 사례 하나가 경쟁 항을 직접 검증한다.`);
      }
    }
    expect(ks.length).toBeGreaterThan(0);
  });

  it("(7) ⭐⭐⭐ 탕정역 미등록 경쟁점 둘을 찾는다 — 레드포스·레벨업", () => {
    // 사용자(2026-09-24): *"레드포스랑 레벨업 두 개 생김. 언제 생긴진 모르겠어.
    //   두 개 다 100미터 안에 있음."*
    //
    // 이름과 대략 거리를 알았으니 **인허가에서 개업일**, **카카오에서 실재·거리**를 찾는다.
    // 개업일이 2026-03 근처면 (6)번의 꺾임과 짝이 맞고, 그러면 이 사례가 **경쟁 항을 직접
    // 검증하는 자연실험**이 된다.
    const target = [...nameByCode.entries()].find(([, nm]) => nm.includes("탕정"));
    if (!target) { console.log(`\n[탕정역 경쟁점 찾기] 매장을 못 찾았다`); return; }
    const [code, nm] = target;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st = (snap.existingStores ?? []).find((s: any) => s.storeCode === code);
    if (!st?.lat || !st?.lng) { console.log(`\n[${nm}] 좌표가 없다`); return; }
    const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const R = 6371000, rad = Math.PI / 180;
      const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
      const s = Math.sin(dLat / 2) ** 2
        + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };
    const WANT = /레드포스|레벨업/;
    console.log(`\n[탕정역 경쟁점 찾기] ${nm} (${st.lat.toFixed(5)}, ${st.lng.toFixed(5)}) · 개점 ${st.openedAt}`);

    // ── 카카오 — 실재와 거리 ────────────────────────────────────────────────
    const GRID = ".local-tools/kakao-pcbangs-grid.json";
    type Doc = { id: string; name: string; lat: number; lng: number; distanceM: number };
    const found: Doc[] = [];
    if (existsSync(GRID)) {
      const grid = JSON.parse(readFileSync(GRID, "utf8")) as {
        sites: Record<string, { pcRooms?: { docs?: Doc[] } }>;
      };
      const docs = grid.sites[`existing:${code}`]?.pcRooms?.docs ?? [];
      console.log(`\n  [카카오] 2km 안 PC방 ${docs.length}곳 · 그중 500m 안 ${docs.filter((d) => d.distanceM <= 500).length}곳`);
      console.log(`    가까운 순 8곳`);
      for (const d of [...docs].sort((a, b) => a.distanceM - b.distanceM).slice(0, 8)) {
        console.log(`      ${String(Math.round(d.distanceM)).padStart(5)}m  ${d.name}`
          + (WANT.test(d.name) ? "   ⭐ 사용자가 말한 곳" : ""));
      }
      found.push(...docs.filter((d) => WANT.test(d.name)));
    }

    // ── 인허가 — 개업일 ─────────────────────────────────────────────────────
    const PERMITS = ".local-tools/pcbang-permits.json";
    if (existsSync(PERMITS)) {
      type Permit = { name: string; lat: number; lng: number; open?: string | null; close?: string | null; totalMachines?: number | null };
      const permits = (JSON.parse(readFileSync(PERMITS, "utf8")).rows as Permit[])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const near = permits
        .map((p) => ({ p, d: distM(st.lat, st.lng, p.lat, p.lng) }))
        .filter((x) => x.d <= 600)
        .sort((a, b) => a.d - b.d);
      console.log(`\n  [인허가] 600m 안 등록 ${near.length}건 (같은 건물 다중등록이 섞여 있다)`);
      console.log(`    거리     개업일        폐업일       상호`);
      for (const x of near.slice(0, 14)) {
        console.log(`    ${String(Math.round(x.d)).padStart(4)}m  ${(x.p.open ?? "-").slice(0, 10).padEnd(12)}`
          + `${(x.p.close ?? "-").slice(0, 10).padEnd(12)}${x.p.name}`
          + (WANT.test(x.p.name ?? "") ? "   ⭐" : ""));
      }
      const hits = near.filter((x) => WANT.test(x.p.name ?? ""));
      if (hits.length) {
        console.log(`\n  ⭐ **사용자가 말한 두 곳의 인허가**`);
        for (const x of hits) {
          console.log(`    ${x.p.name} — ${Math.round(x.d)}m · 개업 ${x.p.open ?? "?"}`
            + ` · 폐업 ${x.p.close ?? "-"}`
            + (x.p.totalMachines != null ? ` · 총게임기수 ${x.p.totalMachines}` : ""));
        }
        console.log(`    ⚠️ 총게임기수는 **PC 대수가 아니다**(작은 값은 가짜) — 대수는 조사해야 한다.`);
      } else {
        console.log(`\n  ⚠️ 600m 안 인허가에서 "레드포스/레벨업"을 못 찾았다.`);
        // 인허가 자료가 이 동네를 아예 안 덮는 건지부터 본다 — 반경을 넓혀서 확인
        for (const R of [1000, 2000, 5000, 20000]) {
          const cnt = permits.filter((p) => distM(st.lat, st.lng, p.lat, p.lng) <= R).length;
          console.log(`     ${String(R).padStart(5)}m 안 인허가 ${cnt}건`);
        }
        const nearest = permits
          .map((p) => ({ p, d: distM(st.lat, st.lng, p.lat, p.lng) }))
          .sort((a, b) => a.d - b.d)[0];
        if (nearest) {
          console.log(`     제일 가까운 인허가: ${Math.round(nearest.d)}m · ${nearest.p.name}`
            + ` · 개업 ${nearest.p.open ?? "?"}`);
        }
        // 이름으로 전국에서 찾아본다 — 좌표가 틀린 건지 자료에 없는 건지 가른다
        const byName = permits.filter((p) => WANT.test(p.name ?? ""));
        console.log(`\n     전국 인허가에서 이름으로 찾기 — "레드포스/레벨업" ${byName.length}건`);
        for (const p of byName.slice(0, 8)) {
          console.log(`       ${p.name} · 개업 ${(p.open ?? "?").slice(0, 10)}`
            + ` · ${Math.round(distM(st.lat, st.lng, p.lat, p.lng) / 1000)}km 떨어짐`);
        }
        console.log(`\n     ⭐ 이름은 있는데 좌표가 멀면 **좌표 변환 문제**(EPSG:5174)다.`);
        console.log(`        전국에 이름이 아예 없으면 **자료가 아직 안 올라온 것**이다(신규 등록 지연).`);
      }
    }
    if (found.length) {
      console.log(`\n  ⭐ 카카오에서 찾은 거리: ${found.map((d) => `${d.name} ${Math.round(d.distanceM)}m`).join(" · ")}`);
    }
    expect(true).toBe(true);
  });

  it("(8) ⭐⭐⭐ 두 곳을 넣으면 산식이 관측을 맞히나 — 탕정역 검산", () => {
    // 사용자 제보대로 **100m 안에 두 곳**을 넣어 보고, (6)의 이중차분(log −30.7%)과 견준다.
    // 하나·150m로 봤을 때는 품질비 0.75가 필요했다. 둘·100m면 훨씬 세지므로
    // **지금 산식의 품질비(0.581)로도 맞을 수 있다** — 그러면 산식이 틀린 게 아니라
    // **경쟁점이 빠져 있던 것**이 된다. 둘은 처방이 전혀 다르다.
    const target = [...nameByCode.entries()].find(([, nm]) => nm.includes("탕정"));
    if (!target) return;
    const [code] = target;
    const inp = inputByCode.get(code);
    if (!inp) return;
    const before = computeTextbook(inp, P).utilization;
    if (before == null || !(before > 0)) return;
    const oq = inp.ownQualityParts;
    const scaled = (ratio: number) => (oq ? {
      spec: oq.spec == null ? null : oq.spec * ratio,
      food: oq.food == null ? null : oq.food * ratio,
      zone: oq.zone == null ? null : oq.zone * ratio,
      interior: oq.interior == null ? null : oq.interior * ratio,
      management: oq.management == null ? null : oq.management * ratio,
    } : null);
    // 카카오가 확인해 준 **실제 거리**를 쓴다((7)번): 레벨업 74m · 레드포스 91m
    const RIVALS: { name: string; distanceM: number }[] = [
      { name: "레벨업PC방 탕정역점", distanceM: 74 },
      { name: "레드포스PC아레나 아산탕정점", distanceM: 91 },
    ];
    const dropWith = (count: number, ratio: number, ip: number) => {
      const add = RIVALS.slice(0, count).map((r) => ({
        ip, distanceM: r.distanceM, parts: scaled(ratio), name: r.name,
      }));
      const after = computeTextbook({ ...inp, rivals: [...(inp.rivals ?? []), ...add] }, P).utilization;
      return after == null || !(after > 0) ? NaN : Math.log(after / before);
    };
    const OBS = -0.307; // (6)번 이중차분
    console.log(`\n[탕정역 검산] 관측 이중차분 **log ${(OBS * 100).toFixed(1)}%** 와 견준다`);
    console.log(`  지금 예측 ${(before * 100).toFixed(1)}% · 실측(평가창 12달) ${((inp.actualUtilization ?? 0) * 100).toFixed(1)}%`);
    console.log(`  넣는 경쟁점: ${RIVALS.map((r) => `${r.name}(${r.distanceM}m)`).join(" · ")}`);
    console.log(`  ⚠️ 개업일은 인허가에 없다. 다만 가동률이 **2026-03에 꺾였고** 둘 다 그때 연 것으로 본다.`);
    const table = (count: number, label: string) => {
      console.log(`\n  ${label}`);
      console.log(`  대수    품질비 0.581   0.700   0.800   1.000`);
      for (const ip of [60, 90, 120]) {
        const cells = [0.581, 0.7, 0.8, 1.0].map((rr) => {
          const d = dropWith(count, rr, ip);
          const near = Math.abs(d - OBS) < 0.03;
          return `${(d * 100).toFixed(1)}%${near ? "*" : " "}`.padStart(9);
        });
        console.log(`  ${String(ip).padStart(4)}대${cells.join("")}`
          + (ip === 90 ? "   ← 미조사 기본대수" : ""));
      }
    };
    table(2, `경쟁점 **둘 다**(74m·91m) — 사용자 제보`);
    table(1, `[참고] 레벨업 하나만(74m)`);
    console.log(`\n  * 표시 = 관측 ${(OBS * 100).toFixed(1)}%와 3%p 안`);
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · **0.581 칸에서 맞으면** -> 산식은 멀쩡하고 **경쟁점이 빠져 있던 것**이다.`);
    console.log(`       처방: 탕정역 경쟁점을 등록한다. 품질 항은 손대지 않는다`);
    console.log(`     · **0.581로 한참 모자라면** -> 품질 항이 경쟁을 약하게 본다.`);
    console.log(`       처방: 품질비/θ를 다시 본다`);
    console.log(`  ⚠️ 대수를 아직 모른다(60·90·120대를 다 찍은 이유다). 조사하면 칸이 하나로 좁혀진다.`);
    expect(before).toBeGreaterThan(0);
  });

  it("(9) ⭐⭐⭐ 우리가 더 약하다면? — 탕정역이 산식을 반박한다", () => {
    // 사용자(2026-09-24): *"탕정역 같은 경우에 우리 매장이 경쟁력 제일 떨어짐."*
    //   + *"관리 부분 제외하고 얘기하는 거임. 관리는 되게 잘할 듯."*
    //
    // ⚠️ **(8)번의 결론이 뒤집힌다.** 거기서는 품질비(경쟁÷자사)를 조사 표본 평균 0.581로
    //    놓고 "관측과 맞는다"고 했는데, 0.581은 **경쟁점이 우리보다 한참 못하다**는 뜻이다.
    //    현장 판단은 정반대다 — 관리 빼고는 **우리가 제일 못하다**(품질비 > 1).
    //
    // 비중으로 따지면: 사양 26.4% · 존구성 23.8% · 인테리어 10.2% · 먹거리 7.5% = **67.9%**에서
    // 우리가 지고, 관리 15.1%에서만 이긴다. 그러면 전체 품질비는 **1 언저리나 그 위**다.
    //
    // 그 값을 넣으면 산식이 뭐라고 하나. 그리고 관측을 내려면 실효 경쟁량이 얼마여야 하나.
    const target = [...nameByCode.entries()].find(([, nm]) => nm.includes("탕정"));
    if (!target) return;
    const [code] = target;
    const inp = inputByCode.get(code);
    if (!inp) return;
    const before = computeTextbook(inp, P).utilization;
    const pc = inp.pcCount ?? 0;
    if (before == null || !(before > 0) || !(pc > 0)) return;
    const OBS = -0.307;
    const oq = inp.ownQualityParts;
    const scaled = (ratio: number) => (oq ? {
      spec: oq.spec == null ? null : oq.spec * ratio,
      food: oq.food == null ? null : oq.food * ratio,
      zone: oq.zone == null ? null : oq.zone * ratio,
      interior: oq.interior == null ? null : oq.interior * ratio,
      management: oq.management == null ? null : oq.management * ratio,
    } : null);
    const RIVALS = [{ name: "레벨업", d: 74 }, { name: "레드포스", d: 91 }];
    const dropAt = (ratio: number, ip: number) => {
      const add = RIVALS.map((r) => ({ ip, distanceM: r.d, parts: scaled(ratio), name: r.name }));
      const after = computeTextbook({ ...inp, rivals: [...(inp.rivals ?? []), ...add] }, P).utilization;
      return after == null || !(after > 0) ? NaN : Math.log(after / before);
    };
    console.log(`\n[탕정역 — 우리가 더 약하다면] 관측 이중차분 log ${(OBS * 100).toFixed(1)}%`);
    console.log(`  사용자 판단: **관리 빼고는 우리가 제일 못하다** -> 품질비(경쟁÷자사) ≥ 1`);
    console.log(`\n  품질비   90대 둘일 때   120대 둘일 때`);
    for (const rr of [0.581, 0.8, 1.0, 1.1, 1.3]) {
      console.log(`  ${rr.toFixed(3).padStart(6)}${(dropAt(rr, 90) * 100).toFixed(1).padStart(13)}%`
        + `${(dropAt(rr, 120) * 100).toFixed(1).padStart(15)}%`
        + (rr === 0.581 ? "   ← (8)번이 쓴 값(조사 표본 평균)" : rr === 1.0 ? "   ← 품질이 같다면" : ""));
    }

    // ── 관측을 내려면 실효 경쟁량이 얼마여야 하나 — 품질·θ를 통째로 건너뛰고 역산 ──
    // 점유율 = 자사PC ÷ (자사PC + 실효경쟁량).  관측 배율 = 뒤/앞 이므로 거기서 푼다.
    const shareBefore = computeTextbook(inp, P).share ?? 1;
    const wanted = shareBefore * Math.exp(OBS);          // 관측이 말하는 뒤쪽 점유율
    const effW = wanted > 0 ? pc * (1 / wanted - 1) : NaN; // 그걸 내는 분모 속 경쟁량
    // 지금 이미 들어가 있는 경쟁량(2km 넷)을 빼면 새 둘의 몫이 나온다
    let curW = 0;
    for (const rv of inp.rivals ?? []) {
      if (!(rv.ip > 0)) continue;
      const dw = rivalDistanceWeight(rv.distanceM, P);
      if (dw > 0) curW += rv.ip * dw;
    }
    const addW = effW - curW;
    console.log(`\n  [역산] 품질·θ를 건너뛰고 **실효 경쟁량**만 푼다`);
    console.log(`    자사 PC ${pc}대 · 유입 전 점유율 ${(shareBefore * 100).toFixed(1)}%`);
    console.log(`    관측대로면 유입 후 점유율 ${(wanted * 100).toFixed(1)}%`);
    console.log(`    -> 분모에 필요한 총 경쟁량 ${effW.toFixed(0)}대 · 기존 ${curW.toFixed(0)}대`);
    console.log(`    -> **새 둘이 합쳐서 ${addW.toFixed(0)}대 값어치**로만 들어간다`);
    for (const ip of [60, 90, 120]) {
      console.log(`       실제 각 ${ip}대라면(합 ${ip * 2}대) 분모엔 **${(addW / (ip * 2) * 100).toFixed(0)}%**만 들어간 셈`);
    }
    console.log(`\n  ⭐⭐ 읽는 법 — 여기서 갈린다`);
    console.log(`     · 품질비 0.581을 쓰면 관측과 맞는다. 그런데 그 값은 **"경쟁점이 우리보다`);
    console.log(`       한참 못하다"**는 뜻이라 현장 판단과 **정반대**다`);
    console.log(`     · 현장 판단대로 품질비 ≥ 1을 넣으면 산식은 관측의 **두 배 넘게** 떨어뜨린다`);
    console.log(`     · 즉 (8)에서 숫자가 맞은 건 **오차 둘이 상쇄된 것**일 수 있다:`);
    console.log(`       품질비를 후하게 잡은 오차 × 가까운 경쟁점이 생각보다 덜 뺏어가는 현실`);
    console.log(`\n  ⚠️ 이건 θ를 바꿔서 못 고친다 — 품질비가 1 이상이면 어떤 θ를 써도 경쟁량이`);
    console.log(`     PC 대수보다 **커지지** 작아지지 않는다. 고칠 자리는 θ가 아니라 **점유율 식 자체**다.`);
    expect(before).toBeGreaterThan(0);
  });

  it("(4) 가까운 경쟁점만 — 감쇠가 맞는지 거리로 갈라 본다", () => {
    const bands: [string, number, number][] = [["0~500m", 0, 500], ["500~1000m", 500, 1000], ["1km 밖", 1000, 1e9]];
    console.log(`\n[거리별] 가까울수록 효과가 커야 한다 — 감쇠 곡선이 맞나`);
    console.log(`  거리띠        사건수   이중차분(경쟁 세짐 기준)   2SE      산식 예측`);
    for (const [label, a, b] of bands) {
      const xs = used.filter((x) => x.distanceM >= a && x.distanceM < b);
      if (!xs.length) { console.log(`  ${label.padEnd(12)}${String(0).padStart(6)}건`); continue; }
      const obs = xs.map((x) => (x.kind === "open" ? x.did : -x.did));
      const prd = xs.filter((x) => x.predD != null).map((x) => (x.kind === "open" ? x.predD! : -x.predD!));
      const se = xs.length >= 2 ? sdSample(obs) / Math.sqrt(obs.length) : NaN;
      console.log(`  ${label.padEnd(12)}${String(xs.length).padStart(6)}건`
        + `${(mean(obs) * 100).toFixed(2).padStart(20)}%`
        + `${(2 * se * 100).toFixed(2).padStart(9)}%`
        + `${prd.length ? `${(mean(prd) * 100).toFixed(2).padStart(11)}%` : "         —"}`);
    }
    console.log(`\n  ⚠️ 띠마다 사건이 몇 건뿐이라 **판정이 아니라 눈으로 보는 것**이다.`);
    expect(used.length).toBeGreaterThanOrEqual(0);
  });
});
