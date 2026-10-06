import "server-only";
import { connect } from "node:net";

// 경쟁점 가동률 측정기 — PC가 켜져 있는지 TCP 연결 시도로 가린다(2026-10-06 신설).
//
// Vercel 함수는 핑(ICMP)을 못 보낸다. 대신 문(포트)을 한 번 두드린다:
//   켜진 PC → "안 돼"(연결 거절, ECONNREFUSED)를 바로 돌려준다 = 켜짐
//   꺼진 PC → 아무 대답이 없다(시간 초과)              = 꺼짐
// 2026-10-06 118.128.168.1~110에서 핑 결과와 110개 전부 일치(5대)했다. 문을 열 시도는 하지 않는다 —
// 포트 두 개만 한 번 두드리고 바로 끊는다(포트 스캔 아님).
// ⚠️ PC가 이것까지 막아 둔 매장(115.89.100.x 등)은 늘 0으로 나온다 → 화면에서 "측정 불가 의심"으로 따로 표시.

const PORTS = [80, 3389];
// Windows는 거절을 받고도 몇 번 다시 시도해 거절이 ~2.1초 뒤에 온다(2026-10-06 실측, 2초로 두니 0대로 나옴).
// 서버(Linux)는 거절을 바로 받는다. 꺼진 PC는 이만큼 기다린 뒤 꺼짐으로 친다 — 경쟁점 100여 곳·IP 1만 3천 개를
// 함수 한도(300초) 안에 재려면 서버에선 짧게 둔다.
const TIMEOUT_MS = process.platform === "win32" ? 4000 : 2000;
/** 동시에 확인하는 IP 수(포트가 둘이라 소켓은 두 배). 함수의 파일 핸들 한도(약 1024) 아래로 둔다. */
const CONCURRENCY = 400;

function knock(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port });
    let done = false;
    const finish = (alive: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ECONNREFUSED" || error.code === "ECONNRESET"),
    );
  });
}

async function isAlive(ip: string): Promise<boolean> {
  const results = await Promise.all(PORTS.map((port) => knock(ip, port)));
  return results.some(Boolean);
}

/** IP 목록을 확인해 켜진 IP 집합을 돌려준다. */
export async function probeIps(ips: string[]): Promise<Set<string>> {
  const alive = new Set<string>();
  let next = 0;
  async function worker() {
    while (next < ips.length) {
      const ip = ips[next++];
      if (await isAlive(ip)) alive.add(ip);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ips.length) }, worker));
  return alive;
}
