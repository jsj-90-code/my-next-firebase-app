import { describe, expect, it } from "vitest";
import { shouldAutoApplyChatDraft, type SeatLayoutChatDraft } from "./chatDraft";

const meta = (createdAt: number) => ({ createdAt, modelName: "m", userEmail: null, note: null });
const draft = (d: Partial<SeatLayoutChatDraft>): SeatLayoutChatDraft => ({ projectId: "p", projectName: "자동화 TEST", ...d });
const seatDraft = (at: number, final?: boolean) =>
  draft({ seatNumbers: { ...meta(at), rows: [{ zoneName: "LOL존A", ranges: "59~76" }], unsure: "", ...(final === undefined ? {} : { final }) } });
const base = { zoneCount: 13, seatNumberCount: 0, hasPlate: true, updatedAt: 1000 };
const OPENED = 5000; // 웹이 프로젝트를 연 시각 — 초안(2000)은 그 전에 와 있었다

describe("shouldAutoApplyChatDraft — 열기 전에 와 있던 좌석번호 초안(11-12 도면공유방 피난안내도)", () => {
  it("저장된 좌석번호 없음 + 피난안내도 있음 + final + 마지막 저장 뒤 → 넣는다", () => {
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(2000, true), base, OPENED)).toBe(true);
  });
  it("이미 좌석번호가 저장돼 있으면 안 넣는다(버튼으로만)", () => {
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(2000, true), { ...base, seatNumberCount: 3 }, OPENED)).toBe(false);
  });
  it("final이 아니거나(plateBox 다시 내라) 옛 초안(final 칸 없음)이면 안 넣는다", () => {
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(2000, false), base, OPENED)).toBe(false);
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(2000), base, OPENED)).toBe(false);
  });
  it("피난안내도가 없거나, 초안 뒤에 저장했으면(넣고 버림) 안 넣는다", () => {
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(2000, true), { ...base, hasPlate: false }, OPENED)).toBe(false);
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(2000, true), { ...base, updatedAt: 3000 }, OPENED)).toBe(false);
  });
  it("연 뒤에 온 좌석번호 초안은 예전처럼 넣는다(이미 번호가 있어도 — 사람이 채팅을 시킨 것)", () => {
    expect(shouldAutoApplyChatDraft("seatNumbers", seatDraft(6000), { ...base, seatNumberCount: 3 }, OPENED)).toBe(true);
  });
});

describe("shouldAutoApplyChatDraft — 존 초안(11-04 규칙 그대로)", () => {
  const zoneDraft = (at: number, final: boolean) => draft({ zones: { ...meta(at), rows: [], final } });
  it("존 0개면 열기 전 final 존 초안을 넣고, 존이 있으면 안 넣는다", () => {
    expect(shouldAutoApplyChatDraft("zones", zoneDraft(2000, true), { ...base, zoneCount: 0 }, OPENED)).toBe(true);
    expect(shouldAutoApplyChatDraft("zones", zoneDraft(2000, true), base, OPENED)).toBe(false);
  });
  it("final 아닌 존 초안은 연 뒤에 와도 안 넣는다", () => {
    expect(shouldAutoApplyChatDraft("zones", zoneDraft(6000, false), { ...base, zoneCount: 0 }, OPENED)).toBe(false);
  });
});
