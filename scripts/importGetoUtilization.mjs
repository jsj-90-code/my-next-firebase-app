// 게토 API로 받은 시간대별 가동률을 평가창 12개월로 잘라 저장한다 (2026-09-16 신설).
//
// 사용자 지시(2026-09-16): "야 가동률 매장 오픈일 + 1개월부터 12개월간 데이터 보는 거 인지하고
// 있지?" — 그렇다. 평가창은 `evaluationSalesPeriod.evaluationMonths`와 같은 정의다(오픈 다음
// 달부터 12개월). 최근 13개월을 그냥 받으면 안 된다. 실제로 손으로 받은 6곳 중 청주지웰시티점이
// 평가창보다 정확히 1년 늦은 구간이었다.
//
// 수집 경로: service.geto.co.kr 로그인 후 POST /Stats/operationRateChart
//   type=PC & date_type=M & shop_seq & s_date & e_date
// ⚠️ e_date는 **그 달을 제외한다.** 평가창 마지막 달을 포함하려면 다음 달 1일을 넣어야 한다
//    (s_date=2024-07-01, e_date=2025-06-30 -> 2025/06이 빠진다. 2025-07-01이어야 들어온다).
//
// 계정 정보는 받지 않았다. 사용자가 브라우저에서 직접 로그인한 세션을 그대로 썼다.
//
//   node scripts/importGetoUtilization.mjs <수집파일.json>
//
// 입력 형식: { "매장명": { seq, s_date, e_date, timezone: { "2024/07": [12개 값], ... } } }
// 출력: .local-tools/geto-utilization.json (parseGetoUtilization.mjs와 같은 모양)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BUCKETS } from "./parseGetoUtilization.mjs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/geto-utilization.json";

/** 평가창 — 오픈 다음 달부터 12개월. src/lib/storeEval/evaluationSalesPeriod.ts와 같은 정의. */
function evaluationMonths(openedAt) {
  const m = String(openedAt ?? "").match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (!m) return [];
  const start = Number(m[1]) * 12 + Number(m[2]) - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const t = start + i + 1;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("수집 파일 경로가 필요하다: node scripts/importGetoUtilization.mjs <파일>");
  process.exit(1);
}
if (!existsSync(SNAPSHOT)) {
  console.error(`${SNAPSHOT}이 없다. node scripts/dumpValidationSnapshot.mjs 먼저.`);
  process.exit(1);
}

let raw = JSON.parse(readFileSync(file, "utf8"));
if (typeof raw === "string") raw = JSON.parse(raw);

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const openedByName = new Map(snap.existingStores.map((s) => [s.storeName, s.openedAt]));

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
let written = 0;
const short = [];

for (const [name, rec] of Object.entries(raw)) {
  if (!rec?.timezone) continue;
  const opened = openedByName.get(name);
  const want = evaluationMonths(opened);
  if (!want.length) {
    console.warn(`  ⚠️ ${name}: 오픈일을 못 찾아 건너뛴다`);
    continue;
  }
  const rows = [];
  for (const ym of want) {
    // 게토는 "2024/07", 우리는 "2024-07"
    const vals = rec.timezone[ym.replace("-", "/")];
    if (!Array.isArray(vals) || vals.length !== BUCKETS.length) continue;
    const hourly = Object.fromEntries(BUCKETS.map((b, i) => [b, Number(vals[i]) / 100]));
    const avg = BUCKETS.reduce((a, b) => a + hourly[b], 0) / BUCKETS.length;
    rows.push({ yearMonth: ym, monthlyRate: Number(avg.toFixed(4)), hourly });
  }
  if (rows.length < 6) {
    short.push(`${name}(${rows.length}개월)`);
    continue;
  }
  if (rows.length < 12) short.push(`${name}(${rows.length}개월, 평가창 미완)`);
  store[name] = {
    storeName: name,
    shopSeq: rec.seq ?? null,
    source: "geto API /Stats/operationRateChart (date_type=M)",
    evaluationWindow: `${want[0]} ~ ${want[11]}`,
    collectedAt: new Date().toISOString(),
    buckets: BUCKETS,
    rows,
  };
  written++;
}

writeFileSync(OUT, JSON.stringify(store, null, 2), "utf8");
console.log(`평가창 기준으로 ${written}곳 저장 (누적 ${Object.keys(store).length}곳) -> ${OUT}`);
if (short.length) console.log(`  ⚠️ 12개월 미만: ${short.join(", ")}`);
