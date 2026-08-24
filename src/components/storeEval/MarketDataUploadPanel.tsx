"use client";

// SGIS 생활권역 통계지도 / 소상공인365 상권분석 반자동 업로드-추출 패널.
// 공식 API가 없어(2026-08-24 조사 확인) 사람이 각 사이트에서 직접 조회한 파일(엑셀/CSV)이나
// 복사한 표를 붙여넣으면, 결정적 라벨매칭(marketDataExtract.ts)으로 값을 추출해 보여준다.
// AI가 숫자를 만들어내지 않는다 — 매칭 안 된 항목은 빈칸이고, 사용자가 확인/수정 후에만 적용된다.

import { useState, type ChangeEvent } from "react";
import {
  extractFields,
  parsePastedTable,
  parsePastedTableSectioned,
  type ExtractedFieldDraft,
  type MarketFieldSpec,
} from "@/lib/storeEval/marketDataExtract";
import { extractLabelValuePairsFromFile, hashFile } from "@/lib/storeEval/spreadsheetPairs";
import type { MarketDataSourceType, MarketDataUpload } from "@/lib/storeEval/types";

type EditableDraft = ExtractedFieldDraft & { checked: boolean; editedValue: string };

function toDraftValueText(v: number | string | null): string {
  return v == null ? "" : String(v);
}

export function MarketDataUploadPanel({
  title,
  openUrl,
  openLabel,
  instructions,
  specs,
  sourceType,
  candidateCode,
  coord,
  actorEmail,
  onApply,
  defaultMode = "file",
  pasteParser = "plain",
  showFileUpload = true,
}: {
  title: string;
  openUrl: string;
  openLabel: string;
  instructions: string;
  specs: MarketFieldSpec[];
  sourceType: MarketDataSourceType;
  candidateCode: string;
  coord: { lat: number; lng: number } | null;
  actorEmail: string | null;
  onApply: (patch: Record<string, number | string>, upload: MarketDataUpload) => void;
  // SGIS 생활권역 통계지도는 PDF 보고서만 제공하고 엑셀/CSV가 없다(2026-08-24 확인) — 그 경우
  // 파일 업로드 탭 자체를 숨기고 붙여넣기를 기본으로 띄운다. 그 표는 "반경 기준 0.5km" 섹션
  // 제목 아래 "전체"/"남"/"0~9세 인구" 식으로 반경이 라벨에 안 붙어 있어서, sectioned 파서로
  // 섹션을 태깅해야만 500m/1km를 구분해 매칭할 수 있다.
  defaultMode?: "file" | "paste";
  pasteParser?: "plain" | "sectioned";
  showFileUpload?: boolean;
}) {
  const [mode, setMode] = useState<"file" | "paste">(defaultMode);
  const [pastedText, setPastedText] = useState("");
  const [drafts, setDrafts] = useState<EditableDraft[] | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; hash: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  function draftsFrom(pairs: { label: string; value: string }[]): EditableDraft[] {
    return extractFields(pairs, specs).map((d) => ({ ...d, checked: d.autoExtracted, editedValue: toDraftValueText(d.parsedValue) }));
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setApplyMessage(null);
    setBusy(true);
    try {
      const [pairs, hash] = await Promise.all([extractLabelValuePairsFromFile(file), hashFile(file)]);
      const nextDrafts = draftsFrom(pairs);
      setDrafts(nextDrafts);
      setFileInfo({ name: file.name, hash });
      const matched = nextDrafts.filter((d) => d.autoExtracted).length;
      if (matched === 0) setError("파일에서 알려진 항목을 하나도 찾지 못했습니다 — 아래 표에서 직접 값을 입력해도 됩니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일을 읽지 못했습니다. xlsx 또는 csv 형식인지 확인해주세요.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  function handleExtractPasted() {
    setError(null);
    setApplyMessage(null);
    const pairs = pasteParser === "sectioned" ? parsePastedTableSectioned(pastedText) : parsePastedTable(pastedText);
    if (pairs.length === 0) {
      setError("표에서 라벨/값 쌍을 찾지 못했습니다. 셀 사이 탭(Tab)이 유지되도록 그대로 복사해서 붙여넣어주세요.");
      return;
    }
    setDrafts(draftsFrom(pairs));
    setFileInfo(null);
  }

  function updateDraft(idx: number, patch: Partial<EditableDraft>) {
    setDrafts((prev) => (prev ? prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)) : prev));
  }

  function handleApply() {
    if (!drafts) return;
    const patch: Record<string, number | string> = {};
    const extractedFields = drafts.map((d) => {
      const spec = specs.find((s) => s.key === d.fieldKey)!;
      const trimmed = d.editedValue.trim();
      let value: number | string | null = null;
      if (d.checked && trimmed !== "") {
        if (spec.kind === "yearMonth" || spec.kind === "date") {
          value = trimmed;
        } else {
          const n = Number(trimmed);
          value = Number.isNaN(n) ? null : n;
        }
      }
      if (value != null) patch[d.fieldKey] = value;
      return {
        fieldKey: d.fieldKey,
        matchedLabel: d.matchedLabel,
        rawValue: d.rawValue,
        parsedValue: value,
        autoExtracted: d.autoExtracted,
        userEdited: trimmed !== toDraftValueText(d.parsedValue),
        applied: value != null,
      };
    });

    const upload: MarketDataUpload = {
      id: `${candidateCode}_${sourceType}_${Date.now()}`,
      candidateCode,
      sourceType,
      coordAtUpload: coord,
      fileName: fileInfo?.name ?? null,
      fileHash: fileInfo?.hash ?? null,
      pastedTable: fileInfo == null,
      extractedFields,
      uploadedAt: Date.now(),
      uploadedBy: actorEmail,
    };
    onApply(patch, upload);
    setApplyMessage(`${Object.keys(patch).length}개 항목을 폼에 반영했습니다 — 확인 후 "저장"을 눌러야 최종 반영됩니다.`);
  }

  const appliedCount = drafts?.filter((d) => d.checked && d.editedValue.trim() !== "").length ?? 0;

  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {openLabel} ↗
        </a>
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{instructions}</p>

      {showFileUpload && (
        <div className="mt-3 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`rounded-md px-2 py-1 font-medium ${mode === "file" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}
          >
            파일 업로드
          </button>
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`rounded-md px-2 py-1 font-medium ${mode === "paste" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}
          >
            표 붙여넣기
          </button>
        </div>
      )}

      {showFileUpload && mode === "file" ? (
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          disabled={busy}
          className="mt-2 block w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900"
        />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={4}
            placeholder="원본 사이트에서 표를 그대로 복사해 붙여넣으세요 (셀 사이 탭 유지)"
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={handleExtractPasted}
            className="w-fit rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            추출
          </button>
        </div>
      )}

      {busy && <p className="mt-2 text-xs text-zinc-500">파일을 읽는 중...</p>}
      {error && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{error}</p>}
      {applyMessage && (
        <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{applyMessage}</p>
      )}
      {fileInfo && <p className="mt-2 text-[11px] text-zinc-400">업로드 파일: {fileInfo.name}</p>}

      {drafts && (
        <div className="mt-3">
          <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1">항목</th>
                  <th className="px-2 py-1">원본 라벨(매칭)</th>
                  <th className="px-2 py-1">값</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, idx) => (
                  <tr key={d.fieldKey} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={d.checked}
                        onChange={(e) => updateDraft(idx, { checked: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1 text-zinc-700 dark:text-zinc-300">{d.displayLabel}</td>
                    <td className="px-2 py-1 text-zinc-400">{d.matchedLabel ?? <span className="italic">매칭 안 됨</span>}</td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={d.editedValue}
                        onChange={(e) => updateDraft(idx, { editedValue: e.target.value, checked: true })}
                        className="w-28 rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">{appliedCount}개 항목 적용 예정</span>
            <button
              type="button"
              onClick={handleApply}
              disabled={appliedCount === 0}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              폼에 적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
