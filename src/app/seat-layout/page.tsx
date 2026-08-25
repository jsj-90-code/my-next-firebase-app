import type { Metadata } from "next";
import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { SeatLayoutWorkspace } from "@/components/seatLayout/SeatLayoutWorkspace";

// 이 파일은 서버 컴포넌트로 둬야 Next.js 메타데이터(title)를 이 라우트에만 적용할 수 있다.
// AutoAuthGate/SeatLayoutWorkspace는 내부적으로 "use client"라 여기서 그대로 자식으로 렌더링해도 된다.
// (이전에는 <title> JSX를 직접 렌더링해 덮어쓰는 방식을 썼는데, 루트 레이아웃의 title과 두 개의
// <title> 태그가 동시에 나오면서 어느 쪽이 이기는지가 내용에 따라 달라지는 불안정한 문제가 있었다 —
// 2026-08-25 확인. Next 메타데이터 API를 쓰면 라우트당 title이 하나로 정리되어 이 문제가 없다.)
export const metadata: Metadata = {
  title: "아이센스 좌석배치도 작업 툴",
};

export default function SeatLayoutPage() {
  return (
    <div className="app-theme min-h-screen">
      <AutoAuthGate>
        <SeatLayoutWorkspace />
      </AutoAuthGate>
    </div>
  );
}
