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
import { getGeminiClient, getSuggestZonesGeminiModel } from "@/lib/gemini";
import {
  buildSuggestZonesPrompt, parseZoneSuggestions, SUGGEST_ZONES_IMAGE_LABELS, type ZoneSuggestion,
} from "@/lib/seatLayout/suggestZonesPrompt";
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

/** 이름 일부로 프로젝트 하나를 고른다. 0개·여러 개·도면 없음이면 채팅에 보여줄 안내를 돌려준다. */
export async function resolveSeatLayoutProject(
  query: string,
): Promise<{ project: SeatLayoutProject } | { error: string; isError: boolean }> {
  const found = await findSeatLayoutProjects(query);
  if (!found.length) return { error: `'${query}'와 맞는 좌석배치도 프로젝트가 없습니다.`, isError: false };
  // 이름이 정확히 같은 게 있으면 그걸 고른다("호구포점"이 "호구포점2"에 막히지 않게).
  const exact = found.filter((p) => p.name.replace(/\s+/g, "") === query.replace(/\s+/g, ""));
  const pick = exact.length === 1 ? exact : found;
  if (pick.length > 1) {
    return { error: `여러 개가 맞습니다. 이름을 더 정확히 주세요:\n${pick.slice(0, 20).map((p) => `- ${p.name}`).join("\n")}`, isError: false };
  }
  const project = await loadSeatLayoutProject(pick[0].id);
  if (!project?.floorPlanDataUrl) return { error: `'${pick[0].name}'에 도면 이미지가 없습니다.`, isError: true };
  return { project };
}

/**
 * 데이터 URL 도면 → 전체 1장 + 좌상·우상·좌하·우하 확대 4장(PNG base64).
 * maxDimension: 채팅(Claude)엔 1568, Gemini 비교엔 웹 버튼과 같은 1800(SeatLayoutWorkspace buildQuadrantTiles).
 */
export async function buildFloorPlanImages(dataUrl: string, maxDimension = MAX_DIMENSION): Promise<FloorPlanImage[]> {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { width: w = 0, height: h = 0 } = await sharp(buf).metadata();
  if (!w || !h) throw new Error("도면 이미지를 읽지 못했습니다.");

  const fit = (img: sharp.Sharp) =>
    img.resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true }).png().toBuffer();
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

// ── 2단계 비교(2026-10-27): 같은 도면으로 웹 버튼과 똑같은 Gemini 요청을 돌리고, Claude 초안과 함께
//    사람이 확정해 저장한 존(정답)에 대고 채점한다. 읽기만 한다 — 결과는 응답으로만 돌려주고 어디에도 저장하지 않는다.

export async function runGeminiZoneSuggestion(dataUrl: string): Promise<ZoneSuggestion[]> {
  const client = getGeminiClient();
  if (!client) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  // 웹 버튼은 브라우저에서 긴 변 1800px로 줄인 PNG 5장을 보낸다 — 같은 크기로 맞춘다.
  const images = await buildFloorPlanImages(dataUrl, 1800);
  // 무료 키라 구글 쪽 과부하(503)·한도(429)가 잦다 — 10-27 첫 비교가 503으로 비었다. 몇 번 쉬었다 다시 부른다.
  const call = () => client.models.generateContent({
    model: getSuggestZonesGeminiModel(),
    contents: [{
      role: "user",
      parts: [
        ...images.flatMap((img, i) => [
          { inlineData: { mimeType: img.mimeType, data: img.data } },
          { text: SUGGEST_ZONES_IMAGE_LABELS[i] ?? `이미지 ${i + 1}` },
        ]),
        { text: buildSuggestZonesPrompt(true) },
      ],
    }],
    config: { maxOutputTokens: 16000, thinkingConfig: { thinkingBudget: -1 } },
  });
  for (let attempt = 0; ; attempt++) {
    try {
      return parseZoneSuggestions((await call()).text ?? "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 3 || !/503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, [5000, 15000, 30000][attempt]));
    }
  }
}

type Rect = { x: number; y: number; w: number; h: number };
const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const iou = (a: Rect, b: Rect) => {
  const i = intersection(a, b);
  return i ? i / (area(a) + area(b) - i) : 0;
};

export type ZoneScore = {
  predictedCount: number;
  truthCount: number;
  matched: number; // 겹침(IoU) 0.5 이상으로 짝지어진 정답 존 수
  meanIou: number; // 정답 존마다 가장 잘 짝지어진 예측의 IoU 평균(못 찾으면 0)
  seatTotalDiff: number; // 예측 좌석 합 − 정답 좌석 합
  matchedSeatAbsErr: number; // 짝지어진 존끼리 좌석 수 차이 평균
  coveredSeatShare: number; // 정답 좌석 중 예측 상자에 덮인 비율(면적 근사) — 빠뜨린 책상 지표
  pairs: { truth: string; truthSeats: number; iou: number; predSeats: number | null }[];
};

/** 정답 존과 예측 존을 IoU 큰 순으로 1:1 짝짓고 채점한다. */
export function scoreZoneDraft(predicted: ZoneSuggestion[], truth: DeskZone[]): ZoneScore {
  const cand = truth.flatMap((t, ti) => predicted.map((p, pi) => ({ ti, pi, v: iou(t, p) })))
    .filter((c) => c.v > 0)
    .sort((a, b) => b.v - a.v);
  const byTruth = new Map<number, { pi: number; v: number }>();
  const usedPred = new Set<number>();
  for (const c of cand) {
    if (byTruth.has(c.ti) || usedPred.has(c.pi)) continue;
    byTruth.set(c.ti, { pi: c.pi, v: c.v });
    usedPred.add(c.pi);
  }
  const pairs = truth.map((t, ti) => {
    const m = byTruth.get(ti);
    return { truth: t.name || `존${ti + 1}`, truthSeats: t.seats, iou: m?.v ?? 0, predSeats: m ? predicted[m.pi].seats : null };
  });
  const good = pairs.filter((p) => p.iou >= 0.5);
  const truthSeats = truth.reduce((s, t) => s + t.seats, 0);
  const covered = truth.reduce((s, t) => {
    const a = area(t);
    const share = a ? Math.min(1, predicted.reduce((x, p) => x + intersection(t, p), 0) / a) : 0;
    return s + share * t.seats;
  }, 0);
  return {
    predictedCount: predicted.length,
    truthCount: truth.length,
    matched: good.length,
    meanIou: pairs.length ? pairs.reduce((s, p) => s + p.iou, 0) / pairs.length : 0,
    seatTotalDiff: predicted.reduce((s, p) => s + p.seats, 0) - truthSeats,
    matchedSeatAbsErr: good.length ? good.reduce((s, p) => s + Math.abs((p.predSeats ?? 0) - p.truthSeats), 0) / good.length : 0,
    coveredSeatShare: truthSeats ? covered / truthSeats : 0,
    pairs,
  };
}

export function zoneScoreTable(rows: { label: string; score: ZoneScore | null; error?: string }[], truth: DeskZone[]): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const head =
    `정답(저장된 존): ${truth.length}개 · ${truth.reduce((s, t) => s + t.seats, 0)}석\n\n` +
    "| 항목 | " + rows.map((r) => r.label).join(" | ") + " |\n|---|" + rows.map(() => "---|").join("") + "\n";
  const line = (name: string, f: (s: ZoneScore) => string) =>
    `| ${name} | ${rows.map((r) => (r.score ? f(r.score) : `실패: ${r.error ?? ""}`)).join(" | ")} |\n`;
  const body =
    line("존 개수", (s) => `${s.predictedCount}`) +
    line("맞은 존(겹침 50%↑)", (s) => `${s.matched}/${s.truthCount}`) +
    line("평균 겹침(IoU)", (s) => s.meanIou.toFixed(2)) +
    line("덮은 좌석 비율", (s) => pct(s.coveredSeatShare)) +
    line("좌석 합계 차이", (s) => `${s.seatTotalDiff >= 0 ? "+" : ""}${s.seatTotalDiff}석`) +
    line("맞은 존 좌석 오차(평균)", (s) => `${s.matchedSeatAbsErr.toFixed(1)}석`);
  const detail = rows
    .filter((r) => r.score)
    .map((r) => `\n[${r.label} 존별] ` + r.score!.pairs.map((p) => `${p.truth}(${p.truthSeats}석) ${p.iou.toFixed(2)}${p.predSeats != null ? `/${p.predSeats}석` : ""}`).join(" · "))
    .join("");
  return head + body + detail;
}

export function zoneListText(zones: DeskZone[]): string {
  if (!zones.length) return "(저장된 존 없음)";
  return zones
    .map((z, i) => `${i + 1}. ${z.name || "(이름없음)"} · ${z.seats}석 · 위치 x=${z.x.toFixed(3)} y=${z.y.toFixed(3)} w=${z.w.toFixed(3)} h=${z.h.toFixed(3)}`)
    .join("\n");
}
