# D28 새 직무 계산 스크립트 (2026-11-14 집 PC, 계산까지만)

읽기만 한다. Firestore·시트·사내 저장소에 쓰지 않고, 알림·예약도 없다. 예약·알림방 연결은 회사 PC 몫.

## 직무 3 「후보지 심사 결과 되짚기」 — `screeningReview.mjs`

    node scripts/d28/screeningReview.mjs [--grade MAA] [--grades 옛등급.csv] [--json out.json]

- 심사 값 = 기존점 문서 `predictedAtConversion`(후보지→기존점 전환 때 얼린 등급·점포팀 최종 예상 매출·V62).
- 실매출 = `storeEvalExistingStoreSales`(매출DB 사본) PC+상품, 개점 다음 달부터 다 찬 달만. 계절 지수 보정 값도 같이.
- 11-14 기준 개점해 다 찬 달이 있는 심사 매장은 **평택소사벌 1곳뿐**(울산삼산은 12월 초 11월 매출부터).
- 웹 이전에 개점한 매장 등급은 DB에 없다 → 회사 PC `.playwright-mcp/daou/` 원자료(10-06 되짚기 38곳)에서
  `storeCode,grade,storeTeamRevenue,developerRevenue` CSV를 만들어 `--grades`로 넣으면 등급별 표본이 생긴다.
- `--grade X`가 심사 DM에 붙일 한 줄을 찍는다. 3곳 미만이면 "참고만"이 붙는다.

## 직무 4 「가맹점 주변 경쟁 변화 조기 알림」 — `rivalSurge.mjs`

    node scripts/d28/fetchPingStores.mjs          # Firebase 사본(11-04 07시까지) → .local-tools/d28/pingStores.json
    node scripts/d28/rivalSurge.mjs [--naive] [--grid]
    node scripts/d28/rivalSurge.mjs --live --grid  # 회사 PC: 사내 저장소에서 바로(PING_STORE_URL·SECRET 필요)

- 기준안: 경쟁점 최근 7일 vs 바로 앞 7일(요일 한 바퀴씩), 그날 경쟁점 전체 변화(중앙값)로 나눈 뒤 +4%p 이상·1.25배 이상.
- 거름: 계산 제외·IP 재확인 / 측정 방식 바뀜(10-08·10-09·11-03, portSwitchDate) / 회차당 대수 5% 넘게 바뀜 /
  앞 7일에 평소 40% 미만인 날 / 같은 날 경쟁점 10% 넘게 동시.
- 맞혔나: 우리 매장 "경쟁점이 오르기 전 7일" 대비 "울린 뒤 7일"을 우리 매장 전체 변화로 나눠 0.95 이하면 떨어짐.
  (울리기 직전 7일을 기준으로 하면 상권 전체가 같이 오른 주가 기준이 돼 평소로 돌아온 것까지 떨어짐으로 센다 — 부경대 10-26.)
- 하루 = 20회차 이상·1% 이상(`src/lib/pingMonitor/summary.ts`와 같은 기준).

## 직무 2 「인테리어 구역 쓰임」 자료 위치(11-14 확인)

- PC별(IP별) 시간 기록: Firestore·사내 저장소에는 매장 합계만(`days`·`hours`), IP 목록은 `lastSample`(마지막 1시간)뿐.
  IP별 이력은 **사내 측정 서버 `~/ping-agent/compare/YYYY-MM-DDTHH.json`**(cron `--copy`, 11-04 12시부터 매시 `aliveIps`)에만 있다 — 회사망·측정기 계정 필요.
- 좌석번호: 좌석배치도 프로젝트의 좌석번호(점포평가 커넥터 `get_seat_number_data`). 우리 매장 IP 대역은 측정기 "우리 매장 IP 등록".
- 켜짐 ≠ 손님 앉음(늘 켜 둔 PC가 있음 — 평택 10-12 현장 대조 2.58배). 게토 좌석별 이용 내역(`docs/getto-receiver-spec.md` sessions)이 오면 그쪽이 정답.
