# 경쟁점 가동률 측정기 (`/ping-monitor`, 2026-10-06 신설)

옛 핑봇(`ping.isens.camp`)은 유지보수가 끊겼다. 사용자가 직접 쓰려고 새로 만들었다 — 경쟁점 **상호·주소·IP대역**만 넣으면
1시간마다 켜진 PC를 세어 가동률을 **기한 없이** 쌓는다.

## 어떻게 재나

- Vercel 함수는 핑(ICMP)을 못 보낸다. 대신 IP마다 포트 두 개(80·3389)에 **TCP 연결을 한 번 시도**한다.
  켜진 PC는 "연결 거절"을 바로 돌려주고(=켜짐), 꺼진 PC는 대답이 없다(=꺼짐). 문을 여는 시도가 아니고, 포트 스캔도 아니다.
- 2026-10-06 실측: `118.128.168.1~110`에서 핑과 TCP 결과가 110개 전부 일치(11:10 5대, 11:50 6대).
- `115.89.100.1~140`(옛 핑봇도 못 재던 곳)은 핑·TCP 모두 0/140, 공유기(254)만 대답 → **PC가 바깥 확인을 막아 둔 매장**.
  이런 곳은 72번 넘게 재도 0이면 화면에 "측정 불가 의심"으로 따로 뜬다(가동률 0%로 섞지 않으려고). 기준값은 `summary.ts`의 `BLOCKED_SUSPECT_SAMPLES`.
- Windows에서 시험할 땐 거절이 ~2.1초 늦게 온다(재시도) — 대기 시간을 4초로 둔 이유.

## 흐름

| 부분 | 위치 |
|---|---|
| 1시간 알람 | `.github/workflows/ping-monitor.yml` (매시 5분, GitHub 예약 실행은 몇~십몇 분 늦을 수 있음) |
| 측정·저장 | `/api/ping-monitor/cron` (Vercel 서울 icn1 고정, `PING_MONITOR_SECRET` 필요) → `src/lib/pingMonitor/runRound.ts` |
| 지금 확인(기록 안 함) | `/api/ping-monitor/probe` (회사 계정) |
| 화면 | `/ping-monitor` 목록·등록, `/ping-monitor/[id]` 기간·날짜별·시간대별(평일/주말) |

## 저장

- `pingMonitorStores/{id}` — 등록 정보 + `days.{YYYY-MM-DD} = {a: 켜진 수 합, t: 대수 합, n: 측정 횟수}` + `lastSample`.
  목록은 이것만 읽는다(매장당 읽기 1번).
- `pingMonitorDaily/{id}_{YYYY-MM-DD}.hours.{HH} = {a, t}` — 상세 화면 시간대별. 최근 92일까지만 읽는다(무료 요금제 읽기 한도).
- 가동률 = Σa ÷ Σt. 대수를 나중에 고쳐도 지난 기록 분모는 그때 값으로 남는다.
- 같은 한국 시(時)에 두 번 불려도 한 번만 센다(트랜잭션).
- 화면은 등록 칸만 쓸 수 있고 측정 기록은 서버만 쓴다. 지우기는 막았다(`firestore.rules`). 측정을 멈추려면 상세 화면에서 "1시간마다 측정"을 끈다.

## 설정값 (한 번만)

- Vercel 환경변수 `PING_MONITOR_SECRET`
- GitHub 저장소 비밀값 `PING_MONITOR_SECRET`(같은 값) · `PING_MONITOR_URL`(`https://<운영 주소>/api/ping-monitor/cron`)
- ⚠️ 저장소가 공개라 Actions 실행 기록이 누구에게나 보인다 — 워크플로는 매장 수만 찍고 이름·값은 찍지 않는다.

## 옛 핑봇 값과 이어 쓰기

점포평가 경쟁점의 `pingbotUtilization`(옛 핑봇 7일 값, `scripts/pingbot/`)은 아직 이 측정기와 연결하지 않았다.
같은 경쟁점을 여기에 등록해 1~2주 나란히 본 뒤 값이 맞으면 잇는다. 개점 후 재측정(`docs/long-term-pingbot-remeasure.md`)도 이 측정기로 한다.
