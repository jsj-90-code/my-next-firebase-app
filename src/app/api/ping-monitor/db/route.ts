import { NextResponse } from "next/server";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { encodeValue, istore, usesInternalStore, type StoreWrite, type Where } from "@/lib/pingMonitor/internalStore";
import { PING_DAILY, PING_STORES } from "@/lib/pingMonitor/summary";

// 측정기 화면 → 사내 저장소 창구(2026-11-03). 예전엔 화면이 Firebase를 바로 읽고 썼고 firestore.rules가 막았다 —
// 그 규칙을 여기서 똑같이 지킨다:
//   읽기: 회사 계정이면 매장(pingMonitorStores)·일별(pingMonitorDaily)
//   만들기·고치기: 매장만, 화면이 쓰는 칸(PING_KEYS)만 — 측정 기록(days·lastSample·recent)·isOwnStore는 서버만 쓴다
//   지우기: 빈 항목만(IP 없음 + 한 번도 안 잼 + 우리 매장 아님). 기록 있는 매장은 /api/ping-monitor/delete
// 서버 시각 칸은 화면이 {__now: true}로 보내면 여기서 지금 시각을 넣는다.
// PING_STORE_BACKEND=internal이 아니면 닫혀 있다(503) — 그동안 화면은 Firebase를 직접 쓴다(NEXT_PUBLIC_PING_STORE_API).

const PING_KEYS = new Set([
  "name", "address", "ipRanges", "ipCount", "pcCount", "memo", "active",
  "ownCode", "ownName", "competitorId", "distanceM", "ipCheck", "lat", "lng",
  "createdAt", "createdBy", "updatedAt", "updatedBy",
]);
const READABLE = new Set([PING_STORES, PING_DAILY]);

type Body =
  | { op: "get"; c: string; id: string }
  | { op: "list"; c: string; where?: Where[]; idFrom?: string; idTo?: string }
  | { op: "add"; c: string; data: Record<string, unknown> }
  | { op: "commit"; writes: StoreWrite[] };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const keysOk = (data: unknown) => !!data && typeof data === "object" && Object.keys(data).every((k) => PING_KEYS.has(k));

export async function POST(request: Request) {
  if (!usesInternalStore()) return bad("사내 저장소가 아직 꺼져 있습니다.", 503);
  const user = await getVerifiedCompanyUser(request);
  if (!user) return bad("회사 계정으로 로그인해 주세요.", 401);
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") return bad("요청이 비었습니다.");

  try {
    if (body.op === "get" || body.op === "list") {
      if (!READABLE.has(body.c)) return bad("읽을 수 없는 자료입니다.", 403);
      if (body.op === "get") return NextResponse.json({ doc: encodeValue(await istore.get(body.c, String(body.id))) });
      const docs = await istore.list(body.c, { where: body.where, idFrom: body.idFrom, idTo: body.idTo });
      return NextResponse.json({ docs: encodeValue(docs) });
    }
    if (body.op === "add") {
      if (body.c !== PING_STORES || !keysOk(body.data)) return bad("만들 수 없는 칸이 있습니다.", 403);
      return NextResponse.json({ id: await istore.add(PING_STORES, body.data) });
    }
    if (body.op === "commit") {
      const writes = Array.isArray(body.writes) ? body.writes : [];
      if (writes.length > 500) return bad("한 번에 너무 많습니다.");
      for (const w of writes) {
        if (w.c !== PING_STORES || typeof w.id !== "string" || !w.id) return bad("쓸 수 없는 자료입니다.", 403);
        if (w.op === "update") {
          if (!keysOk(w.data)) return bad("고칠 수 없는 칸이 있습니다.", 403);
        } else if (w.op === "delete") {
          const cur = await istore.get(PING_STORES, w.id);
          if (cur && (String(cur.ipRanges ?? "") !== "" || "days" in cur || cur.isOwnStore === true))
            return bad("IP나 측정 기록이 있는 매장은 여기서 못 지웁니다.", 403);
        } else return bad("허용되지 않은 쓰기입니다.", 403);
      }
      await istore.commit(writes);
      return NextResponse.json({ ok: true });
    }
    return bad("모르는 요청입니다.");
  } catch (error) {
    console.error("ping-monitor db 실패:", error);
    return bad(error instanceof Error ? error.message : "저장소 요청 실패", 502);
  }
}
