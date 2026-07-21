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

export const ZONE_TYPES: ZoneType[] = [
  { key: "multi", label: "멀티존", color: "#C1543F" },
  { key: "lol", label: "LOL존", color: "#C98B3E" },
  { key: "team", label: "팀룸", color: "#A98C3B" },
  { key: "one_seat", label: "1인석", color: "#5C8A5A" },
  { key: "one_room", label: "1인룸", color: "#7FAF7C" },
  { key: "two", label: "2인룸", color: "#3E8E82" },
  { key: "three", label: "3인룸", color: "#3E7A8E" },
  { key: "fc", label: "FC온라인존", color: "#3E6B9E" },
  { key: "fps", label: "FPS존", color: "#3E4F9E" },
  { key: "friends", label: "프렌즈존", color: "#6A4C9E" },
  { key: "vip", label: "VIP존", color: "#8C3E8E" },
  { key: "couple_seat", label: "커플석", color: "#B33E76" },
  { key: "couple_room", label: "커플룸", color: "#8C2F58" },
  { key: "buff", label: "버프존", color: "#7A5C4A" },
  { key: "progamer", label: "리얼프로게이머존", color: "#4A4E5C" },
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
    options: ["낮은 유리칸막이", "없음"],
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
};

export type PcSpecField = {
  id: PcSpecFieldId;
  label: string;
  def: string;
};

// PC 탭: 직접입력 사양 필드 (존마다 다른 값만 저장됨)
export const PC_SPEC_FIELDS: PcSpecField[] = [
  { id: "cpu", label: "CPU", def: "i5-14400F" },
  { id: "cpuCooler", label: "CPU 쿨러", def: "마이크로닉스 ICEROCK 쿨러" },
  { id: "ram", label: "RAM", def: "16GB" },
  { id: "mb", label: "M/B", def: "H610M 2.5" },
  { id: "gpu", label: "GPU", def: "RTX 5060" },
  { id: "power", label: "POWER", def: "600W" },
  { id: "case", label: "CASE", def: "아센케이스 매립" },
  { id: "monitorArm", label: "모니터암", def: "아센암" },
  { id: "monitor", label: "모니터", def: "제이씨현32인치240hz" },
  { id: "mouse", label: "마우스", def: "G304 & 로켓(번지)" },
  { id: "keyboard", label: "키보드", def: "K400" },
  { id: "headset", label: "헤드셋", def: "G58" },
  { id: "charger", label: "충전기", def: "무선충전기" },
  { id: "joypad", label: "조이패드", def: "없음" },
];

export const PC_LABELS = PC_SPEC_FIELDS.map((f) => f.label);

// 자주 쓰는 값 자동완성 후보 (직접입력은 그대로 가능)
export const FIELD_SUGGESTIONS: Partial<Record<PcSpecFieldId, string[]>> = {
  ram: ["16GB", "32GB"],
  gpu: ["RTX 5060", "RTX 5060Ti", "RX 9060"],
  monitor: [
    "제이씨현32인치240hz",
    "비트엠 27인치",
    "비트엠 34인치",
    "BenQ XL2540X+",
  ],
  mouse: [
    "G304 & 로켓(번지)",
    "G304 & 스틸시리즈 라이벌3(번지)",
    "G304 + 오로치",
  ],
  keyboard: ["K400", "Razer Huntsman V3 Pro", "AULA F87 Pro 독거미 텐키리스"],
  headset: ["G58", "Razer BlackShark V2 Hyperspeed", "앱코 N800(핑크)"],
  monitorArm: ["아센암", "관절암"],
};

// 존 유형별 PC 기본사양 재정의 (없는 항목은 전역 기본값 사용)
export const PC_TYPE_DEFAULTS: Partial<Record<ZoneTypeKey, PcSpecValues>> = {
  vip: { monitorArm: "관절암", monitor: "비트엠 34인치" },
  fc: { monitorArm: "관절암", monitor: "비트엠 27인치", joypad: "조이패드 포함" },
  lol: { monitorArm: "관절암", monitor: "비트엠 27인치" },
  fps: {
    monitorArm: "관절암",
    monitor: "BenQ XL2540X+",
    mouse: "G304 & 스틸시리즈 라이벌3(번지)",
    keyboard: "Razer Huntsman V3 Pro",
    headset: "Razer BlackShark V2 Hyperspeed",
    charger: "무선충전기 (2포트 이상 어댑터 필요)",
  },
  team: { monitorArm: "관절암", monitor: "비트엠 27인치" },
  friends: { monitorArm: "관절암", monitor: "비트엠 27인치" },
  couple_seat: {
    monitorArm: "관절암",
    monitor: "비트엠 27인치",
    mouse: "G304 + 오로치",
    headset: "앱코 N800(핑크)",
  },
  couple_room: {
    monitorArm: "관절암",
    monitor: "비트엠 27인치",
    mouse: "G304 + 오로치",
    headset: "앱코 N800(핑크)",
  },
  one_seat: { monitorArm: "관절암", monitor: "비트엠 27인치" },
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
