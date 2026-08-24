// 아이센스 PC방 좌석배치도 작업 툴 - 상수 정의
// 앱스크립트 v15의 ZONE_TYPES / SPEC_FIELDS / PC_SPEC_FIELDS 등을 그대로 이식.
// 매장 운영 정책(사양 종류, 기본값)이 바뀌면 이 파일만 수정하면 된다.

import type {
  DeskSize,
  PcSpecFieldId,
  PcSpecValues,
  ZoneType,
  ZoneTypeKey,
} from "./types";

// 순서: 멀티존-LOL존-FC ONLINE존-FPS존-프렌즈존-커플석-커플존-VIP존-세레머니 팀룸-팀룸-1인석-
// 1인룸-2인룸-3인룸-버프존/리얼프로게이머존-책상만 설치 (기타(직접입력)는 항상 맨 끝 유지).
export const ZONE_TYPES: ZoneType[] = [
  { key: "multi", label: "멀티존", color: "#C1543F" },
  { key: "lol", label: "LOL존", color: "#C98B3E" },
  { key: "fc", label: "FC ONLINE존", color: "#3E6B9E" },
  { key: "fps", label: "FPS존", color: "#3E4F9E" },
  { key: "friends", label: "프렌즈존", color: "#6A4C9E" },
  { key: "couple_seat", label: "커플석", color: "#B33E76" },
  { key: "couple_room", label: "커플존", color: "#8C2F58" },
  { key: "vip", label: "VIP존", color: "#8C3E8E" },
  { key: "ceremony_team", label: "세레머니 팀룸", color: "#C9A227" },
  { key: "team", label: "팀룸", color: "#A98C3B" },
  { key: "one_seat", label: "1인석", color: "#5C8A5A" },
  { key: "one_room", label: "1인룸", color: "#7FAF7C" },
  { key: "two", label: "2인룸", color: "#3E8E82" },
  { key: "three", label: "3인룸", color: "#3E7A8E" },
  { key: "buff", label: "버프존", color: "#7A5C4A" },
  { key: "progamer", label: "리얼프로게이머존", color: "#4A4E5C" },
  { key: "desk_only", label: "책상만 설치", color: "#6B6B6B" },
  { key: "etc", label: "기타(직접입력)", color: "#8D7B68" },
];

export function getZoneTypeLabel(typeKey: ZoneTypeKey): string | null {
  return ZONE_TYPES.find((t) => t.key === typeKey)?.label ?? null;
}

export const DESK_SIZE_OPTIONS: DeskSize[] = [
  "820mm",
  "850mm",
  "910mm",
  "950mm",
  "1000mm",
];

export type SpecFieldId = "desk" | "cooler" | "partition" | "monitorArm" | "chair";

export type SpecField = {
  id: SpecFieldId;
  label: string;
  options: string[];
  def: string;
};

// 책상 탭: 드롭다운 사양 필드
export const SPEC_FIELDS: SpecField[] = [
  { id: "desk", label: "책상", options: ["리그", "퍼스트클래스"], def: "리그" },
  { id: "cooler", label: "쿨러", options: ["LED 쿨러"], def: "LED 쿨러" },
  {
    id: "partition",
    label: "칸막이",
    options: ["낮은 유리칸막이", "와이드 유리칸막이", "없음"],
    def: "낮은 유리칸막이",
  },
  {
    id: "monitorArm",
    label: "모니터암",
    options: ["아센암", "관절암"],
    def: "아센암",
  },
  {
    id: "chair",
    label: "의자",
    options: ["게이밍 의자", "럭셔리 의자", "커플석의자"],
    def: "럭셔리 의자",
  },
];

export const TYPE_DEFAULTS: Partial<Record<ZoneTypeKey, Partial<Record<SpecFieldId, string>>>> = {
  lol: { desk: "퍼스트클래스", monitorArm: "관절암" },
  team: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  ceremony_team: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  one_seat: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  one_room: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  two: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  three: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  fc: { monitorArm: "관절암" },
  couple_seat: { partition: "없음", monitorArm: "관절암", chair: "커플석의자" },
  couple_room: { partition: "없음", monitorArm: "관절암", chair: "커플석의자" },
  fps: { desk: "퍼스트클래스", monitorArm: "관절암" },
  friends: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  vip: { desk: "퍼스트클래스", partition: "없음", monitorArm: "관절암" },
  // 책상만 설치하고 PC/쿨러/모니터암/의자는 없는 존 (칸막이는 전역 기본값인 "낮은 유리칸막이" 그대로).
  desk_only: { cooler: "해당없음", monitorArm: "해당없음", chair: "해당없음" },
};

export type PcSpecField = {
  id: PcSpecFieldId;
  label: string;
  def: string;
};

// PC 탭: 직접입력 사양 필드 (존마다 다른 값만 저장됨)
export const PC_SPEC_FIELDS: PcSpecField[] = [
  { id: "cpu", label: "CPU", def: "울트라5 시리즈2 225F" },
  { id: "cpuCooler", label: "CPU 쿨러", def: "마이크로닉스 ICEROCK 쿨러" },
  { id: "ram", label: "RAM", def: "DDR5 16GB" },
  { id: "mb", label: "M/B", def: "ASUS PRIME H810M-X 2.5G" },
  { id: "gpu", label: "GPU", def: "RTX 5060 8GB" },
  { id: "power", label: "POWER", def: "잘만 MegaMax ET 600W 80PLUS STANDARD" },
  { id: "case", label: "CASE", def: "아센케이스 매립" },
  { id: "monitorArm", label: "모니터암", def: "아센암" },
  { id: "monitor", label: "모니터", def: "제이씨현 32인치 240Hz" },
  { id: "mouse", label: "마우스", def: "로지텍 G304_화이트 무선 마우스 & ROCCAT PURE SEL 유선 화이트" },
  { id: "keyboard", label: "키보드", def: "ISENS K400 광청축 크리스탈 키캡 키보드" },
  { id: "headset", label: "헤드셋", def: "젬스트 LEF G58" },
  { id: "speaker", label: "스피커", def: "블루오션 2 (앱코 S1000) 스피커" },
  { id: "charger", label: "충전기", def: "무선충전기" },
  { id: "adapter", label: "어답터", def: "2구 어답터" },
  { id: "joypad", label: "조이패드", def: "없음" },
];

export const PC_LABELS = PC_SPEC_FIELDS.map((f) => f.label);

// 자주 쓰는 값 자동완성 후보 (직접입력은 그대로 가능)
export const FIELD_SUGGESTIONS: Partial<Record<PcSpecFieldId, string[]>> = {
  cpu: ["울트라5 시리즈2 225F", "i5-14400F"],
  ram: ["DDR5 16GB", "DDR5 32GB"],
  mb: ["ASUS PRIME H810M-X 2.5G", "H610M 2.5"],
  gpu: ["RTX 5060 8GB", "RTX 5060Ti", "RX 9060"],
  power: ["잘만 MegaMax ET 600W 80PLUS STANDARD", "600W"],
  adapter: ["2구 어답터", "3구 어답터"],
  monitor: [
    "제이씨현 32인치 240Hz",
    "비트엠 27인치 IPS 240Hz",
    "비트엠 34인치 울트라와이드",
    "BenQ XL2540X+ 280Hz",
    "큐닉스 27인치 300Hz",
    "LG 울트라기어 GP750 240Hz",
  ],
  mouse: [
    "로지텍 G304_화이트 무선 마우스 & ROCCAT PURE SEL 유선 화이트",
    "로지텍 G304_화이트 무선 마우스 & 스틸시리즈 라이벌3",
    "로지텍 G304_화이트 무선 마우스 + 레이저오로치 무선마우스_핑크",
  ],
  keyboard: ["ISENS K400 광청축 크리스탈 키캡 키보드", "Razer Huntsman V3 Pro", "AULA F87 Pro 독거미 텐키리스"],
  headset: ["젬스트 LEF G58", "Razer BlackShark V2 Hyperspeed", "앱코 N800(핑크)"],
  monitorArm: ["아센암", "관절암"],
};

// 존 유형별 PC 기본사양 재정의 (없는 항목은 전역 기본값 사용)
export const PC_TYPE_DEFAULTS: Partial<Record<ZoneTypeKey, PcSpecValues>> = {
  vip: { monitorArm: "관절암", monitor: "비트엠 34인치 울트라와이드" },
  fc: { monitorArm: "관절암", monitor: "큐닉스 27인치 300Hz", joypad: "조이패드" },
  lol: { monitorArm: "관절암", monitor: "비트엠 27인치 IPS 240Hz" },
  // 어답터는 존 유형이 아니라 헤드셋 종류로 정해져서(레이저 블랙샤크 V2 하이퍼스피드 헤드셋을
  // 쓰는 좌석만 3구 어답터) 여기 override로 안 넣는다 — computePcOrderSummary가 헤드셋 값을
  // 보고 자동으로 계산한다.
  fps: {
    monitorArm: "관절암",
    monitor: "BenQ XL2540X+ 280Hz",
    mouse: "로지텍 G304_화이트 무선 마우스 & 스틸시리즈 라이벌3",
    keyboard: "Razer Huntsman V3 Pro",
    headset: "Razer BlackShark V2 Hyperspeed",
  },
  team: { monitorArm: "관절암", monitor: "비트엠 27인치 IPS 240Hz" },
  ceremony_team: { monitorArm: "관절암", monitor: "비트엠 27인치 IPS 240Hz" },
  friends: { monitorArm: "관절암", monitor: "비트엠 27인치 IPS 240Hz" },
  couple_seat: {
    monitorArm: "관절암",
    monitor: "비트엠 27인치 IPS 240Hz",
    mouse: "로지텍 G304_화이트 무선 마우스 + 레이저오로치 무선마우스_핑크",
    headset: "앱코 N800(핑크)",
  },
  couple_room: {
    monitorArm: "관절암",
    monitor: "비트엠 27인치 IPS 240Hz",
    mouse: "로지텍 G304_화이트 무선 마우스 + 레이저오로치 무선마우스_핑크",
    headset: "앱코 N800(핑크)",
  },
  one_seat: { monitorArm: "관절암", monitor: "비트엠 27인치 IPS 240Hz" },
};

export function defaultPcDefaults(): PcSpecValues {
  const out: PcSpecValues = {};
  PC_SPEC_FIELDS.forEach((f) => {
    out[f.id] = f.def;
  });
  return out;
}

export const BEZEL_MAP: Record<DeskSize, { left: number; rightWith: number; rightWithout: number }> = {
  "820mm": { left: 180, rightWith: 165, rightWithout: 180 },
  "850mm": { left: 195, rightWith: 180, rightWithout: 195 },
  "910mm": { left: 225, rightWith: 210, rightWithout: 225 },
  "950mm": { left: 245, rightWith: 230, rightWithout: 245 },
  "1000mm": { left: 270, rightWith: 255, rightWithout: 270 },
};

export const COMPOSITE_W = 1920;
export const COMPOSITE_H = 1080;

// 다운로드/프레젠테이션용 최종 PNG는 이 배수만큼 더 높은 해상도로 뽑는다(캔버스 크기만
// 키우고 ctx.scale로 그대로 확대해서 그리는 방식이라, canvasRender.ts의 좌표/폰트 크기 값은
// 전부 COMPOSITE_W/H 기준 그대로 두면 된다). PPT/구글 슬라이드에서 휠로 확대했을 때 글씨가
// 깨져 보이는 문제 때문에 도입 — 2배(4K), 3배(6K급)로도 PC 발주 도면(사양표)처럼 글자를 크게
// 보는 슬라이드에서 확대 시 흐려 보인다는 피드백이 있어 5배로 올림(9600x5400).
export const EXPORT_SCALE = 5;
