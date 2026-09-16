// 캡처해둔 pair PNG를 두 장씩 세로로 붙인다. 판독 때 읽을 이미지 수를 절반으로 줄인다.
// 가로 1600 유지 — 세로로만 늘려야 화질이 안 깎인다(긴 변이 1600을 넘지 않게).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";

const inDir = process.argv[2], outDir = process.argv[3];
mkdirSync(outDir, { recursive: true });
const log = JSON.parse(readFileSync(`${inDir}/_pairs.json`, "utf8"));
const keys = Object.entries(log).filter(([, v]) => v.ok).map(([k]) => k);

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await (await browser.newContext()).newPage();
const b64 = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");

const groups = [];
for (let i = 0; i < keys.length; i += 2) groups.push(keys.slice(i, i + 2));

let n = 0;
for (const g of groups) {
  n++;
  const imgs = g.map((k) => b64(`${inDir}/${k}.png`));
  const out = await page.evaluate(async (srcs) => {
    const loaded = await Promise.all(srcs.map((s) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = s; })));
    const w = Math.max(...loaded.map((i) => i.width));
    const h = loaded.reduce((a, i) => a + i.height, 0) + (loaded.length - 1) * 6;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = "#444"; x.fillRect(0, 0, w, h);
    let y = 0;
    for (const im of loaded) { x.drawImage(im, 0, y); y += im.height + 6; }
    return c.toDataURL("image/png");
  }, imgs);
  const file = `${outDir}/g${String(n).padStart(2, "0")}.png`;
  writeFileSync(file, Buffer.from(out.split(",")[1], "base64"));
  console.log(`${file}\t${g.map((k) => log[k].name).join(" + ")}`);
}
await browser.close();
