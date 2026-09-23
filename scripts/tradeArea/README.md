# 항아리상권(막힌 상권) AI 판정 하네스 (2026-09-23)

1km 밖 고리 수요(`residentRingDecayM`)는 "1~2km 사람도 온다"를 전제한다. 그런데 하천·철도·고속도로·산으로
막힌 동네(사용자: *"구미산동은 항아리상권으로 알고 있어서 외부 유입 기대하기 어렵고"*)는 그 사람이 안 온다.
사람이 54곳을 하나씩 판정하는 대신, 지도 한 장을 AI에게 보여 **예/아니오 사실만** 묻는다(로드뷰 판정과 같은 원칙).

## ⚠️ 점수를 매기지 않는다 · AI 판정도 검증 대상이다

- 문항은 전부 "예 = 막힘". 방향(동·서·남·북)마다 고리(1~2km) 구간에 단절 요소가 있는가.
- 산식은 **막힌 방향 수 ÷ 4**를 고리 인구에서 깎는다. 사실 개수라 맞춘 계수가 없다.
- 사람이 표본을 직접 보고 대조한다. 구미산동은 "막힘"이 나와야 한다.

## 쓰는 법

```bash
# 0) playwright-core는 저장소에 안 넣는다 — 스크래치패드에 깐다
npm i --prefix <스크래치패드> playwright-core

# 1) 지도 캡처 — 54곳, 매장 중심 1km(빨강)·2km(파랑 점선) 원. 키는 .env.local에서 스크립트가 읽는다
node scripts/tradeArea/shotMaps.mjs <스크래치패드> [--level=7]
#    -> .local-tools/trade-area-maps/<kind>-<code>.png

# 2) 판정 — Gemini(GEMINI_API_KEY, 무료 키), 사이트당 1회
node scripts/tradeArea/judge.mjs [--only=existing] [--limit=8]
#    -> .local-tools/trade-area-judgments.json

# 3) (사람 대조 뒤) Firestore 실험실 컬렉션에 쓴다 — writeTradeAreaJudgmentsToFirestore.mjs (미리보기 기본)
```

## 함정
- 카카오 지도 확대 단계(level)는 숫자가 클수록 넓게 본다. 7에서 1000px에 2km 원이 들어가는지 첫 장을 눈으로 확인.
- 캡처 좌표는 SGIS 고리 인구를 잰 좌표(`sgis-resident-population.json`)와 같아야 한다.
- 무료 키는 분당 요청 제한이 있다. 호출 사이 1.5초 쉰다.
