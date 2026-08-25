import { Type } from "@google/genai";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getLocationEvalGeminiClient, getLocationEvalGeminiModel } from "@/lib/gemini";
import { buildLocationEvalContext } from "@/lib/storeEval/locationEvalContext";
import type {
  AdminDongReference,
  CandidateInput,
  Competitor,
  DemandPoint,
  InflowRestriction,
  SpecialDemandIntensity,
  SpecialDemandType,
} from "@/lib/storeEval/types";

// 3단계 — 입지동선평가 AI 초안(기존 Claude+web_search 5점수 라우트를 Gemini로 교체, 2026-08-25).
// 09_입지동선평가 D/E/F/G/J/K/L/M/N/O열(공식 판단기준표 없음, docs/data-issues.md #2)은 여전히
// "사람이 GPT/AI에게 물어보고 옮겨 적던" 과정을 앱 안으로 옮겨온 것뿐이다 — AI 결과는 항상 사람이
// 검토(승인화면)·수정 후 직접 저장하는 초안일 뿐 자동저장하지 않는다(2026-08-22 원칙 유지).
//
// 1~2단계에서 이미 수집해둔 사실값(경쟁점/수요거점/행정동 인구통계/소상공인365 참고자료 +
// 후보지 지도 스냅샷 이미지)을 컨텍스트로 주고, 부족한 부분만 Gemini의 웹검색으로 보완한다.
// Gemini API는 googleSearch 그라운딩 도구와 responseSchema 강제 구조화 출력을 같은 호출에
// 섞기 어렵다고 알려져 있어(2026-08-25 확인), "조사 → 구조화 추출" 2단계로 분리한다 — 기존
// Claude 라우트의 "검색 먼저, 안 되면 강제 재요청" 2회 왕복 구조를 계승한 형태다.

const SPECIAL_DEMAND_TYPES: SpecialDemandType[] = ["없음", "대학가", "군부대", "산업단지", "관광유흥", "기타"];
const SPECIAL_DEMAND_INTENSITIES: SpecialDemandIntensity[] = ["없음", "낮음", "보통", "높음"];
const INFLOW_LEVELS: InflowRestriction[] = ["없음", "보통", "강함"];

const FIELD_KEYS = [
  "locationScore",
  "flowScore",
  "preemptionScore",
  "visibilityScore",
  "attractionScore",
  "specialDemandType",
  "specialDemandIntensity",
  "inflowRestriction",
  "demandLeakageRisk",
  "marketStructureMemo",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

type LocationEvalDraft = {
  fields: Record<FieldKey, number | string | null>;
  confidence: Record<FieldKey, number>;
  rationale: string;
};

function scoreProp(description: string) {
  return { type: Type.INTEGER, minimum: 1, maximum: 5, nullable: true, description };
}
function enumProp(values: string[], description: string) {
  return { type: Type.STRING, format: "enum", enum: values, nullable: true, description };
}
function textProp(description: string) {
  return { type: Type.STRING, nullable: true, description };
}
function confidenceProp(description: string) {
  return { type: Type.NUMBER, minimum: 0, maximum: 1, description };
}

const FIELD_SCHEMAS: Record<FieldKey, ReturnType<typeof scoreProp> | ReturnType<typeof enumProp> | ReturnType<typeof textProp>> = {
  locationScore: scoreProp("상권내위치점수 — 유동인구가 몰리는 상권 중심부에 가까운가"),
  flowScore: scoreProp("주요동선점수 — 실제로 사람이 많이 지나는 이동경로(역 출구/큰 도로 등)에 있는가"),
  preemptionScore: scoreProp("선점경쟁점수 — 경쟁 PC방이 더 좋은 자리를 이미 선점해서 불리한가(불리할수록 낮은 점수)"),
  visibilityScore: scoreProp("접근가시성점수 — 간판/입구가 잘 보이고 들어가기 쉬운가(층수/계단·엘리베이터 포함)"),
  attractionScore: scoreProp("상권흡인력점수 — 이 상권 자체가 사람을 끌어모으는 힘"),
  specialDemandType: enumProp(SPECIAL_DEMAND_TYPES, "특수수요유형"),
  specialDemandIntensity: enumProp(SPECIAL_DEMAND_INTENSITIES, "특수수요강도"),
  inflowRestriction: enumProp(INFLOW_LEVELS, "외부유입제한 — 이 상권이 인근 상권으로 수요를 얼마나 뺏기기 쉬운가"),
  demandLeakageRisk: enumProp(INFLOW_LEVELS, "수요이탈위험 — 온라인/타 여가수단 등으로 수요 자체가 빠질 위험"),
  marketStructureMemo: textProp("상권구조에 대한 자유서술 메모(1~2문장)"),
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fields: {
      type: Type.OBJECT,
      properties: FIELD_SCHEMAS,
      required: FIELD_KEYS as unknown as string[],
    },
    confidence: {
      type: Type.OBJECT,
      description: "fields의 각 항목에 대해 0(전혀 확신 없음)~1(매우 확신) 사이 자기평가 신뢰도",
      properties: Object.fromEntries(FIELD_KEYS.map((k) => [k, confidenceProp(`${k} 신뢰도`)])),
      required: FIELD_KEYS as unknown as string[],
    },
    rationale: { type: Type.STRING, description: "5개 점수 + 판단 필드 전체에 대한 근거를 한국어로 종합 서술" },
  },
  required: ["fields", "confidence", "rationale"],
};

const SYSTEM_PROMPT =
  "당신은 PC방 프랜차이즈 신규 후보지의 입지를 평가하는 전문가입니다. 아래에 이미 수집된 사실 자료" +
  "(경쟁점·수요거점 거리, 행정동 인구통계, 소상공인365 참고자료, 지도 이미지)가 주어집니다. 이것만으로" +
  "부족한 부분(상권 성격, 실제 동선, 특수수요 등)은 웹 검색으로 그 주소를 직접 조사해서 보완하세요.\n\n" +
  "판단할 항목:\n" +
  "- 상권내위치/주요동선/선점경쟁/접근가시성/상권흡인력 점수(1~5점, 공식 채점기준표 없음)\n" +
  "- 특수수요유형·강도(대학가/군부대/산업단지/관광유흥 등 특수 수요원이 있는가)\n" +
  "- 외부유입제한·수요이탈위험(없음/보통/강함)\n" +
  "- 상권구조메모(자유서술)\n\n" +
  "확실하지 않은 부분은 추측해서 극단적인 값을 주지 말고 중간값(점수는 3점, 유형/강도는 '없음' 또는 " +
  "'보통') 쪽으로 보수적으로 판단하세요. 근거를 전혀 못 찾은 항목은 null로 남기고 절대 지어내지 마세요.";

async function getVerifiedUserId(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !adminAuth) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function isLocationEvalDraft(input: unknown): input is LocationEvalDraft {
  if (!input || typeof input !== "object") return false;
  const r = input as Record<string, unknown>;
  if (typeof r.rationale !== "string") return false;
  const fields = r.fields as Record<string, unknown> | undefined;
  const confidence = r.confidence as Record<string, unknown> | undefined;
  if (!fields || typeof fields !== "object" || !confidence || typeof confidence !== "object") return false;

  for (const key of FIELD_KEYS) {
    const conf = confidence[key];
    if (typeof conf !== "number" || conf < 0 || conf > 1) return false;

    const v = fields[key];
    if (v === null) continue;
    if (key === "marketStructureMemo") {
      if (typeof v !== "string") return false;
    } else if (key === "specialDemandType") {
      if (!SPECIAL_DEMAND_TYPES.includes(v as SpecialDemandType)) return false;
    } else if (key === "specialDemandIntensity") {
      if (!SPECIAL_DEMAND_INTENSITIES.includes(v as SpecialDemandIntensity)) return false;
    } else if (key === "inflowRestriction" || key === "demandLeakageRisk") {
      if (!INFLOW_LEVELS.includes(v as InflowRestriction)) return false;
    } else {
      if (typeof v !== "number" || v < 1 || v > 5) return false;
    }
  }
  return true;
}

type AiLocationEvalBody = {
  candidateCode?: string;
  mapImageUrl?: string;
};

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!adminDb) {
    return NextResponse.json({ error: "Firebase Admin이 초기화되지 않았습니다." }, { status: 500 });
  }

  // 웹검색 그라운딩은 무료 티어에서 아예 안 되고 결제(유료 티어) 프로젝트가 필요하다 — 좌석배치도
  // 자동화가 쓰는 무료 티어 GEMINI_API_KEY와는 별도의 전용 키를 쓴다(gemini.ts 주석 참고, 실수로
  // 좌석배치도 쪽에 과금이 번지지 않도록 하기 위함).
  const client = getLocationEvalGeminiClient();
  if (!client) {
    return NextResponse.json({ error: "GEMINI_API_KEY_LOCATION_EVAL가 설정되지 않았습니다." }, { status: 500 });
  }

  let body: AiLocationEvalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const candidateCode = body.candidateCode?.trim();
  if (!candidateCode) {
    return NextResponse.json({ error: "candidateCode가 필요합니다." }, { status: 400 });
  }

  const candidateSnap = await adminDb.collection("storeEvalCandidates").doc(candidateCode).get();
  if (!candidateSnap.exists) {
    return NextResponse.json({ error: "후보지를 찾을 수 없습니다." }, { status: 404 });
  }
  const candidate = candidateSnap.data() as CandidateInput;
  if (!candidate.address?.trim()) {
    return NextResponse.json({ error: "주소가 필요합니다. 기본정보 탭에서 먼저 입력해주세요." }, { status: 400 });
  }

  const [competitorsSnap, demandPointsSnap, adminDongSnap] = await Promise.all([
    adminDb.collection("storeEvalCompetitors").where("candidateCode", "==", candidateCode).get(),
    adminDb.collection("storeEvalDemandPoints").where("candidateCode", "==", candidateCode).get(),
    adminDb.collection("storeEvalAdminDongReferences").doc(candidateCode).get(),
  ]);
  const competitors = competitorsSnap.docs.map((d) => d.data() as Competitor);
  const demandPoints = demandPointsSnap.docs.map((d) => d.data() as DemandPoint);
  const adminDongReference = adminDongSnap.exists ? (adminDongSnap.data() as AdminDongReference) : null;

  const contextText = buildLocationEvalContext({ candidate, competitors, demandPoints, adminDongReference });

  // 지도 이미지는 클라이언트가 카카오 StaticMap에서 뽑아낸 이미지 URL만 보내고, 여기서 서버가
  // 직접 fetch한다 — 브라우저 canvas/fetch는 카카오 CDN이 CORS 헤더를 안 주면 픽셀을 못 읽지만
  // 서버↔서버 요청은 그 제약이 없다. 실패해도 전체 요청을 막지 않고 텍스트만으로 진행한다.
  let mapImageBase64: string | null = null;
  const warnings: string[] = [];
  if (body.mapImageUrl) {
    try {
      const imgRes = await fetch(body.mapImageUrl);
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      mapImageBase64 = buf.toString("base64");
    } catch (err) {
      warnings.push(`지도 이미지를 불러오지 못해 텍스트 정보만으로 진행합니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const model = getLocationEvalGeminiModel();

  try {
    // 1단계 — 웹검색 조사(자유서술). 지도 이미지가 있으면 함께 준다.
    const researchParts: object[] = [];
    if (mapImageBase64) researchParts.push({ inlineData: { mimeType: "image/png", data: mapImageBase64 } });
    researchParts.push({
      text:
        `아래는 이미 수집된 사실 자료입니다.\n\n${contextText}\n\n` +
        "이 주소를 웹 검색으로 조사해서(지도, 인근 역/버스정류장, 상권 성격, 주변 PC방 등) 위 판단 항목들의 근거가 될 내용을 정리하세요.",
    });

    const researchResponse = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: researchParts }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ googleSearch: {} }],
      },
    });
    const researchText = researchResponse.text ?? "";

    // 2단계 — 구조화 추출(도구 없이, responseSchema로 강제).
    const extractResponse = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `[수집된 사실 자료]\n${contextText}\n\n[조사 결과]\n${researchText}\n\n` +
                "위 내용을 바탕으로 판단 항목들을 스키마에 맞춰 제출하세요. 근거가 부족한 항목은 null로 " +
                "남기고 절대 지어내지 마세요.",
            },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractResponse.text ?? "");
    } catch {
      return NextResponse.json({ error: "AI가 올바른 형식으로 응답하지 않았습니다. 다시 시도해주세요." }, { status: 502 });
    }
    if (!isLocationEvalDraft(parsed)) {
      return NextResponse.json({ error: "AI 응답 형식이 예상과 달랐습니다. 다시 시도해주세요." }, { status: 502 });
    }

    return NextResponse.json({ ...parsed, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
