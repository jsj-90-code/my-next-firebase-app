# 검증 스냅샷 복구 + 오늘 변경이 적중률을 건드렸는지 실측 확인 (2026-09-13 밤, 무인 작업)

사용자가 자리를 비우며 "알아서 계속해볼래?"라고 위임했다. 판단이 필요한 일과 눈으로 봐야 하는
일은 빼고 **미검증 항목을 줄이는 쪽**으로 잡았다. 오늘 하루 "눈으로 확인 안 함"이 5건 쌓였고,
특히 기준매출 오픈월 규칙을 바꾸면서 "V62·적중률에 영향 없다"를 **코드로만** 확인한 상태였다.

## 1. `.local-tools` 복구

PC를 옮기면 사라지는 폴더라 집 PC에 없었고, 그 탓에 정식 테스트 3건이 계속 실패하고 있었다.
`docs/handoff-home-pc-20260911.md`에 보존된 소스로 `admin-db.mjs`를 복구하고,
`dump-validation-snapshot.mjs`를 `storedAccuracyParity.test.ts`의 `Snapshot` 타입(정본)에 맞춰
다시 썼다. **읽기 전용이다.**

```
후보지 9 / 평가결과 9 / 기존점 41 / 경쟁점 224 / 입지평가 50 / 월매출 850 / 운영설정 있음 / 저장된 적중률 있음
```

`dump-validation-snapshot.mjs`는 gitignore라 또 사라진다. 전문을 이 문서 맨 아래에 보존해뒀다.

## 2. ★ 오늘 변경이 적중률을 건드리지 않았다 — 실측 확인

```
정식검증군 38곳 (최소 완료월 1)
MAPE 9.88% · 중앙값 9.02%
±10% 52.63% · ±15% 76.32% · ±20% 89.47%
저장값: n=38 MAPE 9.88% ±10% 52.63% ±20% 89.47% (V62-usage-v1)
```

2026-09-10에 기록된 값(MAPE 9.881% / 중앙값 9.02% / ±10% 20·38 / ±20% 34·38)과 **정확히 일치**한다.

후보지 9곳도 저장된 예측값과 **전부 0.00% 차이**다.

| 후보지 | 저장값 | 지금값 | 차이 |
|---|---:|---:|---:|
| N001 신중동점 | 50,547,586 | 50,547,586 | 0.00% |
| N003 호구포역점 | 88,036,053 | 88,036,053 | 0.00% |
| N012 산본점 | 58,280,450 | 58,280,450 | 0.00% |
| (나머지 6곳도 전부 0.00%) | | | |

즉 오늘 한 것 — **기준매출 오픈월 규칙 변경**, 담당자 판단 매출, 요인별 기여도 노출 — 이 전부
V62 예상매출과 적중률에 **영향이 없다는 게 실데이터로 확인됐다.** 코드로만 주장하던 것이다.

경쟁 단조성 테스트도 09-11 기록과 같은 형태로 재현됐다(독점으로 만들면 9곳 전부 매출이 내려가는
알려진 현상 — `docs/review-needed-2026-09-11.md` 0번에서 이미 조사·종결한 건이다).

## 3. ★ 요인별 기여도가 기존 진단과 교차검증됐다

오늘 새로 만든 "왜 이 매출인가"를 실데이터 9곳에 돌려봤다. **값이 그동안의 사람 판단과 맞는다.**

| 후보지 | 가장 큰 요인 | 전부 곱하면 | 기존 기록과 대조 |
|---|---|---:|---|
| N012 산본점 | 접근성·가시성 **−18.2%** | −19.5% | 실제 평가기록에 *"점포가 7층에 위치해 접근성과 가시성에 일부 제약이 있음"* — **일치** |
| N011 마산산호점 | 경쟁력 우위 **+16.1%** | +33.2% | backlog 진단 *"야구장 아니고 경쟁이 약해서"* — **일치** |
| N003 호구포역점 | 배후수요 +15.2%, 가시성 +13.7% | +34.3% | 09-11에 가동률 경고를 넣은 곳 — 높게 나오는 이유가 드러남 |
| N001 신중동점 | 접근성·가시성 **−11.2%** | −1.5% | backlog의 "번화가 판정을 못 받는 구조" 진단과 다른 각도의 설명 |

**모형이 왜 그 숫자를 냈는지가 사람이 현장에서 내린 판단과 같은 곳을 가리킨다.** 기여도 분해가
그럴듯한 장식이 아니라 실제 근거로 쓸 수 있다는 뜻이다.

값의 범위도 −18.2% ~ +16.1%로 현실적이다(비현실적 극단값 없음 — 테스트로도 고정).

### 여기서 발견해 고친 것

9곳 중 8곳에서 **"배후수요 상권(군부대·산업단지) −1.7%"** 가 떴다. 해당되지 않는 상권인데도
0/1 표시값이라 "코호트 평균 대비 낮다"는 이유로 마이너스 기여가 잡힌 것이다. 계산은 맞지만
라벨이 그대로면 *"우리 상권이 군부대라는 건가?"* 로 읽힌다. 해당 여부에 따라
**"배후수요 상권 해당 없음"** 으로 바뀌게 고쳤다.

## 4. 스냅샷 없는 PC에서 테스트가 깨지던 문제 — 근본 원인 수정

세 테스트 모두 `existsSync(SNAPSHOT) ? describe : describe.skip` 으로 막아뒀는데 **실제로는
터졌다.** vitest는 `describe.skip`이어도 **콜백을 수집 단계에서 실행**하기 때문이다. 콜백 첫 줄의
`readFileSync`가 그대로 돌아 ENOENT로 파일 전체가 실패했다. 회사 PC에는 스냅샷이 있어서 이
구멍이 안 보였다.

`validationSnapshot.ts`(공용 로더)로 묶었다 — 없으면 던지지 않고 **빈 스냅샷**을 돌려준다.

| | 전 | 후 |
|---|---|---|
| 스냅샷 없음 | **3파일 실패** | 604 통과 / 4파일 skip / **실패 0** |
| 스냅샷 있음 | 618 통과 | 621 통과 / **실패 0** |

실제로 스냅샷을 잠시 치워서 양쪽 다 확인했다.

## 확인한 것

- `npm run build` 통과 / **621 통과 · 실패 0** / `npm run lint` **0건**
- 스냅샷 유무 양쪽에서 테스트가 깨끗하게 도는 것을 직접 확인

## 남은 것 (사람이 봐야 함)

- **화면은 여전히 눈으로 못 봤다.** 기여도 막대 비율·문구가 읽을 만한지, `.app-notice` 42곳
  교체 결과가 어떤지는 사람이 열어봐야 안다.
- 담당자 판단 매출 저장, AI 초안의 [선투자 프로모션] 섹션·등급, 전환 스냅샷 동결도 그대로 남아 있다.

---

## 부록 — `dump-validation-snapshot.mjs` 전문 (gitignore라 여기 보존)

`admin-db.mjs`는 `docs/handoff-home-pc-20260911.md` 2번 절에 있다. 둘 다 `.local-tools/`에 두고
`node .local-tools/dump-validation-snapshot.mjs` 로 돌린다.

```js
// 검증 스냅샷 생성 (읽기 전용).
import { writeFileSync } from "node:fs";
import { db } from "./admin-db.mjs";

const all = async (name) => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const one = async (name, id) => {
  const snap = await db.collection(name).doc(id).get();
  return snap.exists ? snap.data() : null;
};

console.log("읽는 중...");
const [candidates, results, existingStores, competitors, locationEvaluations, sales] = await Promise.all([
  all("storeEvalCandidates"),
  all("storeEvalResults"),
  all("storeEvalExistingStores"),
  all("storeEvalCompetitors"),
  all("storeEvalLocationEvaluations"),
  all("storeEvalExistingStoreSales"),
]);
const settings = await one("storeEvalSettings", "current");
const storedAccuracy = await one("storeEvalSystemStatus", "accuracy");

writeFileSync(".local-tools/validation-snapshot.json", JSON.stringify({
  fetchedAt: new Date().toISOString(),
  candidates, results, existingStores, competitors, locationEvaluations, sales, settings, storedAccuracy,
}, null, 2), "utf8");
console.log(`후보지 ${candidates.length} / 평가결과 ${results.length} / 기존점 ${existingStores.length} / 경쟁점 ${competitors.length} / 입지평가 ${locationEvaluations.length} / 월매출 ${sales.length}`);
```

## 후속 — 같은 단위 버그가 더 있는지 전수 확인 (결과: 없음)

핑봇 가동률 건을 고친 뒤, **같은 유형이 다른 곳에도 있는지** `formatPercent` 호출처를 전수로 훑었다
(약 40곳). 결론은 **`pingbotUtilization` 하나뿐**이었다.

| 의심했던 값 | 판정 |
|---|---|
| `measuredSeatRate` (0~100으로 입력받음) | `formatPercent`에 가지 않는다 — 입력 폼에서만 쓰고 계산은 `calc.ts`가 정규화해 처리 |
| `sheetInflowRate` | 시트 원시값이 아니라 `getV62Rate`가 설정에서 만든 보정률(0~1). 정상 |
| 가동률 계열(`v62ImpliedUtilization`·`expectedUtilization`·`v62MaxUtilizationRate`) | 전부 계산된 0~1 비율. 정상 |
| 적중률 계열(`within10PctRatio`·`meanAbsoluteErrorPct` 등) | 전부 0~1 비율. 정상 |

**코드 변경 없음.** 확인만 하고 끝난 점검이지만, "하나 고쳤으니 비슷한 게 더 있을 것"이라는
의심을 닫아두는 값어치가 있어 남긴다.

## 부록 2 — 기여도 프로브 (`_driverProbe.test.ts`, gitignore → 2026-09-13 정식 편입됨)

`src/**/_*.test.ts`는 gitignore라 이 파일도 저장소에 안 남는다. 다만 `_liveCheck.test.ts`는
force-add로 편입한 선례가 있다(측정 하네스는 따라다녀야 한다는 판단, 2026-09-10).

**이 프로브도 정식 편입할지는 사람이 판단할 것** — 무인 작업 중이라 gitignore 관행을 임의로
뚫지 않았다. 편입하려면 `git add -f src/lib/storeEval/_driverProbe.test.ts`.

돌리는 법:
```
npx vitest run src/lib/storeEval/_driverProbe.test.ts --reporter=verbose --disable-console-intercept
```

핵심만 옮기면, `storedAccuracyParity.test.ts`와 **똑같은 방식으로 컨텍스트를 구성해서**
`evaluateCandidate`를 후보지마다 돌리고 `result.revenueBreakdown?.usageDrivers`를 출력한다.

```ts
const rows = snap.candidates.map((candidate) => {
  const evaluated = evaluateCandidate({
    candidate,
    competitors: allCompetitors.filter((c) => c.candidateCode === candidate.code),
    locationEvaluation: snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null,
    settings,
    existingStores: snap.existingStores,
    trainingLocationEvaluations: snap.locationEvaluations,
    trainingCompetitors: allCompetitors,
    trainingSales: sales,   // evaluationSalesIds로 12개월 구간만 거른 것
  });
  return { code: candidate.code, drivers: evaluated.revenueBreakdown?.usageDrivers ?? null };
});

// 로그 기여분 → 퍼센트
labels.forEach((label, i) => console.log(label, (Math.exp(contributions[i]) - 1) * 100));
```

세 가지를 검사한다 — ① 라벨과 기여도 개수가 항상 같은지 ② 한 요인이 ±10배를 넘지 않는지
(넘으면 그 후보지 입력이 코호트 범위를 크게 벗어났다는 신호다) ③ 후보지별 표를 남긴다.
