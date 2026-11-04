// 받는 프로그램 + 가짜 매장 전체 시험 (임시 폴더·임시 키, 포트 아무거나)
// 실행: node scripts/gettoInbox/receiver.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "getto-test-"));
process.env.GETTO_KEYS_DIR = path.join(tmp, "keys");
process.env.GETTO_INBOX_DIR = path.join(tmp, "inbox");

const { createServerKey, issueToken, revokeStore, loadStores } = await import("./registry.mjs");
const { handleConnection } = await import("./receiver.mjs");
const { runClient } = await import("./testClient.mjs");
const { generateKeypair } = await import("./noise.mjs");

const prodPub = createServerKey("prod");
const devPub = createServerKey("dev");
const server = net.createServer(handleConnection);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const quiet = () => {};
const base = { host: "127.0.0.1", port, log: quiet };

try {
  // 1. 토큰으로 첫 등록 + 재전송·재결산·옛 판·형식 오류
  const token = issueToken("prod", "G0001", "시험매장");
  const keyFile = path.join(tmp, "store1.key");
  let r = await runClient({ ...base, serverPub: prodPub.toString("hex"), storeId: "G0001", token, keyFile, scenario: "resend" });
  assert.ok(r.ok, "resend scenario: " + JSON.stringify(r.results));
  assert.equal(loadStores("prod").stores.G0001.status, "active");
  console.log("ok  등록 + 재전송/재결산/옛 판/형식 오류 ACK");

  // 최신값은 재결산(revision 1) 내용
  const cur = path.join(tmp, "inbox", "prod", "current", "G0001", "sales");
  const files = fs.readdirSync(cur);
  assert.equal(files.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(cur, files[0]), "utf8"));
  assert.equal(saved.revision, 1);
  assert.equal(saved.message.payload.pcSales, 415000);
  console.log("ok  최신값 = 재결산본");

  // 2. 토큰 다시 쓰기 → 같은 키면 토큰 없이도 통과
  r = await runClient({ ...base, serverPub: prodPub.toString("hex"), storeId: "G0001", keyFile });
  assert.ok(r.ok);
  console.log("ok  묶인 키는 토큰 없이 접속");

  // 3. 다른 키로 같은 매장 사칭 → 거절
  r = await runClient({ ...base, serverPub: prodPub.toString("hex"), storeId: "G0001", token });
  assert.ok(!r.ok && r.welcome?.code === "E_AUTH", JSON.stringify(r.welcome));
  console.log("ok  다른 키 사칭 거절(쓴 토큰 재사용 불가)");

  // 4. 개발 키로 접속하면 dev 등록부·dev 폴더
  const devTok = issueToken("dev", "G0001");
  r = await runClient({ ...base, serverPub: devPub.toString("hex"), storeId: "G0001", token: devTok, keyFile: path.join(tmp, "dev.key") });
  assert.ok(r.ok);
  assert.ok(fs.existsSync(path.join(tmp, "inbox", "dev", "current", "G0001")));
  console.log("ok  개발 키 → dev로 분리 저장");

  // 5. 모르는 서버 키 → 핸드셰이크 실패로 끊김
  r = await runClient({ ...base, serverPub: generateKeypair().pub.toString("hex"), storeId: "G0001", keyFile });
  assert.ok(!r.ok);
  console.log("ok  틀린 서버 공개키 거절");

  // 6. 폐기
  revokeStore("prod", "G0001");
  r = await runClient({ ...base, serverPub: prodPub.toString("hex"), storeId: "G0001", keyFile });
  assert.equal(r.welcome?.code, "E_REVOKED");
  console.log("ok  폐기 매장 E_REVOKED");

  // 7. 아무 바이트(옛 평문 시험 등) → 기록하고 끊음
  await new Promise((res) => {
    const s = net.connect(port, "127.0.0.1", () => s.write("{\"hello\":\"plain json\"}\n"));
    s.on("close", res);
    s.on("error", res);
    setTimeout(() => s.destroy(), 3000);
  });
  const ev = fs.readFileSync(path.join(tmp, "inbox", "events", fs.readdirSync(path.join(tmp, "inbox", "events"))[0]), "utf8");
  assert.ok(ev.includes("E_HANDSHAKE") || ev.includes("handshake_timeout") || ev.includes("E_FORMAT"));
  console.log("ok  평문 접속 거절·기록");
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
