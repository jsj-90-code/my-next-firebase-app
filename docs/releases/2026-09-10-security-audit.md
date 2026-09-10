# 보안 감사 — 누구나 가입해서 전체 매출자료를 볼 수 있던 구멍 차단

2026-09-10. 집 PC에서 회사 작업분(`aa2fb1b`→`e4edd81`, 52커밋) 동기화 후 진행. 공식 Firebase
`firebase-security-rules-auditor` 스킬의 레드팀 체크리스트를 `firestore.rules`에 적용했다.

## 심각(Critical) — 실제로 악용 가능했던 경로

`isCompanyAccount()`가 이메일 **문자열**만 검사하고 `email_verified`는 보지 않았다.

```
request.auth.token.email.matches('.*@isens[.]camp$')   // 이것만 있었음
```

이 검사만으로는 다음이 그대로 통과한다.

1. 배포된 홈페이지에 **공개 회원가입 폼**이 떠 있었다(`AuthForm.tsx`의 "계정이 없나요? 회원가입").
2. 거기서 `아무거나@isens.camp` + 임의의 6자 비밀번호로 가입하면 계정이 즉시 만들어진다.
   메일함을 소유하는지는 아무도 확인하지 않는다.
3. 그 계정의 토큰은 위 정규식을 통과한다 → **41개 가맹점 전체 매출·경쟁점·모델설정을
   읽고 쓰고 지울 수 있다.**

폼을 지나도 경로가 남는다. `NEXT_PUBLIC_FIREBASE_API_KEY`는 설계상 브라우저 번들에 공개되므로
Auth REST API로 직접 가입할 수 있다. 실제로 확인했다 — `accounts:signUp`이 `OPERATION_NOT_ALLOWED`가
아니라 `INVALID_EMAIL`을 반환한다(= 이메일/비밀번호 가입이 켜져 있다는 뜻). 계정을 실제로 만들지는
않았고, 잘못된 이메일 형식으로 오류코드만 확인했다.

서버 API 라우트 6개는 `companyAuth.ts`가 `email_verified === true`를 검사하고 있어 안전했다.
문제는 **클라이언트 SDK가 API 라우트를 거치지 않고 Firestore와 직접 통신**한다는 점 — 그 경로에서는
`firestore.rules`가 유일한 방어선인데 거기에 검사가 빠져 있었다.

### 조치

- `firestore.rules`의 `isCompanyAccount()`에 `request.auth.token.email_verified == true` 추가.
  메일함을 실제로 소유하지 않으면 이 값이 참이 될 수 없으므로 위 경로가 닫힌다.
- `AuthForm.tsx`에서 회원가입 UI 제거, `AuthContext.tsx`에서 `signUpWithEmail` 제거.
  구글 로그인을 기본 버튼으로 올리고 `hostedDomain: isens.camp`를 지정했다.

### 잠금 위험 사전 확인(중요)

규칙을 조이기 전에 Admin SDK로 계정 전수를 읽어 확인했다 — **잠기는 사람 0명**.

| 구분 | 개수 | 내용 |
|---|---:|---|
| @isens.camp 실사용 | 4 | 전부 `google.com` 로그인, 전부 `email_verified=true` |
| 외부 도메인 | 13 | 2026년 7월 QA 테스트 잔여물(익명 10 + `*@example.com` 3). 현재도 데이터 접근 불가 |

구글 워크스페이스 로그인은 `email_verified`가 항상 참이라 팀원 로그인에는 영향이 없다.

## 중간 — 매출DB를 클라이언트에서 통째로 지울 수 있었다

`storeEvalExistingStoreSales`가 `allow read, write`라 로그인한 계정이면 누구나 전 월별매출 문서를
삭제할 수 있었다. CLAUDE.md의 "매출DB 절대 삭제 금지"가 규칙 단에서는 강제되지 않고 있었다.

- `allow read, create, update` + `allow delete: if false`로 변경.
- 부작용 없음: 클라이언트 코드에 이 컬렉션을 지우는 경로가 애초에 없고(`store.ts`의 deleteDoc은
  candidates/competitors/demandPoints/existingStores만 대상), 동기화(`cronSync`)는 firebase-admin이라
  보안규칙을 우회한다.

## 확인했으나 문제 아님

- **도메인 정규식**: `.*@isens[.]camp$`는 끝이 앵커돼 있어 `x@isens.camp.evil.com` 같은 우회가 안 된다.
- **관리자 권한 상승**: `storeEvalAdmins`가 `allow write: if false`라 스스로 관리자가 될 수 없다. 정상.
- **불변 로그**: 감사/복원/설정이력 컬렉션이 `update, delete: if false`로 잘 잠겨 있다.
- **`storeEvalSystemStatus`**: 규칙에 없지만 `cron-sync`가 admin SDK로만 쓴다 — 규칙 불필요.
- **타입·크기 검증 없음**: 내부 전용 도구라 위험도 낮음. 지금 손대지 않았다.

## 남은 일 (사람이 해야 함)

1. **규칙 배포** — 코드에만 반영돼 있고 아직 적용 전이다. 배포해야 실제로 막힌다.
   ```
   npx firebase-tools deploy --only firestore:rules
   ```
2. **Firebase 콘솔에서 이메일/비밀번호 공급자 사용중지** 검토. 실사용 계정 4개가 전부 구글이라
   끄더라도 잃는 게 없고, 끄면 방어선이 하나 더 생긴다.
3. **QA 잔여 계정 13개 정리** — 지금도 데이터 접근은 불가하지만 남겨둘 이유가 없다.

## 재현

`npm run build` 통과, `npx vitest run` 469개 통과. 조사 스크립트는 저장소 밖
`.local-tools/authUsersProbe.mjs`(읽기 전용, `.gitignore` 처리)에 있다.
