// 가짜 매장 — 게토 카운터 대신 접속해 규격(docs/getto-receiver-spec.md)대로 보내 본다.
// 게토 개발팀에 참고 구현으로 줘도 된다(비밀값 없음).
//
//   node testClient.mjs --host <주소> --port 19000 --server-pub <서버 공개키 hex> --store <storeId>
//                       [--token <등록토큰>] [--key-file ./store.key] [--scenario basic|resend]
//
// 매장 키는 --key-file에 없으면 새로 만들어 저장한다(첫 접속에만 토큰 필요).
// 종료 코드 0 = 모든 ACK가 기대대로.

import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";
import { XKHandshake, FrameReader, frame, generateKeypair } from "./noise.mjs";
import { PROLOGUE, AppAssembler, encodeApp } from "./protocol.mjs";

function args() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, "")] = v[i + 1];
  return a;
}

export async function runClient({ host, port, serverPub, storeId, token, keyFile, scenario = "basic", log = console.log }) {
  let priv;
  if (keyFile && fs.existsSync(keyFile)) priv = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
  else {
    priv = generateKeypair().priv;
    if (keyFile) fs.writeFileSync(keyFile, priv.toString("hex") + "\n", { mode: 0o600 });
  }

  const sock = net.connect({ host, port: Number(port) });
  const hs = new XKHandshake({ initiator: true, s: priv, rs: Buffer.from(serverPub, "hex"), prologue: PROLOGUE });
  const reader = new FrameReader();
  const asm = new AppAssembler();
  let transport = null;
  const waiters = [];
  const inbox = [];

  const nextMsg = () =>
    new Promise((res, rej) => {
      if (inbox.length) return res(inbox.shift());
      waiters.push({ res, rej });
    });

  const done = new Promise((resolve) => sock.on("close", resolve));
  sock.on("error", (e) => waiters.splice(0).forEach((w) => w.rej(e)));
  sock.on("close", () => waiters.splice(0).forEach((w) => w.rej(new Error("closed"))));

  await new Promise((r, j) => {
    sock.once("connect", r);
    sock.once("error", j);
  });

  sock.write(frame(hs.writeMessage())); // -> e, es

  sock.on("data", (buf) => {
    for (const f of reader.push(buf)) {
      if (!transport) {
        hs.readMessage(f); // <- e, ee
        const hello = { type: "hello", storeId, client: { name: "isens-testClient", version: "1" }, schemaVersion: "1" };
        if (token) hello.enrollToken = token;
        sock.write(frame(hs.writeMessage(Buffer.from(JSON.stringify(hello))))); // -> s, se + hello
        transport = hs.split();
        continue;
      }
      const got = asm.push(transport.recv.decryptWithAd(Buffer.alloc(0), f));
      if (!got) continue;
      const w = waiters.shift();
      if (w) w.res(got.obj);
      else inbox.push(got.obj);
    }
  });

  const send = (obj) => sock.write(encodeApp(transport.send, obj));
  const results = [];

  try {
    const welcome = await nextMsg();
    log("서버:", JSON.stringify(welcome));
    if (welcome.type !== "welcome") {
      sock.destroy();
      return { ok: false, welcome, results };
    }

    const day = "2026-11-03";
    const ps = `${day}T09:00:00+09:00`;
    const pe = `2026-11-04T09:00:00+09:00`;
    const base = { type: "data", storeId, periodStart: ps, periodEnd: pe, generatedAt: new Date().toISOString() };
    const mk = (kind, payload, revision = 0) => ({ ...base, msgId: crypto.randomUUID(), kind, revision, payload });

    const plan = [
      [mk("seats", { seats: [{ seatNo: "1", areaName: "일반석", active: true }, { seatNo: "2", areaName: "커플석", active: true }] }), "stored|unchanged"],
      [
        mk("sessions", {
          sessions: [
            { seatNo: "1", start: `${day}T13:02:00+09:00`, end: `${day}T15:40:00+09:00`, memberKey: "9f2c…a1", memberClass: "member", chargeType: "time", usedAmount: 3000, games: [{ name: "리그 오브 레전드", minutes: 150 }] },
          ],
        }),
        "stored|unchanged",
      ],
    ];
    const sales0 = mk("sales", { pcSales: 412000, foodSales: 233500, otherSales: 0, discount: 12000, refund: 0, payment: { cash: 50000, card: 583500, etc: 0 } }, 0);
    plan.push([sales0, "stored|unchanged|superseded"]);
    if (scenario === "resend") {
      plan.push([{ ...sales0, msgId: crypto.randomUUID() }, "unchanged"]); // 같은 내용 재전송
      plan.push([{ ...sales0, msgId: crypto.randomUUID(), revision: 1, payload: { ...sales0.payload, pcSales: 415000 } }, "stored"]); // 재결산
      plan.push([{ ...sales0, msgId: crypto.randomUUID() }, "superseded"]); // 늦게 온 옛 판
      plan.push([{ ...base, msgId: crypto.randomUUID(), kind: "sales", periodStart: "어제", payload: {} }, "E_SCHEMA"]);
    }

    for (const [m, expect] of plan) {
      send(m);
      const ack = await nextMsg();
      const got = ack.ok ? ack.status : ack.code;
      const pass = ack.type === "ack" && ack.msgId === m.msgId && expect.split("|").includes(got);
      results.push({ kind: m.kind, revision: m.revision, expect, got, pass });
      log(`${pass ? "ok " : "BAD"} ${m.kind} r${m.revision} → ${got} (기대 ${expect})`);
    }
    send({ type: "ping" });
    const pong = await nextMsg();
    results.push({ kind: "ping", expect: "pong", got: pong.type, pass: pong.type === "pong" });
  } catch (e) {
    log("오류:", e.message);
    results.push({ kind: "connection", pass: false, got: e.message });
  }
  sock.end();
  await done;
  return { ok: results.length > 0 && results.every((r) => r.pass), results };
}

import { fileURLToPath } from "node:url";
import path from "node:path";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args();
  runClient({ host: a.host, port: a.port || 19000, serverPub: a["server-pub"], storeId: a.store, token: a.token, keyFile: a["key-file"], scenario: a.scenario }).then((r) =>
    process.exit(r.ok ? 0 : 1),
  );
}
