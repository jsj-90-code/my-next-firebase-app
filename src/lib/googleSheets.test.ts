import { describe, expect, it } from "vitest";
import { buildSheetRows, uniqueSheetTitle, type SeatNumberSheetEntry } from "./googleSheets";

// 울산삼산점 웹 사양(10-27 저장값) → 수기 탭 "261015 울산삼산점"과 같은 문구가 나와야 한다.
const base = { baseKeyboard: "K400", baseHeadset: "G58", baseRam: "16GB" };
const e = (zoneName: string, typeKey: SeatNumberSheetEntry["typeKey"], o: Partial<SeatNumberSheetEntry>): SeatNumberSheetEntry => ({
  zoneName, ranges: "1", typeKey, gpu: "RTX 5060Ti", monitor: "비트엠 27인치 IPS 240Hz", keyboard: "K400",
  mouse: "G304 & 로켓(번지)", headset: "G58", ram: "16GB", ...base, ...o,
});

describe("좌석번호표 시트 문구(울산 기준)", () => {
  it("존별 대표 장비와 RAM", () => {
    const { rows } = buildSheetRows([
      e("VIP존A", "vip", { gpu: "RTX 5070", monitor: "큐닉스 27인치 300Hz  + 제우스랩 16인치 Z16 Lite",
        mouse: "G304 & 커세어 카타르 프로 유선(번지)", headset: "Razer BlackShark V2 Hyperspeed", ram: "32GB" }),
      e("프렌즈존A", "friends", {}),
      e("2인룸A", "two", { monitor: "큐닉스 27인치 300Hz  + 제우스랩 16인치 Z16 Lite", mouse: "G304 & 커세어 카타르 프로 유선(번지)" }),
      e("4인룸", "etc", {}),
      e("FPS존A", "fps", { monitor: "BenQ XL2540X+ 280Hz", keyboard: "AULA F87 Pro 독거미 텐키리스", mouse: "G304 & 스틸시리즈 라이벌3(번지)", ram: "32GB" }),
      e("LOL존A", "lol", { monitor: "큐닉스 27인치 300Hz", mouse: "G304 & 커세어 카타르 프로 유선(번지)" }),
      e("FC ONLINE존A", "fc", { monitor: "큐닉스 27인치 300Hz" }),
      e("세레머니 팀룸A", "ceremony_team", {}),
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r[0], r.slice(2)]));
    expect(byName["VIP존"]).toEqual(["RTX 5070", "27인치 300Hz + 듀얼 모니터", "레이저 블랙샤크 헤드셋", "RAM 32GB", "더 넓은 와이드데스크로 VIP만을 위한 프라이빗 좌석"]);
    expect(byName["프렌즈존"].slice(2, 4)).toEqual(["게이밍 듀얼 마우스", ""]);
    expect(byName["2인룸"]).toEqual(["RTX 5060Ti", "27인치 300Hz + 듀얼 모니터", "커세어 KATAR PRO 마우스", "", "둘만의 몰입감을 높여주는 2인 전용 프라이빗 좌석"]);
    expect(byName["4인룸"][4]).toBe("팀 게임을 위한 아이센스만의 프리미엄 좌석");
    expect(byName["FPS존"]).toEqual(["RTX 5060Ti", "BenQ XL2540X+ 280Hz 모니터", "아우라 텐키리스 키보드", "RAM 32GB", "FPS를 선호하는 고객을 위한 대회용 프리미엄 좌석"]);
    expect(byName["LOL존"].slice(1, 4)).toEqual(["27인치 300Hz 모니터", "커세어 KATAR PRO 마우스", ""]);
    expect(byName["FC ONLINE존"][2]).toBe("조이패드");
    expect(byName["세레머니 팀룸"][4]).toBe("팀 게임을 위한 아이센스만의 프리미엄 좌석");
  });

  it("보조 모니터 칸이 있으면 듀얼 모니터", () => {
    const { rows } = buildSheetRows([e("VIP존A", "vip", { monitor: "큐닉스 27인치 300Hz", subMonitor: "제우스랩 16인치 Z16 Lite" }),
      e("LOL존A", "lol", { monitor: "큐닉스 27인치 300Hz", subMonitor: "없음" })]);
    expect(rows[0][3]).toBe("27인치 300Hz + 듀얼 모니터");
    expect(rows[1][3]).toBe("27인치 300Hz 모니터");
  });

  it("커플존은 핑크 헤드셋 문구, 책상만 설치는 행에서 빼고 번호를 모은다", () => {
    const { rows, skipped } = buildSheetRows([
      e("커플존A", "couple_room", { headset: "앱코 N800(핑크)", mouse: "G304(3개) + 오로치(3개)" }),
      e("책상만 설치A", "desk_only", { ranges: "19~26" }),
      e("책상만 설치B", "desk_only", { ranges: "28~32" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][4]).toBe("커플을 위한 핑크 헤드셋과 무선 마우스");
    expect(rows[0][6]).toBe("커플들을 위한 아이센스만의 꽁냥꽁냥 커플석");
    expect(skipped).toEqual(["19~26", "28~32"]);
  });
});

describe("uniqueSheetTitle", () => {
  it("같은 이름이 있으면 (2), (3)을 붙인다", () => {
    expect(uniqueSheetTitle("261027 호구점", ["안내"])).toBe("261027 호구점");
    expect(uniqueSheetTitle("261027 호구점", ["261027 호구점"])).toBe("261027 호구점(2)");
    expect(uniqueSheetTitle("261027 호구점", ["261027 호구점", "261027 호구점(2)"])).toBe("261027 호구점(3)");
  });
});
