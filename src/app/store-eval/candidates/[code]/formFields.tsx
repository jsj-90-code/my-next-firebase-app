"use client";

// 점포평가 상세 화면(기본정보/경쟁점/입지동선평가)에서 공유하는 폼 필드 컴포넌트.
// 스타일은 globals.css의 app-theme(따뜻한 크림/테라코타 "블루프린트 용지" 톤)을 그대로 따른다.

import { useId } from "react";
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

// 2026-09-01 신설 — 모니터 텍스트를 직접 입력할 때 "벤큐 27 FHD 240"처럼 브랜드 키워드(ZOWIE 등)를
// 빠뜨리면 자동채점이 조용히 낮은 점수로 떨어지는 문제(사용자 지적)를 완화한다. 커스텀 드롭다운을
// 새로 만드는 대신 브라우저 네이티브 <datalist>를 붙여서, 목록에서 골라 넣으면 항상 정확한 인식
// 문구가 그대로 들어가고, 목록에 없는 모델은 여전히 자유 입력이 가능하다(강제 아님).
export const MONITOR_PRESET_OPTIONS = [
  "제이씨현 32인치 FHD 240Hz",
  "QNIX IPS 27인치 FHD 300Hz",
  "QNIX Nano IPS 27인치 QHD 165Hz",
  "BenQ ZOWIE XL2540X+ 24.1인치 FHD 280Hz",
  "BenQ ZOWIE XL2566K 24.5인치 FHD 360Hz",
  "비트엠 34인치 WWQHD 165Hz",
  "비트엠 27인치 FHD 240Hz",
  "LG 울트라기어 GP750 240Hz",
  "LG 울트라기어 GP850 165Hz",
  "LG 울트라와이드 34WP65C 160Hz QHD",
  "벤큐 2546K 240Hz",
  "벤큐 2746K 240Hz",
  "삼성 Odyssey G4 240Hz",
  "DELL 360Hz",
];

export function MonitorTextField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const listId = useId();
  return (
    <FieldWrap label={label} hint={hint}>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} list={listId} placeholder="목록에서 선택하거나 직접 입력" />
      <datalist id={listId}>
        {MONITOR_PRESET_OPTIONS.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
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
// 2026-08-31 재작성 — GPT를 통한 시설 평가 재설계(§3)에 맞춰 인테리어·관리를 "하/중하/중/중상/상"
// 5단계 단일 척도로 통일했다(둘 다 서로 완전히 독립된 값 — 관리를 인테리어로 대신 채우지 않는다).
export function InteriorScoringGuide() {
  return (
    <div className="app-card-sm col-span-full mt-3 rounded-lg px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
      <p>
        <strong>존구성</strong>(내부비중 50%, 팀룸·2인룸·커플존·VIP존·프렌즈존·1인석·1인룸·퍼스트클래스존 개수로
        자동계산) — 존 유형이 다양할수록, PC대수 대비 특화좌석 비율이 높을수록 높은 점수. 벽·문으로 분리된
        팀룸·2인룸·1인룸만 인정(칸막이만 있으면 일반 특화좌석 취급, 독립룸 아님) · 듀얼모니터만 있는 좌석은
        모니터 특화좌석이지 1인룸 아님 · 성인존·게이밍존처럼 이름만 나눈 구역은 특화존 미인정.
      </p>
      <p className="mt-2">
        <strong>인테리어</strong>(마감·컨셉, 내부비중 30%) — 하=2.0 · 중하=2.5 · 중=3.0 · 중상=3.5 · 상=4.5
        (0.5점 단위 세부 조정 가능). 자사 신규오픈 기준값=4.0.
      </p>
      <p className="mt-2">
        <strong>관리</strong>(청결·운영상태, 내부비중 20%, 인테리어와 완전히 독립) — 하=2.0 · 중하=2.5 · 중=3.0 ·
        중상=3.5 · 상=4.5. 존구성 부족을 관리·인테리어에서 다시 감점하지 않는다(항목별로 독립 평가).
      </p>
    </div>
  );
}

/**
 * 2026-08-30(경쟁력 평가 기준 최종본 §8) 추가 — 경쟁점 좌석·존구성을 존 개수로 자동계산할 수
 * 없을 때(간략 조사, §2 "구성요소별 정보 없으면 조사자 종합평가로 환산") 쓰는 단일 종합
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

/**
 * 2026-09-01 신설(사용자 요청 — "기준을 자꾸 바꿔대서 나조차 헷갈린다") — GPU/CPU/RAM/모니터
 * 자동채점 기준을 한 곳에 모아 보여준다. 새 계산 로직 아님, calc.ts의 scoreFromVga/scoreFromCpu/
 * scoreFromRam/scoreFromMonitor/combineHardwareTiers/scoreFromMonitorSpec를 문서화한 것뿐이라
 * 산식이 바뀌면 이 텍스트도 같이 갱신해야 한다.
 */
export function HardwareScoringGuide() {
  return (
    <div className="app-card-sm col-span-full mt-3 rounded-lg px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
      <p>
        <strong>GPU</strong> — 모델명 4자리 숫자 기준. RTX 5060=4.0(기준점), 천단위(세대)가 1 오를 때마다 +1(예: RTX
        4060=3.0, RTX 6060=5.0), 뒤 2자리가 80 이상이면 +1·70 이상이면 +0.5(예: RTX 5080=5.0). 라데온(RX)은 자동으로
        동급 RTX로 환산.
      </p>
      <p className="mt-2">
        <strong>CPU</strong> — 인텔 코어 울트라(예: "울트라5 225F")는 200번대=4.0(기준점), 티어(5→7→9) 한 단계당 +1,
        시리즈 앞자리가 200번대보다 낮으면 -1. 구형 표기("14세대", "14400" 등)는 14세대=4.0(기준점) 기준 세대 1당
        ±1. 라이젠은 세대 환산 후 동일 규칙.
      </p>
      <p className="mt-2">
        <strong>RAM</strong> — 8GB 이하=1.5 · 16GB=3.5 · 32GB=4.0 · 64GB 이상=5.0.
      </p>
      <p className="mt-2">
        <strong>모니터</strong> — 주사율(Hz) 기준: 120Hz 미만=1.5 · 120~143=2.0 · 144~165=3.0 · 166~200=3.25 ·
        201~240=3.5 · 241~299=4.0 · 300~359=4.5 · 360~399=4.75 · 400 이상=5.0. QHD/WQHD 해상도면 +1.0(최대 5.0).
        OLED·4K는 무조건 5.0. <strong>"ZOWIE"라는 단어가 텍스트에 있어야</strong> BenQ ZOWIE 계열이 최소 4.5점으로
        인식됩니다(예: "벤큐 27 FHD 240"은 그냥 3.5점, "BenQ ZOWIE XL2566K 240Hz"라고 적어야 4.5점) — 아래 입력칸을
        클릭하면 자주 쓰는 모델 목록이 나오니 거기서 고르면 실수를 줄일 수 있습니다.
      </p>
      <p className="mt-2 text-[11px] text-[#8a8072]">
        위 4항목 모두 "기본"(대부분 좌석) + "특화"(일부 좌석만 업그레이드) 텍스트를 따로 입력하면 기본80%+특화20%로
        결합합니다(모니터만 기본65%+특화35%, 콤마로 여러 모델 나열 가능·기본과 같거나 낮은 특화는 자동 제외).
      </p>
    </div>
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
