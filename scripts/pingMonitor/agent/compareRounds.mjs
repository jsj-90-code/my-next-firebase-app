// 사내 서버 vs 해외 서버 같은 시각 대조(2026-11-04 품의 승인 뒤 1~2주 병행용).
// 사내 서버(--copy: 웹에 보내며 사본)와 해외 서버(--local: 사본만)가 남긴 compare/YYYY-MM-DDTHH.json을 받아 와서
// 같은 시각 응답 IP 수를 비교한다. 사용: node compareRounds.mjs <사내 compare 폴더> <해외 compare 폴더>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("사용: node compareRounds.mjs <사내 compare 폴더> <해외 compare 폴더>");
  process.exit(1);
}
const load = (dir) => new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, 13), JSON.parse(readFileSync(join(dir, f), "utf8"))]));
const A = load(a), B = load(b);
const hours = [...A.keys()].filter((h) => B.has(h)).sort();
if (!hours.length) {
  console.log("같은 시각 회차가 아직 없다");
  process.exit(0);
}
let sumA = 0, sumB = 0;
const diffs = [];
for (const h of hours) {
  const ra = A.get(h), rb = B.get(h);
  const sa = new Set(ra.aliveIps), sb = new Set(rb.aliveIps);
  const both = [...sa].filter((ip) => sb.has(ip)).length;
  sumA += sa.size; sumB += sb.size;
  diffs.push((sa.size - sb.size) / Math.max(1, sb.size));
  console.log(`${h} UTC  사내 ${sa.size} · 해외 ${sb.size} · 둘 다 ${both} · 사내만 ${sa.size - both} · 해외만 ${sb.size - both}`);
}
diffs.sort((x, y) => x - y);
console.log(`\n${hours.length}회차 합계 사내 ${sumA} · 해외 ${sumB} · 비 ${(sumA / Math.max(1, sumB)).toFixed(3)} · 회차별 차이 중앙값 ${(diffs[Math.floor(diffs.length / 2)] * 100).toFixed(1)}%`);
