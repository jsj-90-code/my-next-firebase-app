// 항아리상권 판정용 지도 캡처 — 54곳(기존점 41·후보지 13) 매장 중심 반경 2km 지도 한 장씩. (2026-09-23)
//
//   node scripts/tradeArea/shotMaps.mjs <playwright-core가 깔린 폴더> [--only=existing|candidate] [--level=7]
//
// 좌표는 .local-tools/sgis-resident-population.json(sites[*].lat/lng)에서 뽑는다 — 고리 인구를 잰 좌표와 같아야
// 지도의 원과 산식의 고리가 같은 자리다. 카카오 JS 키는 .env.local의 NEXT_PUBLIC_KAKAO_MAP_JS_KEY를 스크립트가
// 읽어 임시 HTML에 넣는다(값은 로그에 찍지 않는다).
// 출력: .local-tools/trade-area-maps/<kind>-<code>.png · _shots.json(성공/실패 로그). 이미 있으면 건너뛴다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const PW_DIR = process.argv[2];
if (!PW_DIR) { console.error("playwright-core가 깔린 폴더를 첫 인자로 준다."); process.exit(1); }
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7) : null;
const levelArg = process.argv.find((a) => a.startsWith("--level="));
const LEVEL = levelArg ? Number(levelArg.slice(8)) : 7;
const OUT = ".local-tools/trade-area-maps";
const LOG = `${OUT}/_shots.json`;
mkdirSync(OUT, { recursive: true });

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();
const APPKEY = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
if (!APPKEY) { console.error("NEXT_PUBLIC_KAKAO_MAP_JS_KEY가 없다."); process.exit(1); }

const { chromium } = createRequire(resolve(PW_DIR, "package.json"))("playwright-core");
const sgis = JSON.parse(readFileSync(".local-tools/sgis-resident-population.json", "utf8"));
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice(8)) : Infinity;
const sites = Object.values(sgis.sites ?? {}).filter((s) => s.lat && s.lng && (s.kind === "existing" || s.kind === "candidate") && (!only || s.kind === only)).slice(0, LIMIT);

// 키를 넣은 임시 페이지 — 저장소 밖(OUT 폴더는 gitignore 대상)에 둔다
// ⚠️ replaceAll — 템플릿 주석에도 "APPKEY"가 있어 replace(첫 번째만)로는 스크립트 주소가 안 바뀐다(2026-09-23에 그걸로 40장이 빈 화면).
const tpl = readFileSync(new URL("./map.template.html", import.meta.url), "utf8").replaceAll("APPKEY", APPKEY);
const pagePath = resolve(OUT, "_map.html");
writeFileSync(pagePath, tpl, "utf8");
// ⚠️ file:// 로 열면 카카오 SDK가 안 내려온다(ERR_BLOCKED_BY_ORB — 키에 등록된 도메인이 아니라 HTML 오류 응답이 옴).
//    개발 도메인 http://localhost:3000 은 등록돼 있으므로 그 주소로 페이지를 띄운다(작은 정적 서버).
//    next dev가 3000을 쓰고 있으면 --port= 로 다른 등록 도메인 포트를 준다.
const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.slice(7)) : 3000;
const { createServer } = await import("node:http");
const server = createServer((req, res) => {
  if (req.url?.startsWith("/_map.html")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(tpl); return; }
  res.writeHead(404); res.end();
});
await new Promise((ok, fail) => { server.once("error", fail); server.listen(PORT, "127.0.0.1", ok); });
const PAGE = `http://localhost:${PORT}/_map.html`;
void pathToFileURL;

const done = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : {};
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 })).newPage();

let n = 0;
for (const s of sites) {
  n++;
  const key = `${s.kind}-${s.code}`;
  const file = `${OUT}/${key}.png`;
  // 같은 확대 단계로 이미 **성공적으로** 찍었으면 건너뛴다. 실패했거나 단계가 다르면 덮어쓴다(파일 삭제 없이).
  if (done[key]?.ok && done[key].level === LEVEL && existsSync(file)) { console.log(`${String(n).padStart(2)}/${sites.length} ${s.name} — 있음`); continue; }
  if (n === 1) console.log(`페이지 ${PAGE} · 확대 ${LEVEL}`);
  const label = `${s.name} · 안쪽 원 1km · 바깥 원 2km · 확대 ${LEVEL}`;
  await page.goto(`${PAGE}?lat=${s.lat}&lng=${s.lng}&level=${LEVEL}&label=${encodeURIComponent(label)}`);
  let st = "init";
  for (let i = 0; i < 60; i++) { st = await page.evaluate(() => window.MAP_STATE); if (st === "ready") break; await page.waitForTimeout(250); }
  await page.screenshot({ path: file });
  done[key] = { ok: st === "ready", kind: s.kind, code: String(s.code), name: s.name, lat: s.lat, lng: s.lng, level: LEVEL, file };
  writeFileSync(LOG, JSON.stringify(done, null, 2), "utf8");
  console.log(`${String(n).padStart(2)}/${sites.length} ${s.name}\t${st === "ready" ? "ok" : "타일 대기 시간 초과(찍긴 함)"}`);
}
await browser.close();
server.close();
console.log(`\n${Object.values(done).filter((d) => d.ok).length}/${sites.length} 캡처 -> ${OUT}`);
