// 매출 계산법 설명 화면 - 2026-08-27 추가.
// 사용자 요청: "중고등학생정도가 봐도 이해할수 있도록, rawdemand·비음수 릿지회귀 같은 전문용어
// 넣지말고 알기쉽게 적되 상세히, 예상매출까지 나오는 과정을" — calc.ts/evaluate.ts의 실제 계산
// 순서(수요→점유율→매출)를 그대로 따라가되, 전문용어 없이 쉬운 말로 풀어 쓴다. 새 계산을 만들지
// 않고 이미 있는 계산 흐름을 설명만 한다.

import { sectionClass, sectionTitleClass } from "../candidates/[code]/formFields";

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

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">매출은 어떻게 계산될까?</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          이 프로그램은 후보지 하나(또는 이미 문을 연 매장)의 &ldquo;한 달 예상 매출&rdquo; 숫자 하나를 뽑아내기까지, 사실 세 단계를
          순서대로 거칩니다. 전문 용어 없이, 그 세 단계를 그대로 따라가면서 설명합니다.
        </p>
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
          <StepBadge n={1} color="#1e7a6f" />
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
              마지막으로 한 번 더 깎습니다. &ldquo;PC방에 갈 성향이 있는 사람&rdquo;이라고 매일 가는 건 아니니까요. 번화가는
              53%, 중간 동네는 61%, 주택가는 78%만 실제 수요로 인정해요. (주택가일수록 다른 놀거리가 적어서 인정 비율을
              더 높게 잡습니다.)
            </p>

            <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">이렇게 나온 숫자 = &ldquo;이 상권 전체가 원하는 PC방 수요&rdquo;</p>
              <p className="mt-1 text-xs text-[#8a8072]">
                아직 &ldquo;우리 매장 것&rdquo;이 아니에요. 이 동네에 있는 모든 PC방이 나눠 가질 파이 전체의 크기입니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2단계 */}
      <section className={sectionClass}>
        <div className="flex items-start gap-3">
          <StepBadge n={2} color="#7a4fa0" />
          <div className="min-w-0 flex-1">
            <h2 className={`${sectionTitleClass} text-base`}>그 중에서 우리 매장은 몇 명을 데려올까? (몫)</h2>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              이제 이 동네에 있는 다른 PC방들(경쟁매장)과 비교합니다. 먼저 <strong>&ldquo;우리 매장이 경쟁매장보다 얼마나
              좋은가&rdquo;</strong>를 점수로 매깁니다. 5가지를 봐요:
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {[
                { label: "좌석", pct: 30, desc: "방 종류가 다양하고 독립된 룸이 많을수록 높은 점수" },
                { label: "사양", pct: 25, desc: "그래픽카드 성능(70%)과 모니터 화질(30%)" },
                { label: "먹거리", pct: 20, desc: "파는 음식 수준" },
                { label: "인테리어", pct: 15, desc: "매장 분위기" },
                { label: "위치", pct: 10, desc: "몇 층인지, 엘리베이터가 있는지" },
              ].map((row) => (
                <div key={row.label} className="grid grid-cols-[64px_1fr] items-center gap-3 text-sm sm:grid-cols-[64px_44px_1fr]">
                  <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{row.label}</span>
                  <span className="font-mono text-[#7a4fa0]">{row.pct}%</span>
                  <span className="text-xs text-[#8a8072] sm:col-start-3">{row.desc}</span>
                </div>
              ))}
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

            <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">1단계 수요 × 2단계 몫 비율 = &ldquo;우리 매장으로 올 손님 수&rdquo;</p>
            </div>
          </div>
        </div>
      </section>

      {/* 3단계 */}
      <section className={sectionClass}>
        <div className="flex items-start gap-3">
          <StepBadge n={3} color="#b8721e" />
          <div className="min-w-0 flex-1">
            <h2 className={`${sectionTitleClass} text-base`}>그 손님들이 얼마를 써줄까? (진짜 매출로 바꾸기)</h2>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              이미 문을 열어서 실제로 장사하고 있는 다른 가맹점들의 <strong>진짜 매출 기록</strong>이 있습니다. 컴퓨터가
              이 기록들을 보고 &ldquo;손님 수, 시간당 요금, 매장 경쟁력 점수가 이 정도면 매출이 보통 이만큼 나오더라&rdquo;는
              패턴을 스스로 찾아냅니다. (참고할 매장이 너무 적으면, 이 패턴 찾기 대신 미리 정해둔 계산식을 대신 씁니다.)
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              이 패턴에 우리 후보지의 숫자(손님 수, 시간당 요금, 경쟁력 점수)를 넣으면 <strong>기본 예상 매출</strong>이
              나옵니다.
            </p>

            <p className="mt-3 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
              마지막으로 딱 한 번 더 조정합니다. &ldquo;이 동네 사람들이 다른 동네로 잘 안 새어나가는지, 아니면 근처에 더
              좋은 선택지가 있어서 손님을 뺏길 가능성이 있는지&rdquo;를 봐서:
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="app-card-sm flex-1 rounded-lg px-4 py-3">
                <p className="text-xs text-[#8a8072]">문제없음</p>
                <p className="mt-1 font-mono text-sm text-[#171310] dark:text-[#f2ede2]">그대로 (0%)</p>
              </div>
              <div className="app-card-sm flex-1 rounded-lg px-4 py-3">
                <p className="text-xs text-[#8a8072]">보통</p>
                <p className="mt-1 font-mono text-sm text-[#171310] dark:text-[#f2ede2]">3% 깎음</p>
              </div>
              <div className="app-card-sm flex-1 rounded-lg px-4 py-3">
                <p className="text-xs text-[#8a8072]">심함(손님 이탈 우려)</p>
                <p className="mt-1 font-mono text-sm text-[#171310] dark:text-[#f2ede2]">20% 깎음</p>
              </div>
            </div>

            <div className="app-card-sm mt-4 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">이렇게 나온 최종 숫자 = &ldquo;예상 월매출&rdquo;</p>
              <p className="mt-1 text-xs text-[#8a8072]">
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
          <strong className="text-[#1e7a6f]">수요</strong>(이 동네가 원하는 양) → <strong className="text-[#7a4fa0]">몫</strong>(우리가
          가져갈 비율) → <strong className="text-[#b8721e]">매출</strong>(실제 돈으로 환산)
        </p>
        <p className="mt-2 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          이 세 단계는 앞 단계 결과를 그대로 다음 단계에 넘겨주는 방식이라, 앞 단계가 틀리면 뒤 단계도 같이 틀어집니다.
          그래서 &ldquo;수요 측정이 정확한가&rdquo;부터 먼저 검증하는 게 중요합니다.
        </p>
      </section>

      <div className="app-badge app-badge-warn w-full items-start justify-start gap-2 px-4 py-3 text-left text-xs leading-5">
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
