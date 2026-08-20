// 도면 이미지에서 "전체 1장 + 사분면 확대 4장"을 만드는 공용 로직.
// 원래 좌석번호표 인식에서 처음 만들었다 — 통짜 이미지 한 장만 주면 촘촘한 구역의 글씨/경계선이
// 축소되며 뭉개져 놓치는 문제가 있어서(93석짜리 피난안내도에서 14석 통째 누락 사례), 전체 구도
// 판단은 원본 이미지로, 세부 확인은 확대본으로 하도록 같이 보낸다. 구역 초안 제안(suggest-zones)
// 에서도 책상 경계를 정확히 잡기 위해 같은 방식을 재사용한다.

export type ImageTile = { data: string; mimeType: string };

// 사분면 경계에 걸친 항목이 잘리지 않도록 살짝 겹치게 자른다.
const OVERLAP_RATIO = 0.1;

// maxDimension을 주면 타일을 자르기 전에 원본을 그 안에 들어오게 축소한다. 원본 도면은
// 책상개수 인식(작은 치수 글씨까지 읽어야 함) 때문에 일부러 고화질 그대로 두는데, 이걸 5장
// (전체+확대4장)으로 만들면 원본이 클 경우 요청 용량이 너무 커져 "Request Entity Too Large"로
// 거부당하는 문제가 있었다(구역 제안에서 발생). 구역 경계 판단에는 그 정도 초고화질이 필요 없어서
// 호출하는 쪽에서 적당히 줄이게 한다.
export async function buildQuadrantTiles(dataUrl: string, maxDimension?: number): Promise<ImageTile[]> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = dataUrl;
  });
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let source: CanvasImageSource = img;
  if (maxDimension && Math.max(w, h) > maxDimension) {
    const scale = maxDimension / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const resized = document.createElement("canvas");
    resized.width = w;
    resized.height = h;
    const rctx = resized.getContext("2d");
    if (!rctx) throw new Error("캔버스를 생성할 수 없습니다.");
    rctx.drawImage(img, 0, 0, w, h);
    source = resized;
  }
  const toPngBase64 = (sx: number, sy: number, sw: number, sh: number) => {
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(sw));
    off.height = Math.max(1, Math.round(sh));
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("캔버스를 생성할 수 없습니다.");
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, off.width, off.height);
    return off.toDataURL("image/png").split(",")[1];
  };
  const halfW = w / 2;
  const halfH = h / 2;
  const ow = w * OVERLAP_RATIO;
  const oh = h * OVERLAP_RATIO;
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
