# 채팅 입지평가 (2026-09-29) — claude.ai·ChatGPT 채팅에서 주소만 초기평가

## 왜
품의에서 유료 API 대신 "각자 쓰는 AI 요금제로 돌리는 방식"이 제안됐고, 사용자가 그쪽으로 정했다(2026-09-29).
휴대폰에서도 쓰므로 **채팅 앱(claude.ai·ChatGPT 웹/앱)** 만 대상이다. Codex·Claude Code 같은 터미널 도구는 대상 아님.

## 흐름
1. 담당자가 채팅에 "○○시 ○○로 123, 100대, 1,200원, 2층 엘베 있음, 입지평가 해줘"
2. AI가 `get_site_data` 호출 → 웹 앱이 주거·유동인구·경쟁 PC방·수요거점을 자동수집(AI 호출 없음, 30~60초)하고 채점 기준을 돌려줌
3. AI가 **자기 요금제의 웹 검색**으로 주소를 조사해 입지 7항목을 매김
4. AI가 `submit_location_scores` 호출 → 주소만평가와 **같은 계산**(`quickEvalCompute.ts`)으로 예상매출·가능/불가 → 채팅에 요약
5. 기록: Firestore `quickEvalChatRuns/{runId}` — 누가·언제·주소·입력·점수·근거·참고 웹 주소·**모델 이름**·결과

회사 API 비용 0. 권장 모델: GPT는 GPT-6 Astra, Claude는 Opus. 다른 모델도 받는다(모델 이름을 같이 기록해 나중에 성적 비교).

## 연결 방법 (처음 한 번, PC 웹에서)
연결 주소: **`https://my-next-firebase-app-one.vercel.app/api/mcp`**

- **Claude(claude.ai, 팀 요금제)** — 2026-09-29 실제로 연결함(조상준, 이름 "PC 점포평가"):
  1. **조직 소유자**가 관리자 설정 → 커넥터 → 커스텀 커넥터 추가. 이름·URL 입력 후 2단계 화면에서
     인증 = **지금 로그인**, OAuth 클라이언트 = **Claude의 게시된 ID 사용**(CIMD), 요청 헤더 비움, 전송 방식 = 스트리밍 HTTP. 둘 다 "감지됨"으로 뜬다.
     (CIMD가 안 되면 "자동으로 등록"(DCR)으로 바꿔도 된다 — 서버가 둘 다 지원)
  2. **각 사용자**가 설정 → 커넥터 → 그 커넥터 [연결] → 아이센스 화면에서 회사 구글 계정 로그인 → [허용]. 사람마다 처음 한 번.
  3. 도구 권한: 두 도구 "항상 허용" 권장(아니면 평가 한 번에 두 번 묻는다).
  4. 새 채팅에서 주소·대수·요금·층을 쓰고 "입지평가 해줘". 휴대폰 앱도 같은 계정이면 된다.
- **ChatGPT(비즈니스)**: 워크스페이스 관리자가 개발자 모드·커넥터를 허용해야 한다. 아직 안 해 봄.
- 허용 화면에 "돌아갈 곳"이 claude.ai / chatgpt.com 이 아니면 누르지 말 것.

## ⚠️ 서울 리전 고정 (2026-09-29 첫 실사용에서 발견)
`/api/mcp`가 기본 리전(미국 iad1)에서 돌아 **소상공인365가 접속을 끊었다**(ECONNRESET) → 유동인구 없음 → V62 계산 불가 →
고립 상권 규칙으로 실험실 값(풍세산단로 277: 1,614만)만 나왔다. `vercel.json`에서 `/api/quick-eval/collect`처럼 **icn1**에 고정했다.
소상공인365를 부르는 새 경로를 만들면 반드시 icn1에 고정할 것. 응답 헤더 `x-vercel-id`가 `icn1::`로 시작하면 맞다.

## 채팅 결과 구성 (2026-09-29 오후 사용자 확정 — `quickEvalChat.buildResultSummary`·`QUICK_EVAL_CHAT_REVIEW_GUIDE`)
1. 시작 문장 — 결론부터: "○○ 자리는 입점 가능으로 나왔습니다. 예상 월매출은 약 ○○만원으로, 기준선 5,500만원보다 ○○만원가량 높습니다."
2. 평가 결과 — 조건·예상 월매출(**하나만, 범위 없음** — 사용자 "그냥 매출만 딱")·상권수요·등급/성격·경쟁IP·경쟁점
3. 한 줄 결론 → 이 상권은 어떤 상권인가 → 장점 → 단점·특이점 (자료는 웹 AI 상권평가와 같은 `buildQuickEvalReviewContext`)
4. AI 조정 의견 — **AI가 금액을 따로 내지 않는다**(두 금액이 헷갈림). 특이점(산식 밖 사실·유사 가맹점 괴리·자료 구멍) 때문에
   `QUICK_EVAL_CHAT_ADJUST_THRESHOLD`(10%) 이상 벌어질 때만 방향·크기·이유. 없으면 "다르게 볼 뚜렷한 이유 없음". '산식값과의 차이' 섹션은 뺐다.
   10%인 이유: AI 입지 점수 흔들림만으로 금액이 4% 안팎 움직인다.
5. 현장에서 확인할 것 → 입지 점수표 → 보고 안내(`QUICK_EVAL_CHAT_REPORT_NOTE`, 정밀평가는 본인만 쓰므로 "현장 확인을 더해 보고")
- 웹 화면의 AI 상권평가는 그대로 둔다(웹은 AI 예상매출·범위를 계속 보여 줌).
- 'V62'·'실험실' 이름은 채팅에 안 쓴다(다른 직원용). 산식 금액은 "산식 예상 매출액".
- 웹과 금액이 다를 수 있다: 자료·계산은 같고 **입지 점수를 매긴 AI가 다르다**(웹 제미나이, 채팅 사용자 AI). 김포 한강2로23번길 60: 상권수요 6,794 동일, 웹 5,800만 vs 채팅(Opus) 6,030만.

## 신규후보지 정밀평가 입지 초안 (담당자 본인 전용, 2026-09-29)
- 채팅: "신규후보지 오송 입지평가 초안 만들어줘" → `find_candidate` → `get_candidate_location_data` → 웹 검색 → `submit_candidate_location_draft`
- 초안은 `storeEvalLocationChatDrafts/{코드}`(후보지당 마지막 1건). 웹 입지평가 탭 **[채팅 초안 불러오기]** → 제미나이와 같은 승인 화면 → 사람이 저장. 자동 저장 없음.
- 자료는 웹 "AI로 초안 채우기"와 같다(후보지 문서·등록 경쟁점·수요거점) + 층·지상/지하·엘리베이터(채팅만 덧붙임 — 웹 제미나이 경로에는 아직 층 정보가 없다).
- 권한: `MCP_OWNER_EMAILS`(기본 jsj-90@isens.camp). **도구 목록 자체가 사람마다 다르다** — 본인 5개, 다른 직원 2개(`route.test.ts`).
- ⚠️ 새 도구를 붙이면 Claude가 옛 목록을 기억한다 → 내 설정 커넥터에서 **연결 해제 후 다시 연결**해야 보인다(09-29 겪음).
- 경쟁점은 웹 등록분만 쓴다. 주소만 평가는 카카오 목록이라 폐업 매장이 섞일 수 있다(오송 크라우드PC 청주오송점 — 폐업인데 카카오에 남음).

## 구조 (코드)
| 파일 | 역할 |
|---|---|
| `src/app/api/mcp/route.ts` | MCP 서버(mcp-handler 2). 도구 2개 + 기록 저장 |
| `src/lib/server/mcpOAuth.ts` | OAuth 2.1+PKCE 인가 서버. 동적 등록·CIMD 둘 다. 토큰 해시만 저장(24h 접근·60일 갱신) |
| `src/app/.well-known/oauth-*` | 인가 서버·보호 자원 메타데이터 |
| `src/app/api/oauth/{register,token,authorize}` · `src/app/oauth/authorize/page.tsx` | 등록·토큰·허용 화면 |
| `src/lib/storeEval/quickEval/quickEvalCollectSite.ts` | 자동수집(원래 collect 라우트 안) — 화면·채팅 공용 |
| `src/lib/storeEval/quickEval/quickEvalCompute.ts` | 계산(원래 quick-eval/page.tsx 안) — 화면·채팅 공용 |
| `src/lib/storeEval/quickEval/quickEvalChat.ts` | 채점 안내문·결과 요약문. 채점 기준은 `locationEvalAi.ts`와 같은 문장 |
| `src/lib/server/quickEvalTraining.ts` | 서버용 학습자료 읽기, 10분 메모리 캐시(Firebase 무료 요금제) |

Firestore 새 컬렉션 4개(`mcpOAuthClients`·`mcpOAuthCodes`·`mcpOAuthTokens`·`quickEvalChatRuns`)는 규칙으로 브라우저 접근을 전부 막았다(서버만).

## 남은 것 (2026-09-30 정리)
- ~~첫 실제 연결 확인~~ — Claude는 09-29 연결·실사용 성공, 다른 직원 공유도 끝남. ChatGPT(비즈니스)는 아직 안 해 봄(필요할 때만)
- ~~신규후보지 정밀평가 AI 입지 초안도 이 연결로~~ — 09-29 완료(위 "정밀평가 입지 초안" 절)
- **유료 API 품의("GPT Luna API")는 종료** — 채팅 연동으로 대체(사용자 2026-09-30)
- 휴대폰에서 구글 로그인 팝업이 막히면 리다이렉트 로그인으로 바꿀 것
- 모델 성적 비교: `quickEvalChatRuns`가 쌓이고 개점이 나오면 모델별로 가른다
- 웹 앱의 "AI 초안 받기" 버튼은 여전히 제미나이 유료 키(09-28 유지 결정). 키를 끊으면 멈춘다 — 끊을 때 버튼 정리
