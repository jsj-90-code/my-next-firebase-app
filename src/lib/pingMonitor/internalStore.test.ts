// 사내 저장소 쪽 끝까지 시험(2026-11-03) — 이 PC에 임시 저장소(scripts/pingMonitor/store/server.mjs)를 띄워
// 시간 기록(recordRound)·대상 읽기(loadTargets)·상태 기록·화면 창구(/api/ping-monitor/db) 규칙을 실제 HTTP로 돌린다.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ adminDb: null, adminAuth: null }));
vi.mock("@/lib/server/companyAuth", () => ({
  getVerifiedCompanyUser: async (req: Request) => (req.headers.get("authorization") === "Bearer ok" ? { email: "tester@isens.camp" } : null),
}));

const PORT = 19000 + Math.floor(Math.random() * 900) + 150;
let server: ChildProcess;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ping-store-"));
  const secret = "s".repeat(48);
  writeFileSync(join(dir, "secret"), secret);
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "scripts/pingMonitor/store/server.mjs"], {
    env: { ...process.env, PING_STORE_DB: join(dir, "store.db"), PING_STORE_SECRET_FILE: join(dir, "secret"), PING_STORE_PORT: String(PORT) },
    stdio: "ignore",
  });
  process.env.PING_STORE_BACKEND = "internal";
  process.env.PING_STORE_URL = `http://127.0.0.1:${PORT}`;
  process.env.PING_STORE_SECRET = secret;
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("임시 저장소가 안 떴습니다");
});
afterAll(() => {
  server?.kill();
});

describe("사내 저장소 — 시간 기록", () => {
  // 2026-11-03 07:05Z = 한국 16시
  const at = new Date("2026-11-03T07:05:00Z");

  it("대상 읽기 → 기록 → 같은 시 다시 오면 한 번만, 예비(tcp) 뒤 서버(agent)는 바꿔 씀", async () => {
    const { istore } = await import("./internalStore");
    const { loadTargets, recordRound, readRoundStatus, writeRoundStatus } = await import("./runRound");
    await istore.commit([
      { op: "set", c: "pingMonitorStores", id: "A", data: { name: "가", active: true, ipRanges: "10.0.0.1~10.0.0.10", pcCount: 10, lastSample: { at: new Date("2026-11-03T08:00:00Z"), date: "2026-11-03", hour: "17" } } },
      { op: "set", c: "pingMonitorStores", id: "B", data: { name: "나", active: true, ipRanges: "", pcCount: 50 } },
      { op: "set", c: "pingMonitorStores", id: "C", data: { name: "다", active: false, ipRanges: "10.0.1.1~10.0.1.5" } },
    ]);
    const targets = await loadTargets(at);
    expect(targets.map((t) => t.id).sort()).toEqual(["A", "B"]); // 측정 중지(C)는 빠짐
    expect(targets.find((t) => t.id === "A")?.ips).toHaveLength(10);

    const tcp = await recordRound(targets, new Set(["10.0.0.1", "10.0.0.2"]), "tcp", at);
    expect(tcp.stores.find((s) => s.id === "B")?.skipped).toBe("IP 없음");
    let a = await istore.get("pingMonitorStores", "A");
    expect((a?.days as Record<string, unknown>)["2026-11-03"]).toEqual({ a: 2, t: 10, n: 1 });
    // 더 새 회차(17시)가 이미 있으면 lastSample은 안 되돌린다
    expect((a?.lastSample as { hour: string }).hour).toBe("17");
    expect((a?.recent as Record<string, { a: number; at: Date }>)["16"].a).toBe(2);
    expect((a?.recent as Record<string, { at: unknown }>)["16"].at).toBeInstanceOf(Date);

    const again = await recordRound(targets, new Set(["10.0.0.1"]), "tcp", at);
    expect(again.stores.find((s) => s.id === "A")?.skipped).toBe("이번 시간 이미 기록됨");

    await recordRound(targets, new Set(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]), "agent", at);
    a = await istore.get("pingMonitorStores", "A");
    expect((a?.days as Record<string, unknown>)["2026-11-03"]).toEqual({ a: 5, t: 10, n: 1 }); // 2→5로 바꿈, n은 그대로
    const daily = await istore.get("pingMonitorDaily", "A_2026-11-03");
    expect((daily?.hours as Record<string, unknown>)["16"]).toEqual({ a: 5, t: 10, m: "agent" });

    await writeRoundStatus({ ok: true, at: at.toISOString(), date: "2026-11-03", hour: "16", method: "agent", stores: [] });
    expect((await readRoundStatus())?.hour).toBe("16");
  });
});

describe("사내 저장소 — 화면 창구 규칙(firestore.rules와 같게)", () => {
  const call = async (body: unknown, token = "ok") => {
    const { POST } = await import("@/app/api/ping-monitor/db/route");
    const res = await POST(new Request("http://x/api/ping-monitor/db", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("로그인 안 하면 막힘", async () => {
    expect((await call({ op: "list", c: "pingMonitorStores" }, "nope")).status).toBe(401);
  });
  it("화면 칸만 만들기·고치기, 측정 기록·우리 매장 칸은 막힘", async () => {
    const made = await call({ op: "add", c: "pingMonitorStores", data: { name: "새", ipRanges: "", active: true, createdAt: { __now: true } } });
    expect(made.status).toBe(200);
    const id = String(made.json.id);
    expect((await call({ op: "add", c: "pingMonitorStores", data: { name: "x", isOwnStore: true } })).status).toBe(403);
    expect((await call({ op: "commit", writes: [{ op: "update", c: "pingMonitorStores", id, data: { days: {} } }] })).status).toBe(403);
    expect((await call({ op: "commit", writes: [{ op: "update", c: "pingMonitorDaily", id, data: { name: "x" } }] })).status).toBe(403);
    expect((await call({ op: "commit", writes: [{ op: "update", c: "pingMonitorStores", id, data: { memo: "고침", updatedAt: { __now: true } } }] })).status).toBe(200);
    const got = await call({ op: "get", c: "pingMonitorStores", id });
    expect((got.json.doc as { memo: string }).memo).toBe("고침");
    expect((got.json.doc as { createdAt: { __ts: string } }).createdAt.__ts).toMatch(/^\d{4}-/);
  });
  it("지우기는 빈 항목만", async () => {
    expect((await call({ op: "commit", writes: [{ op: "delete", c: "pingMonitorStores", id: "A" }] })).status).toBe(403); // 기록 있음
    const made = await call({ op: "add", c: "pingMonitorStores", data: { name: "빈칸", ipRanges: "" } });
    expect((await call({ op: "commit", writes: [{ op: "delete", c: "pingMonitorStores", id: made.json.id }] })).status).toBe(200);
  });
  it("일별 기록 ID 범위 읽기", async () => {
    const r = await call({ op: "list", c: "pingMonitorDaily", idFrom: "A_2026-11-01", idTo: "A_2026-11-03\u0000" });
    expect((r.json.docs as { id: string }[]).map((d) => d.id)).toEqual(["A_2026-11-03"]);
  });
});
