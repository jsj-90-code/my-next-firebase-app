// noise.mjs를 cacophony 공식 시험값(Noise_XK_25519_ChaChaPoly_SHA256)과 바이트 단위로 대조한다.
// 실행: node scripts/gettoInbox/noise.test.mjs
// 시험값 출처: https://github.com/haskell-cryptography/cacophony/blob/master/vectors/cacophony.txt

import assert from "node:assert/strict";
import { XKHandshake, generateKeypair, FrameReader, frame } from "./noise.mjs";

const hx = (s) => Buffer.from(s, "hex");

const V = {
  prologue: "4a6f686e2047616c74",
  init_static: "e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1",
  init_ephemeral: "893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
  init_remote_static: "31e0303fd6418d2f8c0e78b91f22e8caed0fbe48656dcf4767e4834f701b8f62",
  resp_static: "4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893",
  resp_ephemeral: "bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
  handshake_hash: "cefffc5d1074126cc980ebfe902587ff36ba61dc77d4447ebe0f96dc22ae59d7",
  messages: [
    ["4c756477696720766f6e204d69736573", "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944a3785af283c991bab613473804356ef6931f83acf64f99c274b93570857cfc5e"],
    ["4d757272617920526f746862617264", "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088433a4534805fa9fe4eb8343ace6609160c767ad9b832e8eea1d9b7a2111818dd"],
    ["462e20412e20486179656b", "5d8e67b9c1b8e36f5dc674bc5cd2ce243fb5d1710fa57de0370da7cc979015398eaad94603b05498ba9a613d2fd923dcaa6fd4288dfd8d70f419bf737efb4cd37f5da37ebb728849318c82"],
    ["4361726c204d656e676572", "3205e1265f809505e6edc092839d3156745d2abafbfd946b261e41"],
    ["4a65616e2d426170746973746520536179", "470bcb1ae099555ff0d729500df550418d6ee5149d9e40bd2f4c6b3d263cc818d5"],
    ["457567656e2042f6686d20766f6e2042617765726b", "d7187ed9d217ba6e91cf596e4871012ccedf7b5bed0d4cb8f7affb020fa17a95a23371e0f6"],
  ],
};

// 1. 공식 시험값
{
  const ini = new XKHandshake({ initiator: true, s: hx(V.init_static), e: hx(V.init_ephemeral), rs: hx(V.init_remote_static), prologue: hx(V.prologue) });
  const res = new XKHandshake({ initiator: false, s: hx(V.resp_static), e: hx(V.resp_ephemeral), prologue: hx(V.prologue) });
  const order = [ini, res, ini];
  for (let i = 0; i < 3; i++) {
    const w = order[i];
    const r = w === ini ? res : ini;
    const [pt, ct] = V.messages[i];
    const out = w.writeMessage(hx(pt));
    assert.equal(out.toString("hex"), ct, `handshake msg ${i}`);
    assert.equal(r.readMessage(out).toString("hex"), pt, `handshake read ${i}`);
  }
  assert.equal(ini.handshakeHash.toString("hex"), V.handshake_hash);
  assert.equal(res.handshakeHash.toString("hex"), V.handshake_hash);
  const I = ini.split();
  const R = res.split();
  for (let i = 3; i < V.messages.length; i++) {
    const [pt, ct] = V.messages[i];
    const [tx, rx] = i % 2 === 1 ? [R.send, I.recv] : [I.send, R.recv];
    const out = tx.encryptWithAd(Buffer.alloc(0), hx(pt));
    assert.equal(out.toString("hex"), ct, `transport msg ${i}`);
    assert.equal(rx.decryptWithAd(Buffer.alloc(0), out).toString("hex"), pt);
  }
  console.log("ok  cacophony vector Noise_XK_25519_ChaChaPoly_SHA256");
}

// 2. 무작위 키로 왕복 + 서버 공개키가 틀리면 첫 메시지에서 실패
{
  const server = generateKeypair();
  const store = generateKeypair();
  const ini = new XKHandshake({ initiator: true, s: store.priv, rs: server.pub });
  const res = new XKHandshake({ initiator: false, s: server.priv });
  res.readMessage(ini.writeMessage());
  ini.readMessage(res.writeMessage());
  res.readMessage(ini.writeMessage(Buffer.from("hello")));
  assert.ok(res.remoteStatic.equals(store.pub), "server learns store static key");

  const wrong = generateKeypair();
  const ini2 = new XKHandshake({ initiator: true, s: store.priv, rs: wrong.pub });
  const res2 = new XKHandshake({ initiator: false, s: server.priv });
  assert.throws(() => res2.readMessage(ini2.writeMessage()), "wrong server key must fail at msg1");
  console.log("ok  random roundtrip / wrong server key rejected");
}

// 3. 프레임 나눠 받기
{
  const fr = new FrameReader();
  const all = Buffer.concat([frame(Buffer.from("abc")), frame(Buffer.alloc(0)), frame(Buffer.from("xyz"))]);
  const got = [];
  for (const b of all) got.push(...fr.push(Buffer.from([b])));
  assert.deepEqual(got.map((x) => x.toString()), ["abc", "", "xyz"]);
  console.log("ok  framing");
}
