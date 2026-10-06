// 도면 원본 이미지를 Firestore 문서 크기 제한(1MiB)에 맞게 압축한다.
// Firebase Storage를 쓰지 않기로 했으므로, 도면은 프로젝트 문서 안에 데이터 URL로 직접 저장된다.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.6;

export async function compressImageDataUrl(
  sourceDataUrl: string,
  maxDimension: number = MAX_DIMENSION,
  quality: number = JPEG_QUALITY,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
  });
  img.src = sourceDataUrl;
  await loaded;

  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 생성할 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

// 2026-10-06 — 도면은 1600px·화질 0.6으로만 저장돼서, 저장한 프로젝트를 다시 열어 고해상도
// (9600x5400)로 내려받으면 도면 선만 뭉개졌다. 남는 용량(maxBytes) 안에서 가장 좋은 단계를 고른다.
// 1600px·0.6이 예전 기본값이라, 어떤 도면이든 최소한 예전 화질은 나온다.
const FLOOR_PLAN_LADDER: { maxDimension: number; quality: number }[] = [
  { maxDimension: 3200, quality: 0.8 },
  { maxDimension: 2400, quality: 0.75 },
  { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY },
];

export async function compressFloorPlanToBudget(
  sourceDataUrl: string,
  maxBytes: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  let last: { dataUrl: string; width: number; height: number } | null = null;
  for (const { maxDimension, quality } of FLOOR_PLAN_LADDER) {
    last = await compressImageDataUrl(sourceDataUrl, maxDimension, quality);
    // data URL은 ASCII라 글자 수 = 바이트 수다.
    if (last.dataUrl.length <= maxBytes) return last;
  }
  return last!;
}
