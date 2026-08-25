import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StoreEvalChrome } from "./StoreEvalChrome";

// 서버 컴포넌트로 둬야 이 라우트 전용 title이 안정적으로 적용된다 (라우트별 title은 서버
// 컴포넌트의 metadata export로만 정할 수 있다). 내비게이션 등 클라이언트 로직은 StoreEvalChrome으로
// 분리했다 — 예전에는 여기서 "use client" + <title> JSX를 직접 렌더링했는데, 루트 레이아웃의
// title과 <title> 태그가 두 개 동시에 나오면서 어느 쪽이 이기는지가 불안정했다 (2026-08-25 확인).
export const metadata: Metadata = {
  title: "아이센스 점포평가 시스템",
};

export default function StoreEvalLayout({ children }: { children: ReactNode }) {
  return <StoreEvalChrome>{children}</StoreEvalChrome>;
}
