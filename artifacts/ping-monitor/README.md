# 경쟁점 가동률 — claude.ai 아티팩트 원본 (2026-11-15)

- `ping-monitor.html`: 아티팩트 페이지 원본. 「PC 점포평가」 커넥터의 측정기 도구(`src/lib/server/mcpPingMonitorTools.ts`)를 부른다.
- 게시: Artifact 도구로 이 파일을 publish. capabilities =
  `{"mcp":{"servers":[{"server":"PC 점포평가","tools":["ping_overview","ping_store","ping_area","ping_form_options","ping_nearby","ping_store_private","ping_save_store","ping_probe","ping_delete_store","ping_own_register","ping_transfer_own"]}]},"sample":{},"downloads":true}`
- 게시하려면 게시하는 Claude 세션의 커넥터 도구 목록에 ping_* 도구가 보여야 한다(claude.ai에서 커넥터를 다시 연결한 뒤 새 세션).
- 결과 공유(커넥터 없는 팀원 열람)에 넣을 읽기 도구는 ping_overview·ping_store·ping_area뿐(IP 없음). 나머지는 본인 커넥터 전용.
- 디자인: 토큰·ⓘ 툴팁·AI 패널 골격은 매뉴얼 대장 원문 복사. 설계서 요지는 이 폴더 밖 대화 기록(2026-11-15) 참고.
- AI에게 묻기: sample modelTier 'default', 모델 이름 표시 안 함(사용자 11-15), 답마다 「AI가 본 자료」 표 + 숫자 대조(±1%p).
