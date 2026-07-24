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

function pcDefaultsFromFields(fields: { id: PcSpecFieldId; def: string }[]): PcSpecValues {
  const out: PcSpecValues = {};
  fields.forEach((f) => {
    out[f.id] = f.def;
  });
  return out;
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
  const [aiResultText, setAiResultText] = useState("");
  const [recognizing, setRecognizing] = useState(false);
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
    if (imgEl) setUploadPanelOpen(false);
  }, [imgEl]);
  // 방금 업로드한 원본 화질 도면 (세션 동안만 메모리에 유지, Firestore에는 저장 안 함).
  // AI 좌석 인식은 화질이 중요해서, Firestore 저장용으로 압축한 이미지가 아니라 이걸로 잘라낸다.
  const [rawFloorPlanDataUrl, setRawFloorPlanDataUrl] = useState<string | null>(null);
  // 좌석번호표(피난안내도 등) 원본 화질 이미지 — 번호 인식은 이걸로 하고, 저장 직전에만 압축한다.
  const [rawSeatNumberPlateDataUrl, setRawSeatNumberPlateDataUrl] = useState<string | null>(null);
  const [seatNumberRecognizing, setSeatNumberRecognizing] = useState(false);
  const seatNumberPlateInputRef = useRef<HTMLInputElement>(null);
  // PDF 업로드 시: 페이지가 여러 장이라 어떤 페이지가 배치도인지 직접 골라야 한다.
  const [pdfPickerPages, setPdfPickerPages] = useState<
    { pageNumber: number; thumbnail: string }[] | null
  >(null);
  const [pdfPickerBusy, setPdfPickerBusy] = useState(false);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  // PDF 페이지를 고른 다음: 제목 블록/범례 등을 빼고 실제 도면 영역만 잘라내는 단계.
  const [pdfCropSource, setPdfCropSource] = useState<
    { dataUrl: string; width: number; height: number } | null
  >(null);
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

  const activeZones = useMemo<ActiveZone[]>(
    () => (activeTab === "pc" ? project.pcZones : project.zones),
    [activeTab, project.pcZones, project.zones],
  );

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

  function drawZoneBox(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, z: ActiveZone) {
    const x = z.x * canvas.width;
    const y = z.y * canvas.height;
    const w = z.w * canvas.width;
    const h = z.h * canvas.height;
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 3;
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
    activeZones.forEach((z) => drawZoneBox(ctx, canvas, z));
  }

  useEffect(() => {
    drawCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl, activeZones]);

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (editingIndex !== null) {
      setStatusMsg("스펙 수정 중에는 구역을 다시 지정할 수 없습니다. 취소 후 진행하세요.", "error");
      return;
    }
    if (!imgEl) {
      setStatusMsg("먼저 도면 이미지를 업로드하세요.", "error");
      return;
    }
    if (!selectedTypeKey) {
      setStatusMsg("먼저 위에서 존 유형을 선택하세요.", "error");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);

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
    if (!pendingStartRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    drawCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#000";
    ctx.setLineDash([4, 2]);
    ctx.lineWidth = 1.5;
    const { px, py } = pendingStartRef.current;
    ctx.strokeRect(Math.min(px, x), Math.min(py, y), Math.abs(x - px), Math.abs(y - py));
    ctx.setLineDash([]);
  }

  // ---------------- 존 유형 선택 ----------------
  function selectType(key: ZoneTypeKey) {
    setSelectedTypeKey(key);
  }

  const selectedType = ZONE_TYPES.find((t) => t.key === selectedTypeKey) ?? null;
  const nextNamePreview = useMemo(() => {
    if (!selectedType) return "";
    if (selectedType.key === "etc") return "(직접 이름 입력)";
    const count = activeZones.filter((z) => z.typeKey === selectedType.key).length;
    return selectedType.label + nextSuffix(count);
  }, [selectedType, activeZones]);

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

  // ---------------- 좌석번호표 인식 ----------------
  // 좌석번호표(피난안내도 등)는 도면과 별개의 그림이라 좌표를 그대로 겹칠 수 없다. 그래서 존별
  // "좌석 수"(이미 등록되어 있음)를 기준으로, 이미지에서 읽은 번호 그룹을 그 개수와 대조해 매칭한다.
  async function runSeatNumberRecognize(dataUrlOverride?: string) {
    const dataUrl = dataUrlOverride ?? rawSeatNumberPlateDataUrl;
    if (!user || !dataUrl) return;
    setSeatNumberRecognizing(true);
    setStatusMsg("좌석번호 인식 중...");
    try {
      const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) throw new Error("이미지 데이터를 읽을 수 없습니다.");
      const [, mimeType, base64] = match;
      const token = await user.getIdToken();
      const res = await fetch("/api/seat-layout/recognize-seat-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          zones: project.zones.map((z) => ({ name: z.name, seats: z.seats, x: z.x, y: z.y, w: z.w, h: z.h })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "인식에 실패했습니다.");
      const ranges: SeatNumberRangeEntry[] = data.ranges ?? [];
      setProject((p) => ({ ...p, seatNumberRanges: ranges }));
      setStatusMsg("좌석번호 인식 완료 — 결과를 확인하고 틀린 부분은 직접 수정하세요.", "success");
    } catch (err) {
      setStatusMsg(`좌석번호 인식 실패: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setSeatNumberRecognizing(false);
    }
  }

  function handleSeatNumberPlateFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      setRawSeatNumberPlateDataUrl(dataUrl);
      runSeatNumberRecognize(dataUrl);
    };
    reader.onerror = () => setStatusMsg("좌석번호표 이미지를 읽지 못했습니다.", "error");
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function setSeatNumberRangeFor(zoneName: string, value: string) {
    setProject((p) => {
      const rest = p.seatNumberRanges.filter((r) => r.zoneName !== zoneName);
      return { ...p, seatNumberRanges: value ? [...rest, { zoneName, ranges: value }] : rest };
    });
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
    setAiResultText("");

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
    setStatusMsg(`"${z.name}"의 스펙을 수정하는 중입니다. (구역/이름/색상은 변경되지 않습니다)`);
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
      if (activeTab === "desk") {
        const filtered = breakdown.filter((r) => r.qty > 0);
        const totalSeats = filtered.reduce((s, r) => s + r.qty, 0);
        setProject((p) => {
          const zones = [...p.zones];
          const z = { ...zones[editingIndex] };
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
          z.seats = Number(seatsDraft) || 0;
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
      const seats = Number(seatsDraft) || 0;
      if (seats <= 0) {
        setStatusMsg("대수가 0입니다. 확인해주세요.", "error");
        return;
      }
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
    const overrides: PcSpecValues = {};
    PC_SPEC_FIELDS.forEach((f) => {
      const v = pcSpecDraft[f.id] ?? "";
      if (v !== (pcDefaults[f.id] ?? "")) overrides[f.id] = v;
    });
    return overrides;
  }

  function deleteZone(index: number) {
    if (activeTab === "desk") {
      setProject((p) => ({ ...p, zones: p.zones.filter((_, i) => i !== index) }));
    } else {
      setProject((p) => ({ ...p, pcZones: p.pcZones.filter((_, i) => i !== index) }));
    }
  }

  // ---------------- PC 기본사양 ----------------
  const basicPcQty = computeBasicPcQty(project.zones, project.pcZones);

  function savePcDefaults() {
    const merged: PcSpecValues = {};
    effectivePcSpecFields.forEach((f) => {
      merged[f.id] = pcDefaultsDraft[f.id] || f.def;
    });
    setPcDefaults(merged);
    setStatusMsg("PC 기본사양이 반영되었습니다. (존별로 다르게 지정한 항목만 별도 표시됩니다)", "success");
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
      .filter((z) => z.typeKey !== "multi")
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
          seats: z.seats,
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
      setRawFloorPlanDataUrl(null);
      setActiveTab("desk");
      setSelectedTypeKey(null);
      cancelZone();
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
    setPcDefaults(pcDefaultsFromFields(effectivePcSpecFields));
    setPcDefaultsDraft(pcDefaultsFromFields(effectivePcSpecFields));
    setActiveTab("desk");
    setSelectedTypeKey(null);
    cancelZone();
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
      setPdfCropSource({ dataUrl, width: probe.naturalWidth, height: probe.naturalHeight });
      setCropRect(null);
      setCropHint("도면 영역의 왼쪽 위를 클릭하세요 (제목 블록/범례 표는 빼고 도면만).");
      setPdfPickerPages(null);
      pdfDocRef.current = null;
      setStatusMsg("실제 배치도 영역만 지정해주세요.", "success");
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
    canvas.width = 900;
    canvas.height = 900 * (img.naturalHeight / img.naturalWidth);
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

  function confirmPdfCrop() {
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
    applyFloorPlanDataUrl(off.toDataURL("image/png"), off.width, off.height);
    closePdfCrop();
    setStatusMsg("도면 영역을 잘라서 불러왔습니다. \"프로젝트 저장\"을 눌러야 보관됩니다.", "success");
  }

  function usePdfPageAsIs() {
    if (!pdfCropSource) return;
    applyFloorPlanDataUrl(pdfCropSource.dataUrl, pdfCropSource.width, pdfCropSource.height);
    closePdfCrop();
    setStatusMsg("도면을 불러왔습니다. \"프로젝트 저장\"을 눌러야 보관됩니다.", "success");
  }

  function closePdfCrop() {
    setPdfCropSource(null);
    setCropRect(null);
    cropPendingStartRef.current = null;
    cropImgRef.current = null;
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

    renderPcFloorplanImage(ctx, imgEl, project.name, project.zones, project.pcZones, pcDefaults);
    const pc = { key: "pc", label: "PC발주도면", dataUrl: cv.toDataURL("image/png") };

    renderOrderSummaryImage(ctx, project.name, project.zones, project.seatNumberRanges);
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
            공유 프레젠테이션에 등록
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
                showAi={editingIndex === null}
                aiResultText={aiResultText}
                recognizing={recognizing}
                onRecognizeAgain={() => curRect && runRecognize(curRect, activeTab)}
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
        {(["desk", "pc"] as TabKey[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
              setSelectedTypeKey(null);
              cancelZone();
            }}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === tab
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab === "desk" ? "책상 발주 도면" : "PC 발주 도면"}
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
                <p className="mt-1 text-xs text-zinc-400">
                  도면은 책상/PC 탭에서 공통으로 사용됩니다. PDF는 화면 캡처보다 훨씬 선명해요.
                </p>
                {pdfPickerPages && (
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

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <label
              htmlFor="seat-number-plate-input"
              className="block cursor-pointer text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              좌석번호표 이미지 (선택 — 피난안내도 등)
            </label>
            <input
              id="seat-number-plate-input"
              ref={seatNumberPlateInputRef}
              type="file"
              accept="image/*"
              onChange={handleSeatNumberPlateFileChange}
              className="mt-1 w-full text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white file:transition file:duration-150 hover:file:bg-zinc-700 dark:text-zinc-300 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-white"
            />
            <p className="mt-1 text-xs text-zinc-400">
              업로드하면 존별 좌석번호 범위를 자동으로 인식해서 발주요약(슬라이드3)에 함께 넣습니다.
              번호 인식은 100% 정확하지 않을 수 있어요 — 틀린 부분은 아래에서 직접 고치면 됩니다.
            </p>

            {(rawSeatNumberPlateDataUrl || project.seatNumberPlateDataUrl) && project.zones.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    {seatNumberRecognizing ? "인식 중..." : "존별 좌석번호 (틀리면 직접 수정)"}
                  </p>
                  <button
                    type="button"
                    disabled={seatNumberRecognizing}
                    onClick={() => runSeatNumberRecognize()}
                    className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    다시 인식
                  </button>
                </div>
                {project.zones.map((z) => {
                  const entry = project.seatNumberRanges.find((r) => r.zoneName === z.name);
                  return (
                    <div key={z.name} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-xs text-zinc-500" title={z.name}>
                        {z.name}
                      </span>
                      <input
                        value={entry?.ranges ?? ""}
                        onChange={(e) => setSeatNumberRangeFor(z.name, e.target.value)}
                        placeholder="예: 1~10, 25~30"
                        className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{dragHint}</p>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">존 목록</h2>
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

        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1">
              {pdfCropSource ? (
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
                      onClick={confirmPdfCrop}
                      className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                    >
                      이 영역으로 자르기
                    </button>
                    <button
                      type="button"
                      onClick={usePdfPageAsIs}
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      자르지 않고 페이지 전체 사용
                    </button>
                    <button
                      type="button"
                      onClick={closePdfCrop}
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-auto rounded-2xl border border-zinc-200 bg-zinc-100 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  {imgEl ? (
                    <canvas
                      ref={canvasRef}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
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
  specFields: SpecField[];
  pcSpecFields: { id: PcSpecFieldId; label: string; def: string }[];
  pcSuggestions: Partial<Record<PcSpecFieldId, string[]>>;
};

function ZoneForm(props: ZoneFormProps) {
  const {
    activeTab,
    title,
    isEtc,
    etcName,
    onEtcNameChange,
    etcColor,
    onEtcColorChange,
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
    specFields,
    pcSpecFields,
    pcSuggestions,
  } = props;

  const breakdownTotal = breakdown.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>

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
          </div>
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
