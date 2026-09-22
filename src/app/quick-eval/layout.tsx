import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QuickEvalChrome } from "./QuickEvalChrome";

// 주소만 초기평가 — **점포평가 시스템과 완전히 분리된 독립 화면**이다(사용자 지시 2026-09-22:
// "링크를 완전히 분리해줘 v62웹에넣지말고"). 그래서 /store-eval 아래가 아니라 최상위
// /quick-eval에 있고, 점포평가 메뉴(StoreEvalChrome)에도 걸지 않는다. 입구는 홈 화면의
// 도구 카드 하나다.
//
// ⚠️ 산식은 여전히 운영 V62를 그대로 부른다(evaluateCandidate). 분리한 건 **화면과 주소**이고,
//    계산을 따로 만든 게 아니다 — 두 개로 갈라지면 어느 쪽이 맞는지 알 수 없게 된다.
//
// 서버 컴포넌트로 둬야 이 라우트 전용 title이 안정적으로 적용된다(store-eval/layout.tsx와 같은
// 이유 — 클라이언트 로직은 QuickEvalChrome으로 분리).
export const metadata: Metadata = {
  title: "아이센스 주소만 초기평가",
};

export default function QuickEvalLayout({ children }: { children: ReactNode }) {
  return <QuickEvalChrome>{children}</QuickEvalChrome>;
}
