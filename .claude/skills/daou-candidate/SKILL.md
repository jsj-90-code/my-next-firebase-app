---
name: daou-candidate
description: 다우오피스 "전략 점포 심사" 글 링크(cloud.daouoffice.com/gw/app/works/applet/...)를 받아 점포평가 신규 후보지를 한 번에 등록한다 — 기본정보 저장(코드 발급), 상권자료 수집(좌표·카카오 경쟁점·수요거점·2km), SGIS 주거인구·소상공인365 유동인구, 다우 "경쟁점 설명"으로 경쟁점 채우기(IP 포함), 측정기 등록, 입지평가 초안. 사용자가 다우 링크를 주며 "등록해 줘", "신규후보지 넣어 줘", "이거 후보지로" 같은 말을 하면 반드시 이 스킬을 쓴다.
---

# 다우 심사글 → 신규 후보지 등록

2026-10-15 군산점(N024)으로 처음 만들었다. 사용자가 원하는 건 **링크 하나로 끝까지 빠르게**다. 아래 순서대로 묻지 말고 진행하고,
끝나면 결과표 하나로 보고한다. 멈추고 묻는 건 아래 "물어야 하는 경우"뿐이다.

## 0. 준비 (매번)

- 작업 폴더는 이 저장소 루트. 결과 파일은 스크래치패드에 둔다(`<scratch>`).
- 측정 전 원칙대로 `git pull`이 되어 있는지 본다(집·회사 PC 번갈아 씀).

## 1. 글 읽기

```bash
node scripts/daou/fetchDoc.mjs "<다우 링크>" "<scratch>/daou-<날짜>.json"
```

- 로그인은 스크립트가 알아서 한다(.env.local의 `DAOU_LOGIN_ID`·`DAOU_LOGIN_PASSWORD`, 로그인 상태는 `.local-tools/daou-profile`).
  **두 값을 읽거나 출력하지 말 것.** 없으면 창이 떠서 사람이 로그인할 때까지 3분 기다린다 — 그때만 사용자에게 "창에서 로그인해 주세요"라고 말한다.
- "로그인 실패"가 나오면 비밀번호가 바뀐 것이니 사용자에게 `.env.local`을 고쳐 달라고 한다(값을 받아 적지 않는다).
- 결과 JSON의 `fields`(라벨 → 값)를 쓴다. 라벨이 비면 `raw`에서 직접 찾는다.

## 2. spec 만들기 → `<scratch>/<후보지>.json`

| spec 칸 | 다우 라벨 | 규칙 |
|---|---|---|
| `candidate.name` | 전략점포명 | 브랜드 앞말("블랙라벨PC존 ", "아이센스…PC존 ")을 떼고 "○○점"만(예: 군산점). 같은 이름이 있으면 동 이름을 붙인다 |
| `candidate.address` | 지번 전체주소 | 그대로 |
| `candidate.floor` / `groundLevel` | 입점 층수 | "3층"→3/"지상", "지하1층"→1/"지하"(층은 늘 양수) |
| `candidate.hasElevator` | 엘리베이터 | 1개 이상→true, "없음"→false. **`elevatorBasis`는 넣지 않는다** — 화면이 "상권자료 수집 때 자동: …"으로 보여 주는 건축물대장 근거 칸이다(10-15 다우 문구로 덮어 사용자가 지적) |
| `candidate.expectedPcCount` | **진행 예정인 PC 댓수** | 예측 PC 대수·희망 대수가 아니라 이 칸(사용자 확인 2026-10-15) |
| `candidate.hourlyRate` | **경쟁점 평균 1시간 요금** | 이 값을 그대로 쓴다(사용자 2026-10-15 "다우 경쟁점 평균 적용"). 비어 있을 때만 사용자에게 묻는다 |
| `candidate.plannedOpenMonth` | 6개월 예상 매출 | 첫 달의 **직전 달**(2027년 1월부터면 12) |
| `candidate.reviewDate` | — | 오늘(YYYY-MM-DD) |
| `competitorText` | 경쟁점 설명 | 원문 그대로(화면 붙여넣기 해석기가 읽는다) |
| `competitors[]` | 경쟁점 설명의 IP 줄 | IP가 "동일"·빈칸이면 사용자가 준 시작 IP를 `{ "note": "<상호 앞말>", "ipStart": "a.b.c.d" }`로. **IP 범위는 늘 "시작 IP + 다우 전체 대수"**(사용자 2026-10-15) — 실행 파일이 계산한다 |

`actor`는 사용자 이메일(`jsj-90@isens.camp`). 개발자 예상매출·AI 등급은 넣지 않는다(개발자 값, 우리 예측과 섞지 않음).

**물어야 하는 경우만** 멈춘다: 경쟁점 평균 요금이 비었다 · 경쟁점 IP가 "동일"/빈칸인데 사용자가 IP를 안 줬다(→ IP 없이 진행하고 끝에 "IP 주시면 넣겠다"고 말해도 된다) · 같은 이름·주소 후보지가 이미 있다.

## 3. 실행 (한 번에)

```bash
DAOU_SPEC="<scratch>/<후보지>.json" npx vitest run src/lib/storeEval/_daouCandidate.test.ts --disable-console-intercept
```

단계: `create → collect → population → competitors → ping`(spec `steps`로 고를 수 있음). 결과는 `<spec>.result.json`.

- **건축물대장 키(`BUILDING_REGISTRY_API_KEY`)가 이 PC `.env.local`에 없으면** 엘리베이터 추천값(후보지·경쟁점 전부)이 빈다 — 결과의
  `warnings`에 뜬다. 키는 Vercel에만 있을 수 있으니 사용자에게 `.env.local`에 넣어 달라고 하고, 넣은 뒤 `"steps": ["elevator"]`로 건축물대장만 다시 조회한다.

- 이미 만든 후보지를 이어서 돌릴 땐 `"code": "N0xx"`를 넣고 `steps`에서 `create`를 뺀다.
- `competitors` 결과에 `written:false`(같은 상호 없음·후보 여럿)가 있으면 `candidates` 목록에서 맞는 카카오 경쟁점 id를 골라
  `competitors[].target`에 넣고 `"steps": ["competitors","ping"]`으로 다시 돌린다. 카카오에 없는 경쟁점은 만들지 않는다(보고만).
- `population.sbiz.errors`가 남으면(소상공인365 시간 초과) `"steps": ["population"]`로 한 번 더.
- 측정기에는 그 후보지 경쟁점이 **전부** 올라간다(화면 경쟁점 탭을 여는 것과 같은 규칙). IP 넣은 곳은 "IP 확인 필요" 표시가 붙는다 — 실측 전이라 정상.

## 4. 입지평가 초안 (PC 점포평가 커넥터 — 클로드 앱과 같은 도구)

`mcp__claude_ai_PC__get_candidate_location_data(N0xx)` → 웹 검색 2~3번(상권 성격·중심 위치·특수수요) →
`mcp__claude_ai_PC__submit_candidate_location_draft`. 채점 기준은 받은 자료의 기준표를 그대로 따른다. 다우 글의
"점포 개발자 직접 점포 평가"(상권 설명)와 등급의 M(메인입지) 여부도 근거로 쓴다. modelName은 지금 모델명.
초안은 사람이 웹 입지평가 탭 [채팅 초안 불러오기]로 확정한다 — 그 안내를 보고에 넣는다.

## 5. 보고 (한국어, 짧게)

1. 후보지 코드·이름, 웹 링크 `https://my-next-firebase-app-one.vercel.app/store-eval/candidates/<코드>`
2. 넣은 값 표(이름·주소·층·엘리베이터·대수·요금·개점월)
3. 경쟁점 표(상호·거리·대수·IP·인테리어/관리/먹거리·시간요금), 못 맞춘 경쟁점
4. 측정기 등록 수, 수집 경고(건축물대장 실패 등)
   - `collect.competitorsExcluded`(오락실·성인업태 규칙으로 뺀 곳)와 `collect.competitorsWithoutPermit`(PC방 인허가 짝 없음 —
     새로 연 곳이거나 성인PC방일 수 있음)을 꼭 적는다. 인허가 없는 곳은 지우지 말고 사용자 판단에 맡긴다(군산 레벨업 177대도 인허가 없음).
5. 입지평가 초안 점수표 + "[채팅 초안 불러오기]로 확정" 안내
6. 사람이 할 일: 존 구성(다우 글에 없음 — 비워 둠), 입지평가 확정

## 함정

- 기본값은 `src/lib/storeEval/blankCandidate.ts`(화면과 같은 것). 거기에 새 칸이 생기면 이 스킬도 저절로 따른다.
- 상권자료 수집 본체는 `src/lib/storeEval/collectMarketData.ts` — 라우트와 같은 함수다. 라우트만 고치지 말 것.
- 경쟁점 해석 규칙은 `competitorNoteParse.ts`(`parseCompetitorNotes`·`applyParsedNote`) — 화면 붙여넣기와 같다.
  해석이 틀리면 거기를 고치고 테스트(`competitorNoteParse.test.ts`)를 더한다.
- 측정기 등록 규칙은 `src/lib/pingMonitor/clientStore.ts` `registerCompetitorsToPing`을 옮겨 쓴 것이다. 그쪽 규칙이 바뀌면 실행 파일도 맞출 것.
