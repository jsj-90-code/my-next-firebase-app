// `.local-tools/geocoded-sites.json`에 빠진 지점을 **운영DB 좌표로** 채운다 — 2026-09-18.
//
//   node scripts/topUpGeocodedSites.mjs           # 미리보기
//   node scripts/topUpGeocodedSites.mjs --apply
//
// ── 왜 지오코딩을 다시 안 하나 ────────────────────────────────────────────
// 이 파일은 주소를 좌표로 바꿔 만든 것인데, 후보지·기존점 좌표는 이미 운영DB에 있고
// **사람이 지도에서 마커를 끌어 확정한 값**이다(후보지 화면: "확정한 좌표가 모든 반경분석의
// 기준점이 됩니다"). 주소변환보다 그쪽이 정확하다. 그러니 새로 변환하지 말고 옮겨 담는다.
//
// 2026-09-18에 N015 구리돌다리점·N016 오송점이 이 파일에 없어서 편심도(flowEccentricity)가
// 비어 있었다. 등록 뒤 지오코딩을 안 돌린 것이다. 앞으로도 후보지를 새로 넣으면 같은 일이
// 생기므로, 스냅샷에 좌표가 있는데 여기 없는 지점을 **전부** 채우는 방식으로 만든다.
//
// ⚠️ 이미 있는 지점은 건드리지 않는다. 좌표 출처가 섞이면 나중에 되짚을 수 없다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const SITES = ".local-tools/geocoded-sites.json";

if (!existsSync(SNAPSHOT)) {
  console.error(`${SNAPSHOT}이 없다. node scripts/dumpValidationSnapshot.mjs 를 먼저 돌린다.`);
  process.exit(1);
}
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const file = existsSync(SITES) ? JSON.parse(readFileSync(SITES, "utf8")) : { sites: {} };
if (!file.sites) file.sites = {};

const num = (v) => (v == null ? null : Number(v));
const want = [];
const add = (kind, code, name, address, lat, lng) => {
  if (!code) return;
  const key = `${kind}:${code}`;
  if (file.sites[key]) return;              // 이미 있으면 손대지 않는다
  const la = num(lat), ln = num(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
  want.push({ key, kind, code, name: name ?? "", address: address ?? "", lat: la, lng: ln });
};

for (const c of snap.candidates ?? []) add("candidate", c.code ?? c.id, c.name, c.address, c.lat, c.lng);
for (const e of snap.existingStores ?? []) add("existing", e.storeCode ?? e.id, e.storeName, e.address, e.lat, e.lng);

console.log(`지금 ${Object.keys(file.sites).length}곳 · 채울 것 ${want.length}곳`);
for (const w of want) console.log(`  + ${w.key}  ${w.name}  (${w.lat.toFixed(6)}, ${w.lng.toFixed(6)})`);

if (!want.length) { console.log("채울 게 없다."); process.exit(0); }
if (!process.argv.includes("--apply")) {
  console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다.");
  process.exit(0);
}

for (const w of want) {
  file.sites[w.key] = {
    kind: w.kind, code: w.code, name: w.name, address: w.address,
    lat: w.lat, lng: w.lng,
    matchedAddress: w.address, method: "운영DB좌표", queried: null,
  };
}
writeFileSync(SITES, JSON.stringify(file, null, 2), "utf8");
console.log(`\n${want.length}곳 채웠다 -> ${SITES} (총 ${Object.keys(file.sites).length}곳)`);
console.log("다음: node scripts/collectKakaoDirectional.mjs → node scripts/writeDirectionalToFirestore.mjs --apply");
