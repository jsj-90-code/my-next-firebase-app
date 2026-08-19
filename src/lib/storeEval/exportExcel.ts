// 대시보드 "엑셀로 내보내기" 버튼에서 쓰는 유틸. 새 계산 로직 없이 CandidateInput/EvaluationResult
// 필드를 그대로 한 행씩 옮겨 담는다. 브라우저에서 실행되므로 파일시스템 접근 없이
// Blob + <a download> 방식으로 다운로드한다.

import ExcelJS from "exceljs";
import type { CandidateInput, EvaluationResult } from "./types";

export async function exportCandidatesToExcel(
  candidates: CandidateInput[],
  results: EvaluationResult[],
): Promise<void> {
  const resultByCode = new Map(results.map((result) => [result.candidateCode, result]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "점포평가 시스템 (V62)";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("후보지목록");

  sheet.columns = [
    { header: "후보지코드", key: "code", width: 10 },
    { header: "이름", key: "name", width: 20 },
    { header: "주소", key: "address", width: 32 },
    { header: "검토상태", key: "reviewStatus", width: 10 },
    { header: "예상PC대수", key: "expectedPcCount", width: 12 },
    { header: "시간당요금", key: "hourlyRate", width: 12 },
    { header: "V61(참고)", key: "v61Baseline", width: 14 },
    { header: "V62보정률", key: "v62Rate", width: 12 },
    { header: "V62최종예상월매출", key: "v62Final", width: 18 },
    { header: "85%", key: "conservativeSales", width: 14 },
    { header: "115%", key: "upperSales", width: 14 },
    { header: "상권수요", key: "marketDemand", width: 12 },
    { header: "상권등급", key: "marketGrade", width: 10 },
    { header: "경쟁IP", key: "competitorIp", width: 10 },
    { header: "IP당수요", key: "ipPerDemand", width: 10 },
    { header: "입력완성도", key: "completionStatus", width: 16 },
    { header: "최종운영판정", key: "finalJudgement", width: 16 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  for (const candidate of candidates) {
    const result = resultByCode.get(candidate.code) ?? null;
    sheet.addRow({
      code: candidate.code,
      name: candidate.name,
      address: candidate.address,
      reviewStatus: candidate.reviewStatus,
      expectedPcCount: candidate.expectedPcCount,
      hourlyRate: candidate.hourlyRate,
      v61Baseline: result?.v61Baseline ?? null,
      v62Rate: result?.v62Rate ?? null,
      v62Final: result?.v62Final ?? null,
      conservativeSales: result?.conservativeSales ?? null,
      upperSales: result?.upperSales ?? null,
      marketDemand: result?.marketDemand ?? null,
      marketGrade: result?.marketGrade ?? null,
      competitorIp: result?.competitorIp ?? null,
      ipPerDemand: result?.ipPerDemand ?? null,
      completionStatus: result?.completionStatus ?? null,
      finalJudgement: result?.finalJudgement ?? null,
    });
  }

  const wonColumns = ["hourlyRate", "v61Baseline", "v62Final", "conservativeSales", "upperSales", "marketDemand", "competitorIp"];
  for (const key of wonColumns) {
    sheet.getColumn(key).numFmt = "#,##0";
  }
  sheet.getColumn("v62Rate").numFmt = "0.0%";
  sheet.getColumn("ipPerDemand").numFmt = "0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const filename = `점포평가_후보지목록_${y}${m}${d}.xlsx`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
