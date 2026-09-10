# 어느 데이터가 어디서 정본인가 (data source map)

마지막 갱신 2026-09-10.

> **이 문서를 만든 이유**: "시트 데이터는 이제 안 쓰고 웹에서 Firebase로 관리하는 것 아니냐"는
> 오해가 실제로 있었다. **절반만 맞다.** 기존 가맹점은 여전히 **시트가 정본**이고 매일 06:00 KST
> 크론이 시트를 읽어 Firestore로 넣는다. 웹이 정본인 건 **신규후보지 쪽**뿐이다.
> 이 구분을 모르고 시트를 지우면 시스템이 멈춘다.

## 한눈에

```
구글시트(전수조사)                      Firestore                     웹 화면
─────────────────                    ──────────                    ────────
매출DB              ──매일 06:00──▶  storeEvalExistingStores        기존 가맹점
01_점포기본정보       ──매일 06:00──▶  storeEvalExistingStoreSales    검증 화면
05_경쟁점정보(가맹점행) ─매일 06:00──▶  storeEvalCompetitors

                                     storeEvalCandidates       ◀──직접입력── 신규후보지
                                     storeEvalCompetitors(N)   ◀──직접입력── 후보지 경쟁점
                                     storeEvalLocationEvaluations ◀─직접입력── 입지동선평가
                                     storeEvalExistingStoreMembers ◀─직접입력── 회원 스냅샷
```

## 시트가 정본 (지우면 시스템이 멈춘다)

| 탭 | 읽는 코드 | 들어가는 곳 |
|---|---|---|
| **매출DB** | `cronSync.ts:404` `SOURCE_SHEET_NAME` | `storeEvalExistingStores`(자동등록·brandType), `storeEvalExistingStoreSales`(월별 PC/상품매출·가동률) |
| **01_점포기본정보** | `cronSync.ts:160`, `scripts/migrateFullExistingStoreProfiles.mjs:84` | `storeEvalExistingStores`의 자사 시설·요금·PC대수 |
| **05_경쟁점정보** | `cronSync.ts:255`, `migrateFullExistingStoreProfiles.mjs:182` | `storeEvalCompetitors` (가맹점코드 행만) |

동기화는 **upsert 전용**이다 — 시트에 없다고 Firestore 문서를 지우지 않는다. 그래서 웹에서만
만든 문서(후보지 경쟁점, kakao 자동수집)는 크론이 돌아도 안전하다.

## 웹(Firestore)이 정본 (시트에 있어도 그건 사본이거나 낡은 것)

| 데이터 | 컬렉션 | 비고 |
|---|---|---|
| 신규후보지 | `storeEvalCandidates` | 웹 `CandidateInput`에서 직접 입력 |
| 후보지 경쟁점 | `storeEvalCompetitors` (`candidateCode`가 `N…`) | 웹 입력 + kakao 자동수집 |
| 입지동선평가 | `storeEvalLocationEvaluations` | 09 탭 동기화는 2026-08-30에 제거됨 |
| 회원 스냅샷 | `storeEvalExistingStoreMembers` | 03 탭 동기화는 2026-08-31에 제거됨(`968180b`) |
| 모델 설정 | `storeEvalSettings/current` | 웹 설정 화면 |
| 평가 결과·감사로그 | `storeEvalResults`, `storeEvalAuditLog` 등 | 앱이 생성 |

## 사람만 쓰는 탭 (앱은 안 읽음, 그대로 둔다)

- **피카매출계산 / 멀티매출계산** — POS 집계를 손으로 옮겨 적어 매출DB에 붙여넣는 계산기 스크래치.

## 2026-09-10에 정리한 것

| 대상 | 조치 | 판단 근거 |
|---|---|---|
| 05_경쟁점정보의 N코드 행 30개 | **삭제** | 후보지 경쟁점은 웹이 정본. 시트는 8/31에서 멈춰 있었고(웹은 9/3 갱신) 앱이 안 읽는다 |
| **07_신규후보지** 탭 | **삭제** | 앱이 안 읽음. 시트엔 6곳인데 웹엔 9곳(N010~N012 없음)이라 낡은 상태였다 |
| **03_회원정보입력** 탭 | **삭제** | 앱이 안 읽음. 동기화는 8/31 제거, 예측력도 없음(최대 r=0.211) |
| 09_입지동선평가 탭 | (이전에 삭제됨) | 2026-08-30에 동기화 제거하며 탭도 정리 |

**⚠ 03_회원정보입력은 마지막 사본이었다.** Firestore `storeEvalExistingStoreMembers`가 8/31
"Firestore 다이어트" 때 비워졌고(0건) 동기화도 제거된 상태라, 41개 매장의 회원 수·연령대 자료는
그 탭에만 남아 있었다. 삭제 전 **수식 포함 전체 백업**을 떠뒀다:
`.local-tools/backup-formula-03_회원정보입력-<시각>.json`. 구글시트 버전 기록으로도 복구된다.
웹의 회원 입력 기능(`upsertExistingStoreMemberSnapshot`)은 살아 있으나 현재 데이터는 0건이다.

## 시트를 고칠 때 지킬 것

이 시트는 `bluelgs@isens.camp` 소유의 **팀 공유 기밀 문서**다. 서비스계정에 `canEdit` 권한이 있어
코드로 고칠 수 있지만, 그래서 더 조심해야 한다.

1. 사용자 승인을 먼저 받는다.
2. 바꾸기 전에 **수식까지 포함한 전체 백업**을 로컬 JSON으로 뜬다(`valueRenderOption: "FORMULA"`).
3. 대상 판별에 **하드 가드**를 건다(예: 보호 탭 목록에 있으면 즉시 중단, 가맹점코드 행이 섞이면 중단).
4. **미리보기를 기본 동작**으로 두고 `--confirm`이 있을 때만 실제로 바꾼다.
5. 지우기 전에 **다른 탭이 수식으로 참조하는지** 확인한다.
6. 바꾼 뒤 **크론을 한 번 돌려** 동기화가 여전히 도는지 확인한다.

스크립트: `.local-tools/deleteStaleSheetRows.mjs`(행), `.local-tools/deleteUnusedTabs.mjs`(탭),
`.local-tools/formulaRefCheck.mjs`(참조·백업).
