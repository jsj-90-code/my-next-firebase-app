// 항아리상권 AI 판정 — 지도 한 장을 보고 **예/아니오 사실만** 답한다. 점수를 매기지 않는다. (2026-09-23)
//
//   node scripts/tradeArea/judge.mjs [--only=existing|candidate] [--redo] [--limit=N]
//
// 입력: .local-tools/trade-area-maps/<kind>-<code>.png (shotMaps.mjs) · 출력: .local-tools/trade-area-judgments.json
// 모델: GEMINI_MODEL_TRADE_AREA ?? "gemini-3.6-flash" (초기평가 도구와 같은 무료 키 GEMINI_API_KEY). 사이트당 1회 호출.
//
// ── 문항 (사용자 설계 2026-09-23 · 전부 "예 = 막힘") ──────────────────────────────
//   동·서·남·북 각각: 매장에서 그 방향으로 **1km~2km 사이(두 원 사이 고리)**에 하천·철도·고속도로(자동차전용·고가)·
//   산지/대규모 녹지·바다/호수가 있어, 그 너머 주민이 매장 쪽으로 걸어오거나 짧게 이동하기 어려운가.
//   참고 문항: 2km 안에 매장 상권보다 큰 상업 중심(철도역 상권·대형 번화가)이 있는가 — 어느 방향인가.
// 산식은 막힌 방향 수 ÷ 4를 고리 인구에서 깎는다(막힌 방향의 고리 주민은 안 온다). 사실 개수라 맞춘 계수가 없다.
//
// ⚠️ AI 판정도 검증 대상이다 — 사람이 표본을 직접 보고 대조한다(로드뷰 판정과 같은 원칙).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY가 없다."); process.exit(1); }
const MODEL = process.env.GEMINI_MODEL_TRADE_AREA ?? "gemini-3.6-flash";
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7) : null;
const REDO = process.argv.includes("--redo");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.slice(8)) : Infinity;

const MAPS = ".local-tools/trade-area-maps";
const OUT = ".local-tools/trade-area-judgments.json";
const shots = JSON.parse(readFileSync(`${MAPS}/_shots.json`, "utf8"));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { judgedAt: null, model: MODEL, sites: {} };
const out = { judgedAt: new Date().toISOString(), model: MODEL, sites: { ...prev.sites } };

const PROMPT = `이 지도는 한 PC방 매장(중앙 마커)을 중심으로 그린 것이다. 빨간 실선 원이 반경 1km, 파란 점선 원이 반경 2km다.
두 원 사이의 띠(1km~2km)를 "고리"라고 부른다. 위쪽이 북쪽이다.

**사실만** 답한다. 점수·평가·추측을 하지 않는다. 지도에서 보이는 것만 근거로 삼는다.

문항 A. 동·서·남·북 네 방향 각각에 대해: 매장에서 그 방향으로 나갈 때 **고리(1~2km) 구간 안**에 다음 중 하나가 있어
그 너머의 주민이 매장 쪽으로 걸어오거나 짧게 이동하기 어려운가?
  - 하천·강 (다리가 드물면 예, 다리가 여럿이면 아니오)
  - 철도·지하철 지상 구간·철도 차량기지
  - 고속도로·자동차전용도로·고가 (일반 4차선 도로는 아니오)
  - 산지·구릉·대규모 공원/녹지/골프장
  - 바다·호수·저수지·간척지·비어 있는 미개발지
답: 예 / 아니오. 예면 무엇인지 한 단어(예: "하천", "철도", "산지").

문항 B (핵심). 동·서·남·북 네 방향 각각에 대해: 매장에서 그 방향으로 **고리(1~2km) 구간**에 **사람이 사는 동네**(아파트 단지·주택가·
시가지)가 있는가? 논밭·공장/산업단지·산·물·미개발지·창고만 있으면 "아니오". 지도의 건물 밀집·동네 이름·아파트 표기로 판단한다.
답: 예 / 아니오. 예면 무엇인지 한 단어(예: "아파트단지", "주택가", "시가지"). 아니오면 대신 무엇이 있는지(예: "논밭", "산단", "산지").

문항 C. 2km 원 안에 매장 주변 상가 밀집 말고 **다른 상권**(다른 동네의 상가 밀집·역 앞 번화가·중심상업지)이 보이는가?
답: 예 / 아니오. 예면 방향과 이름을 지도에서 읽을 수 있으면 적는다. 아니오면 이 매장 주변이 2km 안 유일한 상권이다.

문항 D. 1km 원 안 주거지가 아파트 대단지·신도시 블록 위주인가(예), 아니면 저층 주거·상가가 섞인 시가지인가(아니오)?

JSON으로만 답한다:
{"blocked":{"N":true|false,"E":true|false,"S":true|false,"W":true|false},
 "blockedBy":{"N":"","E":"","S":"","W":""},
 "residential":{"N":true|false,"E":true|false,"S":true|false,"W":true|false},
 "residentialNote":{"N":"","E":"","S":"","W":""},
 "otherCommercialWithin2km":true|false,"otherCommercialNote":"",
 "aptBlock":true|false,
 "note":"한두 문장. 지도에서 본 사실만"}`;

const ai = new GoogleGenAI({ apiKey });
// 503(수요 폭주)·429(할당량)는 기다렸다 다시 시도하고, 그래도 안 되면 예비 모델로 넘어간다(2026-09-23 첫 실행에서 54곳 전부 503).
const MODELS = [MODEL, ...(process.env.GEMINI_MODEL_TRADE_AREA_FALLBACK ?? "gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter((m) => m && m !== MODEL)];
async function generate(b64) {
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: b64 } }, { text: PROMPT }] }],
          config: { responseMimeType: "application/json", temperature: 0 },
        });
        return { text: res.text ?? "", model };
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        if (!/503|429|high demand|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}
// 실패로 남은 항목(error만 있고 blockedCount 없음)은 다시 대상에 넣는다
const targets = Object.values(shots).filter((s) => s.ok && (!only || s.kind === only) && (REDO || out.sites[`${s.kind}:${s.code}`]?.ringCutCount == null)).slice(0, LIMIT);
console.log(`판정 대상 ${targets.length}곳 · 모델 ${MODELS.join(" → ")}`);
let n = 0, fail = 0;
for (const s of targets) {
  n++;
  const key = `${s.kind}:${s.code}`;
  const b64 = readFileSync(s.file).toString("base64");
  try {
    const { text, model: usedModel } = await generate(b64);
    const j = JSON.parse(text);
    const DIRS = ["N", "E", "S", "W"];
    const blockedCount = DIRS.filter((d) => j.blocked?.[d] === true).length;
    // ⭐ 산식이 쓰는 값 — 사용자 정의(2026-09-23): 항아리 = 반경 밖에 상권·동네가 없다. 고리에 주거가 없는 방향 수.
    const noResidentialCount = DIRS.filter((d) => j.residential?.[d] === false).length;
    out.sites[key] = { key, kind: s.kind, code: s.code, name: s.name, ...j, blockedCount, noResidentialCount,
      ringCutCount: noResidentialCount, ringCutBasis: "noResidential", judgedAt: new Date().toISOString(), model: usedModel };
    const empty = DIRS.filter((d) => j.residential?.[d] === false).map((d) => `${d}:${j.residentialNote?.[d] ?? ""}`).join(" ");
    console.log(`${String(n).padStart(2)}/${targets.length} ${s.name.padEnd(12)} 주거없음 ${noResidentialCount}/4 ${empty.padEnd(30)} 다른상권 ${j.otherCommercialWithin2km ? "예" : "아니오"} 단절 ${blockedCount}/4`);
  } catch (e) {
    fail++;
    out.sites[key] = { key, kind: s.kind, code: s.code, name: s.name, error: String(e?.message ?? e), judgedAt: new Date().toISOString(), model: MODEL };
    console.log(`${String(n).padStart(2)}/${targets.length} ${s.name}\t실패: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  await new Promise((r) => setTimeout(r, 5000)); // 무료 할당량(분당 요청) 보호 — 1.5초로는 429가 났다(2026-09-23)
}
console.log(`\n${n - fail}곳 판정 · 실패 ${fail} -> ${OUT}`);
const all = Object.values(out.sites).filter((s) => s.ringCutCount != null);
const hist = [0, 1, 2, 3, 4].map((k) => `${k}방향 ${all.filter((s) => s.ringCutCount === k).length}곳`).join(" · ");
console.log(`고리에 주거 없는 방향 수 분포: ${hist}`);
console.log(`2km 안 다른 상권 없음(유일 상권): ${all.filter((s) => s.otherCommercialWithin2km === false).length}곳`);
