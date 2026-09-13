// 운영 데이터 품질 회귀 테스트 (2026-09-13 신설).
//
// 이 프로젝트에서 조용한 오입력이 예측을 망친 전례가 여러 번 있다 — 커플존을 조 단위로 넣어
// 12건이 틀려 있던 건(2026-09-11), 카카오 좌표가 0·0으로 저장되던 건, 시트 날짜가 하루 밀리던 건.
// 전부 사람이 우연히 발견했다. 스냅샷이 있을 때는 기계가 먼저 훑게 한다.
//
// **심각도 "높음"만 실패시킨다.** 애매한 것(커플존 홀수 등)은 세어서 로그로만 남긴다 — 판단이
// 필요한 항목으로 테스트를 빨갛게 만들면 아무도 안 보게 된다.
//
// 조사용 전체 리포트는 `.local-tools/audit-competitors.mjs`가 따로 낸다(더 많은 범주를 본다).

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { normalizePercentLike } from "./calc";
import type { CandidateInput, Competitor } from "./types";

const d = hasValidationSnapshot() ? describe : describe.skip;

d("운영 데이터 품질", () => {
  const snap = loadValidationSnapshot() as { candidates: CandidateInput[]; competitors: Competitor[] };
  const investigated = (snap.competitors ?? []).filter((c) => c.investigationStatus !== "경쟁점없음");

  it("경쟁점 대수가 음수이거나 적용>전체인 건이 없다", () => {
    const bad = investigated.filter(
      (c) =>
        (c.totalPcCount != null && c.totalPcCount < 0) ||
        (c.appliedPcCount != null && c.appliedPcCount < 0) ||
        (c.totalPcCount != null && c.appliedPcCount != null && c.appliedPcCount > c.totalPcCount),
    );
    expect(bad.map((c) => `${c.candidateCode}/${c.name}`)).toEqual([]);
  });

  it("가동률이 정규화 후에도 100%를 넘는 건이 없다", () => {
    // % 표기("30")와 비율 표기("0.3")가 둘 다 정상이다. 정규화한 뒤에도 1을 넘으면 진짜 오입력이다.
    const bad = investigated.filter(
      (c) => c.pingbotUtilization != null && (c.pingbotUtilization < 0 || normalizePercentLike(c.pingbotUtilization) > 1),
    );
    expect(bad.map((c) => `${c.candidateCode}/${c.name} ${c.pingbotUtilization}`)).toEqual([]);
  });

  it("경쟁점 거리가 음수인 건이 없다", () => {
    const bad = investigated.filter((c) => c.distanceM != null && c.distanceM < 0);
    expect(bad.map((c) => `${c.candidateCode}/${c.name}`)).toEqual([]);
  });

  it("좌석수가 음수인 건이 없다", () => {
    const fields = ["singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone", "friendsZone"] as const;
    const bad: string[] = [];
    for (const c of investigated) {
      for (const f of fields) {
        const v = c[f] as number | null | undefined;
        if (v != null && v < 0) bad.push(`${c.candidateCode}/${c.name} ${f}=${v}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("후보지 좌표가 0·0이거나 한국 밖인 건이 없다", () => {
    // 2026-09-11에 "카카오 좌표 누락이 위도 0, 경도 0으로 저장되던" 버그를 고쳤다. 재발 감시.
    const bad = (snap.candidates ?? []).filter((c) => {
      if (c.lat == null || c.lng == null) return false; // 미수집은 별도 신호(reviewSignals)가 잡는다
      return c.lat === 0 || c.lng === 0 || c.lat < 33 || c.lat > 39 || c.lng < 124 || c.lng > 132;
    });
    expect(bad.map((c) => `${c.code} (${c.lat}, ${c.lng})`)).toEqual([]);
  });

  // ⚠️ 커플존 홀수는 검사하지 않는다 — 저장 단위가 '조'라 홀수(9조 = 18석)가 정상이다.
  // 폼만 '석'으로 받고 저장 ÷2 / 표시 ×2로 환산한다(2026-09-11 커밋 9888aad). 2026-09-13에
  // "홀수면 조/석 혼동"이라는 잘못된 전제로 14건을 문제로 올렸다가 취소했다.

  it("판단이 필요한 항목은 세어서 남긴다 (실패시키지 않는다)", () => {
    const noCoords = (snap.candidates ?? []).filter((c) => c.lat == null || c.lng == null);
    const noMeasured = investigated.filter((c) => c.pingbotUtilization == null);
    console.log(
      [
        `후보지 좌표 미수집 ${noCoords.length}곳`,
        `경쟁점 실측 가동률 없음 ${noMeasured.length}/${investigated.length}건`,
      ].join(" · "),
    );
    expect(investigated.length).toBeGreaterThan(0);
  });
});
