"use client";

// 사양 설정 화면: 책상/PC 탭 드롭다운 옵션·기본값, 존 유형별 기본값 재정의를 작업자가 직접
// 관리할 수 있게 한다 (지금까지는 constants.ts를 고쳐서 배포해야만 바뀌던 값들).

import { useState } from "react";
import { PC_SPEC_FIELDS, SPEC_FIELDS, ZONE_TYPES } from "@/lib/seatLayout/constants";
import type { SpecFieldId } from "@/lib/seatLayout/constants";
import type { SeatLayoutSettings } from "@/lib/seatLayout/settings";
import type { PcSpecFieldId, ZoneTypeKey } from "@/lib/seatLayout/types";

type Props = {
  settings: SeatLayoutSettings;
  onClose: () => void;
  onSave: (next: SeatLayoutSettings) => void | Promise<void>;
};

function cloneSettings(s: SeatLayoutSettings): SeatLayoutSettings {
  return JSON.parse(JSON.stringify(s)) as SeatLayoutSettings;
}

export function SettingsPanel({ settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<SeatLayoutSettings>(() => cloneSettings(settings));
  const [saving, setSaving] = useState(false);
  const [expandedType, setExpandedType] = useState<ZoneTypeKey | null>(null);

  function addSpecOption(fieldId: SpecFieldId, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraft((d) => {
      const list = d.specOptions[fieldId] ?? [];
      if (list.includes(trimmed)) return d;
      return { ...d, specOptions: { ...d.specOptions, [fieldId]: [...list, trimmed] } };
    });
  }

  function removeSpecOption(fieldId: SpecFieldId, value: string) {
    setDraft((d) => ({
      ...d,
      specOptions: { ...d.specOptions, [fieldId]: (d.specOptions[fieldId] ?? []).filter((v) => v !== value) },
    }));
  }

  function addPcSuggestion(fieldId: PcSpecFieldId, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraft((d) => {
      const list = d.pcSuggestions[fieldId] ?? [];
      if (list.includes(trimmed)) return d;
      return { ...d, pcSuggestions: { ...d.pcSuggestions, [fieldId]: [...list, trimmed] } };
    });
  }

  function removePcSuggestion(fieldId: PcSpecFieldId, value: string) {
    setDraft((d) => ({
      ...d,
      pcSuggestions: {
        ...d.pcSuggestions,
        [fieldId]: (d.pcSuggestions[fieldId] ?? []).filter((v) => v !== value),
      },
    }));
  }

  function setSpecDefault(fieldId: SpecFieldId, value: string) {
    setDraft((d) => ({ ...d, specDefaults: { ...d.specDefaults, [fieldId]: value } }));
  }

  function setPcDefault(fieldId: PcSpecFieldId, value: string) {
    setDraft((d) => ({ ...d, pcDefaults: { ...d.pcDefaults, [fieldId]: value } }));
  }

  function setTypeDefault(typeKey: ZoneTypeKey, fieldId: SpecFieldId, value: string) {
    setDraft((d) => {
      const forType = { ...(d.typeDefaults[typeKey] ?? {}) };
      if (value) forType[fieldId] = value;
      else delete forType[fieldId];
      return { ...d, typeDefaults: { ...d.typeDefaults, [typeKey]: forType } };
    });
  }

  function setPcTypeDefault(typeKey: ZoneTypeKey, fieldId: PcSpecFieldId, value: string) {
    setDraft((d) => {
      const forType = { ...(d.pcTypeDefaults[typeKey] ?? {}) };
      if (value) forType[fieldId] = value;
      else delete forType[fieldId];
      return { ...d, pcTypeDefaults: { ...d.pcTypeDefaults, [typeKey]: forType } };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">사양 설정</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            닫기
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <p className="text-xs text-zinc-400">
            여기서 바꾼 드롭다운 항목/기본값은 저장 즉시 모든 매장 작업에 공통으로 적용됩니다. (이미 저장된
            프로젝트의 값은 바뀌지 않습니다)
          </p>

          <section>
            <h3 className="mb-2 font-semibold text-zinc-800 dark:text-zinc-100">책상 탭 드롭다운</h3>
            <div className="space-y-3">
              {SPEC_FIELDS.map((f) => (
                <OptionEditor
                  key={f.id}
                  label={f.label}
                  options={draft.specOptions[f.id] ?? []}
                  defaultValue={draft.specDefaults[f.id] ?? f.def}
                  onAdd={(v) => addSpecOption(f.id, v)}
                  onRemove={(v) => removeSpecOption(f.id, v)}
                  onDefaultChange={(v) => setSpecDefault(f.id, v)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-zinc-800 dark:text-zinc-100">PC 탭 드롭다운/기본값</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PC_SPEC_FIELDS.map((f) => (
                <OptionEditor
                  key={f.id}
                  label={f.label}
                  options={draft.pcSuggestions[f.id] ?? []}
                  defaultValue={draft.pcDefaults[f.id] ?? f.def}
                  freeDefault
                  onAdd={(v) => addPcSuggestion(f.id, v)}
                  onRemove={(v) => removePcSuggestion(f.id, v)}
                  onDefaultChange={(v) => setPcDefault(f.id, v)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-zinc-800 dark:text-zinc-100">존 유형별 기본값 재정의</h3>
            <p className="mb-2 text-xs text-zinc-400">
              특정 존 유형만 다른 기본값을 쓰고 싶을 때만 지정하세요. 비워두면(기본값 사용) 위 기본값을 그대로
              씁니다.
            </p>
            <div className="space-y-2">
              {ZONE_TYPES.map((t) => (
                <div key={t.key} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setExpandedType((cur) => (cur === t.key ? null : t.key))}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-zinc-800 dark:text-zinc-100"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      {t.label}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {expandedType === t.key ? "▾ 접기" : "▸ 펼치기"}
                    </span>
                  </button>
                  {expandedType === t.key && (
                    <div className="space-y-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                      <div>
                        <p className="mb-1 text-xs font-semibold text-zinc-500">책상 탭</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {SPEC_FIELDS.map((f) => (
                            <TypeOverrideField
                              key={f.id}
                              label={f.label}
                              options={draft.specOptions[f.id] ?? f.options}
                              value={draft.typeDefaults[t.key]?.[f.id] ?? ""}
                              onChange={(v) => setTypeDefault(t.key, f.id, v)}
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-zinc-500">PC 탭</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {PC_SPEC_FIELDS.map((f) => (
                            <TypeOverrideField
                              key={f.id}
                              label={f.label}
                              value={draft.pcTypeDefaults[t.key]?.[f.id] ?? ""}
                              freeText
                              suggestions={draft.pcSuggestions[f.id]}
                              onChange={(v) => setPcTypeDefault(t.key, f.id, v)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// 옵션 목록(추가/삭제 칩) + 기본값 지정 한 세트
function OptionEditor({
  label,
  options,
  defaultValue,
  freeDefault,
  onAdd,
  onRemove,
  onDefaultChange,
}: {
  label: string;
  options: string[];
  defaultValue: string;
  freeDefault?: boolean;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  onDefaultChange: (v: string) => void;
}) {
  const [draftValue, setDraftValue] = useState("");

  function commitAdd() {
    onAdd(draftValue);
    setDraftValue("");
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <span
            key={opt}
            className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {opt}
            <button
              type="button"
              onClick={() => onRemove(opt)}
              aria-label={`${opt} 삭제`}
              className="text-zinc-400 hover:text-red-600"
            >
              ×
            </button>
          </span>
        ))}
        {!options.length && <span className="text-xs text-zinc-400">등록된 항목 없음</span>}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            }
          }}
          placeholder="새 항목 입력 후 추가"
          className="flex-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={commitAdd}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          추가
        </button>
      </div>
      <div className="mt-2">
        <label className="text-xs text-zinc-400">기본값</label>
        {freeDefault ? (
          <>
            <select
              value={options.includes(defaultValue) ? defaultValue : "__etc__"}
              onChange={(e) => onDefaultChange(e.target.value === "__etc__" ? "" : e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
              <option value="__etc__">기타(직접입력)</option>
            </select>
            {!options.includes(defaultValue) && (
              <input
                value={defaultValue}
                onChange={(e) => onDefaultChange(e.target.value)}
                placeholder="직접 입력"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
            )}
          </>
        ) : (
          <select
            value={defaultValue}
            onChange={(e) => onDefaultChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            {!options.includes(defaultValue) && defaultValue && (
              <option value={defaultValue}>{defaultValue}</option>
            )}
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// 존 유형별 재정의 한 칸: 비워두면(빈 문자열) "기본값 사용"
function TypeOverrideField({
  label,
  options,
  value,
  freeText,
  suggestions,
  onChange,
}: {
  label: string;
  options?: string[];
  value: string;
  freeText?: boolean;
  suggestions?: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500">{label}</label>
      {freeText ? (
        (() => {
          const list = suggestions ?? [];
          const isKnown = value === "" || list.includes(value);
          return (
            <>
              <select
                value={isKnown ? value : "__etc__"}
                onChange={(e) => onChange(e.target.value === "__etc__" ? "" : e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">(기본값 사용)</option>
                {list.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="__etc__">기타(직접입력)</option>
              </select>
              {!isKnown && (
                <input
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder="직접 입력"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
              )}
            </>
          );
        })()
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">(기본값 사용)</option>
          {(options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
