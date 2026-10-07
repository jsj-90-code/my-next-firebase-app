// 소상공인365 유동인구의 **시간대·요일 분해**를 받는다 (2026-10-07 신설)
//
// 왜: 평택소사벌(2026-09-18 개점)이 V62 6,252만원 예측에 첫 달 3,500~4,000만원 수준(사용자 관찰).
// 사용자 현장 관찰 "배후지 수요 대비 상권에 사람이 많지 않다, 다른 쪽으로 분산된다". 그런데 하루 전체 유동은
// 54곳 중 많은 편이었다 — 큰길 통행·낮 직장인까지 섞인 숫자라 PC방 손님이 움직이는 저녁과 다를 수 있다.
// 같은 리포트 탭(sang_gwon4)에 시간대(05~09·09~12·12~14·14~18·18~23·23~05)와 요일 표가 있어 그걸 뽑는다.
//
// collectSbizFloatingPopulation.mjs가 저장해 둔 analyNo·행정동을 재사용한다(캡처를 다시 안 한다).
// 실행: node scripts/collectSbizFloatingTime.mjs [--radius 300] [--kinds existing,candidate,hub]
// 산출물: .local-tools/sbiz-floating-time.json  { sites: { "kind:code": { radius, slots:{"18~23시":n,...}, weekday, weekend } } }
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SRC = ".local-tools/sbiz-floating-population.json";
const OUT = ".local-tools/sbiz-floating-time.json";
const BASE = "https://bigdata.sbiz.or.kr";
const DELAY_MS = Number(process.env.SBIZ_DELAY_MS || 1200); // 남의 공개 사이트 — 줄이지 말 것
const HEADERS = { Referer: `${BASE}/gis/locAnls`, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36" };
const SLOTS = ["05~09시", "09~12시", "12~14시", "14~18시", "18~23시", "23~05시"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const argValue = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const RADIUS = argValue("--radius") ?? "300";
const KINDS = (argValue("--kinds") ?? "existing,candidate,hub").split(",");

const num = (s) => Number(String(s).replace(/,/g, ""));
/** "시간대별 일평균 유동인구 ... 선택 영역 인구 a b c d e f" — 첫 지역(선택 영역)의 인구 6칸. */
function parseTime(text) {
  const i = text.indexOf("시간대별 일평균 유동인구");
  if (i < 0) return null;
  const m = /선택 영역 인구 ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+)/.exec(text.slice(i, i + 800));
  return m ? Object.fromEntries(SLOTS.map((s, k) => [s, num(m[k + 1])])) : null;
}
/** "요일별 일평균 유동인구 ... 선택 영역 인구 주중 주말 월 화 수 목 금 토 일" */
function parseWeek(text) {
  const i = text.indexOf("요일별 일평균 유동인구");
  if (i < 0) return null;
  const m = /선택 영역 인구 ([\d,]+) ([\d,]+)/.exec(text.slice(i, i + 800));
  return m ? { weekday: num(m[1]), weekend: num(m[2]) } : null;
}

const src = JSON.parse(readFileSync(SRC, "utf8")).sites;
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { radius: RADIUS, sites: {} };
const keys = Object.keys(src).filter((k) => KINDS.includes(k.split(":")[0]) && src[k].radii?.[RADIUS]?.analyNo && !out.sites[k]);
console.log(`받을 지점 ${keys.length}곳 · 반경 ${RADIUS}m`);
let n = 0;
for (const k of keys) {
  const s = src[k];
  const r = s.radii[RADIUS];
  const qs = new URLSearchParams({ analyNo: r.analyNo, analyDate: r.analyDate, upjongCd: "R10406", admiCd: s.admiCd ?? "", admiNm: s.admiNm ?? "", kmAnalyNo: "", xtLoginId: "" });
  try {
    const html = await (await fetch(`${BASE}/gis/bizonAnls/report/sg/sang_gwon4.sg?${qs}`, { headers: HEADERS })).text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const slots = parseTime(text);
    const week = parseWeek(text);
    if (slots) {
      out.sites[k] = { radius: RADIUS, slots, ...(week ?? {}) };
      writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
    } else console.log(`  ${k} 시간대 표 없음`);
  } catch (e) {
    console.log(`  ${k} 실패 ${e.message}`);
  }
  if (++n % 20 === 0) console.log(`  ${n}/${keys.length}`);
  await sleep(DELAY_MS);
}
console.log(`끝 — ${Object.keys(out.sites).length}곳 → ${OUT}`);
