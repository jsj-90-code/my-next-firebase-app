import "server-only";
// 채팅 입지평가 — **신규후보지 정밀평가의 입지 7항목 초안**을 사용자 AI(채팅)로 받는다. (2026-09-29)
//
// 사용자 결정(2026-09-29):
//   - 경쟁점 상세 조사는 웹에서 입력하고, 채팅은 입지 7항목만 맡는다.
//   - 결과는 웹 입지평가 탭에 **초안**으로 들어가고, 사람이 승인 화면(LocationEvalAiReviewPanel)에서 검토·수정해 저장한다.
//     초안이 저장값을 몰래 덮지 않는다(2026-08-22 "AI 결과는 자동저장하지 않는다" 원칙 그대로).
//   - V62 정밀평가·실험실은 **사용자 본인만** 쓴다 → 이 도구들은 MCP_OWNER_EMAILS만 통과. 설정 화면 없이 기본값으로 본인만.
//
// 자료는 웹 "AI로 초안 채우기"(api/store-eval/ai-location-eval)와 **같은 묶음**이다: 후보지 문서 + 그 후보지 경쟁점 + 수요거점
// → buildLocationEvalContext. 채점 기준도 같은 문장(locationEvalAi.ts). 다른 건 채점하는 AI뿐(제미나이 → 사용자 AI).
// 단 2026-10-15부터 채팅엔 "경쟁점 상세"(웹에 입력한 대수·층·조사 메모·카카오 장소 링크)를 더 붙인다 — competitorDetailText 주석.
import { adminDb } from "@/lib/firebase-admin";
import { buildLocationEvalContext } from "@/lib/storeEval/locationEvalContext";
import { appendSiteFactsToContext } from "@/lib/storeEval/quickEval/quickEvalLocationContext";
import type { CandidateInput, Competitor, DemandPoint } from "@/lib/storeEval/types";
import type { McpUser } from "./mcpOAuth";

/** 정밀평가 도구를 쓸 수 있는 사람. 환경변수 MCP_OWNER_EMAILS(쉼표 구분)가 있으면 그걸 쓴다. */
const DEFAULT_OWNER_EMAILS = ["jsj-90@isens.camp"];

export function isMcpOwner(user: McpUser | null): boolean {
  if (!user?.email) return false;
  const list = (process.env.MCP_OWNER_EMAILS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_OWNER_EMAILS)
    .map((s) => s.toLowerCase());
  return list.includes(user.email.toLowerCase());
}

/** 웹 승인 화면이 읽는 초안 문서. 후보지마다 마지막 초안 1건(덮어쓴다). 브라우저는 읽기만, 쓰기는 서버만(firestore.rules). */
export const LOCATION_CHAT_DRAFTS = "storeEvalLocationChatDrafts";

function db() {
  if (!adminDb) throw new Error("서버 Firebase 설정이 없습니다.");
  return adminDb;
}

export async function findCandidates(query: string): Promise<{ code: string; name: string; address: string }[]> {
  const q = query.replace(/\s+/g, "").toLowerCase();
  const snap = await db().collection("storeEvalCandidates").get();
  return snap.docs
    .map((d) => d.data() as CandidateInput)
    .filter((c) => !q || [c.code, c.name, c.address, c.roadAddress].some((v) => v?.replace(/\s+/g, "").toLowerCase().includes(q)))
    .slice(0, 20)
    .map((c) => ({ code: c.code, name: c.name, address: c.roadAddress ?? c.address }));
}

const DETAIL_RADIUS_M = 1000;
const DETAIL_MAX = 10;

/**
 * 웹에 입력된 경쟁점 상세를 채팅 문맥에 덧붙인다(2026-10-15 군산점 N024).
 * buildLocationEvalContext는 경쟁점을 "이름 (거리)"만 적는다 — 그래서 채팅 AI가 대수·조사 메모·주소를 못 받고 "티티PC 층 확인 불가"라고 했다.
 * 공용 함수는 웹 AI 초안·주소만 초기평가·되짚기 검증이 같이 써서(바꾸면 검증해 둔 성적이 움직인다) 여기, 채팅 경로에만 붙인다.
 * 빈 칸은 "미입력"으로 적어 AI가 그 칸만 찾아보게 한다. 카카오 장소 페이지 주소엔 층이 적혀 있는 경우가 많다(예: 퀸PC "월명로 255 4층").
 */
function competitorDetailText(competitors: Competitor[]): string {
  const near = competitors
    .filter((c) => c.distanceM != null && c.distanceM <= DETAIL_RADIUS_M && c.investigationStatus !== "경쟁점없음")
    .sort((a, b) => a.distanceM! - b.distanceM!)
    .slice(0, DETAIL_MAX);
  if (!near.length) return "";
  const score = (v: number | null | undefined) => (v == null ? "미입력" : String(v));
  const lines = near.map((c) => {
    const floor = c.floor == null ? "매장 층 미입력" : `${c.groundLevel === "지하" ? "지하" : "지상"} ${c.floor}층`;
    const pc = c.totalPcCount ?? c.appliedPcCount;
    const pcText = pc != null ? `${pc}대` : c.permitHint?.suggestedPcCount != null ? `대수 미입력(인허가 게임기 ${c.permitHint.suggestedPcCount}대)` : "대수 미입력";
    const parts = [
      `- ${c.name} (${c.distanceM}m) · ${floor} · ${pcText}`,
      `  엘리베이터 ${c.hasElevator == null ? "미입력" : c.hasElevator ? "있음" : "없음"}${c.elevatorBasis ? ` — ${c.elevatorBasis}(건물 전체 층수이지 매장 층이 아님)` : ""}`,
      `  인테리어 ${score(c.interiorScore)} · 관리 ${score(c.managementScore)} · 먹거리 ${c.foodBrand ?? score(c.foodScore)} (1~5점, 현장조사)`,
    ];
    const memo = (c.interiorBasis ?? "").replace(/\s+/g, " ").trim();
    if (memo) parts.push(`  조사 메모: ${memo.slice(0, 300)}`);
    if (c.sourcePlaceId) parts.push(`  카카오 장소(주소·층 확인용): https://place.map.kakao.com/${c.sourcePlaceId}`);
    return parts.join("\n");
  });
  return [
    "",
    `[경쟁점 상세 — 웹에 입력된 값 (${DETAIL_RADIUS_M / 1000}km 안 가까운 ${near.length}곳)]`,
    ...lines,
    "※ '미입력'인 칸만 카카오 장소 페이지·웹 검색으로 보완하고, 입력된 값은 그대로 믿을 것. 선점경쟁은 경쟁점 자리(층·대로변 여부)와 후보지 자리를 비교해 매긴다.",
  ].join("\n");
}

export async function loadCandidateLocationContext(code: string): Promise<{ candidate: CandidateInput; contextText: string; hasSaved: boolean }> {
  const snap = await db().collection("storeEvalCandidates").doc(code).get();
  if (!snap.exists) throw new Error(`후보지 ${code}를 찾을 수 없습니다. find_candidate로 코드를 먼저 확인하세요.`);
  const candidate = snap.data() as CandidateInput;
  if (!candidate.address?.trim()) throw new Error("후보지에 주소가 없습니다. 웹 기본정보 탭에서 먼저 입력하세요.");
  const [competitorsSnap, demandPointsSnap, savedSnap] = await Promise.all([
    db().collection("storeEvalCompetitors").where("candidateCode", "==", code).get(),
    db().collection("storeEvalDemandPoints").where("candidateCode", "==", code).get(),
    db().collection("storeEvalLocationEvaluations").doc(code).get(),
  ]);
  // 층·지상/지하·엘리베이터는 buildLocationEvalContext에 없다 → 주소만 평가처럼 사실로 덧붙인다.
  // 2026-09-29 첫 실사용(N016 오송점, 지하 1층·엘베 있음)에서 AI가 층을 몰라 접근가시성을 비웠다.
  const competitors = competitorsSnap.docs.map((d) => d.data() as Competitor);
  const contextText = appendSiteFactsToContext(
    buildLocationEvalContext({
      candidate,
      competitors,
      demandPoints: demandPointsSnap.docs.map((d) => d.data() as DemandPoint),
    }) + competitorDetailText(competitors),
    { floor: candidate.floor ?? null, groundLevel: candidate.groundLevel ?? null, hasElevator: candidate.hasElevator ?? null },
  );
  return { candidate, contextText, hasSaved: savedSnap.exists };
}

export async function saveCandidateLocationDraft(args: {
  code: string;
  fields: Record<string, number | string | null>;
  confidence: Record<string, number>;
  rationale: string;
  sources: string[];
  modelName: string | null;
  user: McpUser;
}): Promise<void> {
  await db().collection(LOCATION_CHAT_DRAFTS).doc(args.code).set({
    candidateCode: args.code,
    fields: args.fields,
    confidence: args.confidence,
    rationale: args.rationale,
    sources: args.sources,
    modelName: args.modelName,
    createdBy: args.user.email,
    createdAt: Date.now(),
  });
}
