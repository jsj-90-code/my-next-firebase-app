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
import { adminDb } from "@/lib/firebase-admin";
import { buildLocationEvalContext } from "@/lib/storeEval/locationEvalContext";
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
  const contextText = buildLocationEvalContext({
    candidate,
    competitors: competitorsSnap.docs.map((d) => d.data() as Competitor),
    demandPoints: demandPointsSnap.docs.map((d) => d.data() as DemandPoint),
  });
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
