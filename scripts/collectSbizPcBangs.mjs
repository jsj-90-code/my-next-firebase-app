// 2km 안 PC방 목록을 **전국 동일 기준으로** 받는다 — 소상공인 상가업소 (2026-09-22 신설)
//
// ── 왜 이게 필요한가 ──────────────────────────────────────────────────────
// 2km 경쟁점을 세려면 "그 자리에 PC방이 실제로 있는가"를 알아야 하는데, 오늘 쓴 자료원이
// **셋 다 같은 방향으로 편향**돼 있었다(`_rival2kmPermit.test.ts` 3절):
//
//   카카오 장소        매장당 40건쯤에서 잘린다        -> 조밀한 도시 매장이 덜 세어진다
//   인허가 시설면적     도시일수록 축소 등록            -> 조밀한 도시 매장이 덜 세어진다
//   인허가 총게임기수   도시일수록 미등록(서울 53% 공백) -> 조밀한 도시 매장이 덜 세어진다
//
// 셋 다 기각했다. 하필 그 방향이 **퍼짐 과장의 원인으로 지목한 바로 그것**이라, 성적이
// 좋아져도 진짜 개선인지 편향인지 구분이 안 되기 때문이다.
//
// 소상공인 상가업소는 **반경 조회를 매장마다 따로** 하므로 건수 상한이 안 걸리고,
// 전국을 한 기관이 같은 기준으로 모으므로 지자체 관행도 안 탄다. 그게 이 자료를 쓰는 이유다.
//
// ⚠️ 시점은 "지금"뿐이다. **평가창 당시 영업 여부는 인허가가 답한다**(폐업일자·인허가일자).
//    둘을 짝지어 쓴다: 상가업소 = 실체가 있는가 · 인허가 = 그때 영업했는가.
// ⚠️ PC 대수는 여기에도 없다. 그건 아직 안 풀린 문제다.
//
// 신청: https://www.data.go.kr/data/15012005/openapi.do 의 [활용신청](자동승인)
//   ⚠️ 인증키는 계정당 하나다 — 인허가 API에 쓰던 PUBLICDATA_SERVICE_KEY가 그대로 통한다.
//
// 실행:
//   node scripts/collectSbizPcBangs.mjs              # 기존점 + 후보지 전부
//   node scripts/collectSbizPcBangs.mjs --limit 3    # 3곳만 시험
//   node scripts/collectSbizPcBangs.mjs --upjong     # 업종코드 목록만 확인하고 끝낸다
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

/** 다른 수집기(collectKakao*·collectPcBangPermits)와 **같은 방식**이다. */
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
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = v;
  }
}
loadEnvLocal();

const KEY = process.env.PUBLICDATA_SERVICE_KEY;
if (!KEY) {
  console.error("PUBLICDATA_SERVICE_KEY가 없다. .env.local에 넣어라.");
  process.exit(1);
}

const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
const NEIGHBOR = ".local-tools/kakao-neighborhood.json";
const OUT = ".local-tools/sbiz-pcbang-2km.json";
/**
 * 상권업종 **소분류** 코드. 소상공인365(bigdata.sbiz.or.kr)에서 쓰는 것과 같은 체계다
 * (`collectSbizFloatingPopulation.mjs`의 PCBANG_UPJONG). --upjong으로 확인할 수 있다.
 */
const PCBANG_SCLS = process.env.SBIZ_PCBANG_CODE ?? "R10406";
const RADIUS_M = 2000;          // API 상한이 2000m다
const PER_PAGE = 1000;
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS ?? 250);

const args = process.argv.slice(2);
const argValue = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(op, params, tries = 3) {
  const q = new URLSearchParams({ ServiceKey: KEY, type: "json", ...params });
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(`${BASE}/${op}?${q}`, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
        throw new Error("이 API에 인증키가 아직 안 열렸다 — data.go.kr 15012005에서 [활용신청]할 것");
      }
      const j = JSON.parse(text);
      if (j?.body == null && j?.response?.body == null) {
        throw new Error(`본문 없음: ${text.slice(0, 200)}`);
      }
      return j.body ?? j.response.body;
    } catch (e) {
      if (t === tries || String(e.message).includes("활용신청")) throw e;
      await sleep(700 * t);
    }
  }
}

/** 업종코드 확인용 — 코드가 바뀌었는지 눈으로 보는 자리다. */
async function showUpjong() {
  const body = await call("smallUpjongList", { pageNo: "1", numOfRows: "1000", indsLclsCd: PCBANG_SCLS.slice(0, 2) });
  const items = body.items ?? [];
  const hit = items.filter((x) => /PC방|피시|피씨/i.test(x.indsSclsNm ?? ""));
  console.log(`대분류 ${PCBANG_SCLS.slice(0, 2)} 소분류 ${items.length}개 중 PC방류:`);
  for (const x of hit) console.log(`  ${x.indsSclsCd}  ${x.indsSclsNm}   (중분류 ${x.indsMclsNm})`);
  if (!hit.length) console.log("  못 찾았다 — SBIZ_PCBANG_CODE로 직접 넣어라.");
}

/** 한 지점의 반경 2km 안 PC방 전부. */
async function listAround(lat, lng) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const body = await call("storeListInRadius", {
      pageNo: String(page), numOfRows: String(PER_PAGE),
      radius: String(RADIUS_M), cx: String(lng), cy: String(lat),
      indsSclsCd: PCBANG_SCLS,
    });
    const items = body.items ?? [];
    for (const x of items) {
      const la = Number(x.lat), ln = Number(x.lon ?? x.lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
      out.push({
        id: x.bizesId, name: x.bizesNm, lat: la, lng: ln,
        scls: x.indsSclsCd, sclsNm: x.indsSclsNm,
        addr: x.rdnmAdr ?? x.lnoAdr ?? "", floor: x.floorNo ?? null,
      });
    }
    const total = Number(body.totalCount ?? 0);
    if (out.length >= total || items.length < PER_PAGE) break;
    await sleep(DELAY_MS);
  }
  return out;
}

const main = async () => {
  if (args.includes("--upjong")) { await showUpjong(); return; }
  if (!existsSync(SNAPSHOT)) {
    console.error(`${SNAPSHOT}이 없다. node scripts/dumpValidationSnapshot.mjs 먼저.`);
    process.exit(1);
  }
  // 좌표는 카카오 수집 때 쓴 것과 **같은 것**을 쓴다 — 자를 둘로 만들지 않는다.
  const sites = [];
  if (existsSync(NEIGHBOR)) {
    const nb = JSON.parse(readFileSync(NEIGHBOR, "utf8"));
    for (const [k, s] of Object.entries(nb.sites)) {
      if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
        sites.push({ key: k, kind: s.kind, code: s.code, name: s.name, lat: s.lat, lng: s.lng });
      }
    }
  }
  if (!sites.length) { console.error(`${NEIGHBOR}에 좌표가 없다.`); process.exit(1); }

  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { sites: {} };
  const result = prev.sites ?? {};
  let done = 0, added = 0;
  for (const s of sites) {
    if (done >= LIMIT) break;
    done++;
    if (result[s.key]) { console.log(`  건너뜀(이미 있음) ${s.name}`); continue; }
    try {
      const list = await listAround(s.lat, s.lng);
      result[s.key] = { kind: s.kind, code: s.code, name: s.name, lat: s.lat, lng: s.lng, stores: list };
      added++;
      console.log(`  ${s.name.padEnd(16)} ${String(list.length).padStart(4)}건`);
    } catch (e) {
      console.error(`  ${s.name}: ${e.message}`);
      if (String(e.message).includes("활용신청")) process.exit(1);
    }
    // 지점마다 저장한다 — 중간에 끊겨도 이어받는다.
    mkdirSync(".local-tools", { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      collectedAt: new Date().toISOString(),
      source: "공공데이터포털 소상공인시장진흥공단_상가(상권)정보_API(15012005) storeListInRadius",
      radiusM: RADIUS_M, upjongSclsCd: PCBANG_SCLS,
      sites: result,
    }, null, 0));
    await sleep(DELAY_MS);
  }
  const totals = Object.values(result).map((x) => x.stores.length);
  console.log(`\n저장 ${OUT}`);
  console.log(`  지점 ${Object.keys(result).length}곳 (이번에 ${added}곳 새로) · PC방 총 ${totals.reduce((a, b) => a + b, 0)}건`);
  console.log(`  지점당 최소 ${Math.min(...totals)} · 최대 ${Math.max(...totals)}건`);
  console.log(`  ⚠️ 이 목록은 "지금 실체가 있는가"만 답한다. 평가창 시점은 인허가가 답한다.`);
};

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
