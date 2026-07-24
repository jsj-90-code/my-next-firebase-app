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
  // 이 존 안에서 "가방 선반 브라켓" 표시(도면 위 마주보는 책상 표시)가 있는 좌석 수.
  // 이 좌석엔 아이락스 헤드셋걸이, 나머지(= seats - bagShelfCount)엔 아이센스 헤드셋걸이가 설치된다.
  bagShelfCount: number;
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

// 존 하나에 매칭된 좌석번호표 상의 번호 범위 (예: "1~10, 25~30"). AI가 자동 인식한 값을
// 그대로 쓰거나, 틀린 부분은 사람이 직접 고쳐서 저장한다.
export type SeatNumberRangeEntry = {
  zoneName: string;
  ranges: string;
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
  // 좌석번호표(피난안내도 등) 이미지 — 존별 좌석번호 자동인식용. 도면과 별개로 선택 업로드.
  seatNumberPlateDataUrl: string | null;
  seatNumberRanges: SeatNumberRangeEntry[];
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
    seatNumberPlateDataUrl: null,
    seatNumberRanges: [],
    updatedAt: null,
    updatedBy: null,
  };
}

export type RecognizeResult = {
  seats: number;
  deskSize: DeskSize | null;
  // 한 존 안에 책상 사이즈가 여러 종류 섞여있을 때 사이즈별 개수 (desk 모드에서만 채워짐).
  // 2개 이상 있을 때만 채워지고, 단일 사이즈면 deskSize/seats만으로 충분하므로 비워둔다.
  sizeBreakdown?: SizeBreakdownEntry[];
  // "가방 선반 브라켓" 표시가 있는 좌석 수 (desk 모드에서만 채워짐, 헤드셋걸이 종류 산출용).
  bagShelfCount?: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: number | null;
};
