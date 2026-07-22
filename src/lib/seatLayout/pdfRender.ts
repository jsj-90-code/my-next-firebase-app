// PDF 도면 파일에서 페이지를 캔버스에 렌더링한다 (화면 캡처보다 훨씬 선명한 도면을 얻기 위함).
// 브라우저에서만 동작한다 ("use client" 컴포넌트에서만 호출할 것).
//
// pdfjs-dist는 모듈을 불러오는 순간 브라우저 전용 전역(DOMMatrix 등)을 참조하기 때문에,
// 최상단에서 정적으로 import하면 Next.js가 이 페이지를 서버에서 미리 렌더링(SSR)할 때
// "DOMMatrix is not defined" 오류로 빌드가 깨진다. 실제로 호출되는 시점(=브라우저에서
// 사용자가 PDF를 고를 때)에만 동적으로 불러오도록 해서 이 문제를 피한다.

import type * as PdfJsLib from "pdfjs-dist";

let workerConfigured = false;

async function getPdfjs(): Promise<typeof PdfJsLib> {
  const pdfjsLib = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjsLib;
}

export async function loadPdfDocument(file: File): Promise<PdfJsLib.PDFDocumentProxy> {
  const pdfjsLib = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  return loadingTask.promise;
}

// PDF는 벡터라 화질 열화 없이 얼마든지 키울 수 있지만, 캔버스가 처리 가능한
// 픽셀 수에는 브라우저 메모리상 실질적인 한계가 있다. 이 값 위로는 렌더링이
// 느려지거나 실패할 수 있어 실질적인 "최대 화질" 상한으로 둔다.
const MAX_LONG_EDGE = 10000;

// 도면 위의 반경/동선 표시용 점선 원·곡선은 PDF 안에서 실제 "점선(dash pattern)"
// 선 스타일로 그려져 있다 (AI 인식이 이 점선을 좌석으로 착각하는 문제가 있었음).
// pdf.js는 내부적으로 표준 Canvas2D API(setLineDash/stroke)를 그대로 호출하므로,
// 우리가 만든 컨텍스트를 Proxy로 감싸서 "점선이 설정된 상태에서의 stroke"만
// 건너뛰면 점선만 정확히 지우고 나머지 실선(벽/책상 등)은 그대로 남길 수 있다.
function createDashSuppressingContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  let dashed = false;
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === "setLineDash") {
        return (segments: number[]) => {
          dashed = Array.isArray(segments) && segments.length > 0;
          return target.setLineDash(segments);
        };
      }
      if (prop === "stroke") {
        return (...args: unknown[]) => {
          if (dashed) return undefined;
          return (target.stroke as (...a: unknown[]) => void).apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    // 기본 Proxy set 동작은 target[prop] = value를 receiver(=이 Proxy) 기준으로 실행하려고
    // 해서, pdf.js가 ctx.font / ctx.fillStyle 등을 대입할 때마다 네이티브 접근자가
    // "Illegal invocation"으로 터진다. target에 직접 대입해서 우회한다.
    set(target, prop, value) {
      (target as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  }) as CanvasRenderingContext2D;
}

// targetLongEdge: 렌더링 결과의 긴 변 픽셀 수 (썸네일은 작게, 실제 도면용은 크게)
// removeDashedLines: true면 점선(안내선/반경 표시)을 렌더링 단계에서 지운다.
export async function renderPdfPageToDataUrl(
  pdf: PdfJsLib.PDFDocumentProxy,
  pageNumber: number,
  targetLongEdge: number,
  removeDashedLines = false,
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const clampedLongEdge = Math.min(targetLongEdge, MAX_LONG_EDGE);
  const scale = clampedLongEdge / Math.max(baseViewport.width, baseViewport.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 생성할 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (removeDashedLines) {
    const renderCtx = createDashSuppressingContext(ctx);
    await page.render({ canvas: null, canvasContext: renderCtx, viewport }).promise;
  } else {
    await page.render({ canvas, viewport }).promise;
  }
  return canvas.toDataURL("image/png");
}
