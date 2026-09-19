# 인계 — 2026-09-20 새벽 (집 PC) → 다음 세션

**오늘 V62 이식은 끝났다.** 남은 건 **하나** — QSC를 학습 피처에서 **관리 점수로 옮기는 것**.
사용자 결정까지 받아 놨고 바닥 값도 정해졌다. 코드만 옮기면 된다.

---

## 다음 세션에서 이걸 붙여넣으세요

```
점포평가 이어서 하자. docs/handoff-20260920-qsc-management.md 읽고 시작해.
같은 PC다. git pull 이나 재수집 필요 없고, 워킹트리 깨끗한 것만 확인해라.

[먼저 확인]
1. git log --oneline -1   ->  40d52a4 다음 커밋(인계 문서)이어야 한다
2. npx vitest run --exclude "**/_*.test.ts"
   799 통과 + storedAccuracyParity **1건** 실패가 정상이다
   (그 1건은 기존점 캐시인데 매일 06:00 KST 크론이 고친다. 이미 지났으면 녹색일 수도 있다)

[할 일 — 하나뿐이다]
QSC를 학습 피처에서 빼고 **관리 점수**로 옮긴다. 바닥 70. 문서 3절에 순서가 있다.

[규칙]
- 계수·점수를 내 확인 없이 새로 고르지 않는다. 측정하고 보고해라.
- 셸(node -e)로 파일을 고치지 말 것. Edit/Write 도구만. (CRLF라 조용히 실패한다)
- .env.local은 못 읽는다(보호됨). 변수 이름이 필요하면 물어봐라.
- ⚠️ 하네스를 만들면 `validation/page.tsx`의 inputs 조립과 **나란히 놓고 diff**해라.
  2026-09-20에 `preemptionScore`가 빠져서 하루치 측정을 다 버렸다(문서 5절).
```

---

## 0. 지금 상태

```
  마지막 산식 커밋  40d52a4
  시험             799 통과 · storedAccuracyParity 1건 실패(크론이 고침) · 31 skip
  V62 적중률       MAPE 8.903% · 중앙 7.84% · ±10% 57.9%(22곳) · ±20% 92.1%(35곳)
                  ↑ 배포된 검증 화면 숫자와 **자릿수까지 일치** 확인함
```

오늘 적용한 것 넷: **사양 성능지수표 · 존구성 잣대 · QSC(피처) · 모니터 잣대**
근거와 측정값 전부: `docs/releases/2026-09-19-v62-port.md`

Firestore는 정리돼 있다 — 후보지 13곳 재계산·저장 완료, 적중률 요약 갱신 완료,
`storeEvalQscScores` 37건 채움, 규칙 배포 완료, 스냅샷 갱신 완료.

---

## 1. 왜 옮기나 — 내가 자리를 잘못 골랐다

오늘 QSC를 **학습 피처**(`log(QSC/92.6)`)로 넣었다. 그런데 실험실은 같은 QSC를
**관리 점수 칸**에 넣고, 그건 사용자가 2026-09-17에 뜻으로 정한 것이었다:

> *"나는 관리점수에 QSC가 반영되었으면한데, **배율적용하면 약간 보정값이잖아**"*

`labInput.ts`가 그 원칙을 적어 뒀다 — **"항목은 뜻으로 정하고 계수만 자료로 정한다."**
학습 피처는 예측에 곱해지는 항이라 **사용자가 거부한 "배율"에 가깝다.** 자리를 잘못 골랐다.

사용자 확인(2026-09-20): **관리 점수로 옮긴다.**

---

## 2. 바닥은 70이다 (측정 완료)

```
                          MAPE     중앙     ±10%   ±20%
QSC 안 씀 (기준선)         10.17%   9.47%   53%    92%
A 학습 피처 (지금 운영)      8.90%   7.84%   58%    92%
C 둘 다 ⚠️이중계산          8.78%   6.81%   58%    92%

B 바닥 60 (자사평균 4.20)   9.17%   8.44%   55%    92%
B 바닥 65 (자사평균 4.09)   9.00%   8.03%   53%    92%
B 바닥 70 (자사평균 3.94)   8.85%   7.66%   55%    92%   <- 채택
B 바닥 75 (자사평균 3.73)   8.73%   7.65%   61%    92%
B 바닥 80 (자사평균 3.44)   8.77%   7.52%   63%    92%
```

재현: `npx vitest run src/lib/storeEval/_qscAsManagement.test.ts --disable-console-intercept`
(이 하네스는 git에 넣어 뒀다 — PC를 옮겨도 따라간다)

### 왜 70인가 — **MAPE 때문이 아니다**

지금 자사 관리 점수는 **38곳 전부 4.00 상수**고, 경쟁점은 **점포개발자 상/중/하 평가**다
(평균 2.67). **자가 다르다.** 자사만 QSC 자로 바꾸면 수준이 통째로 움직여 경쟁력격차가
한쪽으로 벌어진다 — 오늘 존구성에서 걷어낸 "자사만 유리한 비대칭"과 같은 모양이다.

```
  바닥 60  ->  자사 평균 4.20   지금보다 +0.20   자사만 유리해짐
  바닥 70  ->  자사 평균 3.94   지금과 거의 같음  수준 그대로, 변별만 생김
```

**바닥 70이면 자사/경쟁 비교를 안 건드리고 자사 매장 간 변별만 얻는다.** 그게 원래 목적이다
("관리 칸이 실제로 뭔가를 재게 하라"). MAPE가 A보다 나은 건(8.85 vs 8.90) **근거가 아니라 확인**이다.

⚠️ **바닥을 MAPE로 다시 고르려 하지 말 것.** 실험실이 이미 적어 뒀다 — 대조군을 **어느 바닥에서도
못 넘는다**(60 p=0.075 · 70 p=0.144 · 80 p=0.259). 75·80이 숫자는 더 좋지만 자사 평균이
3.73/3.44로 내려가고, 사용자가 말한 후보(60/70) 밖이다.

사용자 설명(2026-09-20): *"자사같은경우 qsc점수가 1~100점 정도되는데 실제 최소값이 60인가
70인가그래서 1점이 나오는 구조가아니야. 그래서 60이였나 70이였나 이점수를 1점으로기준주고
차등적용하는걸로했었거든"*

---

## 3. 할 일 — 순서대로

### ⭐ 핵심 착상: 주입 지점을 **한 곳**으로 좁힌다

관리 점수가 `ExistingStore.ownManagementScore`에서 출발해
`computeExistingStoreDemandEvaluation` → `computeFacilityScore`로 흐른다. 그러니
**매장 객체의 `ownManagementScore`를 QSC 환산값으로 갈아끼우기만 하면 하류는 손댈 게 없다.**

`prepareExistingStoresForEvaluation` 한 곳이 거의 모든 경로를 덮는다(검증 화면 · 후보지 평가 ·
파리티 시험 · 실험실 화면). 나머지는 cronSync와 후보지 자신뿐이다.

### (1) `calc.ts` — 환산자를 원본으로 옮기고 피처를 걷어낸다

- `qscToManagementScore` + `QSC_MANAGEMENT_FLOOR = 70`을 **`labInput.ts`에서 `calc.ts`로 옮긴다**
  (존구성·모니터와 같은 방식 — 잣대는 한 벌, 실험실은 re-export).
  ⚠️ 실험실은 바닥 60을 쓴다. **운영 70과 갈린다** — 실험실 값을 60으로 유지할지
  70으로 맞출지는 **사용자에게 물어라.** 갈라 두면 두 화면의 관리 점수가 달라진다.
- `franchiseAverageManagement`(가맹점 평균 관리점수)도 같이 옮긴다 — QSC 없는 매장·후보지가
  받을 값이다. ⚠️ **환산한 뒤의 평균**이다(점수를 먼저 평균 내고 환산하면 안 된다).
- **학습 피처를 걷어낸다.** 지우면 되는 것들:
  `QSC_FEATURE_REFERENCE` · `isValidQscScore`(다른 데서 쓰면 남겨도 됨) · `qscFeatureValue` ·
  `franchiseAverageQscScore` · `qscFillerFor` · `resolveQscScores` ·
  `empiricalFeaturesFor`/`empiricalFeatureLabels`의 QSC 칸 ·
  `buildMinCoefficients`의 `withQsc` ·
  `ValidationStoreInput`/`V61TrainingStore`의 `qscScore`·`qscIsFranchiseAverage` ·
  `buildV61TrainingStores`의 `qscByStoreCode` 인자 · `runCohortValidation`의 `fillQsc`
  ⚠️ **둘 다 두면 이중계산이다**(위 표 C행). 반드시 뺀다.

### (2) `existingStoreEvaluation.ts` — 주입

- `prepareExistingStoresForEvaluation(stores, competitors, locations, settings, qscByStoreCode?)`
  → 매장마다 `ownManagementScore`를 QSC 환산값(없으면 가맹점 평균)으로 갈아끼운 뒤 패치를 계산.
  ⚠️ **`qscByStoreCode`를 안 주면 지금과 똑같이 동작해야 한다**(안전장치 — 자료가 없어도
  예상매출이 사라지면 안 된다). 오늘 QSC 피처에 걸어 둔 것과 같은 규율이다.
- `existingStoreEvaluationPatch`도 같은 override를 받게 한다(cronSync가 직접 부른다).

### (3) `usageRevenue.ts` · `calc.ts runCohortValidation` — `fillQsc` 제거

### (4) 호출부 넷에 QSC 맵을 넘긴다

```
  src/app/store-eval/validation/page.tsx      listQscScores() -> prepare...에 전달
                                              (ValidationStoreInput.qscScore는 삭제)
  src/app/store-eval/candidates/[code]/ResultTab.tsx   trainingQscScores -> evaluateCandidate
  src/lib/storeEval/evaluate.ts               prepare...에 전달 +
                                              **후보지 자신의 관리점수 = 가맹점 평균**
  src/lib/storeEval/cronSync.ts               ⚠️ 여기가 빠지기 쉽다. 아래 참고
```

⚠️ **cronSync를 빠뜨리지 말 것.** 매일 06:00 KST에 `existingStoreEvaluationPatch`로 기존점
캐시를 다시 쓴다. QSC를 안 읽으면 관리 4.00으로 계산해 **화면과 캐시가 갈라진다**.
cronSync는 firebase-admin이라 `listQscScores`(클라이언트 SDK)를 못 쓴다 —
`storeEvalQscScores`를 admin으로 읽는 경로를 따로 만들어야 한다.
평균 내는 규칙(`qscInWindowAverage`)은 **같은 함수**를 써야 한다.

### (5) 화면·문서 (CLAUDE.md 규칙)

- 검증 화면 `FormulaChangeNotice20260919`의 **4번 항목**을 고친다. 지금은 "학습에 넣었습니다"인데
  "관리 점수 칸에 넣었습니다"로 바뀐다. 숫자도 다시 잰 값으로.
- 후보지 결과 탭 `RevenueDriverBreakdown`의 "매장 관리 수준(…가맹점 평균)" **안내를 지운다**
  — 그 라벨 자체가 없어진다.
- 입력 화면의 "관리 점수" 힌트 — 자사는 이제 QSC 자동환산이라고 적는다.
  ⚠️ **경쟁점은 그대로 점포개발자 평가**라는 것도 같이 적어야 한다(자가 다르다는 사실).
- `docs/releases/2026-09-19-v62-port.md` 3절(QSC)을 고치고, 이 결정을 덧붙인다.

### (6) 측정·검증

1. `_qscAsManagement.test.ts`로 B 바닥 70이 재현되는지(MAPE 8.85% 근처)
2. `_liveCheck`로 전체 확인
3. **⭐ 운영 화면과 대조** — 배포 뒤 검증 화면 숫자가 하네스와 같은지
4. 저장값 갱신: 후보지 13곳 결과 탭 + 검증 화면 (브라우저 CDP, 4절 참고)
5. 스냅샷 갱신 `node scripts/dumpValidationSnapshot.mjs`

---

## 4. 브라우저로 저장값 갱신하는 법 (오늘 실제로 쓴 절차)

운영앱은 구글 SSO 전용이라 에이전트가 로그인을 못 한다. **크롬을 디버깅 포트로 띄우고
사용자가 한 번 로그인한 뒤 CDP로 붙는다.**

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 --user-data-dir=<스크래치패드>/chrome-profile \
  --no-first-run --no-default-browser-check <URL> &
```

그다음 `playwright-core`의 `chromium.connectOverCDP("http://127.0.0.1:9222")`.
결과 탭은 **열기만 하면 `run()`이 돌고 저장까지 한다**(ResultTab useEffect).

후보지 코드: `N001 N002 N003 N004 N005 N009 N010 N011 N012 N013 N014 N015 N016`
금액 뽑는 정규식: `/최종예상월매출[\s\S]{0,80}?([\d,]{9,})\s*원/`
저장 확인: Firestore write 요청을 세면 후보지 하나당 4건이 뜬다.

⚠️ 오늘 값과 대조하면 제대로 갱신됐는지 바로 안다 — N001 47,044,272원 · N005 66,003,531원 ·
N009 64,324,886원 · N016 46,673,390원.

---

## 5. ⚠️⚠️ 오늘 밟은 제일 큰 함정 — 하네스가 운영과 다른 모형을 쟀다

`_liveCheck`가 `ValidationStoreInput`에 **`preemptionScore`를 안 넣었다.** 운영 기본값이
`accessScoreMode: "visibility-x-preemption"`이라 접근성 피처가 `log(가시성 × 선점경쟁)`인데,
없으면 **가시성 단독**으로 떨어진다. **하루치 측정을 전부 버리고 다시 했다.**

```
  같은 코드(81d897e)·같은 자료로
    선점경쟁 넣고:  MAPE 9.215%  ±10% 24곳  ±20% 36곳
    선점경쟁 빼고:  MAPE 9.566%  ±10% 21곳  ±20% 34곳
```

**후보지 재계산하러 화면에 들어갔다가 우연히 걸렸다.** 안 걸렸으면 틀린 표가 그대로 결재
자료로 나갔다.

📌 **새 하네스를 만들 때마다 `validation/page.tsx`의 `inputs` 조립과 나란히 놓고 diff할 것.**
📌 **산식을 채택·기각하기 전에 운영 화면 숫자와 한 번 맞춰 볼 것.**
📌 하네스와 화면이 한 곳이라도 다르면 "캐시가 낡아서"로 넘기지 말 것 — 그게 신호였다.

---

## 6. 오늘 확인한 "더 옮길 게 없다" (다시 뒤지지 말 것)

| 항목 | 왜 안 되나 |
|---|---|
| 경쟁점 거리(좌표 기반) | 운영 산식이 `distanceM`을 **아예 안 읽는다.** 옮길 자리가 없다 |
| 로드뷰 판정(동선·가시성) | 52건이 **전부 기존점, 후보지 0건.** 학습에만 있고 예측에 없는 피처가 된다 |
| 사양 비중 0.4/0.25→0.5/0.15 | 판단(실험실이 스스로 "뜻으로 고른 값"이라 적음) |
| RAM 격차 | 지금 0.5가 MAPE 최저(0.0 8.932 · 0.5 8.903 · 1.0 8.937 · 1.5 8.954). ±10%·±20%는 어느 값에서도 안 움직인다 |
| 먹거리를 이용시간당으로 | 기각. MAPE 8.90 → 10.51% · ±10% −1곳 · ±20% −1곳 |
| 요금제(정액·좌석요금) | **이미 같다** — 실험실 `rateElasticity 0.546`·`referenceHourlyRate 1343`이 운영 `effectiveHourlyRate`와 같은 값. 실험실도 정액권/좌석요금 원자료를 모델에 안 넣는다 |
| 중심도·교과서식 예측·특수수요 배수 | 근거 약함, 전부 악화 |
| 먹거리·인테리어 | 잣대가 **원래 같다** |

**실험실 본체(교과서식 수요 모형)는 이식 대상이 아니다** — V62와 다른 산식이지 부품이 아니다.

### 산식 아닌 쪽으로 남은 것

- 📌 **RAM은 우리가 밀린다** — 32GB가 자사 12.5% 대 경쟁점 38%(3배). 아이온2가 자리잡으면
  실제 약점이 될 수 있는데 지금 자료로는 안 잡힌다(38곳 중 25곳의 평가창이 2025년에 끝나
  아이온2가 그 매출에 없다). **사양 정책 쪽 얘기다.**
- 매장별 정액권 비중을 38곳치 받으면 실효단가를 매장별로 풀 수 있다. 지금은 8곳 원장뿐이고,
  그건 가맹점 카운터 로그라 **에이전트가 추가로 못 뽑는다**(사용자 확인).
