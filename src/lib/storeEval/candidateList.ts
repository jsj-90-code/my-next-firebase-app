import type { CandidateInput } from "./types";

// 2026-09-28 사용자: "완료/종료/진행 이거 뭔 차이? 구분 없어도 될 것 같은데 … 등록했으면 심사 완료한 거고, 완료가 곧 종료.
// 다만 계약까지 이어져서 기존 가맹점으로 변경되는 형태가 있긴 함" → 검토상태(진행·보류·완료·종료) 구분을 화면에서 뺐다.
// 저장 필드 reviewStatus는 원본 시트 규격이라 남겨 두고("진행" 기본값) 화면은 안 읽는다. 대신 진짜 상태인
// "기존 가맹점으로 전환됐나"(기존점 문서의 originCandidateCode)로 가른다.
export const CANDIDATE_STATUSES = ["전체", "미전환", "전환됨"] as const;
export type CandidateStatusFilter = typeof CANDIDATE_STATUSES[number];
export type CandidateSort = "updated" | "name" | "code";

// Shared by the desktop table and mobile cards; never reorder the loaded source array.
export function selectCandidates(
  candidates: CandidateInput[],
  search: string,
  status: CandidateStatusFilter,
  sort: CandidateSort,
  /** 기존 가맹점으로 전환된 후보지 코드. 목록 화면이 기존점 목록에서 originCandidateCode로 모아 넘긴다. */
  convertedCodes: ReadonlySet<string> = new Set(),
): CandidateInput[] {
  const terms = search.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean);
  return candidates.filter((candidate) => {
    if (status === "전환됨" && !convertedCodes.has(candidate.code)) return false;
    if (status === "미전환" && convertedCodes.has(candidate.code)) return false;
    const text = [candidate.code, candidate.name, candidate.address].join(" ").normalize("NFKC").toLocaleLowerCase("ko-KR");
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    if (sort === "updated") {
      const difference = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      if (difference) return difference;
    }
    if (sort === "name") {
      const difference = (a.name ?? "").localeCompare(b.name ?? "", "ko");
      if (difference) return difference;
    }
    // 2026-09-24 밤 사용자: "신규후보지 나열할 때 코드명으로, 숫자 높은 게 위로" — 코드 내림차순(N016 → N001). 실험실 후보지 표와 같은 순서.
    return b.code.localeCompare(a.code, "ko", { numeric: true });
  });
}
