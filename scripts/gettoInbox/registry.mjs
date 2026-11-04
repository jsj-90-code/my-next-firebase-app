// 서버 키와 매장 등록부(키 파일·JSON). 비밀값이라 git에 넣지 않는다 — 서버의 KEYS_DIR(기본 ~/getto-receiver/keys)에만.
//
// KEYS_DIR/
//   server-<env>.key        서버 개인키(hex 64자, 권한 600)   env = prod | dev
//   server-<env>-next.key   갱신 예정 키(있으면 둘 다 받는다)
//   stores-<env>.json       매장 등록부

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { publicFromPrivate, generateKeypair } from "./noise.mjs";

export const ENVS = ["prod", "dev"];

export function keysDir() {
  return process.env.GETTO_KEYS_DIR || path.join(os.homedir(), "getto-receiver", "keys");
}

function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readKey(file) {
  if (!fs.existsSync(file)) return null;
  const hex = fs.readFileSync(file, "utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`bad key file ${file}`);
  return Buffer.from(hex, "hex");
}

export function serverKeyFile(env, next = false) {
  return path.join(keysDir(), `server-${env}${next ? "-next" : ""}.key`);
}

export function createServerKey(env, next = false) {
  const file = serverKeyFile(env, next);
  if (fs.existsSync(file)) throw new Error(`이미 있음: ${file}`);
  const kp = generateKeypair();
  writeSecret(file, kp.priv.toString("hex") + "\n");
  return kp.pub;
}

export function promoteServerKey(env) {
  const next = serverKeyFile(env, true);
  if (!fs.existsSync(next)) throw new Error("갱신 예정 키가 없음");
  fs.renameSync(next, serverKeyFile(env));
}

/** 받을 수 있는 서버 키 전부: [{ env, slot, priv, pub }] — 첫 메시지를 이 순서로 풀어 본다 */
export function loadServerKeys() {
  const out = [];
  for (const env of ENVS) {
    for (const next of [false, true]) {
      const priv = readKey(serverKeyFile(env, next));
      if (priv) out.push({ env, slot: next ? "next" : "current", priv, pub: publicFromPrivate(priv) });
    }
  }
  return out;
}

export function fingerprint(pub) {
  return crypto.createHash("sha256").update(pub).digest("hex").slice(0, 16).match(/.{4}/g).join("-");
}

// ── 매장 등록부 ──────────────────────────────────────────────

function storesFile(env) {
  return path.join(keysDir(), `stores-${env}.json`);
}

export function loadStores(env) {
  const f = storesFile(env);
  if (!fs.existsSync(f)) return { stores: {} };
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function saveStores(env, reg) {
  writeSecret(storesFile(env), JSON.stringify(reg, null, 2) + "\n");
}

const hashToken = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

/** 등록토큰 발급(1회용). 이미 묶인 키는 새 키가 들어올 때까지 그대로 쓴다(PC 교체 대비). 토큰 원문은 여기서만 보인다. */
export function issueToken(env, storeId, name = "", days = 30) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) throw new Error("storeId: 영문·숫자·_- 1~64자");
  const reg = loadStores(env);
  const token = crypto.randomBytes(24).toString("base64url");
  const prev = reg.stores[storeId] || {};
  reg.stores[storeId] = {
    ...prev,
    name: name || prev.name || "",
    status: prev.status === "active" ? "active" : "pending",
    tokenHash: hashToken(token),
    tokenExpires: new Date(Date.now() + days * 86400_000).toISOString(),
    issuedAt: new Date().toISOString(),
    revokedAt: null,
  };
  if (prev.status === "revoked") reg.stores[storeId].status = "pending";
  saveStores(env, reg);
  return token;
}

export function revokeStore(env, storeId) {
  const reg = loadStores(env);
  const s = reg.stores[storeId];
  if (!s) throw new Error("등록부에 없는 매장");
  s.status = "revoked";
  s.tokenHash = null;
  s.revokedAt = new Date().toISOString();
  saveStores(env, reg);
}

/**
 * 핸드셰이크 끝에 매장 확인. 성공하면 { ok: true, bound: bool }, 아니면 { ok: false, code, message }
 * - 묶인 키와 같으면 통과
 * - 등록토큰이 맞고 안 지났으면 이 키를 묶고 토큰은 지운다(1회용)
 */
export function authenticate(env, storeId, enrollToken, clientPub) {
  const reg = loadStores(env);
  const s = typeof storeId === "string" ? reg.stores[storeId] : undefined;
  const pubHex = clientPub.toString("hex");
  if (!s) return { ok: false, code: "E_AUTH", message: "등록되지 않은 매장" };
  if (s.status === "revoked") return { ok: false, code: "E_REVOKED", message: "폐기된 매장(전송 중지)" };

  const owner = Object.entries(reg.stores).find(([id, o]) => id !== storeId && o.pub === pubHex);
  if (owner) return { ok: false, code: "E_AUTH", message: "이 키는 다른 매장에 묶여 있음" };

  if (s.pub === pubHex && s.status === "active") return { ok: true, bound: false };

  if (typeof enrollToken === "string" && s.tokenHash && hashToken(enrollToken) === s.tokenHash) {
    if (Date.parse(s.tokenExpires) < Date.now()) return { ok: false, code: "E_TOKEN_EXPIRED", message: "등록토큰 기한 지남" };
    s.pub = pubHex;
    s.status = "active";
    s.tokenHash = null;
    s.boundAt = new Date().toISOString();
    saveStores(env, reg);
    return { ok: true, bound: true };
  }
  return { ok: false, code: "E_AUTH", message: s.pub ? "등록된 키와 다름(PC 교체면 토큰 재발급)" : "등록토큰 없음 또는 틀림" };
}
