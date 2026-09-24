import { expect, it } from "vitest";
import { selectCandidates } from "./candidateList";
import type { CandidateInput } from "./types";

const candidates = [
  { code: "N10", name: "강남점", address: "서울 강남구", reviewStatus: "진행", updatedAt: 100 },
  { code: "N2", name: "수원점", address: "경기 수원시", reviewStatus: "완료", updatedAt: 300 },
  { code: "N3", name: "강남역점", address: "서울 서초구", reviewStatus: "보류", updatedAt: 200 },
] as CandidateInput[];

it("검색어를 이름·주소에 걸쳐 모두 찾고 상태 조건도 함께 적용한다", () => {
  expect(selectCandidates(candidates, " 서울  강남 ", "전체", "updated").map((c) => c.code)).toEqual(["N3", "N10"]);
  expect(selectCandidates(candidates, "서울 강남", "진행", "updated").map((c) => c.code)).toEqual(["N10"]);
  expect(selectCandidates(candidates, "서울", "완료", "updated")).toEqual([]);
});

it("전각 코드와 영문 대소문자를 정규화한다", () => {
  expect(selectCandidates(candidates, "ｎ１０", "전체", "code")[0]?.code).toBe("N10");
});

it("최근 수정순과 자연스러운 코드순을 지원하고 원본을 변경하지 않는다", () => {
  const order = candidates.map((c) => c.code);
  expect(selectCandidates(candidates, "", "전체", "updated").map((c) => c.code)).toEqual(["N2", "N3", "N10"]);
  // 2026-09-24 밤 — 코드순은 내림차순(높은 번호 위). 숫자 비교라 N10이 N2 위다.
  expect(selectCandidates(candidates, "", "전체", "code").map((c) => c.code)).toEqual(["N10", "N3", "N2"]);
  expect(candidates.map((c) => c.code)).toEqual(order);
});
