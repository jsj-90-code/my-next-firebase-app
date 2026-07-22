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

// (참고) 도면 위 반경/동선 표시용 점선을 렌더링 단계에서 지우려고 캔버스 컨텍스트를
// Proxy로 감싸서 setLineDash 상태일 때 stroke를 건너뛰는 방식을 시도했었다. 그런데 실제
// 도면 PDF로 계측해보니 stroke가 18,782번 호출되는 동안 dash 상태(setLineDash에 실제
// 배열이 들어오는 경우)가 단 한 번도 없었다 — 즉 이 도면들의 점선은 PDF의 진짜 점선
// 속성이 아니라 짧은 실선 조각을 이어붙여 만든 것이라 벡터 단계에서 "점선이다"라고
// 구분할 방법이 없다. 그래서 이 방식은 제거했다 (효과도 없이 렌더링만 느려짐).

// targetLongEdge: 렌더링 결과의 긴 변 픽셀 수 (썸네일은 작게, 실제 도면용은 크게)
export async function renderPdfPageToDataUrl(
  pdf: PdfJsLib.PDFDocumentProxy,
  pageNumber: number,
  targetLongEdge: number,
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

  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/png");
}
