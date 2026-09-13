# 계정 변경 후 배포 재개

## 입력 보호 개선 배포 (저녁)

- 커밋 `bc83a9a6df150082d97df6004dc861d38f4d732c`를 main에 푸시했다.
- GitHub Vercel 커밋 상태 `success` 확인.
- 배포 상세: https://vercel.com/is-ens/my-next-firebase-app/F92BqPfAofSzgaGuaw6UcFbKgaks
- 운영 후보지 목록 새로고침 후 9곳 표시 확인. 기본정보 미저장 변경 후 탭 이동 경고와 취소 후 입력 유지 확인. 테스트 입력을 원래 값으로 복원하고 저장 없이 목록으로 복귀했다.
- 수집된 운영 브라우저 오류 로그 없음. 서버 전체 오류 로그를 조회한 것은 아니다.
- 로컬 브라우저 확인 범위와 게임 바 캡처·새로고침 검증 한계는 `2026-09-13-input-browser-check.md`에 기록했다.

- 중단 위치: 화면 개선 커밋 `fb7870f` 생성 후 원격 푸시 전.
- 2026-09-13 재개 후 origin 최신 상태를 확인하고 main에 해당 커밋을 푸시했다.
- GitHub 커밋 상태의 Vercel 검사가 success로 완료됐다.
- 운영 주소: https://my-next-firebase-app-one.vercel.app/store-eval/candidates
- 회사 계정 로그인 후 새 배포를 새로고침해 상태별 필터, 정렬, 후보지 9곳 표시를 확인했다.
- 운영 화면에서 `군포 산본` 검색 시 산본점 1곳 표시, 초기화 후 전체 9곳 복원을 확인했다.
- 기존 검증 기록: 빌드·린트 통과, 일반 테스트 678건 통과. 이번에는 제품 코드를 변경하지 않았다.
- `npm run test:rules`를 재시도했으나 Java 미설치로 에뮬레이터 시작 전 종료됐다. 보안 규칙 테스트 22건은 이번 PC에서 미실행 상태다.
- 운영 데이터와 산식·가중치는 변경하지 않았다.
- 기존 미커밋 인계 문서·읽기 추정 스크립트는 그대로 보존했다.

배포 상세: https://vercel.com/is-ens/my-next-firebase-app/6zp7ctPhJ1cQCT6bLGQY2UEcZKDc

## Java 설치와 보안 규칙 검증 완료

- 사용자 요청에 따라 Eclipse Temurin JDK 21.0.12.101을 winget으로 설치했다. 설치 관리자 해시 확인 및 설치 성공.
- 설치 경로: `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`.
- 실행 프로세스에 JAVA_HOME 및 Java/Node PATH를 지정한 뒤 `npm.cmd run test:rules`를 실행했다.
- 로컬 `demo-rules-test` Firestore 에뮬레이터에서 보안 규칙 테스트 **22/22 통과**, 종료 코드 0.
- 기존 일반 테스트 678건과 합쳐 각 실행 기록 기준 700건 통과. 전체를 한 명령으로 재실행한 것은 아니다.
- 에뮬레이터는 테스트 완료 후 종료됐으며 운영 데이터·규칙 배포 변경은 없다.
