# 2026-09-26 저녁(집 PC) — 매일 06:00 크론이 적중률·후보지 결과까지 다시 계산해 저장 ✅ (자동화 1·2번)

앞: `docs/handoff-20260929.md` 맨 위 "최종(2026-09-25 밤)" 블록의 [다음 세션 — 자동화] 후보 1·2.
**산식·계수 변경 0.** 계산은 화면과 같은 조립을 한 곳(`dailyRecompute.ts`)으로 모았을 뿐이다.

## 왜

- V62 적중률 요약(`storeEvalSystemStatus/accuracy`)은 **검증 탭을 열 때만** 저장됐다 → 산식·자료가 바뀐 뒤 아무도 안 열면
  후보지 화면이 옛 적중률을 보여주고, `storedAccuracyParity`가 빨강이 됐다.
- 후보지 결과(`storeEvalResults`)는 **결과 탭을 열 때만** 저장됐다 → 대시보드·목록이 옛 예상매출. 09-25 밤엔 하네스로 12곳을 손으로 갱신했다.

## 무엇을 바꿨나

| 파일 | 내용 |
|---|---|
| `src/lib/storeEval/dailyRecompute.ts` (새) | 순수 계산. `computeAccuracySummary`(검증 화면 computed와 같은 조립) · `recomputeCandidates`(결과 탭 run과 같은 조립 + 두 산식) · 저장이 필요한 이유 판정 |
| `src/lib/storeEval/dailyRecomputeRun.ts` (새) | 크론용 읽기·쓰기(admin SDK). 약 1,300건 읽음(로컬 실측 읽기 2.0초·계산 0.3초) |
| `src/app/api/store-eval/cron-sync/route.ts` | 매출·프로필 동기화 **뒤에** 재계산. 실패해도 동기화는 성공으로 두고 `cronSync` 기록의 `recompute` 칸에 사유 |
| `storedAccuracyParity.test.ts` | 적중률 블록이 같은 함수를 부름(화면 저장값 = 크론 저장값 = 지금 코드 확인) + "크론이 다시 쓸 후보지가 없다(두 산식 포함)" 항목 추가 |
| `_recomputeCandidates.test.ts` | 같은 함수로 교체. 이제 "크론까지 기다리지 않고 지금 쓰고 싶을 때"만 |
| `scripts/dumpValidationSnapshot.mjs` · `validationSnapshot.ts` | 스냅샷에 운영 QSC·로드뷰 판정 추가(크론과 같은 입력) · `recomputeSourceFromSnapshot` |
| 화면 문구 | 결과 탭 "정확도 아직 없음" 안내, 목록·대시보드 "재계산 필요" 배지 안내 → "매일 06:00 자동, 바로 보려면 결과 탭" |

## 쓰는 곳 (사용자 허락 2026-09-26 "응 진행해" — 이 세 곳만)

1. `storeEvalSystemStatus/accuracy` — 매일 1건 덮어씀. `updatedBy`가 "매일 06:00 크론(dailyRecompute)". 운영설정 문서가 없으면 **안 씀**(검증 화면과 같은 안전장치)
2. `storeEvalResults/{코드}` — **다시 쓸 이유가 있는 후보지만**: 저장값 없음 · V62 0.5%↑ · 실효단가 1원↑ · 실험실 값/주 값 0.5%↑ · 주 값 산식 바뀜 ·
   **입력이 계산 뒤에 바뀜**(목록 배지 `resultFreshness`와 같은 판정 — 안 쓰면 값이 같아도 배지가 영영 안 꺼진다)
3. `storeEvalAuditLog` — 다시 쓴 후보지마다 "재계산" 1건(actor에 이유)

## 확인한 것

- 스냅샷 위: 적중률 40곳 9.47%(저장값과 1e-6 안 일치) · 다시 쓸 후보지 0곳 · 전체 시험 883 통과
- **대조군**: 저장값을 일부러 틀면(V62 +1% · 실험실 −2% · 결과 삭제) 세 곳 모두 알맞은 이유로 잡힘
- **크론 읽기 경로(Firestore 직접, 읽기만)**: 적중률 n=40 9.47% · 다시 쓸 후보지 0곳 — 스냅샷과 같음
- 실제 크론 첫 실행은 **2026-09-27 06:00 KST**. `storeEvalSystemStatus/cronSync`의 `recompute` 칸과 `accuracy.updatedBy`로 확인할 것

## 참고 — 하네스와 화면이 달랐던 곳(이번에 화면 쪽으로 통일)

09-25 밤 하네스는 실험실 값을 **월매출 전체**로, 로드뷰 판정 **없이** 계산했다. 결과 탭은 **평가구간 월매출** + 로드뷰 판정을 쓴다.
공용 함수는 결과 탭을 따른다. 지금 자료에선 두 방식의 저장값 차이가 0.5% 안이라 다시 쓸 곳이 없었다.

## 남은 자동화 후보 (다음)

- 3 실험실 동기화: `syncLabCollections`는 실험실에서 고친 값을 덮는다 → **자동화한다면 "새 문서 추가만"** 모드로(권고)
- 4 QSC(fcdaum)·핑봇: 로그인이 사람 몫이라 반자동만
