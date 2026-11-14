// 사내 저장소 쪽 끝까지 시험(2026-11-03) — 이 PC에 임시 저장소(scripts/pingMonitor/store/server.mjs)를 띄워
// 시간 기록(recordRound)·대상 읽기(loadTargets)·상태 기록·화면 창구(/api/ping-monitor/db) 규칙을 실제 HTTP로 돌린다.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ adminDb: null, adminAuth: null }));
vi.mock("@/lib/pingMonitor/agentAuth", () => ({ checkAgentSignature: () => null })); // 서명은 agentAuth 자체 시험 몫 — 여기선 받은 뒤 규칙만
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

describe("밀린 회차 받기(2026-11-15 — 웹 정지 동안 서버 pending에 쌓인 회차)", () => {
  const ipKey = (ips: string[]) => createHash("sha256").update(ips.join(",")).digest("hex").slice(0, 16);
  const ips = Array.from({ length: 10 }, (_, i) => `10.9.0.${i + 1}`);
  const post = async (payload: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/ping-monitor/agent/results/route");
    const res = await POST(new Request("http://x/api/ping-monitor/agent/results", { method: "POST", body: JSON.stringify(payload) }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("7일 전 회차는 그 날·시에 기록하고, 상태 문서·더 새 시간대 칸·lastSample은 그대로", async () => {
    const { istore } = await import("./internalStore");
    const { kstParts } = await import("./summary");
    const now = Date.now();
    const at = new Date(now - 7 * 24 * 3600_000);
    const { date, hour } = kstParts(at);
    const newer = new Date(now - 3600_000);
    await istore.commit([
      { op: "set", c: "pingMonitorStores", id: "L", data: { name: "늦", active: true, ipRanges: "10.9.0.1~10.9.0.10", pcCount: 10,
        recent: { [hour]: { a: 7, t: 10, at: newer } }, lastSample: { at: newer, date: kstParts(newer).date, hour: kstParts(newer).hour, alive: 7 } } },
      { op: "set", c: "storeEvalSystemStatus", id: "pingMonitor", data: { ok: true, at: newer.toISOString(), hour: "최신" } },
    ]);
    const r = await post({ at: at.toISOString(), method: "icmp+tcp+timestamp", aliveIps: ips.slice(0, 3), measured: { L: 10 }, measuredIps: { L: ipKey(ips) } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, late: true, date, hour, written: 1 });
    const daily = await istore.get("pingMonitorDaily", `L_${date}`);
    expect((daily?.hours as Record<string, unknown>)[hour]).toEqual({ a: 3, t: 10, m: "icmp+tcp+timestamp" });
    const store = await istore.get("pingMonitorStores", "L");
    expect((store?.days as Record<string, unknown>)[date]).toEqual({ a: 3, t: 10, n: 1 });
    expect((store?.recent as Record<string, { a: number }>)[hour].a).toBe(7); // 더 새 칸은 안 덮음
    expect((store?.lastSample as { alive: number }).alive).toBe(7);
    const status = await istore.get("storeEvalSystemStatus", "pingMonitor");
    expect(status?.hour).toBe("최신"); // 상태 문서 그대로

    // 같은 회차가 또 오면(응답을 못 받아 서버가 다시 보냄) 한 번만 센다
    const again = await post({ at: at.toISOString(), method: "icmp+tcp+timestamp", aliveIps: ips.slice(0, 5), measured: { L: 10 }, measuredIps: { L: ipKey(ips) } });
    expect(again.json).toMatchObject({ ok: true, written: 0 });
    expect(((await istore.get("pingMonitorStores", "L"))?.days as Record<string, unknown>)[date]).toEqual({ a: 3, t: 10, n: 1 });
  });

  it("IP 수는 같아도 대역이 바뀐 매장(지문 다름)은 기록하지 않는다", async () => {
    const at = new Date(Date.now() - 3 * 24 * 3600_000);
    const old = Array.from({ length: 10 }, (_, i) => `10.8.0.${i + 1}`);
    const r = await post({ at: at.toISOString(), method: "icmp+tcp+timestamp", aliveIps: old.slice(0, 4), measured: { L: 10 }, measuredIps: { L: ipKey(old) } });
    expect(r.json).toMatchObject({ ok: true, stores: 0, written: 0 });
  });

  it("36일 전 회차는 거절(4xx → 서버가 pending을 지움)", async () => {
    const at = new Date(Date.now() - 36 * 24 * 3600_000);
    const r = await post({ at: at.toISOString(), method: "icmp+tcp+timestamp", aliveIps: [], measured: { L: 10 } });
    expect(r.status).toBe(400);
  });

  it("상태 문서는 더 새 회차가 적혀 있으면 안 덮는다", async () => {
    const { writeRoundStatus, readRoundStatus } = await import("./runRound");
    const old = new Date(Date.now() - 2 * 3600_000);
    expect(await writeRoundStatus({ ok: true, at: old.toISOString(), date: "x", hour: "옛", method: "agent", stores: [] })).toBe(false);
    expect((await readRoundStatus())?.hour).toBe("최신");
    expect(await writeRoundStatus({ ok: true, at: new Date().toISOString(), date: "x", hour: "새", method: "agent", stores: [] })).toBe(true);
    expect((await readRoundStatus())?.hour).toBe("새");
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
