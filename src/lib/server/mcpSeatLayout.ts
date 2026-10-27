import "server-only";
// 좌석배치도 AI 인식을 채팅(개인 Claude 커넥터)으로 옮기는 작업 — 1단계 시험용. (2026-10-27)
//
// 웹 버튼(구역 인식·존 초안·좌석번호 인식)은 Gemini 무료 키(flash)라 인식이 불확실하다. 점포평가 커넥터처럼
// 도면을 채팅 AI에 넘겨 상위 모델이 보게 하려는데, 먼저 "커넥터 도구가 돌려준 이미지를 claude.ai가 실제로 보는지"를
// 확인한다. 안 보이면 직원이 도면을 채팅에 직접 올리는 방식으로 다시 설계한다(Asana 1219931656076710).
//
// 사분면 확대는 브라우저 쪽 imageTiles.ts와 같은 방식(10% 겹침)을 서버에서 sharp로 한다.
import sharp from "sharp";
import { adminDb } from "@/lib/firebase-admin";
import type { DeskZone, SeatLayoutProject } from "@/lib/seatLayout/types";

const PROJECTS_COLLECTION = "seatLayoutProjects";
const INDEX_DOC_PATH = "seatLayoutSettings/projectIndex";
const OVERLAP_RATIO = 0.1;
// Claude는 긴 변 약 1,568px을 넘는 이미지를 어차피 줄여서 본다 — 그 안에 맞춰 보낸다.
const MAX_DIMENSION = 1568;

export type FloorPlanImage = { data: string; mimeType: "image/png"; label: string };

function db() {
  if (!adminDb) throw new Error("서버 Firebase 설정이 없습니다.");
  return adminDb;
}

export async function findSeatLayoutProjects(query: string): Promise<{ id: string; name: string; updatedAt: number | null }[]> {
  const q = query.replace(/\s+/g, "").toLowerCase();
  const snap = await db().doc(INDEX_DOC_PATH).get();
  const entries = (snap.data()?.projects ?? {}) as Record<string, { name?: string; updatedAt?: number | null }>;
  return Object.entries(entries)
    .map(([id, e]) => ({ id, name: e.name ?? "(이름없음)", updatedAt: e.updatedAt ?? null }))
    .filter((p) => p.name.replace(/\s+/g, "").toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function loadSeatLayoutProject(id: string): Promise<SeatLayoutProject | null> {
  const snap = await db().collection(PROJECTS_COLLECTION).doc(id).get();
  return snap.exists ? ({ ...(snap.data() as Omit<SeatLayoutProject, "id">), id: snap.id }) : null;
}

/** 데이터 URL 도면 → 전체 1장 + 좌상·우상·좌하·우하 확대 4장(PNG base64). */
export async function buildFloorPlanImages(dataUrl: string): Promise<FloorPlanImage[]> {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { width: w = 0, height: h = 0 } = await sharp(buf).metadata();
  if (!w || !h) throw new Error("도면 이미지를 읽지 못했습니다.");

  const fit = (img: sharp.Sharp) =>
    img.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const halfW = w / 2;
  const halfH = h / 2;
  const ow = w * OVERLAP_RATIO;
  const oh = h * OVERLAP_RATIO;
  const quadrants: [string, number, number][] = [
    ["좌상단 확대", 0, 0],
    ["우상단 확대", Math.max(0, halfW - ow), 0],
    ["좌하단 확대", 0, Math.max(0, halfH - oh)],
    ["우하단 확대", Math.max(0, halfW - ow), Math.max(0, halfH - oh)],
  ];
  const full = await fit(sharp(buf));
  const tiles = await Promise.all(
    quadrants.map(async ([label, sx, sy]) => {
      const left = Math.round(sx);
      const top = Math.round(sy);
      const width = Math.max(1, Math.min(Math.round(halfW + ow), w - left));
      const height = Math.max(1, Math.min(Math.round(halfH + oh), h - top));
      return { label, data: (await fit(sharp(buf).extract({ left, top, width, height }))).toString("base64") };
    }),
  );
  return [{ label: "전체 도면", data: full.toString("base64") }, ...tiles].map((t) => ({ ...t, mimeType: "image/png" as const }));
}

export function zoneListText(zones: DeskZone[]): string {
  if (!zones.length) return "(저장된 존 없음)";
  return zones
    .map((z, i) => `${i + 1}. ${z.name || "(이름없음)"} · ${z.seats}석 · 위치 x=${z.x.toFixed(3)} y=${z.y.toFixed(3)} w=${z.w.toFixed(3)} h=${z.h.toFixed(3)}`)
    .join("\n");
}
