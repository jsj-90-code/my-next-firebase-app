// 상권 분리 **눈가림 판정 목록**을 CSV로 뽑는다 — 기존점 38곳 x 경쟁점 전부.
//
// 왜: 경쟁상권이 평균 12.6% 과소예측되는데 계수로는 안 고쳐진다(치우침을 닫으면 퍼짐이
// 커진다). 빠진 건 변수이고, 그 후보가 **"길 건너 경쟁점은 실제 경쟁이 약하다"**이다.
// 사용자가 두 매장에서 손으로 지목한 적이 있지만, 같은 수를 빼는 전조합과 대보니 상위
// 27%·34%로 "그냥 빼면 좋아진다"와 구별이 안 됐다(docs/handoff-20260919.md 2절).
//
// 그래서 **성적을 안 보고** 지도만으로 판정한 표본이 필요하다.
//
// ⚠️ 이 파일은 잔차·예상매출·실매출·적중률을 **한 글자도 읽지 않는다.** 읽는 순간 눈가림이
//    깨진다. 스냅샷에서 쓰는 것은 매장/경쟁점의 이름·좌표·PC수·조사거리뿐이다.
// ⚠️ 줄 순서는 고정 시드로 섞는다. 과소예측 매장이 앞에 몰리면 그 자체가 단서가 된다.
// ⚠️ 과대예측 매장도 전부 들어간다. 거기서도 "길 건너"가 잔뜩 나오면 이 변수는 잔차와
//    무관한 것이고, 그게 이 시험의 핵심이다. 그래서 매장을 고르지 않고 38곳을 다 넣는다.
//
// 사용법:
//   node scripts/dumpMarketSplitJudgment.mjs
//   -> .local-tools/market-split-judgment.csv
//
// 판정칸에 "같은편" / "길건너" / "모르겠음" 중 하나를 적어 돌려주면, 전부 모인 뒤에
// 한꺼번에 재고 무작위 대조군으로 검정한다(중간에 성적을 보면 눈가림이 깨진다).

import { readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/market-split-judgment.csv";

// 고정 시드 — 다시 돌려도 같은 순서가 나와야 사용자가 나눠서 채울 수 있다.
const SEED = 20260918;

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

/** 좌표 거리(m). labInput.rivalDistanceM과 **같은 규칙**이다 — 좌표가 있으면 좌표를 쓴다. */
function haversine(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 자사에서 본 경쟁점의 8방위. 사용자가 지도에서 눈으로 맞춰볼 수 있게 넣는다. */
function bearing8(a, b) {
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
    - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  const brg = (deg(Math.atan2(y, x)) + 360) % 360;
  return ["북", "북동", "동", "남동", "남", "남서", "서", "북서"][Math.round(brg / 45) % 8];
}

// mulberry32 — 짧고 재현 가능한 난수. 시드가 같으면 순서가 같다.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const byCode = new Map();
for (const c of snap.competitors) {
  if (!byCode.has(c.candidateCode)) byCode.set(c.candidateCode, []);
  byCode.get(c.candidateCode).push(c);
}

// 채점 대상 38곳 — 실험실 하네스가 세는 것과 같은 조건이다.
const stores = snap.existingStores.filter((s) => !s.excludedFromModel && s.actualMonthlyRevenueAvg);

const rows = [];
let noStoreCoord = 0, noRivalCoord = 0;
for (const st of stores) {
  if (st.lat == null || st.lng == null) { noStoreCoord++; continue; }
  const code = st.originCandidateCode ?? st.storeCode;
  const rivals = (byCode.get(code) ?? [])
    .filter((c) => c.investigationStatus !== "경쟁점없음")
    // 산식이 세는 경쟁점과 같은 조건 — PC가 0이면 애초에 겨루지 않는다.
    .filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0);
  for (const c of rivals) {
    if (c.lat == null || c.lng == null) { noRivalCoord++; continue; }
    const d = Math.round(haversine(st, c));
    rows.push({
      매장명: st.storeName,
      경쟁점명: c.name,
      거리m: d,
      방위: bearing8(st, c),
      자사위도: st.lat.toFixed(6),
      자사경도: st.lng.toFixed(6),
      경쟁점위도: c.lat.toFixed(6),
      경쟁점경도: c.lng.toFixed(6),
      // 가운데를 찍으면 두 점이 한 화면에 같이 들어와 길을 보기 쉽다.
      지도_가운데: `https://map.kakao.com/link/map/${encodeURIComponent(`${st.storeName}↔${c.name}`)},${((st.lat + c.lat) / 2).toFixed(6)},${((st.lng + c.lng) / 2).toFixed(6)}`,
      지도_자사: `https://map.kakao.com/link/map/${encodeURIComponent(st.storeName)},${st.lat.toFixed(6)},${st.lng.toFixed(6)}`,
      지도_경쟁점: `https://map.kakao.com/link/map/${encodeURIComponent(c.name)},${c.lat.toFixed(6)},${c.lng.toFixed(6)}`,
      로드뷰_경쟁점: `https://map.kakao.com/link/roadview/${c.lat.toFixed(6)},${c.lng.toFixed(6)}`,
      판정: "",
      메모: "",
    });
  }
}

// 섞는다 — Fisher-Yates, 고정 시드.
const rand = rng(SEED);
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

const headers = Object.keys(rows[0]);
const lines = [
  // 1행은 쓰는 법. Excel에서 첫 줄만 보고도 뭘 적을지 알게 한다.
  `# 판정칸에 같은편 / 길건너 / 모르겠음 중 하나를 적으세요. 확신 없으면 모르겠음이 정답입니다 (빈칸 = 아직 안 봄).`,
  headers.join(","),
  ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
];

// Excel이 한글을 깨뜨리지 않게 BOM을 붙인다.
writeFileSync(OUT, "﻿" + lines.join("\r\n") + "\r\n", "utf8");

const perStore = new Map();
for (const r of rows) perStore.set(r.매장명, (perStore.get(r.매장명) ?? 0) + 1);
console.log(`판정할 짝 ${rows.length}개 · 매장 ${perStore.size}곳 -> ${OUT}`);
console.log(`  (좌표 없어 뺀 것: 매장 ${noStoreCoord}곳 · 경쟁점 ${noRivalCoord}곳)`);
console.log(`  시드 ${SEED} 고정 — 다시 돌려도 같은 순서다.`);
console.log(`  거리 ${Math.min(...rows.map((r) => r.거리m))}~${Math.max(...rows.map((r) => r.거리m))}m`);
console.log(`  ⚠️ 이 파일에는 잔차·예상매출·실매출이 없다. 그게 이 시험의 전제다.`);
