// 한 장에 두 장면 — A 매장 정면(가시성) · B 사람이 제일 많은 쪽(동선 방해)
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PAGE = pathToFileURL(process.argv[2]).href;
const targets = JSON.parse(readFileSync(process.argv[3], "utf8"));
const outDir = process.argv[4];
mkdirSync(outDir, { recursive: true });
const LOG = `${outDir}/_pairs.json`;
const done = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1620, height: 640 }, deviceScaleFactor: 1 })).newPage();

let n = 0;
for (const t of targets) {
  n++;
  if (done[t.key]) { console.log(`${String(n).padStart(2)}/${targets.length} ${t.name} — 있음`); continue; }
  const label = `${t.name} · ${t.ground ?? ""}${t.floor ?? "?"}층 · 붐비는 쪽 ${t.busiestDir ?? "?"}`;
  const url = `${PAGE}?lat=${t.lat}&lng=${t.lng}&tilt=${t.tilt}&busy=${t.busiestDeg ?? 0}&label=${encodeURIComponent(label)}`;
  await page.goto(url);
  let s = "init";
  for (let i = 0; i < 56; i++) { s = await page.evaluate(() => window.RV_STATE); if (s === "ready" || s === "none") break; await page.waitForTimeout(250); }
  if (s !== "ready") { done[t.key] = { name: t.name, ok: false }; console.log(`${String(n).padStart(2)}/${targets.length} ${t.name}\t로드뷰없음`); }
  else {
    const file = `${outDir}/${t.key}.png`;
    await page.locator("#wrap").screenshot({ path: file });
    done[t.key] = { name: t.name, ok: true, file, info: await page.evaluate(() => window.RV_INFO) };
    console.log(`${String(n).padStart(2)}/${targets.length} ${t.name}\tOK`);
  }
  writeFileSync(LOG, JSON.stringify(done, null, 1), "utf8");
}
await browser.close();
console.log(`\n완료. 못 찍은 곳 ${Object.values(done).filter((d) => !d.ok).length}곳.`);
