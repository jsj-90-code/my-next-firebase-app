// 2026-09-21 밤(3) — 건별 매출원장으로 **1인당 이용시간을 실측**한다. 읽기전용.
// 본체/운영/Firestore 미변경. 계수를 고르지 않는다.
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 산식의 축척 hoursPerUserPerMonth(약 8.39h)는 독점매장 가동률에서 **역산**한 값이다.
// 사용자 지적(2026-09-21): *"이거는 가맹점 로그 데이터있으니까 그걸로 잡는게 실측가능한
// 값아닌가"* — 맞다. 원장에 ID와 사용시간이 있어 직접 잴 수 있다.
//
// 이게 중요한 이유: 지금 축척 하나에 두 가지가 뭉쳐 있다.
//   (가) 한 사람이 한 달에 몇 시간 쓰나        ← 원장으로 **실측 가능**
//   (나) 수요 추정이 몇 배 틀렸나(이용률표·반경) ← 못 잰다
// (가)를 실측으로 못 박으면 남는 어긋남이 곧 (나)다. 수요식 검증 경로가 열린다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 원장은 저장소 밖(바탕화면)에 있다. 없으면 **skip**한다 — 조용히 통과시키지 않는다.
// 2. 1인당 월 이용시간 = (회원 이용시간 ÷ 고유 회원수) × 30÷실제일수. **달마다 따로** 잰다.
// 3. 비회원은 번호를 100개쯤 돌려쓴다(고유ID가 어느 파일이나 98~100) → 인원 세기에서 제외.
//    시간 비중이 2~9%라 회원만 봐도 대표성이 있다. 그 비중도 함께 출력한다.
// 4. **관문**: 원장 총시간 ÷ (PC×720)이 그 달 가동률 필드와 맞아야 한다. 15% 넘게
//    어긋나면 실패로 센다. 이 관문이 아래 함정 셋을 전부 잡아 준다.
// 5. 판정은 **오픈 1년 안(개점 1~12개월)** 자료로만 한다 — 산식이 맞히려는 값이 평가창이고,
//    1인당 시간이 개점 경과와 함께 늘기 때문이다(단골 축적).
//
// ── 밟은 함정 (전부 관문이 잡았다) ────────────────────────────────────────
//   합계행   전표번호 0·ID 빈칸·사용시간 빈칸
//   월없는날짜 "31일 22:55"뿐이라 1개월치를 2개월로 셌다 → 가동률이 정확히 절반이 됐다
//   인코딩   처음 받은 다섯은 UTF-8 BOM · 나중에 재내보낸 셋은 CP949
//   열구성   나중 것엔 "회원마케팅 쿠폰 시간"이 끼어 있다 → 열은 **이름으로** 찾는다
//   연도섞임 폴더 이름은 "7월"인데 광주첨단점은 2026-08치다(개점이 2026-07-17)
//   부분월   문산점은 2~28일치(27일)뿐 → 일수로 나누고 30일로 환산
//   누적분모 3개월치를 한 번에 세면 고유회원이 부풀려져 1인당이 과소(발산역 3.27→6.95h)
//
// 실행: npx vitest run src/lib/storeEval/_ledgerPerUser.test.ts --disable-console-intercept
//
// ── 첫 측정 (2026-09-21, 원장 8곳) ────────────────────────────────────────
// 관문 8/8 통과(최대 어긋남 4.6%).
// 오픈 1년 안 4곳: 광주첨단 8.58 · 문산 9.39 · 증평 7.88 · 발산역 6.95 → **평균 8.20h**
// 1년 초과 4곳: 청주대 13.00 · 양주덕정 11.41 · 청주지웰 12.01 · 청주터미널 9.90 → 평균 11.58h
//   → 같은 경쟁 환경인데 1.41배 차이. **단골 축적**으로 보인다(개월차와 r≈0.68).
// ⭐ 산식 8.3854 vs 오픈 1년 실측 8.20 → **차이 2.2%. 축척은 지금 값이 맞다.**
//   (앞서 "실측이 1.2배 크다"고 본 건 21~23개월차를 섞은 착시였다.)
// 1년 안에서는 1인당 시간 퍼짐이 6.95~9.39(1.35배)로 좁아, 평균으로 뭉개도
// 가동률 어긋남이 작다. → **1인당 시간은 분별력 문제의 범인이 아니다.**
import { existsSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { findLedgerDir, isGuest, sameStore, readLedgerFile, ledgerMonths } from "./_ledgerRead";
import type { ExistingStore, ExistingStoreMonthlySales } from "./types";

/**
 * 원장 읽기는 `_ledgerRead.ts`에 있다(2026-09-22 분리). 원장을 읽는 하네스가 둘이 되면서
 * 파서가 둘이 될 참이었다 — 읽는 자리는 하나로 둔다.
 * 폴더도 거기서 찾는다. 회사 PC 경로 하나만 박혀 있어서 집에서는 **조용히 skip**됐다.
 */
const DIR = findLedgerDir();
/** 파일명에 매장명이 들어 있어야 매칭된다. 기준월은 관문이 검사한다. */
const MONTHS_OF: Record<string, string[]> = {
  광주첨단점: ["2026-08"],                                  // 개점 2026-07-17
  발산역점: ["2026-06", "2026-07", "2026-08"],              // "3개월" 파일
  문산점: ["2026-07"],                                      // 개점 첫 달(2~28일치)
};
const DEFAULT_MONTHS = ["2025-07"];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;
// 파서·달경계·비회원 판정·폴더 찾기는 전부 `_ledgerRead.ts`로 옮겼다(2026-09-22).
// 원장을 읽는 하네스가 둘이 되면서 파서가 둘이 될 참이었다 — 읽는 자리는 하나로 둔다.
it.skipIf(!DIR)("원장으로 1인당 이용시간을 실측한다", async () => {
  expect(hasValidationSnapshot(), "최신 validation-snapshot.json 필요").toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const stores: ExistingStore[] = snap.existingStores;
  const sales: ExistingStoreMonthlySales[] = snap.sales ?? [];

  // 같은 매장이 csv·xls·xlsx로 중복돼 있다 — csv를 먼저 쓰고, 없을 때만 xlsx를 쓴다
  // (구형 .xls는 OLE 형식이라 exceljs가 못 읽는다).
  const all = readdirSync(DIR!).filter((f) => /\.(csv|xlsx)$/.test(f) && !f.includes("상품"));
  const files = all.filter((f) => f.endsWith(".csv")
    || !all.some((g) => g.endsWith(".csv") && sameStore(g, f, stores)));
  expect(files.length, "원장 파일이 하나도 없다").toBeGreaterThan(0);

  const rows = await Promise.all(files.sort().map(async (file) => {
    const name = stores.map((s) => s.storeName).find((n) => file.includes(n));
    if (!name) return { file, 결과: "매장명을 파일명에서 못 찾음" as const };
    const store = stores.find((s) => s.storeName === name)!;
    const pc = store.pcCount ?? null;

    const { recs, days } = await readLedgerFile(`${DIR}/${file}`);
    expect(recs.length, `${file}: 읽힌 건이 없다`).toBeGreaterThan(100);

    // 달마다 따로 — 누적 분모를 쓰면 1인당이 과소된다. 일수로 나누고 30일로 환산한다.
    // 그 집계는 `_ledgerRead.ts`의 ledgerMonths에 있다(두 하네스가 같은 함수를 쓴다).
    const perMonth = ledgerMonths(recs, days);
    expect(perMonth.every((m) => m.uniq > 0), `${file}: 고유 회원 0`).toBe(true);

    const totalH = sum(recs.map((r) => r.min)) / 60;
    const daysCovered = sum(perMonth.map((m) => m.nDays));
    const monthlyH = totalH / daysCovered * 30;
    const hPerUser = mean(perMonth.map((m) => m.per));

    // ── 관문: 원장이 가동률 필드와 맞는가 ──
    const yms = MONTHS_OF[name] ?? DEFAULT_MONTHS;
    const fieldList = yms.map((ym) => sales.find((s) => s.storeCode === store.storeCode
      && s.yearMonth === ym)?.utilizationRate ?? null).filter((v): v is number => v != null);
    const field = fieldList.length ? mean(fieldList) : null;
    const ledgerRate = pc ? monthlyH / (pc * 720) : null;
    const gap = ledgerRate != null && field ? ledgerRate / field - 1 : null;

    // 개점 몇 개월차인가 — 오픈 1년 안이라야 판정에 쓴다.
    const window = evaluationMonths(store.openedAt);
    const age = (() => {
      if (!store.openedAt) return null;
      const o = new Date(store.openedAt);
      const [y, m] = yms[0].split("-").map(Number);
      return (y - o.getFullYear()) * 12 + (m - (o.getMonth() + 1));
    })();

    return { file, 매장: name, PC: pc, 개점: store.openedAt, 기준월: yms.join("+"),
      개월수: perMonth.length, 관측일수: daysCovered, 개월차: age,
      // 0 = 개점한 그 달. 평가창은 1~12개월이지만, 축척을 맞대는 데는 개점 달도 쓴다
      // (문산점이 그 경우다). 대신 개월차를 함께 찍어 어느 시점인지 보이게 한다.
      오픈1년안: age != null && age >= 0 && age <= 12,
      "관문_원장%": ledgerRate == null ? null : +(ledgerRate * 100).toFixed(2),
      "관문_필드%": field == null ? null : +(field * 100).toFixed(2),
      "관문_어긋남%": gap == null ? null : +(gap * 100).toFixed(1),
      회원고유: Math.round(mean(perMonth.map((m) => m.uniq))),
      "비회원시간%": +(sum(recs.filter((r) => isGuest(r.id)).map((r) => r.min)) / 60 / totalH * 100).toFixed(1),
      "1인당월시간": +hPerUser.toFixed(2),
      평가창월수: window.length };
  }));

  const ok = rows.filter((r): r is Extract<typeof r, { 매장: string }> => "매장" in r);
  const skipped = rows.filter((r) => !("매장" in r));
  console.log("[재현]", JSON.stringify({ snapshot: snap.fetchedAt, 파일수: files.length,
    읽음: ok.length, 건너뜀: skipped }));
  console.log("[매장별]", JSON.stringify(ok));

  // 관문 — 하나라도 비거나 크게 어긋나면 그 자료는 못 믿는다.
  const failed = ok.filter((r) => r["관문_어긋남%"] == null || Math.abs(r["관문_어긋남%"]) > 15);
  console.log("[관문]", JSON.stringify({ 통과: ok.length - failed.length,
    실패: failed.map((r) => `${r.매장}(${r["관문_어긋남%"]}%)`),
    최대어긋남: Math.max(...ok.filter((r) => r["관문_어긋남%"] != null).map((r) => Math.abs(r["관문_어긋남%"]!))) }));
  expect(failed.length, `관문 실패: ${failed.map((r) => r.매장).join(",")}`).toBe(0);

  // ── 판정은 오픈 1년 안으로만 ──
  const fresh = ok.filter((r) => r.오픈1년안), aged = ok.filter((r) => !r.오픈1년안);
  const h = (xs: typeof ok) => xs.map((r) => r["1인당월시간"]);
  console.log("[⭐ 오픈 1년 안 — 산식 축척과 맞대는 값]", JSON.stringify({
    n: fresh.length, 매장: fresh.map((r) => `${r.매장}(${r.개월차}개월)`), 목록: h(fresh),
    평균: fresh.length ? +mean(h(fresh)).toFixed(2) : null,
    "최대÷최소": fresh.length ? +(Math.max(...h(fresh)) / Math.min(...h(fresh))).toFixed(2) : null }));
  console.log("[1년 초과 — 단골 축적 탓에 길다. 축척 판정에 쓰지 말 것]", JSON.stringify({
    n: aged.length, 매장: aged.map((r) => `${r.매장}(${r.개월차}개월)`), 목록: h(aged),
    평균: aged.length ? +mean(h(aged)).toFixed(2) : null }));
  if (fresh.length && aged.length) {
    console.log("[두 구간 비교]", JSON.stringify({
      "1년초과÷1년안": +(mean(h(aged)) / mean(h(fresh))).toFixed(3) }));
  }
});
