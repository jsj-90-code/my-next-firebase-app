// 구글시트 → Firestore 적재의 첫 관문이다. 여기서 조용히 null이나 하루 밀린 날짜가 나오면
// 그 뒤 모든 계산이 틀린 값을 쓴다. 실제로 이 파일은 세 곳에 복붙돼 있다가 퍼센트 파싱 버그가
// 한쪽만 고쳐지는 사고를 낸 적이 있어(2026-08-22), 계약을 테스트로 못박아 둔다.
import { describe, expect, it } from "vitest";
import {
  isOpenDateSuspicious,
  shouldAcceptSheetOpenDate,
  parseKoreanDate,
  toBool,
  toDateStr,
  toNumber,
  toPercentNumber,
  toText,
} from "./sheetParsers.mjs";

describe("toNumber", () => {
  it("천단위 쉼표를 떼고 숫자로 읽는다", () => {
    expect(toNumber("1,234,000")).toBe(1234000);
  });

  it("빈 칸과 null은 null이다 (0이 아니다)", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it("0은 0으로 살린다", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber("0")).toBe(0);
  });

  it("숫자가 아니면 null이다 (NaN을 흘려보내지 않는다)", () => {
    expect(toNumber("해당없음")).toBeNull();
    expect(toNumber("-")).toBeNull();
  });

  it("음수와 소수도 그대로 읽는다", () => {
    expect(toNumber("-1,500.5")).toBe(-1500.5);
  });
});

describe("toPercentNumber", () => {
  // 시트의 퍼센트 서식 셀은 "14.1%"라는 표시 문자열로 온다. toNumber로는 전부 null이 됐었다.
  it("퍼센트 기호를 떼고 원본 숫자를 그대로 준다", () => {
    expect(toPercentNumber("14.1%")).toBe(14.1);
    expect(toPercentNumber("1,200%")).toBe(1200);
  });

  it("이미 숫자면 그대로 둔다 (여기서 나누지 않는다)", () => {
    expect(toPercentNumber(0.141)).toBe(0.141);
  });

  it("빈 칸은 null이다", () => {
    expect(toPercentNumber("")).toBeNull();
    expect(toPercentNumber(null)).toBeNull();
  });
});

describe("toBool", () => {
  it("시트 표기 '유'는 참, '무'는 거짓이다", () => {
    expect(toBool("유")).toBe(true);
    expect(toBool("무")).toBe(false);
  });

  // 셀을 체크박스로 바꾸면 Sheets API가 "TRUE"를 준다 — 예전엔 소문자만 봐서 false가 됐다.
  it("체크박스 셀의 대문자 TRUE/FALSE도 읽는다", () => {
    expect(toBool("TRUE")).toBe(true);
    expect(toBool("FALSE")).toBe(false);
  });

  it("불리언 값이 그대로 오면 그대로 쓴다", () => {
    expect(toBool(true)).toBe(true);
    expect(toBool(false)).toBe(false);
  });

  it("빈 칸은 거짓이다", () => {
    expect(toBool("")).toBe(false);
    expect(toBool(null)).toBe(false);
    expect(toBool(undefined)).toBe(false);
  });

  it("모르는 표기는 참으로 만들지 않는다", () => {
    expect(toBool("없음")).toBe(false);
    expect(toBool("N")).toBe(false);
  });
});

describe("toDateStr", () => {
  // 핵심 — toISOString()은 UTC라, KST(+9)에서 로컬 자정으로 파싱된 날짜가 하루 앞당겨졌다.
  // "2015. 9. 4"가 "2015-09-03"이 되면 경과개월이 달라지고 성숙도 보정까지 번진다.
  it("점 표기 날짜를 하루 밀리지 않게 읽는다", () => {
    expect(toDateStr("2015. 9. 4")).toBe("2015-09-04");
    expect(toDateStr("2015.9.4")).toBe("2015-09-04");
  });

  it("슬래시·하이픈 표기도 같은 결과를 준다", () => {
    expect(toDateStr("2015/9/4")).toBe("2015-09-04");
    expect(toDateStr("2015-09-04")).toBe("2015-09-04");
  });

  it("Date 객체는 로컬 달력 기준으로 찍는다", () => {
    // 로컬 자정. UTC로 찍으면 KST에서 전날이 된다.
    expect(toDateStr(new Date(2015, 8, 4, 0, 0, 0))).toBe("2015-09-04");
  });

  it("빈 칸은 null이다", () => {
    expect(toDateStr("")).toBeNull();
    expect(toDateStr(null)).toBeNull();
    expect(toDateStr("   ")).toBeNull();
  });

  it("날짜로 못 읽으면 원본을 그대로 돌려준다 (조용히 버리지 않는다)", () => {
    expect(toDateStr("미정")).toBe("미정");
  });
});

describe("parseKoreanDate", () => {
  it("매출DB의 '2015. 9. 4' 표기를 읽는다", () => {
    expect(parseKoreanDate("2015. 9. 4")).toBe("2015-09-04");
  });

  it("한 자리 월·일을 0으로 채운다", () => {
    expect(parseKoreanDate("2023. 1. 2")).toBe("2023-01-02");
  });

  it("날짜로 못 읽으면 null이다 (toDateStr과 계약이 다르다)", () => {
    expect(parseKoreanDate("미정")).toBeNull();
    expect(parseKoreanDate("")).toBeNull();
    expect(parseKoreanDate(null)).toBeNull();
  });

  it("다른 표기도 하루 밀리지 않는다", () => {
    expect(parseKoreanDate("2015/9/4")).toBe("2015-09-04");
  });
});

describe("toText", () => {
  it("앞뒤 공백을 떼고, 빈 문자열은 null로 만든다", () => {
    expect(toText("  가나다  ")).toBe("가나다");
    expect(toText("   ")).toBeNull();
    expect(toText(null)).toBeNull();
  });
});

describe("isOpenDateSuspicious", () => {
  // 가맹점코드 앞 8자리는 보통 오픈일과 가깝다. 크게 벌어지면 시트 오픈일이 아직
  // placeholder일 가능성이 높다(실사례: 문산점).
  it("코드 날짜와 30일 넘게 벌어지면 의심한다", () => {
    expect(isOpenDateSuspicious("20230324392", "2023-05-30")).toBe(true);
  });

  it("30일 이내면 정상으로 본다", () => {
    expect(isOpenDateSuspicious("20230324392", "2023-04-10")).toBe(false);
    expect(isOpenDateSuspicious("20230324392", "2023-03-24")).toBe(false);
  });

  it("코드가 날짜 형식이 아니거나 오픈일이 없으면 판단하지 않는다", () => {
    expect(isOpenDateSuspicious("ABC123", "2023-03-24")).toBe(false);
    expect(isOpenDateSuspicious("20230324392", null)).toBe(false);
  });
});

describe("shouldAcceptSheetOpenDate", () => {
  it("코드 날짜와 가까우면 그대로 받는다", () => {
    expect(shouldAcceptSheetOpenDate("20230324392", "2023-04-10", null)).toBe(true);
  });

  // 시흥능곡점 사례(2026-09-11 사용자 확정) — 계약보다 35일 늦게 연 정상 매장이라
  // 30일 규칙에 걸렸는데, 매출DB에서 들어온 저장값과 시트 값이 같다. 서로 다른 출처가
  // 같은 날짜를 말하면 placeholder일 수 없으므로 받아들인다.
  it("30일 넘게 차이나도 저장값과 같으면 받는다", () => {
    expect(shouldAcceptSheetOpenDate("20230324392", "2023-04-28", "2023-04-28")).toBe(true);
  });

  it("30일 넘게 차이나고 저장값과도 다르면 거부한다", () => {
    expect(shouldAcceptSheetOpenDate("20230324392", "2023-06-01", "2023-04-28")).toBe(false);
  });

  it("저장값이 없는데 30일 넘게 차이나면 거부한다 (placeholder 의심)", () => {
    expect(shouldAcceptSheetOpenDate("20230324392", "2023-06-01", null)).toBe(false);
  });

  it("시트에 오픈일이 없으면 받지 않는다 (기존 값을 지우지 않는다)", () => {
    expect(shouldAcceptSheetOpenDate("20230324392", null, "2023-04-28")).toBe(false);
    expect(shouldAcceptSheetOpenDate("20230324392", "", "2023-04-28")).toBe(false);
  });
});
