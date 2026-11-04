// 게토 연동 응용 계층 — 서버(receiver.mjs)와 시험 매장(testClient.mjs)이 같이 쓴다.
// 규격 원문: docs/getto-receiver-spec.md
//
// Noise 전송 메시지 하나의 평문 = [1바이트 표시][조각]
//   표시 0x00 = 뒤에 조각이 더 있음, 0x01 = 마지막 조각
// 조각들을 이어 붙인 것이 응용 메시지 하나(UTF-8 JSON).

import { frame, MAX_MESSAGE } from "./noise.mjs";

export const PROLOGUE = Buffer.from("ISENS-GETTO/1", "ascii");
export const MAX_APP_MESSAGE = 32 * 1024 * 1024;
const CHUNK = MAX_MESSAGE - 16 - 1; // 태그 16 + 표시 1

/** 응용 메시지(객체) → 소켓에 쓸 바이트(프레임 여러 개) */
export function encodeApp(cs, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  if (body.length > MAX_APP_MESSAGE) throw new Error("app message too large");
  const parts = [];
  let off = 0;
  do {
    const piece = body.subarray(off, off + CHUNK);
    off += piece.length;
    const flag = Buffer.from([off >= body.length ? 1 : 0]);
    parts.push(frame(cs.encryptWithAd(Buffer.alloc(0), Buffer.concat([flag, piece]))));
  } while (off < body.length);
  return Buffer.concat(parts);
}

/** 복호화된 전송 메시지 평문을 받아 응용 메시지(객체)가 완성되면 돌려준다 */
export class AppAssembler {
  constructor(limit = MAX_APP_MESSAGE) {
    this.parts = [];
    this.size = 0;
    this.limit = limit;
  }
  push(plain) {
    if (plain.length < 1) throw new AppError("E_FORMAT", "empty transport message", false);
    const flag = plain[0];
    if (flag !== 0 && flag !== 1) throw new AppError("E_FORMAT", "bad chunk flag", false);
    this.size += plain.length - 1;
    if (this.size > this.limit) throw new AppError("E_TOO_LARGE", `message over ${this.limit} bytes`, false);
    this.parts.push(plain.subarray(1));
    if (flag === 0) return null;
    const body = Buffer.concat(this.parts);
    this.parts = [];
    this.size = 0;
    let obj;
    try {
      obj = JSON.parse(body.toString("utf8"));
    } catch {
      throw new AppError("E_FORMAT", "not valid UTF-8 JSON", false, body);
    }
    return { obj, body };
  }
}

export class AppError extends Error {
  constructor(code, message, retryable, body = null) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.body = body;
  }
}

export const KNOWN_KINDS = ["seats", "sessions", "seat_hourly", "sales", "games", "store_daily"];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?([+-]\d{2}:\d{2}|Z)$/;

/** data 메시지 기본 검사. 문제 있으면 AppError(재전송 불필요) */
export function validateData(m, storeId) {
  const bad = (msg) => {
    throw new AppError("E_SCHEMA", msg, false);
  };
  if (typeof m.msgId !== "string" || !m.msgId || m.msgId.length > 100) bad("msgId: 1~100자 문자열");
  if (m.storeId !== storeId) throw new AppError("E_STORE_MISMATCH", "storeId가 인증된 매장과 다름", false);
  if (typeof m.kind !== "string" || !/^[a-z_]{1,32}$/.test(m.kind)) bad("kind: 영문 소문자·_ 1~32자");
  if (typeof m.periodStart !== "string" || !ISO_RE.test(m.periodStart)) bad("periodStart: ISO 8601(시간대 포함)");
  if (typeof m.periodEnd !== "string" || !ISO_RE.test(m.periodEnd)) bad("periodEnd: ISO 8601(시간대 포함)");
  if (Date.parse(m.periodEnd) < Date.parse(m.periodStart)) bad("periodEnd가 periodStart보다 앞");
  if (m.revision !== undefined && !(Number.isInteger(m.revision) && m.revision >= 0)) bad("revision: 0 이상 정수");
  if (m.payload === null || typeof m.payload !== "object") bad("payload: 객체 또는 배열");
}
