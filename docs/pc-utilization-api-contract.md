# PC 이용량 API 수신 계약과 재학습 기준

## 목적

PC 매출을 요금으로 나눈 현재 추정 이용시간을, 관리프로그램에서 제공할 월별 실측 이용량으로 대체한다. 상품 매출은 주문 상세가 제공되기 전까지 현재의 보수적 별도 모형을 유지한다.

## 월별 점포 단위 필수 필드

각 레코드는 `storeCode`와 `yearMonth`(YYYY-MM)로 식별한다.

| 필드 | 형식 | 의미 |
|---|---|---|
| `effectiveHourlyRate` | 양수 원 단위 수 | 해당 월 PC 매출에 실제 적용된 시간당 평균 실효요금 |
| `paidPcHours` | 0 이상 시간 수 | 매출에 반영된 유료 PC 이용시간. 정액제·할인·무료시간의 포함 기준을 명시한다. |
| `operatingPcCount` | 양의 정수 | 해당 월 실제 운영 PC 대수. 설치 대수와 다르면 이 값을 우선한다. |
| `openHours` | 0 이상 시간 수 | 해당 월 실제 영업시간 합계. 휴점·단축영업을 반영한다. |
| `pcRevenue` | 0 이상 원 단위 수 | 기존 월별 PC 매출과 대조하는 금액 |
| `sourceUpdatedAt` | ISO 시각 또는 epoch | 원천 데이터 갱신 시각 |

선택 필드: `freePcHours`, `discountPcHours`, `flatRatePcHours`, `uniqueUsers`, `sessionCount`, `averageSessionMinutes`, `refundAmount`, `closedHours`.

상품 데이터가 추후 제공되면 `productOrderCount`, `productRevenue`, `averageOrderValue`, `discountedProductRevenue`, `deliveryRevenue`를 별도 계약으로 추가한다. 주문 단위의 개인식별정보는 수집하지 않는다.

## 수신 검증

- `paidPcHours <= operatingPcCount * openHours`를 원칙으로 하며, 초과 시 삭제하지 않고 원천 정의·단위 오류로 격리한다.
- `pcRevenue / paidPcHours`와 `effectiveHourlyRate`의 차이는 허용 오차를 두고 기록한다. 차이가 크면 할인·정액제의 포함 기준이 같은지 확인한다.
- 기존 `utilizationRate`는 출처와 분모가 문서화되기 전까지 학습 목표값으로 사용하지 않는다.
- 동일한 `storeCode/yearMonth`의 재수신은 최신 `sourceUpdatedAt`만 반영하며 원천 식별자와 수신 시각을 보존한다.

## 모형 및 채택 절차

1. 목표값은 `paidPcHours / (operatingPcCount * openHours)`로 정의한다.
2. 후보지에서 사전에 알 수 있는 입력만 사용해 0~가동률 상한의 범위를 보장하는 가동률 모형을 학습한다.
3. 최종 PC 매출은 `예측 가동률 × 후보지 운영 PC대수 × 예상 영업시간 × 후보지 요금`으로 계산한다.
4. 매장 전체를 통째로 제외하는 leave-one-store-out 및 반복 그룹 교차검증을 사용한다. 같은 매장의 월별 자료를 학습·평가 양쪽에 섞지 않는다.
5. 현행 PC MAPE 13.64%와 ±10% 적중률을 동시에 개선하고, 총매출·상품 오차를 악화시키지 않을 때만 운영 모형을 교체한다.

## 현재 자료 진단 (2026-09-09)

현재 월별 `utilizationRate`를 그대로 목표값으로 한 대안은 38개 매장 제외 검증에서 PC MAPE 14.04%, ±10% 15/38로 현행보다 나빴다. PC 매출·현재 등록 요금·PC대수로 역산한 값과 저장된 가동률의 월별 상관은 0.80이지만 평균 절대 차이는 3.8%p였다. 따라서 필드 정의를 확인하지 않은 상태에서 이 값을 운영 예측에 사용하지 않는다.
