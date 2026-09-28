// 인허가 전국 자료(.local-tools/pcbang-permits.json, collectPcBangPermits.mjs가 만든다)에서
// **경쟁점 조사표 초기값**에 쓸 만큼만 추려 앱에 번들되는 색인을 만든다. (2026-09-28)
//
// 왜 번들인가: 인허가 API는 전국을 쪽수로만 주고 지역·좌표 필터가 없다(800쪽·일 1만 건 한도).
// 후보지 상권자료 수집 때 좌표 하나로 바로 찾으려면 서버가 자료를 들고 있어야 한다.
// 영업중 + (게임기수 또는 면적 있음)만 남기면 2만 건 안팎·1.5MB쯤이라 라우트에 import해도 된다.
//
// 갱신: node scripts/collectPcBangPermits.mjs && node scripts/buildPcBangPermitIndex.mjs  → 커밋.
//       색인의 collectedAt이 곧 "언제 자료인가"다(조사표 힌트 문구에 그대로 찍힌다).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = ".local-tools/pcbang-permits.json";
const OUT = "src/lib/storeEval/data/pcbang-permits-open.json";

const P = JSON.parse(readFileSync(SRC, "utf8"));
const rows = Array.isArray(P) ? P : (P.rows ?? P.items ?? P.records ?? Object.values(P));
const isOpen = (p) => /영업/.test(p.status ?? "") && !/폐업|취소|말소/.test(p.status ?? "");
const kept = [];
for (const p of rows) {
  if (!p || !p.lat || !p.lng || !isOpen(p)) continue;
  const game = p.gameCount != null && Number.isFinite(+p.gameCount) ? Math.round(+p.gameCount) : null;
  const area = p.area != null && Number.isFinite(+p.area) && +p.area > 0 ? Math.round(+p.area * 10) / 10 : null;
  if (game == null && area == null) continue;
  // 배열 한 줄 = [이름, 위도, 경도, 게임기수, 면적, 개업일] — 키를 반복하지 않아 파일이 작다.
  kept.push([String(p.name ?? "").trim(), +(+p.lat).toFixed(6), +(+p.lng).toFixed(6), game, area, p.open ?? null]);
}
mkdirSync("src/lib/storeEval/data", { recursive: true });
const out = { collectedAt: P.collectedAt ?? null, source: P.source ?? "공공데이터포털 인터넷컴퓨터게임시설제공업 조회서비스(15154951)", count: kept.length, rows: kept };
writeFileSync(OUT, JSON.stringify(out));
const bytes = Buffer.byteLength(JSON.stringify(out));
console.log(`${OUT}: ${kept.length.toLocaleString()}건 · ${(bytes / 1024 / 1024).toFixed(2)}MB · 자료 시각 ${out.collectedAt}`);
