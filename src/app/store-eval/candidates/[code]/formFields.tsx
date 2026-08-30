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
 * 2026-08-28 추가, 2026-08-28(2차) 세분화(사용자 확정 기준표 그대로 명문화).
 * 인테리어·좌석·관리 세부 4항목의 0.5점 단위 산정 기준. candidates/BasicInfoTab.tsx,
 * existing-stores/ExistingStoreProfileTab.tsx, CompetitorsTab.tsx 3곳에서 동일하게 재사용한다.
 * 아래 "조사서 표현 변환"·현장의견 가감은 자동 파싱은 아직 안 하고(자유문장 파싱은 오판 위험이
 * 커서 보류, 사용자 확인) 사람이 직접 입력할 때 참고하는 안내문으로만 쓴다.
 */
export function InteriorScoringGuide() {
  return (
    <div className="app-card-sm col-span-full mt-3 rounded-lg px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
      <p>
        <strong>좌석·존구성</strong>(내부비중 50%, 가장 중요) — 5.0=블랙라벨보다 종류·완성도가 압도적으로 우수 ·
        4.5=블랙라벨보다 명확하게 우수 · <strong>4.0(기준점)=팀룸·2인룸·커플존·1인룸·프렌즈/VIP존 등 블랙라벨과
        동급</strong> · 3.5=의미 있는 특화존 3~4종(팀룸 또는 독립형 좌석 포함) · 3.0=특화존 2종 · 2.5=특화존 1종 ·
        2.0=일반석 위주, 실질적인 특화존 없음 · 1.5=좌석구성이 노후되고 구분도 없음. 판정 원칙: 벽·문으로 분리된
        팀룸·2인룸·1인룸만 인정(칸막이만 있으면 일반 특화좌석 취급, 독립룸 아님) · 듀얼모니터만 있는 좌석은 모니터
        특화좌석이지 1인룸 아님 · 성인존·게이밍존처럼 이름만 나눈 구역은 특화존 미인정 · 종류를 평가하며 좌석
        수량은 참고자료로만 사용.
      </p>
      <p className="mt-2">
        <strong>최신성·디자인</strong>(마감·컨셉, 25%) — 조사서 표현 변환: 최상=5.0 · 상=4.5 ·
        <strong> 블랙라벨 동급(기준점)=4.0</strong> · 중상=3.5 · 중=3.0 · 중하=2.5 · 하=2.0. 현장 의견 가감(중복 감점
        금지): 최근 오픈·리뉴얼 +0.5 검토 · 오래된 느낌 -0.5.
      </p>
      <p className="mt-2">
        <strong>청결·관리상태</strong>(청결도·노후도, 15%) — 조사서 표현 변환(관리상태): 상=4.5 · 중상=3.5 ·
        <strong> 중(기준점)=3.0</strong> · 중하=2.5 · 하=2.0. 현장 의견 가감: 의자 불량 -0.5(또는 좌석구성에서) ·
        매장 청결 +0.5 검토.
      </p>
      <p className="mt-2">
        <strong>편의성</strong>(냄새·조명·화장실·편의시설, 10%) — 현장 의견 가감: 꿉꿉한 냄새·환기불량 -0.5 ·
        어두움 -0.5 · 외부 화장실·엘리베이터 없음 -0.5. 같은 문제를 여러 항목에서 중복 감점하지 않고, 사소한
        것(예: 직원이 인사하지 않음) 하나만으로는 감점하지 않습니다.
      </p>
    </div>
  );
}

/**
 * 2026-08-30(경쟁력 평가 기준 최종본 §8) 추가 — 경쟁점 좌석·존구성을 존 개수로 자동계산할 수
 * 없을 때(간략/외관만 조사, §2 "구성요소별 정보 없으면 조사자 종합평가로 환산") 쓰는 단일 종합
 * 평가 기준표. 위 InteriorScoringGuide(4개 세부항목용, 상세조사 시)와는 별개의 더 단순한 5단계
 * 스케일이다 — CompetitorsTab.tsx의 "좌석·존구성 (직접입력)" 폴백 필드 전용.
 */
export function CompetitorInteriorFallbackGuide() {
  return (
    <p className="col-span-full mt-1 text-[11px] leading-4 text-[#8a8072]">
      경쟁점 종합평가(존 개수를 모를 때만) — 5.0=팀룸·2인룸·커플존·VIP존·프렌즈존 등 다양하고 인테리어·관리·청결
      매우 우수 · 4.0=복수 특화존+최신 블랙라벨 평균 수준 · 3.0=일반석 중심+일부 특화좌석, 보통 수준 ·
      2.0=존 구성 거의 없음, 노후·관리 부족 · 1.0=시설 노후·청결 불량·차별화 없음. 중상·중하는 0.5점 단위.
      듀얼모니터는 독립존으로 구성됐을 때만 인정, 단순 칸막이는 1인룸 아님.
    </p>
  );
}

/** 먹거리 점수(직접입력, 브랜드없음/미정일 때만)의 0.5점 단위 산정 기준(사용자 확정 기준표). */
export function FoodScoringGuide() {
  return (
    <p className="col-span-full mt-2 text-[11px] leading-4 text-[#8a8072]">
      브랜드없음/미정일 때 직접입력 기준 — 5.0=전문 외식매장 수준 · 4.5=쉐프앤클릭보다 명확하게 우수 · 4.0(기준점,
      쉐프앤클릭 적용 블랙라벨과 동급) · 3.5=자체브랜드/알려진 브랜드이며 메뉴·품질 중상 · 3.0=메뉴가 어느 정도
      있고 품질은 일반적인 PC방 수준 · 2.5=라면·냉동식품 중심 · 2.0=음료·간식 위주 · 1.5 이하=먹거리 운영이 거의
      없음.
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
