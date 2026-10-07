// 배후지 나눠 갖기(허프) 시험 계산 — 자리마다 "배후 주민 중 우리 상권으로 오는 몫" (2026-10-07 신설)
//
// ⚠️ 실험실 검증 전 단계다. 산식에 안 들어가고, 운영 DB에 쓰지 않는다. 표만 뽑는다.
//    산식 시험은 B1·B2(경쟁점 핑 보정·점유율 정리, 10-14~) 뒤에 한다(다른 세션과 합의).
//
// 허프 모델: 주민이 사는 칸 o에서 상권 d로 갈 확률
//     P(o→d) = A_d^α / dist(o,d)^β  ÷  Σ_k A_k^α / dist(o,k)^β
//   dist 하한 300m. 목적지는 두 가지 중 고른다(--dest):
//   grid (기본) : 공식 1km 격자 칸마다 소매+음식·주점+오락 사업체 수(buildBusinessGrid1km.mjs).
//                 우리 상권 = 매장 좌표 중심 1km 창(겹치는 칸에서 비율만큼 옮겨 옴). 빈틈이 없다.
//   zone        : 소상공인진흥공단 지정 상권, A = 중심 반경 500m 점포 수(collectTradeZones.mjs).
//                 ⚠️ 지정 상권이 전국을 안 덮는다 — 김포구래·증평·문산 등 4km 안 0곳이라 "100%"가 나온다.
//
// 재료:
//   .local-tools/business-grid-1km.json  (buildBusinessGrid1km.mjs — grid 목적지)
//   .local-tools/store-grid-500m.json    (collectStoreGrid500m.mjs — 있으면 3km 안 목적지를 500m 칸으로)
//   .local-tools/trade-zones.json        (collectTradeZones.mjs — zone 목적지, 이름표)
//   .local-tools/resident-grid-1km.json  (buildResidentGrid1km.mjs — 총량 정본)
//   .local-tools/resident-grid-500m.json (collectResidentGrid.mjs — 있으면 1km 칸을 4칸으로 나누는 비율)
//
// 실행: node scripts/computeHuffShare.mjs [--alpha 1] [--beta 2] [--origin-m 2000]
// 산출물: .local-tools/huff-share.json + 화면 표
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { to5179 } from "./lib/tm.mjs";

const args = process.argv.slice(2);
const argNum = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : Number(args[i + 1]); };
const ALPHA = argNum("--alpha", 1);
const BETA = argNum("--beta", 2);
const ORIGIN_M = argNum("--origin-m", 2000); // 배후지로 볼 범위(이 안에 사는 주민)
const MERGE_M = argNum("--merge-m", 300);
const MIN_DIST_M = 300;
const DEST = args.includes("--dest") ? args[args.indexOf("--dest") + 1] : "grid";
const DEST_REACH_M = 3000;
const FINE_M = 3000; // 500m 점포 칸을 쓰는 범위(collectStoreGrid500m.mjs의 RADIUS_M과 같게)
const OWN_M = argNum("--own-m", 1000); // 우리 상권 창 한 변 // 배후지 끝에 사는 사람도 그 바깥 상권까지 고를 수 있게

const tz = JSON.parse(readFileSync(".local-tools/trade-zones.json", "utf8"));
const g1 = JSON.parse(readFileSync(".local-tools/resident-grid-1km.json", "utf8")).cells;
const biz = existsSync(".local-tools/business-grid-1km.json")
  ? JSON.parse(readFileSync(".local-tools/business-grid-1km.json", "utf8")).cells
  : {};
const sg = existsSync(".local-tools/store-grid-500m.json")
  ? JSON.parse(readFileSync(".local-tools/store-grid-500m.json", "utf8")).cells
  : {};
const g5 = existsSync(".local-tools/resident-grid-500m.json")
  ? JSON.parse(readFileSync(".local-tools/resident-grid-500m.json", "utf8")).cells
  : {};

/** 1km 칸 → 출발점 목록. 500m 비율이 4칸 다 있으면 나누고, 아니면 1km 칸 중심 하나. */
function originsOf(c) {
  const subs = [];
  for (const dx of [-250, 250]) for (const dy of [-250, 250]) {
    const k = `${c.x + dx}_${c.y + dy}`;
    if (!g5[k]) return [{ x: c.x, y: c.y, pop: c.pop }];
    subs.push({ x: c.x + dx, y: c.y + dy, w: g5[k].pop });
  }
  const sum = subs.reduce((a, b) => a + b.w, 0);
  if (sum <= 0) return [{ x: c.x, y: c.y, pop: c.pop }];
  return subs.map((s) => ({ x: s.x, y: s.y, pop: (c.pop * s.w) / sum }));
}

const zones = Object.values(tz.zones)
  .filter((z) => z.center && z.stores500m != null)
  .map((z) => ({ ...z, tm: to5179(z.center.lng, z.center.lat) }));

const rows = [];
for (const [code, s] of Object.entries(tz.sites)) {
  if (s.stores500m == null) continue;
  const tm = to5179(s.lng, s.lat);
  const near = zones.filter((z) => s.zoneNos.includes(z.trarNo));
  // 우리 상권: 가까운 지정 상권과 합친다
  const merged = near.filter((z) => Math.hypot(z.tm.x - tm.x, z.tm.y - tm.y) <= MERGE_M);
  const ours = {
    name: merged.length ? `(우리) ${merged.map((z) => z.name).join("·")}` : "(우리 자리)",
    tm,
    A: Math.max(s.stores500m, ...merged.map((z) => z.stores500m)),
    ours: true,
  };
  const others = near
    .filter((z) => !merged.includes(z))
    .map((z) => ({ name: z.name, tm: z.tm, A: z.stores500m, ours: false }));
  let dests = [ours, ...others];
  if (DEST === "grid") {
    const cells = Object.values(biz).filter((c) => Math.hypot(c.x - tm.x, c.y - tm.y) <= ORIGIN_M + DEST_REACH_M);
    const A = (c) => c.retail + c.food + c.leisure;
    // 우리 상권 = 매장 좌표 중심 1km 창. 칸 경계에 걸친 매장이 자기 상권을 "옆 칸 = 남의 상권"으로
    // 세지 않도록, 각 칸이 창과 겹치는 비율만큼 우리 쪽으로 옮기고 그 칸에선 덜어낸다.
    const overlap = (c) => (Math.max(0, 1000 - Math.abs(c.x - tm.x)) / 1000) * (Math.max(0, 1000 - Math.abs(c.y - tm.y)) / 1000);
    const label = (c) => {
      let best = null, bd = 700;
      for (const z of zones) { const d = Math.hypot(z.tm.x - c.x, z.tm.y - c.y); if (d < bd) { bd = d; best = z.name; } }
      return best ? `${best} 일대` : `격자 ${Math.round(c.x / 1000)}-${Math.round(c.y / 1000)}`;
    };
    dests = [
      { name: "(우리 1km 창)", tm, A: cells.reduce((sum, c) => sum + overlap(c) * A(c), 0), ours: true },
      ...cells
        .map((c) => ({ name: label(c), tm: { x: c.x, y: c.y }, A: (1 - overlap(c)) * A(c), ours: false }))
        .filter((d) => d.A > 0.5),
    ];
    ours.A = dests[0].A;
    ours.name = "(우리 1km 창)";

    // 세밀판: 500m 점포 칸(collectStoreGrid500m.mjs)이 이 자리 주변에 있으면 3km 안은 그걸 쓴다.
    // 우리 창은 같은 1km지만 매장 좌표에 정확히 맞춰지고, 3km 밖 1km 사업체 칸은 점포 수 눈금으로 환산한다.
    const fine = Object.values(sg).filter((c) => Math.hypot(c.x - tm.x, c.y - tm.y) <= FINE_M);
    if (fine.length >= 100) {
      const inner = (c) => Math.hypot(c.x - tm.x, c.y - tm.y) <= 2500;
      const k = fine.filter(inner).reduce((a, c) => a + c.stores, 0) / Math.max(1, cells.filter(inner).reduce((a, c) => a + A(c), 0));
      const half = OWN_M / 2;
      const ov = (c) => (Math.max(0, half + 250 - Math.max(half - 250, Math.abs(c.x - tm.x))) / 500) * (Math.max(0, half + 250 - Math.max(half - 250, Math.abs(c.y - tm.y))) / 500);
      const ownA = fine.reduce((a, c) => a + Math.min(1, ov(c)) * c.stores, 0);
      dests = [
        { name: `(우리 ${OWN_M}m 창)`, tm, A: ownA, ours: true },
        ...fine
          .map((c) => ({ name: label(c), tm: { x: c.x, y: c.y }, A: (1 - Math.min(1, ov(c))) * c.stores, ours: false }))
          .filter((d) => d.A > 0.5),
        ...cells
          .filter((c) => Math.hypot(c.x - tm.x, c.y - tm.y) > FINE_M + 500)
          .map((c) => ({ name: label(c), tm: { x: c.x, y: c.y }, A: k * A(c), ours: false }))
          .filter((d) => d.A > 0.5),
      ];
      ours.A = ownA;
      ours.name = `(우리 ${OWN_M}m 창)`;
      ours.fine = true;
    }
  }

  const origins = Object.values(g1)
    .filter((c) => Math.hypot(c.x - tm.x, c.y - tm.y) <= ORIGIN_M + 710)
    .flatMap(originsOf)
    .filter((o) => Math.hypot(o.x - tm.x, o.y - tm.y) <= ORIGIN_M);

  let H = 0, C = 0, H1 = 0, C1 = 0;
  const lost = new Map();
  for (const o of origins) {
    const ws = dests.map((d) => Math.pow(d.A, ALPHA) / Math.pow(Math.max(MIN_DIST_M, Math.hypot(o.x - d.tm.x, o.y - d.tm.y)), BETA));
    const W = ws.reduce((a, b) => a + b, 0);
    const pOurs = ws[0] / W;
    H += o.pop;
    C += o.pop * pOurs;
    if (Math.hypot(o.x - tm.x, o.y - tm.y) <= 1000) { H1 += o.pop; C1 += o.pop * pOurs; }
    dests.forEach((d, i) => { if (i > 0) lost.set(d.name, (lost.get(d.name) ?? 0) + (o.pop * ws[i]) / W); });
  }
  const top = [...lost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([n, v]) => `${n} ${Math.round((100 * v) / H)}%`);
  rows.push({
    code, name: s.name, kind: s.kind,
    ourName: ours.name, fine: !!ours.fine, ourStores500m: ours.A, zonesNearby: dests.length - 1,
    hinterlandPop: Math.round(H), capturedPop: Math.round(C),
    shareAll: C / H, share1km: H1 ? C1 / H1 : null, topLeak: top,
  });
}

rows.sort((a, b) => a.shareAll - b.shareAll);
console.log(`목적지=${DEST} α=${ALPHA} β=${BETA} 배후 ${ORIGIN_M}m · 500m 비율 칸 ${Object.keys(g5).length}개`);
console.log("구분  이름              우리크기 주변목적지  배후인구   우리몫  1km안몫  많이 빠지는 곳");
for (const r of rows) {
  console.log(
    `${r.kind === "existing" ? "기존" : "후보"}${r.fine ? "*" : " "} ${r.name.padEnd(14)} ${String(Math.round(r.ourStores500m)).padStart(6)} ${String(r.zonesNearby).padStart(6)}  ${String(r.hinterlandPop).padStart(8)}  ${(100 * r.shareAll).toFixed(0).padStart(4)}%  ${r.share1km == null ? "  -" : (100 * r.share1km).toFixed(0).padStart(4) + "%"}  ${r.topLeak.join(", ")}`,
  );
}
writeFileSync(".local-tools/huff-share.json", JSON.stringify({ computedAt: new Date().toISOString(), dest: DEST, alpha: ALPHA, beta: BETA, originM: ORIGIN_M, rows }, null, 1), "utf8");
