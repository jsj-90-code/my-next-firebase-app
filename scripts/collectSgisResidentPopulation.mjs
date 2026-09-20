// SGIS 생활권역 통계지도에서 **반경별 주거인구·가구·주택**을 모은다.
//
// 왜: 지금 `pop500m`/`pop1km`/`age1km_*`는 사람이 SGIS 화면에서 조회해 손으로 넣은 값이다
// (src/lib/sgis.ts 주석 참고). 52곳을 각각 다른 날 조회했다면 **기준연도가 뒤섞여** 있을 수 있고,
// 그러면 매장끼리 비교가 미세하게 왜곡된다. 전부 한 번에, 같은 연도·같은 좌표·같은 방법으로
// 다시 받으면 그 문제가 사라진다. 덤으로 100~400m 반경도 생긴다.
//
// ⚠️ 이 스크립트는 **운영 Firestore에 쓰지 않는다.** 로컬 파일로만 남긴다.
// 기존 손입력값과 나란히 놓고 차이를 먼저 확인한 뒤에 투입 여부를 정하기 위해서다.
//
// 사용법:
//   node scripts/collectSgisResidentPopulation.mjs --selftest   # 좌표변환만 검산
//   node scripts/collectSgisResidentPopulation.mjs --limit 3    # 3곳만 시험
//   node scripts/collectSgisResidentPopulation.mjs              # 전체
//   SGIS_BASE_YEAR=2023 node scripts/collectSgisResidentPopulation.mjs   # 기준연도 바꾸기
//
// 산출물: .local-tools/sgis-resident-population.json
//
// 경로 전문은 docs/textbook-model-handoff-2026-09-15.md 10절에 있다. 요약:
//   GET  sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json -> accessToken (우리 키로 된다)
//   POST sgis.mods.go.kr/ServiceAPI/OpenAPI3/catchmentArea/serviceAreaStatistics.json
//        area="POINT(x y)"(EPSG:5179) · radius · srvAreaType=2
//
// ⚠️ 좌표를 경위도로 넣으면 **에러가 아니라 빈 결과**가 온다. 반드시 5179로 변환한다(tm.mjs).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { selfTest, to5179 } from "./lib/tm.mjs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const GEOCODED = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/sgis-resident-population.json";
// 2026-09-19 추가: 1500·2000m.
// 사용자 관찰 — 양주덕정점은 300m 뭉치에 있는 PC방이 반경 2km의 전부이고(학교정화구역 때문에
// 다른 상권엔 입점 불가), 그 2km가 초중고까지 있는 형성된 상권이다. 문경시청점도 점촌고·
// 문경여중·점촌중에서 보면 우리 매장과 클라우드PC방(1.5km)까지의 거리가 비슷하다.
// -> 두 곳 다 "유효 상권이 1km보다 넓다"가 유일하게 말이 되는 설명이라, 1km 밖 인구를 봐야 한다.
// 이미 받아 둔 반경은 아래 루프에서 건너뛰므로 새 반경만 추가로 부른다.
//
// 2026-09-20 밤 추가: 5000m.
// 남은 가설 — 문경시청점(필요 점유율 191%)·양주덕정점(121%)은 *"지방 소도시는 상권이
// 시 전체"*라서 수요를 작게 세는 것 아닌가. 2km까지는 **반대 방향**으로 나왔다
// (문경 2km÷1km 1.63배로 41곳 중 39위 — 오히려 안 퍼진다). 5km에서 뒤집히는지 본다.
// ⚠️ 반경이 커지면 SGIS가 면적을 잘라 줄 수 있다 — 아래 `areaOff`(원 면적 대비 오차)를
//    반드시 확인할 것. 크게 어긋나면 그 값은 "반경 5km"가 아니다.
const RADII = [100, 200, 300, 400, 500, 1000, 1500, 2000, 5000];
const BASE_YEAR = process.env.SGIS_BASE_YEAR || "2024";
const DELAY_MS = Number(process.env.SGIS_DELAY_MS || 700);

const AUTH = "https://sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json";
const STATS = "https://sgis.mods.go.kr/ServiceAPI/OpenAPI3/catchmentArea/serviceAreaStatistics.json";

const args = process.argv.slice(2);
const argValue = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1];
};
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : null;

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();

if (args.includes("--selftest")) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
  console.error("좌표변환 검산 실패 — 수집을 시작하지 않는다.");
  process.exit(1);
}

const serviceId = process.env.SGIS_SERVICE_ID;
const securityKey = process.env.SGIS_SECURITY_KEY;
if (!serviceId || !securityKey) {
  console.error("SGIS_SERVICE_ID / SGIS_SECURITY_KEY가 .env.local에 필요하다.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  const url = `${AUTH}?consumer_key=${encodeURIComponent(serviceId)}&consumer_secret=${encodeURIComponent(securityKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await res.json();
  // SGIS는 실패해도 HTTP 200을 준다 — errCd로만 성공을 안다(sgis.ts가 겪은 함정).
  if (String(body.errCd) !== "0" || !body?.result?.accessToken) {
    throw new Error(`인증 실패 errCd=${body.errCd} ${body.errMsg ?? ""}`);
  }
  return body.result.accessToken;
}

async function fetchRadius(token, tm, radius) {
  const params = new URLSearchParams({
    accessToken: token,
    area: `POINT(${tm.x} ${tm.y})`,
    radius: String(radius),
    srvAreaType: "2", // 1=임의 폴리곤, 2=반경
    workGb: "all",
    classDeg: "1",
    base_year: BASE_YEAR,
    copr_base_year: BASE_YEAR,
  });
  const res = await fetch(STATS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (String(body.errCd) !== "0") throw new Error(`errCd=${body.errCd} ${body.errMsg ?? ""}`);
  const r = body.result ?? {};
  const pops = r.pops?.[0] ?? null;
  const areaSize = Number(r.areaSize?.[0]?.area_size ?? 0);
  // 면적이 원 면적과 크게 다르면 반경이 제대로 안 먹은 것이다 — 조용히 지나가지 않게 표시한다.
  const expected = Math.PI * radius * radius;
  const areaOff = areaSize > 0 ? Math.abs(areaSize - expected) / expected : null;
  return {
    pops,
    family: r.family?.[0] ?? null,
    house: r.house?.[0] ?? null,
    corp: r.copr?.[0] ?? null,
    areaSize,
    areaOff,
    totalPopulation: pops?.tot_ppltn_cnt ?? null,
  };
}

/* 대상: 운영 스냅샷 lat/lng, 없으면 주소변환 파일 */
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const geo = existsSync(GEOCODED) ? JSON.parse(readFileSync(GEOCODED, "utf8")).sites ?? {} : {};
const targets = [];
const noCoord = [];
const add = (kind, code, name, lat, lng, handEntered) => {
  const g = geo[`${kind}:${code}`];
  const finalLat = lat ?? g?.lat ?? null;
  const finalLng = lng ?? g?.lng ?? null;
  if (finalLat && finalLng) targets.push({ kind, code, name, lat: finalLat, lng: finalLng, handEntered });
  else noCoord.push(`${code} ${name}`);
};
for (const c of snap.candidates ?? [])
  add("candidate", c.code ?? c.id, c.name ?? "", c.lat, c.lng, { pop500m: c.pop500m ?? null, pop1km: c.pop1km ?? null });
for (const e of snap.existingStores ?? [])
  add("existing", e.storeCode ?? e.id, e.storeName ?? "", e.lat, e.lng, { pop500m: e.pop500m ?? null, pop1km: e.pop1km ?? null });

const list = LIMIT ? targets.slice(0, LIMIT) : targets;
console.log(`\n대상 ${list.length}곳 (좌표 없음 ${noCoord.length}곳) · 반경 ${RADII.join("/")}m · 기준연도 ${BASE_YEAR}`);

const token = await getToken();
console.log("SGIS 인증 성공\n");

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { collectedAt: null, baseYear: BASE_YEAR, sites: {} };
let done = 0;
let skipped = 0;
let failed = 0;
const diffs = [];

for (const t of list) {
  const key = `${t.kind}:${t.code}`;
  if (out.sites[key] && RADII.every((r) => out.sites[key].radii?.[r]?.totalPopulation != null)) {
    skipped++;
    continue;
  }
  const tm = to5179(t.lng, t.lat);
  const record = out.sites[key] ?? { ...t, tm, radii: {} };
  try {
    for (const radius of RADII) {
      if (record.radii[radius]?.totalPopulation != null) continue;
      record.radii[radius] = await fetchRadius(token, tm, radius);
      await sleep(DELAY_MS);
    }
    out.sites[key] = record;
    out.collectedAt = new Date().toISOString();
    out.baseYear = BASE_YEAR;
    writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
    done++;

    // 손입력값과 얼마나 다른지 바로 보여준다 — 이게 이번 수집의 핵심 확인 사항이다.
    const got500 = record.radii[500]?.totalPopulation;
    const got1k = record.radii[1000]?.totalPopulation;
    const d = (got, hand) => (got != null && hand ? (((got - hand) / hand) * 100).toFixed(1) + "%" : "-");
    const d500 = d(got500, t.handEntered.pop500m);
    const d1k = d(got1k, t.handEntered.pop1km);
    if (d500 !== "-") diffs.push(Math.abs(Number(d500.replace("%", ""))));
    if (d1k !== "-") diffs.push(Math.abs(Number(d1k.replace("%", ""))));
    console.log(
      `  ${t.name} — 100m ${record.radii[100]?.totalPopulation ?? "?"} / 500m ${got500 ?? "?"} (손입력 대비 ${d500}) / 1km ${got1k ?? "?"} (${d1k})`,
    );
  } catch (err) {
    failed++;
    console.error(`  ✖ ${t.name}: ${err.message}`);
  }
}

console.log(`\n완료 ${done}곳 · 건너뜀 ${skipped}곳 · 실패 ${failed}곳 -> ${OUT}`);
if (diffs.length) {
  diffs.sort((a, b) => a - b);
  const mid = diffs[Math.floor(diffs.length / 2)];
  const worst = diffs.at(-1);
  console.log(`손입력값과의 차이: 중앙 ${mid.toFixed(1)}% · 최대 ${worst.toFixed(1)}%`);
  console.log("차이가 큰 곳은 지도에서 찍은 점이 저장 좌표와 다른 경우다 — 좌표부터 의심한다.");
}
