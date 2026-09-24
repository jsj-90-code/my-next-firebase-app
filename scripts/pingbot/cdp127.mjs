// CDP 최소 드라이버(127.0.0.1:9222). 사람이 로그인해 둔 크롬(--remote-debugging-port=9222)에 붙는다.
import WebSocket from "ws";
const BASE = process.env.CDP_BASE ?? "http://127.0.0.1:9222";

export async function pickTarget(match) {
  const list = await (await fetch(`${BASE}/json/list`)).json();
  const pages = list.filter((t) => t.type === "page" && !t.url.startsWith("chrome"));
  return pages.find((t) => match == null || t.url.includes(match)) ?? pages[0];
}
export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pending = new Map(); const events = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id != null && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
    else if (msg.method) events.push(msg);
  });
  const ready = new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const myId = ++id; pending.set(myId, { resolve, reject }); ws.send(JSON.stringify({ id: myId, method, params })); });
  return { ws, ready, send, events, close: () => ws.close() };
}
export async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.text ?? "") + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}
