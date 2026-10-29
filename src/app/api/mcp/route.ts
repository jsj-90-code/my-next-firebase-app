// 채팅 입지평가 MCP 서버 — claude.ai·ChatGPT 채팅(휴대폰 포함)에서 주소만 초기평가를 돌린다. (2026-09-29)
// 2026-10-27부터 좌석배치도 AI 인식(책상·PC·좌석번호)도 이 커넥터로 한다(아래 좌석배치도 절, mcpSeatLayout.ts).
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
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAccessToken, type McpUser } from "@/lib/server/mcpOAuth";
import {
  findCandidates, isMcpOwner, loadCandidateLocationContext, saveCandidateLocationDraft,
} from "@/lib/server/mcpCandidateLocation";
import type { BracketDraftRow, DeskCountDraftRow, PcCountDraftRow } from "@/lib/seatLayout/chatDraft";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import { DESK_SIZE_OPTIONS } from "@/lib/seatLayout/constants";
import { buildBracketPrompt, buildRecognizePrompt, buildSeatNumberPrompt, compressRanges } from "@/lib/seatLayout/recognizePrompt";
import { buildSuggestZonesPrompt, SUGGEST_ZONES_IMAGE_LABELS, VALID_ZONE_TYPES } from "@/lib/seatLayout/suggestZonesPrompt";
import { zoneShapeKey, type DeskSize, type SeatLayoutProject } from "@/lib/seatLayout/types";
import { checkZoneDraft, FPS_MIN_SEATS } from "@/lib/seatLayout/zoneDraftCheck";
import {
  buildQuadrantImages, buildZoneCrops, buildZoneReferenceImage, loadSeatLayoutChatDraft, parseSeatNumbers,
  resolveSeatLayoutProject, saveSeatLayoutChatDraft,
} from "@/lib/server/mcpSeatLayout";
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

// 좌석배치도 커넥터를 한 번이라도 쓴 사람(문서 id = 소문자 이메일). 웹은 자기 문서만 읽는다(firestore.rules).
// 기록 실패는 도구 동작과 무관하므로 삼킨다.
const SEAT_CONNECTOR_USERS = "seatLayoutConnectorUsers";
async function markConnectorUse(user: McpUser) {
  if (!adminDb) return;
  try {
    await adminDb.collection(SEAT_CONNECTOR_USERS).doc(user.email.toLowerCase())
      .set({ email: user.email, name: user.name ?? null, lastUsedAt: Date.now() }, { merge: true });
  } catch {
    // 무시
  }
}

const userOf = (authInfo: { extra?: Record<string, unknown> } | undefined): McpUser | null =>
  (authInfo?.extra?.user as McpUser | undefined) ?? null;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

// 2026-09-29 사용자: 주소만 초기평가는 다른 직원과 공유, 정밀평가(V62·실험실)는 본인만 — **커넥터 하나로**.
// 로그인한 사람을 보고 서버를 둘 중 하나로 고른다(아래 authed): 본인이면 정밀평가 도구 3개가 더 **목록에 보인다**.
// 직원 공용: 주소만 평가 2개 + 좌석배치도 인식 4개(2026-10-27).
// 정밀평가 도구 안의 isMcpOwner 확인은 그대로 둔다(목록 숨김이 뚫려도 서버에서 한 번 더 막는 이중 잠금).
function registerTools(server: McpServer, owner: boolean) {
  {
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
          sourcesCount: sources.length, modelName: args.modelName || null, rationale: args.rationale,
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

    // ── 좌석배치도 AI 인식 (2026-10-27) — 웹 Gemini 버튼 3개(책상 인식·PC 수량·좌석번호)를 채팅으로 옮긴다.
    //    도면은 서버가 잘라 넘기고(mcpSeatLayout.ts), 채팅 AI가 본 결과는 **초안**(seatLayoutChatDrafts)으로만 저장한다 —
    //    웹 [채팅 결과 불러오기]에서 사람이 확인·적용하고 [저장]해야 반영된다. 지시문은 recognizePrompt.ts(예전 웹 버튼 문장).
    //    10-27 울산삼산점으로 책상·PC·좌석번호를 저장값과 대조해 전부 맞아서 **전 직원(회사 계정)에게 열고** 웹 Gemini 버튼은 지웠다.
    const seatOnly = "좌석배치도 채팅 인식은 회사 계정(@isens.camp)으로 연결해야 쓸 수 있습니다.";
    // 회사 계정이면 통과 + 커넥터를 쓴 사람으로 기록(웹 "작업 순서"가 처음 쓰는 사람에게만 연결 안내를 펼친다, 10-27).
    const seatAllowed = (user: McpUser | null): boolean => {
      if (!user || !isAllowedEmail(user.email)) return false;
      void markConnectorUse(user);
      return true;
    };
    const projectNameField = z.string().min(1).describe("좌석배치도 프로젝트(매장) 이름 일부(예: 울산삼산점)");
    const targetField = z.enum(["desk", "pc"]).describe("desk = 책상 발주 도면(책상 수량·사이즈·가방선반 브라켓), pc = PC 발주 도면(PC 대수)");
    const CROP_BATCH = 20;
    const webGuide = (tab: string) =>
      `웹 좌석배치도에서 이 프로젝트를 열고 [${tab}] 탭의 [채팅 결과 불러오기]를 누르면(웹에 이 프로젝트를 열어 두었으면 누르지 않아도 저절로) 확인 화면에 뜹니다. ` +
      "확인·수정 후 적용하고 [저장]을 눌러야 반영됩니다(자동 저장 아님). 사용자에게 이 안내와 결과표를 보여줄 것.";

    server.registerTool(
      "get_seat_layout_zone_crops",
      {
        title: "좌석배치도 존별 도면 받기",
        description:
          "좌석배치도 프로젝트의 저장된 존마다 도면을 잘라 이미지로 돌려준다(존 1개 = 이미지 1장) + 인식 지시문. " +
          "desk면 존마다 책상 수량·사이즈(820/850/910/950/1000mm)·가방선반 브라켓 수를, pc면 PC 대수를 세어 " +
          "submit_seat_layout_zone_counts로 낸다. 존이 20개를 넘으면 offset으로 나눠 받는다.",
        inputSchema: z.object({
          projectName: projectNameField,
          target: targetField,
          offset: z.number().int().min(0).optional().describe("존이 많을 때 몇 번째 존부터 받을지(0부터). 기본 0"),
        }),
      },
      async ({ projectName, target, offset = 0 }, ctx) => {
        if (!seatAllowed(userOf(ctx.http?.authInfo))) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          if (!project.floorPlanDataUrl) return text(`'${project.name}'에 도면 이미지가 없습니다.`, true);
          const zones = target === "desk" ? project.zones ?? [] : project.pcZones ?? [];
          if (!zones.length) {
            return text(`'${project.name}'에 ${target === "desk" ? "책상 발주" : "PC 발주"} 도면 존이 없습니다. 웹에서 존을 먼저 그려 저장해야 합니다.`, true);
          }
          const batch = zones.slice(offset, offset + CROP_BATCH);
          if (!batch.length) return text(`offset ${offset}부터는 존이 없습니다(전체 ${zones.length}개).`, true);
          const images = await buildZoneCrops(project.floorPlanDataUrl, batch);
          const more = offset + batch.length < zones.length;
          const intro =
            `프로젝트: ${project.name} · ${target === "desk" ? "책상 발주 도면" : "PC 발주 도면"} · 존 ${zones.length}개 중 ${offset + 1}~${offset + batch.length}번째\n` +
            "이미지 순서(이미지 k장 = 아래 k번 존을 잘라낸 것):\n" +
            batch.map((z, i) => `${i + 1}. ${z.name}`).join("\n") +
            "\n\n아래 지시문은 이미지 한 장(존 하나) 기준이다. 존마다 따로 적용해 submit_seat_layout_zone_counts의 rows에 존마다 넣어라" +
            (target === "desk" ? "(seats = sizeBreakdown 수량 합, bagShelfCount = 브라켓 표시가 있는 책상 수. 도면에 브라켓 표시가 아예 없거나 구분이 안 되면 null — 0과 다르다)" : "") +
            ". 판단이 애매한 존은 note에 적을 것.\n" +
            (more ? `존이 더 남았다 — 다 내면 offset ${offset + batch.length}로 다시 받아 이어서 하고, 그때는 append=true로 낸다.\n` : "") +
            `\n--- 인식 지시문 ---\n${buildRecognizePrompt(target)}`;
          return {
            content: [
              { type: "text" as const, text: intro },
              ...images.map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType })),
            ],
          };
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    server.registerTool(
      "submit_seat_layout_zone_counts",
      {
        title: "좌석배치도 존별 인식 결과 내기",
        description:
          "get_seat_layout_zone_crops로 보고 센 존별 결과를 **초안**으로 저장한다. 프로젝트는 고치지 않는다 — 웹 [채팅 결과 불러오기]에서 " +
          "사람이 확인·적용·저장한다.",
        inputSchema: z.object({
          projectName: projectNameField,
          target: targetField,
          rows: z.array(z.object({
            zoneName: z.string().min(1).describe("존 이름(받은 목록 그대로)"),
            seats: z.number().int().min(0).describe("desk = 책상 수, pc = PC 대수"),
            sizeBreakdown: z.array(z.object({
              deskSize: z.enum(DESK_SIZE_OPTIONS as [DeskSize, ...DeskSize[]]),
              qty: z.number().int().min(1),
            })).optional().describe("desk만: 사이즈별 책상 수. 합이 seats와 같아야 한다"),
            bagShelfCount: z.number().int().min(0).nullable().optional().describe(
              "desk만: 가방선반 브라켓 표시(주황/빨간 점·선)가 있는 책상 수. 표시를 그리는 도면인데 이 존엔 없으면 0. " +
              "도면에 브라켓 표시가 아예 없거나 해상도 때문에 구분이 안 되면 null(웹에서 지금 값을 그대로 둔다)",
            ),
          })).min(1),
          append: z.boolean().optional().describe("true면 이전 초안에 이어 붙인다(존이 많아 나눠 낼 때 두 번째부터)"),
          note: z.string().max(2000).nullable().optional().describe("애매했던 존·확인이 필요한 점(한국어)"),
          modelName: z.string().max(100).describe("지금 인식한 AI 모델 이름"),
        }),
      },
      async ({ projectName, target, rows, append, note, modelName }, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!seatAllowed(user)) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          const zoneNames = new Set((target === "desk" ? project.zones ?? [] : project.pcZones ?? []).map((z) => z.name));
          const problems: string[] = [];
          for (const row of rows) {
            if (!zoneNames.has(row.zoneName)) problems.push(`'${row.zoneName}'은 이 도면에 없는 존 이름`);
            if (target === "desk") {
              const sum = (row.sizeBreakdown ?? []).reduce((s, b) => s + b.qty, 0);
              if (!row.sizeBreakdown?.length) problems.push(`${row.zoneName}: sizeBreakdown이 없음`);
              else if (sum !== row.seats) problems.push(`${row.zoneName}: 사이즈별 합 ${sum} ≠ seats ${row.seats}`);
              if ((row.bagShelfCount ?? 0) > row.seats) problems.push(`${row.zoneName}: 브라켓 수가 책상 수보다 많음`);
            }
          }
          if (problems.length) return text(`저장하지 않았습니다 — 고쳐서 다시 내 주세요:\n${problems.map((p) => `- ${p}`).join("\n")}`, true);

          const clean: (DeskCountDraftRow | PcCountDraftRow)[] = rows.map((row) =>
            target === "desk"
              ? { zoneName: row.zoneName, seats: row.seats, sizeBreakdown: row.sizeBreakdown ?? [], bagShelfCount: row.bagShelfCount ?? null }
              : { zoneName: row.zoneName, seats: row.seats },
          );
          let merged = clean;
          if (append) {
            const prev: (DeskCountDraftRow | PcCountDraftRow)[] = (await loadSeatLayoutChatDraft(project.id))?.[target]?.rows ?? [];
            merged = [...prev.filter((p) => !clean.some((c) => c.zoneName === p.zoneName)), ...clean];
          }
          await saveSeatLayoutChatDraft(project, target, { rows: merged }, { modelName: modelName || null, note: note ?? null, user });
          const missing = [...zoneNames].filter((n) => !merged.some((m) => m.zoneName === n));
          const table = merged
            .map((m) => {
              if (!("sizeBreakdown" in m)) return `- ${m.zoneName}: ${m.seats}대`;
              const sizes = m.sizeBreakdown.map((b) => `${b.deskSize} ${b.qty}`).join(", ");
              return `- ${m.zoneName}: ${m.seats}석 (${sizes}) · 브라켓 ${m.bagShelfCount ?? "판단 못 함(지금 값 유지)"}`;
            })
            .join("\n");
          return text(
            `${project.name} ${target === "desk" ? "책상" : "PC"} 인식 초안을 저장했습니다(존 ${merged.length}/${zoneNames.size}개, 합계 ${merged.reduce((s, m) => s + m.seats, 0)}).\n${table}\n` +
              (missing.length ? `\n아직 안 낸 존: ${missing.join(", ")}\n` : "") +
              `\n${webGuide(target === "desk" ? "책상 발주 도면" : "PC 발주 도면")}`,
          );
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    // ── 존 초안 (2026-10-27) — 도면 전체를 보고 존 구역 상자를 제안한다. 옛 웹 Gemini [구역 초안 제안] 버튼을 채팅으로.
    //    결과는 초안(seatLayoutChatDrafts.zones)만 — 웹 책상 발주 도면 탭 [채팅 존 초안 불러오기]에서 넣고 다듬어 저장한다.
    server.registerTool(
      "get_seat_layout_floorplan",
      {
        title: "좌석배치도 존 초안용 도면 받기",
        description:
          "좌석배치도 프로젝트의 책상 배치 도면 전체 1장 + 좌상·우상·좌하·우하 확대 4장과 존 초안 지시문을 돌려준다. " +
          "도면을 보고 존 구역 상자(위치·좌석 수)를 정해 submit_seat_layout_zone_draft로 낸다.",
        inputSchema: z.object({ projectName: projectNameField }),
      },
      async ({ projectName }, ctx) => {
        if (!seatAllowed(userOf(ctx.http?.authInfo))) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          if (!project.floorPlanDataUrl) {
            return text(`'${project.name}'에 도면 이미지가 없습니다. 웹에서 도면 PDF를 올리고 [프로젝트 저장]부터 해야 합니다.`, true);
          }
          const images = await buildQuadrantImages(project.floorPlanDataUrl);
          const existing = project.zones?.length
            ? `\n이미 그려진 책상 존 ${project.zones.length}개가 있다 — 그 구역은 빼고 아직 안 그려진 좌석만 제안하라:\n` +
              project.zones.map((zn) => `- ${zn.name} x=${zn.x.toFixed(3)} y=${zn.y.toFixed(3)} w=${zn.w.toFixed(3)} h=${zn.h.toFixed(3)}`).join("\n") +
              "\n"
            : "";
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `프로젝트: ${project.name} · 이미지 5장: ${SUGGEST_ZONES_IMAGE_LABELS.join(", ")}\n${existing}\n` +
                  `--- 존 초안 지시문 ---\n${buildSuggestZonesPrompt(true)}`,
              },
              ...images.map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType })),
            ],
          };
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    server.registerTool(
      "submit_seat_layout_zone_draft",
      {
        title: "좌석배치도 존 초안 내기",
        description:
          "get_seat_layout_floorplan으로 보고 정한 존 구역 상자들을 **초안**으로 저장한다. 프로젝트는 고치지 않는다 — 웹 책상 발주 도면 탭 " +
          "[채팅 존 초안 불러오기]에서 넣고 위치·이름을 다듬어 저장한다.",
        inputSchema: z.object({
          projectName: projectNameField,
          zones: z.array(z.object({
            seats: z.number().int().min(1).describe("구역 안 책상(좌석) 수"),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0.001).max(1),
            h: z.number().min(0.001).max(1),
            type: z.enum(VALID_ZONE_TYPES).nullable().optional().describe("방·VIP·프렌즈 등은 확신할 때만. 일반 줄·섬은 지시문의 하드웨어 사양 존 순서(fps→fc→lol→multi)대로 붙인다"),
          })).min(1).describe("위치는 ①번 전체 도면 기준 왼쪽 위 원점 0~1 비율"),
          note: z.string().max(2000).nullable().optional().describe("애매했던 구역·확인이 필요한 점(한국어)"),
          modelName: z.string().max(100).describe("지금 판단한 AI 모델 이름"),
        }),
      },
      async ({ projectName, zones, note, modelName }, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!seatAllowed(user)) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          // 도면 밖으로 삐져나간 상자는 도면 안으로 자른다.
          const rows = zones.map((zn) => ({
            seats: zn.seats,
            x: zn.x,
            y: zn.y,
            w: Math.max(0.001, Math.min(1 - zn.x, zn.w)),
            h: Math.max(0.001, Math.min(1 - zn.y, zn.h)),
            type: zn.type ?? null,
          }));
          // 10-29: 도면 PDF 책상 글씨로 상자마다 실제 좌석 수를 세어 돌려준다(zoneDraftCheck.ts). FPS가 실제 10석 미만이면
          // 존을 잘라 맞추지 말고 10석 이상인 한 줄로 다시 고르게 되돌린다(사용자 「FPS존은 최소 10개로, 구역은 안 나눠지면서」).
          const check = project.deskLabels?.desks?.length ? checkZoneDraft(rows, project.deskLabels) : null;
          // 10-30: 웹이 마지막 초안만 자동으로 넣도록(덮어쓸 초안을 먼저 넣으면 존이 두 번 들어감) — 아래에서 되돌리거나
          // 브라켓을 이어 셀 거면 아직 마지막이 아니다. 같은 조건을 아래 return들이 그대로 쓴다.
          const fpsOk = /10석 조합 없음/.test(note ?? "");
          const redo = (check?.fpsNotTen && !check.fpsShort && !fpsOk) || (check?.fpsShort && !fpsOk) || !!check?.vipMixed.length;
          const bracketsNext = !project.deskLabels?.brackets?.length && !!project.deskLabels?.widths?.length;
          await saveSeatLayoutChatDraft(project, "zones", { rows, final: !redo && !bracketsNext }, { modelName: modelName || null, note: note ?? null, user });
          const head =
            `${project.name} 존 초안 ${rows.length}개를 저장했습니다(좌석 합계 ${rows.reduce((s, zn) => s + zn.seats, 0)}` +
            (check ? ` · 도면 글씨로 센 실제 ${check.actual.reduce((s, n) => s + n, 0)}` : "") +
            ").\n" +
            rows
              .map((zn, i) =>
                `${i + 1}. ${zn.type ?? "유형 없음 → 웹에서 멀티존으로 넣음"} · ${zn.seats}석` +
                (check && check.actual[i] !== zn.seats ? ` → 실제 ${check.actual[i]}석` : ""),
              )
              .join("\n");
          // AI가 "정말 없다"고 확인했으면(note에 "10석 조합 없음", 위 fpsOk) 되돌리지 않는다 — 같은 답이 계속 되돌아오지 않게.
          const fpsConfirmed = fpsOk;
          if (check?.fpsNotTen && !check.fpsShort && !fpsConfirmed) {
            return text(
              `${head}\n\n⚠️ 아직 끝나지 않았다 — FPS존이 실제 ${check.fpsActual}석이다. 딱 10석이 먼저다: 딱 10석인 한 줄, 또는 서로 다른 섬의 ` +
                "한쪽 줄끼리 의자 쪽을 맞대고 나란히 붙은 두 줄(사이에 의자·통로만, 예: 5석 + 5석 — 한 섬에서 책상을 사이에 두고 마주 앉는 두 줄보다 먼저)의 합이 딱 10석인 조합이 있으면 그걸 FPS로 바꾸고(두 상자 모두 fps), " +
                "원래 FPS 줄은 다른 유형으로 돌려 submit_seat_layout_zone_draft로 다시 내라(덮어씀). 위 '실제' 좌석 수를 참고하라. " +
                "딱 10석 조합이 정말 없으면 지금 그대로 note에 \"10석 조합 없음\"을 적어 다시 내라.",
            );
          }
          if (check?.fpsShort && !fpsConfirmed) {
            return text(
              `${head}\n\n⚠️ 아직 끝나지 않았다 — FPS존이 실제로는 ${check.fpsActual}석이다(최소 ${FPS_MIN_SEATS}석). ` +
                `존을 잘라 붙여 맞추지 말고, 도면에서 실제 ${FPS_MIN_SEATS}석 이상인 한 줄(기둥 건너 이어지는 줄 포함, 딱 ${FPS_MIN_SEATS}석이 먼저)을 ` +
                "다시 찾아 FPS로 바꾸고, 원래 FPS로 잡았던 줄은 다른 유형으로 돌려 submit_seat_layout_zone_draft로 다시 내라(덮어씀). " +
                "위 '실제' 좌석 수를 참고하라. 그런 줄이 정말 없으면 지금 FPS를 그대로 두고 note에 \"10석 조합 없음\"과 이유를 적어 다시 내라.",
            );
          }
          if (check?.vipMixed.length) {
            return text(
              `${head}\n\n⚠️ 아직 끝나지 않았다 — VIP로 잡은 상자 ${check.vipMixed.join(", ")}번은 도면 글씨로 보면 1000mm 책상이 절반도 안 된다. ` +
                "VIP는 1000mm 책상이 모인 구역(같은 칸의 다른 폭 1~2석 포함)이다. 다른 폭(910 등)이 대부분인 줄은 VIP에서 빼 원래 유형" +
                "(칸막이로 몇 석씩 끊긴 줄이면 friends, 아니면 하드웨어 존)으로 잡고, 칸막이로 혼자 둘러싸인 1000mm 1석은 one_seat(1인석)으로 " +
                "따로 잡아 submit_seat_layout_zone_draft로 다시 내라(덮어씀).",
            );
          }
          // 10-29: 브라켓 도면 주황 선까지 읽었으면 수량·사이즈·브라켓 모두 웹이 도면 PDF로 센다 — 채팅은 여기서 끝.
          if (project.deskLabels?.brackets?.length) {
            return text(
              `${head}\n\n웹 좌석배치도에서 이 프로젝트를 열고 [책상 발주 도면] 탭의 [채팅 존 초안 불러오기]를 누르면(웹에 이 프로젝트를 열어 두었으면 누르지 않아도 저절로) 존이 들어가고, ` +
                "책상 수량·사이즈·가방 선반 브라켓은 웹이 도면 PDF로 바로 셉니다(존을 고쳐도 바로 다시 셈). 확인한 뒤 [확인하고 통합발주서 등록]. " +
                "사용자에게 이 안내를 보여줄 것.",
            );
          }
          // 도면 PDF 글씨 폭만 있으면(브라켓 주황 선은 못 읽음) 수량·사이즈는 웹이 세고, 같은 채팅에서 브라켓만 이어 센다.
          if (project.deskLabels?.widths?.length) {
            return text(
              `${head}\n\n아직 끝나지 않았다 — 사용자에게 묻지 말고 **바로 이어서** get_seat_layout_bracket_crops(source="draft")로 ` +
                "상자마다 잘린 도면을 받아 가방 선반 브라켓을 세고 submit_seat_layout_brackets(source=\"draft\")로 내라. " +
                "책상 수량·사이즈는 웹이 도면 PDF 글씨로 센다.",
            );
          }
          return text(
            `${head}\n\n웹 좌석배치도에서 이 프로젝트를 열고 [책상 발주 도면] 탭 존 목록의 [채팅 존 초안 불러오기]를 누르면(웹에 이 프로젝트를 열어 두었으면 누르지 않아도 저절로) 존으로 들어갑니다. ` +
              "상자 위치·이름·유형을 다듬고 [프로젝트 저장]한 뒤, 책상 수량·사이즈는 \"○○점 책상 인식해 줘\"로 채웁니다" +
              "(이 도면은 PDF 책상 글씨가 없어 웹이 자동으로 못 셉니다). 사용자에게 이 안내를 보여줄 것.",
          );
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    // ── 브라켓만 세기 (2026-10-29) — 책상 수량·사이즈는 웹이 도면 PDF 글씨로 세고(deskLabels.ts), 채팅은 브라켓만 본다.
    //    source=draft: 방금 낸 존 초안 상자들(같은 채팅에서 이어서). source=changed: 저장된 존 중 브라켓을 센 뒤 옮긴 존만
    //    (zoneShapeKey가 bagShelfKey와 다른 존 — 사용자가 존을 고친 뒤 "바뀐 존 브라켓 다시 세 줘").
    const sourceField = z.enum(["draft", "changed"]).describe("draft = 방금 낸 존 초안 상자, changed = 저장된 존 중 고쳐서 다시 세야 하는 존");
    type BracketTarget = { label: string; rect: { x: number; y: number; w: number; h: number } };
    const bracketTargets = async (project: SeatLayoutProject, source: "draft" | "changed"): Promise<BracketTarget[]> => {
      if (source === "draft") {
        const rows = (await loadSeatLayoutChatDraft(project.id))?.zones?.rows ?? [];
        return rows.map((r, i) => ({ label: `상자 ${i + 1}`, rect: r }));
      }
      return (project.zones ?? [])
        .filter((zn) => zn.bagShelfKey !== zoneShapeKey(zn))
        .map((zn) => ({ label: zn.name, rect: zn }));
    };
    // 도면 제목 옆 "브라켓 수량 90개"는 부품 개수(책상 경계마다 점 하나)라 브라켓 달린 책상 수와 다르다 — 검산에 쓰지 않는다
    // (10-29 평택: 부품 90 · 저장된 브라켓 달린 책상 59).

    server.registerTool(
      "get_seat_layout_bracket_crops",
      {
        title: "좌석배치도 브라켓 세기용 도면 받기",
        description:
          "존 상자마다 도면을 잘라 이미지로 돌려준다(상자 1개 = 이미지 1장) + 가방 선반 브라켓 세는 지시문. " +
          "책상 수량·사이즈는 웹이 도면 PDF 글씨로 세므로 브라켓만 센다. 결과는 submit_seat_layout_brackets로 낸다. 20개 넘으면 offset으로 나눠 받는다.",
        inputSchema: z.object({
          projectName: projectNameField,
          source: sourceField,
          offset: z.number().int().min(0).optional().describe("몇 번째부터 받을지(0부터). 기본 0"),
        }),
      },
      async ({ projectName, source, offset = 0 }, ctx) => {
        if (!seatAllowed(userOf(ctx.http?.authInfo))) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          if (!project.floorPlanDataUrl) return text(`'${project.name}'에 도면 이미지가 없습니다.`, true);
          const targets = await bracketTargets(project, source);
          if (!targets.length) {
            return text(
              source === "draft"
                ? `'${project.name}'에 존 초안이 없습니다. 먼저 get_seat_layout_floorplan → submit_seat_layout_zone_draft.`
                : `'${project.name}'에는 다시 셀 존이 없습니다(저장된 존 모두 브라켓을 센 모양 그대로). 웹에서 존을 고쳤다면 [프로젝트 저장]부터 해야 합니다.`,
              source === "draft",
            );
          }
          const batch = targets.slice(offset, offset + CROP_BATCH);
          if (!batch.length) return text(`offset ${offset}부터는 없습니다(전체 ${targets.length}개).`, true);
          const images = await buildZoneCrops(project.floorPlanDataUrl, batch.map((t) => t.rect));
          const more = offset + batch.length < targets.length;
          const intro =
            `프로젝트: ${project.name} · ${source === "draft" ? "존 초안 상자" : "다시 셀 존"} ${targets.length}개 중 ${offset + 1}~${offset + batch.length}번째\n` +
            "이미지 순서(이미지 k장 = 아래 k번):\n" +
            batch.map((t, i) => `${i + 1}. ${t.label}`).join("\n") +
            `\n\n결과는 submit_seat_layout_brackets(source="${source}")의 rows에 ` +
            (source === "draft" ? "box(상자 번호, 1부터)" : "zoneName(위 이름 그대로)") +
            "와 bagShelfCount로 넣어라." +
            (more ? ` 더 남았다 — 다 내면 offset ${offset + batch.length}로 다시 받아 이어서 하고, 그때는 append=true로 낸다.` : "") +
            `\n\n--- 지시문 ---\n${buildBracketPrompt()}`;
          return {
            content: [
              { type: "text" as const, text: intro },
              ...images.map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType })),
            ],
          };
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    server.registerTool(
      "submit_seat_layout_brackets",
      {
        title: "좌석배치도 브라켓 수 내기",
        description:
          "get_seat_layout_bracket_crops로 보고 센 상자·존별 가방 선반 브라켓 수를 **초안**으로 저장한다. 프로젝트는 고치지 않는다 — " +
          "웹 [채팅 결과 불러오기]에서 넣고 사람이 확인한다.",
        inputSchema: z.object({
          projectName: projectNameField,
          source: sourceField,
          rows: z.array(z.object({
            box: z.number().int().min(1).optional().describe("source=draft: 상자 번호(1부터, 받은 목록 그대로)"),
            zoneName: z.string().optional().describe("source=changed: 존 이름(받은 목록 그대로)"),
            bagShelfCount: z.number().int().min(0).nullable().describe("브라켓 표시가 있는 책상 수. 구분이 안 되면 null(0과 다르다)"),
          })).min(1),
          append: z.boolean().optional().describe("true면 이전 결과에 이어 붙인다(나눠 낼 때 두 번째부터)"),
          note: z.string().max(2000).nullable().optional().describe("애매했던 곳(한국어)"),
          modelName: z.string().max(100).describe("지금 센 AI 모델 이름"),
        }),
      },
      async ({ projectName, source, rows, append, note, modelName }, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!seatAllowed(user)) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          const meta = { modelName: modelName || null, note: note ?? null, user };
          const leftLine = (counted: number, all: number) =>
            counted < all ? `\n(아직 ${all - counted}개 남음 — 마저 받아 append=true로 낸다)` : "";

          if (source === "draft") {
            const draft = await loadSeatLayoutChatDraft(project.id);
            const zoneRows = draft?.zones?.rows ?? [];
            if (!zoneRows.length) return text("존 초안이 없습니다. 먼저 submit_seat_layout_zone_draft.", true);
            const bad = rows.filter((row) => !row.box || row.box > zoneRows.length).map((row) => String(row.box ?? "번호 없음"));
            if (bad.length) return text(`저장하지 않았습니다 — 없는 상자 번호: ${bad.join(", ")} (1~${zoneRows.length})`, true);
            const over = rows.filter((row) => (row.bagShelfCount ?? 0) > zoneRows[row.box! - 1].seats).map((row) => `상자 ${row.box}`);
            if (over.length) return text(`저장하지 않았습니다 — 브라켓 수가 좌석 수보다 많음: ${over.join(", ")}`, true);
            const next = zoneRows.map((zr, i) => {
              const hit = rows.find((row) => row.box === i + 1);
              // Firestore는 undefined 값을 못 쓴다 — 안 센 상자는 칸 없이 그대로 둔다.
              return hit ? { ...zr, bagShelfCount: hit.bagShelfCount } : zr;
            });
            const counted = next.filter((zr) => zr.bagShelfCount !== undefined).length;
            await saveSeatLayoutChatDraft(project, "zones", { rows: next, final: counted === next.length }, { ...meta, note: note ?? draft?.zones?.note ?? null });
            const sum = next.reduce((s, zr) => s + (zr.bagShelfCount ?? 0), 0);
            return text(
              `${project.name} 존 초안 ${next.length}개에 브라켓 수를 넣었습니다(센 상자 ${counted}개, 합계 ${sum}).\n` +
                next.map((zr, i) => `${i + 1}. ${zr.type ?? "유형 미정"} · ${zr.seats}석 · 브라켓 ${zr.bagShelfCount === undefined ? "아직" : zr.bagShelfCount ?? "판단 못 함"}`).join("\n") +
                leftLine(counted, next.length) +
                "\n\n웹 좌석배치도에서 이 프로젝트를 열고 [책상 발주 도면] 탭의 [채팅 존 초안 불러오기]를 누르면(웹에 이 프로젝트를 열어 두었으면 누르지 않아도 저절로) 존·책상 수량·사이즈·브라켓이 한 번에 들어갑니다. " +
                "상자를 고치면 그 존만 \"○○점 바뀐 존 브라켓 다시 세 줘\"로 다시 셉니다. 확인한 뒤 [확인하고 통합발주서 등록]. 사용자에게 이 안내를 보여줄 것.",
            );
          }

          const targets = (project.zones ?? []).filter((zn) => zn.bagShelfKey !== zoneShapeKey(zn));
          const bad = rows.filter((row) => !targets.some((t) => t.name === row.zoneName)).map((row) => row.zoneName ?? "이름 없음");
          if (bad.length) return text(`저장하지 않았습니다 — 다시 셀 목록에 없는 존: ${bad.join(", ")}`, true);
          const clean: BracketDraftRow[] = rows.map((row) => {
            const zn = targets.find((t) => t.name === row.zoneName)!;
            return { zoneName: zn.name, bagShelfCount: row.bagShelfCount, shapeKey: zoneShapeKey(zn) };
          });
          let merged = clean;
          if (append) {
            const prev = (await loadSeatLayoutChatDraft(project.id))?.brackets?.rows ?? [];
            merged = [...prev.filter((p) => !clean.some((c) => c.zoneName === p.zoneName)), ...clean];
          }
          await saveSeatLayoutChatDraft(project, "brackets", { rows: merged }, meta);
          const counted = targets.filter((t) => merged.some((m) => m.zoneName === t.name)).length;
          return text(
            `${project.name} 바뀐 존 브라켓을 저장했습니다(${counted}/${targets.length}개).\n` +
              merged.map((m) => `- ${m.zoneName}: 브라켓 ${m.bagShelfCount ?? "판단 못 함"}`).join("\n") +
              leftLine(counted, targets.length) +
              "\n\n웹 [책상 발주 도면] 탭 작업 순서의 [채팅 결과 불러오기]를 누르면(웹에 이 프로젝트를 열어 두었으면 누르지 않아도 저절로) 들어갑니다. 사용자에게 이 안내를 보여줄 것.",
          );
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    server.registerTool(
      "get_seat_number_data",
      {
        title: "좌석번호 매칭 자료 받기",
        description:
          "좌석배치도 프로젝트의 존 배치도(존마다 숫자 표시) 1장 + 피난안내도(좌석번호표) 전체·확대 4장 + 매칭 지시문을 돌려준다. " +
          "존마다 피난안내도의 좌석번호를 찾아 submit_seat_number_draft로 낸다.",
        inputSchema: z.object({ projectName: projectNameField }),
      },
      async ({ projectName }, ctx) => {
        if (!seatAllowed(userOf(ctx.http?.authInfo))) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          if (!project.floorPlanDataUrl) return text(`'${project.name}'에 도면 이미지가 없습니다.`, true);
          if (!project.seatNumberPlateDataUrl) {
            return text(`'${project.name}'에 피난안내도(좌석번호표)가 없습니다. 웹 좌석번호 탭에서 먼저 올려 저장해야 합니다.`, true);
          }
          // 웹과 같은 기준: PC 발주 도면 존이 있으면 그걸, 없으면 책상 존(SeatLayoutWorkspace getSeatNumberRecognitionZones).
          const zones = project.pcZones?.length ? project.pcZones : project.zones ?? [];
          if (!zones.length) return text(`'${project.name}'에 존이 없습니다. 웹에서 존을 먼저 그려 저장해야 합니다.`, true);
          const [reference, plates] = await Promise.all([
            buildZoneReferenceImage(project.floorPlanDataUrl, zones),
            buildQuadrantImages(project.seatNumberPlateDataUrl),
          ]);
          const intro =
            `프로젝트: ${project.name} · 이미지 6장: ①존 배치도, ②피난안내도 전체, ③좌상단 확대, ④우상단 확대, ⑤좌하단 확대, ⑥우하단 확대\n` +
            "①번 배치도의 박스에는 존 이름 대신 번호가 적혀 있다(서버에 한글 글꼴이 없어서). 번호 ↔ 존 이름:\n" +
            zones.map((z, i) => `${i + 1} = ${z.name} (${z.seats}석)`).join("\n") +
            "\n\n①번 배치도의 박스 번호는 위 표로 존 이름에 대응시켜라.\n" +
            `\n--- 매칭 지시문 ---\n${buildSeatNumberPrompt(zones.map((z) => ({ name: z.name, seats: z.seats })), true)}`;
          return {
            content: [
              { type: "text" as const, text: intro },
              ...[reference, ...plates].map((im) => ({ type: "image" as const, data: im.data, mimeType: im.mimeType })),
            ],
          };
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    server.registerTool(
      "submit_seat_number_draft",
      {
        title: "좌석번호 매칭 결과 내기",
        description:
          "get_seat_number_data로 찾은 존별 좌석번호를 **초안**으로 저장한다. 프로젝트는 고치지 않는다 — 웹 좌석번호 탭 [채팅 결과 불러오기]에서 " +
          "사람이 확인·적용·저장한다.",
        inputSchema: z.object({
          projectName: projectNameField,
          rows: z.array(z.object({
            zoneName: z.string().min(1).describe("존 이름(받은 표 그대로)"),
            numbers: z.string().min(1).describe("좌석번호 목록 또는 범위(예: \"1~10, 25~30\" 또는 \"1,2,3\")"),
            plateBox: z.object({
              x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.001).max(1), h: z.number().min(0.001).max(1),
            }).optional().describe("②번 피난안내도 전체 이미지에서 이 존 좌석번호들을 감싸는 상자(왼쪽 위 원점 0~1). 웹이 존 구역을 겹쳐 그리는 데 쓴다"),
          })),
          unsure: z.string().max(2000).optional().describe("어느 존에도 확신 있게 배정 못 한 번호들"),
          note: z.string().max(2000).nullable().optional(),
          modelName: z.string().max(100).describe("지금 매칭한 AI 모델 이름"),
        }),
      },
      async ({ projectName, rows, unsure, note, modelName }, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!seatAllowed(user)) return text(seatOnly, true);
        try {
          const r = await resolveSeatLayoutProject(projectName);
          if ("error" in r) return text(r.error);
          const { project } = r;
          const zones = project.pcZones?.length ? project.pcZones : project.zones ?? [];
          const unknown = rows.filter((row) => !zones.some((z) => z.name === row.zoneName)).map((row) => row.zoneName);
          if (unknown.length) {
            return text(`저장하지 않았습니다 — 이 도면에 없는 존 이름: ${unknown.join(", ")}. 받은 표의 이름 그대로 다시 내 주세요.`, true);
          }
          const clean = rows.map((row) => {
            const nums = parseSeatNumbers(row.numbers);
            return { zoneName: row.zoneName, ranges: compressRanges(nums), count: new Set(nums).size, plateRect: row.plateBox };
          });
          const unsureRanges = compressRanges(parseSeatNumbers(unsure ?? ""));
          await saveSeatLayoutChatDraft(
            project, "seatNumbers",
            // Firestore는 undefined를 못 쓴다 — 상자를 안 낸 존은 칸 없이.
            { rows: clean.map(({ zoneName, ranges, plateRect }) => ({ zoneName, ranges, ...(plateRect ? { plateRect } : {}) })), unsure: unsureRanges },
            { modelName: modelName || null, note: note ?? null, user },
          );
          const lines = clean.map((c) => {
            const seats = zones.find((z) => z.name === c.zoneName)?.seats ?? 0;
            return `- ${c.zoneName}: ${c.ranges} (${c.count}개${c.count !== seats ? ` ⚠️ 존 좌석 ${seats}석과 다름` : ""})`;
          });
          const missing = zones.filter((z) => !clean.some((c) => c.zoneName === z.name)).map((z) => z.name);
          // 10-29 호구포TEST: 앱이 예전 도구 목록을 기억해 plateBox 없이 냈다 → 웹이 피난안내도에 존을 못 겹쳤다. 3개 미만이면 되돌린다
          // (앱이 기억하는 목록에 칸이 없어도 서버는 받으므로, 이 안내를 보고 넣으면 된다).
          const boxed = clean.filter((c) => c.plateRect).length;
          if (project.seatNumberPlateDataUrl && clean.length >= 3 && boxed < 3) {
            return text(
              `${project.name} 좌석번호는 저장했지만 아직 끝나지 않았다 — rows의 존마다 plateBox가 빠졌다(${boxed}/${clean.length}). ` +
                "plateBox = ②번 피난안내도 전체 이미지에서 그 존 좌석번호들을 감싸는 상자 {x, y, w, h}(왼쪽 위 원점 0~1 비율). " +
                "도구 설명에 칸이 안 보여도 서버는 받는다. 같은 rows에 존마다 plateBox를 넣어 submit_seat_number_draft로 다시 내라(덮어씀). " +
                "웹이 이 상자들로 도면 존 구역을 피난안내도 위에 겹쳐 그린다.",
            );
          }
          return text(
            `${project.name} 좌석번호 초안을 저장했습니다(존 ${clean.length}/${zones.length}개).\n${lines.join("\n")}\n` +
              (missing.length ? `\n비운 존(사람이 직접 입력): ${missing.join(", ")}\n` : "") +
              (unsureRanges ? `배정 못 한 번호: ${unsureRanges}\n` : "") +
              `\n${webGuide("좌석번호")}`,
          );
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    if (!owner) return;
    // ── 신규후보지 정밀평가 입지 초안 (2026-09-29) — **사용자 본인만**(isMcpOwner). 다른 계정은 권한 없음으로 막는다.
    //    경쟁점 상세는 웹에서 입력하고, 채팅은 입지 7항목만. 결과는 웹 입지평가 탭 [채팅 초안 불러오기]로 검토 후 저장.
    const ownerOnly = "이 도구는 점포평가 담당자 전용입니다. 주소만 초기평가는 get_site_data를 쓰세요.";
    const scoreFields = {
      locationScore: score("locationScore"),
      preemptionScore: score("preemptionScore"),
      visibilityScore: score("visibilityScore"),
      specialDemandType: z.enum(SPECIAL_DEMAND_TYPES as [string, ...string[]]).nullable().describe(D.specialDemandType),
      specialDemandIntensity: z.enum(SPECIAL_DEMAND_INTENSITIES as [string, ...string[]]).nullable().describe(D.specialDemandIntensity),
      inflowRestriction: z.enum(INFLOW_LEVELS as [string, ...string[]]).nullable().describe(D.inflowRestriction),
      marketStructureMemo: z.string().max(1000).nullable().describe(D.marketStructureMemo),
    };
    const conf = z.number().min(0).max(1);

    server.registerTool(
      "find_candidate",
      {
        title: "신규후보지 찾기(담당자 전용)",
        description: "등록된 신규후보지를 이름·주소·코드 일부로 찾는다. 정밀평가 입지 초안을 만들기 전에 후보지 코드(N0xx)를 확인할 때 쓴다. 담당자 전용.",
        inputSchema: z.object({ query: z.string().describe("후보지 이름·주소·코드 일부(예: 풍세, N018)") }),
      },
      async ({ query }, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!isMcpOwner(user)) return text(ownerOnly, true);
        const list = await findCandidates(query);
        if (!list.length) return text(`'${query}'와 맞는 후보지가 없습니다.`);
        return text(list.map((c) => `${c.code} · ${c.name} · ${c.address}`).join("\n"));
      },
    );

    server.registerTool(
      "get_candidate_location_data",
      {
        title: "정밀평가 입지 자료 받기(담당자 전용)",
        description:
          "신규후보지 코드로, 웹에 등록된 경쟁점·수요거점과 입지 7항목 채점 기준을 돌려준다. 받은 뒤 웹 검색으로 조사하고 " +
          "submit_candidate_location_draft로 초안을 낸다. 담당자 전용.",
        inputSchema: z.object({ candidateCode: z.string().min(2).describe("후보지 코드(예: N018)") }),
      },
      async ({ candidateCode }, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!isMcpOwner(user)) return text(ownerOnly, true);
        try {
          const { candidate, contextText, hasSaved } = await loadCandidateLocationContext(candidateCode.trim().toUpperCase());
          return text(
            `후보지: ${candidate.code} · ${candidate.name} · ${candidate.roadAddress ?? candidate.address}\n\n` +
              buildScoringBrief({ runId: "", contextText, collectErrors: [], candidate: { code: candidate.code, hasSaved } }),
          );
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );

    server.registerTool(
      "submit_candidate_location_draft",
      {
        title: "정밀평가 입지 초안 내기(담당자 전용)",
        description:
          "웹 검색으로 조사해 매긴 입지 7항목을 신규후보지의 **초안**으로 저장한다. 저장된 입지평가를 덮지 않고, 담당자가 웹 입지평가 탭의 " +
          "[채팅 초안 불러오기]에서 검토·수정해 저장한다. 담당자 전용.",
        inputSchema: z.object({
          candidateCode: z.string().min(2),
          ...scoreFields,
          confidence: z.object({
            locationScore: conf, preemptionScore: conf, visibilityScore: conf, specialDemandType: conf,
            specialDemandIntensity: conf, inflowRestriction: conf, marketStructureMemo: conf,
          }).describe("항목별 자기 확신도 0~1. 0.8 미만 항목은 웹 승인 화면에서 기본 체크 해제된다"),
          rationale: z.string().min(1).max(4000).describe("점수 전체의 근거(한국어)"),
          sources: z.array(z.string()).max(30).describe("조사에 참고한 웹 주소들"),
          modelName: z.string().max(100).describe("지금 채점한 AI 모델 이름"),
        }),
      },
      async (args, ctx) => {
        const user = userOf(ctx.http?.authInfo);
        if (!isMcpOwner(user) || !user) return text(ownerOnly, true);
        const code = args.candidateCode.trim().toUpperCase();
        try {
          await loadCandidateLocationContext(code); // 후보지가 있는지 확인(없는 코드에 초안을 만들지 않는다)
          const { candidateCode: _c, confidence, rationale, sources, modelName, ...fields } = args;
          await saveCandidateLocationDraft({
            code, fields, confidence, rationale, sources: sources.filter((s) => s.trim()), modelName: modelName || null, user,
          });
          return text(
            `${code} 입지평가 초안을 저장했습니다. 웹 신규후보지 > ${code} > 입지평가 탭에서 [채팅 초안 불러오기]를 누르면 ` +
              "승인 화면에 뜹니다. 확인·수정 후 적용하고 [저장]을 눌러야 반영됩니다(자동 저장 아님). 사용자에게 이 안내와 점수표를 보여줄 것.",
          );
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
      },
    );
  }
}

const PUBLIC_INSTRUCTIONS =
  "아이센스 PC방 후보지 입지평가. 사용자가 주소를 주고 입지평가·예상매출을 물으면: " +
  "(1) get_site_data로 자료와 채점 기준을 받고 (2) 웹 검색으로 그 주소를 직접 조사한 뒤 " +
  "(3) submit_location_scores로 7개 항목을 내서 받은 결과 요약을 사용자에게 보여준다. 점수를 지어내지 말 것." +
  " 사용자가 좌석배치도 매장(프로젝트)의 존 초안·책상 인식·PC 대수·좌석번호 매칭을 요청하면: 존 초안은 get_seat_layout_floorplan → submit_seat_layout_zone_draft " +
  "(답에 이어서 하라고 나오면 같은 채팅에서 get_seat_layout_bracket_crops(source=draft) → submit_seat_layout_brackets까지), " +
  "\"바뀐 존 브라켓 다시 세 줘\"는 get_seat_layout_bracket_crops(source=changed) → submit_seat_layout_brackets, " +
  "책상·PC 인식(PDF 글씨 없는 옛 도면)은 get_seat_layout_zone_crops → 존마다 세기 → submit_seat_layout_zone_counts, " +
  "좌석번호는 get_seat_number_data → submit_seat_number_draft. 결과는 초안이라 웹에서 확인·저장한다.";

const publicHandler = createMcpHandler((server) => registerTools(server, false), {
  serverInfo: { name: "isens-location-eval", version: "1.2.0" },
  instructions: PUBLIC_INSTRUCTIONS,
});
const ownerHandler = createMcpHandler((server) => registerTools(server, true), {
  serverInfo: { name: "isens-location-eval", version: "1.2.0" },
  instructions:
    PUBLIC_INSTRUCTIONS +
    " 사용자가 등록된 신규후보지(코드 N0xx 또는 후보지 이름)의 입지평가 초안·정밀평가 입지를 요청하면: find_candidate로 코드 확인 → " +
    "get_candidate_location_data → 웹 검색 조사 → submit_candidate_location_draft.",
});

const authed = withMcpAuth(
  (req) => (isMcpOwner(userOf(req.auth)) ? ownerHandler : publicHandler)(req),
  async (_req, bearer) => {
    if (!bearer) return undefined;
    const v = await verifyAccessToken(bearer);
    if (!v) return undefined;
    return { token: bearer, clientId: v.clientId, scopes: v.scope.split(" "), expiresAt: Math.floor(v.expiresAt / 1000), extra: { user: v.user } };
  },
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" },
);

export { authed as GET, authed as POST, authed as DELETE };
