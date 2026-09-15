# 회사 PC 인계 — 2026-09-16

집 PC(`C:\Users\09960\store-eval-work`)에서 2026-09-15 밤에 작업했다. **이 문서 하나만 읽으면
이어진다.** 자세한 경위는 `docs/textbook-model-handoff-2026-09-15.md` 8~13절에 있다.

---

## 0. 회사에서 제일 먼저

```bash
git pull
npm run build && npx vitest run --exclude "**/_*.test.ts" --reporter=dot
```

⚠️ **`.local-tools/`는 git에 없다.** 회사 PC엔 수집 자료가 없으므로 스냅샷부터 다시 뜬다.

```bash
node scripts/dumpValidationSnapshot.mjs
```

이걸 안 하면 `storedAccuracyParity` 5건이 붉게 뜨는데 **코드 문제가 아니다.**
(2026-09-15에 이걸로 한참 헤맸다. 테스트가 붉으면 스냅샷 `fetchedAt`부터 본다.)

---

## 1. 어젯밤에 한 일 — 한 줄 요약

**기초자료 수집을 전부 자동화하고, 손으로 넣었던 값을 같은 기준으로 교체했다.**

| | 전 | 후 |
|---|---|---|
| 유동인구 | 소상공인365, 500m 하나, 출처·시점 불명 | **100/200/300/400/500m + 13개월 + 연령·성별**, 전 지점 동일 기준 |
| 주거인구 | 사람이 SGIS 화면 보고 손입력 | **자동 수집, 2024년 기준 통일** |
| 적중률 | MAPE 9.37% · ±10% 63.16% | **MAPE 9.26% · ±10% 65.79%** |

### 뚫은 경로 두 개 (둘 다 반경이 자유 파라미터)

```
소상공인365  bigdata.sbiz.or.kr   유동인구·업소수·업소당매출·직장인구·방문고객   EPSG:5181
SGIS 생활권역 sgis.mods.go.kr      주거인구 74필드·가구 45·주택 38              EPSG:5179
```
⚠️ **좌표계가 다르다.** 섞으면 에러가 아니라 **조용히 빈 값이나 엉뚱한 값**이 온다.
`scripts/lib/tm.mjs`가 시작할 때 아는 점으로 검산하므로 그걸 쓴다.

### 찾아낸 기초자료 오류

- **N003 호구포역점 유동 500m**: 35,105 → 실제 103,474 (연령·성별까지 한 벌이 통째로 다름).
  상권성격이 주거중심→번화가로 뒤집히고 예상매출 7,948만→8,618만. **교정 완료.**
- 주거인구 5곳(문산·발산역·광주각화·전대상대·금촌역)이 3~10% 어긋나 있었다. **교체 완료.**

---

## 2. 지금 상태

| 항목 | 상태 |
|---|---|
| 유동인구 100~500m | ✅ 52곳 투입 완료 |
| 주거인구 500m·1km + 연령 | ✅ 52곳 투입 완료 |
| 저장된 적중률 | ✅ 9.2630%로 갱신됨 |
| 실험실 유동 반경 | ✅ 100/200/300/400/500m 선택 가능 |
| **기존점 수요 캐시** | ⚠️ 뒤처짐 — **매일 06시 크론이 자동 갱신**(vercel.json `0 21 * * *` UTC) |
| **N003 후보지 결과** | ⚠️ 옛 값 — 그 화면을 한 번 열면 갱신 |
| **리포트 탭 수집** | 🔄 진행 중이었다 (아래) |

---

## 3. 이어서 할 일

### ① 리포트 탭 수집 마저 끝내기 (제일 먼저)

집 PC에서 52곳 중 일부만 끝난 채 밤이 됐다. **이어받기가 되므로 그냥 다시 돌리면 된다.**

```bash
node scripts/collectSbizReportTabs.mjs
```
회사 PC엔 `.local-tools/`가 없으므로 **처음부터 다시 받아야 한다**(유동인구 수집도 먼저).

```bash
node scripts/collectSbizFloatingPopulation.mjs    # 유동 (약 40분)
node scripts/collectSgisResidentPopulation.mjs    # 주거 (약 10분)
node scripts/collectSbizReportTabs.mjs            # 탭 전수 (약 35분)
```
⚠️ 자동모드 분류기가 외부 수집을 막을 수 있다. 막히면 터미널에 `!` 붙여 직접 돌린다.

### ② 새 신호가 쓸모 있는지 훑기

하네스를 만들어뒀다(gitignore라 회사 PC엔 없다 — 아래 내용으로 다시 만들거나
`docs/textbook-model-handoff-2026-09-15.md`를 참고한다).

```
src/lib/storeEval/_newSignalsScan.test.ts   새 신호 × 실제매출 상관 훑기
src/lib/storeEval/_baseDataSwap.test.ts     기초자료 교체 전후 적중률 비교
```

훑을 신호: **업소당 월평균매출**(우리가 맞히려는 값의 지역 기준선) · PC방 업소수 시계열 ·
주말/주중 유동비 · 시간대별 유동 · 직장인구 · 학교 학생수 · 방문고객 신규율.

⚠️ **상관은 후보를 찾는 도구지 채택 근거가 아니다.** 2026-09-15에 밀집도 보정이 r=0.660으로
유의했는데 실제로 넣으니 MAPE가 30%→48%로 나빠졌다. 채택은 무작위 대조군을 둔 검정으로.

### ③ 좌표 확인 (사람 눈이 필요)

주소를 변환해 좌표를 만들었는데 **15곳은 `"601~603호"` 같은 복수 호실 때문에 건물 주소로**
잡았다. 500m 이상에선 무시할 오차지만 **100m 원에서는 결과가 갈린다.**
지도에서 확인해 보정할 것. `.local-tools/geocoded-sites.json`의 `method: "쉼표앞"`이 그 15곳이다.

### ④ 아직 안 쓰는 자료

- SGIS: 가구 45필드 · 주택 38필드 (아파트 비율·가구 구성이 PC방 수요와 관계있는지 미검정)
- 소상공인365 sg6: 아파트 단지규모·면적별, 지하철 이용, 주요시설 — 지금은 500m 고정값만 쓴다
- 유동 1km: 수집은 했으나 대응 필드가 없어 미투입

---

## 4. 건드리지 않은 것

- **운영 산식(`calc.ts`/`usageRevenue.ts`)은 한 줄도 안 바꿨다.** 바뀐 건 입력 자료뿐이다.
- 교과서식은 여전히 `textbookModel.ts` + `/store-eval/lab`에만 있다.
- 기존 500m 유동인구는 **교체**했지만(12절 근거), 1km 유동은 그대로 뒀다.

---

## 5. 참고 — 새로 생긴 스크립트

```
scripts/lib/tm.mjs                            좌표변환(5181/5179) + 자체 검산
scripts/dumpValidationSnapshot.mjs            검증 스냅샷 덤프 (읽기 전용)
scripts/geocodeExistingStores.mjs             주소 -> 좌표 (운영 DB 안 건드림)
scripts/collectSbizFloatingPopulation.mjs     유동인구 반경별
scripts/collectSgisResidentPopulation.mjs     주거인구 반경별
scripts/collectSbizReportTabs.mjs             리포트 탭 전수
scripts/writeFloatingPopulationToFirestore.mjs  유동 투입 (--include-500 --apply)
scripts/writeResidentPopulationToFirestore.mjs  주거 투입 (--apply)
scripts/fixCandidateFloatingN003.mjs          N003 교정 (1회성, 이미 적용됨)
```
전부 **미리보기가 기본**이고 `--apply`를 붙여야 쓴다. 수집기는 전부 이어받기가 된다.
