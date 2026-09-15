# 교과서식 산식 — 현재 상태와 이어서 할 일 (2026-09-15 야간)

사용자 지시: "유동인구 반경별로 기초데이터 추가해라. 교과서식 데이터 완성하도록 해.
14시간 뒤에 오니까 그때까지 멈추지 말고 일 잘해놔라." / "집에서 접속할 거니까 집에서
이어서 할 수 있게 저장해놓고. 세팅도 해놔라."

이 문서 하나만 읽으면 어디서든 이어서 할 수 있게 적는다.

---

## 1. 지금까지 확인된 결론 (다시 파지 말 것)

### 교과서식은 지금 자료로 MAPE 29%가 한계다 — 조합 50,400개 전수 확인

```
최선 MAPE           29.0%
20% 이내 조합 수     0개 / 50,400개
25% 이내 조합 수     0개
상위 12개가 전부 29.0~29.3%로 뭉쳐 있다
부분표본(70% x 60회) 재검: 중앙 30.0% / 최악 36.9%
```

상위 조합이 서로 붙어 있다는 건 **과적합이 아니라 진짜 벽**이라는 뜻이다. 파라미터를
더 돌려봐야 소용없다. 목표 10%(마지노선 20%)는 **새 자료 없이는 불가능하다.**

재현: `DEMAND_SEARCH=1 npx vitest run src/lib/storeEval/_textbookGrid.test.ts`

상위 조합의 모양 (참고):
```
주거1km연령 · 유동계수 0.35~0.5 · 격차지수 0.5~1.5 · 미이용몫 0~250 · 흡인력 0~0.8
10대 이용률 0.2 · 20대 이용률 0.45
```
→ **20대 가중이 10대보다 높은 쪽이 일관되게 낫다.** 이건 의외의 발견이고 기억할 값이다.

### 구조에서 빠져 있던 개념 두 개는 실제로 효과가 있었다

```
기본                        MAPE 45.8%
+ "PC방 안 가는 몫" 500      MAPE 30.1%   <- 가장 크게 먹혔다
+ 상권 흡인력 0.6            MAPE 32.8%
```
경쟁점이 0곳이면 점유율이 100%가 되어 동네 수요를 통째로 먹던 게 최대 결함이었다
(광주각화 2억2천/실제 7,616만, 남악 1억7천/실제 6,286만, 탕정역 1억6천/실제 7,586만).

### 망포점 가설은 이 방식으로는 확인되지 않았다

사용자 통찰: "망포점 위에 500m 역 하나 있는데 유동인구 끌어쓰나보네. 거기 상권까지 안 먹는데."
유동/주거 비율을 대리변수로 써서 재봤으나 `r = -0.157`(방향도 반대, 유의선 0.32 미달)이다.

다만 **다른 패턴이 보인다** — 과소예측 5곳(문경시청·양주덕정·금촌역·수원인계·문산)은
500m 주거인구가 전부 7,057~12,821로 낮고, 과대예측 8곳은 10,547~30,114로 높다.
**아직 검정하지 않았다. 이어서 할 일 1순위 후보다.**

재현: `npx vitest run src/lib/storeEval/_floatingBorrow.test.ts`

### 수요 반경은 주거 1km가 맞다

```
주거 500m 총수     r = 0.299   <- 쓰면 안 된다 (연령 분해 자료도 없다)
주거 1km  총수     r = 0.511
주거 1km  연령가중  r = 0.516
유동 500m 총수     r = 0.692   <- 유동이 주거보다 강하다
```

---

## 2. 막혀 있는 것 — 유동 100m/200m 수집

**새 자료 없이는 29% 벽을 못 넘는다.** 그래서 이게 지금 가장 중요한 작업이다.

### 수집 경로 (사용자가 알려준 순서)

```
https://bigdata.sbiz.or.kr/
  빅데이터 상권분석 > 상세분석
  > 위치선택란에 주소 입력
  > 하단바 "업종을 선택 또는 검색해주세요"에 PC방 검색 후 드롭다운 항목 클릭
  > 지도에 반경 클릭 > 반경설정 후 확인 클릭
  > 분석하기
```
사용자 확인: **로그인 없이 가능하다.**

⚠️ 옛 주소 `sg.sbiz.or.kr`는 죽었다(ERR_CONNECTION_TIMED_OUT). `bigdata.sbiz.or.kr`가 현재 주소다.
`sbiz.or.kr` -> `sbiz24.kr`, `sgis.kostat.go.kr` -> `sgis.mods.go.kr`로 다들 이전했다.

### 앱 쪽 준비는 끝나 있다

- `types.ts` — `floating100*` / `floating200*` 16개 필드(선택 필드)
- `marketDataExtract.ts` — `MarketRadiusKey("100"|"200"|"500"|"1km")`, 반경별 필드 생성
- `MarketDataUploadPanel` — 반경 버튼에 100m·200m 있음
- `/store-eval/lab` — 세 반경 모두 읽고 반경별 수집 곳수를 표시

파이프가 뚫린 건 `_floatingRadius.test.ts`로 확인했다(4/4 통과). **500m 기존 자료를
덮어쓰지 않는 것도 확인했다.**

### 자동화 상태

agent-browser는 살아 있다(`agent-browser open https://example.com` 성공).
죽으면 이렇게 되살린다 — 좀비 데몬이 원인이다.
```bash
D=/c/Users/ISENS/.agent-browser
for f in $D/*.pid; do [ -f "$f" ] && taskkill //F //PID $(cat "$f"); done
rm -f $D/*.pid $D/*.port $D/*.stream $D/*.version $D/*.config $D/*.target $D/*.engine
taskkill //F //IM chrome.exe //T
```
사이트가 SPA(해시 라우팅)라 클릭이 잘 안 먹는다. `snapshot -i -u`로 ref를 다시 잡고
`wait --load networkidle`을 사이에 넣어야 한다.

---

## 3. 이어서 할 일 (우선순위)

1. **유동 100m/200m 수집** — 위 경로로 38곳 + 후보지. 이게 29% 벽을 넘을 유일한 길이다.
2. **500m 주거인구 패턴 검정** — 과소예측군이 전부 주거인구가 낮다. 왜인지 봐야 한다.
3. 수집되면 `_textbookGrid.test.ts`에 반경 100/200을 넣고 다시 전수 탐색.
4. 결과를 `/store-eval/lab`에서 눈으로 확인.

---

## 4. 집에서 이어받는 방법

```bash
git pull
npm install                                   # 필요하면
node .local-tools/dump-validation-snapshot.mjs   # 검정용 스냅샷(gitignored)
npx vitest run src/lib/storeEval/_textbookScore.test.ts   # 지금 성적 확인
```

⚠️ 검정 하네스는 `src/**/_*.test.ts`라 **git에 안 올라간다**(.gitignore). 집 PC에는
없으므로 이 문서의 수치를 근거로 다시 만들어야 한다. 파일 목록:
```
_textbookScore.test.ts    교과서식 점수 + 조합별 비교
_textbookGrid.test.ts     50,400개 전수 탐색 (DEMAND_SEARCH=1)
_floatingBorrow.test.ts   망포점 가설 검정
_floatingRadius.test.ts   반경별 필드 생성 점검
_demandRadius.test.ts     반경별 상관 비교
```

운영에 올라간 것(집에서도 보임):
```
src/lib/storeEval/textbookModel.ts       교과서식 순수 산식
src/app/store-eval/lab/page.tsx          실험실 화면
https://my-next-firebase-app-one.vercel.app/store-eval/lab
```

### SGIS API 키

`.env.local`에 넣으려 했으나 보안 가드가 막았다. **직접 넣어야 한다.**
```
SGIS_SERVICE_KEY=...
SGIS_SECRET_KEY=...
```
다만 SGIS에는 **유동인구가 없다**(거주인구·사업체만, 반경 파라미터도 없음). 거주인구
자동화에는 쓸 수 있다. 키가 채팅에 노출됐으므로 한 번 재발급하는 게 좋다.

---

## 5. 건드리지 않은 것

**운영 산식(`calc.ts` / `usageRevenue.ts`)은 한 줄도 안 바꿨다.** 교과서식은 전부
`textbookModel.ts`(신규)에 있고 `/store-eval/lab`에서만 호출된다. 운영 화면의 예상매출은
그대로 기존 산식(MAPE 9.67%)이다.

---

## 6. 야간 추가 발견 (2026-09-15 심야)

### 치우침은 500m 주거인구와 강하게 붙어 있다 — 그런데 고치면 나빠진다

```
무엇이 치우침(예측/실제-1)을 설명하나       (유의선 0.32)
  500m 주거인구      r =  0.660   <- 유의, 유의선의 2배
  유동인구           r =  0.259
  유동/주거 비율      r = -0.157
  유동 - 주거x5      r = -0.061
```

500m 주거인구가 많을수록 과대예측된다. 수요를 1km로 재는데 500m 안에 얼마나 몰려 있는지가
매장마다 달라서 생기는 것으로 보였다. 그래서 수요에 `(500m주거/1km주거)^(-계수)`를 곱해
상쇄하는 `densityCorrection` 파라미터를 넣고 재봤다. **역효과였다.**

```
+ 미이용몫 500 (기준)   MAPE 30.1%
+ 밀집보정 0.3          MAPE 31.0%
+ 밀집보정 0.6          MAPE 33.7%
+ 밀집보정 1.0          MAPE 40.3%
+ 밀집보정 1.5          MAPE 48.5%
```

→ 상관은 진짜인데 **비율(500m/1km) 형태로는 아니다.** `densityCorrection` 기본값은 0으로
두었다(꺼진 상태). 파라미터 자체는 남겨두었으니 다른 형태를 시험할 때 쓰면 된다.

**다음에 시험해볼 것**: 절대값 `pop500m^(-c)`, 또는 수요 자체를 1km가 아니라 500m로 재되
연령 분해가 없는 문제를 1km 연령비율로 안분하는 방식.

### 그래서 남은 길은 여전히 유동 100m/200m 수집이다

파라미터로는 50,400개를 다 훑어 29%가 벽이었고, 구조 보정(밀집도)도 실패했다.
**새 자료 없이 넘을 수 있는 벽이 아니다.**

---

## 7. 소상공인365 자동화 — 여기까지 뚫었다 (2026-09-15 심야)

UI 경로는 **끝까지 확인했다.** 막히는 건 사이트가 아니라 agent-browser 데몬이 명령 사이에
자꾸 끊기는 것이다(`os error 10060`, 세션 상태가 날아간다).

### 확인된 실제 경로

```
https://bigdata.sbiz.or.kr/#/gis/locAnls        <- 입지분석. 직접 들어가진다
  title: "소상공인365 > 입지분석"
```

⚠️ **분석 UI 전체가 iframe 안에 있다.** snapshot에서 `Iframe [ref=eN]` 아래로 나온다.

동작 확인된 순서 (영월점 주소로 끝까지 성공):
```
1. textbox "주소, 상호명을 검색 또는 위치 선택"  에 주소 입력
2. button "검색" 클릭
   -> button "강원특별자치도 영월군 영월읍 단종로 3-1" 같은 후보가 뜬다. 그걸 클릭
3. textbox "업종을 선택 또는 검색해주세요"  에 "PC방" 입력
4. 옆 button "검색" 클릭
   -> button "예술·스포츠 > 유원지·오락 > PC방" 이 뜬다. 그걸 클릭
5. (여기까지 성공) 다음은 지도에서 반경 클릭 -> 반경설정 -> 확인 -> 분석하기
```

### 팝업이 클릭을 막는다

홈 진입 시 모달이 뜬다. 이렇게 지우고 시작한다.
```js
document.querySelectorAll(".q-dialog").forEach(d => d.remove());
document.querySelectorAll(".q-dialog__backdrop").forEach(d => d.remove());
```

### 내부 API (번들에서 추출)

`https://bigdata.sbiz.or.kr/assets/index-*.js` 를 받아 `/(sbiz|gis|pub)/api/...` 를 긁으면 나온다.
재현: `node .local-tools/_find-sbiz-api.mjs` (번들 해시가 바뀌면 URL을 갱신해야 한다)

```
/sbiz/api/bizonSttus/DynPplCmpr/search.json?dongCd=11140520   <- 유동인구. 단 행정동 단위다
/gis/api/getTpbizLcd_cmpt                                      업종 대분류
/gis/api/getHierarchyTpbizCode_cmpt                            업종 계층
/gis/api/snsAnls/getSnsAnlsDetail                              SNS 분석
```

메인 번들에는 api 경로가 24개뿐이다. **반경 기반 분석 API는 지연 로딩되는 청크에 있다** —
`분석하기`를 실제로 눌러야 네트워크에 잡힌다. 거기까지가 다음 할 일이다.

반경 파라미터 이름 후보로 번들에 `radius`가 있다.

### 다음에 이어서 하는 법

```bash
# 데몬이 죽어 있으면 먼저 정리 (섹션 2 참고)
export AGENT_BROWSER_SESSION="s1" AGENT_BROWSER_IDLE_TIMEOUT_MS=0
# 한 번의 bash -c 안에서 여러 명령을 이어 붙여야 세션이 안 끊긴다
timeout 280 bash -c 'agent-browser open "https://bigdata.sbiz.or.kr/#/gis/locAnls" >/dev/null; sleep 14; agent-browser network requests --clear >/dev/null; ...'
```
**교훈: agent-browser 명령을 따로따로 부르면 세션이 날아간다.** 반드시 한 `bash -c`로 묶는다.

목표는 `분석하기`까지 눌러 네트워크에 잡히는 **반경 기반 API 한 줄**을 확보하는 것이다.
그것만 있으면 38곳 + 후보지를 스크립트로 한 번에 돌릴 수 있다 — UI 자동화를 반복할 필요가 없다.
