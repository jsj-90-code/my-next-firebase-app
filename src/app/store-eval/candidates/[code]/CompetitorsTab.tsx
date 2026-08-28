"use client";

// 탭2 경쟁점 - "3. 경쟁점 입력" 화면 요구사항.
// Competitor 타입의 필드 전부를 폼에 반영하고, investigationStatus(신규 워크플로 필드)로
// "경쟁점 데이터 없음"과 "노후·저경쟁력 미조사"를 구분한다(docs/data-issues.md #3).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { computeCompetitorInvestigationSummary, computeCompetitorScores } from "@/lib/storeEval/calc";
import { parseCompetitorNotes, type ParsedCompetitorNote } from "@/lib/storeEval/competitorNoteParse";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { deleteCompetitor, getModelSettings, listCompetitors, saveCompetitor } from "@/lib/storeEval/store";
import type { Competitor, CompetitorSurveyState, FoodBrand, GroundLevel, ModelSettings, SurveyLevel } from "@/lib/storeEval/types";
import {
  BooleanSelectField,
  ComputedField,
  NumberField,
  ScoreSelectField,
  SelectField,
  TextAreaField,
  TextField,
  gridClass,
  sectionClass,
  sectionTitleClass,
} from "./formFields";

// 2026-08-27 추가 — 먹거리 브랜드 선택지(사용자 확인). "브랜드없음"이면 직접 1~5점을 입력한다.
const FOOD_BRAND_OPTIONS: { value: FoodBrand; label: string }[] = [
  { value: "쉐프앤클릭", label: "쉐프앤클릭 (블랙라벨 자체)" },
  { value: "비바쿡", label: "비바쿡" },
  { value: "PC토랑", label: "PC토랑" },
  { value: "기타브랜드", label: "기타 브랜드" },
  { value: "브랜드없음", label: "브랜드없음 (직접입력)" },
];

const SURVEY_LEVEL_OPTIONS: { value: SurveyLevel; label: string }[] = [
  { value: "상세", label: "상세" },
  { value: "간략", label: "간략" },
  { value: "외관만", label: "외관만" },
];

const SURVEY_STATE_OPTIONS: { value: CompetitorSurveyState; label: string }[] = [
  { value: "조사완료", label: "조사완료" },
  { value: "경쟁점없음", label: "경쟁점 없음" },
  { value: "노후저경쟁력미조사", label: "노후·저경쟁력 미조사" },
  { value: "오픈예정", label: "오픈예정(미개점)" },
];

const GROUND_LEVEL_OPTIONS: { value: GroundLevel; label: string }[] = [
  { value: "지상", label: "지상" },
  { value: "지하", label: "지하" },
];

const DOW_OPTIONS = ["월", "화", "수", "목", "금", "토", "일"].map((d) => ({ value: d, label: d }));

function blankCompetitor(candidateCode: string): Competitor {
  return {
    id: `${candidateCode}_${Date.now()}`,
    candidateCode,
    name: "",
    surveyLevel: null,
    investigationStatus: "조사완료",
    distanceM: null,
    floor: null,
    groundLevel: null,
    totalPcCount: null,
    appliedPcCount: null,
    hasElevator: null,
    cpu: null,
    cpuTop1: null,
    cpuTop2: null,
    vgaBase: null,
    vgaTop: null,
    vgaTop2: null,
    ram: null,
    ramTop: null,
    monitorBase: null,
    monitorTop: null,
    ratePer1000Won: null,
    hourlyRateConverted: null,
    paidDeduction: null,
    visitedAt: null,
    visitedDow: null,
    visitorCount: null,
    measuredSeatRate: null,
    pingbotUtilization: null,
    pingbotPeriod: null,
    renovationYear: null,
    foodScore: null,
    foodBasis: null,
    foodBrand: null,
    interiorScore: null,
    interiorBasis: null,
    interiorLevelScore: null,
    interiorConditionScore: null,
    monitorBasis: null,
    seatZoneScore: null,
    comfortScore: null,
    room1: null,
    room2: null,
    teamRoom: null,
    coupleZone: null,
    premiumZone: null,
    premiumSpec: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 붙여넣기 파싱 결과를 경쟁점 폼에 얹는다 - 판단이 애매해서 파서가 null로 둔 값(주소·거리·적용대수·
 * 경쟁력 점수 등)은 그대로 비워둬서 사람이 직접 채우게 한다.
 * base가 새 빈 경쟁점이면 매장명도 붙여넣은 이름 그대로 쓰지만, 이미 등록된 경쟁점에 병합하는
 * 경우(2026-08-27 수정)에는 기존 매장명(보통 카카오 자동수집으로 이미 깔끔하게 들어있음)을
 * 점포개발자가 줄여 쓴 이름으로 덮어쓰지 않는다 — 이름이 서로 완전히 다를 수 있다는 사용자 확인
 * ("탑스타pc방" vs "탑스타PC 울산삼산점")으로 발견된 문제.
 */
function applyParsedNote(base: Competitor, note: ParsedCompetitorNote, options: { overwriteName: boolean }): Competitor {
  return {
    ...base,
    name: options.overwriteName ? note.name : base.name,
    surveyLevel: "상세",
    totalPcCount: note.totalPcCount,
    cpu: note.cpu,
    vgaBase: note.vgaBase,
    ram: note.ram,
    monitorBase: note.monitor,
    premiumZone: note.premiumZone,
    coupleZone: note.coupleZone,
    room1: note.room1,
    room2: note.room2,
    teamRoom: note.teamRoom,
    ratePer1000Won: note.ratePer1000Won,
    paidDeduction: note.paidDeduction,
    visitedAt: note.visitedAt,
    visitorCount: note.visitorCount,
    foodBasis: note.foodBasis,
    interiorBasis: note.interiorBasis,
  };
}

const NUMERIC_FIELDS: { key: keyof Competitor; label: string }[] = [
  { key: "distanceM", label: "거리(m)" },
  { key: "floor", label: "층수" },
  { key: "totalPcCount", label: "전체대수" },
  { key: "appliedPcCount", label: "적용대수" },
  { key: "ratePer1000Won", label: "1000원당분" },
  { key: "hourlyRateConverted", label: "시간당환산요금" },
  { key: "visitorCount", label: "이용객수" },
  { key: "measuredSeatRate", label: "실측착석률" },
  { key: "pingbotUtilization", label: "핑봇_가동률" },
  { key: "renovationYear", label: "리뉴얼연도" },
  { key: "room1", label: "1인룸 수" },
  { key: "room2", label: "2인룸 수" },
  { key: "teamRoom", label: "팀룸 수" },
  { key: "coupleZone", label: "커플존 수" },
  { key: "premiumZone", label: "프리미엄존 수" },
];

function validate(form: Competitor): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("경쟁점명을 입력해주세요.");
  for (const f of NUMERIC_FIELDS) {
    const v = form[f.key];
    if (typeof v === "number" && v < 0) errors.push(`${f.label}은(는) 음수가 될 수 없습니다.`);
  }
  // 2026-08-25 추가 — 두 필드는 calc.ts normalizePercentLike가 0~1(비율)과 1~100(퍼센트 숫자)
  // 두 표기를 모두 허용하는 레거시 데이터 호환 방식이라, 상한도 그에 맞춰 100으로 잡는다
  // (0~1로 단정해서 UI를 바꾸면 기존에 퍼센트 숫자로 넣힌 정상 데이터를 틀렸다고 오판하게 됨).
  if (form.measuredSeatRate != null && form.measuredSeatRate > 100) errors.push("실측착석률은 100을 넘을 수 없습니다.");
  if (form.pingbotUtilization != null && form.pingbotUtilization > 100) errors.push("핑봇_가동률은 100을 넘을 수 없습니다.");
  return errors;
}

function CompetitorForm({
  initial,
  onCancel,
  onSaved,
  actor,
}: {
  initial: Competitor;
  onCancel: () => void;
  onSaved: (c: Competitor) => void;
  actor: string | null;
}) {
  const [form, setForm] = useState<Competitor>(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<ModelSettings>({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });

  useEffect(() => {
    getModelSettings().then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  const computed = useMemo(() => computeCompetitorScores(form, settings), [form, settings]);

  function set<K extends keyof Competitor>(key: K, value: Competitor[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;
    setSaving(true);
    try {
      const toSave: Competitor = { ...form, updatedAt: Date.now() };
      await saveCompetitor(toSave, actor);
      onSaved(toSave);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "저장 중 오류가 발생했습니다."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={sectionClass}>
      <h3 className={sectionTitleClass}>경쟁점 {initial.name ? "수정" : "추가"}</h3>

      <div className="app-card-sm mt-3 rounded-lg px-3 py-2 text-xs leading-5 text-[var(--sl-warn)]">
        <strong>조사상태</strong>는 원본 시트에 없던 신규 필드입니다. &ldquo;경쟁점 없음&rdquo;(상권에 경쟁점이 실제로
        없음)과 &ldquo;노후·저경쟁력 미조사&rdquo;(경쟁점은 있으나 노후·저경쟁력이라 상세조사를 생략함)를 구분해
        기록합니다.
      </div>

      <div className={`${gridClass} mt-4`}>
        <TextField label="경쟁점명" value={form.name} onChange={(v) => set("name", v)} required />
        <SelectField
          label="조사상태"
          value={form.investigationStatus}
          onChange={(v) => set("investigationStatus", v ?? "조사완료")}
          options={SURVEY_STATE_OPTIONS}
          required
        />
        <SelectField label="조사수준" value={form.surveyLevel} onChange={(v) => set("surveyLevel", v)} options={SURVEY_LEVEL_OPTIONS} />
        <NumberField label="거리(m)" value={form.distanceM} onChange={(v) => set("distanceM", v)} />
        <NumberField label="층수" value={form.floor} onChange={(v) => set("floor", v)} allowNegative />
        <SelectField label="지상/지하" value={form.groundLevel} onChange={(v) => set("groundLevel", v)} options={GROUND_LEVEL_OPTIONS} />
        <BooleanSelectField label="엘리베이터" value={form.hasElevator} onChange={(v) => set("hasElevator", v)} />
      </div>

      <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">시설/사양</h4>
      <div className={`${gridClass} mt-3`}>
        <NumberField label="전체대수" value={form.totalPcCount} onChange={(v) => set("totalPcCount", v)} />
        <NumberField label="적용대수" value={form.appliedPcCount} onChange={(v) => set("appliedPcCount", v)} hint="실사값 없으면 대체값을 조사 후 입력" />
        <TextField label="VGA 기본" value={form.vgaBase ?? ""} onChange={(v) => set("vgaBase", v || null)} />
        <TextField label="VGA 특화1" value={form.vgaTop ?? ""} onChange={(v) => set("vgaTop", v || null)} />
        <TextField label="VGA 특화2" value={form.vgaTop2 ?? ""} onChange={(v) => set("vgaTop2", v || null)} />
        <TextField label="CPU 기본" value={form.cpu ?? ""} onChange={(v) => set("cpu", v || null)} />
        <TextField label="CPU 특화1" value={form.cpuTop1 ?? ""} onChange={(v) => set("cpuTop1", v || null)} />
        <TextField label="CPU 특화2" value={form.cpuTop2 ?? ""} onChange={(v) => set("cpuTop2", v || null)} />
        <TextField label="RAM 기본" value={form.ram ?? ""} onChange={(v) => set("ram", v || null)} />
        <TextField label="RAM 특화" value={form.ramTop ?? ""} onChange={(v) => set("ramTop", v || null)} />
        <TextField label="모니터 기본" value={form.monitorBase ?? ""} onChange={(v) => set("monitorBase", v || null)} hint="주사율(Hz)에서 자동채점" />
        <TextField label="모니터 특화" value={form.monitorTop ?? ""} onChange={(v) => set("monitorTop", v || null)} />
        <NumberField label="1000원당분" value={form.ratePer1000Won} onChange={(v) => set("ratePer1000Won", v)} />
        <NumberField label="시간당환산요금" value={form.hourlyRateConverted} onChange={(v) => set("hourlyRateConverted", v)} />
        <TextField label="유료차감" value={form.paidDeduction ?? ""} onChange={(v) => set("paidDeduction", v || null)} />
      </div>

      <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">실측</h4>
      <div className={`${gridClass} mt-3`}>
        <TextField label="방문일시" value={form.visitedAt ?? ""} onChange={(v) => set("visitedAt", v || null)} placeholder="예: 2026-08-01 14:30" />
        <SelectField label="방문요일" value={form.visitedDow} onChange={(v) => set("visitedDow", v)} options={DOW_OPTIONS} />
        <NumberField label="이용객수" value={form.visitorCount} onChange={(v) => set("visitorCount", v)} />
        <NumberField label="실측착석률" value={form.measuredSeatRate} onChange={(v) => set("measuredSeatRate", v)} step={0.01} hint="0~1 사이 비율" />
        <NumberField label="핑봇_가동률" value={form.pingbotUtilization} onChange={(v) => set("pingbotUtilization", v)} step={0.01} hint="0~1 사이 비율" />
        <TextField label="핑봇_조회기간" value={form.pingbotPeriod ?? ""} onChange={(v) => set("pingbotPeriod", v || null)} />
        <NumberField label="리뉴얼연도" value={form.renovationYear} onChange={(v) => set("renovationYear", v)} step={1} />
      </div>

      <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">
        경쟁력 점수 및 평가근거
      </h4>
      <p className="mt-1 text-xs text-[#8a8072]">
        하드웨어·입지 점수는 위 VGA/CPU/RAM/모니터·층수+엘리베이터로부터 자동 계산됩니다. 조사수준이
        간략/외관만이면 미입력 항목은 기본값(2.0/1.5)으로 채워집니다.
      </p>
      <div className={`${gridClass} mt-3`}>
        <ComputedField label="하드웨어 점수 (자동)" value={computed.spec} hint="GPU40%+모니터25%+CPU20%+RAM15%+프리미엄존 가산" />
        <ComputedField label="입지 점수 (자동)" value={computed.location} hint="층수+엘리베이터+지상/지하" />
        <SelectField
          label="먹거리 브랜드"
          value={form.foodBrand}
          onChange={(v) => set("foodBrand", v)}
          options={FOOD_BRAND_OPTIONS}
          hint="브랜드를 고르면 설정에 등록된 점수를 자동 적용"
        />
        {(form.foodBrand == null || form.foodBrand === "브랜드없음") && (
          <ScoreSelectField
            label="먹거리 점수 (직접입력)"
            value={form.foodScore}
            onChange={(v) => set("foodScore", v)}
            hint="브랜드없음/미정일 때 직접 평가"
          />
        )}
        <ComputedField label="먹거리 점수 (최종)" value={computed.food} />
        <ScoreSelectField
          label="좌석·존구성"
          value={form.seatZoneScore}
          onChange={(v) => set("seatZoneScore", v)}
          step={0.5}
          hint="4.0=블랙라벨과 동급(팀룸·2인룸·커플존·1인룸·프렌즈/VIP존 등) · 칸막이만 있으면 독립룸 미인정"
        />
        <ScoreSelectField label="최신성·디자인" value={form.interiorLevelScore} onChange={(v) => set("interiorLevelScore", v)} step={0.5} hint="마감·컨셉 퀄리티" />
        <ScoreSelectField label="청결·관리상태" value={form.interiorConditionScore} onChange={(v) => set("interiorConditionScore", v)} step={0.5} hint="청결도·노후도" />
        <ScoreSelectField label="편의성" value={form.comfortScore} onChange={(v) => set("comfortScore", v)} step={0.5} hint="냄새·조명·화장실·편의시설" />
        {form.seatZoneScore == null && form.interiorLevelScore == null && form.interiorConditionScore == null && form.comfortScore == null && (
          <ScoreSelectField
            label="인테리어·좌석·관리 점수 (직접입력)"
            value={form.interiorScore}
            onChange={(v) => set("interiorScore", v)}
            hint="위 세부항목을 넷 다 안 채웠을 때 직접 평가"
          />
        )}
        <ComputedField label="인테리어·좌석·관리 점수 (최종)" value={computed.interior} />
      </div>
      <p className="mt-2 text-xs text-[#8a8072]">종합 경쟁력점수: {computed.total ?? "-"}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextAreaField label="먹거리 근거" value={form.foodBasis ?? ""} onChange={(v) => set("foodBasis", v || null)} rows={2} />
        <TextAreaField label="인테리어·좌석·관리 근거" value={form.interiorBasis ?? ""} onChange={(v) => set("interiorBasis", v || null)} rows={2} />
        <TextAreaField label="모니터 근거" value={form.monitorBasis ?? ""} onChange={(v) => set("monitorBasis", v || null)} rows={2} />
      </div>

      <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[#8a8072]">존 구성</h4>
      <div className={`${gridClass} mt-3`}>
        <NumberField label="1인룸 수" value={form.room1} onChange={(v) => set("room1", v)} />
        <NumberField label="2인룸 수" value={form.room2} onChange={(v) => set("room2", v)} />
        <NumberField label="팀룸 수" value={form.teamRoom} onChange={(v) => set("teamRoom", v)} />
        <NumberField label="커플존 수" value={form.coupleZone} onChange={(v) => set("coupleZone", v)} />
        <NumberField label="프리미엄존 수" value={form.premiumZone} onChange={(v) => set("premiumZone", v)} />
        <BooleanSelectField label="프리미엄 사양 여부" value={form.premiumSpec} onChange={(v) => set("premiumSpec", v)} />
      </div>

      {errors.length > 0 && (
        <div className="app-badge app-badge-danger mt-4 w-full justify-start px-3 py-2 text-sm">
          <ul className="list-inside list-disc">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-3 print:hidden">
        <button type="button" onClick={onCancel} className="app-btn-outline rounded-lg px-4 py-2 text-sm">
          취소
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleSubmit}
          className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </section>
  );
}

export function CompetitorsTab({ candidateCode }: { candidateCode: string }) {
  const { user } = useAuth();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ModelSettings>({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });

  // 붙여넣기로 일괄 입력(2026-08-27) - 점포개발자가 남기는 "경쟁점 설명" 텍스트를 결정적으로
  // (AI 아님, competitorNoteParse.ts) 파싱해 미리보기로 보여주고, 하나씩 골라 폼에 채운다.
  // 자동저장은 하지 않는다 - 기존 흐름과 동일하게 사람이 폼에서 검토 후 "저장"을 눌러야 한다.
  const [pasteText, setPasteText] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [parsedNotes, setParsedNotes] = useState<ParsedCompetitorNote[]>([]);
  const [prefill, setPrefill] = useState<Competitor | null>(null);
  // 2026-08-27 수정 — 매장명이 완전히 같지 않은 경우가 많다는 사용자 확인(예: "레드포스아레나" vs
  // "레드포스pc아레나 삼산점")으로 자동 이름매칭을 없애고, 병합 대상을 사람이 직접 고르게 한다.
  // 값은 "new" 또는 기존 경쟁점 id. 파싱 직후 이름이 정확히 같은 경쟁점이 있으면 기본값으로만
  // 미리 선택해두고, 최종 판단은 항상 사람이 드롭다운에서 확인/변경한다.
  const [mergeTargets, setMergeTargets] = useState<Record<number, string>>({});

  function handleParsePaste() {
    const notes = parseCompetitorNotes(pasteText);
    setParsedNotes(notes);
    const defaults: Record<number, string> = {};
    notes.forEach((note, i) => {
      defaults[i] = findMatchingCompetitor(note.name)?.id ?? "new";
    });
    setMergeTargets(defaults);
  }

  /** 공백만 다르고 사실상 같은 이름이면 매칭시키기 위한 정규화(대소문자·공백 무시). */
  function normalizeCompetitorName(name: string): string {
    return name.replace(/\s+/g, "").toLowerCase();
  }

  function findMatchingCompetitor(name: string): Competitor | null {
    const normalized = normalizeCompetitorName(name);
    return competitors.find((c) => normalizeCompetitorName(c.name) === normalized) ?? null;
  }

  // 2026-08-27 수정 — 병합 대상(새 경쟁점 vs 기존 경쟁점)을 사람이 드롭다운에서 고른 뒤 이 함수를
  // 호출한다. 기존 경쟁점을 골랐으면 그 위에 붙여넣기 값만 덮어쓴다(거리·주소·적용대수·경쟁력
  // 점수처럼 파서가 못 읽는 기존 값을 보존하기 위함) — 예전엔 항상 빈 폼에서 시작해서, 이미 거리를
  // 입력해둔 경쟁점을 다시 붙여넣으면 그 값이 사라지는 문제가 있었다(사용자가 실사용 중 발견).
  function handleFillFromParsed(note: ParsedCompetitorNote, targetId: string) {
    const matched = targetId === "new" ? null : competitors.find((c) => c.id === targetId) ?? null;
    if (matched) {
      setPrefill(applyParsedNote(matched, note, { overwriteName: false }));
      setEditingId(matched.id);
    } else {
      setPrefill(applyParsedNote(blankCompetitor(candidateCode), note, { overwriteName: true }));
      setEditingId("new");
    }
  }

  useEffect(() => {
    getModelSettings().then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCompetitors(candidateCode);
      setCompetitors(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "경쟁점 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [candidateCode]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    if (!confirm("이 경쟁점을 삭제하시겠습니까?")) return;
    setBusyId(id);
    setError(null);
    try {
      await deleteCompetitor(id, user?.email ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  // prefill이 있으면(붙여넣기로 채운 경우) 그걸 우선한다 - editingId가 기존 경쟁점 id를 가리켜도
  // (기존 데이터에 병합) 그 위에 얹은 prefill을 보여줘야 하기 때문이다.
  const editingCompetitor =
    prefill ?? (editingId === "new" ? blankCompetitor(candidateCode) : competitors.find((c) => c.id === editingId) ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">경쟁점</h2>
          <p className="mt-1 text-sm text-[#8a8072]">이 후보지 반경 내 경쟁점 정보를 입력합니다.</p>
        </div>
        {editingId === null && (
          <div className="flex gap-2 print:hidden">
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="app-btn-outline rounded-lg px-4 py-2 text-sm"
            >
              {pasteOpen ? "붙여넣기 닫기" : "붙여넣기로 일괄 입력"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPrefill(null);
                setEditingId("new");
              }}
              className="app-btn-primary rounded-lg px-4 py-2 text-sm"
            >
              + 경쟁점 추가
            </button>
          </div>
        )}
      </div>

      {pasteOpen && editingId === null && (
        <section className={sectionClass}>
          <h3 className={sectionTitleClass}>경쟁점 설명 붙여넣기</h3>
          <p className="mt-1 text-xs text-[#8a8072]">
            점포개발자가 남긴 &ldquo;경쟁점 설명&rdquo; 텍스트를 통째로 붙여넣으면 매장명·사양·존구성·방문기록·종합평가를
            자동으로 나눠 인식합니다(AI 아닌 텍스트 매칭). 자동으로 저장되지 않으니, 매장을 하나씩 골라 폼에 채운 뒤
            직접 검토하고 저장해주세요. 적용대수·거리·경쟁력 점수는 판단이 필요해 자동으로 채우지 않습니다.
          </p>
          <TextAreaField label="붙여넣기" value={pasteText} onChange={setPasteText} rows={8} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleParsePaste} className="app-btn-primary rounded-lg px-4 py-2 text-sm">
              분석
            </button>
            {parsedNotes.length > 0 && <span className="text-xs text-[#8a8072]">{parsedNotes.length}곳 인식됨</span>}
          </div>
          {parsedNotes.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {parsedNotes.map((note, i) => (
                <div key={`${note.name}_${i}`} className="app-card-sm rounded-lg p-3 text-xs">
                  <p className="font-semibold text-[#171310] dark:text-[#f2ede2]">{note.name}</p>
                  <p className="mt-0.5 text-[#8a8072]">
                    전체 {note.totalPcCount ?? "-"}대 · {note.cpu ?? "-"} · {note.vgaBase ?? "-"}
                  </p>
                  <p className="mt-0.5 text-[#8a8072]">방문 {note.visitedAt ?? "-"} · {note.visitorCount ?? "-"}명</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={mergeTargets[i] ?? "new"}
                      onChange={(e) => setMergeTargets((prev) => ({ ...prev, [i]: e.target.value }))}
                      className="app-input px-2 py-1 text-[11px]"
                    >
                      <option value="new">새 경쟁점으로 추가</option>
                      {competitors.map((c) => (
                        <option key={c.id} value={c.id}>
                          기존: {c.name || "(이름 없음)"}{c.distanceM != null ? ` · ${c.distanceM}m` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleFillFromParsed(note, mergeTargets[i] ?? "new")}
                      className="app-btn-outline shrink-0 rounded-md px-2 py-1 text-[11px]"
                    >
                      폼에 채우기
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-[#8a8072]">
                    이름이 자동으로 안 맞을 수 있어(예: &ldquo;탑스타pc방&rdquo; vs &ldquo;탑스타PC 울산삼산점&rdquo;) 병합할
                    기존 경쟁점을 직접 확인하고 골라주세요. 이미 이름이 똑같은 경쟁점이 있으면 기본으로 선택해둡니다.
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {error && (
        <p className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
      )}

      {/* 2026-08-25 추가 — "실제 조사 경쟁점 수"를 조사수준별로 쪼개서 바로 보여준다. 이미
          existing-store 검증화면에서만 쓰던 computeCompetitorInvestigationSummary(calc.ts)를
          여기서도 재사용할 뿐 새 산식은 없다. "몇 곳 중 몇 곳을 얼마나 자세히 봤는지"를 입력
          단계에서부터 알 수 있게 한다. */}
      {!loading && competitors.length > 0 && (
        <div className="app-card-sm flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl px-4 py-3 text-xs text-[#5c5346] dark:text-[#c9bfae]">
          {(() => {
            const summary = computeCompetitorInvestigationSummary(competitors);
            return (
              <>
                <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">경쟁점 총 {summary.totalCount}곳</span>
                <span>상세조사 {summary.detailedCount}곳</span>
                <span>간략·외관조사 {summary.lightCount}곳</span>
                <span>미조사 {summary.uninvestigatedCount}곳</span>
                {summary.status === "confirmed_no_competitor" && (
                  <span className="font-medium text-[var(--sl-ok)]">확인된 독점상권(경쟁점 없음)</span>
                )}
                <span
                  className={
                    summary.dataReliability === "high"
                      ? "text-[var(--sl-ok)]"
                      : summary.dataReliability === "medium"
                        ? "text-[var(--sl-warn)]"
                        : "text-[var(--sl-danger)]"
                  }
                >
                  데이터 신뢰도: {summary.dataReliability === "high" ? "높음" : summary.dataReliability === "medium" ? "보통" : "낮음"}
                </span>
              </>
            );
          })()}
        </div>
      )}

      {editingCompetitor && (
        <CompetitorForm
          initial={editingCompetitor}
          actor={user?.email ?? null}
          onCancel={() => {
            setEditingId(null);
            setPrefill(null);
          }}
          onSaved={async () => {
            setEditingId(null);
            setPrefill(null);
            await load();
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-[#8a8072]">불러오는 중...</p>
      ) : competitors.length === 0 ? (
        <p className="app-card rounded-2xl border-dashed px-4 py-8 text-center text-sm text-[#8a8072]">
          등록된 경쟁점이 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {competitors.map((c) => (
            <div key={c.id} className={sectionClass}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-[#171310] dark:text-[#f2ede2]">{c.name || "(이름 없음)"}</p>
                </div>
                <span
                  className={`app-badge shrink-0 ${
                    c.investigationStatus === "조사완료"
                      ? "app-badge-ok"
                      : c.investigationStatus === "경쟁점없음"
                        ? "app-badge-neutral"
                        : "app-badge-warn"
                  }`}
                >
                  {SURVEY_STATE_OPTIONS.find((o) => o.value === c.investigationStatus)?.label ?? c.investigationStatus}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#5c5346] dark:text-[#c9bfae]">
                <div>
                  <dt className="inline text-[#8a8072]">거리 </dt>
                  <dd className="inline">{c.distanceM != null ? `${c.distanceM}m` : "-"}</dd>
                </div>
                <div>
                  <dt className="inline text-[#8a8072]">적용대수 </dt>
                  <dd className="inline">{c.appliedPcCount ?? c.totalPcCount ?? "-"}</dd>
                </div>
                <div>
                  <dt className="inline text-[#8a8072]">조사수준 </dt>
                  <dd className="inline">{c.surveyLevel ?? "-"}</dd>
                </div>
                <div>
                  <dt className="inline text-[#8a8072]">경쟁력점수 </dt>
                  <dd className="inline">{computeCompetitorScores(c, settings).total ?? "-"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex justify-end gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => setEditingId(c.id)}
                  className="app-btn-outline rounded-md px-2.5 py-1 text-xs"
                >
                  수정
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => handleDelete(c.id)}
                  className="rounded-md border border-[var(--sl-danger)]/30 px-2.5 py-1 text-xs font-medium text-[var(--sl-danger)] hover:bg-[var(--sl-danger-soft)] disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
