# 집 PC에서 이어서 작업하기 — 2026-09-11 인계

주말에 집에서 이어 하려면 이 문서 하나만 보면 된다. **급한 일은 없다.**

---

## 1. 시작하기

```
git pull                  # 2026-09-11 회사 PC에서 80여 커밋
npm install               # package.json이 바뀌었다(firebase-tools 추가) — 꼭 돌려라
npm run build             # 통과 확인
npx vitest run --exclude "**/_*.test.ts"   # 593건 통과해야 정상
```

`.env.local`은 집 PC에 이미 있어야 한다. **오늘 새 키를 추가하지 않았다.**

### 보안규칙 테스트를 돌리려면 (선택)

```
npm run test:rules        # 22건. JDK가 없으면 설치 명령을 알려주고 멈춘다
```

집 PC에 Java가 없으면 이렇게 설치한다. 설치 후에는 경로를 알아서 찾는다.

```
winget install -e --id EclipseAdoptium.Temurin.21.JDK
```

### 운영 자료로 분석하려면 (선택)

```
node .local-tools/dump-validation-snapshot.mjs
```

`.local-tools`는 git에 없다. 집 PC엔 이 폴더가 비어 있을 수 있는데, **위 한 줄이면
분석에 필요한 스냅샷이 새로 만들어진다**(읽기 전용). `admin-db.mjs`가 없다면 아래 2번 참고.

---

## 2. `.local-tools`가 비어 있을 때

회사 PC의 `.local-tools`는 git에 올라가지 않는다(gitignore). 집에서 분석을 돌리려면
`admin-db.mjs` 하나만 있으면 되고, 나머지 스크립트는 없어도 된다.

`.local-tools/admin-db.mjs`:

```js
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.trim().match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
}
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
export const db = getFirestore();
```

`dump-validation-snapshot.mjs`는 git에 없으므로, 필요하면
`docs/releases/2026-09-11-day-summary.md`의 재현 절차를 보고 다시 만들거나
정식 테스트(`storedAccuracyParity.test.ts`)의 주석을 참고한다.

---

## 3. 오늘 무엇이 끝났나 (한 줄씩)

전체는 `docs/releases/2026-09-11-day-summary.md`에 있다.

- **적중률 개선안은 0건.** 후보 7개 전부 기각/보류. **산식 작업은 표본 45~50곳까지 멈춤**
- 보안규칙 테스트 22건이 **처음으로 실제 실행**됨(그전엔 실행 자체가 불가능했다) + 변이검사 5/5
- 조용한 실패 5종 수정(설정 로드 실패 → 기본 계수, SGIS 200 오류, 카카오 좌표 0·0,
  시트 날짜 하루 밀림, 후보지코드 카운터 백업 누락)
- 백업 v2 — 좌석배치도·카운터·평가결과·상권자료 업로드 이력 포함
- 대시보드·목록에 **"재계산 필요" 배지**
- AI 채점 검증에 **유료 호출 확인창 + 중단 버튼**
- 경쟁점 탭에 **"약한 경쟁점을 넣으면 매출이 오를 수 있다"는 설명**
- 결과 탭에 **"V62가 전제하는 가동률"** 카드 + 경쟁점 실측 대비 경고

---

## 4. 집에서 할 만한 것 (우선순위 순)

### ① 예측 매출을 사람이 조정할 수 없는 문제 — 설계만 해두면 된다

사용자가 남긴 말: **"예측 매출액 조정을 못 하니까 그게 좀 굉장히 찝찝하구만"**

지금 구조는 입력 → 산식 → 표시로 끝이고, 현장 감각으로 "이건 높다/낮다"를 알아도
반영할 수단이 없다. 그렇다고 예측값을 직접 고치게 하면 **적중률 검증이 무의미해진다**
(사람이 고친 값으로 MAPE를 재면 아무 의미가 없다).

**권하는 방향 — 산식 예측은 그대로 두고 "담당자 판단값"을 나란히 기록한다.**

| | 지금 | 제안 |
|---|---|---|
| V62 예상매출 | 화면 표시 | 그대로 |
| 담당자 판단 매출 | 없음 | **새 입력** (비워둬도 됨) |
| 판단 근거 | 없음 | **새 입력** (한 줄 메모) |

이렇게 하면:
- 산식은 오염되지 않아 적중률 검증이 그대로 유지된다
- 현장 판단이 버려지지 않고 남는다
- **개점 후 실제 매출이 나오면 "산식이 맞았나, 사람이 맞았나"를 데이터로 알 수 있다.**
  이게 진짜 가치다 — 사람이 계통적으로 더 맞으면 그 차이가 산식 개선의 단서가 된다.
  지금 표본 38곳에서 막혀 있는 상황을 우회하는 길이기도 하다

**구현 범위**(하기 전에 사용자 확인을 받는 게 좋다 — 업무 흐름이 바뀐다):
- `CandidateInput`에 `judgedRevenue: number | null`, `judgedReason: string | null` 추가
- 결과 탭에 입력 UI + V62와 나란히 표시
- 검증 화면에 "산식 vs 담당자" 비교 표(표본이 쌓인 뒤)

### ② 후순위 진단 — 이미 끝냈다

신중동·마산산호·호구포역 진단은 오늘 다 했다.
결과는 `docs/releases/2026-09-11-candidate-diagnosis.md`.
요약: **신중동은 "사는 사람이 너무 많아서" 번화가 판정을 못 받는 구조 문제**,
마산산호는 **야구장 아니고 경쟁이 약해서**(현장 확인과 일치), 호구포역은 **지적이 맞았고**
화면 경고를 넣었다.

### ③ 남은 자잘한 것

- 백업에 안 담기는 4종(수요거점·행정구역 참고자료·감사로그·관리자 목록)은 **일부러 뺐다.**
  재수집 가능하거나 복원하면 안 되는 성격이다. 건드릴 필요 없다.
- 화면 감사는 주요 화면을 다 돌았다. 남은 건 없다.

---

## 5. 하지 말 것

- **가중치를 다시 탐색하지 마라.** 08-28·09-01·09-02·09-03·09-11로 이미 다섯 번이다.
  후보는 `src/lib/storeEval/weightsCandidateParity.test.ts`에 **고정**해뒀다.
  표본이 45~50곳이 되면 그걸 **그대로** 돌려서 판정한다.
- **수요 총량에 배율을 곱하는 안** — 재학습하면 효과가 정확히 0이다(검증 완료).
- **이용률 표 정확도** — 예상매출 영향이 0.1% 수준이다(검증 완료).
- **총액 보존 구성비 재분배** — 총매출 적중률이 정의상 불변이다.
- **경쟁점 시간당환산요금 채우기** — 산식이 안 쓴다. 비어 있어도 무방하다.
- **사양별 대수 조사** — 경쟁점을 못 재면 비교가 안 돼 의미 없다(사용자 지적).

---

## 6. 표본이 45~50곳이 됐을 때 (아마 몇 달 뒤)

```
node .local-tools/dump-validation-snapshot.mjs
npx vitest run src/lib/storeEval/storedAccuracyParity.test.ts      # 기준선
npx vitest run src/lib/storeEval/weightsCandidateParity.test.ts    # 고정 후보 판정
npx vitest run src/lib/storeEval/competitorMonotonicity.test.ts    # 방향 문제
```

기준값과 판정 기준은 `docs/backlog.md`의 "다음 착수 지점" 절에 있다.
