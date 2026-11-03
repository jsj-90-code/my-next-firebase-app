// 사내 저장소 문서 다루기 시험: node --test scripts/pingMonitor/store/server.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, openDb, sign } from "./server.mjs";

const fresh = () => makeStore(openDb(":memory:"));

test("merge는 깊게 합치고 __inc는 더한다(recordRound days 칸)", () => {
  const s = fresh();
  s.commit([{ op: "merge", c: "S", id: "a", data: { days: { "2026-11-03": { a: { __inc: 5 }, t: { __inc: 10 }, n: { __inc: 1 } } }, name: "x" } }]);
  s.commit([{ op: "merge", c: "S", id: "a", data: { days: { "2026-11-03": { a: { __inc: 3 }, t: { __inc: 10 }, n: { __inc: 1 } } } } }]);
  assert.deepEqual(s.get("S", "a"), { name: "x", days: { "2026-11-03": { a: 8, t: 20, n: 2 } } });
});

test("update는 점 경로, 끝 객체는 통째로 바꾸고 없는 문서면 묶음 전체 실패", () => {
  const s = fresh();
  s.commit([{ op: "set", c: "S", id: "a", data: { lastSample: { a: 1, b: 2 }, keep: 1 } }]);
  s.commit([{ op: "update", c: "S", id: "a", data: { lastSample: { a: 9 }, "recent.13": { a: 4 } } }]);
  assert.deepEqual(s.get("S", "a"), { lastSample: { a: 9 }, keep: 1, recent: { 13: { a: 4 } } });
  assert.throws(() => s.commit([{ op: "set", c: "S", id: "b", data: {} }, { op: "update", c: "S", id: "zz", data: { x: 1 } }]));
  assert.equal(s.get("S", "b"), null, "앞 쓰기도 되돌려야 한다");
});

test("__del은 칸을 지우고 Timestamp는 그대로 담긴다", () => {
  const s = fresh();
  s.commit([{ op: "set", c: "S", id: "a", data: { ipCheck: "x", at: { __ts: "2026-11-03T07:00:00.000Z" } } }]);
  s.commit([{ op: "update", c: "S", id: "a", data: { ipCheck: { __del: true } } }]);
  assert.deepEqual(s.get("S", "a"), { at: { __ts: "2026-11-03T07:00:00.000Z" } });
});

test("list: where(==, in, >=, <)와 ID 범위(pingMonitorDaily 매장_날짜)", () => {
  const s = fresh();
  s.commit([
    { op: "set", c: "S", id: "1", data: { ownCode: "N001", competitorId: "c1" } },
    { op: "set", c: "S", id: "2", data: { ownCode: "직접:가", competitorId: "c2" } },
    { op: "set", c: "S", id: "3", data: { ownCode: "N002", competitorId: "c3" } },
    { op: "set", c: "D", id: "1_2026-11-01", data: {} },
    { op: "set", c: "D", id: "1_2026-11-03", data: {} },
    { op: "set", c: "D", id: "10_2026-11-02", data: {} },
  ]);
  assert.deepEqual(s.list({ c: "S", where: [["ownCode", "==", "N001"]] }).map((d) => d.id), ["1"]);
  assert.deepEqual(s.list({ c: "S", where: [["competitorId", "in", ["c2", "c3"]]] }).map((d) => d.id), ["2", "3"]);
  assert.deepEqual(s.list({ c: "S", where: [["ownCode", ">=", "직접"], ["ownCode", "<", "직접\uf8ff"]] }).map((d) => d.id), ["2"]);
  assert.deepEqual(s.list({ c: "D", idFrom: "1_2026-11-02", idTo: "1_2026-11-04" }).map((d) => d.id), ["1_2026-11-03"]);
});

test("add는 20자 ID, 서명은 본문·경로·시각이 다 들어간다", () => {
  const s = fresh();
  const id = s.add("S", { a: 1 });
  assert.equal(id.length, 20);
  assert.deepEqual(s.get("S", id), { a: 1 });
  const k = "k".repeat(40);
  assert.notEqual(sign(k, 1, "/v1/get", "{}"), sign(k, 2, "/v1/get", "{}"));
  assert.notEqual(sign(k, 1, "/v1/get", "{}"), sign(k, 1, "/v1/list", "{}"));
});
