// 채팅 입지평가 MCP 서버 — claude.ai·ChatGPT 채팅(휴대폰 포함)에서 주소만 초기평가를 돌린다. (2026-09-29)
//
// 사용자 결정(2026-09-29): 유료 API 대신 **각자 AI 요금제**로. 웹 검색·채점은 사용자 AI가 하고, 이 서버는
//   1) get_site_data            주소 → 자동수집(카카오·SGIS·소상공인365, AI 호출 없음) + 채점 기준을 돌려준다
//   2) submit_location_scores   AI가 매긴 입지 7항목 → 주소만평가와 **같은 계산**(quickEvalCompute) → 예상매출·판정
// 두 단계 사이의 자료와 결과는 quickEvalChatRuns/{runId}에 남긴다(사용자 확정 2026-09-29 "저장은 하는 걸로") —
// 나중에 모델끼리(Opus·Astra 등) 성적을 비교하려고 모델 이름을 같이 적는다(AI가 스스로 적은 값이라 참고용).
//
// 인증: OAuth(회사 구글 계정) — src/lib/server/mcpOAuth.ts. 토큰 없는 호출은 401 + 메타데이터 주소를 돌려준다.
// ⚠️ Firebase 무료 요금제 — 학습 자료 읽기(약 1,300건)는 10분 메모리 캐시(quickEvalTraining.ts).
import { randomBytes } from "node:crypto";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAccessToken, type McpUser } from "@/lib/server/mcpOAuth";
import { loadQuickEvalTraining } from "@/lib/server/quickEvalTraining";
import {
  INFLOW_LEVELS, LOCATION_EVAL_FIELD_DESCRIPTIONS, SPECIAL_DEMAND_INTENSITIES, SPECIAL_DEMAND_TYPES,
} from "@/lib/storeEval/locationEvalAi";
import { collectQuickEvalSite } from "@/lib/storeEval/quickEval/quickEvalCollectSite";
import { computeQuickEval, type QuickEvalComputePayload } from "@/lib/storeEval/quickEval/quickEvalCompute";
import {
  buildResultSummary, buildScoringBrief, chatPlanInput, QUICK_EVAL_CHAT_COLLECTION, type ChatPlanArgs,
} from "@/lib/storeEval/quickEval/quickEvalChat";

// 소상공인365 유동인구 6반경 스크래핑이 반경당 약 4초 — 자료 받기가 30~60초 걸린다.
export const maxDuration = 300;

const D = LOCATION_EVAL_FIELD_DESCRIPTIONS;
const score = (key: keyof typeof D) => z.number().int().min(1).max(5).nullable().describe(D[key]);

const userOf = (authInfo: { extra?: Record<string, unknown> } | undefined): McpUser | null =>
  (authInfo?.extra?.user as McpUser | undefined) ?? null;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_site_data",
      {
        title: "입지평가 자료 받기",
        description:
          "PC방 후보지 주소로 입지평가를 시작한다. 주거인구·유동인구·반경 500m 경쟁 PC방·수요거점을 자동수집하고, " +
          "입지 7개 항목의 채점 기준과 평가 번호(runId)를 돌려준다. 30~60초 걸린다. " +
          "받은 뒤 웹 검색으로 그 주소를 조사하고 submit_location_scores로 점수를 내면 예상매출이 나온다. " +
          "PC대수·시간당 요금·층·엘리베이터를 모르면 비워 두면 기본값으로 계산한다.",
        inputSchema: z.object({
          address: z.string().min(2).describe("후보지 도로명주소(예: 충남 천안시 동남구 ○○로 123)"),
          pcCount: z.number().int().min(10).max(400).nullable().optional().describe("예정 PC 대수"),
          hourlyRate: z.number().int().min(500).max(5000).nullable().optional().describe("시간당 기본요금(원)"),
          floor: z.number().int().min(1).max(30).nullable().optional().describe("층수(지하 1층이면 1 + groundLevel 지하)"),
          groundLevel: z.enum(["지상", "지하"]).nullable().optional(),
          hasElevator: z.boolean().nullable().optional(),
        }),
      },
      async (args, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!user || !adminDb) return text("로그인 정보가 없습니다. 채팅 앱에서 아이센스 입지평가 연결을 다시 해 주세요.", true);
        const planArgs = args as ChatPlanArgs;
        const { plan, defaultsUsed } = chatPlanInput(planArgs);
        const site = await collectQuickEvalSite({
          address: plan.address, name: plan.name, floor: plan.floor, groundLevel: plan.groundLevel, hasElevator: plan.hasElevator,
        });
        if (!site.ok) return text(`자료 수집 실패: ${site.error}`, true);
        const runId = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
        const { contextText, errors, ...payload } = site.data;
        await adminDb.collection(QUICK_EVAL_CHAT_COLLECTION).doc(runId).set({
          runId,
          status: "collected",
          user,
          clientId: ctx.http?.authInfo?.clientId ?? null,
          address: plan.address,
          roadAddress: payload.geocode.roadAddress,
          plan,
          defaultsUsed,
          collectErrors: errors,
          // Firestore는 배열 안 배열·undefined를 못 받는다 — 수집 결과는 글(JSON)로 통째로 둔다.
          payloadJson: JSON.stringify(payload),
          contextText,
          createdAt: Date.now(),
        });
        return text(buildScoringBrief({ runId, contextText, collectErrors: errors }));
      },
    );

    server.registerTool(
      "submit_location_scores",
      {
        title: "입지 점수 내고 예상매출 받기",
        description:
          "get_site_data로 받은 runId와, 웹 검색으로 조사해 매긴 입지 7개 항목을 넣으면 주소만 초기평가 방식으로 " +
          "예상 월매출과 입점 가능여부를 계산해 돌려준다. 결과 요약은 사용자에게 그대로 보여주고, 내부 산식 이름은 쓰지 말 것.",
        inputSchema: z.object({
          runId: z.string().min(4),
          locationScore: score("locationScore"),
          preemptionScore: score("preemptionScore"),
          visibilityScore: score("visibilityScore"),
          specialDemandType: z.enum(SPECIAL_DEMAND_TYPES as [string, ...string[]]).nullable().describe(D.specialDemandType),
          specialDemandIntensity: z.enum(SPECIAL_DEMAND_INTENSITIES as [string, ...string[]]).nullable().describe(D.specialDemandIntensity),
          inflowRestriction: z.enum(INFLOW_LEVELS as [string, ...string[]]).nullable().describe(D.inflowRestriction),
          marketStructureMemo: z.string().max(1000).nullable().describe(D.marketStructureMemo),
          rationale: z.string().min(1).max(4000).describe("점수 전체의 근거(한국어)"),
          sources: z.array(z.string()).max(30).describe("조사에 참고한 웹 주소들. 검색을 안 했으면 빈 배열"),
          modelName: z.string().max(100).describe("지금 채점한 AI 모델 이름(예: Claude Opus 5.5, GPT-6 Astra)"),
        }),
      },
      async (args, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!user || !adminDb) return text("로그인 정보가 없습니다. 채팅 앱에서 아이센스 입지평가 연결을 다시 해 주세요.", true);
        const ref = adminDb.collection(QUICK_EVAL_CHAT_COLLECTION).doc(args.runId);
        const snap = await ref.get();
        if (!snap.exists) return text("해당 runId가 없습니다. get_site_data부터 다시 부르세요.", true);
        const run = snap.data() as { user: McpUser; address: string; plan: ReturnType<typeof chatPlanInput>["plan"]; defaultsUsed: string[]; collectErrors: string[]; payloadJson: string };
        if (run.user?.uid !== user.uid) return text("다른 사람이 시작한 평가입니다.", true);

        const fields = {
          locationScore: args.locationScore,
          preemptionScore: args.preemptionScore,
          visibilityScore: args.visibilityScore,
          specialDemandType: args.specialDemandType,
          specialDemandIntensity: args.specialDemandIntensity,
          inflowRestriction: args.inflowRestriction,
          marketStructureMemo: args.marketStructureMemo,
        };
        const training = await loadQuickEvalTraining();
        const computed = computeQuickEval({
          planInput: run.plan,
          payload: JSON.parse(run.payloadJson) as QuickEvalComputePayload,
          locationDraft: { fields },
          training,
        });
        const sources = args.sources.filter((s) => s.trim());
        const summary = buildResultSummary({
          address: run.address, computed, defaultsUsed: run.defaultsUsed ?? [], collectErrors: run.collectErrors ?? [],
          sourcesCount: sources.length, modelName: args.modelName || null,
        });
        await ref.update({
          status: "scored",
          scores: fields,
          rationale: args.rationale,
          sources,
          modelName: args.modelName || null,
          result: {
            verdict: summary.verdict,
            finalRevenue: summary.finalRevenue,
            finalSource: computed.final.source,
            finalReason: computed.final.reason,
            v62Final: computed.evaluated.v62Final,
            marketDemand: computed.evaluated.marketDemand,
            marketGrade: computed.evaluated.marketGrade,
            competitorCount: computed.built.competitorRows.filter((r) => r.counted).length,
          },
          scoredAt: Date.now(),
        });
        return text(summary.text);
      },
    );
  },
  {
    serverInfo: { name: "isens-location-eval", version: "1.0.0" },
    instructions:
      "아이센스 PC방 후보지 입지평가. 사용자가 주소를 주고 입지평가·예상매출을 물으면: " +
      "(1) get_site_data로 자료와 채점 기준을 받고 (2) 웹 검색으로 그 주소를 직접 조사한 뒤 " +
      "(3) submit_location_scores로 7개 항목을 내서 받은 결과 요약을 사용자에게 보여준다. 점수를 지어내지 말 것.",
  },
);

const authed = withMcpAuth(
  handler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    const v = await verifyAccessToken(bearer);
    if (!v) return undefined;
    return { token: bearer, clientId: v.clientId, scopes: v.scope.split(" "), expiresAt: Math.floor(v.expiresAt / 1000), extra: { user: v.user } };
  },
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" },
);

export { authed as GET, authed as POST, authed as DELETE };
