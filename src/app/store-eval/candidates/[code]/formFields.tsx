"use client";

// 점포평가 상세 화면(기본정보/경쟁점/입지동선평가)에서 공유하는 폼 필드 컴포넌트.
// 스타일은 globals.css의 app-theme(따뜻한 크림/테라코타 "블루프린트 용지" 톤)을 그대로 따른다.

import type { ChangeEvent, ReactNode } from "react";

const inputClass = "app-input w-full px-2.5 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-[#8a8072]";

export const sectionClass = "app-card rounded-2xl p-5";
export const sectionTitleClass = "text-sm font-semibold text-[#171310] dark:text-[#f2ede2]";
export const gridClass = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

/** 자동추출 데이터 소스가 없어 사용자가 직접 조사/입력해야 하는 필드에 붙이는 표시. */
export function ManualBadge() {
  return (
    <span className="app-badge app-badge-warn ml-1 px-1 py-0.5 text-[10px]">
      직접입력
    </span>
  );
}

export function FieldWrap({
  label,
  required,
  hint,
  manualOnly,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  manualOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>
        {label}
        {required && <span className="ml-0.5 text-[var(--sl-danger)]">*</span>}
        {manualOnly && <ManualBadge />}
      </span>
      {children}
      {hint && <span className="text-[11px] leading-4 text-[#8a8072]">{hint}</span>}
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
  manualOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  manualOnly?: boolean;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint} manualOnly={manualOnly}>
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
  manualOnly,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  step?: number;
  hint?: string;
  allowNegative?: boolean;
  manualOnly?: boolean;
}) {
  return (
    <FieldWrap label={label} required={required} hint={hint} manualOnly={manualOnly}>
      <input
        type="number"
        step={step}
        min={allowNegative ? undefined : 0}
        // 값이 없는 것("아직 확인 안 됨")과 실제 0("확인해보니 0")은 실제로는 구분해야 하는
        // 값이라 빈 값을 진짜 0으로 채우진 않는다 — 대신 placeholder로만 "0"을 흐리게 보여줘서
        // 공란이 고장난 것처럼 보이는 걸 막는다(타이핑하면 바로 placeholder는 사라짐).
        placeholder="0"
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
  step = 1,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  hint?: string;
  /** 2026-08-27 추가 — 세부항목(인테리어 수준 등)은 0.5 단위로 더 촘촘하게 고를 수 있게 한다. */
  step?: 1 | 0.5;
}) {
  const options = step === 0.5 ? [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] : [1, 2, 3, 4, 5];
  return (
    <FieldWrap label={label} required={required} hint={hint}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={inputClass}
      >
        <option value="">선택 안 함</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}점
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

/**
 * 2026-08-28 추가 — 인테리어·좌석·관리 세부 4항목의 1~5점 산정 기준(사용자 요청으로 명문화).
 * "4.0=블랙라벨 기준점"이라는 하드웨어 채점(scoreFromVga 등)과 같은 앵커 원칙을 그대로 따른다.
 * candidates/BasicInfoTab.tsx, existing-stores/ExistingStoreProfileTab.tsx, CompetitorsTab.tsx
 * 3곳에서 동일하게 재사용한다.
 */
export function InteriorScoringGuide() {
  return (
    <div className="app-card-sm col-span-full mt-3 rounded-lg px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
      <p>
        <strong>좌석·존구성</strong>(내부비중 50%, 가장 중요) — 5.0=특화존 6종 이상(블랙라벨보다 풍부) · 4.5=특화존
        5종+넉넉한 규모 · <strong>4.0(기준점)=팀룸·2인룸·커플존·1인룸·프렌즈존/VIP존 등 블랙라벨 표준 구성과
        동급(특화존 4~5종)</strong> · 3.0~3.5=특화존 2~3종만 있음 · 2.0~2.5=특화존 1종, 대부분 일반석 ·
        1.0~1.5=특화존 사실상 없음(일반석 위주). 칸막이만 있는 좌석은 독립룸으로 인정하지 않고, 이름만 나눈
        구역(성인존·게이밍존 등)은 특화존으로 인정하지 않습니다 — 실제 공간이나 이용목적이 구분돼야 합니다.
      </p>
      <p className="mt-2">
        <strong>최신성·디자인</strong>(마감·컨셉) — 5.0=최근 1~2년 내 리뉴얼·최신 트렌드 ·
        <strong>4.0(기준점)=3~5년 이내, 무난하고 깔끔함</strong> · 3.0=5년 이상 경과, 다소 평범 ·
        2.0=마감재 노후화 눈에 띔 · 1.0=매우 낡음, 리뉴얼 시급.
      </p>
      <p className="mt-2">
        <strong>청결·관리상태</strong>(청결도·노후도) — 5.0=매우 청결, 파손 없음 ·
        <strong>4.0(기준점)=전반적으로 양호, 특별한 하자 없음</strong> · 3.0=보통, 일부 사용감/얼룩 ·
        2.0=관리 미흡(먼지·얼룩, 일부 파손) · 1.0=관리 매우 부실(악취·오염·파손 심함).
      </p>
      <p className="mt-2">
        <strong>편의성</strong>(냄새·조명·화장실·편의시설) — 5.0=냄새 없음·조명 쾌적·화장실 매우 깨끗 ·
        <strong>4.0(기준점)=기본 편의시설 갖춤, 큰 불편 없음</strong> · 3.0=일부 불편(화장실 관리 미흡 등) ·
        2.0=여러 불편 요소 · 1.0=심각한 불편(악취 등).
      </p>
    </div>
  );
}

/** 먹거리 점수(직접입력, 브랜드없음/미정일 때만)의 1~5점 산정 기준. */
export function FoodScoringGuide() {
  return (
    <p className="col-span-full mt-2 text-[11px] leading-4 text-[#8a8072]">
      브랜드없음/미정일 때 직접입력 기준 — 5=브랜드 있는 경쟁점보다 우위 · 4(기준점)=우리 매장(쉐프앤클릭) 수준 ·
      3=약간 열위 · 2=열위 · 1=확실히 열위.
    </p>
  );
}

/** 자동계산된 값을 읽기전용으로 보여준다 (사양/좌석/입지 점수 등 - 점포평가.gs 자동계산 열). */
export function ComputedField({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <FieldWrap label={label} hint={hint}>
      <input
        type="text"
        readOnly
        value={value == null ? "-" : String(value)}
        className="app-card-sm w-full rounded-md px-2.5 py-1.5 text-sm text-[#5c5346] dark:text-[#c9bfae]"
      />
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
