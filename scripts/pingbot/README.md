# 핑봇 페이지 긁어 경쟁점 가동률 갱신 (2026-09-25)

핑봇(`http://ping.isens.camp/store?showall=1`)은 회사 로그인이 필요하고 기간 선택이 없다(최신 7일 고정, 자정에 창이 하루 민다).
사람이 로그인한 크롬에 CDP로 붙어 전체 표(약 7,700행)를 긁고, 우리 경쟁점 문서와 매칭해 `writePingbotUpdates.mjs --file`로 쓴다.

```
# 1) 디버깅 포트 크롬을 띄우고 사용자가 그 창에서 핑봇 로그인
"/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 --user-data-dir=<임시프로필> --no-first-run --no-default-browser-check "http://ping.isens.camp/store?showall=1" &
# 2) 긁기 → .local-tools/pingbot-all.json
node scripts/pingbot/scrape.mjs
# 3) 매칭 표(사람이 본다) → .local-tools/pingbot-match.json
node scripts/pingbot/match.mjs
# 4) 반영 목록 만들기(확정 + OVERRIDE, HOLD 제외) → .local-tools/pingbot-updates.json
node scripts/pingbot/buildUpdates.mjs
# 5) 쓰기(미리보기 → --apply) → 실험실 동기화 → 스냅샷
node scripts/writePingbotUpdates.mjs --period=YYYY-MM-DD~YYYY-MM-DD --file=.local-tools/pingbot-updates.json [--apply]
node scripts/syncLabCollections.mjs --apply --only=competitors && node scripts/dumpValidationSnapshot.mjs
```

- 기간은 페이지 상단 표(예: `9/18 ~ 9/24`)를 보고 사람이 `--period`에 연도 붙여 적는다(scrape 결과 `period`에 들어 있다).
- 매칭 규칙: 이름 정규화(pc방·피씨·카페 등 제거) 포함관계 + **우리 매장 주소의 시·군·구**(경쟁점 주소는 도로명이라 지번과 안 맞는다) + 대수(±10%).
  `buildUpdates.mjs`의 OVERRIDE/HOLD는 사람이 본 판단 — 새로 돌릴 때 다시 본다. 0%(핑제로)·폐업·휴업은 안 싣는다.
- CDP 드라이버는 `cdp127.mjs`(127.0.0.1). `.local-tools/cdp.mjs`는 `[::1]`을 봐서 크롬이 IPv4로만 열리면 못 붙는다.
