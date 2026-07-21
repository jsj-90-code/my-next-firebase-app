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
  floorPlanPath: string | null; // Firebase Storage 경로
  floorPlanUrl: string | null; // 다운로드 URL (캐시용)
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
    floorPlanPath: null,
    floorPlanUrl: null,
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

// "매장 전체보기" 갤러리 항목 - 구글 슬라이드 자동 등록 기능을 대체
export type GalleryEntry = {
  id: string; // `${projectId}_${tab}`
  projectId: string;
  projectName: string;
  tab: TabKey;
  imagePath: string;
  imageUrl: string;
  updatedAt: number;
  updatedBy: string | null;
};
