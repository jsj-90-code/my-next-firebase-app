"use client";

// 입지동선평가 AI 초안(3단계) 승인화면. MarketDataUploadPanel의 "체크박스로 항목별 적용 여부
// 선택 + 값 직접 수정 가능" 패턴을 그대로 재사용한다 — AI 결과는 절대 자동저장하지 않고, 사람이
// 검토·수정 후 "선택 항목 적용"을 눌러야 폼 상태에만 반영되며, 그 뒤에도 최종 "저장" 버튼을
// 별도로 눌러야 한다(기존 원칙 유지).

import { useState } from "react";
import type { InflowRestriction, SpecialDemandIntensity, SpecialDemandType } from "@/lib/storeEval/types";

const CONFIDENCE_AUTO_APPLY_THRESHOLD = 0.8;

type Score = 1 | 2 | 3 | 4 | 5;

export type LocationEvalAiFields = {
  locationScore: Score | null;
  flowScore: Score | null;
  preemptionScore: Score | null;
  visibilityScore: Score | null;
  attractionScore: Score | null;
  specialDemandType: SpecialDemandType | null;
  specialDemandIntensity: SpecialDemandIntensity | null;
  inflowRestriction: InflowRestriction | null;
  demandLeakageRisk: InflowRestriction | null;
  marketStructureMemo: string | null;
};

export type LocationEvalAiDraft = {
  fields: LocationEvalAiFields;
  confidence: Record<keyof LocationEvalAiFields, number>;
  rationale: string;
  warnings: string[];
};

type FieldMeta = {
  key: keyof LocationEvalAiFields;
  label: string;
  options?: { value: string; label: string }[];
};

const FIELD_META: FieldMeta[] = [
  { key: "locationScore", label: "상권내위치점수" },
  { key: "flowScore", label: "주요동선점수" },
  { key: "preemptionScore", label: "선점경쟁점수" },
  { key: "visibilityScore", label: "접근가시성점수" },
  { key: "attractionScore", label: "상권흡인력점수" },
  {
    key: "specialDemandType",
    label: "특수수요유형",
    options: ["없음", "대학가", "군부대", "산업단지", "관광유흥", "기타"].map((v) => ({ value: v, label: v })),
  },
  {
    key: "specialDemandIntensity",
    label: "특수수요강도",
    options: ["없음", "낮음", "보통", "높음"].map((v) => ({ value: v, label: v })),
  },
  { key: "inflowRestriction", label: "외부유입제한", options: ["없음", "보통", "강함"].map((v) => ({ value: v, label: v })) },
  { key: "demandLeakageRisk", label: "수요이탈위험", options: ["없음", "보통", "강함"].map((v) => ({ value: v, label: v })) },
  { key: "marketStructureMemo", label: "상권구조메모" },
];

function displayValue(v: string | number | null): string {
  return v == null ? "(없음)" : String(v);
}

type EditableRow = {
  key: keyof LocationEvalAiFields;
  checked: boolean;
  editedValue: string;
};

export function LocationEvalAiReviewPanel({
  draft,
  currentValues,
  onApply,
}: {
  draft: LocationEvalAiDraft;
  currentValues: LocationEvalAiFields;
  onApply: (patch: Partial<LocationEvalAiFields>, rationale: string) => void;
}) {
  const [rows, setRows] = useState<EditableRow[]>(() =>
    FIELD_META.map((meta) => {
      const value = draft.fields[meta.key];
      const confidence = draft.confidence[meta.key] ?? 0;
      return {
        key: meta.key,
        checked: value != null && confidence >= CONFIDENCE_AUTO_APPLY_THRESHOLD,
        editedValue: value == null ? "" : String(value),
      };
    }),
  );
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  function updateRow(idx: number, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function handleApply() {
    const patch: Partial<LocationEvalAiFields> = {};
    for (const row of rows) {
      if (!row.checked || row.editedValue.trim() === "") continue;
      const meta = FIELD_META.find((m) => m.key === row.key)!;
      if (meta.key === "marketStructureMemo") {
        (patch as Record<string, unknown>)[meta.key] = row.editedValue;
      } else if (meta.options) {
        (patch as Record<string, unknown>)[meta.key] = row.editedValue;
      } else {
        const n = Number(row.editedValue);
        if (!Number.isNaN(n)) (patch as Record<string, unknown>)[meta.key] = n;
      }
    }
    onApply(patch, draft.rationale);
    setApplyMessage(`${Object.keys(patch).length}개 항목을 폼에 반영했습니다 — 확인 후 "저장"을 눌러야 최종 반영됩니다.`);
  }

  const appliedCount = rows.filter((r) => r.checked && r.editedValue.trim() !== "").length;

  return (
    <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI 제안 검토</h4>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        신뢰도 {Math.round(CONFIDENCE_AUTO_APPLY_THRESHOLD * 100)}% 미만인 항목은 기본적으로 체크가 해제돼
        있습니다 — 값을 직접 확인·수정한 뒤 체크해주세요. 값은 체크 여부와 상관없이 바로 고칠 수 있습니다.
      </p>

      {draft.warnings.length > 0 && (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {draft.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr className="text-left text-zinc-500 dark:text-zinc-400">
              <th className="w-8 px-2 py-1"></th>
              <th className="px-2 py-1">항목</th>
              <th className="px-2 py-1">현재값</th>
              <th className="px-2 py-1">AI 제안값</th>
              <th className="px-2 py-1">신뢰도</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_META.map((meta, idx) => {
              const row = rows[idx];
              const confidence = draft.confidence[meta.key] ?? 0;
              const lowConfidence = confidence < CONFIDENCE_AUTO_APPLY_THRESHOLD;
              return (
                <tr key={meta.key} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1 text-center align-top">
                    <input type="checkbox" checked={row.checked} onChange={(e) => updateRow(idx, { checked: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1 align-top text-zinc-700 dark:text-zinc-300">{meta.label}</td>
                  <td className="px-2 py-1 align-top text-zinc-400">{displayValue(currentValues[meta.key])}</td>
                  <td className="px-2 py-1 align-top">
                    {meta.options ? (
                      <select
                        value={row.editedValue}
                        onChange={(e) => updateRow(idx, { editedValue: e.target.value, checked: true })}
                        className="w-28 rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="">(없음)</option>
                        {meta.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : meta.key === "marketStructureMemo" ? (
                      <textarea
                        value={row.editedValue}
                        rows={2}
                        onChange={(e) => updateRow(idx, { editedValue: e.target.value, checked: true })}
                        className="w-56 rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    ) : (
                      <select
                        value={row.editedValue}
                        onChange={(e) => updateRow(idx, { editedValue: e.target.value, checked: true })}
                        className="w-20 rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="">(없음)</option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}점
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className={`px-2 py-1 align-top ${lowConfidence ? "font-medium text-amber-600 dark:text-amber-400" : "text-zinc-400"}`}>
                    {Math.round(confidence * 100)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-medium">AI 조사 근거(종합) 보기</summary>
        <p className="mt-1 whitespace-pre-wrap leading-5">{draft.rationale}</p>
      </details>

      {applyMessage && (
        <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{applyMessage}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{appliedCount}개 항목 적용 예정</span>
        <button
          type="button"
          onClick={handleApply}
          disabled={appliedCount === 0}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          선택 항목 적용
        </button>
      </div>
    </div>
  );
}
