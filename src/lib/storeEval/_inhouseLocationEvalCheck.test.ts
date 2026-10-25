// 사내 AI 서버(SearXNG 웹 검색)로 입지평가 AI 초안을 돌려 보는 시험 (2026-10-25, 운영 코드 변경 없음).
//
// 목적: 웹 화면 입지평가의 유료 Gemini 키를 사내 서버로 바꿀 수 있는지 판단. 기존 매장 AI 채점
// 검증(ai-validation-run)과 같은 정답지(오픈 전 사람이 매긴 1~5점)와 비교하고, "항상 3점"
// 대조군도 같이 낸다 — 대조군보다 못하면 AI가 아무것도 안 한 것과 같다.
//
// 2026-10-25 결과(40곳 중 19곳 채점): ±1점 이내 사내 AI 74% vs 항상 3점 77% — 대조군을 못 이겨
// 교체 안 함. 상권위치는 사람보다 1점쯤 낮게, 선점경쟁은 거의 3점, 가시성은 검색으로 못 찾아 null이 잦았다.
// Gemini도 이 대조군과 비교된 적이 없다 — 크레딧 충전을 정할 때 같은 방식으로 재 볼 것.
//
// 평소 npm test에서는 skip. 돌릴 때:
//   INHOUSE_AI_CHECK=1 INHOUSE_AI_CHECK_LIMIT=8 npx.cmd vitest run src/lib/storeEval/_inhouseLocationEvalCheck.test.ts --disable-console-intercept
// 사내 AI 주소·키·모델은 isens-qna/.env.local(AI_BASE_URL/AI_API_KEY/AI_MODEL)에서 읽는다(값은 출력 안 함).
// 키가 동시 1건이라 매장은 순차로 돈다. 평일 업무시간엔 직원 사용과 겹치니 저녁·주말에 돌린다.

import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
import { fetchAdminDongPopulation, geocodeToAdminDong } from "@/lib/sgis";
import { buildLocationEvalContext } from "./locationEvalContext";
import { DEMAND_POINT_TARGETS, NEARBY_PC_RADIUS_M } from "./demandPointTargets";
import { haversineDistanceMeters } from "./geo";
import { SCORE_FIELD_KEYS, compareLocationScores, type ScoreFieldKey } from "./aiValidation";
import type { AdminDongReference, Competitor, DemandPoint, LocationEvaluation } from "./types";

function loadEnv(path: URL) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([^#=]+)=(.*)$/);
    if (m && process.env[m[1].trim()] === undefined) {
      process.env[m[1].trim()] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

const RUN = process.env.INHOUSE_AI_CHECK === "1";

// 웹 검색 1회 = 검색어 1개라서, 조사를 초점별로 세 번 나눠 부른다(Gemini는 한 호출에서 여러 번 검색).
const RESEARCH_FOCUS = [
  "이 주소 바로 주변의 지하철역 출구·버스정류장·대로변과의 거리, 사람이 실제로 걷는 동선 위에 있는지, 상권 중심가인지 변두리인지",
  "이 동네 상권의 성격 — 대학가·군부대·산업단지·관광유흥지 같은 특수 수요가 있는지, 주변 동네에서 손님이 들어오기 쉬운 곳인지",
  "이 건물(또는 바로 옆 건물)의 층수·입구·간판이 잘 보이는지, 그리고 근처 PC방들이 이 자리보다 명백히 더 좋은 자리(역 출구 앞·코너)에 있는지",
];

const SYSTEM_PROMPT =
  "당신은 PC방 프랜차이즈 후보지의 입지를 평가하는 전문가입니다. 주어진 사실 자료와 웹 검색 결과만 근거로 " +
  "판단하고, 근거가 없는 내용은 지어내지 마세요. 가격·숫자·거리는 출처 원문 그대로 적으세요.";

const EXTRACT_INSTRUCTIONS =
  "아래 JSON 한 개만 출력하세요. 다른 글은 쓰지 마세요.\n" +
  '{"locationScore": 1~5 또는 null, "preemptionScore": 1~5 또는 null, "visibilityScore": 1~5 또는 null, "rationale": "근거 2~4문장"}\n\n' +
  "- locationScore(상권위치·동선): 상권 중심가·실제 걷는 동선(역 출구·정류장·대로변) 위면 4~5, 변두리면 1~2. 인구·상권 규모 수치는 다른 지표로 계산되니 반영하지 말 것.\n" +
  "- preemptionScore(선점경쟁): 경쟁 PC방 '개수'가 아니라, 어떤 경쟁점이 이 자리보다 명백히 좋은 자리를 이미 차지했는지만. 여러 곳이어도 다들 애매하면 3~4, 1곳이어도 명백한 요지면 1~2.\n" +
  "- visibilityScore(접근가시성): 간판·입구가 잘 보이고 들어가기 쉬운가(층수·계단·엘리베이터 포함).\n" +
  "- 확실하지 않으면 극단값 대신 3점. 근거를 전혀 못 찾은 항목은 null.";

type Draft = { fields: Record<ScoreFieldKey, number | null>; rationale: string };

async function chat(body: Record<string, unknown>): Promise<string> {
  const base = process.env.AI_BASE_URL!.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.AI_MODEL, temperature: 0.1, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`사내 AI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const text: string = j.choices?.[0]?.message?.content ?? "";
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } finally {
    clearTimeout(timer);
  }
}

function parseDraft(text: string): Draft | null {
  const cleaned = text.replace(/```(json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(cleaned.slice(start, end + 1));
    const fields = {} as Record<ScoreFieldKey, number | null>;
    for (const k of SCORE_FIELD_KEYS) {
      const v = j[k];
      fields[k] = typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
    }
    return { fields, rationale: typeof j.rationale === "string" ? j.rationale : "" };
  } catch {
    return null;
  }
}

async function runInhouseDraft(contextText: string): Promise<{ draft: Draft | null; research: string[]; raw: string }> {
  const research: string[] = [];
  for (const focus of RESEARCH_FOCUS) {
    const text = await chat({
      max_tokens: 1500,
      web_search_options: {},
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `[수집된 사실 자료]\n${contextText}\n\n이 주소에 대해 웹 검색으로 조사해서 정리하세요: ${focus}\n(검색어에는 주소·지명만 쓰고 회사 이름은 넣지 마세요.)`,
        },
      ],
    });
    research.push(text);
  }
  const raw = await chat({
    // 1200은 40곳 중 21곳이 "structured output was incomplete (finish_reason=length)"로 거절됐다(10-25).
    max_tokens: 4000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `[수집된 사실 자료]\n${contextText}\n\n[조사 결과]\n${research.join("\n\n---\n\n")}\n\n${EXTRACT_INSTRUCTIONS}`,
      },
    ],
  });
  return { draft: parseDraft(raw), research, raw };
}

// ai-validation-run 라우트와 같은 즉석 조회(저장 안 함). 컨텍스트 글에 쓰이는 칸만 채운다.
async function buildContext(storeCode: string, storeName: string, address: string) {
  const geocode = await geocodeAddress(address).catch(() => null);
  if (!geocode) return null;
  const origin = { lat: geocode.lat, lng: geocode.lng };

  let competitors: Competitor[] = [];
  try {
    const places = await searchByKeyword(origin.lat, origin.lng, "PC방", NEARBY_PC_RADIUS_M);
    // 기존 매장 자리에서 검색하면 우리 매장 자신이 0~1m 경쟁점으로 잡혀 선점경쟁 근거로 쓰인다
    // (첫 시험 안산선부점에서 확인). 오픈 전 사람이 채점할 땐 없던 가게라 뺀다.
    competitors = places.filter((p) => !(p.name.includes("아이센스") && (p.distanceM ?? 0) < 50)).map(
      (p) =>
        ({
          id: `${storeCode}_${p.id}`,
          candidateCode: storeCode,
          name: p.name,
          distanceM: p.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: p.lat, lng: p.lng })),
        }) as Competitor,
    );
  } catch {
    competitors = [];
  }

  const demandPoints: DemandPoint[] = [];
  try {
    const now = Date.now();
    for (const target of DEMAND_POINT_TARGETS) {
      const places =
        target.kind === "category"
          ? await searchByCategory(origin.lat, origin.lng, target.code, target.radiusM)
          : await searchByKeyword(origin.lat, origin.lng, target.keyword, target.radiusM);
      for (const p of places) {
        demandPoints.push({
          id: `${storeCode}_${p.id}`,
          candidateCode: storeCode,
          name: p.name,
          category: target.category,
          lat: p.lat,
          lng: p.lng,
          distanceM: p.distanceM ?? Math.round(haversineDistanceMeters(origin, { lat: p.lat, lng: p.lng })),
          source: "kakao",
          sourcePlaceId: p.id,
          fetchedAt: now,
          confirmed: false,
        });
      }
    }
  } catch {
    demandPoints.length = 0;
  }

  let adminDongReference: AdminDongReference | null = null;
  try {
    const lookup = await geocodeToAdminDong(address);
    if (lookup) {
      const pop = await fetchAdminDongPopulation(lookup.admCd);
      adminDongReference = {
        candidateCode: storeCode,
        admCd: lookup.admCd,
        admName: lookup.admName,
        totalPopulation: pop.totalPopulation,
        malePopulation: pop.malePopulation,
        femalePopulation: pop.femalePopulation,
        year: pop.year,
        fetchedAt: Date.now(),
      };
    }
  } catch {
    adminDongReference = null;
  }

  return buildLocationEvalContext({
    candidate: {
      name: storeName,
      address,
      roadAddress: geocode.roadAddress,
      floating500Avg: null,
      employ500Total: null,
      employ1kmTotal: null,
      operatingPcStores500m: null,
      operatingPcStores1km: null,
      facility500SubwayRiders: null,
    },
    competitors,
    demandPoints,
    adminDongReference,
  });
}

describe.skipIf(!RUN)("사내 AI 입지평가 시험", () => {
  it(
    "기존 매장 정답지와 비교",
    async () => {
      loadEnv(new URL("../../../.env.local", import.meta.url));
      loadEnv(new URL("file:///C:/Users/09960/isens-qna/.env.local"));
      if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY || !process.env.AI_MODEL) {
        throw new Error("사내 AI 설정(AI_BASE_URL/AI_API_KEY/AI_MODEL)을 못 읽었습니다.");
      }
      if (!getApps().length) {
        initializeApp({
          credential: cert({
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
          }),
        });
      }
      const db = getFirestore();
      const limit = Number(process.env.INHOUSE_AI_CHECK_LIMIT ?? "8");

      const [locSnap, storeSnap] = await Promise.all([
        db.collection("storeEvalLocationEvaluations").get(),
        db.collection("storeEvalExistingStores").get(),
      ]);
      const names = new Map(storeSnap.docs.map((d) => [d.id, (d.data().storeName as string | undefined) ?? d.id]));
      const targets = locSnap.docs
        .filter((d) => names.has(d.id))
        .map((d) => ({ code: d.id, loc: d.data() as LocationEvaluation }))
        .filter(({ loc }) => loc.address?.trim() && SCORE_FIELD_KEYS.every((k) => loc[k] != null))
        .sort((a, b) => a.code.localeCompare(b.code))
        .slice(0, limit);
      console.log(`대상 ${targets.length}곳 (정답지 완비 매장 중 코드순 앞에서 ${limit}곳)`);

      const out: Array<Record<string, unknown>> = [];
      let pairs = 0;
      let aiWithin = 0;
      let aiExact = 0;
      let aiNull = 0;
      let baseWithin = 0;
      let baseExact = 0;
      let aiAbs = 0;
      let baseAbs = 0;
      let aiScored = 0;

      for (const { code, loc } of targets) {
        const name = names.get(code)!;
        const address = loc.address!.trim();
        const t0 = Date.now();
        const contextText = await buildContext(code, name, address);
        if (!contextText) {
          console.log(`- ${name}: 주소 좌표 변환 실패, 건너뜀`);
          continue;
        }
        let result;
        try {
          result = await runInhouseDraft(contextText);
        } catch (e) {
          console.log(`- ${name}: 사내 AI 실패 — ${e instanceof Error ? e.message : String(e)}`);
          out.push({ code, name, error: String(e) });
          continue;
        }
        const secs = Math.round((Date.now() - t0) / 1000);
        const ground = Object.fromEntries(SCORE_FIELD_KEYS.map((k) => [k, loc[k] as number])) as Record<ScoreFieldKey, number>;
        const aiFields = result.draft?.fields ?? { locationScore: null, preemptionScore: null, visibilityScore: null };
        const rows = compareLocationScores(ground, aiFields);
        for (const r of rows) {
          pairs++;
          if (r.withinOne) aiWithin++;
          if (r.diff === 0) aiExact++;
          if (r.ai == null) aiNull++;
          else {
            aiAbs += r.diff!;
            aiScored++;
          }
          const bd = Math.abs(r.ground - 3);
          if (bd <= 1) baseWithin++;
          if (bd === 0) baseExact++;
          baseAbs += bd;
        }
        const line = rows.map((r) => `${r.ground}→${r.ai ?? "없음"}`).join(" / ");
        console.log(`- ${name} (${secs}초): 사람→AI ${line}${result.draft ? "" : "  [형식 깨짐]"}`);
        out.push({ code, name, address, ground, ai: aiFields, rationale: result.draft?.rationale, research: result.research, raw: result.draft ? undefined : result.raw, secs });
      }

      const pct = (n: number) => (pairs ? `${Math.round((n / pairs) * 100)}%` : "-");
      console.log("\n=== 요약 (항목 3개 × 매장) ===");
      console.log(`비교 쌍 ${pairs}개`);
      console.log(`사내 AI  : ±1점 이내 ${aiWithin} (${pct(aiWithin)}), 정확히 일치 ${aiExact} (${pct(aiExact)}), 없음(null) ${aiNull}, 평균 오차 ${aiScored ? (aiAbs / aiScored).toFixed(2) : "-"}점`);
      console.log(`항상 3점 : ±1점 이내 ${baseWithin} (${pct(baseWithin)}), 정확히 일치 ${baseExact} (${pct(baseExact)}), 평균 오차 ${pairs ? (baseAbs / pairs).toFixed(2) : "-"}점`);

      const file = process.env.INHOUSE_AI_CHECK_OUT ?? "inhouse-location-eval-result.json";
      writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
      console.log(`자세한 결과(근거·조사 글): ${file}`);
    },
    60 * 60 * 1000,
  );
});
