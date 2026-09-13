import { describe, expect, it } from "vitest";
import { validateCandidateInput, validateCompetitorInput } from "./inputValidation";
import type { CandidateInput, Competitor } from "./types";

const candidate = { name: "후보지", address: "서울", expectedPcCount: 100, hourlyRate: 1500 } as CandidateInput;
const competitor = { name: "경쟁점" } as Competitor;

describe("입력값 검증", () => {
  it("필수 입력의 공란과 0을 각각 설명한다", () => {
    expect(validateCandidateInput({ ...candidate, expectedPcCount: null })).toContain("예상PC대수를 입력해주세요.");
    expect(validateCandidateInput({ ...candidate, expectedPcCount: 0 })).toContain("예상PC대수는 1대 이상이어야 합니다.");
  });
  it("대수와 월에는 소수를 허용하지 않고 면적에는 허용한다", () => {
    expect(validateCandidateInput({ ...candidate, expectedPcCount: 100.5, plannedOpenMonth: 1.5 })).toHaveLength(2);
    expect(validateCandidateInput({ ...candidate, area1kmKm2: 3.14 })).toEqual([]);
  });
  it.each([NaN, Infinity, -Infinity])("비정상 숫자 %s가 null로 바뀌어 저장되는 것을 막는다", (value) => {
    expect(validateCandidateInput({ ...candidate, pop1km: value }).length).toBeGreaterThan(0);
    expect(validateCompetitorInput({ ...competitor, totalPcCount: value }).length).toBeGreaterThan(0);
  });
  it("지하층 음수 표기와 레거시 비율/퍼센트·커플존 단위는 유지한다", () => {
    expect(validateCandidateInput({ ...candidate, floor: -1 })).toEqual([]);
    expect(validateCompetitorInput({ ...competitor, floor: -1, coupleZone: 4.5, measuredSeatRate: 0.5, pingbotUtilization: 50 })).toEqual([]);
  });
  it("추가 좌석수 필드의 음수도 검증한다", () => {
    expect(validateCandidateInput({ ...candidate, ownTeamRoomTotalSeats: -1 })).toContain("팀룸 총좌석수는 음수가 될 수 없습니다.");
    expect(validateCompetitorInput({ ...competitor, regularCoupleSeatCount: -1 })).toContain("좌석수는 음수가 될 수 없습니다.");
  });
});
