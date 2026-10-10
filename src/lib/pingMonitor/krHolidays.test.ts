import { expect, it } from "vitest";
import { KR_HOLIDAY_LAST_YEAR, isKrHoliday } from "./krHolidays";

it("대체공휴일·선거일까지 들어 있다", () => {
  expect(isKrHoliday("2026-10-05")).toBe(true); // 개천절 대체
  expect(isKrHoliday("2026-06-03")).toBe(true); // 지방선거
  expect(isKrHoliday("2026-10-08")).toBe(false);
});

// 공휴일 목록이 끝나기 1년 전부터 빨간불 — Google 대한민국 공휴일 달력에서 다음 해를 받아 krHolidays.ts에 이어 붙일 때다.
it("공휴일 목록이 올해 다음 해까지 있다", () => {
  expect(KR_HOLIDAY_LAST_YEAR).toBeGreaterThanOrEqual(new Date().getFullYear() + 1);
});
