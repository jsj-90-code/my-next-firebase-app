"use client";

// 점포평가 상세 화면(기본정보/경쟁점/입지동선평가)에서 공유하는 폼 필드 컴포넌트.
// 스타일은 AutoAuthGate/layout.tsx의 zinc 팔레트 + rounded 톤을 그대로 따른다.

import type { ChangeEvent, ReactNode } from "react";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

export const sectionClass =
  "rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";
export const sectionTitleClass = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
export const gridClass = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

export function FieldWrap({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] leading-4 text-zinc-400">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </FieldWrap>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <FieldWrap label={label} hint={hint}>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </FieldWrap>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  required,
  step = 1,
  hint,
  allowNegative = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  step?: number;
  hint?: string;
  allowNegative?: boolean;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint}>
      <input
        type="number"
        step={step}
        min={allowNegative ? undefined : 0}
        value={value ?? ""}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={inputClass}
      />
    </FieldWrap>
  );
}

export function DateField({
  label,
  value,
  onChange,
  required,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint}>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={inputClass}
      />
    </FieldWrap>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  required,
  hint,
  placeholder = "선택 안 함",
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as T))}
        className={inputClass}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function ScoreSelectField({
  label,
  value,
  onChange,
  required,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={inputClass}
      >
        <option value="">선택 안 함</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}점
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function BooleanSelectField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  hint?: string;
}) {
  return (
    <FieldWrap label={label} hint={hint}>
      <select
        value={value == null ? "" : value ? "yes" : "no"}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}
        className={inputClass}
      >
        <option value="">미확인</option>
        <option value="yes">예</option>
        <option value="no">아니오</option>
      </select>
    </FieldWrap>
  );
}
