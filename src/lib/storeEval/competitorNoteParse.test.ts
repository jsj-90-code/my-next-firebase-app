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

// 2026-08-27 (2차) — 사용자가 "이렇게 의견 주면 복붙 안 된다"며 준 두 번째 형식. 매장명 마커가
// "- 매장명 :"이 아니라 "■ 매장명:"이고, "스펙"/"좌석"/"종합평가" 소제목 아래 번호가 "1)" 식이며,
// 팀룸/커플석이 "40 (3인 1, 4인 8, 5인 1)"처럼 좌석합계+괄호 안 룸별 개수로 표기되고, 방문기록도
// "56명 (4시 30분)"처럼 날짜 없이 인원이 먼저 온다.
const REAL_PASTE_FORMAT2 = `■ 매장명: 스타일PC방 신중동점

- 전체 대수 : 194대

- 스펙
 1) CPU: i5 14세대
 2) VGA: 3070
 3) RAM : 32
 4) 모니터 : 32 lcd 240hz

- 좌석
 1) 프리미엄석: 없음
 2) 커플석: 36
 3) 1인석: 1
 4) 팀룸: 없음
 5) 나머지 전체 일반석

- 종합평가
 1) 방문일시 고객수: 56명 (4시 30분)
 2) 인테리어 수준: 중
 3) 매장 관리 상태 (청결, 친절 등): 중
 4) 먹거리 수준, 브랜드: 중
 5) 1,000 원 시간: 50분
 6) 유료차감: 있음

■ 매장명: 블록버스터PC방

- 전체 대수 : 230대

- 스펙
 1) CPU: i5 14세대
 2) VGA: 5060
 3) RAM : 32
 4) 모니터 : 32 lcd 240hz

- 좌석
 1) 프리미엄석: 없음
 2) 커플석: 24
 3) 1인석: 2
 4) 팀룸: 40 (3인 1, 4인 8, 5인 1)
 5) 나머지 전체 일반석

- 종합평가
 1) 방문일시 고객수: 92명 (6시 30분)
 2) 인테리어 수준: 중상
 3) 매장 관리 상태 (청결, 친절 등): 중
 4) 먹거리 수준, 브랜드: 중상
 5) 1,000 원 시간: 50분
 6) 유료차감: 있음

■ 매장명: 아즈텍PC방

- 전체 대수 : 130대

- 스펙
 1) CPU: i5 14세대
 2) VGA: 5060
 3) RAM : 32
 4) 모니터 : 32 lcd 240hz

- 좌석
 1) 프리미엄석: 없음
 2) 커플석: 43 (2인 11, 3인 7)
 3) 1인석: 1
 4) 팀룸: 20 (5인 4)
 5) 나머지 전체 일반석

- 종합평가
 1) 방문일시 고객수: 43명 (5시)
 2) 인테리어 수준: 중상
 3) 매장 관리 상태 (청결, 친절 등): 중
 4) 먹거리 수준, 브랜드: 중하
 5) 1,000 원 시간: 50분
 6) 유료차감: 있음`;

describe("parseCompetitorNotes — 2번째 원문 형식(■ 매장명 마커, 좌석 괄호표기, 신형식)", () => {
  it("■ 매장명 마커로 3곳을 각각 분리한다", () => {
    const entries = parseCompetitorNotes(REAL_PASTE_FORMAT2);
    expect(entries.map((e) => e.name)).toEqual(["스타일PC방 신중동점", "블록버스터PC방", "아즈텍PC방"]);
  });

  it("스타일PC방 신중동점 - 괄호 없는 단순 숫자, 날짜 없는 방문기록, '먹거리 수준, 브랜드' 라벨", () => {
    const [e] = parseCompetitorNotes(REAL_PASTE_FORMAT2);
    expect(e.totalPcCount).toBe(194);
    expect(e.cpu).toBe("i5 14세대");
    expect(e.vgaBase).toBe("3070");
    expect(e.coupleZone).toBe(36); // 괄호 breakdown 없음 -> 단순 숫자 그대로
    expect(e.room1).toBe(1);
    expect(e.teamRoom).toBe(0); // 없음
    expect(e.visitedAt).toBeNull(); // 날짜 정보 자체가 없어 지어내지 않음
    expect(e.visitorCount).toBe(56);
    expect(e.foodBasis).toBe("중"); // "먹거리 수준, 브랜드" 라벨도 매칭됨
    expect(e.ratePer1000Won).toBe(50); // "1,000 원 시간"(띄어쓰기)도 매칭됨
    expect(e.paidDeduction).toBe("있음");
    expect(e.interiorBasis).toContain("인테리어 수준: 중");
    expect(e.interiorBasis).toContain("관리상태: 중");
  });

  it("블록버스터PC방 - '40 (3인 1, 4인 8, 5인 1)'에서 좌석합계(40)가 아니라 룸 개수 합(10)을 뽑는다", () => {
    const entries = parseCompetitorNotes(REAL_PASTE_FORMAT2);
    const e = entries[1];
    expect(e.totalPcCount).toBe(230);
    expect(e.coupleZone).toBe(24);
    expect(e.room1).toBe(2);
    expect(e.teamRoom).toBe(10); // 1+8+1, 40이 아님
    expect(e.visitorCount).toBe(92);
    expect(e.foodBasis).toBe("중상");
  });

  it("아즈텍PC방 - 커플석도 '43 (2인 11, 3인 7)'에서 룸 개수 합(18)을 뽑는다, 분 없는 시각도 안전하게 처리", () => {
    const entries = parseCompetitorNotes(REAL_PASTE_FORMAT2);
    const e = entries[2];
    expect(e.totalPcCount).toBe(130);
    expect(e.coupleZone).toBe(18); // 11+7, 43이 아님
    expect(e.teamRoom).toBe(4); // 5인 4
    expect(e.visitorCount).toBe(43);
    expect(e.visitedAt).toBeNull();
    expect(e.foodBasis).toBe("중하");
  });

  it("전체 대수가 0이면(폐업/공실 등) null이 아니라 0을 그대로 남긴다 — falsy-zero 버그 재발 방지(2026-08-27)", () => {
    const entries = parseCompetitorNotes(`- 매장명 : 테스트매장\n\n- 전체 대수 : 0대`);
    expect(entries[0].totalPcCount).toBe(0);
  });
});
