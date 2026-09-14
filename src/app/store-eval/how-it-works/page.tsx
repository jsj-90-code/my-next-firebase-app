"use client";

// 매출 계산법 설명 화면 - 2026-08-27 추가.
// 사용자 요청: "중고등학생정도가 봐도 이해할수 있도록, rawdemand·비음수 릿지회귀 같은 전문용어
// 넣지말고 알기쉽게 적되 상세히, 예상매출까지 나오는 과정을" — calc.ts/evaluate.ts의 실제 계산
// 순서(수요→점유율→매출)를 그대로 따라가되, 전문용어 없이 쉬운 말로 풀어 쓴다. 새 계산을 만들지
// 않고 이미 있는 계산 흐름을 설명만 한다.
//
// 2026-09-14 — 사용자 지적: "지금 정의 같은 형태로만 적혀 있는데, 실제 계산이 어떻게 진행되는지
// 이해할 수 있는 자료가 되는 게 더 좋겠다." 맞는 지적이었다. 설명만 있고 **숫자가 하나도 없어서**
// 읽고 나도 "그래서 이 후보지 5,300만원이 어디서 나왔나"에 답이 안 됐다. 그래서 실제 후보지를
// 골라 각 단계에 그 후보지의 진짜 숫자가 흘러가는 표를 붙인다.
//
// 숫자는 calcWalkthrough.ts가 만든다 — 거기서도 새 산식을 쓰지 않고 기존 계산 함수와 저장된
// 평가결과의 중간값만 꺼낸다(그 파일 주석 참고). 고정 예시를 박아두지 않은 이유는, 산식이나
// 설정이 바뀌면 화면이 조용히 낡은 숫자를 보여주게 되기 때문이다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { sectionClass, sectionTitleClass } from "../candidates/[code]/formFields";
import { buildCompetitivenessWeights, buildWalkthrough, type WalkRow, type WalkStep } from "@/lib/storeEval/calcWalkthrough";
import { getModelSettings, listCandidates, listEvaluationResults } from "@/lib/storeEval/store";
import type { CandidateInput, EvaluationResult, ModelSettings } from "@/lib/storeEval/types";
import { formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";

function StepBadge({ n, color }: { n: number; color: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {n}
    </span>
  );
}

function formatRowValue(row: WalkRow): string {
  if (row.value == null) return "-";
  if (typeof row.value === "string") return row.value;
  switch (row.kind) {
    case "won":
      return formatWon(row.value);
    case "count":
      // 원수요처럼 소수가 나오는 값이 있다 — 사람 수·대수 자리라 반올림해서 보여준다.
      return formatNumber(Math.round(row.value));
    case "hours":
      return `${formatNumber(Math.round(row.value))}시간`;
    case "percent":
      return formatPercent(row.value);
    case "score":
      return formatScore(row.value);
    case "multiple":
      return `×${row.value.toFixed(2)}`;
    default:
      return String(row.value);
  }
}

/**
 * 표(table)가 아니라 목록으로 그린다 — 좁은 화면에서 가로 스크롤이 생기지 않게 하려는 것이다
 * (2026-09-13에 표 14개를 390px에서 실측한 결과 참고).
 */
function WalkRows({ step }: { step: WalkStep }) {
  return (
    <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
      <p className="text-xs font-semibold text-[var(--sl-ink-soft)]">이 후보지의 실제 숫자</p>
      <dl className="mt-2 flex flex-col divide-y divide-[var(--sl-line)]">
        {step.rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <dt
                className={
                  row.result
                    ? "text-sm font-semibold text-[#171310] dark:text-[#f2ede2]"
                    : "text-sm text-[#5c5346] dark:text-[#c9bfae]"
                }
              >
                {row.label}
              </dt>
              <dd
                className={
                  row.result
                    ? "ml-auto font-mono text-sm font-semibold tabular-nums text-[#171310] dark:text-[#f2ede2]"
                    : "ml-auto font-mono text-sm tabular-nums text-[#5c5346] dark:text-[#c9bfae]"
                }
              >
                {formatRowValue(row)}
              </dd>
            </div>
            {row.note && <p className="text-[11px] leading-4 text-[var(--sl-ink-soft)]">{row.note}</p>}
          </div>
        ))}
      </dl>
      {step.blocked && (
        <p className="app-notice app-badge-warn mt-3 w-full items-start justify-start px-3 py-2 text-left text-[11px] leading-4">
          <span>{step.blocked}</span>
        </p>
      )}
    </div>
  );
}

export default function HowItWorksPage() {
  const [candidates, setCandidates] = useState<CandidateInput[]>([]);
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  // 후보지 목록 화면과 같은 방식 — loading은 true로 시작하고 여기서는 끌 때만 건드린다.
  // 효과 안에서 동기적으로 setState를 하면 렌더가 연쇄된다(react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    const sequence = ++loadSequence.current;
    // 세 번만 읽고 끝낸다 — 후보지를 바꿔도 추가 조회가 없다(무료 한도 대비 읽기 절약).
    return Promise.all([listCandidates(), listEvaluationResults(), getModelSettings()])
      .then(([list, stored, modelSettings]) => {
        if (sequence !== loadSequence.current) return;
        setCandidates(list);
        setResults(stored);
        setSettings(modelSettings);
        const withResult = list.find((c) => stored.some((r) => r.candidateCode === c.code && r.v62Final != null));
        setCode((prev) => prev || withResult?.code || list[0]?.code || "");
      })
      .catch(() => {
        if (sequence === loadSequence.current) setError("자료를 불러오지 못했습니다. 다시 불러오기를 눌러주세요.");
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const requests = loadSequence;
    void load();
    return () => { requests.current++; };
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  const candidate = useMemo(() => candidates.find((c) => c.code === code) ?? null, [candidates, code]);
  const result = useMemo(() => results.find((r) => r.candidateCode === code) ?? null, [results, code]);
  const walkthrough = useMemo(
    () => (candidate && settings ? buildWalkthrough(candidate, result, settings) : null),
    [candidate, result, settings],
  );
  const weightRows = useMemo(() => (settings ? buildCompetitivenessWeights(settings) : []), [settings]);
  const stepOf = useCallback(
    (n: 1 | 2 | 3) => walkthrough?.steps.find((s) => s.step === n) ?? null,
    [walkthrough],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">매출은 어떻게 계산될까?</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          이 프로그램은 후보지 하나(또는 이미 문을 연 매장)의 &ldquo;한 달 예상 매출&rdquo; 숫자 하나를 뽑아내기까지, 사실 세 단계를
          순서대로 거칩니다. 전문 용어 없이, 그 세 단계를 그대로 따라가면서 설명합니다. 아래에서 실제 후보지를 하나 고르면
          <strong> 그 후보지의 진짜 숫자가 단계마다 어떻게 바뀌어 가는지</strong> 같이 보여드립니다.
        </p>
      </div>

      {/* 후보지 선택 */}
      <div className="app-card-sm rounded-lg px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="walkthrough-candidate" className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
            숫자로 따라가 볼 후보지
          </label>
          <select
            id="walkthrough-candidate"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={loading || candidates.length === 0}
            className="app-input min-w-0 flex-1 px-2.5 py-1.5 text-sm sm:flex-none sm:min-w-[16rem]"
          >
            {candidates.length === 0 && <option value="">{loading ? "불러오는 중…" : "등록된 후보지가 없습니다"}</option>}
            {candidates.map((c) => {
              const hasResult = results.some((r) => r.candidateCode === c.code && r.v62Final != null);
              return (
                <option key={c.code} value={c.code}>
                  {c.code} {c.name ?? ""}
                  {hasResult ? "" : " (계산 전)"}
                </option>
              );
            })}
          </select>
          <button type="button" onClick={refresh} disabled={loading} className="app-btn-outline px-3 py-1.5 text-sm disabled:opacity-50">
            {loading ? "불러오는 중…" : "다시 불러오기"}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-[var(--sl-ink-soft)]" role="status" aria-live="polite">
          {error
            ? error
            : loading
              ? "후보지를 불러오고 있습니다."
              : walkthrough
                ? `${walkthrough.modelLabel} 기준으로 계산된 결과입니다. 아래 숫자는 새로 계산한 게 아니라 저장된 평가 결과에서 그대로 꺼낸 값입니다.`
                : candidate
                  ? "이 후보지는 아직 계산한 적이 없습니다. 후보지 상세의 최종결과 탭에서 계산을 먼저 실행해 주세요."
                  : "후보지를 고르면 단계마다 실제 숫자가 함께 표시됩니다."}
        </p>
        {walkthrough?.inputsChangedSinceResult && (
          <p className="app-notice app-badge-warn mt-2 w-full items-start justify-start px-3 py-2 text-left text-[11px] leading-4">
            <span>
              저장된 결과를 계산한 뒤에 기본정보가 바뀌었습니다. 1단계는 <strong>지금 입력</strong> 기준이고 2·3단계는
              <strong> 저장된 결과</strong> 기준이라 숫자가 서로 안 맞을 수 있습니다.{" "}
              <Link href={`/store-eval/candidates/${code}`} className="underline">
                최종결과 탭에서 다시 계산
              </Link>
              하면 맞춰집니다.
            </span>
          </p>
        )}
      </div>

      <div className="app-card-sm rounded-lg px-4 py-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
        <strong className="text-[#171310] dark:text-[#f2ede2]">세 단계 한눈에 보기</strong>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="app-badge app-badge-info">1. 수요 — 동네가 원하는 양</span>
          <span className="hidden text-[#c9bfae] sm:inline">→</span>
          <span className="app-badge app-badge-warn">2. 몫 — 우리가 가져갈 비율</span>
          <span className="hidden text-[#c9bfae] sm:inline">→</span>
          <span className="app-badge app-badge-ok">3. 매출 — 실제 돈으로 환산</span>
        </div>
      </div>

      {/* 1단계 */}
      <section className={sectionClass}>
        <div className="flex items-start gap-3">
          <StepBadge n={1} color="var(--sl-step-c)" />
          <div className="min-w-0 flex-1">
            <h2 className={`${sectionTitleClass} text-base`}>이 동네는 PC방을 얼마나 원할까? (수요)</h2>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              먼저 후보지 주변에 <strong>사는 사람 수</strong>(거주인구)와 <strong>지나다니는 사람 수</strong>(유동인구)를
              조사합니다. 그런데 이 사람들이 전부 PC방에 가는 건 아니죠. 나이대에 따라 PC방에 가는 비율이 완전히 다릅니다.
            </p>

            <ul className="mt-3 list-inside list-disc space-y-1 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              <li>10~20대 남학생은 열 명 중 4명 정도가 PC방을 이용해요.</li>
              <li>10~20대 여학생은 열 명 중 1~1.5명 정도예요.</li>
              <li>나이가 들수록 이용하는 비율이 뚝뚝 떨어져서, 50대는 남녀 합쳐도 서른 명 중 한 명이 안 돼요.</li>
            </ul>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              그래서 &ldquo;이 동네 사람이 몇 명인가&rdquo;가 아니라, <strong>나이대·성별로 나눠서 &ldquo;PC방에 갈 것 같은
              사람이 몇 명인가&rdquo;</strong>를 하나하나 계산해서 더합니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              그다음 이 동네가 <strong>번화가인지, 주택가인지</strong>를 봅니다. 지나다니는 사람이 사는 사람보다 8배 넘게
              많으면 번화가, 4~8배면 그 중간, 그보다 적으면 주택가로 나눠요. 번화가면 지나다니는 사람(유동인구) 기준으로,
              주택가면 사는 사람(거주인구) 기준으로 방금 구한 수요를 씁니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              마지막으로 한 번 더 깎습니다. &ldquo;PC방에 갈 성향이 있는 사람&rdquo;이라고 매일 가는 건 아니니까요. 그래서
              동네 성격마다 정해둔 <strong>인정 비율</strong>만큼만 실제 수요로 칩니다. 이 비율은 &ldquo;예측이 실제 매출보다
              높았나 낮았나&rdquo;를 상권 성격별로 재서 맞춰온 값이라 바뀝니다 — 그래서 여기에 숫자를 적어두지 않고
              <strong> 아래 표에 지금 설정된 값을 그대로</strong> 보여줍니다.
            </p>

            {stepOf(1) && <WalkRows step={stepOf(1)!} />}

            <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">이렇게 나온 숫자 = &ldquo;이 상권 전체가 원하는 PC방 수요&rdquo;</p>
              <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
                아직 &ldquo;우리 매장&rdquo; 것이 아니에요. 이 동네에 있는 모든 PC방이 나눠 가질 파이 전체의 크기입니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2단계 */}
      <section className={sectionClass}>
        <div className="flex items-start gap-3">
          <StepBadge n={2} color="var(--sl-step-a)" />
          <div className="min-w-0 flex-1">
            <h2 className={`${sectionTitleClass} text-base`}>그 중에서 우리 매장은 몇 명을 데려올까? (몫)</h2>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              이제 이 동네에 있는 다른 PC방들(경쟁매장)과 비교합니다. 먼저 <strong>&ldquo;우리 매장이 경쟁매장보다 얼마나
              좋은가&rdquo;</strong>를 점수로 매깁니다. 5가지를 봐요:
            </p>

            {/* 비중을 글자로 박아두면 반드시 낡는다 — 실제로 2026-08-28·09-03 두 번 바뀌는 동안
                이 목록만 2026-08-27 값으로 남아 있었다. 설정에서 읽어 그린다. */}
            <div className="mt-3 flex flex-col gap-2">
              {weightRows.map((row) => (
                <div key={row.label} className="grid grid-cols-[64px_1fr] items-baseline gap-3 text-sm sm:grid-cols-[64px_56px_1fr]">
                  <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{row.label}</span>
                  <span className="font-mono tabular-nums text-[var(--sl-step-a-ink)]">{formatPercent(row.pct)}</span>
                  <span className="text-xs text-[var(--sl-ink-soft)] sm:col-start-3">
                    {row.desc}
                    {row.parts && (
                      <span className="mt-0.5 block">
                        이 안에서 — {row.parts.map((part) => `${part.label} ${formatPercent(part.pct, 0)}`).join(" · ")}
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {weightRows.length === 0 && (
                <p className="text-xs text-[var(--sl-ink-soft)]">운영설정을 불러오면 지금 적용된 비중이 여기에 표시됩니다.</p>
              )}
            </div>

            <p className="mt-4 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              이 5개를 다 더해서 <strong>우리 매장 점수</strong>와 <strong>경쟁매장들 평균 점수</strong>를 각각 구하고, 우리
              점수를 경쟁매장 점수로 나눕니다. 이게 1보다 크면 우리가 더 낫다는 뜻이고, 1보다 작으면 우리가 밀린다는
              뜻이에요.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              그다음 <strong>PC 대수</strong>를 봅니다. 경쟁매장들 PC대수를 다 더한 것과, 우리 PC대수에 방금 구한
              &ldquo;우리가 더 나은 정도&rdquo;를 곱한 값을 비교해서, 그 비율만큼 손님을 가져갑니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              쉽게 말하면: <strong>PC 대수가 많을수록, 그리고 경쟁매장보다 시설이 좋을수록 더 큰 몫을 가져간다</strong>는
              거예요. 만약 이 동네에 경쟁매장이 하나도 없다면? 파이를 통째로 다 우리가 가져갑니다.
            </p>

            {stepOf(2) && <WalkRows step={stepOf(2)!} />}

            <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">1단계 수요 × 2단계 몫 비율 = &ldquo;우리 매장으로 올 손님 수&rdquo;</p>
              <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
                이 숫자는 화면에 참고용으로 계속 보여드리지만, 3단계 계산에는 안 씁니다 — 3단계는 1단계 동네 수요와 이
                동네 경쟁 정도를 각각 따로 넘겨줍니다(바로 아래 참고).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3단계 */}
      <section className={sectionClass}>
        <div className="flex items-start gap-3">
          <StepBadge n={3} color="var(--sl-step-b)" />
          <div className="min-w-0 flex-1">
            <h2 className={`${sectionTitleClass} text-base`}>그 손님들이 얼마를 써줄까? (진짜 매출로 바꾸기)</h2>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              다른 가맹점의 월별 기록에서 <strong>PC매출과 먹거리 매출을 나눠</strong> 봅니다.
              PC매출을 등록된 시간당요금으로 나눠 이용시간을 추정하고, 비슷한 수요·경쟁·입지를 가진 매장에서
              이용시간과 먹거리 매출이 얼마나 나오는지 각각 학습합니다. 참고할 자료가 부족하면 매출을 표시하지 않습니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              후보지의 수요·경쟁력·입지를 넣어 예상 PC 이용시간과 먹거리 매출을 구합니다.
              <strong>예상 PC 이용시간 × 입력한 시간당요금 + 먹거리 매출</strong>이 기본 예상 매출입니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              (2026-09-10 바뀜) 요금을 내리면 매출이 그만큼 그대로 줄어들까요? <strong>아닙니다.</strong> 예전에는
              &ldquo;요금을 3분의 2로 내리면 PC매출도 3분의 2&rdquo;로 계산했는데, 실제 가맹점 38곳의 기록을 보니
              <strong> 요금이 비싼 매장이 그만큼 더 벌지는 않았습니다</strong>(요금을 내리면 손님이 더 오래 쓰기
              때문입니다). 그래서 지금은 그 관계를 실제 기록에서 배워서 씁니다 — 1,500원을 1,000원으로 내리면
              PC매출은 3분의 2가 아니라 <strong>대략 85% 수준</strong>이 됩니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              (2026-08-30 바뀜) 예전에는 &ldquo;2단계에서 이미 몫까지 나눈 손님 수&rdquo; 하나로 뭉쳐서 넣었는데, 실제
              매출 기록과 비교해보니 이 숫자 하나로는 설명이 거의 안 됐습니다. 알고 보니 &ldquo;경쟁이 많으면 무조건
              나쁘다&rdquo;는 가정 자체가 틀렸던 거예요 — 오히려 경쟁이 많은 동네일수록 상권 자체가 커서 매출이 더 높은
              경우가 많았습니다. 그래서 이제는 &ldquo;동네 수요&rdquo;와 &ldquo;경쟁 정도&rdquo;를 따로따로 알려주고,
              둘의 관계를 컴퓨터가 실제 매출 기록을 보면서 직접 찾아내게 바꿨습니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              마지막으로 딱 한 번 더 조정합니다. &ldquo;이 동네 사람들이 다른 동네로 잘 안 새어나가는지, 아니면 근처에 더
              좋은 선택지가 있어서 손님을 뺏길 가능성이 있는지&rdquo;를 봐서:
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="app-card-sm flex-1 rounded-lg px-4 py-3">
                <p className="text-xs text-[var(--sl-ink-soft)]">문제없음</p>
                <p className="mt-1 font-mono text-sm text-[#171310] dark:text-[#f2ede2]">그대로 (0%)</p>
              </div>
              <div className="app-card-sm flex-1 rounded-lg px-4 py-3">
                <p className="text-xs text-[var(--sl-ink-soft)]">보통</p>
                <p className="mt-1 font-mono text-sm text-[#171310] dark:text-[#f2ede2]">3% 깎음</p>
              </div>
              <div className="app-card-sm flex-1 rounded-lg px-4 py-3">
                <p className="text-xs text-[var(--sl-ink-soft)]">심함(손님 이탈 우려)</p>
                <p className="mt-1 font-mono text-sm text-[#171310] dark:text-[#f2ede2]">20% 깎음</p>
              </div>
            </div>

            {stepOf(3) && <WalkRows step={stepOf(3)!} />}

            <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">이렇게 나온 최종 숫자 = &ldquo;예상 월매출&rdquo;</p>
              <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
                여기에 &ldquo;조금 낮춰 잡은 보수적인 예상치&rdquo;(85%)와 &ldquo;잘 되면 이 정도까지&rdquo;(115%)도 같이
                보여줘서, 숫자 하나만 믿지 말고 범위로 판단하게 합니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 정리 */}
      <section className={sectionClass}>
        <h2 className={`${sectionTitleClass} text-base`}>정리하면</h2>
        <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          <strong className="text-[var(--sl-step-c-ink)]">수요</strong>(이 동네가 원하는 양) → <strong className="text-[var(--sl-step-a-ink)]">몫</strong>(우리가
          가져갈 비율) → <strong className="text-[var(--sl-step-b-ink)]">매출</strong>(실제 돈으로 환산)
        </p>
        <p className="mt-2 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          이 세 단계는 앞 단계 결과를 그대로 다음 단계에 넘겨주는 방식이라, 앞 단계가 틀리면 뒤 단계도 같이 틀어집니다.
          그래서 &ldquo;수요 측정이 정확한가&rdquo;부터 먼저 검증하는 게 중요합니다.
        </p>
        {code && (
          <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
            이 후보지의 전체 결과와 &ldquo;왜 이 매출인가&rdquo; 요인별 기여도는{" "}
            <Link href={`/store-eval/candidates/${code}`} className="underline">
              후보지 상세의 최종결과 탭
            </Link>
            에서 볼 수 있습니다.
          </p>
        )}
      </section>

      <div className="app-notice app-badge-warn w-full items-start justify-start gap-2 px-4 py-3 text-left text-xs leading-5">
        <span>
          <strong>참고</strong> — 결과 화면에 &ldquo;실측기반 예상월매출&rdquo;이라는 값도 같이 보이는데, 이건 지금까지 설명한
          정식 계산과는 완전히 다른 별도 방법입니다(경쟁매장에 지금 실제로 몇 명이 앉아있는지 조회해서 환산하는 방식). 아직
          정확도가 검증되지 않아서 참고용으로만 보여줄 뿐, 실제 출점 판단은 항상 위에서 설명한 정식 계산(최종 예상월매출)
          기준으로 합니다.
        </span>
      </div>
    </div>
  );
}
