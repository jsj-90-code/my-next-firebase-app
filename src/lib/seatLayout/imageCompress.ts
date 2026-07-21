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
