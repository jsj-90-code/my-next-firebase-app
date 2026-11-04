// Noise_XK_25519_ChaChaPoly_SHA256 (Noise Protocol Framework rev 34) — 외부 라이브러리 없이 node:crypto로.
//
// 게토(엔미디어플랫폼)가 TLS 대신 Noise를 쓰겠다고 해서(2026-11-04 회신) 만든 것.
// XK = 매장(initiator)은 서버 공개키를 미리 알고(K), 자기 고정키는 세 번째 메시지에 암호화해 보낸다(X).
//   <- s
//   ...
//   -> e, es
//   <- e, ee
//   -> s, se
// 검증: noise.test.mjs가 cacophony 공식 시험값과 바이트 단위로 맞춘다.

import crypto from "node:crypto";

export const PROTOCOL_NAME = "Noise_XK_25519_ChaChaPoly_SHA256";
const DHLEN = 32;
const HASHLEN = 32;
const TAGLEN = 16;
export const MAX_MESSAGE = 65535;

const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

function privKeyObj(raw) {
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: "der", type: "pkcs8" });
}
function pubKeyObj(raw) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: "der", type: "spki" });
}

export function publicFromPrivate(priv) {
  return crypto.createPublicKey(privKeyObj(priv)).export({ format: "der", type: "spki" }).subarray(-32);
}

export function generateKeypair() {
  const priv = crypto.randomBytes(32);
  return { priv, pub: publicFromPrivate(priv) };
}

function keypairFrom(priv) {
  return { priv: Buffer.from(priv), pub: publicFromPrivate(priv) };
}

function dh(kp, pub) {
  return crypto.diffieHellman({ privateKey: privKeyObj(kp.priv), publicKey: pubKeyObj(pub) });
}

function hash(...parts) {
  const h = crypto.createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

function hmac(key, ...parts) {
  const h = crypto.createHmac("sha256", key);
  for (const p of parts) h.update(p);
  return h.digest();
}

function hkdf(ck, ikm, n) {
  const temp = hmac(ck, ikm);
  const o1 = hmac(temp, Buffer.from([1]));
  const o2 = hmac(temp, o1, Buffer.from([2]));
  if (n === 2) return [o1, o2];
  const o3 = hmac(temp, o2, Buffer.from([3]));
  return [o1, o2, o3];
}

function nonceBytes(n) {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(BigInt(n), 4);
  return b;
}

function encrypt(k, n, ad, plaintext) {
  const c = crypto.createCipheriv("chacha20-poly1305", k, nonceBytes(n), { authTagLength: TAGLEN });
  c.setAAD(ad, { plaintextLength: plaintext.length });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

function decrypt(k, n, ad, ciphertext) {
  if (ciphertext.length < TAGLEN) throw new Error("noise: ciphertext too short");
  const body = ciphertext.subarray(0, ciphertext.length - TAGLEN);
  const tag = ciphertext.subarray(ciphertext.length - TAGLEN);
  const d = crypto.createDecipheriv("chacha20-poly1305", k, nonceBytes(n), { authTagLength: TAGLEN });
  d.setAAD(ad, { plaintextLength: body.length });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]); // 위조면 여기서 throw
}

export class CipherState {
  constructor(k = null) {
    this.k = k;
    this.n = 0;
  }
  hasKey() {
    return this.k !== null;
  }
  encryptWithAd(ad, pt) {
    if (!this.k) return Buffer.from(pt);
    if (this.n >= 2 ** 64 - 1) throw new Error("noise: nonce exhausted");
    return encrypt(this.k, this.n++, ad, pt);
  }
  decryptWithAd(ad, ct) {
    if (!this.k) return Buffer.from(ct);
    const pt = decrypt(this.k, this.n, ad, ct);
    this.n++;
    return pt;
  }
}

class SymmetricState {
  constructor(name) {
    const nb = Buffer.from(name, "ascii");
    this.h = nb.length <= HASHLEN ? Buffer.concat([nb, Buffer.alloc(HASHLEN - nb.length)]) : hash(nb);
    this.ck = Buffer.from(this.h);
    this.cs = new CipherState();
  }
  mixKey(ikm) {
    const [ck, tk] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cs = new CipherState(tk);
  }
  mixHash(data) {
    this.h = hash(this.h, data);
  }
  encryptAndHash(pt) {
    const ct = this.cs.encryptWithAd(this.h, pt);
    this.mixHash(ct);
    return ct;
  }
  decryptAndHash(ct) {
    const pt = this.cs.decryptWithAd(this.h, ct);
    this.mixHash(ct);
    return pt;
  }
  split() {
    const [k1, k2] = hkdf(this.ck, Buffer.alloc(0), 2);
    return [new CipherState(k1), new CipherState(k2)];
  }
}

/**
 * XK 핸드셰이크.
 * initiator: { initiator: true, s: 매장 개인키, rs: 서버 공개키 }
 * responder: { initiator: false, s: 서버 개인키 }
 * e: 시험값용 고정 임시키(평소엔 비움)
 */
export class XKHandshake {
  constructor({ initiator, s, rs = null, e = null, prologue = Buffer.alloc(0) }) {
    this.initiator = initiator;
    this.s = keypairFrom(s);
    this.e = e ? keypairFrom(e) : null;
    this.rs = rs ? Buffer.from(rs) : null;
    this.re = null;
    this.ss = new SymmetricState(PROTOCOL_NAME);
    this.ss.mixHash(prologue);
    // 사전 메시지 "<- s": 서버 공개키
    if (initiator) {
      if (!this.rs) throw new Error("noise: initiator needs server public key");
      this.ss.mixHash(this.rs);
    } else {
      this.ss.mixHash(this.s.pub);
    }
    this.step = 0;
  }

  get handshakeHash() {
    return Buffer.from(this.ss.h);
  }

  get remoteStatic() {
    return this.rs ? Buffer.from(this.rs) : null;
  }

  isDone() {
    return this.step === 3;
  }

  _ephemeral() {
    if (!this.e) this.e = generateKeypair();
  }

  writeMessage(payload = Buffer.alloc(0)) {
    const ss = this.ss;
    let out;
    if (this.step === 0 && this.initiator) {
      // -> e, es
      this._ephemeral();
      ss.mixHash(this.e.pub);
      ss.mixKey(dh(this.e, this.rs));
      out = Buffer.concat([this.e.pub, ss.encryptAndHash(payload)]);
    } else if (this.step === 1 && !this.initiator) {
      // <- e, ee
      this._ephemeral();
      ss.mixHash(this.e.pub);
      ss.mixKey(dh(this.e, this.re));
      out = Buffer.concat([this.e.pub, ss.encryptAndHash(payload)]);
    } else if (this.step === 2 && this.initiator) {
      // -> s, se
      const encS = ss.encryptAndHash(this.s.pub);
      ss.mixKey(dh(this.s, this.re));
      out = Buffer.concat([encS, ss.encryptAndHash(payload)]);
    } else {
      throw new Error(`noise: not our turn to write (step ${this.step})`);
    }
    this.step++;
    return out;
  }

  readMessage(msg) {
    const ss = this.ss;
    let payload;
    if (this.step === 0 && !this.initiator) {
      // -> e, es
      if (msg.length < DHLEN + TAGLEN) throw new Error("noise: msg1 too short");
      this.re = Buffer.from(msg.subarray(0, DHLEN));
      ss.mixHash(this.re);
      ss.mixKey(dh(this.s, this.re));
      payload = ss.decryptAndHash(msg.subarray(DHLEN));
    } else if (this.step === 1 && this.initiator) {
      // <- e, ee
      if (msg.length < DHLEN + TAGLEN) throw new Error("noise: msg2 too short");
      this.re = Buffer.from(msg.subarray(0, DHLEN));
      ss.mixHash(this.re);
      ss.mixKey(dh(this.e, this.re));
      payload = ss.decryptAndHash(msg.subarray(DHLEN));
    } else if (this.step === 2 && !this.initiator) {
      // -> s, se
      if (msg.length < DHLEN + TAGLEN + TAGLEN) throw new Error("noise: msg3 too short");
      this.rs = ss.decryptAndHash(msg.subarray(0, DHLEN + TAGLEN));
      ss.mixKey(dh(this.e, this.rs));
      payload = ss.decryptAndHash(msg.subarray(DHLEN + TAGLEN));
    } else {
      throw new Error(`noise: not our turn to read (step ${this.step})`);
    }
    this.step++;
    return payload;
  }

  /** 핸드셰이크 끝난 뒤: { send, recv } 전송용 CipherState */
  split() {
    if (!this.isDone()) throw new Error("noise: handshake not finished");
    const [c1, c2] = this.ss.split();
    return this.initiator ? { send: c1, recv: c2 } : { send: c2, recv: c1 };
  }
}

/** 2바이트 길이(빅엔디언) + Noise 메시지 — Noise 명세 권장 TCP 틀 */
export function frame(msg) {
  if (msg.length > MAX_MESSAGE) throw new Error("noise: frame too large");
  const h = Buffer.alloc(2);
  h.writeUInt16BE(msg.length);
  return Buffer.concat([h, msg]);
}

/** 들어오는 바이트를 프레임 단위로 잘라 준다 */
export class FrameReader {
  constructor() {
    this.buf = Buffer.alloc(0);
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const out = [];
    while (this.buf.length >= 2) {
      const len = this.buf.readUInt16BE(0);
      if (this.buf.length < 2 + len) break;
      out.push(this.buf.subarray(2, 2 + len));
      this.buf = this.buf.subarray(2 + len);
    }
    return out;
  }
  get pending() {
    return this.buf.length;
  }
}
