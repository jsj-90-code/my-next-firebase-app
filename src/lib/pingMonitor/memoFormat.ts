// 2026-10-16 점포팀 요청 — 측정기 메모(다우 "경쟁점 조사 양식")를 다우 심사요청에 그대로 붙여넣을 수 있게 줄을 살린다.
// 메모 칸이 한 줄 입력이던 때 저장된 메모는 줄바꿈이 공백으로 뭉개져 있다. 줄바꿈이 하나도 없는 메모만
// 양식 모양(" - 항목", " 1. 세부")대로 다시 나눠 보여 준다. 줄바꿈이 있는 메모는 손대지 않는다.
export function formatSurveyMemo(memo: string): string {
  const text = memo.trim();
  if (!text || text.includes("\n")) return text;
  return text
    .replace(/\s+-\s+/g, "\n- ")
    .replace(/\s+(\d)\.\s+/g, "\n   $1. ")
    .replace(/\s+(종합\s*평가)/g, "\n\n$1")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}
