import "server-only";

// 커넥터(/api/mcp)에 경쟁점 가동률 측정기 도구를 붙인다(2026-11-15). 몸통은 mcpPingMonitor.ts.
// 회사 계정(@isens.camp)만 쓴다. 읽기 3개(ping_overview·ping_store·ping_area)는 IP가 없어 아티팩트 "결과 공유"에 넣을 수 있고,
// 나머지(IP·쓰기)는 부르는 사람 본인 커넥터로만 — 결과 공유에 넣지 말 것.
// 모두 짧게 끝난다(1214f81: 오래 붙잡는 요청 금지). 지금 확인만 최대 25초.

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import type { McpUser } from "@/lib/server/mcpOAuth";
import {
  pingArea,
  pingDeleteStore,
  pingFormOptions,
  pingNearby,
  pingOverview,
  pingOwnRegister,
  pingProbe,
  pingSaveStore,
  pingStoreDetail,
  pingStorePrivate,
  pingTransferOwn,
  PingToolError,
} from "./mcpPingMonitor";

type Ctx = { http?: { authInfo?: { extra?: Record<string, unknown> } } };
const userOf = (ctx: Ctx): McpUser | null => (ctx.http?.authInfo?.extra?.user as McpUser | undefined) ?? null;

const DENIED = "경쟁점 가동률 측정기는 회사 계정(@isens.camp)으로 연결해야 쓸 수 있습니다.";

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], structuredContent: { error: message }, isError: true };
}
function ok(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}

/** 회사 계정 확인 → 실행 → JSON. 예상한 실패(PingToolError)는 그 문장, 그 밖은 짧은 안내 + 서버 로그. */
async function run(ctx: Ctx, fn: (user: McpUser) => Promise<Record<string, unknown>>) {
  const user = userOf(ctx);
  if (!user || !isAllowedEmail(user.email)) return err(DENIED);
  try {
    return ok(await fn(user));
  } catch (e) {
    if (e instanceof PingToolError) return err(e.message);
    console.error("ping tool 실패:", e);
    return err(`측정기 자료를 처리하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD(한국 날짜)");
const READ = { readOnlyHint: true, openWorldHint: false } as const;

export function registerPingTools(server: McpServer) {
  server.registerTool(
    "ping_overview",
    {
      title: "경쟁점 가동률 — 전체 목록",
      description:
        "경쟁점 가동률 측정기의 측정 중인 매장 전부를 한 번에 돌려준다(IP 없음). 매장마다 상태(측정 중·IP 미등록·포트 조회 실패·IP대역 재확인 등, 이유 hint)·" +
        "실시간·오늘(진행 중)·최근 24시간·지난주·이번주·지난달·이달·최근 30일 가동률(util 0~1, 평균 켜진 대수 avgOn, 다 찬 날 수 days)·최근 14일 추세(spark)·" +
        "우리 매장 묶음(ownCode·ownName), 겹친 등록, 최근 24시간 중 측정 빠진 시각(missedHours), 기간 정의(ranges)·계산 규칙(rules). " +
        "가동률 = 켜진 PC 수 ÷ 대수, 다 찬 날(하루 20시간 이상 잰 날)의 일일평균. 값이 null이면 그 상태에선 값을 쓰지 않는다는 뜻.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    async (_args, ctx) => run(ctx as Ctx, () => pingOverview()),
  );

  server.registerTool(
    "ping_store",
    {
      title: "경쟁점 가동률 — 매장 상세",
      description:
        "측정기 매장 하나의 기간 가동률·날짜별(요일·공휴일·측정 횟수·평균 켜진 대수·다 찬 날 여부·시간대 24칸)·시간대별(전체·평일·주말) 프로필·조사 메모(IP 가림)·" +
        "최근 측정·상태를 돌려준다(IP 없음). from·to를 비우면 이번 주(월~일). 한 번에 400일까지. 가동률이 왜 바뀌었는지 볼 때 날짜별·시간대별을 비교한다.",
      inputSchema: z.object({
        id: z.string().min(1).describe("측정기 매장 id(ping_overview의 stores[].id)"),
        from: date.optional(),
        to: date.optional(),
      }),
      annotations: READ,
    },
    async (args, ctx) => run(ctx as Ctx, () => pingStoreDetail(args.id, args.from, args.to)),
  );

  server.registerTool(
    "ping_area",
    {
      title: "경쟁점 가동률 — 상권 비교",
      description:
        "우리 매장 하나(기존점 가맹점코드·후보지 N0xx·직접 입력 묶음)와 그 경쟁점들을 나란히 — 표(오늘·24시간·이번 주·최근 30일 등), " +
        "기간 날짜별 하루 가동률 선(daily, 매장 id별), 기간 시작~오늘 시간대별 선(hourly). IP 없음. from·to를 비우면 이번 주(월~일).",
      inputSchema: z.object({
        ownCode: z.string().min(1).describe("우리 매장 코드(ping_overview의 groups[].code 또는 stores[].ownCode)"),
        from: date.optional(),
        to: date.optional(),
      }),
      annotations: READ,
    },
    async (args, ctx) => run(ctx as Ctx, () => pingArea(args.ownCode, args.from, args.to)),
  );

  server.registerTool(
    "ping_form_options",
    {
      title: "경쟁점 가동률 — 등록 칸 고르기 자료",
      description: "경쟁점 등록·수정 칸의 '우리 매장' 목록(기존점·후보지·직접 입력 묶음, 좌표 포함)과, ownCode를 주면 그 매장에 점포평가로 등록된 경쟁점(상호·주소·대수·거리).",
      inputSchema: z.object({ ownCode: z.string().optional().describe("고른 우리 매장 코드") }),
      annotations: READ,
    },
    async (args, ctx) => run(ctx as Ctx, () => pingFormOptions(args.ownCode)),
  );

  server.registerTool(
    "ping_nearby",
    {
      title: "경쟁점 가동률 — 주변 PC방",
      description: "좌표나 주소 기준 반경 1km 안의 PC방(카카오, 이름 거름 — 이미 측정기에 있으면 registered 표시)과 측정기 등록 매장, demand=true면 수요거점까지. map=true면 카카오 지도 바탕 그림(map.image, data URL PNG 1000px)과 점마다 그림 위 픽셀 좌표(px·py)를 함께 준다(못 받으면 map:null·mapError).",
      inputSchema: z.object({
        lat: z.number().optional(),
        lng: z.number().optional(),
        address: z.string().optional(),
        demand: z.boolean().optional(),
        map: z.boolean().optional().describe("true면 카카오 지도 바탕 그림과 픽셀 좌표를 함께"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, ctx) => run(ctx as Ctx, () => pingNearby(args)),
  );

  server.registerTool(
    "ping_store_private",
    {
      title: "경쟁점 가동률 — 수정 칸(IP 포함)",
      description: "매장 하나의 IP대역·원래 메모·복사용 메모·최근 응답 IP. 수정 화면 전용 — 측정 대상 IP라 사내에서만 다룬다.",
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: READ,
    },
    async (args, ctx) => run(ctx as Ctx, () => pingStorePrivate(args.id)),
  );

  server.registerTool(
    "ping_save_store",
    {
      title: "경쟁점 가동률 — 등록·수정",
      description:
        "경쟁점을 새로 등록하거나(id 없음) 고친다(id). 웹과 같은 검사: IP 형식·다른 등록과 IP/주소 겹침(막음)·같은 건물 다른 층 확인(confirmOtherFloor)·" +
        "직접 입력 상권이 500m 안 다른 묶음과 가까우면 확인(confirmOtherArea)·새 등록은 위치 필수. dryRun=true면 저장하지 않고 검사 결과(check)만. " +
        "problems가 비어야 저장된다. 사용자가 저장을 요청했을 때만 dryRun 없이 부를 것.",
      inputSchema: z.object({
        id: z.string().optional().describe("고칠 매장 id. 없으면 새 등록"),
        name: z.string().describe("상호"),
        address: z.string().optional(),
        ipRanges: z.string().describe("IP대역(여러 개면 쉼표·줄바꿈)"),
        pcCount: z.number().int().nullable().optional().describe("PC 대수. 비우면 IP 개수"),
        memo: z.string().optional(),
        active: z.boolean().optional().describe("1시간마다 측정(끄면 측정만 멈춤)"),
        ownCode: z.string().nullable().optional().describe("우리 매장 코드"),
        customKind: z.enum(["기존점", "후보지"]).nullable().optional().describe("점포평가에 없는 우리 매장을 이름으로 묶을 때"),
        customName: z.string().nullable().optional(),
        competitorId: z.string().nullable().optional().describe("점포평가 경쟁점 id(고른 경우)"),
        lat: z.number().nullable().optional(),
        lng: z.number().nullable().optional(),
        confirmOtherFloor: z.boolean().optional(),
        confirmOtherArea: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx) => run(ctx as Ctx, (user) => pingSaveStore(args, user.email ?? null)),
  );

  server.registerTool(
    "ping_probe",
    {
      title: "경쟁점 가동률 — 지금 확인",
      description: "IP대역이 지금 대답하는지 TCP 80번으로 한 번 두드려 본다(기록 안 남김, 최대 25초). 정기 측정(핑·80번)과 결과가 다를 수 있다.",
      inputSchema: z.object({ ipRanges: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, ctx) => run(ctx as Ctx, () => pingProbe(args.ipRanges)),
  );

  server.registerTool(
    "ping_delete_store",
    {
      title: "경쟁점 가동률 — 경쟁점 삭제",
      description: "잘못 넣은 경쟁점 등록을 측정 기록째 지운다(지운 정보는 따로 남김). 우리 매장 줄은 못 지운다. confirmName에 매장 이름을 정확히 넣어야 한다. 사용자가 명시적으로 지우라고 했을 때만.",
      inputSchema: z.object({ id: z.string().min(1), confirmName: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, ctx) => run(ctx as Ctx, (user) => pingDeleteStore(args.id, args.confirmName, user.email ?? null)),
  );

  server.registerTool(
    "ping_own_register",
    {
      title: "경쟁점 가동률 — 우리 매장 IP 등록",
      description: "점포평가 기존점(개점 매장)의 우리 매장 PC IP대역을 측정기에 등록한다. 매장마다 한 줄, 다른 등록과 IP가 겹치면 막는다.",
      inputSchema: z.object({ ownCode: z.string().min(1), ipRanges: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args, ctx) => run(ctx as Ctx, (user) => pingOwnRegister(args.ownCode, args.ipRanges, user.email ?? null)),
  );

  server.registerTool(
    "ping_transfer_own",
    {
      title: "경쟁점 가동률 — 직접 입력 묶음 옮기기",
      description: "이름만 적어 둔 우리 매장 묶음(직접기존:·직접후보:)을 점포평가 매장으로 통째로 옮긴다. 측정 기록은 이어진다.",
      inputSchema: z.object({ fromCode: z.string().min(1), toCode: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args, ctx) => run(ctx as Ctx, (user) => pingTransferOwn(args.fromCode, args.toCode, user.email ?? null)),
  );
}

export const PING_INSTRUCTIONS =
  " 경쟁점 가동률 측정기(회사 계정): 전체 목록·상태는 ping_overview, 매장 하나의 날짜별·시간대별은 ping_store, 우리 매장과 경쟁점 비교는 ping_area." +
  " 등록·수정은 ping_save_store(먼저 dryRun으로 검사), IP 확인은 ping_store_private·ping_probe. 경쟁점 IP는 사내 정보라 밖으로 옮기지 않는다.";
