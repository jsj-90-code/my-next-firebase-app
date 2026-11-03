// 사내 저장소 매일 백업(2026-11-03) — backups/store-YYYY-MM-DD.db, 14일치만 남긴다. crontab 매일 03:30.
import { readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const home = process.env.HOME;
const dir = `${home}/ping-store/backups`;
mkdirSync(dir, { recursive: true });
const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const target = `${dir}/store-${day}.db`;
if (!existsSync(target)) new DatabaseSync(`${home}/ping-store/store.db`).exec(`VACUUM INTO '${target}'`);
const daily = readdirSync(dir).filter((f) => /^store-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
for (const f of daily.slice(0, Math.max(0, daily.length - 14))) unlinkSync(`${dir}/${f}`);
console.log(`${new Date().toISOString()} 백업 ${target} · 보관 ${Math.min(daily.length, 14)}개`);
