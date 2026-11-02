// 게토 연동 자료 받는 프로그램 (측정 서버 192.168.0.17에서 돈다)
//
// 게토 안(2026-08-24 「게토–아이센스 연동 통신 구조 제안」): TCP, 아이센스=서버, 게토 카운터=클라이언트,
// 연결을 유지하며 마감 후·정산 때 JSON을 보낸다. 세부 규격은 아직 없음.
//
// 그래서 지금은 "오는 그대로 기록"만 한다 — 답을 보내지 않고, 해석도 하지 않는다.
// 규격이 오면 수신확인(ACK)·항목별 저장을 여기에 덧붙인다.
//
// 기록 위치 (GETTO_INBOX_DIR, 기본 ~/getto-inbox):
//   events/YYYY-MM-DD.jsonl      접속·끊김·받은 크기·앞부분 미리보기
//   raw/YYYY-MM-DD/<연결ID>.bin  받은 바이트 원본 그대로
//
// 실행: node receiver.mjs   (포트 GETTO_INBOX_PORT, 기본 19000)
// 이미 떠 있으면 포트가 겹쳐 조용히 끝난다 — start.sh가 5분마다 불러도 하나만 돈다.

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.GETTO_INBOX_PORT || 19000);
const DIR = process.env.GETTO_INBOX_DIR || path.join(os.homedir(), "getto-inbox");
const MAX_CONNECTIONS = 1000; // 매장 수보다 넉넉히
const MAX_BYTES_PER_CONN_PER_DAY = 200 * 1024 * 1024; // 한 연결이 하루에 이보다 많이 보내면 끊는다
const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 디스크 여유가 2GB 밑이면 저장 멈춤
const PREVIEW_CHARS = 300;

fs.mkdirSync(path.join(DIR, "events"), { recursive: true });
fs.mkdirSync(path.join(DIR, "raw"), { recursive: true });

// 서버 시간대가 서울이라 로컬 날짜를 쓴다
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 23);
  return `${local}${sign}${p(off / 60)}:${p(off % 60)}`;
}

function logEvent(ev) {
  const line = JSON.stringify({ t: nowIso(), ...ev }) + "\n";
  try {
    fs.appendFileSync(path.join(DIR, "events", `${today()}.jsonl`), line);
  } catch (e) {
    console.error("event log failed:", e.message);
  }
}

function diskHasRoom() {
  try {
    const s = fs.statfsSync(DIR);
    return s.bavail * s.bsize > MIN_FREE_BYTES;
  } catch {
    return true;
  }
}

let seq = 0;
let open = 0;

const server = net.createServer((socket) => {
  const id = `${Date.now()}-${++seq}`;
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  open++;

  if (open > MAX_CONNECTIONS) {
    logEvent({ ev: "reject_too_many", id, remote, open });
    open--;
    socket.destroy();
    return;
  }

  socket.setKeepAlive(true, 60_000); // 게토는 연결을 계속 유지하므로 끊긴 연결만 걸러낸다
  logEvent({ ev: "connect", id, remote, open });

  let total = 0;
  let dayBytes = 0;
  let day = today();
  let chunks = 0;

  socket.on("data", (buf) => {
    const d = today();
    if (d !== day) {
      day = d;
      dayBytes = 0;
    }
    total += buf.length;
    dayBytes += buf.length;
    chunks++;

    if (dayBytes > MAX_BYTES_PER_CONN_PER_DAY) {
      logEvent({ ev: "drop_too_big", id, remote, dayBytes });
      socket.destroy();
      return;
    }

    if (diskHasRoom()) {
      const rawDir = path.join(DIR, "raw", day);
      try {
        fs.mkdirSync(rawDir, { recursive: true });
        fs.appendFileSync(path.join(rawDir, `${id}.bin`), buf);
      } catch (e) {
        logEvent({ ev: "write_failed", id, err: e.message });
      }
    } else {
      logEvent({ ev: "disk_full_skip", id, bytes: buf.length });
    }

    logEvent({
      ev: "data",
      id,
      remote,
      bytes: buf.length,
      preview: buf.toString("utf8", 0, Math.min(buf.length, PREVIEW_CHARS * 4)).slice(0, PREVIEW_CHARS),
    });
  });

  socket.on("error", (e) => logEvent({ ev: "error", id, remote, err: e.code || e.message }));

  socket.on("close", () => {
    open--;
    logEvent({ ev: "close", id, remote, totalBytes: total, chunks, open });
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    // 이미 다른 하나가 받고 있다 — 정상
    process.exit(0);
  }
  console.error("server error:", e);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  logEvent({ ev: "start", port: PORT, pid: process.pid });
  console.log(`getto inbox listening on ${PORT}, writing to ${DIR}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    logEvent({ ev: "stop", sig });
    process.exit(0);
  });
}
