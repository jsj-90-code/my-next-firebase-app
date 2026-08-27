import { describe, expect, it } from "vitest";
import { parseCompetitorNotes } from "./competitorNoteParse";

// 2026-08-27: 사용자가 실제로 붙여넣는 "경쟁점 설명" 원문 그대로 픽스처로 씀(점포개발자 4곳 조사분).
const REAL_PASTE = `경쟁점 설명
26.03.23

- 매장명 : 레드포스pc아레나 삼산점

- 전체 대수 : 158대

- 일반석 134대
1. CPU : 14400
2. VGA : 4060
3. RAM : 16G
4. 모니터 : 평면32인치 240Hz

- 프리미엄석 없음

- 커플석 없음

-1인석 없음

- 팀룸 4인1개 5인4개

- 매장 현황
1. 방문 일시 고객수 : 26년 3월23일 오전 11시30분 9명 이용중
2. 인테리어 수준 : 중
3. 매장 관리 상태 (청결, 친절 등) : 중
4. 먹거리 브랜드 : 비바쿡 +농심
5. 1,000원 시간 : 1000원 40분
6. 유료차감 : 없음

종합 평가
방문시 여알바1명 근무
팀룸 외에는 특별한것 하나도 없음
음식종류 매우 많으며 수준도 괜찮음
여느 레드포스와 같음

26.03.23

- 매장명 : 피에스타스토리

- 전체 대수 : 101대

- 일반석 40대
1. CPU : 13400
2. VGA : 5060
3. RAM : 16G
4. 모니터 : 평면32인치 240Hz

- 프리미엄석 없음

- 커플석 10개

-1인석 11석 , 3인석1개

- 팀룸 5인3개

- 매장 현황
1. 방문 일시 고객수 : 26년 3월23일 오후 12시40분 8명 이용중
2. 인테리어 수준 : 중하
3. 매장 관리 상태 (청결, 친절 등) : 중
4. 먹거리 브랜드 : 비바쿡
5. 1,000원 시간 : 1000원 40분
6. 유료차감 : 없음

종합 평가
방문시 할머니 1명이 근무
좌석에서 선불기 충전하러 가는게 매우 불편함
동선이 굉장히 불편하게 되어있음
팀룸 문 잠궈둠
먹거리 다른 경쟁점과 비슷한 수준
인근 경쟁점 모두 비바쿡(레드포스,탑스타)
오픈한지 얼마 안된것 같으나 경쟁력 전혀 없음

26.03.23

- 매장명 : 탑스타pc방

- 전체 대수 : 101대

- 일반석 101대
1. CPU : 12400
2. VGA : 5060
3. RAM : 32G
4. 모니터 : 인피니32인치 240Hz

- 프리미엄석 없음

- 커플석 없음

-1인석 없음

- 팀룸 없음

- 매장 현황
1. 방문 일시 고객수 : 26년 3월23일 오후 12시15분 10명 이용중
2. 인테리어 수준 : 하
3. 매장 관리 상태 (청결, 친절 등) : 중
4. 먹거리 브랜드 : 비바쿡
5. 1,000원 시간 : 1000원 40분
6. 유료차감 : 없음

종합 평가
방문시 여1명 근무
먹거리 종류 어느정도 있으며 수준은 중 정도
전혀 특색없음
경쟁력 약함

26.03.23

- 매장명 : 레벨업 삼산점

- 전체 대수 : 101대

- 일반석 72대
1. CPU : 14400
2. VGA : 5060
3. RAM : 32G
4. 모니터 : 큐닉스32인치 240Hz

- 프리미엄석 없음

- 커플석 11개22석

-1인석 없음

- 팀룸 4인2개 5인2개

- 매장 현황
1. 방문 일시 고객수 : 26년 3월11일 오후 16시40분 79명 이용중
2. 인테리어 수준 : 중상
3. 매장 관리 상태 (청결, 친절 등) : 중상
4. 먹거리 브랜드 : xoxo
5. 1,000원 시간 : 1000원 40분
6. 유료차감 : 없음

종합 평가 : 매장은 깔끔하게 운영하고 있으며 먹거리는 여느 레벌업과 같으며 특별한것 없음
입점시 블랙라벨이 월등함

26년7월29일 09시30분 방문
과거 조사와 바뀐것 없으며 방문시 고객 11명`;

describe("parseCompetitorNotes", () => {
  it("붙여넣은 텍스트에서 매장 4곳을 각각 분리해서 추출한다", () => {
    const entries = parseCompetitorNotes(REAL_PASTE);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.name)).toEqual(["레드포스pc아레나 삼산점", "피에스타스토리", "탑스타pc방", "레벨업 삼산점"]);
  });

  it("1번째 매장(레드포스pc아레나 삼산점) 필드를 정확히 추출한다", () => {
    const [e] = parseCompetitorNotes(REAL_PASTE);
    expect(e.totalPcCount).toBe(158);
    expect(e.cpu).toBe("14400");
    expect(e.vgaBase).toBe("4060");
    expect(e.ram).toBe("16G");
    expect(e.monitor).toBe("평면32인치 240Hz");
    expect(e.premiumZone).toBe(0);
    expect(e.coupleZone).toBe(0);
    expect(e.room1).toBe(0);
    expect(e.teamRoom).toBe(5); // 4인1개+5인4개
    expect(e.visitedAt).toBe("2026-03-23 11:30");
    expect(e.visitorCount).toBe(9);
    expect(e.ratePer1000Won).toBe(40);
    expect(e.paidDeduction).toBe("없음");
    expect(e.foodBasis).toBe("비바쿡 +농심");
    expect(e.interiorBasis).toContain("인테리어 수준: 중");
    expect(e.interiorBasis).toContain("관리상태: 중");
    expect(e.interiorBasis).toContain("여느 레드포스와 같음");
    expect(e.interiorBasis).not.toMatch(/\d{2}\.\d{2}\.\d{2}/); // 다음 블록 날짜줄이 안 섞여야 함
  });

  it("2번째 매장(피에스타스토리) - 커플석/1인석 개수, 오후 시각 변환을 정확히 추출한다", () => {
    const [, e] = parseCompetitorNotes(REAL_PASTE);
    expect(e.totalPcCount).toBe(101);
    expect(e.coupleZone).toBe(10);
    expect(e.room1).toBe(11); // "11석 , 3인석1개"에서 첫 숫자
    expect(e.teamRoom).toBe(3);
    expect(e.visitedAt).toBe("2026-03-23 12:40"); // 오후 12시40분 = 낮 12:40 (정오, +12 안 함)
    expect(e.visitorCount).toBe(8);
  });

  it("4번째 매장(레벨업 삼산점) - 24시간 표기(오후 16시)와 콜론 있는 종합평가, 재방문 메모까지 포함한다", () => {
    const entries = parseCompetitorNotes(REAL_PASTE);
    const e = entries[3];
    expect(e.coupleZone).toBe(11); // "11개22석"에서 개수
    expect(e.teamRoom).toBe(4); // 4인2개+5인2개
    expect(e.visitedAt).toBe("2026-03-11 16:40");
    expect(e.visitorCount).toBe(79);
    expect(e.interiorBasis).toContain("블랙라벨이 월등함");
    expect(e.interiorBasis).toContain("과거 조사와 바뀐것 없으며"); // 마지막 재방문 메모까지 보존
  });

  it("매장명이 없는 텍스트는 빈 배열을 반환한다", () => {
    expect(parseCompetitorNotes("아무 상관 없는 텍스트")).toEqual([]);
  });
});
