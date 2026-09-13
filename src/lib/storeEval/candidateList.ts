import type { CandidateInput, ReviewStatus } from "./types";

export const CANDIDATE_STATUSES = ["전체", "진행", "보류", "완료", "종료"] as const;
export type CandidateStatusFilter = "전체" | ReviewStatus;
export type CandidateSort = "updated" | "name" | "code";

// Shared by the desktop table and mobile cards; never reorder the loaded source array.
export function selectCandidates(
  candidates: CandidateInput[],
  search: string,
  status: CandidateStatusFilter,
  sort: CandidateSort,
): CandidateInput[] {
  const terms = search.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean);
  return candidates.filter((candidate) => {
    if (status !== "전체" && candidate.reviewStatus !== status) return false;
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
    return a.code.localeCompare(b.code, "ko", { numeric: true });
  });
}
