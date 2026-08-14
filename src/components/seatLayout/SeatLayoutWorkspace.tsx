"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  DESK_SIZE_OPTIONS,
  PC_SPEC_FIELDS,
  SPEC_FIELDS,
  ZONE_TYPES,
  COMPOSITE_H,
  COMPOSITE_W,
  defaultPcDefaults,
} from "@/lib/seatLayout/constants";
import { computeBasicPcQty, getContrastText, nextSuffix } from "@/lib/seatLayout/calc";
import {
  renderDeskFloorplanImage,
  renderOrderSummaryImage,
  renderPcFloorplanImage,
} from "@/lib/seatLayout/canvasRender";
import { compressImageDataUrl } from "@/lib/seatLayout/imageCompress";
import { loadPdfDocument, renderPdfPageToDataUrl } from "@/lib/seatLayout/pdfRender";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { deleteProject, listProjects, loadProject, saveProject } from "@/lib/seatLayout/store";
import {
  defaultSeatLayoutSettings,
  loadSeatLayoutSettings,
  saveSeatLayoutSettings,
  type SeatLayoutSettings,
} from "@/lib/seatLayout/settings";
import { SettingsPanel } from "@/components/seatLayout/SettingsPanel";
import {
  emptyProject,
  type DeskSize,
  type DeskZone,
  type NormalizedRect,
  type PcSpecFieldId,
  type PcSpecValues,
  type PcZone,
  type ProjectSummary,
  type SeatLayoutProject,
  type SeatNumberRangeEntry,
  type SizeBreakdownEntry,
  type TabKey,
  type ZoneTypeKey,
} from "@/lib/seatLayout/types";
import type { SpecField, SpecFieldId } from "@/lib/seatLayout/constants";

type ActiveZone = DeskZone | PcZone;

const DEFAULT_DRAG_HINT =
  "먼저 위에서 존 유형을 선택한 뒤, 도면 위를 한 번 클릭(좌상단), 다시 한 번 클릭(우하단)하세요.";

function defaultDeskSpecValues(fields: SpecField[]): Record<SpecFieldId, string> {
  const out = {} as Record<SpecFieldId, string>;
  fields.forEach((f) => {
    out[f.id] = f.def;
  });
  return out;
}

function resetDeskSpecDraft(
  typeKey: ZoneTypeKey,
  fields: SpecField[],
  typeDefaults: SeatLayoutSettings["typeDefaults"],
): Record<SpecFieldId, string> {
  const overrides = typeDefaults[typeKey] ?? {};
  const base = defaultDeskSpecValues(fields);
  fields.forEach((f) => {
    base[f.id] = overrides[f.id] ?? f.def;
  });
  return base;
}

function resetPcSpecDraft(
  typeKey: ZoneTypeKey,
  pcDefaults: PcSpecValues,
  pcTypeDefaults: SeatLayoutSettings["pcTypeDefaults"],
): PcSpecValues {
  const overrides = pcTypeDefaults[typeKey] ?? {};
  const out: PcSpecValues = {};
  PC_SPEC_FIELDS.forEach((f) => {
    out[f.id] = overrides[f.id] ?? pcDefaults[f.id] ?? f.def;
  });
  return out;
}

// 완성된 PC 스펙 값 묶음(draft) 중, 전역 기본값과 다른 항목만 "존별 재정의(override)"로 남긴다.
function diffPcOverrides(draft: PcSpecValues, pcDefaults: PcSpecValues): PcSpecValues {
  const overrides: PcSpecValues = {};
  PC_SPEC_FIELDS.forEach((f) => {
    const v = draft[f.id] ?? "";
    if (v !== (pcDefaults[f.id] ?? "")) overrides[f.id] = v;
  });
  return overrides;
}

function pcDefaultsFromFields(fields: { id: PcSpecFieldId; def: string }[]): PcSpecValues {
  const out: PcSpecValues = {};
  fields.forEach((f) => {
    out[f.id] = f.def;
  });
  return out;
}

// 같은 유형의 존이 여러 개일 때 "라벨A", "라벨B"... 식으로 이름을 매기되, 개수(count)만 보고
// 다음 알파벳을 고르면 중간에 지워진 존이 있을 때 이미 쓰이고 있는 이름과 겹칠 수 있다
// (예: A가 삭제되고 B만 남은 상태에서 새로 만들면 개수=1 → "B"가 또 나와 중복됨). 그래서
// 실제로 아직 안 쓰인 이름을 찾을 때까지 확인한다.
function nextAvailableZoneName(
  zones: ActiveZone[],
  typeKey: ZoneTypeKey,
  label: string,
  excludeIndex?: number | null,
): string {
  const existingNames = new Set(
    zones.filter((z, i) => z.typeKey === typeKey && i !== excludeIndex).map((z) => z.name),
  );
  let i = 0;
  let candidate = label + nextSuffix(i);
  while (existingNames.has(candidate)) {
    i += 1;
    candidate = label + nextSuffix(i);
  }
  return candidate;
}

function statusToneClass(tone: "info" | "success" | "error") {
  if (tone === "success") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "error") return "text-red-600 dark:text-red-400";
  return "text-zinc-500 dark:text-zinc-400";
}

export function SeatLayoutWorkspace() {
  const { user, logout } = useAuth();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<SeatLayoutProject>(() => ({
    id: crypto.randomUUID(),
    ...emptyProject(),
  }));
  const [activeTab, setActiveTab] = useState<TabKey>("desk");
  const [selectedTypeKey, setSelectedTypeKey] = useState<ZoneTypeKey | null>(null);
  const [curRect, setCurRect] = useState<NormalizedRect | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [breakdown, setBreakdown] = useState<SizeBreakdownEntry[]>([]);
  // 이 존에서 "가방 선반 브라켓" 표시가 있는(=아이락스 헤드셋걸이가 설치될) 좌석 수.
  const [bagShelfDraft, setBagShelfDraft] = useState("0");
  const [deskSpecDraft, setDeskSpecDraft] = useState<Record<SpecFieldId, string>>(
    defaultDeskSpecValues(SPEC_FIELDS),
  );
  const [seatsDraft, setSeatsDraft] = useState("");
  const [pcSpecDraft, setPcSpecDraft] = useState<PcSpecValues>({});
  const [etcName, setEtcName] = useState("");
  const [etcColor, setEtcColor] = useState("#555555");
  // 스펙 수정 폼에서 존 유형(및 이름/색상)을 바꿀 때 쓰는 draft — 생성 시와 달리, 수정 시에는
  // 유형을 나중에 바꿀 수 있어야 해서 별도 state로 둔다.
  const [editTypeDraft, setEditTypeDraft] = useState<ZoneTypeKey>("etc");
  const [editEtcNameDraft, setEditEtcNameDraft] = useState("");
  const [editEtcColorDraft, setEditEtcColorDraft] = useState("#555555");

  const [pcDefaults, setPcDefaults] = useState<PcSpecValues>(defaultPcDefaults());
  const [pcDefaultsDraft, setPcDefaultsDraft] = useState<PcSpecValues>(defaultPcDefaults());
  const [pcDefaultsOpen, setPcDefaultsOpen] = useState(false);

  // ---------------- 사양 설정 (드롭다운 옵션/기본값, Firestore에 저장되어 전체 프로젝트가 공유) ----------------
  const [settings, setSettings] = useState<SeatLayoutSettings>(() => defaultSeatLayoutSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 설정 로딩이 끝나기 전에 사용자가 프로젝트를 불러오면(project.updatedAt이 생기면), 그 뒤에
  // 설정이 도착해도 이미 불러온 프로젝트의 pcDefaults를 덮어쓰면 안 된다 — ref로 추적한다.
  const hasLoadedProjectRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadSeatLayoutSettings();
        if (cancelled) return;
        setSettings(loaded);
        if (!hasLoadedProjectRef.current) {
          const fresh = pcDefaultsFromFields(
            PC_SPEC_FIELDS.map((f) => ({ ...f, def: loaded.pcDefaults[f.id] || f.def })),
          );
          setPcDefaults(fresh);
          setPcDefaultsDraft(fresh);
        }
      } catch {
        // 설정을 못 불러와도 constants.ts의 기본값(초기 state)으로 그대로 동작한다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveSpecFields = useMemo<SpecField[]>(
    () =>
      SPEC_FIELDS.map((f) => ({
        ...f,
        options: settings.specOptions[f.id]?.length ? settings.specOptions[f.id] : f.options,
        def: settings.specDefaults[f.id] || f.def,
      })),
    [settings],
  );
  const effectivePcSpecFields = useMemo(
    () => PC_SPEC_FIELDS.map((f) => ({ ...f, def: settings.pcDefaults[f.id] || f.def })),
    [settings],
  );

  const [presentationUrl, setPresentationUrl] = useState<string | null>(null);
  const [seatNumberSheetUrl, setSeatNumberSheetUrl] = useState<string | null>(null);
  const [deskOrderSheetUrl, setDeskOrderSheetUrl] = useState<string | null>(null);
  const [seatNumberStoreInfoOpen, setSeatNumberStoreInfoOpen] = useState(false);
  const [storeInfoDraft, setStoreInfoDraft] = useState({
    openDate: "",
    deliveryDate: "",
    svName: "",
    svPhone: "",
    ownerName: "",
    ownerPhone: "",
    address: "",
  });
  const [aiResultText, setAiResultText] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  // 도면 등록 직후 "AI로 구역 초안 제안받기"를 누르는 동안의 로딩 상태 (테스트용 기능).
  const [zoneSuggestBusy, setZoneSuggestBusy] = useState(false);
  // 드래그로 위치/크기를 바꿨지만 아직 Enter로 재인식하지 않은 존 — 드래그만 해서는 재인식이
  // 시작되지 않으므로(Enter를 눌러야 시작), 캔버스에 "재인식 필요" 표시를 남겨서 상태바 문구를
  // 놓쳐도 알 수 있게 한다.
  const [dirtyZoneIndex, setDirtyZoneIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: "info" | "success" | "error" }>({
    text: "",
    tone: "info",
  });
  const [busy, setBusy] = useState(false);

  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  // 도면이 이미 올라온 뒤에는 매장명/업로드 입력 UI를 한 줄 요약으로 접어서, 화면 스크롤 길이를 줄인다.
  // 도면이 없을 땐(첫 설정) 펼쳐서 보여준다.
  const [uploadPanelOpen, setUploadPanelOpen] = useState(true);
  useEffect(() => {
    // 도면이 생기면 접고, 없어지면(새 프로젝트 등으로) 다시 펼친다 — 반대 방향이 없으면
    // "도면 업로드됨" 요약 문구만 남고 파일 입력창은 다시 못 여는 상태가 된다.
    setUploadPanelOpen(!imgEl);
  }, [imgEl]);
  // 방금 업로드한 원본 화질 도면 (세션 동안만 메모리에 유지, Firestore에는 저장 안 함).
  // AI 좌석 인식은 화질이 중요해서, Firestore 저장용으로 압축한 이미지가 아니라 이걸로 잘라낸다.
  const [rawFloorPlanDataUrl, setRawFloorPlanDataUrl] = useState<string | null>(null);
  // 좌석번호표(피난안내도 등) 원본 화질 이미지 — 번호 인식은 이걸로 하고, 저장 직전에만 압축한다.
  const [rawSeatNumberPlateDataUrl, setRawSeatNumberPlateDataUrl] = useState<string | null>(null);
  const [seatNumberRecognizing, setSeatNumberRecognizing] = useState(false);
  // 좌석수가 겹치는 존이나 어느 존과도 안 맞는 번호 그룹처럼, 자동 배정을 포기하고 사람 확인이
  // 필요한 경우를 알려주는 안내문. (틀린 값을 억지로 채우는 것보다 안전하다.)
  const [seatNumberWarnings, setSeatNumberWarnings] = useState<string[]>([]);
  // 벽 경계로 나뉜 그룹이 어느 존과도 안 맞아서 자동 배정 못한 번호 그룹들. 버튼으로 보여줘서
  // 클릭하면 클립보드에 복사되게 하면, 경고 문구 속 숫자를 다시 옮겨 적는 것보다 훨씬 빠르다.
  const [seatNumberUnmatchedGroups, setSeatNumberUnmatchedGroups] = useState<
    { ranges: string; count: number }[]
  >([]);
  // 작업자가 실제로 하는 작업은 "존 설정한 도면"과 "피난안내도"를 나란히 띄워놓고 눈으로 비교하며
  // 존별 좌석번호를 직접 입력하는 것이라, "좌석번호표 발주" 탭에서는 항상 이 비교 화면을 보여준다
  // (별도 탭으로 분리했으니, 탭 전환 자체가 켜고 끄는 역할을 한다).
  const [seatNumberImageModalOpen, setSeatNumberImageModalOpen] = useState(false);
  // AI가 채워 넣은(=사람이 아직 확인/수정하지 않은) 존 이름 집합. 다음에 다시 "AI로 자동
  // 채워보기"를 눌렀을 때, 사람이 직접 고친 값은 보호하되 AI가 예전에 잘못 채운 값은 다시
  // 고칠 수 있게 구분하는 용도다. (state로 두면 렌더마다 갱신 타이밍을 신경 써야 해서 ref로 둔다.)
  const aiFilledZoneNamesRef = useRef<Set<string>>(new Set());
  const seatNumberPlateInputRef = useRef<HTMLInputElement>(null);
  // PDF 업로드 시: 페이지가 여러 장이라 어떤 페이지가 배치도인지 직접 골라야 한다.
  const [pdfPickerPages, setPdfPickerPages] = useState<
    { pageNumber: number; thumbnail: string }[] | null
  >(null);
  const [pdfPickerBusy, setPdfPickerBusy] = useState(false);
  // PDF 페이지 선택/크롭 화면은 도면과 좌석번호표가 공유한다 — 이 값으로 현재 어느 쪽을
  // 위한 것인지 구분한다 (선택한 페이지를 어디에 적용할지, 크롭 결과를 어디로 보낼지).
  const [pdfPickerTarget, setPdfPickerTarget] = useState<"floorplan" | "seatNumberPlate">(
    "floorplan",
  );
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  // PDF 페이지를 고른 다음(또는 좌석번호표 이미지 업로드 후): 필요없는 부분을 빼고 실제 필요한
  // 영역만 잘라내는 단계. 도면 크롭과 좌석번호표 크롭이 이 crop 상태/캔버스를 공유한다 —
  // cropTarget으로 크롭 완료 후 결과를 어디에 적용할지만 구분한다.
  const [pdfCropSource, setPdfCropSource] = useState<
    { dataUrl: string; width: number; height: number } | null
  >(null);
  const [cropTarget, setCropTarget] = useState<"floorplan" | "seatNumberPlate">("floorplan");
  const [cropRect, setCropRect] = useState<NormalizedRect | null>(null);
  const [cropHint, setCropHint] = useState("");
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropImgRef = useRef<HTMLImageElement | null>(null);
  const cropPendingStartRef = useRef<{ px: number; py: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingStartRef = useRef<{ px: number; py: number } | null>(null);
  const [dragHint, setDragHint] = useState(DEFAULT_DRAG_HINT);

  // ---------------- 존 박스 선택/이동/크기조절 (존 유형을 고르지 않았을 때만 동작) ----------------
  // 존 유형을 먼저 고르면 "새 구역 그리기" 모드, 안 고르면 "기존 구역 선택/편집" 모드로
  // 자연스럽게 나뉜다 — 별도 모드 전환 UI가 필요 없다.
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  type ZoneDragState = {
    index: number;
    mode: "move" | "resize";
    handle?: "tl" | "tr" | "bl" | "br";
    startPx: { x: number; y: number };
    startRect: NormalizedRect;
    currentRect: NormalizedRect;
    moved: boolean;
  };
  const zoneDragRef = useRef<ZoneDragState | null>(null);
  const ZONE_HANDLE_SIZE = 10;
  const ZONE_DELETE_ICON_SIZE = 16;
  const ZONE_DRAG_MOVE_THRESHOLD = 3;

  // 좌석번호표 탭의 도면 비교 화면은, PC 발주 도면에서만 사양 차이로 존을 더 쪼갠 경우(예:
  // "FPS존A"/"FPS존B")까지 구분해서 볼 수 있도록 PC 존이 있으면 PC 존 기준으로 보여준다
  // (AI 인식 기준과 동일). PC 탭을 아직 안 채웠으면 지금처럼 책상 존을 보여준다.
  const activeZones = useMemo<ActiveZone[]>(() => {
    if (activeTab === "pc") return project.pcZones;
    if (activeTab === "seatNumber" && project.pcZones.length) return project.pcZones;
    return project.zones;
  }, [activeTab, project.pcZones, project.zones]);

  function setStatusMsg(text: string, tone: "info" | "success" | "error" = "info") {
    setStatus({ text, tone });
  }

  // ---------------- 프로젝트 목록 ----------------
  async function refreshProjectList() {
    try {
      setProjects(await listProjects());
    } catch (err) {
      setStatusMsg(
        `프로젝트 목록을 불러오지 못했습니다: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    }
  }

  useEffect(() => {
    // Firestore에서 프로젝트 목록을 최초 1회 비동기로 가져와야 하므로 setState를 피할 수 없다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshProjectList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- 도면 이미지 로드 ----------------
  // 방금 업로드한 원본(rawFloorPlanDataUrl)이 있으면 그걸 우선 쓰고, 없으면(=프로젝트를
  // 불러오기만 한 경우) Firestore에 저장된 압축본을 쓴다.
  const floorPlanSrc = rawFloorPlanDataUrl ?? project.floorPlanDataUrl;
  // 좌석번호표(피난안내도) 미리보기 — 도면과 나란히 비교해서 볼 때 쓴다.
  const seatNumberPlateSrc = rawSeatNumberPlateDataUrl ?? project.seatNumberPlateDataUrl;
  useEffect(() => {
    if (!floorPlanSrc) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImgEl(null);
      return;
    }
    const image = new Image();
    image.onload = () => setImgEl(image);
    image.onerror = () =>
      setStatusMsg("도면 이미지를 불러오지 못했습니다.", "error");
    image.src = floorPlanSrc;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [floorPlanSrc]);

  // ---------------- 캔버스 그리기 ----------------
  // 영역(존 지정 / PDF 크롭)을 정확하게 클릭하기 쉽도록 보조 눈금선을 그린다.
  function drawGridLines(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const minorStep = 50;
    const majorStep = 200;
    ctx.save();
    for (let x = 0; x <= canvas.width; x += minorStep) {
      const isMajor = x % majorStep === 0;
      ctx.strokeStyle = isMajor ? "rgba(37, 99, 235, 0.35)" : "rgba(120, 120, 120, 0.2)";
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += minorStep) {
      const isMajor = y % majorStep === 0;
      ctx.strokeStyle = isMajor ? "rgba(37, 99, 235, 0.35)" : "rgba(120, 120, 120, 0.2)";
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawZoneBox(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    z: ActiveZone,
    rectOverride?: NormalizedRect,
    selected?: boolean,
    dirty?: boolean,
  ) {
    const r = rectOverride ?? z;
    const x = r.x * canvas.width;
    const y = r.y * canvas.height;
    const w = r.w * canvas.width;
    const h = r.h * canvas.height;
    ctx.strokeStyle = z.color;
    ctx.lineWidth = selected ? 4 : 3;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "bold 12px sans-serif";
    const textW = ctx.measureText(z.name).width;
    const tagW = textW + 10;
    const tagH = 16;
    const tagX = x;
    const tagY = Math.max(0, y - tagH - 2);
    ctx.fillStyle = z.color;
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.fillStyle = getContrastText(z.color);
    ctx.fillText(z.name, tagX + 5, tagY + 12);

    // 위치/크기를 바꿨지만 아직 Enter로 재인식하지 않은 존 — 선택 여부와 무관하게 항상
    // 표시해서, 다른 존을 만지는 동안에도 "이 존은 재인식이 안 끝났다"는 걸 알 수 있게 한다.
    if (dirty) {
      const bx = x;
      const by = y - 12;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(bx, by, ZONE_DELETE_ICON_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", bx, by + 1);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    if (!selected) return;

    // 리사이즈 핸들 (4개 모서리)
    const half = ZONE_HANDLE_SIZE / 2;
    [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].forEach(([hx, hy]) => {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.5;
      ctx.fillRect(hx - half, hy - half, ZONE_HANDLE_SIZE, ZONE_HANDLE_SIZE);
      ctx.strokeRect(hx - half, hy - half, ZONE_HANDLE_SIZE, ZONE_HANDLE_SIZE);
    });

    // 삭제 아이콘 (오른쪽 위 바깥쪽)
    const dx = x + w;
    const dy = y - 12;
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(dx, dy, ZONE_DELETE_ICON_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×", dx, dy + 1);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  function drawCanvas() {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl?.naturalWidth) return;
    canvas.width = 900;
    canvas.height = 900 * (imgEl.naturalHeight / imgEl.naturalWidth);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
    drawGridLines(ctx, canvas);
    const dragging = zoneDragRef.current;
    activeZones.forEach((z, i) => {
      const rectOverride = dragging && dragging.index === i ? dragging.currentRect : undefined;
      drawZoneBox(ctx, canvas, z, rectOverride, i === selectedZoneIndex, i === dirtyZoneIndex);
    });
  }

  useEffect(() => {
    drawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl, activeZones, selectedZoneIndex, dirtyZoneIndex]);

  // 구역이 선택된 상태에서 Enter를 누르면(양쪽을 번갈아 드래그로 다 조정한 뒤) 그 구역을
  // 최종 위치로 다시 인식하고 수정 폼을 띄운다. 다른 입력창에 포커스가 있거나 폼이 이미
  // 열려있을 때는 무시한다.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (formOpen) return;
      if (activeTab === "seatNumber") return;
      if (selectedZoneIndex === null) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const z = activeZones[selectedZoneIndex];
      if (!z) return;
      e.preventDefault();
      const rect: NormalizedRect = { x: z.x, y: z.y, w: z.w, h: z.h };
      setDirtyZoneIndex((cur) => (cur === selectedZoneIndex ? null : cur));
      editZone(selectedZoneIndex);
      void runRecognize(rect, activeTab);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [formOpen, selectedZoneIndex, activeTab, activeZones]);

  // ---------------- 존 박스 선택/이동/크기조절 히트테스트 (캔버스 픽셀 좌표 기준) ----------------
  function rectToPx(rect: NormalizedRect, canvas: HTMLCanvasElement) {
    return {
      x: rect.x * canvas.width,
      y: rect.y * canvas.height,
      w: rect.w * canvas.width,
      h: rect.h * canvas.height,
    };
  }

  function hitTestZoneHandle(
    rectPx: { x: number; y: number; w: number; h: number },
    px: number,
    py: number,
  ): "tl" | "tr" | "bl" | "br" | null {
    const half = ZONE_HANDLE_SIZE / 2 + 4;
    const corners: ["tl" | "tr" | "bl" | "br", number, number][] = [
      ["tl", rectPx.x, rectPx.y],
      ["tr", rectPx.x + rectPx.w, rectPx.y],
      ["bl", rectPx.x, rectPx.y + rectPx.h],
      ["br", rectPx.x + rectPx.w, rectPx.y + rectPx.h],
    ];
    for (const [handle, hx, hy] of corners) {
      if (Math.abs(px - hx) <= half && Math.abs(py - hy) <= half) return handle;
    }
    return null;
  }

  function hitTestDeleteIcon(
    rectPx: { x: number; y: number; w: number; h: number },
    px: number,
    py: number,
  ): boolean {
    const dx = rectPx.x + rectPx.w;
    const dy = rectPx.y - 12;
    const half = ZONE_DELETE_ICON_SIZE / 2 + 3;
    return Math.abs(px - dx) <= half && Math.abs(py - dy) <= half;
  }

  function hitTestZoneBody(
    rectPx: { x: number; y: number; w: number; h: number },
    px: number,
    py: number,
  ): boolean {
    return px >= rectPx.x && px <= rectPx.x + rectPx.w && py >= rectPx.y && py <= rectPx.y + rectPx.h;
  }

  // 기존 구역 클릭 → 선택, 삭제 아이콘/모서리/안쪽 클릭에 따라 삭제·크기조절·이동 드래그를
  // 시작한다. 존 유형을 선택한 상태에서도 이 함수를 먼저 태워서 기존 구역을 편집할 수 있게
  // 해야 하므로, 실제로 뭔가(삭제/리사이즈/이동)를 처리했는지를 반환해서 호출부가 "새 구역
  // 그리기로 넘어가도 되는지"를 판단할 수 있게 한다.
  function handleZoneSelectMouseDown(px: number, py: number, canvas: HTMLCanvasElement): boolean {
    if (selectedZoneIndex !== null && selectedZoneIndex < activeZones.length) {
      const selectedZone = activeZones[selectedZoneIndex];
      const rectPx = rectToPx(selectedZone, canvas);
      if (hitTestDeleteIcon(rectPx, px, py)) {
        deleteZone(selectedZoneIndex);
        setSelectedZoneIndex(null);
        return true;
      }
      const handle = hitTestZoneHandle(rectPx, px, py);
      if (handle) {
        const startRect: NormalizedRect = {
          x: selectedZone.x,
          y: selectedZone.y,
          w: selectedZone.w,
          h: selectedZone.h,
        };
        zoneDragRef.current = {
          index: selectedZoneIndex,
          mode: "resize",
          handle,
          startPx: { x: px, y: py },
          startRect,
          currentRect: startRect,
          moved: false,
        };
        return true;
      }
    }

    for (let i = activeZones.length - 1; i >= 0; i--) {
      const z = activeZones[i];
      const rectPx = rectToPx(z, canvas);
      if (hitTestZoneBody(rectPx, px, py)) {
        setSelectedZoneIndex(i);
        const startRect: NormalizedRect = { x: z.x, y: z.y, w: z.w, h: z.h };
        zoneDragRef.current = {
          index: i,
          mode: "move",
          startPx: { x: px, y: py },
          startRect,
          currentRect: startRect,
          moved: false,
        };
        return true;
      }
    }

    setSelectedZoneIndex(null);
    return false;
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    // "좌석번호표 발주" 탭에서는 도면이 비교용 참고 이미지일 뿐이라 존 지정을 받지 않는다.
    if (activeTab === "seatNumber") return;
    if (editingIndex !== null) {
      setStatusMsg("스펙 수정 중에는 구역을 다시 지정할 수 없습니다. 취소 후 진행하세요.", "error");
      return;
    }
    if (!imgEl) {
      setStatusMsg("먼저 도면 이미지를 업로드하세요.", "error");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);

    // 존 유형을 선택했더라도, 클릭한 지점에 기존 구역(또는 그 구역의 삭제 아이콘/모서리
    // 핸들)이 있으면 새로 그리기보다 그 구역을 선택/편집하는 걸 우선한다 — 존 유형이 선택돼
    // 있으면 항상 새 구역 그리기만 되고 기존 구역을 수정할 수 없던 문제를 고친 것. 단, 이미
    // 첫 번째 모서리를 찍어 두 번째 클릭(반대쪽 모서리)을 기다리는 중이면 이 판단을 건너뛴다.
    if (!pendingStartRef.current) {
      const hitExisting = handleZoneSelectMouseDown(px, py, canvas);
      if (hitExisting || !selectedTypeKey) {
        return;
      }
    }

    if (!pendingStartRef.current) {
      pendingStartRef.current = { px, py };
      setDragHint("이제 우하단 지점을 클릭하세요.");
      drawCanvas();
      return;
    }

    const { px: x1, py: y1 } = pendingStartRef.current;
    const x2 = px;
    const y2 = py;
    pendingStartRef.current = null;
    setDragHint(DEFAULT_DRAG_HINT);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    drawCanvas();
    if (rw < 5 || rh < 5) {
      setStatusMsg("영역이 너무 작습니다. 다시 지정해주세요.", "error");
      return;
    }
    const rectNorm: NormalizedRect = {
      x: Math.min(x1, x2) / canvas.width,
      y: Math.min(y1, y2) / canvas.height,
      w: rw / canvas.width,
      h: rh / canvas.height,
    };
    setCurRect(rectNorm);
    openZoneForm(rectNorm);
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rectEl = canvas.getBoundingClientRect();
    const px = (e.clientX - rectEl.left) * (canvas.width / rectEl.width);
    const py = (e.clientY - rectEl.top) * (canvas.height / rectEl.height);

    const drag = zoneDragRef.current;
    if (drag) {
      // 캔버스 밖에서 마우스 버튼을 놓으면 이 엘리먼트에는 mouseup이 발생하지 않아 드래그
      // 상태가 그대로 남을 수 있다 — 버튼이 안 눌린 채로 다시 캔버스 위에 들어오면 그 상태를
      // 버려서, 손 놓은 드래그가 유령처럼 계속 움직이는 걸 막는다.
      if (e.buttons === 0) {
        zoneDragRef.current = null;
        drawCanvas();
        return;
      }
      const dxPx = px - drag.startPx.x;
      const dyPx = py - drag.startPx.y;
      if (Math.abs(dxPx) > ZONE_DRAG_MOVE_THRESHOLD || Math.abs(dyPx) > ZONE_DRAG_MOVE_THRESHOLD) {
        drag.moved = true;
      }
      const dxNorm = dxPx / canvas.width;
      const dyNorm = dyPx / canvas.height;
      let next: NormalizedRect;
      if (drag.mode === "move") {
        next = {
          x: Math.max(0, Math.min(1 - drag.startRect.w, drag.startRect.x + dxNorm)),
          y: Math.max(0, Math.min(1 - drag.startRect.h, drag.startRect.y + dyNorm)),
          w: drag.startRect.w,
          h: drag.startRect.h,
        };
      } else {
        const { x: sx, y: sy, w: sw, h: sh } = drag.startRect;
        let x1 = sx;
        let y1 = sy;
        let x2 = sx + sw;
        let y2 = sy + sh;
        if (drag.handle === "tl") {
          x1 = sx + dxNorm;
          y1 = sy + dyNorm;
        } else if (drag.handle === "tr") {
          x2 = sx + sw + dxNorm;
          y1 = sy + dyNorm;
        } else if (drag.handle === "bl") {
          x1 = sx + dxNorm;
          y2 = sy + sh + dyNorm;
        } else if (drag.handle === "br") {
          x2 = sx + sw + dxNorm;
          y2 = sy + sh + dyNorm;
        }
        const cx1 = Math.max(0, Math.min(1, x1));
        const cy1 = Math.max(0, Math.min(1, y1));
        const cx2 = Math.max(0, Math.min(1, x2));
        const cy2 = Math.max(0, Math.min(1, y2));
        next = {
          x: Math.min(cx1, cx2),
          y: Math.min(cy1, cy2),
          w: Math.abs(cx2 - cx1),
          h: Math.abs(cy2 - cy1),
        };
      }
      drag.currentRect = next;
      drawCanvas();
      return;
    }

    if (!pendingStartRef.current) return;
    drawCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#000";
    ctx.setLineDash([4, 2]);
    ctx.lineWidth = 1.5;
    const { px: startPx, py: startPy } = pendingStartRef.current;
    ctx.strokeRect(Math.min(startPx, px), Math.min(startPy, py), Math.abs(px - startPx), Math.abs(py - startPy));
    ctx.setLineDash([]);
  }

  // 리사이즈/이동 드래그를 마치면(마우스를 뗄 때) 최종 위치를 반영하고, 위치가 실제로 바뀐
  // 경우에만(단순 클릭과 구분) 그 구역을 다시 AI 인식해서 수정 폼으로 확인시킨다 — 위치가
  // 바뀌면 크롭되는 이미지 영역도 달라지므로 이전 인식 결과는 더 이상 맞다고 볼 수 없다.
  // 드래그가 끝나면 위치만 조용히 반영하고, 곧바로 재인식 폼을 띄우지 않는다 — 양쪽을 번갈아
  // 조정해야 하는 경우 매번 팝업이 뜨면 취소하고 다시 조정하느라 불편하다는 피드백을 반영해,
  // 다 조정한 뒤 Enter를 눌렀을 때만(handleZoneEnterKey) 재인식 폼을 띄우도록 분리했다.
  function handleCanvasMouseUp() {
    const drag = zoneDragRef.current;
    zoneDragRef.current = null;
    if (!drag || !drag.moved) {
      drawCanvas();
      return;
    }
    const finalRect = drag.currentRect;
    if (activeTab === "desk") {
      setProject((p) => {
        const zones = [...p.zones];
        zones[drag.index] = { ...zones[drag.index], ...finalRect };
        return { ...p, zones };
      });
    } else {
      setProject((p) => {
        const pcZones = [...p.pcZones];
        pcZones[drag.index] = { ...pcZones[drag.index], ...finalRect };
        return { ...p, pcZones };
      });
    }
    setDirtyZoneIndex(drag.index);
    setStatusMsg(
      "구역 위치를 변경했습니다 — 아직 재인식 전입니다(노란 느낌표). 다 조정했으면 Enter를 눌러 다시 인식하세요.",
      "success",
    );
  }

  // ---------------- 존 유형 선택 ----------------
  function selectType(key: ZoneTypeKey) {
    setSelectedTypeKey(key);
  }

  const selectedType = ZONE_TYPES.find((t) => t.key === selectedTypeKey) ?? null;
  const nextNamePreview = useMemo(() => {
    if (!selectedType) return "";
    if (selectedType.key === "etc") return "(직접 이름 입력)";
    return nextAvailableZoneName(activeZones, selectedType.key, selectedType.label);
  }, [selectedType, activeZones]);

  // 수정 폼에서 존 유형을 바꿀 때 미리보기/저장에 쓰는 이름 — 자기 자신은 후보에서 제외하고,
  // 이미 쓰이고 있지 않은 이름 중 가장 앞선 걸 고른다 (예: 멀티존A가 이미 있으면 이 존은
  // 멀티존B가 됨. 멀티존A가 삭제되어 없다면 멀티존A로 채워짐).
  function nameForEditType(typeKey: ZoneTypeKey): string {
    if (typeKey === "etc") return editEtcNameDraft || "기타존";
    const type = ZONE_TYPES.find((t) => t.key === typeKey);
    if (!type) return editEtcNameDraft || "기타존";
    return nextAvailableZoneName(activeZones, typeKey, type.label, editingIndex);
  }

  // ---------------- AI 자동 인식 ----------------
  function cropZoneImageBase64(rect: NormalizedRect): string {
    if (!imgEl) throw new Error("이미지가 없습니다.");
    const sx = rect.x * imgEl.naturalWidth;
    const sy = rect.y * imgEl.naturalHeight;
    const sw = rect.w * imgEl.naturalWidth;
    const sh = rect.h * imgEl.naturalHeight;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(sw));
    off.height = Math.max(1, Math.round(sh));
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("캔버스를 생성할 수 없습니다.");
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, off.width, off.height);
    return off.toDataURL("image/jpeg", 0.92).split(",")[1];
  }

  async function runRecognize(rect: NormalizedRect, tab: TabKey) {
    if (!user) return;
    setRecognizing(true);
    setAiResultText("AI가 인식하는 중...");
    setStatusMsg("AI 인식 중...");
    try {
      const base64 = cropZoneImageBase64(rect);
      const token = await user.getIdToken();
      const res = await fetch("/api/seat-layout/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg", mode: tab }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "인식에 실패했습니다.");

      const seats: number = data.seats ?? 0;
      const deskSize: DeskSize | null = data.deskSize ?? null;
      const sizeBreakdown: SizeBreakdownEntry[] | undefined = data.sizeBreakdown;
      const bagShelfCount: number | undefined = data.bagShelfCount;

      if (tab === "desk") {
        setBagShelfDraft(String(bagShelfCount ?? 0));
        const bagShelfMsg = bagShelfCount ? ` / 가방 선반(아이락스 헤드셋걸이) ${bagShelfCount}석` : "";
        if (sizeBreakdown && sizeBreakdown.length) {
          setBreakdown(sizeBreakdown.map((r) => ({ ...r })));
          const total = sizeBreakdown.reduce((s, r) => s + r.qty, 0);
          const sizeMsg = sizeBreakdown.map((r) => `${r.deskSize} ${r.qty}개`).join(", ");
          setAiResultText(`AI 인식 결과: 총 ${total}석 (${sizeMsg})${bagShelfMsg} — 틀리면 아래에서 직접 수정하세요.`);
        } else {
          const size = deskSize ?? DESK_SIZE_OPTIONS[0];
          setBreakdown([{ deskSize: size, qty: seats }]);
          const sizeMsg = deskSize ? `책상사이즈 ${deskSize}` : "책상사이즈 인식 실패(직접 선택 필요)";
          setAiResultText(
            `AI 인식 결과: ${seats}석 / ${sizeMsg}${bagShelfMsg} — 사이즈가 섞여있으면 아래에서 줄을 나눠주세요.`,
          );
        }
      } else {
        setSeatsDraft(String(seats));
        setAiResultText(`AI 인식 결과: ${seats}대 (틀리면 아래에서 직접 수정하세요)`);
      }
      setStatusMsg("인식 완료 — 이대로 괜찮으면 바로 저장하세요", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      setAiResultText(`인식 실패: ${message} — 아래 항목을 직접 입력해주세요.`);
      setStatusMsg("AI 인식 실패 - 수동 입력 필요", "error");
      if (tab === "desk") {
        setBreakdown([{ deskSize: DESK_SIZE_OPTIONS[0], qty: 0 }]);
        setBagShelfDraft("0");
      }
    } finally {
      setRecognizing(false);
    }
  }

  // ---------------- 존 구역 초안 제안 (테스트용) ----------------
  // 도면에는 존 이름표가 없어서(그건 사람이 정함) AI는 위치/좌석수만 제안하고, 유형은 전부
  // "기타"로 두고 사람이 확인하며 고르게 한다 — 기존 수동 작업과 마찬가지로, 존을 만든 뒤
  // 이름/유형을 바꾸려면 지우고 다시 그려야 하는 건 동일하다.
  const DRAFT_COLORS = ZONE_TYPES.filter((t) => t.key !== "etc").map((t) => t.color);

  async function suggestZoneDrafts() {
    if (!user || !floorPlanSrc) return;
    if (project.zones.length > 0) {
      const ok = window.confirm(
        `이미 존이 ${project.zones.length}개 있습니다. AI가 제안하는 구역 초안을 추가로 넣을까요?`,
      );
      if (!ok) return;
    }
    setZoneSuggestBusy(true);
    setStatusMsg("AI가 도면에서 구역 초안을 찾는 중...");
    try {
      const match = floorPlanSrc.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) throw new Error("도면 이미지 데이터를 읽을 수 없습니다.");
      const [, mimeType, data] = match;
      const token = await user.getIdToken();
      const res = await fetch("/api/seat-layout/suggest-zones", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: { data, mimeType } }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error ?? "구역 제안에 실패했습니다.");

      const suggestions: { seats: number; x: number; y: number; w: number; h: number }[] =
        resData.zones ?? [];
      const startIdx = project.zones.length;
      const drafts: DeskZone[] = suggestions.map((s, i) => ({
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        name: `AI제안${startIdx + i + 1}`,
        typeKey: "etc",
        color: DRAFT_COLORS[(startIdx + i) % DRAFT_COLORS.length],
        seats: s.seats,
        deskSize: DESK_SIZE_OPTIONS[0],
        sizeBreakdown: [{ deskSize: DESK_SIZE_OPTIONS[0], qty: s.seats }],
        desk: defaultDeskSpecValues(SPEC_FIELDS).desk,
        cooler: defaultDeskSpecValues(SPEC_FIELDS).cooler,
        partition: defaultDeskSpecValues(SPEC_FIELDS).partition,
        monitorArm: defaultDeskSpecValues(SPEC_FIELDS).monitorArm,
        chair: defaultDeskSpecValues(SPEC_FIELDS).chair,
        bagShelfCount: 0,
      }));

      setProject((p) => ({ ...p, zones: [...p.zones, ...drafts] }));
      setStatusMsg(
        `구역 초안 ${drafts.length}개를 추가했습니다 — 위치를 확인하고, 이름/유형이 다르면 ` +
          "지우고 다시 그려주세요 (참고용, 100% 정확하지 않을 수 있습니다).",
        "success",
      );
    } catch (err) {
      setStatusMsg(`구역 제안 실패: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setZoneSuggestBusy(false);
    }
  }

  // ---------------- 좌석번호표 인식 ----------------
  // 통짜 이미지 한 장만 AI에게 주면, 좌석이 촘촘하게 몰린 구역은 내부적으로 축소되며 글씨가
  // 뭉개져 통째로 못 읽는 경우가 있었다(93석짜리 피난안내도에서 14석이 통째로 누락된 사례 확인).
  // 그래서 전체 이미지 1장에 더해 좌상단/우상단/좌하단/우하단을 확대한 이미지 4장을 같이
  // 보내서, 그룹 경계는 전체 이미지로 판단하고 작은 글씨는 확대본으로 검증하게 한다. (9/11 존이
  // 맞았던 조합 — 여기서 더 손대지 않고 이대로 확정한다.)
  async function buildSeatNumberTiles(
    dataUrl: string,
  ): Promise<{ data: string; mimeType: string }[]> {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      img.src = dataUrl;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const toPngBase64 = (sx: number, sy: number, sw: number, sh: number) => {
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(sw));
      off.height = Math.max(1, Math.round(sh));
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("캔버스를 생성할 수 없습니다.");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, off.width, off.height);
      return off.toDataURL("image/png").split(",")[1];
    };
    // 사분면 경계에 걸친 번호가 잘리지 않도록 살짝 겹치게 자른다.
    const overlapRatio = 0.1;
    const halfW = w / 2;
    const halfH = h / 2;
    const ow = w * overlapRatio;
    const oh = h * overlapRatio;
    const clampW = (sx: number, sw: number) => Math.min(sw, w - sx);
    const clampH = (sy: number, sh: number) => Math.min(sh, h - sy);
    const quadrants: [number, number, number, number][] = [
      [0, 0, halfW + ow, halfH + oh], // 좌상단
      [Math.max(0, halfW - ow), 0, halfW + ow, halfH + oh], // 우상단
      [0, Math.max(0, halfH - oh), halfW + ow, halfH + oh], // 좌하단
      [Math.max(0, halfW - ow), Math.max(0, halfH - oh), halfW + ow, halfH + oh], // 우하단
    ];
    const data = [
      toPngBase64(0, 0, w, h),
      ...quadrants.map(([sx, sy, sw, sh]) => toPngBase64(sx, sy, clampW(sx, sw), clampH(sy, sh))),
    ];
    return data.map((d) => ({ data: d, mimeType: "image/png" }));
  }

  // 좌석번호표(피난안내도 등)는 도면과 별개의 그림이라 좌표를 그대로 겹칠 수 없다. 그래서 존별
  // "좌석 수"(이미 등록되어 있음)를 기준으로, 이미지에서 읽은 번호 그룹을 그 개수와 대조해 매칭한다.
  // 존 이름/색상 박스가 그려진 책상 배치도 1장 — 피난안내도의 어느 구역이 어느 존인지 AI가
  // 위치로 대응시키는 기준으로 쓰인다. 기존 FHD 합성용 캔버스(compositeCanvasRef)를 그대로
  // 재사용한다.
  // PC 발주 도면에서 사양 차이로 존을 더 쪼갠 경우(예: "FPS존A"/"FPS존B")까지 AI가 한 번에 구분해
  // 채울 수 있도록, PC 존이 있으면 PC 존 기준으로, 아직 PC 탭을 안 채웠으면 책상 존 기준으로 인식한다.
  function getSeatNumberRecognitionZones(): (DeskZone | PcZone)[] {
    return project.pcZones.length ? project.pcZones : project.zones;
  }

  function buildZoneReferenceImageBase64(): string | null {
    const cv = compositeCanvasRef.current;
    if (!cv || !imgEl) return null;
    cv.width = COMPOSITE_W;
    cv.height = COMPOSITE_H;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    if (project.pcZones.length) {
      renderPcFloorplanImage(ctx, imgEl, project.name, project.pcZones, pcDefaults);
    } else {
      renderDeskFloorplanImage(ctx, imgEl, project.name, project.zones);
    }
    return cv.toDataURL("image/png").split(",")[1];
  }

  async function runSeatNumberRecognize(dataUrlOverride?: string) {
    const dataUrl = dataUrlOverride ?? rawSeatNumberPlateDataUrl ?? project.seatNumberPlateDataUrl;
    if (!user || !dataUrl) return;
    const recognitionZones = getSeatNumberRecognitionZones();
    if (!recognitionZones.length) {
      setStatusMsg("먼저 책상 발주 도면(또는 PC 발주 도면) 탭에서 존을 등록해주세요.", "error");
      return;
    }
    const zoneImageData = buildZoneReferenceImageBase64();
    if (!zoneImageData) {
      setStatusMsg("먼저 도면을 업로드하세요.", "error");
      return;
    }
    setSeatNumberRecognizing(true);
    setStatusMsg("AI로 좌석번호 채워보는 중... (참고용 — 직접 입력한 존은 건드리지 않습니다)");
    try {
      const images = await buildSeatNumberTiles(dataUrl);
      const token = await user.getIdToken();
      const res = await fetch("/api/seat-layout/recognize-seat-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          zoneImage: { data: zoneImageData, mimeType: "image/png" },
          images,
          zones: recognitionZones.map((z) => ({ name: z.name, seats: z.seats })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "인식에 실패했습니다.");
      const ranges: SeatNumberRangeEntry[] = data.ranges ?? [];
      const warnings: string[] = data.warnings ?? [];
      const unmatchedGroups: { ranges: string; count: number }[] = data.unmatchedGroups ?? [];
      // 사람이 직접 고친 값은 AI 결과로 덮어쓰지 않는다. 다만 이전에 AI가 채워 넣고 사람이 손을
      // 대지 않은 값은, AI가 이번엔 스스로 고칠 수 있게 계속 덮어쓸 수 있어야 한다 (안 그러면
      // AI의 예전 오답이 영영 안 고쳐진 채로 남는다).
      let filledCount = 0;
      setProject((p) => {
        const manuallyFilledZoneNames = new Set(
          p.seatNumberRanges
            .filter((r) => r.ranges.trim() && !aiFilledZoneNamesRef.current.has(r.zoneName))
            .map((r) => r.zoneName),
        );
        const additions = ranges.filter((r) => !manuallyFilledZoneNames.has(r.zoneName));
        filledCount = additions.length;
        if (!additions.length) return p;
        additions.forEach((a) => aiFilledZoneNamesRef.current.add(a.zoneName));
        const rest = p.seatNumberRanges.filter(
          (r) => !additions.some((a) => a.zoneName === r.zoneName),
        );
        return { ...p, seatNumberRanges: [...rest, ...additions] };
      });
      setSeatNumberWarnings(warnings);
      setSeatNumberUnmatchedGroups(unmatchedGroups);
      if (filledCount) {
        setStatusMsg(
          `AI가 ${filledCount}개 존을 채웠습니다 — 틀릴 수 있으니 꼭 도면과 비교해서 확인하세요. ` +
            (warnings.length ? "나머지는 아래 안내를 보고 직접 입력하세요." : ""),
          "success",
        );
      } else {
        setStatusMsg(
          "AI가 새로 채운 존이 없습니다 (이미 직접 입력했거나, 인식에 실패했어요). " +
            "오른쪽에서 도면과 비교하며 직접 입력해주세요.",
          "error",
        );
      }
    } catch (err) {
      setStatusMsg(`AI 자동 채우기 실패: ${err instanceof Error ? err.message : err} — 직접 입력해주세요.`, "error");
    } finally {
      setSeatNumberRecognizing(false);
    }
  }

  // 좌석번호표(피난안내도 등)는 안내문구/범례가 많이 섞여 있어 처음부터 통째로 인식을 시키면
  // 실패하기 쉽다. 그래서 도면 업로드와 동일하게, 등록 즉시 인식하지 않고 먼저 크롭 화면을
  // 띄워 필요한 영역만 고르게 한다 (전체를 그대로 쓰려면 크롭 화면의 버튼으로 건너뛸 수 있다).
  async function handleSeatNumberPlateFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      setStatusMsg("PDF에서 페이지를 불러오는 중...");
      try {
        const pdf = await loadPdfDocument(file);
        pdfDocRef.current = pdf;
        const pages: { pageNumber: number; thumbnail: string }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          pages.push({ pageNumber: i, thumbnail: await renderPdfPageToDataUrl(pdf, i, 260) });
        }
        setPdfPickerTarget("seatNumberPlate");
        setPdfPickerPages(pages);
        setStatusMsg(`PDF ${pdf.numPages}페이지 중 좌석번호표(피난안내도) 페이지를 선택해주세요.`, "success");
      } catch (err) {
        setStatusMsg(`PDF를 읽지 못했습니다: ${err instanceof Error ? err.message : err}`, "error");
      } finally {
        e.target.value = "";
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      const probe = new Image();
      probe.onload = () => {
        cropImgRef.current = probe;
        setCropTarget("seatNumberPlate");
        setPdfCropSource({ dataUrl, width: probe.naturalWidth, height: probe.naturalHeight });
        setCropRect(null);
        setCropHint("좌석 번호가 보이는 영역의 왼쪽 위를 클릭하세요 (안내문구/범례는 빼고).");
      };
      probe.onerror = () => setStatusMsg("좌석번호표 이미지를 읽지 못했습니다.", "error");
      probe.src = dataUrl;
    };
    reader.onerror = () => setStatusMsg("좌석번호표 이미지를 읽지 못했습니다.", "error");
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function setSeatNumberRangeFor(zoneName: string, value: string) {
    // 사람이 손으로 직접 고친 값이므로, 이후 AI 자동 채우기가 이 존은 더 이상 건드리지 않게
    // "AI가 채운 값" 표시를 지운다.
    aiFilledZoneNamesRef.current.delete(zoneName);
    setProject((p) => {
      const rest = p.seatNumberRanges.filter((r) => r.zoneName !== zoneName);
      return { ...p, seatNumberRanges: value ? [...rest, { zoneName, ranges: value }] : rest };
    });
  }

  // 벽 경계가 존 구분과 안 맞는 도면은 자동 배정이 잘 안 되는 게 정상이라, 매칭 못한 그룹을
  // 클립보드로 복사해서 사람이 알맞은 존에 빠르게 옮겨 적을 수 있게 돕는다.
  async function copySeatNumberGroup(ranges: string) {
    try {
      await navigator.clipboard.writeText(ranges);
      setStatusMsg(`"${ranges}" 복사됨 — 알맞은 존의 입력칸에 붙여넣으세요.`, "success");
    } catch {
      setStatusMsg("복사에 실패했습니다. 숫자를 직접 옮겨 적어주세요.", "error");
    }
  }

  // ---------------- 존 폼 열기/닫기 ----------------
  function openZoneForm(rect: NormalizedRect) {
    if (!selectedTypeKey) return;
    setEditingIndex(null);
    setEtcName("");
    setEtcColor("#555555");
    setSeatsDraft("");
    setBreakdown([{ deskSize: DESK_SIZE_OPTIONS[0], qty: 0 }]);
    setBagShelfDraft("0");

    if (activeTab === "desk") {
      setDeskSpecDraft(resetDeskSpecDraft(selectedTypeKey, effectiveSpecFields, settings.typeDefaults));
    } else {
      setPcSpecDraft(resetPcSpecDraft(selectedTypeKey, pcDefaults, settings.pcTypeDefaults));
    }
    setFormOpen(true);
    void runRecognize(rect, activeTab);
  }

  function editZone(index: number) {
    const z = activeZones[index];
    setEditingIndex(index);
    setCurRect(null);
    setFormOpen(true);
    // 드래그로 위치를 바꾼 뒤 Enter로 열린 경우, 이 값이 runRecognize가 끝날 때까지 잠깐 보이다가
    // "AI가 인식하는 중..."으로 바로 바뀐다 — 인식이 진행/완료 중인지 폼 안에서 알 수 있게 한다.
    setAiResultText("아래 값을 직접 입력하거나 \"다시 인식\"을 눌러 AI로 확인할 수 있습니다.");
    setEditTypeDraft(z.typeKey);
    setEditEtcNameDraft(z.typeKey === "etc" ? z.name : "");
    setEditEtcColorDraft(z.typeKey === "etc" ? z.color : "#555555");

    if (activeTab === "desk") {
      const dz = z as DeskZone;
      setBreakdown(
        dz.sizeBreakdown?.length
          ? dz.sizeBreakdown.map((r) => ({ ...r }))
          : [{ deskSize: (dz.deskSize || DESK_SIZE_OPTIONS[0]) as DeskSize, qty: dz.seats || 0 }],
      );
      setBagShelfDraft(String(dz.bagShelfCount ?? 0));
      setDeskSpecDraft({
        desk: dz.desk,
        cooler: dz.cooler,
        partition: dz.partition,
        monitorArm: dz.monitorArm,
        chair: dz.chair,
      });
    } else {
      const pz = z as PcZone;
      setSeatsDraft(String(pz.seats ?? ""));
      setPcSpecDraft({ ...pcDefaults, ...pz.pcOverrides });
    }
    setStatusMsg(`"${z.name}"을(를) 수정하는 중입니다. 아래에서 스펙이나 존 유형을 바꿀 수 있습니다.`);
  }

  function cancelZone() {
    setFormOpen(false);
    setCurRect(null);
    setEditingIndex(null);
    setBreakdown([]);
    setSeatsDraft("");
    setBagShelfDraft("0");
    pendingStartRef.current = null;
    drawCanvas();
  }

  function confirmZone() {
    if (editingIndex !== null) {
      const editType = ZONE_TYPES.find((t) => t.key === editTypeDraft);
      const newName = nameForEditType(editTypeDraft);
      const newColor = editTypeDraft === "etc" ? editEtcColorDraft : editType?.color ?? "#8D7B68";
      if (activeTab === "desk") {
        const filtered = breakdown.filter((r) => r.qty > 0);
        const totalSeats = filtered.reduce((s, r) => s + r.qty, 0);
        setProject((p) => {
          const zones = [...p.zones];
          const z = { ...zones[editingIndex] };
          z.typeKey = editTypeDraft;
          z.name = newName;
          z.color = newColor;
          z.sizeBreakdown = filtered;
          z.deskSize = filtered.length ? filtered[0].deskSize : "";
          z.seats = totalSeats;
          z.bagShelfCount = Math.max(0, Math.min(Number(bagShelfDraft) || 0, totalSeats));
          z.desk = deskSpecDraft.desk;
          z.cooler = deskSpecDraft.cooler;
          z.partition = deskSpecDraft.partition;
          z.monitorArm = deskSpecDraft.monitorArm;
          z.chair = deskSpecDraft.chair;
          zones[editingIndex] = z;
          return { ...p, zones };
        });
      } else {
        setProject((p) => {
          const pcZones = [...p.pcZones];
          const z = { ...pcZones[editingIndex] };
          z.typeKey = editTypeDraft;
          z.name = newName;
          z.color = newColor;
          z.seats = Math.max(0, Number(seatsDraft) || 0);
          z.pcOverrides = computePcOverrides();
          pcZones[editingIndex] = z;
          return { ...p, pcZones };
        });
      }
      setStatusMsg("스펙이 수정되었습니다.", "success");
      cancelZone();
      return;
    }

    if (!curRect || !selectedType) return;
    const isEtc = selectedType.key === "etc";
    const name = isEtc ? etcName || "기타존" : nextNamePreview;
    const color = isEtc ? etcColor : selectedType.color;

    if (activeTab === "desk") {
      const filtered = breakdown.filter((r) => r.qty > 0);
      if (!filtered.length) {
        setStatusMsg("수량이 0입니다. 사이즈별 수량을 확인해주세요.", "error");
        return;
      }
      const totalSeats = filtered.reduce((s, r) => s + r.qty, 0);
      const zNew: DeskZone = {
        ...curRect,
        name,
        typeKey: selectedType.key,
        color,
        sizeBreakdown: filtered,
        deskSize: filtered[0].deskSize,
        seats: totalSeats,
        bagShelfCount: Math.max(0, Math.min(Number(bagShelfDraft) || 0, totalSeats)),
        desk: deskSpecDraft.desk,
        cooler: deskSpecDraft.cooler,
        partition: deskSpecDraft.partition,
        monitorArm: deskSpecDraft.monitorArm,
        chair: deskSpecDraft.chair,
      };
      setProject((p) => ({ ...p, zones: [...p.zones, zNew] }));
    } else {
      // 책상은 있지만 PC는 없는 존(예: 라운지 책상)을 표시만 하고 발주 수량엔 안 넣고 싶을 수
      // 있어서, 0대 등록도 허용한다.
      const seats = Math.max(0, Number(seatsDraft) || 0);
      const zNew: PcZone = {
        ...curRect,
        name,
        typeKey: selectedType.key,
        color,
        seats,
        pcOverrides: computePcOverrides(),
      };
      setProject((p) => ({ ...p, pcZones: [...p.pcZones, zNew] }));
    }

    cancelZone();
  }

  function computePcOverrides(): PcSpecValues {
    return diffPcOverrides(pcSpecDraft, pcDefaults);
  }

  function deleteZone(index: number) {
    if (activeTab === "desk") {
      setProject((p) => ({ ...p, zones: p.zones.filter((_, i) => i !== index) }));
    } else {
      setProject((p) => ({ ...p, pcZones: p.pcZones.filter((_, i) => i !== index) }));
    }
    // 삭제로 인덱스가 밀리면 선택/재인식-필요 표시가 엉뚱한 존을 가리킬 수 있으니 초기화한다.
    setSelectedZoneIndex(null);
    setDirtyZoneIndex(null);
  }

  // ---------------- PC 기본사양 ----------------
  const basicPcQty = computeBasicPcQty(project.pcZones);

  function savePcDefaults() {
    const merged: PcSpecValues = {};
    effectivePcSpecFields.forEach((f) => {
      merged[f.id] = pcDefaultsDraft[f.id] || f.def;
    });
    setPcDefaults(merged);
    setStatusMsg("PC 기본사양이 반영되었습니다. (존별로 다르게 지정한 항목만 별도 표시됩니다)", "success");
  }

  // 사양설정이 바뀐 뒤에도 예전에 만든 프로젝트는 "전역 PC 기본사양"(project.pcDefaults)과
  // 존별 재정의 값 모두 프로젝트 생성/저장 당시 값을 그대로 갖고 있어 최신 사양설정과 어긋날 수
  // 있다 — 존 하나씩 "수정"에서 새로고침하는 대신, 전역 기본값부터 사양설정의 최신 값으로 다시
  // 불러온 뒤, 그 새 기본값 기준으로 PC 존 전체를 한 번에 되돌린다. 존마다 따로 고쳐둔 값도
  // 함께 되돌아간다.
  function refreshAllPcZoneDefaults() {
    const ok = window.confirm(
      `전역 PC 기본사양과 PC 존 ${project.pcZones.length}개의 사양을 모두 사양설정의 최신 값으로 ` +
        "새로고침합니다. 존마다 따로 고쳐둔 사양이 있다면 그 값도 기본값으로 되돌아갑니다. 계속할까요?",
    );
    if (!ok) return;
    const freshDefaults = pcDefaultsFromFields(
      PC_SPEC_FIELDS.map((f) => ({ ...f, def: settings.pcDefaults[f.id] || f.def })),
    );
    setPcDefaults(freshDefaults);
    setPcDefaultsDraft(freshDefaults);
    setProject((p) => ({
      ...p,
      pcZones: p.pcZones.map((z) => {
        const draft = resetPcSpecDraft(z.typeKey, freshDefaults, settings.pcTypeDefaults);
        return { ...z, pcOverrides: diffPcOverrides(draft, freshDefaults) };
      }),
    }));
    setStatusMsg(
      `전역 PC 기본사양과 PC 존 ${project.pcZones.length}개의 사양을 최신 기본값으로 새로고침했습니다. "프로젝트 저장"을 눌러야 반영됩니다.`,
      "success",
    );
  }

  function importDeskZonesToPc() {
    if (!project.zones.length) {
      setStatusMsg("책상 발주 도면에 존이 없습니다. 먼저 책상 탭에서 구역을 지정해주세요.", "error");
      return;
    }
    if (project.pcZones.length > 0) {
      const ok = window.confirm(
        `이미 PC 존이 ${project.pcZones.length}개 있습니다. 책상 구역으로 덮어쓸까요? (기존 PC 존/사양은 사라집니다)`,
      );
      if (!ok) return;
    }
    const pcZones: PcZone[] = project.zones
      .map((z) => {
        const typeDef = settings.pcTypeDefaults[z.typeKey] ?? {};
        const overrides: PcSpecValues = {};
        (Object.keys(typeDef) as PcSpecFieldId[]).forEach((k) => {
          if (typeDef[k] !== (pcDefaults[k] ?? "")) overrides[k] = typeDef[k];
        });
        return {
          x: z.x,
          y: z.y,
          w: z.w,
          h: z.h,
          name: z.name,
          typeKey: z.typeKey,
          color: z.color,
          // "책상만 설치" 존은 PC가 없는 존이라, 책상 좌석수를 그대로 옮기지 않고 0대로 불러온다.
          seats: z.typeKey === "desk_only" ? 0 : z.seats,
          pcOverrides: overrides,
        };
      });
    setProject((p) => ({ ...p, pcZones }));
    setStatusMsg(`책상 구역 ${pcZones.length}개를 PC 탭으로 불러왔습니다. 사양이 필요한 존만 [수정]으로 바꿔주세요.`, "success");
  }

  // ---------------- 프로젝트 CRUD ----------------
  async function handleSelectProject(id: string) {
    if (!id) return;
    setBusy(true);
    setStatusMsg("불러오는 중...");
    try {
      const loaded = await loadProject(id);
      if (!loaded) {
        setStatusMsg("프로젝트를 찾을 수 없습니다.", "error");
        return;
      }
      hasLoadedProjectRef.current = true;
      // emptyProject()로 기본값을 먼저 채워서, 이 필드가 추가되기 전에 저장된 옛날 프로젝트를
      // 불러와도 seatNumberPlateDataUrl/seatNumberRanges 등이 undefined가 되지 않게 한다.
      setProject({ ...emptyProject(), ...loaded });
      setRawSeatNumberPlateDataUrl(null);
      setSeatNumberWarnings([]);
      setSeatNumberUnmatchedGroups([]);
      aiFilledZoneNamesRef.current.clear();
      setRawFloorPlanDataUrl(null);
      setActiveTab("desk");
      setSelectedTypeKey(null);
      setSelectedZoneIndex(null);
      setDirtyZoneIndex(null);
      cancelZone();
      closeCrop();
      cancelPdfPicker();
      setSeatNumberImageModalOpen(false);
      setPcDefaults(loaded.pcDefaults ?? pcDefaultsFromFields(effectivePcSpecFields));
      setPcDefaultsDraft(loaded.pcDefaults ?? pcDefaultsFromFields(effectivePcSpecFields));
      setStatusMsg("불러오기 완료", "success");
    } catch (err) {
      setStatusMsg(`불러오기 실패: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function newProject() {
    setProject({ id: crypto.randomUUID(), ...emptyProject() });
    setRawFloorPlanDataUrl(null);
    setRawSeatNumberPlateDataUrl(null);
    setSeatNumberWarnings([]);
    setSeatNumberUnmatchedGroups([]);
    aiFilledZoneNamesRef.current.clear();
    setPcDefaults(pcDefaultsFromFields(effectivePcSpecFields));
    setPcDefaultsDraft(pcDefaultsFromFields(effectivePcSpecFields));
    setActiveTab("desk");
    setSelectedTypeKey(null);
    setSelectedZoneIndex(null);
    setDirtyZoneIndex(null);
    cancelZone();
    closeCrop();
    cancelPdfPicker();
    setSeatNumberImageModalOpen(false);
    setStatusMsg("새 프로젝트를 시작합니다.");
  }

  async function deleteCurrentProject() {
    if (!project.updatedAt) {
      setStatusMsg("삭제할 프로젝트가 저장되어 있지 않습니다.", "error");
      return;
    }
    const name = project.name || "(이름없음)";
    if (!window.confirm(`"${name}" 프로젝트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    setStatusMsg("삭제 중...");
    try {
      await deleteProject(project.id);
      setStatusMsg(`"${name}" 프로젝트를 삭제했습니다.`, "success");
      newProject();
      await refreshProjectList();
    } catch (err) {
      setStatusMsg(`삭제 실패: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function silentSave(): Promise<SeatLayoutProject | null> {
    if (!user) return null;
    try {
      // Firestore 문서 용량 제한 때문에, 저장하는 순간에만 압축한다. 화면/AI 인식은 계속
      // rawFloorPlanDataUrl(원본 화질)을 쓴다 — 압축본으로 덮어쓰지 않는다.
      let floorPlanDataUrl = project.floorPlanDataUrl;
      if (rawFloorPlanDataUrl) {
        const compressed = await compressImageDataUrl(rawFloorPlanDataUrl);
        floorPlanDataUrl = compressed.dataUrl;
      }
      let seatNumberPlateDataUrl = project.seatNumberPlateDataUrl;
      if (rawSeatNumberPlateDataUrl) {
        const compressed = await compressImageDataUrl(rawSeatNumberPlateDataUrl);
        seatNumberPlateDataUrl = compressed.dataUrl;
      }
      const toSave: SeatLayoutProject = {
        ...project,
        name: project.name || "이름없음",
        pcDefaults,
        floorPlanDataUrl,
        seatNumberPlateDataUrl,
      };
      const saved = await saveProject(toSave, user.uid);
      setProject(saved);
      await refreshProjectList();
      return saved;
    } catch (err) {
      setStatusMsg(`저장 중 오류: ${err instanceof Error ? err.message : err}`, "error");
      return null;
    }
  }

  async function handleSaveClick() {
    setBusy(true);
    setStatusMsg("저장 중...");
    const saved = await silentSave();
    if (saved) setStatusMsg("저장되었습니다.", "success");
    setBusy(false);
  }

  function applyFloorPlanDataUrl(dataUrl: string, width: number, height: number) {
    // 원본 화질 그대로 세션에 보관 (화면 표시 + AI 인식용). Firestore 저장용 압축은
    // silentSave에서 저장 직전에만 한다 — 여기서 미리 압축해두면 인식 정확도가 떨어진다.
    setRawFloorPlanDataUrl(dataUrl);
    setProject((p) => ({ ...p, imageWidth: width, imageHeight: height }));
  }

  function applyFloorPlanDataUrlFromProbe(dataUrl: string) {
    const probe = new Image();
    probe.onload = () => applyFloorPlanDataUrl(dataUrl, probe.naturalWidth, probe.naturalHeight);
    probe.src = dataUrl;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      setStatusMsg("PDF에서 페이지를 불러오는 중...");
      try {
        const pdf = await loadPdfDocument(file);
        pdfDocRef.current = pdf;
        const pages: { pageNumber: number; thumbnail: string }[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          pages.push({ pageNumber: i, thumbnail: await renderPdfPageToDataUrl(pdf, i, 260) });
        }
        setPdfPickerTarget("floorplan");
        setPdfPickerPages(pages);
        setStatusMsg(`PDF ${pdf.numPages}페이지 중 배치도 페이지를 선택해주세요.`, "success");
      } catch (err) {
        setStatusMsg(`PDF를 읽지 못했습니다: ${err instanceof Error ? err.message : err}`, "error");
      } finally {
        e.target.value = "";
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => applyFloorPlanDataUrlFromProbe(evt.target?.result as string);
    reader.onerror = () => setStatusMsg("도면 파일을 읽지 못했습니다.", "error");
    reader.readAsDataURL(file);
  }

  async function selectPdfPage(pageNumber: number) {
    const pdf = pdfDocRef.current;
    if (!pdf) return;
    setPdfPickerBusy(true);
    setStatusMsg("선택한 페이지를 고해상도로 불러오는 중...");
    try {
      const dataUrl = await renderPdfPageToDataUrl(pdf, pageNumber, 10000);
      const probe = new Image();
      await new Promise<void>((resolve, reject) => {
        probe.onload = () => resolve();
        probe.onerror = () => reject(new Error("페이지 이미지를 불러오지 못했습니다."));
        probe.src = dataUrl;
      });
      cropImgRef.current = probe;
      setCropTarget(pdfPickerTarget);
      setPdfCropSource({ dataUrl, width: probe.naturalWidth, height: probe.naturalHeight });
      setCropRect(null);
      setCropHint(
        pdfPickerTarget === "seatNumberPlate"
          ? "좌석 번호가 보이는 영역의 왼쪽 위를 클릭하세요 (안내문구/범례는 빼고)."
          : "도면 영역의 왼쪽 위를 클릭하세요 (제목 블록/범례 표는 빼고 도면만).",
      );
      setPdfPickerPages(null);
      pdfDocRef.current = null;
      setStatusMsg(
        pdfPickerTarget === "seatNumberPlate"
          ? "좌석번호가 보이는 영역만 지정해주세요."
          : "실제 배치도 영역만 지정해주세요.",
        "success",
      );
    } catch (err) {
      setStatusMsg(`페이지를 불러오지 못했습니다: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setPdfPickerBusy(false);
    }
  }

  function cancelPdfPicker() {
    setPdfPickerPages(null);
    pdfDocRef.current = null;
  }

  // ---------------- PDF 페이지 크롭 (제목 블록/범례 등을 빼고 도면 영역만 선택) ----------------
  useEffect(() => {
    const canvas = cropCanvasRef.current;
    const img = cropImgRef.current;
    if (!canvas || !img || !pdfCropSource) return;
    // 좌석번호표 크롭은 팝업으로 크게 띄우므로(최대 1600px), 900px 그대로면 화면을 다 못 채워
    // 작은 번호 글씨를 정확히 찍기 어렵다. 팝업 폭에 맞춰 캔버스 해상도를 키운다.
    const canvasWidth = cropTarget === "seatNumberPlate" ? 1500 : 900;
    canvas.width = canvasWidth;
    canvas.height = canvasWidth * (img.naturalHeight / img.naturalWidth);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawGridLines(ctx, canvas);
    if (cropRect) {
      const x = cropRect.x * canvas.width;
      const y = cropRect.y * canvas.height;
      const w = cropRect.w * canvas.width;
      const h = cropRect.h * canvas.height;
      ctx.strokeStyle = "#F29801";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "rgba(242, 152, 1, 0.12)";
      ctx.fillRect(x, y, w, h);
    }
  }, [pdfCropSource, cropRect]);

  function handleCropCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (cropRect) setCropRect(null); // 이미 지정된 게 있으면 새로 다시 지정

    if (!cropPendingStartRef.current) {
      cropPendingStartRef.current = { px, py };
      setCropHint("이제 도면 영역의 오른쪽 아래를 클릭하세요.");
      return;
    }

    const { px: x1, py: y1 } = cropPendingStartRef.current;
    cropPendingStartRef.current = null;
    const rw = Math.abs(px - x1);
    const rh = Math.abs(py - y1);
    if (rw < 10 || rh < 10) {
      setCropHint("영역이 너무 작습니다. 다시 지정해주세요.");
      return;
    }
    setCropRect({
      x: Math.min(x1, px) / canvas.width,
      y: Math.min(y1, py) / canvas.height,
      w: rw / canvas.width,
      h: rh / canvas.height,
    });
    setCropHint("영역이 지정됐습니다. 확인을 누르거나, 다시 클릭해서 새로 지정하세요.");
  }

  // 첫 번째 클릭 이후 마우스를 움직이는 동안 눈금선 위에 점선 사각형을 실시간으로 그려서,
  // 두 번째 지점을 클릭하기 전에 자를 영역을 미리 볼 수 있게 한다.
  function handleCropCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!cropPendingStartRef.current) return;
    const canvas = cropCanvasRef.current;
    const img = cropImgRef.current;
    if (!canvas || !img) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawGridLines(ctx, canvas);

    const { px, py } = cropPendingStartRef.current;
    ctx.strokeStyle = "#F29801";
    ctx.setLineDash([6, 3]);
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.min(px, x), Math.min(py, y), Math.abs(x - px), Math.abs(y - py));
    ctx.setLineDash([]);
  }

  function confirmCrop() {
    const img = cropImgRef.current;
    if (!img || !cropRect) return;
    const sx = cropRect.x * img.naturalWidth;
    const sy = cropRect.y * img.naturalHeight;
    const sw = cropRect.w * img.naturalWidth;
    const sh = cropRect.h * img.naturalHeight;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(sw));
    off.height = Math.max(1, Math.round(sh));
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, off.width, off.height);
    const dataUrl = off.toDataURL("image/png");

    if (cropTarget === "seatNumberPlate") {
      closeCrop();
      setRawSeatNumberPlateDataUrl(dataUrl);
      setStatusMsg(
        "좌석번호표를 등록했습니다 — 오른쪽에서 도면과 나란히 보면서 존별로 직접 입력하거나, " +
          "\"AI로 자동 채워보기\"를 눌러보세요.",
        "success",
      );
    } else {
      applyFloorPlanDataUrl(dataUrl, off.width, off.height);
      closeCrop();
      setStatusMsg("도면 영역을 잘라서 불러왔습니다. \"프로젝트 저장\"을 눌러야 보관됩니다.", "success");
    }
  }

  function useCropSourceAsIs() {
    if (!pdfCropSource) return;
    if (cropTarget === "seatNumberPlate") {
      const dataUrl = pdfCropSource.dataUrl;
      closeCrop();
      setRawSeatNumberPlateDataUrl(dataUrl);
      setStatusMsg(
        "좌석번호표를 등록했습니다 — 오른쪽에서 도면과 나란히 보면서 존별로 직접 입력하거나, " +
          "\"AI로 자동 채워보기\"를 눌러보세요.",
        "success",
      );
    } else {
      applyFloorPlanDataUrl(pdfCropSource.dataUrl, pdfCropSource.width, pdfCropSource.height);
      closeCrop();
      setStatusMsg("도면을 불러왔습니다. \"프로젝트 저장\"을 눌러야 보관됩니다.", "success");
    }
  }

  function closeCrop() {
    setPdfCropSource(null);
    setCropRect(null);
    cropPendingStartRef.current = null;
    cropImgRef.current = null;
  }

  // 방금 업로드한(또는 이미 갖고 있던) 좌석번호표 이미지에서 필요한 영역만 잘라서 재인식한다.
  // 피난안내도처럼 안내문구/범례가 많이 섞인 이미지에서 인식이 잘 안 될 때 쓰라고 만든 기능이다 —
  // 잘라내면 상대적으로 확대되는 효과라 작은 번호 글씨의 인식률이 올라간다.
  function openSeatNumberPlateCrop() {
    const dataUrl = rawSeatNumberPlateDataUrl ?? project.seatNumberPlateDataUrl;
    if (!dataUrl) return;
    const probe = new Image();
    probe.onload = () => {
      cropImgRef.current = probe;
      setCropTarget("seatNumberPlate");
      setPdfCropSource({ dataUrl, width: probe.naturalWidth, height: probe.naturalHeight });
      setCropRect(null);
      setCropHint("좌석 번호가 보이는 도면 영역의 왼쪽 위를 클릭하세요 (안내문구/범례는 빼고).");
    };
    probe.onerror = () => setStatusMsg("좌석번호표 이미지를 불러오지 못했습니다.", "error");
    probe.src = dataUrl;
  }

  // ---------------- 합성 이미지 (FHD) ----------------
  // 책상 발주 도면 / PC 발주 도면 / 발주 요약표, 이렇게 항상 3장을 만든다 (현재 탭과 무관하게 전체 프로젝트 기준).
  type ExportItem = { key: string; label: string; dataUrl: string };

  function renderAllOutputs(): ExportItem[] | null {
    const cv = compositeCanvasRef.current;
    if (!cv || !imgEl) {
      setStatusMsg("먼저 도면을 업로드하세요.", "error");
      return null;
    }
    cv.width = COMPOSITE_W;
    cv.height = COMPOSITE_H;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;

    renderDeskFloorplanImage(ctx, imgEl, project.name, project.zones);
    const desk = { key: "desk", label: "책상발주도면", dataUrl: cv.toDataURL("image/png") };

    renderPcFloorplanImage(ctx, imgEl, project.name, project.pcZones, pcDefaults);
    const pc = { key: "pc", label: "PC발주도면", dataUrl: cv.toDataURL("image/png") };

    renderOrderSummaryImage(ctx, project.name, project.zones, project.seatNumberRanges, project.pcZones);
    const summary = { key: "summary", label: "발주요약", dataUrl: cv.toDataURL("image/png") };

    return [desk, pc, summary];
  }

  async function handleDownload() {
    if (!imgEl) {
      setStatusMsg("먼저 도면을 업로드하세요.", "error");
      return;
    }
    setBusy(true);
    setStatusMsg("저장 중...");
    const saved = await silentSave();
    if (!saved) {
      setBusy(false);
      return;
    }
    const outputs = renderAllOutputs();
    if (outputs) {
      outputs.forEach((item) => {
        const link = document.createElement("a");
        link.download = `${project.name || "floorplan"}_${item.label}_FHD.png`;
        link.href = item.dataUrl;
        link.click();
      });
      setStatusMsg(`FHD 이미지 ${outputs.length}장을 다운로드했습니다.`, "success");
    }
    setBusy(false);
  }

  async function handlePublishToSlides() {
    if (!imgEl || !user) {
      setStatusMsg("먼저 도면을 업로드하세요.", "error");
      return;
    }
    setBusy(true);
    setStatusMsg("저장 중...");
    setPresentationUrl(null);
    const saved = await silentSave();
    if (!saved) {
      setBusy(false);
      return;
    }
    const outputs = renderAllOutputs();
    if (outputs) {
      try {
        setStatusMsg("공유 프레젠테이션에 등록 중... (몇 초 걸릴 수 있습니다)");
        const token = await user.getIdToken();
        let latestUrl = "";
        // 맨 앞(0번)에 꽂히는 순서라, 화면에서 desk→pc→summary 순으로 보이도록 역순으로 등록한다.
        for (const item of [...outputs].reverse()) {
          const res = await fetch("/api/seat-layout/publish-slide", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              slideKey: `${saved.id}_${item.key}`,
              projectName: `${saved.name}_${item.label}`,
              imageDataUrl: item.dataUrl,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(`${item.label}: ${data.error ?? "등록에 실패했습니다."}`);
          latestUrl = data.presentationUrl;
        }
        setStatusMsg(`등록 완료! (프레젠테이션에 ${outputs.length}장 반영됨)`, "success");
        if (latestUrl) {
          setPresentationUrl(latestUrl);
          // await 이후의 window.open은 브라우저 팝업 차단에 걸리는 경우가 많아, 아래
          // "프레젠테이션 열기" 링크를 항상 같이 보여준다. 열리면 좋고, 막히면 링크를 누르면 된다.
          window.open(latestUrl, "_blank");
        }
      } catch (err) {
        setStatusMsg(`등록 실패: ${err instanceof Error ? err.message : err}`, "error");
      }
    }
    setBusy(false);
  }

  async function handlePublishDeskOrder() {
    if (!user) {
      setStatusMsg("로그인이 필요합니다.", "error");
      return;
    }
    if (!project.zones.length) {
      setStatusMsg("먼저 책상 발주 도면 탭에서 존을 등록해주세요.", "error");
      return;
    }
    setBusy(true);
    setStatusMsg("저장 중...");
    setDeskOrderSheetUrl(null);
    const saved = await silentSave();
    if (!saved) {
      setBusy(false);
      return;
    }
    try {
      setStatusMsg("통합발주서에 등록 중... (몇 초 걸릴 수 있습니다)");
      const token = await user.getIdToken();
      const res = await fetch("/api/seat-layout/publish-desk-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectName: saved.name, zones: saved.zones }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "등록에 실패했습니다.");
      setStatusMsg(`통합발주서에 등록 완료! ("${data.sheetTitle}" 탭)`, "success");
      setDeskOrderSheetUrl(data.spreadsheetUrl);
      window.open(data.spreadsheetUrl, "_blank");
    } catch (err) {
      setStatusMsg(`통합발주서 등록 실패: ${err instanceof Error ? err.message : err}`, "error");
    }
    setBusy(false);
  }

  // 좌석번호를 입력받을 존 이름 목록 — 기본은 책상 발주 도면의 존이지만, PC 발주 도면에서만
  // 사양 차이로 존을 더 쪼갠 경우(예: 책상은 "FPS존A" 하나인데 PC는 "FPS존A"/"FPS존B"로 나눠
  // 사양을 다르게 지정한 경우) 그 PC 전용 존 이름도 함께 포함해서, 나뉜 만큼 번호를 따로 입력할
  // 수 있게 한다.
  const seatNumberZoneNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    project.zones.forEach((z) => {
      if (!seen.has(z.name)) {
        seen.add(z.name);
        names.push(z.name);
      }
    });
    project.pcZones.forEach((z) => {
      if (!seen.has(z.name)) {
        seen.add(z.name);
        names.push(z.name);
      }
    });
    return names;
  }, [project.zones, project.pcZones]);

  // 위 목록 순서를 기준으로, 좌석번호가 입력된 존만 뽑는다. PC 스펙(GPU/모니터/키보드/마우스)은
  // 같은 이름의 PC 존에 지정된 값이 있으면 그걸, 없으면 전역 PC 기본사양을 쓴다 — 도면/표에서
  // 실제로 적용되는 값과 동일한 우선순위다. 존 유형은 PC 존 쪽 값을 우선하고(PC 전용 존은
  // 책상 쪽에 대응하는 존이 없으므로), 없으면 책상 존의 유형을 쓴다.
  function buildSeatNumberSheetEntries() {
    return seatNumberZoneNames
      .map((name) => {
        const rangeEntry = project.seatNumberRanges.find((r) => r.zoneName === name && r.ranges);
        if (!rangeEntry) return null;
        const pcZone = project.pcZones.find((pz) => pz.name === name);
        const deskZone = project.zones.find((dz) => dz.name === name);
        const typeKey = pcZone?.typeKey ?? deskZone?.typeKey;
        if (!typeKey) return null;
        const overrides = pcZone?.pcOverrides ?? {};
        const spec = (fieldId: PcSpecFieldId) =>
          overrides[fieldId] ?? pcDefaults[fieldId] ?? PC_SPEC_FIELDS.find((f) => f.id === fieldId)?.def ?? "";
        return {
          zoneName: name,
          ranges: rangeEntry.ranges,
          typeKey,
          gpu: spec("gpu"),
          monitor: spec("monitor"),
          keyboard: spec("keyboard"),
          mouse: spec("mouse"),
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
  }

  function openSeatNumberSheetDialog() {
    if (!user) {
      setStatusMsg("로그인이 필요합니다.", "error");
      return;
    }
    if (!buildSeatNumberSheetEntries().length) {
      setStatusMsg("먼저 존별 좌석번호를 입력해주세요.", "error");
      return;
    }
    setSeatNumberStoreInfoOpen(true);
  }

  async function handlePublishSeatNumberSheet() {
    if (!user) {
      setStatusMsg("로그인이 필요합니다.", "error");
      return;
    }
    const entries = buildSeatNumberSheetEntries();
    if (!entries.length) {
      setStatusMsg("먼저 존별 좌석번호를 입력해주세요.", "error");
      return;
    }

    setSeatNumberStoreInfoOpen(false);
    setBusy(true);
    setStatusMsg("저장 중...");
    setSeatNumberSheetUrl(null);
    const saved = await silentSave();
    if (!saved) {
      setBusy(false);
      return;
    }
    try {
      setStatusMsg("좌석번호표 시트에 등록 중... (몇 초 걸릴 수 있습니다)");
      const token = await user.getIdToken();
      const res = await fetch("/api/seat-layout/publish-seat-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectName: saved.name, entries, storeInfo: storeInfoDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "등록에 실패했습니다.");
      setStatusMsg(`좌석번호표 시트에 등록 완료! ("${data.sheetTitle}" 탭)`, "success");
      setSeatNumberSheetUrl(data.spreadsheetUrl);
      window.open(data.spreadsheetUrl, "_blank");
    } catch (err) {
      setStatusMsg(`시트 등록 실패: ${err instanceof Error ? err.message : err}`, "error");
    }
    setBusy(false);
  }

  // 도면 크롭과 좌석번호표 크롭이 화면 UI를 공유한다 — cropTarget에 따라 렌더링 위치만
  // 다르게 배치한다 (도면 캔버스 자리를 좌석번호표 크롭이 가리지 않도록).
  function cropPanel() {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{cropHint}</p>
        <div className="mt-2 overflow-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800">
          <canvas
            ref={cropCanvasRef}
            onMouseDown={handleCropCanvasMouseDown}
            onMouseMove={handleCropCanvasMouseMove}
            className="max-w-full cursor-crosshair"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!cropRect}
            onClick={confirmCrop}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            이 영역으로 자르기
          </button>
          <button
            type="button"
            onClick={useCropSourceAsIs}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {cropTarget === "seatNumberPlate" ? "자르지 않고 전체 이미지 사용" : "자르지 않고 페이지 전체 사용"}
          </button>
          <button
            type="button"
            onClick={closeCrop}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  // ---------------- 렌더 ----------------
  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 홈으로
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            아이센스 PC방 좌석배치도 작업 툴
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {user?.isAnonymous ? "사내 공용 접속" : `${user?.email} 님으로 로그인됨`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            ⚙ 사양 설정
          </button>
          {!user?.isAnonymous && (
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              로그아웃
            </button>
          )}
        </div>
      </header>

      {/* 다운로드/공유 버튼을 화면 맨 아래에 두면 스크롤을 많이 해야 찾을 수 있어서, 상단에 고정(sticky)해
          스크롤 위치와 무관하게 항상 바로 누를 수 있게 한다. */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleDownload}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            이미지 다운로드
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handlePublishToSlides}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            책상의자PC범례 데이터 등록
          </button>
          {presentationUrl && (
            <a
              href={presentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-amber-700 underline hover:text-amber-800 dark:text-amber-500"
            >
              프레젠테이션 열기 ↗
            </a>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={handlePublishDeskOrder}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            인테/가맹 통합발주서 등록
          </button>
          {deskOrderSheetUrl && (
            <a
              href={deskOrderSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-amber-700 underline hover:text-amber-800 dark:text-amber-500"
            >
              발주서 열기 ↗
            </a>
          )}
        </div>
        {status.text && (
          <p className={`text-sm ${statusToneClass(status.tone)}`}>{status.text}</p>
        )}
      </div>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async (next) => {
            if (!user) return;
            const saved = await saveSeatLayoutSettings(next, user.uid);
            setSettings(saved);
            setStatusMsg("사양 설정이 저장되었습니다.", "success");
            setSettingsOpen(false);
          }}
        />
      )}

      {/* 좌석번호표 시트 등록 전, 양식 5행에 들어갈 매장정보를 입력받는 팝업. 아직 확정 안 된
          정보가 많을 수 있어 전부 선택 입력(비워도 등록 가능)으로 둔다. */}
      {seatNumberStoreInfoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-950">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              좌석번호표 시트 등록 - 매장정보
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              아직 정해지지 않은 항목은 비워두고 등록해도 됩니다.
            </p>
            <div className="mt-3 space-y-2">
              <input
                value={storeInfoDraft.openDate}
                onChange={(e) => setStoreInfoDraft((d) => ({ ...d, openDate: e.target.value }))}
                placeholder="매장 오픈일 (예: 26.07.17)"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <input
                value={storeInfoDraft.deliveryDate}
                onChange={(e) => setStoreInfoDraft((d) => ({ ...d, deliveryDate: e.target.value }))}
                placeholder="입고 희망일 (예: 26.07.14)"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="flex gap-2">
                <input
                  value={storeInfoDraft.svName}
                  onChange={(e) => setStoreInfoDraft((d) => ({ ...d, svName: e.target.value }))}
                  placeholder="담당 SV 이름"
                  className="flex-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <input
                  value={storeInfoDraft.svPhone}
                  onChange={(e) => setStoreInfoDraft((d) => ({ ...d, svPhone: e.target.value }))}
                  placeholder="담당 SV 연락처"
                  className="flex-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={storeInfoDraft.ownerName}
                  onChange={(e) => setStoreInfoDraft((d) => ({ ...d, ownerName: e.target.value }))}
                  placeholder="점주님 이름"
                  className="flex-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <input
                  value={storeInfoDraft.ownerPhone}
                  onChange={(e) => setStoreInfoDraft((d) => ({ ...d, ownerPhone: e.target.value }))}
                  placeholder="점주님 연락처"
                  className="flex-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <input
                value={storeInfoDraft.address}
                onChange={(e) => setStoreInfoDraft((d) => ({ ...d, address: e.target.value }))}
                placeholder="매장 주소"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSeatNumberStoreInfoOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handlePublishSeatNumberSheet}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 좌석번호표 크롭은 좌측 사이드바(폭 380px) 안에 그대로 넣으면 크롭용 캔버스가 심하게
          축소되어 영역을 정확히 찍기 어려워진다. 그래서 팝업으로 크게 띄운다. */}
      {pdfCropSource && cropTarget === "seatNumberPlate" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
          <div className="max-h-[96vh] w-full max-w-[96vw] overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-zinc-950 xl:max-w-[1600px]">
            {cropPanel()}
          </div>
        </div>
      )}

      {/* 피난안내도를 원본 해상도 그대로 크게 보고 싶을 때 (작은 번호 글씨 확인용). 스크롤해서
          이동하면서 볼 수 있게 이미지를 축소하지 않고 그대로 띄운다. */}
      {seatNumberImageModalOpen && seatNumberPlateSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
          onClick={() => setSeatNumberImageModalOpen(false)}
        >
          <div
            className="max-h-[96vh] max-w-[96vw] overflow-auto rounded-2xl bg-white p-2 shadow-xl dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">피난안내도</p>
              <button
                type="button"
                onClick={() => setSeatNumberImageModalOpen(false)}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                닫기
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={seatNumberPlateSrc} alt="피난안내도 확대" className="max-w-none" />
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-950">
            <div className="flex-1 overflow-y-auto p-5">
              <ZoneForm
                mode={editingIndex !== null ? "edit" : "create"}
                activeTab={activeTab}
                title={
                  editingIndex !== null
                    ? `스펙 수정 — ${activeZones[editingIndex]?.name ?? ""}`
                    : selectedType?.key === "etc"
                      ? "존 정보 입력 (기타)"
                      : `존 정보 입력 — ${nextNamePreview}`
                }
                isEtc={editingIndex === null && selectedType?.key === "etc"}
                etcName={etcName}
                onEtcNameChange={setEtcName}
                etcColor={etcColor}
                onEtcColorChange={setEtcColor}
                editTypeKey={editTypeDraft}
                onEditTypeChange={(key) => {
                  setEditTypeDraft(key);
                  if (activeTab === "desk") {
                    setDeskSpecDraft(resetDeskSpecDraft(key, effectiveSpecFields, settings.typeDefaults));
                  } else {
                    setPcSpecDraft(resetPcSpecDraft(key, pcDefaults, settings.pcTypeDefaults));
                  }
                }}
                editNamePreview={nameForEditType(editTypeDraft)}
                editEtcName={editEtcNameDraft}
                onEditEtcNameChange={setEditEtcNameDraft}
                editEtcColor={editEtcColorDraft}
                onEditEtcColorChange={setEditEtcColorDraft}
                showAi
                aiResultText={aiResultText}
                recognizing={recognizing}
                onRecognizeAgain={() => {
                  const rect = editingIndex !== null ? activeZones[editingIndex] : curRect;
                  if (rect) void runRecognize(rect, activeTab);
                }}
                breakdown={breakdown}
                onBreakdownChange={setBreakdown}
                bagShelfDraft={bagShelfDraft}
                onBagShelfDraftChange={setBagShelfDraft}
                deskSpecDraft={deskSpecDraft}
                onDeskSpecChange={(id, v) => setDeskSpecDraft((d) => ({ ...d, [id]: v }))}
                seatsDraft={seatsDraft}
                onSeatsDraftChange={setSeatsDraft}
                pcSpecDraft={pcSpecDraft}
                onPcSpecChange={(id, v) => setPcSpecDraft((d) => ({ ...d, [id]: v }))}
                onResetPcSpecToDefaults={() =>
                  setPcSpecDraft(resetPcSpecDraft(editTypeDraft, pcDefaults, settings.pcTypeDefaults))
                }
                specFields={effectiveSpecFields}
                pcSpecFields={effectivePcSpecFields}
                pcSuggestions={settings.pcSuggestions}
              />
            </div>
            <div className="flex gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={confirmZone}
                className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                저장
              </button>
              <button
                type="button"
                onClick={cancelZone}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
        {(["desk", "pc", "seatNumber"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
              setSelectedTypeKey(null);
              setSelectedZoneIndex(null);
              setDirtyZoneIndex(null);
              cancelZone();
            }}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === tab
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab === "desk" ? "책상 발주 도면" : tab === "pc" ? "PC 발주 도면" : "좌석번호표 발주"}
          </button>
        ))}
      </div>

      {activeTab === "pc" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">책상 구역 불러오기</p>
          <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/70">
            책상 발주 도면에서 지정한 구역을 그대로 가져와서 PC 존으로 씁니다. 이름/색상/좌표/대수는 그대로 복사되고,
            PC 사양은 기본사양으로 시작합니다.
          </p>
          <button
            type="button"
            onClick={importDeskZonesToPc}
            className="mt-3 rounded-full bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            책상 구역 불러오기
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">불러올 프로젝트 (매장)</label>
            <select
              value={project.updatedAt ? project.id : ""}
              onChange={(e) => handleSelectProject(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">-- 프로젝트 선택 --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={newProject}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                + 새 프로젝트
              </button>
              <button
                type="button"
                onClick={deleteCurrentProject}
                className="flex-1 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                선택한 프로젝트 삭제
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">매장명 / 도면</label>
              {imgEl && (
                <button
                  type="button"
                  onClick={() => setUploadPanelOpen((v) => !v)}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {uploadPanelOpen ? "▾ 접기" : "▸ 매장명/도면 변경"}
                </button>
              )}
            </div>

            {uploadPanelOpen ? (
              <>
                <input
                  value={project.name}
                  onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
                  placeholder="예: 광주첨단점"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <label
                  htmlFor="floorplan-file-input"
                  className="mt-3 block cursor-pointer text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  도면 이미지 업로드 (이미지 또는 PDF)
                </label>
                <input
                  id="floorplan-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="mt-1 w-full text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition file:duration-150 hover:file:bg-zinc-700 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-white"
                />
                <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-500">
                  도면은 모든 탭에서 공통으로 사용됩니다.
                  <br />
                  💡 도면 이미지는 PDF로 등록하세요 — 화면 캡처보다 훨씬 선명해요.
                  <br />
                  💡 책가방선반 브라켓 표시가 있는 도면을 사용하세요 — 헤드셋걸이 종류가 자동으로 구분돼요.
                </p>
                {pdfPickerPages && pdfPickerTarget === "floorplan" && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      배치도(평면도) 페이지를 클릭해서 선택해주세요
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {pdfPickerPages.map((p) => (
                        <button
                          key={p.pageNumber}
                          type="button"
                          disabled={pdfPickerBusy}
                          onClick={() => selectPdfPage(p.pageNumber)}
                          className="group flex flex-col items-center gap-1 rounded-lg border border-zinc-300 bg-white p-1.5 transition hover:border-amber-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.thumbnail}
                            alt={`${p.pageNumber}페이지`}
                            className="aspect-[4/3] w-full rounded object-contain"
                          />
                          <span className="text-xs text-zinc-500 group-hover:text-amber-700 dark:text-zinc-400">
                            {p.pageNumber}페이지
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={cancelPdfPicker}
                      className="mt-2 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      취소
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-1 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                <span className="font-medium">{project.name || "(매장명 미입력)"}</span>
                <span className="text-xs text-zinc-400">· 도면 업로드됨</span>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveClick}
                className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                프로젝트 저장
              </button>
            </div>
          </section>

          {activeTab === "seatNumber" && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <label
              htmlFor="seat-number-plate-input"
              className="block cursor-pointer text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              좌석번호표 (선택 — 피난안내도 등, 이미지 또는 PDF)
            </label>
            <input
              id="seat-number-plate-input"
              ref={seatNumberPlateInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleSeatNumberPlateFileChange}
              className="mt-1 w-full text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition file:duration-150 hover:file:bg-zinc-700 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-white"
            />
            <p className="mt-1 text-xs text-zinc-400">
              등록하면 먼저 필요한 영역만 잘라낼 수 있고, 그 뒤 존별 좌석번호 범위를 자동으로
              인식해서 발주요약(슬라이드3)에 함께 넣습니다. 번호 인식은 100% 정확하지 않을 수
              있어요 — 틀린 부분은 아래에서 직접 고치면 됩니다.
            </p>

            {/* 스크롤해서 아래로 내려가야 겨우 보이던 문제 때문에, 등록 버튼은 이 탭 맨 위(업로드
                입력 바로 아래)에 둔다 — 좌석번호를 아직 안 채웠으면 눌러도 에러 메시지만 뜬다. */}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={openSeatNumberSheetDialog}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
              >
                좌석번호표 발주 등록
              </button>
              {seatNumberSheetUrl && (
                <a
                  href={seatNumberSheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-amber-700 underline hover:text-amber-800 dark:text-amber-500"
                >
                  시트 열기 ↗
                </a>
              )}
            </div>

            {pdfPickerPages && pdfPickerTarget === "seatNumberPlate" && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  좌석번호표(피난안내도) 페이지를 클릭해서 선택해주세요
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {pdfPickerPages.map((p) => (
                    <button
                      key={p.pageNumber}
                      type="button"
                      disabled={pdfPickerBusy}
                      onClick={() => selectPdfPage(p.pageNumber)}
                      className="group flex flex-col items-center gap-1 rounded-lg border border-zinc-300 bg-white p-1.5 transition hover:border-amber-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.thumbnail}
                        alt={`${p.pageNumber}페이지`}
                        className="aspect-[4/3] w-full rounded object-contain"
                      />
                      <span className="text-xs text-zinc-500 group-hover:text-amber-700 dark:text-zinc-400">
                        {p.pageNumber}페이지
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={cancelPdfPicker}
                  className="mt-2 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  취소
                </button>
              </div>
            )}

            {(rawSeatNumberPlateDataUrl || project.seatNumberPlateDataUrl) && project.zones.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    {seatNumberRecognizing ? "AI가 채우는 중..." : "존별 좌석번호 (직접 입력, 틀리면 수정)"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={seatNumberRecognizing}
                      onClick={openSeatNumberPlateCrop}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      영역 다시 자르기
                    </button>
                    <button
                      type="button"
                      disabled={seatNumberRecognizing}
                      onClick={() => runSeatNumberRecognize()}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      AI로 자동 채워보기
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-400">
                  기본은 직접 입력입니다 — 오른쪽에서 책상 도면과 피난안내도를 나란히 보면서
                  아래 칸에 존별 번호를 적어주세요. "AI로 자동 채워보기"는 참고용이며, 이미
                  직접 입력한 존은 덮어쓰지 않습니다.
                </p>
                {seatNumberWarnings.map((w, i) => (
                  <p
                    key={i}
                    className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                  >
                    {w}
                  </p>
                ))}
                {seatNumberUnmatchedGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {seatNumberUnmatchedGroups.map((g, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => copySeatNumberGroup(g.ranges)}
                        title="클릭하면 복사됩니다"
                        className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-300 dark:hover:bg-amber-950/30"
                      >
                        {g.ranges} ({g.count}개) 복사
                      </button>
                    ))}
                  </div>
                )}
                {/* PC 발주 도면에서만 사양 차이로 존을 더 쪼갠 경우(예: 책상은 "FPS존A" 하나인데
                    PC는 "FPS존A"/"FPS존B"로 나눠 사양을 다르게 지정한 경우), 그 PC 전용 존 이름도
                    목록에 같이 보여줘서 좌석번호를 따로 입력할 수 있게 한다. */}
                {seatNumberZoneNames.map((name) => {
                  const entry = project.seatNumberRanges.find((r) => r.zoneName === name);
                  return (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-xs text-zinc-500" title={name}>
                        {name}
                      </span>
                      <input
                        value={entry?.ranges ?? ""}
                        onChange={(e) => setSeatNumberRangeFor(name, e.target.value)}
                        placeholder="예: 1~10, 25~30"
                        className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          )}

          {activeTab === "pc" && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <button
                type="button"
                onClick={() => {
                  setPcDefaultsOpen((v) => !v);
                  if (!pcDefaultsOpen) setPcDefaultsDraft(pcDefaults);
                }}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">PC 기본사양</span>
                <span className="text-xs font-medium text-zinc-500">{pcDefaultsOpen ? "▾ 접기" : "▸ 펼치기"}</span>
              </button>
              <p className="mt-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                PC 기본사양 - {basicPcQty}대 (카운터, 대체PC 포함)
              </p>
              {pcDefaultsOpen && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-zinc-400">
                    여기 값이 기본값이 되고, 존마다 다르게 지정한 항목만 별도로 표시됩니다.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {effectivePcSpecFields.map((f) => (
                      <PcFieldInput
                        key={f.id}
                        field={f}
                        value={pcDefaultsDraft[f.id] ?? f.def}
                        suggestions={settings.pcSuggestions[f.id]}
                        onChange={(v) => setPcDefaultsDraft((d) => ({ ...d, [f.id]: v }))}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={savePcDefaults}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    기본사양 반영
                  </button>
                  <button
                    type="button"
                    onClick={refreshAllPcZoneDefaults}
                    title="사양설정에서 바뀐 존 유형별 기본값을 PC 존 전체에 한 번에 다시 반영합니다 (존별로 직접 고친 항목도 함께 되돌아갑니다)"
                    className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                  >
                    ↻ PC 존 전체 사양 새로고침 ({project.pcZones.length}개)
                  </button>
                </div>
              )}
            </section>
          )}

          {activeTab !== "seatNumber" && (
            <>
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                {selectedTypeKey ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{dragHint}</p>
                ) : (
                  <ul className="space-y-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                    <li className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                      <span aria-hidden>⚠️</span>
                      <span>존 구역 설정 시 파티션이 겹치지 않게 구역을 지정합니다. (인식 정확도에 영향)</span>
                    </li>
                    <li className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                      <span aria-hidden>⚠️</span>
                      <span>책가방선반 설치 좌석은 구역 설정 시 브라켓 표시가 한 면이라도 겹치도록 지정합니다. (인식 정확도에 영향)</span>
                    </li>
                    <li>기존 구역을 클릭해서 선택한 뒤, 모서리를 드래그해 크기를, 안쪽을 드래그해 위치를 바꿀 수 있습니다.</li>
                    <li>노란 느낌표(!)는 책상 수량/사이즈 인식 전이라는 뜻입니다. 조정 후 Enter를 누르면 재인식됩니다.</li>
                    <li>선택된 구역의 오른쪽 위 × 를 누르면 삭제됩니다.</li>
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">존 목록</h2>
                  {activeTab === "desk" && floorPlanSrc && (
                    <button
                      type="button"
                      disabled={zoneSuggestBusy}
                      onClick={suggestZoneDrafts}
                      className="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                    >
                      {zoneSuggestBusy ? "제안받는 중..." : "AI로 구역 초안 제안받기 (테스트)"}
                    </button>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {activeZones.length === 0 && (
                    <p className="text-sm text-zinc-400">아직 등록된 존이 없습니다.</p>
                  )}
                  {activeZones.map((z, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-lg border-l-4 bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
                      style={{ borderLeftColor: z.color }}
                    >
                      <span className="text-zinc-700 dark:text-zinc-200">
                        {z.name} ({z.seats}
                        {activeTab === "pc" ? "대" : "개"})
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => editZone(i)}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteZone(i)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1">
              {/* 좌석번호표 크롭은 왼쪽 "좌석번호표" 섹션에 따로 표시한다 — 여기서 같이 보여주면
                  도면 크롭 때와 똑같이 도면 캔버스 자리를 가려서, 도면이 화면에서 사라진
                  것처럼 보이는 문제가 있었다. */}
              {pdfCropSource && cropTarget === "floorplan" ? (
                cropPanel()
              ) : (
                <div className="overflow-auto rounded-2xl border border-zinc-200 bg-zinc-100 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  {imgEl ? (
                    <canvas
                      ref={canvasRef}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      className="max-w-full cursor-crosshair rounded-lg border border-zinc-300 bg-white dark:border-zinc-700"
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
                      왼쪽에서 도면 이미지를 업로드하면 여기에 표시됩니다.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 존별 좌석번호는 결국 사람이 이 도면(왼쪽)과 피난안내도(오른쪽)를 눈으로 비교하며
                입력하는 작업이라, 두 이미지를 나란히 띄워주는 게 AI 자동인식보다 핵심 기능이다. */}
            {activeTab === "seatNumber" && seatNumberPlateSrc && (
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    피난안내도(좌석번호표)
                  </p>
                  <button
                    type="button"
                    onClick={() => setSeatNumberImageModalOpen(true)}
                    className="text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-amber-500"
                  >
                    크게 보기 ↗
                  </button>
                </div>
                <div className="max-h-[720px] overflow-auto rounded-2xl border border-zinc-200 bg-zinc-100 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={seatNumberPlateSrc}
                    alt="피난안내도"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700"
                  />
                </div>
              </div>
            )}

            {activeTab !== "seatNumber" && (
              <section className="w-full shrink-0 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 lg:w-44">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">① 존 유형</h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  클릭 후 도면에서 영역을 지정하면 이름/색상이 자동으로 부여됩니다
                </p>
                <div className="mt-3 flex flex-col gap-1.5">
                  {ZONE_TYPES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => selectType(t.key)}
                      style={{
                        background: t.color,
                        color: getContrastText(t.color),
                        boxShadow: selectedTypeKey === t.key ? "0 0 0 3px rgba(0,0,0,0.35) inset" : undefined,
                      }}
                      className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-semibold transition duration-150 hover:brightness-90 active:brightness-75"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {selectedType && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-zinc-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-zinc-200">
                    선택됨: <b style={{ color: selectedType.color }}>{selectedType.label}</b> → 다음 존 이름:{" "}
                    <b>{nextNamePreview}</b>
                  </div>
                )}
              </section>
            )}
          </div>
          <canvas ref={compositeCanvasRef} className="hidden" />
        </div>
      </div>
    </div>
  );
}

// ==================== 존 정보 입력 폼 ====================

type ZoneFormProps = {
  mode: "create" | "edit";
  activeTab: TabKey;
  title: string;
  isEtc: boolean;
  etcName: string;
  onEtcNameChange: (v: string) => void;
  etcColor: string;
  onEtcColorChange: (v: string) => void;
  // 수정 모드에서만 쓰는 존 유형 변경 (예: 멀티존A가 이미 있으면 멀티존B로 재배정)
  editTypeKey: ZoneTypeKey;
  onEditTypeChange: (key: ZoneTypeKey) => void;
  editNamePreview: string;
  editEtcName: string;
  onEditEtcNameChange: (v: string) => void;
  editEtcColor: string;
  onEditEtcColorChange: (v: string) => void;
  showAi: boolean;
  aiResultText: string;
  recognizing: boolean;
  onRecognizeAgain: () => void;
  breakdown: SizeBreakdownEntry[];
  onBreakdownChange: (next: SizeBreakdownEntry[]) => void;
  bagShelfDraft: string;
  onBagShelfDraftChange: (v: string) => void;
  deskSpecDraft: Record<SpecFieldId, string>;
  onDeskSpecChange: (id: SpecFieldId, value: string) => void;
  seatsDraft: string;
  onSeatsDraftChange: (v: string) => void;
  pcSpecDraft: PcSpecValues;
  onPcSpecChange: (id: PcSpecFieldId, value: string) => void;
  onResetPcSpecToDefaults: () => void;
  specFields: SpecField[];
  pcSpecFields: { id: PcSpecFieldId; label: string; def: string }[];
  pcSuggestions: Partial<Record<PcSpecFieldId, string[]>>;
};

function ZoneForm(props: ZoneFormProps) {
  const {
    mode,
    activeTab,
    title,
    isEtc,
    etcName,
    onEtcNameChange,
    etcColor,
    onEtcColorChange,
    editTypeKey,
    onEditTypeChange,
    editNamePreview,
    editEtcName,
    onEditEtcNameChange,
    editEtcColor,
    onEditEtcColorChange,
    showAi,
    aiResultText,
    recognizing,
    onRecognizeAgain,
    breakdown,
    onBreakdownChange,
    bagShelfDraft,
    onBagShelfDraftChange,
    deskSpecDraft,
    onDeskSpecChange,
    seatsDraft,
    onSeatsDraftChange,
    pcSpecDraft,
    onPcSpecChange,
    onResetPcSpecToDefaults,
    specFields,
    pcSpecFields,
    pcSuggestions,
  } = props;

  const breakdownTotal = breakdown.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>

      {mode === "edit" && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="text-xs font-medium text-zinc-500">존 유형 변경</label>
          <select
            value={editTypeKey}
            onChange={(e) => onEditTypeChange(e.target.value as ZoneTypeKey)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {ZONE_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            새 이름: <b className="text-zinc-700 dark:text-zinc-200">{editNamePreview}</b>
          </p>
          {editTypeKey === "etc" && (
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <div>
                <label className="text-xs font-medium text-zinc-500">존 이름 (직접입력)</label>
                <input
                  value={editEtcName}
                  onChange={(e) => onEditEtcNameChange(e.target.value)}
                  placeholder="예: 카운터존"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">색상</label>
                <input
                  type="color"
                  value={editEtcColor}
                  onChange={(e) => onEditEtcColorChange(e.target.value)}
                  className="mt-1 h-[38px] w-14 rounded-lg border border-zinc-300 dark:border-zinc-700"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {isEtc && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="text-xs font-medium text-zinc-500">존 이름 (직접입력)</label>
            <input
              value={etcName}
              onChange={(e) => onEtcNameChange(e.target.value)}
              placeholder="예: 카운터존"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500">색상</label>
            <input
              type="color"
              value={etcColor}
              onChange={(e) => onEtcColorChange(e.target.value)}
              className="mt-1 h-[38px] w-14 rounded-lg border border-zinc-300 dark:border-zinc-700"
            />
          </div>
        </div>
      )}

      {showAi && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            AI 자동인식 {activeTab === "pc" ? "(PC 대수)" : "(좌석 수량 + 책상사이즈)"}
          </p>
          <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/80">{aiResultText}</p>
          <button
            type="button"
            disabled={recognizing}
            onClick={onRecognizeAgain}
            className="mt-2 rounded-full border border-amber-400 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200"
          >
            다시 인식
          </button>
        </div>
      )}

      {activeTab === "desk" ? (
        <>
          <div>
            <div className="space-y-2">
              {breakdown.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  {i === 0 && <span className="w-16 shrink-0 text-xs text-zinc-500">책상사이즈</span>}
                  <select
                    value={row.deskSize}
                    onChange={(e) => {
                      const next = [...breakdown];
                      next[i] = { ...next[i], deskSize: e.target.value as DeskSize };
                      onBreakdownChange(next);
                    }}
                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {DESK_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    placeholder="수량"
                    value={row.qty || ""}
                    onChange={(e) => {
                      const next = [...breakdown];
                      next[i] = { ...next[i], qty: Number(e.target.value) || 0 };
                      onBreakdownChange(next);
                    }}
                    className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => onBreakdownChange(breakdown.filter((_, ri) => ri !== i))}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onBreakdownChange([...breakdown, { deskSize: DESK_SIZE_OPTIONS[0], qty: 0 }])}
              className="mt-2 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              + 다른 사이즈 추가 (섞여있을 때만)
            </button>
            <p className="mt-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
              합계: {breakdownTotal}석{breakdown.length > 1 ? ` (사이즈 ${breakdown.length}종 합산)` : ""}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-500">
              아이락스 헤드셋걸이 설치 수량
            </label>
            <input
              type="number"
              min={0}
              max={breakdownTotal}
              value={bagShelfDraft}
              onChange={(e) => onBagShelfDraftChange(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <p className="mt-1 text-xs text-zinc-400">
              나머지 {Math.max(0, breakdownTotal - (Number(bagShelfDraft) || 0))}석은 아이센스 헤드셋걸이로
              계산됩니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 border-t border-dashed border-zinc-200 pt-3 dark:border-zinc-800">
            {specFields.map((f) => (
              <SelectOrEtc
                key={f.id}
                field={f}
                value={deskSpecDraft[f.id]}
                onChange={(v) => onDeskSpecChange(f.id, v)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="text-xs font-medium text-zinc-500">대수</label>
            <input
              type="number"
              value={seatsDraft}
              onChange={(e) => onSeatsDraftChange(e.target.value)}
              placeholder="10"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <p className="mt-1 text-xs text-zinc-400">책상은 있지만 PC가 없는 존은 0을 입력하세요.</p>
          </div>
          {mode === "edit" && (
            <div className="border-t border-dashed border-zinc-200 pt-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={onResetPcSpecToDefaults}
                title="사양설정에서 바뀐 존 유형별 기본값을 이 존에도 다시 반영합니다 (직접 고친 항목도 함께 되돌아갑니다)"
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                ↻ 최신 기본값으로 새로고침
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-dashed border-zinc-200 pt-3 dark:border-zinc-800">
            {pcSpecFields.map((f) => (
              <PcFieldInput
                key={f.id}
                field={f}
                value={pcSpecDraft[f.id] ?? ""}
                suggestions={pcSuggestions[f.id]}
                onChange={(v) => onPcSpecChange(f.id, v)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 책상 탭 사양: 정해진 옵션 + "기타(직접입력)". 저장된 값이 목록에 없어도 옵션으로 끼워 넣어
// 한 줄로만 표시하고, 입력창은 사용자가 "기타(직접입력)"을 실제로 골랐을 때만 띄운다.
function SelectOrEtc({
  field,
  value,
  onChange,
}: {
  field: SpecField;
  value: string;
  onChange: (v: string) => void;
}) {
  const isKnown = field.options.includes(value);
  const [customMode, setCustomMode] = useState(false);
  const showCustomInput = customMode || (!isKnown && !value);
  return (
    <div>
      <label className="text-xs font-medium text-zinc-500">{field.label}</label>
      <select
        value={showCustomInput ? "__etc__" : value}
        onChange={(e) => {
          if (e.target.value === "__etc__") {
            setCustomMode(true);
          } else {
            setCustomMode(false);
            onChange(e.target.value);
          }
        }}
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        {!isKnown && value && <option value={value}>{value}</option>}
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        <option value="__etc__">기타(직접입력)</option>
      </select>
      {showCustomInput && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${field.label} 직접입력`}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      )}
    </div>
  );
}

// PC 탭 사양: 설정에 등록된 후보를 드롭다운으로 보여주고, 목록에 없는 값은 옵션에 끼워 넣어 그대로
// 표시한다. "기타(직접입력)"은 사용자가 실제로 그 항목을 골랐을 때만 입력창을 띄우는 용도다.
function PcFieldInput({
  field,
  value,
  suggestions,
  onChange,
}: {
  field: { id: PcSpecFieldId; label: string; def: string };
  value: string;
  suggestions?: string[];
  onChange: (v: string) => void;
}) {
  const options = suggestions ?? [];
  const isKnown = options.includes(value);
  const [customMode, setCustomMode] = useState(false);
  const showCustomInput = customMode || (!isKnown && !value);
  return (
    <div>
      <label className="text-xs font-medium text-zinc-500">{field.label}</label>
      <select
        value={showCustomInput ? "__etc__" : value}
        onChange={(e) => {
          if (e.target.value === "__etc__") {
            setCustomMode(true);
          } else {
            setCustomMode(false);
            onChange(e.target.value);
          }
        }}
        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        {!isKnown && value && <option value={value}>{value}</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        <option value="__etc__">기타(직접입력)</option>
      </select>
      {showCustomInput && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.def}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      )}
    </div>
  );
}
