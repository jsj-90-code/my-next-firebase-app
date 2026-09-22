// 2km 경쟁점 자료를 만든다 — 카카오(실체) + 인허가(시점) (2026-09-22 밤 채택)
//
// ── 무엇을 만드나 ─────────────────────────────────────────────────────────
// 지점마다 "500m 밖 ~ 2km 안에 실제로 있는 PC방" 목록을 만들고, 각 가게에 인허가 날짜를
// 붙인다. **영업 비중은 여기서 계산하지 않는다** — 매장마다 평가창이 다르고 그건 런타임에
// 정해지기 때문이다(`src/lib/storeEval/rival2km.ts`가 계산한다).
//
// ── 왜 이 조합인가 (2026-09-22에 확정) ────────────────────────────────────
//   실체 = **카카오 장소**.  사용자 확인으로 순위가 정해졌다: 카카오 > 상가업소 > 인허가.
//          상가업소와 인허가는 **폐업을 못 따라온다** — 구리돌다리 500m의 폐업 추정 7곳이
//          그 둘엔 "영업"으로 남아 있는데 카카오엔 하나도 없다. 사용자가 꼽은 4곳은
//          카카오에 전부 있다. 사람이 조사한 500m 실재 273건 중 카카오가 270건(99%)을 맞힌다.
//   시점 = **인허가** 인허가일자·폐업일자. 지도는 "지금"만 알고 산식은 평가창 당시가 필요하다.
//          탕정역 796m에서 PLAY PC방(2020~)과 같은 자리 바닐라PC방(2020-09 폐업)이 자동으로 갈렸다.
//   대수 = 여기서 안 정한다. 운영과 같은 미조사 기본대수를 산식이 쓴다(아직 안 풀린 자리).
//
// ⚠️ **인허가로 목록을 만들지 않는다.** 같은 건물에 PC방 등록이 대여섯 개씩 겹쳐 있어서,
//    인허가를 기준으로 돌리면 그 안의 진짜 가게 하나가 죽은 등록을 전부 살려 준다
//    (안산선부 500m에서 34건 vs 실제 12건). 인허가는 **날짜만 달아 준다.**
//
// ⚠️ 성인PC방·오락실은 **상호로** 거른다(`pcBangArcadePattern`). 인허가 짝으로 거르면
//    레드포스처럼 **최근 개점한 진짜 PC방까지 빠진다**(인허가에 아직 없다).
//
// 준비: node scripts/collectKakaoPcBangsGrid.mjs
//       node scripts/collectPcBangPermits.mjs
// 실행: node scripts/buildRival2kmSnapshot.mjs
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const KAKAO = ".local-tools/kakao-pcbangs-grid.json";
const PERMITS = ".local-tools/pcbang-permits.json";
/** 화면(실험실 페이지)이 읽어야 해서 저장소 안에 둔다. 매출 자료가 아니라 공개 장소 정보다. */
const OUT = "src/lib/storeEval/data/rival2km.json";

/** 공식 경쟁점 DB가 이미 세는 구간 — 두 번 세지 않는다. */
const OFFICIAL_RADIUS_M = 500;
/** 자기 자신(같은 건물의 우리 매장). */
const SELF_M = 50;
/** 상가업소 항목에 인허가를 붙이는 자. 같은 건물 안이면 이 정도다. */
const JOIN_M = 60;
const JOIN_SIM = 0.6;
/**
 * 성인PC방·오락실 상호 규칙. 카카오 500m 밖 고유 상호 728개 중 26개(3.6%)가 걸린다.
 * ⚠️ 이름 규칙이라 **새 업태가 생기면 갱신**해야 한다. `pcBangNameFilter`와 뜻이 같아야 한다.
 */
const ARCADE = /게임랜드|게임장|오락|성인|스크린|멀티방|다트|보드게임|만화|플스|VR|사격|당구|노래/i;

function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const norm = (t) => String(t ?? "").replace(/\(.*?\)/g, "").replace(/피씨|피시/gi, "PC")
  .replace(/[^0-9A-Za-z가-힣]/g, "").toUpperCase();
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const n = Math.min(x.length, y.length);
  let c = 0;
  for (let i = 0; i < n; i++) if (x[i] === y[i]) c++;
  return c / Math.max(x.length, y.length);
}
const ymd = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

for (const f of [KAKAO, PERMITS]) {
  if (!existsSync(f)) {
    console.error(`${f}가 없다. 수집기를 먼저 돌려라(파일 머리 주석).`);
    process.exit(1);
  }
}
const kakao = JSON.parse(readFileSync(KAKAO, "utf8"));
const permits = JSON.parse(readFileSync(PERMITS, "utf8")).rows;

const sites = {};
let total = 0, joined = 0, arcade = 0;
for (const [key, site] of Object.entries(kakao.sites)) {
  const list = [];
  for (const d of site.pcRooms?.docs ?? []) {
    if (d.distanceM <= OFFICIAL_RADIUS_M || d.distanceM <= SELF_M) continue;
    if (ARCADE.test(d.name ?? "")) { arcade++; continue; }
    total++;
    const cand = permits
      .map((p) => ({ p, dd: distanceM(d.lat, d.lng, p.lat, p.lng) }))
      .filter((x) => x.dd <= JOIN_M);
    const best = cand
      .map((x) => ({ ...x, sc: similarity(d.name, x.p.name) }))
      .sort((a, b) => b.sc - a.sc || a.dd - b.dd)[0];
    const permit = best && (best.sc >= JOIN_SIM || cand.length === 1) ? best.p : null;
    if (permit) joined++;
    list.push({
      name: d.name ?? null, lat: d.lat, lng: d.lng, distanceM: d.distanceM,
      // 인허가에서 온 날짜. 짝을 못 찾으면 전부 null — 그때는 **세는 쪽**으로 둔다.
      permitName: permit?.name ?? null,
      open: ymd(permit?.open), close: ymd(permit?.close),
      restFrom: ymd(permit?.restFrom), restTo: ymd(permit?.restTo),
    });
  }
  sites[key] = { code: site.code ?? null, name: site.name ?? null, rivals: list };
}

mkdirSync("src/lib/storeEval/data", { recursive: true });
writeFileSync(OUT, JSON.stringify({
  builtAt: new Date().toISOString(),
  source: {
    실체: `카카오 장소 격자수집(${kakao.collectedAt?.slice(0, 10) ?? "?"}) − 오락실류 상호`,
    시점: "공공데이터 인터넷컴퓨터게임시설제공업 인허가일자·폐업일자",
  },
  officialRadiusM: OFFICIAL_RADIUS_M, outerRadiusM: kakao.radiusM ?? 2000,
  sites,
}, null, 0) + "\n");

console.log(`저장 ${OUT}`);
console.log(`  지점 ${Object.keys(sites).length}곳 · ${OFFICIAL_RADIUS_M}m 밖 경쟁점 ${total}건`);
console.log(`  인허가 짝 ${joined}건(${(joined / total * 100).toFixed(0)}%) — 나머지는 시점을 몰라 세는 쪽에 둔다`);
console.log(`  오락실류로 거른 것 ${arcade}건`);
console.log(`  ⚠️ 영업 비중은 여기서 안 정한다 — 매장마다 평가창이 달라 런타임(rival2km.ts)에서 잰다.`);
