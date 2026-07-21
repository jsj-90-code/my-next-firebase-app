"use client";

import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { SeatLayoutWorkspace } from "@/components/seatLayout/SeatLayoutWorkspace";

export default function SeatLayoutPage() {
  return (
    <AutoAuthGate>
      <SeatLayoutWorkspace />
    </AutoAuthGate>
  );
}
