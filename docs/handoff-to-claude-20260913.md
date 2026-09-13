# Claude 작업 인계 — 2026-09-13 저녁

## 가장 먼저

- 실제 작업 폴더는 `C:\Users\09960\store-eval-work`다. `Projects` 아래 유사한 복사본에서 작업하지 말 것.
- `CLAUDE.md`, `AGENTS.md`, `docs/handoff-to-codex-20260913.md`를 읽는다. 마지막 문서의 과거 '남은 일'보다 이 문서의 최신 상태가 우선한다.
- 사용자는 토큰 부족으로 Claude에 작업을 이관했다. 새 기능 개발 요청이 아니라, 아래 남은 실제 브라우저 확인과 마무리를 이어서 수행하는 요청이다.

## 완료·배포된 것

- 브랜치 main, HEAD `bc83a9a6df150082d97df6004dc861d38f4d732c`.
- 커밋 제목: 입력 저장 충돌 방지와 미저장 이동 경고 개선.
- GitHub `jsj-90-code/my-next-firebase-app` main으로 푸시 완료. Vercel 커밋 상태 success 확인.
- 운영: https://my-next-firebase-app-one.vercel.app/store-eval/candidates
- 배포 상세: https://vercel.com/is-ens/my-next-firebase-app/F92BqPfAofSzgaGuaw6UcFbKgaks
- 기본정보·경쟁점·입지평가의 입력 검증, 중복 저장 차단, 미저장 이탈 경고, 모바일 입력 배치 개선.
- 입력 본문과 감사이력을 동일 Firestore 트랜잭션으로 저장. 독립 필드 변경 병합, 같은 필드 충돌 안내, 삭제 문서 재생성 및 중복 신규 저장 방지.
- 좌표·담당자 판단은 해당 필드만 갱신한다. 산식·가중치는 변경하지 않았다.
- Navigation API를 지원하는 브라우저에서 취소 가능한 same-document 뒤로가기/앞으로가기를 보호한다. 모든 코드 이동이나 모든 브라우저를 보호한다고 주장하면 안 된다.

## 검증 결과 — 이미 한 것을 불필요하게 반복하지 말 것

- `npx.cmd vitest run --exclude "**/_*.test.ts"`: 48개 파일, 694개 통과. 에뮬레이터 전용 31개 별도 실행.
- `npm.cmd run test:rules`: demo Firestore 에뮬레이터에서 보안 규칙 22개와 입력 저장 통합 9개, 총 31개 통과.
- `npm.cmd run build`: TypeScript 및 26개 페이지 생성 통과. `npm.cmd run lint` 통과.
- 커밋 전 staged diff 검사에서 EOF 빈 줄 하나를 제거했으며 제품 동작 변경은 없었다.
- 로컬 프로덕션 빌드에서 기본정보·경쟁점·입지평가 경고 표시, 취소 후 입력 유지, 폐기 후 탭/목록 이동 확인.
- 실제 브라우저 뒤로가기 경고·취소·폐기 후 뒤로가기 확인.
- 390px에서 기본정보·경쟁점 입력/선택/버튼 가로 넘침 0. 320px에서 입지평가 입력 요소 가로 넘침 0, 목록 문서 가로 넘침 없음.
- 운영 배포 후 목록 9곳, 기본정보 수정 후 탭 이동 경고, 취소 시 입력 유지, 원래 값 복원 후 목록 복귀 확인.
- 테스트 편집은 저장하지 않고 폐기/원복했다. 운영 데이터 저장 테스트는 하지 않았다.
- 수집된 브라우저 오류 로그는 없었다. 서버 전체 오류 로그를 검사한 것은 아니다.

## 정확히 남은 일

1. **일반 Edge/Chrome에서 새로고침 기본 경고 확인.** 저장하지 않은 값을 입력하고 실제 새로고침을 수행한다. 경고가 표시되는지, 취소하면 입력이 유지되는지 확인한다. 확인용 편집은 저장하지 않는다.
2. **모바일 화면을 이미지로 확인.** 기본정보·경쟁점 편집·입지평가의 글자 겹침, 버튼 잘림, 긴 표의 스크롤을 확인한다. 앞선 DOM 너비 측정을 시각적 검증 완료로 간주하지 않는다.
3. 문제 발견 시 수정하고 관련 테스트/빌드 후 배포한다. 문제가 없다면 문서에 결과만 남기고 마무리한다. 무관한 개선을 늘리지 않는다.

## 브라우저 제약과 현재 중단 이유

- Codex에 연결된 것은 Edge Game Bar standalone sidebar 탭 하나뿐이었다.
- 새 탭 생성은 restricted 오류, 화면 캡처는 두 번 모두 timeout. 기존 탭의 DOM/접근성 및 UI 입력은 작동했다.
- 자동화 reload 호출에서는 beforeunload 대화상자를 관찰하지 못했고 Ctrl+R은 새로고침을 일으키지 않았다. 코드 결함인지 단정할 근거가 없으므로 미검증으로 기록했다.
- 사용자에게 일반 Edge 창에서 운영 앱을 열고 브라우저 확장으로 연결해달라고 안내했으나, 연결 확인 전에 Claude 이관 요청이 왔다.
- Claude 환경에서는 사용 가능한 정상 브라우저 자동화 수단을 먼저 확인한다. 인증 우회/브라우저 보안 약화는 하지 않는다. 로그인은 필요하면 사용자에게 맡긴다.
- 임시 뷰포트는 복원했고, 로컬 `next start`(3100)는 종료했다. 운영 후보지 목록 탭은 열어두었다.
- 로컬 서버 필요 시 현재 빌드로 `npm.cmd run start -- --hostname 127.0.0.1 --port 3100` 실행 후 `http://localhost:3100/store-eval/candidates` 사용.
- Firebase 실시간 연결 때문에 `networkidle`을 기다리지 말고 DOM/화면 요소를 기다린다. 이 브라우저에서 클릭 직후 스냅샷은 잠시 이전 화면을 반환했으므로 실제 전환을 확인한 후 판단한다.

## 로컬 미커밋 자료 — 삭제/덮어쓰기 금지

인계 직전 상태:

- 수정: `docs/handoff-to-codex-20260913.md`
- 미추적: `docs/releases/2026-09-13-deployment-resume.md`
- 미추적: `docs/releases/2026-09-13-home-accuracy-recheck.md`
- 미추적: `docs/releases/2026-09-13-unattended-resume.md`
- 미추적: `scripts/estimateCronReads.mjs`
- 이 인계 문서도 로컬 신규 파일이다. 위 자료는 과거 작업 기록/도구이며 이번 입력 개선 커밋에 섞지 않았다.
- 상세 증거: `docs/releases/2026-09-13-input-browser-check.md`, `docs/releases/2026-09-13-input-save-resume.md` (커밋됨), deployment-resume 문서의 저녁 배포 단락(로컬).

## 환경 참고

- JDK 21 설치됨. 재부팅 후 rules 테스트 정상 실행 확인. `scripts/lib/jdk.mjs`가 설치 경로와 Windows Path 대소문자 문제를 처리한다.
- Git safe.directory 오류가 있으면 저장소 경로를 명령 단위로 지정한다.
- Git 작성자 설정이 없어서 마지막 커밋은 이전 Codex 커밋과 같은 `-c user.name=Codex -c user.email=codex@openai.com`을 명령에만 지정했다. 전역 설정 변경은 하지 않았다. Claude가 작성할 때 Codex를 무조건 재사용하지 말 것.
- 사용자에게 이미 커밋·푸시·배포까지 요청받아 수행했다. 작업 범위 내 수정 배포는 CLAUDE.md의 기존 승인 방침을 따른다.
- 추가 장기 후보인 키보드 접근성은 이번 필수 잔여 작업이 아니다. 산식·가중치 변경은 표본 증가 전까지 보류한다.
