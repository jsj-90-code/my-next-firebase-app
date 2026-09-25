// 원장으로 유료게임 과금·좌석 과금이 시간당 얼마나 붙는지 실측한다 (2026-09-25 저녁). 읽기전용.
// 사용자: "유료과금은 PC에서 게임 켜면 추가과금되는 거라 거의 기본요금에 추가 적용된다고 보면 된다, 대부분 이용자가."
// → 맞다면 Σ유료금액 ÷ Σ사용시간 ≈ 과금 단가(발산역 100 · 문산 300원/h)이고, 유료금액 > 0인 전표 비중이 높아야 한다.
//   그러면 산식 PC몫 입력을 "정가 + 유료과금"으로 두는 건 계수가 아니라 자료다.
// 열은 이름으로 찾는다: 사용시간 · 사용금액 · 유료금액 · 좌석금액 · 상품금액. CSV만(구형 xls는 못 읽음). 인코딩: UTF-8 BOM 또는 CP949.
// 실행: npx vitest run src/lib/storeEval/_ledgerSurcharge.test.ts --disable-console-intercept

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findLedgerDir, parseLedgerMinutes } from "./_ledgerRead";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import tariff from "./data/tariffTables.json";

const DIR = findLedgerDir();
const describeIf = DIR && hasValidationSnapshot() ? describe : describe.skip;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

function decode(path: string): string {
  const buf = readFileSync(path);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8");
  const utf = buf.toString("utf8");
  if (utf.includes("전표번호")) return utf;
  return new TextDecoder("euc-kr").decode(buf);
}
function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur); return out;
}
const num = (s: unknown) => { const n = Number(String(s ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };

describeIf("원장 — 유료게임·좌석 과금 실측", () => {
  it("매장별 시간당 유료과금·좌석과금, 유료 전표 비중, 원장 PC 실효단가 vs 정가", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const stores = snap.existingStores as { storeCode: string; storeName: string; hourlyRate?: number | null }[];
    const sur = (tariff as { surcharges: Record<string, { name: string; paidGame: number | null; seatNote?: string }> }).surcharges;
    const files = readdirSync(DIR!).filter((f) => f.endsWith(".csv") && !f.includes("상품"));
    console.log(`\n[원장 유료·좌석 과금] 시간당 = Σ금액 ÷ Σ사용시간. "유료 전표%" = 유료금액 > 0인 전표 비중(사용시간 > 0인 전표 중)`);
    console.log(`  ${pad("매장", 10)} ${"정가".padStart(5)} ${"과금표".padStart(6)} ${"전표".padStart(6)} | ${"PC단가(원장)".padStart(11)} ${"실효÷정가".padStart(8)} | ${"유료/h".padStart(6)} ${"유료전표%".padStart(8)} ${"유료전표만/h".padStart(11)} | ${"좌석/h".padStart(6)} ${"좌석전표%".padStart(8)} | ${"상품/h".padStart(6)}`);
    let n = 0;
    for (const file of files.sort()) {
      const store = stores.find((s) => file.includes(s.storeName)); if (!store) continue;
      const lines = decode(`${DIR}/${file}`).split(/\r?\n/).filter((l) => l.trim());
      const head = splitCsv(lines[0]).map((s) => s.trim());
      const c = (name: string) => head.indexOf(name);
      const cUse = c("사용시간"), cAmt = c("사용금액"), cPaid = c("유료금액"), cSeat = c("좌석금액"), cProd = c("상품금액");
      if (cUse < 0 || cAmt < 0) { console.log(`  ${file}: 열을 못 찾음 (${head.slice(0, 10).join(",")})`); continue; }
      let hours = 0, amt = 0, paid = 0, seat = 0, prod = 0, cnt = 0, paidCnt = 0, seatCnt = 0, paidHours = 0;
      for (const line of lines.slice(1)) {
        const f = splitCsv(line); const min = parseLedgerMinutes(f[cUse]); if (min == null || !(min > 0)) continue;
        const h = min / 60; hours += h; cnt++;
        amt += num(f[cAmt]); const p = cPaid >= 0 ? num(f[cPaid]) : 0; const s = cSeat >= 0 ? num(f[cSeat]) : 0; prod += cProd >= 0 ? num(f[cProd]) : 0;
        paid += p; seat += s; if (p > 0) { paidCnt++; paidHours += h; } if (s > 0) seatCnt++;
      }
      if (!(hours > 0)) continue;
      const g = sur[store.storeCode]; const rate = store.hourlyRate ?? null;
      console.log(`  ${pad(store.storeName, 10)} ${String(rate ?? "-").padStart(5)} ${String(g?.paidGame ?? "?").padStart(6)} ${String(cnt).padStart(6)} | ${Math.round(amt / hours).toLocaleString().padStart(11)} ${(rate ? (100 * amt / hours / rate).toFixed(0) + "%" : "-").padStart(8)} | ${Math.round(paid / hours).toString().padStart(6)} ${(100 * paidCnt / cnt).toFixed(0).padStart(7)}% ${(paidHours > 0 ? Math.round(paid / paidHours) : 0).toString().padStart(11)} | ${Math.round(seat / hours).toString().padStart(6)} ${(100 * seatCnt / cnt).toFixed(0).padStart(7)}% | ${Math.round(prod / hours).toString().padStart(6)}`);
      n++;
    }
    console.log(`  ⭐ 읽는 법 — "유료/h"가 과금표 단가에 가깝고 "유료전표%"가 높으면 사용자 말대로 거의 전원이 낸다 → PC몫 입력 = 정가 + 유료과금(자료). "유료전표만/h"는 낸 사람 기준 시간당.`);
    console.log(`     "PC단가(원장)"은 원장 사용금액 기준 실효단가 — 매출DB pcSales로 잰 값과 대보면 pcSales 정의(상품권 포함?)도 검산된다. 상품/h는 원장 상품금액(PC 전표에 묶인 것만).`);
    expect(n).toBeGreaterThan(3);
  });
});
