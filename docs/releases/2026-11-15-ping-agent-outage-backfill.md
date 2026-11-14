# 2026-11-15 — 측정기: 웹(Vercel)이 멈춰도 측정 기록을 잃지 않게

이유: 11-14 Vercel 무료 한도 초과로 프로젝트가 최대 30일 정지될 뻔했다. 그때 측정기는
(1) 사내 측정 서버가 목록(`GET /api/ping-monitor/agent/targets`)을 못 받아 throw → **측정 자체를 안 하고 pending도 안 남김**,
(2) 웹 `results` 라우트가 6시간 넘은 결과를 400으로 거절 → 웹이 돌아와도 정지 기간이 영영 빈다.
게다가 Vercel 정지 응답은 402(`DEPLOYMENT_DISABLED`, 4xx)라 옛 에이전트는 "다시 보내도 같은 4xx"로 보고 pending을 지우고 이번 회차도 버린다.

## 바꾼 것

### 서버 `scripts/pingMonitor/agent/agent.mjs`
- 목록을 받으면 `targets-cache.json`(agent.mjs 옆, pending/과 같은 방식)에 저장(임시 파일 → 이름 바꾸기). 못 받으면 캐시로 재고 결과를 `pending/`에 둔다. 캐시도 없으면 예전처럼 실패.
- 밀린 회차: 파일 이름만 정렬해 오래된 것부터 **회차당 6개**(`PENDING_PER_ROUND`)만, 하나씩 읽어 **한 번씩만** 보낸다. 하나라도 실패하면 그 회차 재전송을 멈춘다.
  - 6개인 이유: 한꺼번에 보내면 이번 회차 측정이 늦어지고(50분 제한) 웹·저장소에 몰린다. 30일(720회차) 밀려도 약 5일에 따라잡고, 웹은 35일까지 받는다.
  - 한 번만 시도하는 이유: 웹이 멈춘 동안 4번 시도(최대 약 9분)를 쓰면 목록·결과 보내기 재시도까지 더해 50분 제한에 걸릴 수 있다. 다음 회차에 어차피 다시 보낸다.
- 지우는 규칙은 그대로(우리 라우트의 4xx면 지움, 5xx·네트워크 오류면 남김). 단 **Vercel 플랫폼 응답**(`x-vercel-error` 머리글, 402·404·408·425·429)은 "웹 없음"으로 보고 5xx처럼 남긴다.
- 매장별 IP 목록 지문 `measuredIps`(sha256 앞 16자)를 결과에 같이 보낸다.
- `--local`·`--copy`·`--dry`, 타임스탬프 helper pkill, 측정 방식은 그대로.

### 웹 `src/app/api/ping-monitor/agent/results/route.ts`, `src/lib/pingMonitor/runRound.ts`, `roundGuard.ts`
- 받는 기한 6시간 → **35일**(`AGENT_RESULT_MAX_AGE_MS`). 6시간 넘게 늦은 회차(`isLateRound`)는 **기록만** 한다 — 상태 문서·자동 학습(`learnExtraPorts`)은 안 부른다.
- `measured[t.id] === t.ips.length` 필터 유지(2026-10-14 제주 노형 가짜 0대). 여기에 `measuredIps`가 오면 지문까지 같은 매장만 기록(IP 수는 같고 대역만 바뀐 매장 방지). 지문 없는 옛 pending은 IP 수만 본다.
- `recordRound`
  - 시간·일별 합계는 잰 시각의 날짜·시로 들어간다. 같은 시 이미 있으면 예전 규칙대로 건너뜀(서버 결과 둘이면 먼저 쓴 쪽 — 같은 회차를 두 번 받아도 한 번만 셈).
  - `recent`(시간대 칸: 최근 24시간·회차 이상 기준)는 칸에 더 새 값이 있으면 안 덮는다(예전엔 며칠 전 값으로 되돌렸다). `lastSample`은 원래 그랬다.
  - 회차 이상 점검: `referenceOf`가 이 회차보다 12시간 넘게 뒤 기록을 안 쓴다(예전엔 음수 나이가 12시간 안으로 잡혀 다른 날 같은 시각과 견줬다). 늦은 회차는 그날 **바로 앞 시** 기록(오래된 것부터 보내므로 보통 이미 있음)을 기준으로 같은 20%·40% 규칙을 본다(`lateReference`, 늦은 회차일 때만 매장 수만큼 읽기 1번 더). 앞 시도 비었으면 판정 없이 기록한다.
- `writeRoundStatus`: 상태 문서에 더 새 회차가 있으면 안 덮고 false.

## 판단(애매했던 것)
- 자동 학습: `EXTRA_PORTS_ALLOWED=false`라 지금은 아무것도 안 하지만, 늦은 회차의 "추가포트만" 응답으로 지금 설정을 바꾸지 않게 6시간 넘으면 아예 안 부른다.
- 늦은 회차의 회차 이상 기준을 앞 시 기록으로 잡은 건, 시간대 칸(recent)이 "지금" 값이라 며칠 전 회차와 요일·시각이 맞지 않기 때문. 앞 시가 없는 첫 회차는 판정을 건너뛴다(고장 회차가 섞일 수 있는 남은 빈틈 — 한 시간짜리).
- 6시간 안 재전송은 예전 동작 그대로(상태 문서만 "더 새것 있으면 안 덮음" 추가).

## 시험
- vitest `src/lib/pingMonitor` 88개 통과(새로: 35일·36일 경계, 늦은 회차 판정, 미래 기록 기준 제외, 사내 저장소로 7일 전 회차 → 기록 O·상태 문서·recent·lastSample 그대로·두 번 받아도 한 번, 지문 다른 매장 제외, 36일 전 400, 상태 문서 역행 안 함).
- agent.mjs: 로컬 가짜 서버(IP 없는 가짜 목록이라 실제 핑 안 쏨, 재시도 대기만 줄인 사본)로 정상 → 캐시 저장, 402 `DEPLOYMENT_DISABLED` → 캐시로 재고 pending 생성, 밀린 13개 중 6개만·오래된 순, 503이면 1개 시도 후 멈춤, 400이면 지움, 캐시 없고 웹 멈춤이면 실패 확인.

## 회사 PC에서 할 일 (사내 측정 서버 갱신 — 이번엔 안 올림)
사내 서버 접속·경로는 `scripts/pingMonitor/agent/README.md` 맨 위(키 `~/.ssh/ping_pc`, `/home/ping/ping-agent`).
웹은 이미 배포됐다(옛 에이전트도 그대로 동작 — `measuredIps` 없으면 IP 수만 본다).

1. **매시 :05 회차와 겹치지 않게** :20~:55 사이에 `agent.mjs` 하나만 복사(timestamp.mjs 등은 안 바뀜):
   ```
   scp -i ~/.ssh/ping_pc scripts/pingMonitor/agent/agent.mjs ping@<사내 서버>:/home/ping/ping-agent/
   ssh -i ~/.ssh/ping_pc ping@<사내 서버> 'cd /home/ping/ping-agent && /home/ping/node/bin/node --check agent.mjs && echo 문법OK && ls pending | wc -l'
   ```
2. 다음 :05 회차 뒤 확인:
   ```
   ssh -i ~/.ssh/ping_pc ping@<사내 서버> 'cd /home/ping/ping-agent && tail -5 cron.log && ls -l targets-cache.json'
   ```
   `보냄 200: {"ok":true,...}`와 `targets-cache.json`(방금 시각)이 보이면 끝. 밀린 회차가 있었으면 `밀린 회차 … 보냄`이 최대 6줄.
3. 해외 서버(Oracle, `--local` 대조용)는 웹에 안 보내므로 갱신 안 해도 된다.
4. 캐시로 재는 경로를 서버에서 일부러 돌려 보지는 않는다(실제 측정이 한 바퀴 더 돈다) — 가짜 서버 시험으로 갈음.
