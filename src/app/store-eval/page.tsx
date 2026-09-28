import { redirect } from "next/navigation";

// 2026-09-28 웹 정리(사용자 승인 "제안대로") — 대시보드를 신규후보지 목록에 합쳤다.
// 여기 있던 후보지 표(최종예상월매출·판정·엑셀 내보내기)는 /store-eval/candidates로 옮겼고,
// "최근 평가 목록"은 같은 표를 시각순으로 다시 보여주던 것이라 뺐다. 옛 화면은 git 이력(feccb7c 이전)에 있다.
export default function StoreEvalRootPage() {
  redirect("/store-eval/candidates");
}
