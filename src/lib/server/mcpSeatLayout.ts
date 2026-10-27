import "server-only";
// 좌석배치도 AI 인식을 채팅(직원 개인 Claude 커넥터)으로 — 도면 받기·초안 저장. (2026-10-27)
//
// 웹 버튼(책상 인식·PC 수량·좌석번호 인식)은 Gemini 무료 키(flash)라 인식이 불확실했다. 점포평가 커넥터처럼
// 도면을 채팅 AI에 넘겨 상위 모델이 보게 하고, 결과는 **초안**(seatLayoutChatDrafts)으로만 남긴다 —
// 웹 [채팅 결과 불러오기]에서 사람이 확인·수정해 적용하고 [저장]해야 반영된다(Asana 1219931656076710).
// 10-27 1단계 시험: 커넥터가 돌려준 이미지를 claude.ai가 실제로 본다(치수 글씨·계단실까지 읽음).
//
// 웹은 존을 그릴 때마다 그 구역만 잘라 보냈다. 채팅은 **다 그린 뒤 한 번에** — 저장된 존마다 같은 방식으로 잘라
// 한꺼번에 넘긴다(사용자 확정 10-27 "기능만 잘되면 가능"). 지시문은 웹과 같은 문장(recognizePrompt.ts).
import sharp from "sharp";
import { adminDb } from "@/lib/firebase-admin";
import { SEAT_LAYOUT_CHAT_DRAFTS, type SeatLayoutChatDraft } from "@/lib/seatLayout/chatDraft";
import type { NormalizedRect, SeatLayoutProject } from "@/lib/seatLayout/types";
import type { McpUser } from "./mcpOAuth";

const PROJECTS_COLLECTION = "seatLayoutProjects";
const INDEX_DOC_PATH = "seatLayoutSettings/projectIndex";
const OVERLAP_RATIO = 0.1;
// Claude는 긴 변 약 1,568px을 넘는 이미지를 어차피 줄여서 본다 — 그 안에 맞춰 보낸다.
const MAX_DIMENSION = 1568;
// 2석짜리 작은 존은 잘라 내면 수백 px라 치수 글씨가 너무 작다 — 긴 변을 이 정도까지는 키워서 보낸다.
const MIN_CROP_DIMENSION = 800;

export type ChatImage = { data: string; mimeType: "image/png" };

function db() {
  if (!adminDb) throw new Error("서버 Firebase 설정이 없습니다.");
  return adminDb;
}

const decode = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
const fitPng = (img: sharp.Sharp, max = MAX_DIMENSION) =>
  img.resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).png().toBuffer();
const toImage = (buf: Buffer): ChatImage => ({ data: buf.toString("base64"), mimeType: "image/png" });

export async function findSeatLayoutProjects(query: string): Promise<{ id: string; name: string; updatedAt: number | null }[]> {
  const q = query.replace(/\s+/g, "").toLowerCase();
  const snap = await db().doc(INDEX_DOC_PATH).get();
  const entries = (snap.data()?.projects ?? {}) as Record<string, { name?: string; updatedAt?: number | null }>;
  return Object.entries(entries)
    .map(([id, e]) => ({ id, name: e.name ?? "(이름없음)", updatedAt: e.updatedAt ?? null }))
    .filter((p) => p.name.replace(/\s+/g, "").toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** 이름 일부로 프로젝트 하나를 고른다. 0개·여러 개면 채팅에 보여줄 안내를 돌려준다. */
export async function resolveSeatLayoutProject(query: string): Promise<{ project: SeatLayoutProject } | { error: string }> {
  const found = await findSeatLayoutProjects(query);
  if (!found.length) return { error: `'${query}'와 맞는 좌석배치도 프로젝트가 없습니다.` };
  // 이름이 정확히 같은 게 있으면 그걸 고른다("호구포점"이 "호구포점2"에 막히지 않게).
  const exact = found.filter((p) => p.name.replace(/\s+/g, "") === query.replace(/\s+/g, ""));
  const pick = exact.length === 1 ? exact : found;
  if (pick.length > 1) {
    return { error: `여러 개가 맞습니다. 이름을 더 정확히 주세요:\n${pick.slice(0, 20).map((p) => `- ${p.name}`).join("\n")}` };
  }
  const snap = await db().collection(PROJECTS_COLLECTION).doc(pick[0].id).get();
  if (!snap.exists) return { error: `'${pick[0].name}' 프로젝트를 읽지 못했습니다.` };
  return { project: { ...(snap.data() as Omit<SeatLayoutProject, "id">), id: snap.id } };
}

/** 저장된 존마다 웹 버튼과 같은 영역(여백 없음)을 잘라 PNG로. 작은 존은 키우고 큰 존은 줄인다. */
export async function buildZoneCrops(dataUrl: string, rects: NormalizedRect[]): Promise<ChatImage[]> {
  const buf = decode(dataUrl);
  const { width: w = 0, height: h = 0 } = await sharp(buf).metadata();
  if (!w || !h) throw new Error("도면 이미지를 읽지 못했습니다.");
  return Promise.all(
    rects.map(async (r) => {
      const left = Math.max(0, Math.min(w - 1, Math.round(r.x * w)));
      const top = Math.max(0, Math.min(h - 1, Math.round(r.y * h)));
      const width = Math.max(1, Math.min(w - left, Math.round(r.w * w)));
      const height = Math.max(1, Math.min(h - top, Math.round(r.h * h)));
      const long = Math.max(width, height);
      const target = Math.min(MAX_DIMENSION, Math.max(long, MIN_CROP_DIMENSION));
      const out = await sharp(buf)
        .extract({ left, top, width, height })
        .resize({ width: target, height: target, fit: "inside" })
        .png()
        .toBuffer();
      return toImage(out);
    }),
  );
}

/** 전체 1장 + 좌상·우상·좌하·우하 확대 4장(10% 겹침) — 예전 웹 버튼(imageTiles.ts, 10-27 삭제)과 같은 방식. */
export async function buildQuadrantImages(dataUrl: string): Promise<ChatImage[]> {
  const buf = decode(dataUrl);
  const { width: w = 0, height: h = 0 } = await sharp(buf).metadata();
  if (!w || !h) throw new Error("이미지를 읽지 못했습니다.");
  const halfW = w / 2;
  const halfH = h / 2;
  const ow = w * OVERLAP_RATIO;
  const oh = h * OVERLAP_RATIO;
  const starts: [number, number][] = [[0, 0], [Math.max(0, halfW - ow), 0], [0, Math.max(0, halfH - oh)], [Math.max(0, halfW - ow), Math.max(0, halfH - oh)]];
  const tiles = await Promise.all(
    starts.map(([sx, sy]) => {
      const left = Math.round(sx);
      const top = Math.round(sy);
      const width = Math.max(1, Math.min(Math.round(halfW + ow), w - left));
      const height = Math.max(1, Math.min(Math.round(halfH + oh), h - top));
      return fitPng(sharp(buf).extract({ left, top, width, height }));
    }),
  );
  return [await fitPng(sharp(buf)), ...tiles].map(toImage);
}

// ── 좌석번호용 배치도(존 박스 + 번호표). 웹은 브라우저 캔버스로 존 이름을 그려 보내지만, 서버(Vercel)엔 한글 글꼴이
//    없어 글자가 안 그려진다. 그래서 박스엔 숫자만 — 그것도 글꼴 없이 선으로 그린 7획 숫자 — 쓰고, 번호↔존 이름 표는 글로 준다.
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [0, 0, 1, 0], b: [1, 0, 1, 0.5], c: [1, 0.5, 1, 1], d: [0, 1, 1, 1], e: [0, 0.5, 0, 1], f: [0, 0, 0, 0.5], g: [0, 0.5, 1, 0.5],
};
const DIGITS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];

function numberLabelSvg(n: number, x: number, y: number, digitH: number): string {
  const digitW = digitH * 0.55;
  const gap = digitH * 0.3;
  const pad = digitH * 0.3;
  const stroke = Math.max(2, digitH * 0.14);
  const chars = String(n).split("");
  const boxW = pad * 2 + chars.length * digitW + (chars.length - 1) * gap;
  const boxH = pad * 2 + digitH;
  const lines = chars.flatMap((ch, i) => {
    const ox = x + pad + i * (digitW + gap);
    const oy = y + pad;
    return DIGITS[Number(ch)].split("").map((s) => {
      const [x1, y1, x2, y2] = SEGMENTS[s];
      return `<line x1="${ox + x1 * digitW}" y1="${oy + y1 * digitH}" x2="${ox + x2 * digitW}" y2="${oy + y2 * digitH}"/>`;
    });
  });
  return (
    `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" fill="#fff" stroke="#000" stroke-width="2"/>` +
    `<g stroke="#000" stroke-width="${stroke}" stroke-linecap="round">${lines.join("")}</g>`
  );
}

export async function buildZoneReferenceImage(
  floorPlanDataUrl: string,
  zones: (NormalizedRect & { color?: string })[],
): Promise<ChatImage> {
  const base = await fitPng(sharp(decode(floorPlanDataUrl)));
  const { width: w = 0, height: h = 0 } = await sharp(base).metadata();
  const digitH = Math.max(14, Math.round(Math.max(w, h) / 55));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    zones
      .map((z, i) => {
        const color = /^#[0-9a-f]{3,8}$/i.test(z.color ?? "") ? z.color : "#e5484d";
        const x = z.x * w;
        const y = z.y * h;
        return (
          `<rect x="${x}" y="${y}" width="${z.w * w}" height="${z.h * h}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="3"/>` +
          numberLabelSvg(i + 1, x + 2, y + 2, digitH)
        );
      })
      .join("") +
    "</svg>";
  return toImage(await sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer());
}

export async function loadSeatLayoutChatDraft(projectId: string): Promise<SeatLayoutChatDraft | null> {
  const snap = await db().collection(SEAT_LAYOUT_CHAT_DRAFTS).doc(projectId).get();
  return snap.exists ? (snap.data() as SeatLayoutChatDraft) : null;
}

/** "1~10, 25~30" / "1,2,3" / "1-3" → 번호 목록. 채팅 AI가 쓰는 모양이 제각각이라 관대하게 읽는다. */
export function parseSeatNumbers(raw: string): number[] {
  const out: number[] = [];
  for (const part of raw.replace(/\s*([~\-–])\s*/g, "$1").split(/[,\s/]+/)) {
    const m = part.match(/^(\d+)[~\-–](\d+)$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
      if (b - a <= 500) for (let n = a; n <= b; n++) out.push(n);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    }
  }
  return out;
}

/** 초안 저장 — 프로젝트 문서는 건드리지 않는다. 종류마다 마지막 결과 1건(덮어쓰기). */
export async function saveSeatLayoutChatDraft(
  project: SeatLayoutProject,
  kind: "desk" | "pc" | "seatNumbers" | "zones",
  body: Record<string, unknown>,
  meta: { modelName: string | null; note: string | null; user: McpUser | null },
): Promise<void> {
  const doc: Partial<SeatLayoutChatDraft> = {
    projectId: project.id,
    projectName: project.name,
    [kind]: { ...body, createdAt: Date.now(), modelName: meta.modelName, note: meta.note, userEmail: meta.user?.email ?? null },
  };
  await db().collection(SEAT_LAYOUT_CHAT_DRAFTS).doc(project.id).set(doc, { merge: true });
}
