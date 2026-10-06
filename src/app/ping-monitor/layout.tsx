import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PingMonitorChrome } from "./PingMonitorChrome";

// 경쟁점 가동률 측정기 — 2026-10-06 신설. 유지보수가 끊긴 옛 핑봇(ping.isens.camp)을 대신한다.
// 상호·주소·IP대역만 넣으면 1시간마다 재서 기한 없이 쌓는다. 클라이언트 로직은 PingMonitorChrome으로 분리.
export const metadata: Metadata = {
  title: "아이센스 경쟁점 가동률",
};

export default function PingMonitorLayout({ children }: { children: ReactNode }) {
  return <PingMonitorChrome>{children}</PingMonitorChrome>;
}
