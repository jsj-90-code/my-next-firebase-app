// 내보낸 파일(NDJSON)을 사내 저장소에 통째로 들여온다 — 있던 내용은 지운다(2026-11-03).
// 실행(사내 서버): ~/node/bin/node ~/ping-store/import.mjs ~/ping-store/export.ndjson
// 들여오기 전에 지금 파일을 backups/에 복사해 둔다.
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { makeStore, openDb } from "./server.mjs";

const file = process.argv[2];
if (!file) throw new Error("파일 경로를 주세요");
const docs = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const dbPath = process.env.PING_STORE_DB ?? `${process.env.HOME}/ping-store/store.db`;
const db = openDb(dbPath);
if (existsSync(dbPath)) {
  mkdirSync(`${process.env.HOME}/ping-store/backups`, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  db.exec(`VACUUM INTO '${process.env.HOME}/ping-store/backups/before-import-${stamp}.db'`);
}
makeStore(db).replaceAll(docs);
const counts = db.prepare("SELECT c, count(*) n FROM docs GROUP BY c").all();
console.log(JSON.stringify(counts));
