import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ adminDb: null }));
import { listRanges, maskIps } from "./mcpPingMonitor";

describe("공유 읽기에서 IP 가리기", () => {
  it("단일 IP·대역·여러 개를 가린다", () => {
    expect(maskIps("우리 매장 · 화면 등록 2026-10-28 1.2.3.1~110 손님 PC")).toBe("우리 매장 · 화면 등록 2026-10-28 (IP 가림) 손님 PC");
    expect(maskIps("10.0.0.1-10.0.0.50, 8.8.8.8")).toBe("(IP 가림), (IP 가림)");
    expect(maskIps("대수 120대, 2026-11-15")).toBe("대수 120대, 2026-11-15");
  });
});

describe("목록 기간 — 웹 useRanges와 같다", () => {
  it("2026-11-15(일) 낮", () => {
    const R = listRanges(new Date("2026-11-15T03:00:00Z"));
    expect(R.today).toBe("2026-11-15");
    expect(R.yesterday).toBe("2026-11-14");
    expect(R.thisWeek.from).toBe("2026-11-09");
    expect(R.thisWeek.daysSoFar).toBe(6);
    expect(R.lastWeek).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(R.prevMonth).toMatchObject({ from: "2026-10-01", to: "2026-10-31", days: 31, label: "10월" });
    expect(R.thisMonth).toMatchObject({ from: "2026-11-01", to: "2026-11-14", daysSoFar: 14, label: "11월" });
  });
});
