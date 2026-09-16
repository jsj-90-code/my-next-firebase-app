// 게토(geto) PC가동률 화면에서 복사한 텍스트를 구조화한다 (2026-09-16 신설).
//
// 왜 필요한가: 우리가 가진 가동률은 월 단위 하나뿐이라, 사용자가 말한 "피크엔 좌석 상한에
// 걸리고 비피크엔 출입 제약이 걸린다"를 구분할 방법이 없었다(2026-09-16). 게토 화면에는
// **2시간 간격 월평균 가동률**이 있어서 그 구분이 가능하다.
//
// 자료 출처: geto 매장통계 > 가동률 > PC가동률. 매장별 로그인이 필요해 자동 수집이 어렵고,
// 화면에서 전체 선택(Alt+A)해 복사한 텍스트를 사용자가 붙여넣는 방식으로 받는다.
//
// 사용법:
//   node scripts/parseGetoUtilization.mjs <붙여넣기파일> [매장명]
//   node scripts/parseGetoUtilization.mjs paste.txt 탕정역점
//
// 결과는 .local-tools/geto-utilization.json에 매장별로 누적된다(같은 매장은 덮어쓴다).
//
// ── 형식 (2026-09-16 확인) ────────────────────────────────────────────────
// 표 머리:  일자 / 가동률(%) / 전월 대비 / 0~2 / 2~4 / ... / 22~24   (2시간 12구간)
// 자료 줄:  2025.07    38    1%    42    24    11    4    7    17    37    61    67    62    64    53
//
// ⚠️ "전월 대비" 칸은 첫 행이나 기준월에서 **비어 있을 수 있다**(예: 2024.11). 칸 수로만
//    자르면 그 줄이 한 칸씩 밀려 조용히 틀린다. 그래서 뒤에서부터 12개를 시간대로 읽고,
//    앞에서 월과 월평균을 읽는 방식으로 맞춘다.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = ".local-tools/geto-utilization.json";
/** 표 머리의 시간대 라벨 순서. 화면과 같은 순서를 그대로 쓴다. */
export const BUCKETS = ["0~2", "2~4", "4~6", "6~8", "8~10", "10~12", "12~14", "14~16", "16~18", "18~20", "20~22", "22~24"];

/**
 * 붙여넣은 텍스트에서 월별 행을 뽑는다.
 * 행 판별: "2025.07" 같은 연.월로 시작하는 줄만 본다 — 머리말·푸터가 섞여 들어와도 안전하다.
 */
export function parseGetoText(text) {
  const rows = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^(\d{4})\.(\d{2})\b/);
    if (!m) continue;
    // 숫자만 모은다. "1%" 같은 퍼센트 표기는 %를 떼고 숫자로 본다.
    const nums = line
      .slice(m[0].length)
      .split(/\s+/)
      .map((t) => t.replace(/%/g, "").trim())
      .filter((t) => t !== "" && /^-?\d+(\.\d+)?$/.test(t))
      .map(Number);
    // 뒤에서부터 12개가 시간대다. 그 앞 첫 숫자가 월평균 가동률이다.
    if (nums.length < 13) continue;
    const hourly = nums.slice(-BUCKETS.length);
    const monthly = nums[0];
    rows.push({
      yearMonth: `${m[1]}-${m[2]}`,
      monthlyRate: monthly / 100,
      hourly: Object.fromEntries(BUCKETS.map((b, i) => [b, hourly[i] / 100])),
    });
  }
  return rows;
}

/** 붙여넣기 텍스트 맨 앞에 매장명이 한 줄로 오는 경우가 많다. 없으면 null. */
export function guessStoreName(text) {
  const first = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
  return first && first.length <= 20 && !/^\d/.test(first) ? first : null;
}

/** 읽어들인 행이 스스로 일관적인지 본다 — 시간대 평균이 월평균과 맞아야 한다. */
export function checkConsistency(row) {
  const vals = BUCKETS.map((b) => row.hourly[b]);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const diff = Math.abs(avg - row.monthlyRate);
  return { avg, diff, ok: diff <= 0.015 };
}

if (process.argv[1] && process.argv[1].endsWith("parseGetoUtilization.mjs")) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) {
    console.error("붙여넣기 파일 경로가 필요하다: node scripts/parseGetoUtilization.mjs <파일> [매장명]");
    process.exit(1);
  }
  const text = readFileSync(file, "utf8");
  const storeName = process.argv[3] ?? guessStoreName(text);
  if (!storeName) {
    console.error("매장명을 못 찾았다. 두 번째 인자로 넘겨라.");
    process.exit(1);
  }
  const rows = parseGetoText(text);
  if (!rows.length) {
    console.error("월별 행을 못 찾았다. 형식이 바뀌었는지 확인해라.");
    process.exit(1);
  }

  console.log(`${storeName} — ${rows.length}개월`);
  let bad = 0;
  for (const r of rows) {
    const c = checkConsistency(r);
    if (!c.ok) {
      bad++;
      console.warn(`  ⚠️ ${r.yearMonth}: 시간대 평균 ${(c.avg * 100).toFixed(1)}% vs 월평균 ${(r.monthlyRate * 100).toFixed(0)}% — ${(c.diff * 100).toFixed(1)}%p 어긋난다`);
    }
  }
  console.log(`  일관성 검사: ${rows.length - bad}/${rows.length} 통과`);

  const peak = rows.map((r) => Math.max(...BUCKETS.map((b) => r.hourly[b])));
  console.log(`  월평균 ${(rows.reduce((a, r) => a + r.monthlyRate, 0) / rows.length * 100).toFixed(1)}% · 피크 시간대 최고 ${(Math.max(...peak) * 100).toFixed(0)}%`);

  const store = {};
  if (existsSync(OUT)) Object.assign(store, JSON.parse(readFileSync(OUT, "utf8")));
  store[storeName] = { storeName, collectedAt: new Date().toISOString(), buckets: BUCKETS, rows };
  writeFileSync(OUT, JSON.stringify(store, null, 2), "utf8");
  console.log(`  -> ${OUT} 에 저장 (누적 ${Object.keys(store).length}곳)`);
}
