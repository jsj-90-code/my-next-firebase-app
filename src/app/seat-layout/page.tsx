"use client";

import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { SeatLayoutWorkspace } from "@/components/seatLayout/SeatLayoutWorkspace";

// 이 앱은 여러 도구를 함께 담고 있어 루트 레이아웃(src/app/layout.tsx)의 <title>은 그대로 두고
// 이 화면에서만 다른 제목을 쓴다. React 19가 트리 어디서든 렌더링된 <title>을 <head>로 자동
// 호이스팅해주므로, document.title을 직접 건드리지 않고 JSX에 <title>을 렌더링한다.
const PAGE_TITLE = "아이센스 좌석배치도 작업 툴";

export default function SeatLayoutPage() {
  return (
    <div className="app-theme min-h-screen">
      <title>{PAGE_TITLE}</title>
      <AutoAuthGate>
        <SeatLayoutWorkspace />
      </AutoAuthGate>
    </div>
  );
}
