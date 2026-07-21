// 아이센스 PC방 좌석배치도 작업 툴 - 공용 타입 정의
// (구글 앱스크립트 v15를 Next.js/Firebase 기반으로 이식)

export type TabKey = "desk" | "pc";

export type DeskSize = "820mm" | "850mm" | "910mm" | "950mm" | "1000mm";

export type ZoneTypeKey =
  | "multi"
  | "lol"
  | "team"
  | "one_seat"
  | "one_room"
  | "two"
  | "three"
  | "fc"
  | "fps"
  | "friends"
  | "vip"
  | "couple_seat"
  | "couple_room"
  | "buff"
  | "progamer"
  | "etc";

export type ZoneType = {
  key: ZoneTypeKey;
  label: string;
  color: string;
};

export type SizeBreakdownEntry = {
  deskSize: DeskSize;
  qty: number;
};

export type NormalizedRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

// 책상 발주 도면의 존 하나
export type DeskZone = NormalizedRect & {
  name: string;
  typeKey: ZoneTypeKey;
  color: string;
  seats: number;
  deskSize: DeskSize | "";
  sizeBreakdown: SizeBreakdownEntry[];
  desk: string;
  cooler: string;
  partition: string;
  monitorArm: string;
  chair: string;
};

export type PcSpecFieldId =
  | "cpu"
  | "cpuCooler"
  | "ram"
  | "mb"
  | "gpu"
  | "power"
  | "case"
  | "monitorArm"
  | "monitor"
  | "mouse"
  | "keyboard"
  | "headset"
  | "charger"
  | "joypad";

export type PcSpecValues = Partial<Record<PcSpecFieldId, string>>;

// PC 발주 도면의 존 하나
export type PcZone = NormalizedRect & {
  name: string;
  typeKey: ZoneTypeKey;
  color: string;
  seats: number;
  pcOverrides: PcSpecValues;
};

export type SeatLayoutProject = {
  id: string;
  name: string;
  // 도면 원본은 Storage에 올리지 않고, 압축한 데이터 URL을 그대로 Firestore 문서에 저장한다
  // (Firebase Storage는 유료 요금제가 필요해서 이 프로젝트에서는 쓰지 않기로 했다).
  floorPlanDataUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  zones: DeskZone[];
  pcZones: PcZone[];
  pcDefaults: PcSpecValues;
  updatedAt: number | null;
  updatedBy: string | null;
};

export function emptyProject(): Omit<SeatLayoutProject, "id"> {
  return {
    name: "",
    floorPlanDataUrl: null,
    imageWidth: 0,
    imageHeight: 0,
    zones: [],
    pcZones: [],
    pcDefaults: {},
    updatedAt: null,
    updatedBy: null,
  };
}

export type RecognizeResult = {
  seats: number;
  deskSize: DeskSize | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: number | null;
};
