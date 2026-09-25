// 원장으로 1회 체류시간(전표당 사용시간)을 재고, 산식 시간당 총단가와 곱해 "객단가"가 얼마로 함의되나 (2026-09-25). 읽기전용.
// 사용자: "그럼 지금 신규 후보지는 대충 객단가 1만원 정도 되나?"
// 산식이 내는 건 시간당 단가(PC몫 + 상품몫)라, 객단가 = 시간당 총단가 × 1회 체류시간. 체류시간은 원장 전표별 사용시간으로 잰다.
// ⚠️ 전표 = 1회 이용으로 본다(같은 사람이 하루 두 번 오면 2회). 비회원 전표도 센다(체류시간은 회원·비회원 따로도 찍는다).
// 실행: npx vitest run src/lib/storeEval/_ledgerVisit.test.ts --disable-console-intercept

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findLedgerDir, isGuest, sameStore, readLedgerFile } from "./_ledgerRead";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { DEFAULT_TEXTBOOK_PARAMS } from "./textbookModel";

const DIR = findLedgerDir();
const describeIf = DIR && hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("원장 — 1회 체류시간과 함의 객단가", () => {
  it("매장별 전표당 사용시간 · 시간당 총단가 · 객단가", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const stores = (snap.existingStores as { storeName: string; hourlyRate?: number | null; openedAt?: string | null }[]);
    const all = readdirSync(DIR!).filter((f) => /\.(csv|xlsx)$/.test(f) && !f.includes("상품"));
    const files = all.filter((f) => f.endsWith(".csv") || !all.some((g) => g.endsWith(".csv") && sameStore(g, f, stores)));
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const pcUnit = (rate: number) => P.referenceHourlyRate * Math.pow(rate / P.referenceHourlyRate, P.rateElasticity);
    console.log(`\n[원장 ${files.length}곳] 객단가 = (PC몫(정가) + 상품몫 ${P.productUnitPrice}) × 전표당 사용시간. 전표 = 1회 이용`);
    console.log(`  ${pad("매장", 10)} ${"정가".padStart(6)} ${"전표".padStart(7)} ${"평균h".padStart(6)} ${"중앙h".padStart(6)} ${"회원h".padStart(6)} ${"비회원h".padStart(7)} | ${"시간당".padStart(6)} ${"객단가(평균)".padStart(10)} ${"객단가(중앙)".padStart(10)}`);
    const rows: { name: string; avgH: number; medH: number; unit: number }[] = [];
    for (const file of files.sort()) {
      const name = stores.map((s) => s.storeName).find((n) => file.includes(n)); if (!name) continue;
      const store = stores.find((s) => s.storeName === name)!;
      const { recs } = await readLedgerFile(`${DIR}/${file}`);
      const hs = recs.map((r) => r.min / 60).filter((h) => h > 0 && h < 48);
      const memberH = recs.filter((r) => !isGuest(r.id)).map((r) => r.min / 60).filter((h) => h > 0 && h < 48);
      const guestH = recs.filter((r) => isGuest(r.id)).map((r) => r.min / 60).filter((h) => h > 0 && h < 48);
      const rate = store.hourlyRate ?? P.referenceHourlyRate;
      const unit = pcUnit(rate) + P.productUnitPrice;
      rows.push({ name, avgH: mean(hs), medH: median(hs), unit });
      console.log(`  ${pad(name, 10)} ${String(rate).padStart(6)} ${String(hs.length).padStart(7)} ${mean(hs).toFixed(2).padStart(6)} ${median(hs).toFixed(2).padStart(6)} ${(memberH.length ? mean(memberH) : NaN).toFixed(2).padStart(6)} ${(guestH.length ? mean(guestH) : NaN).toFixed(2).padStart(7)} | ${Math.round(unit).toLocaleString().padStart(6)} ${Math.round(unit * mean(hs)).toLocaleString().padStart(10)} ${Math.round(unit * median(hs)).toLocaleString().padStart(10)}`);
    }
    const avgH = mean(rows.map((r) => r.avgH)), medH = mean(rows.map((r) => r.medH));
    console.log(`  8곳 평균: 전표당 평균 ${avgH.toFixed(2)}h · 중앙 ${medH.toFixed(2)}h`);
    for (const rate of [1000, 1200, 1500, 1800]) {
      const unit = pcUnit(rate) + P.productUnitPrice;
      console.log(`  후보지 정가 ${rate.toLocaleString()}원 → 시간당 ${Math.round(unit).toLocaleString()}원 → 객단가 평균 체류 ${Math.round(unit * avgH).toLocaleString()}원 · 중앙 체류 ${Math.round(unit * medH).toLocaleString()}원`);
    }
    console.log(`  ⭐ 읽는 법 — 시간당 총단가는 산식 값(상품몫은 최신 규칙 1,721)이고 체류시간은 원장 실측이다. 매장별 실제 객단가는 원장 금액 열이 없어 못 잰다 — 이건 산식이 "함의"하는 객단가.`);
    expect(rows.length).toBeGreaterThan(5);
  });
});
