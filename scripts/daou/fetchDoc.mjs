// 다우오피스 Works 글(전략 점포 심사 등) 하나를 읽어 라벨별 값으로 저장한다(2026-10-15, 다우 심사글 → 후보지 등록 스킬용).
// 사용: node scripts/daou/fetchDoc.mjs <글 URL> <저장할 JSON 경로>
//
// 로그인은 session.mjs(2026-11-05 떼어 냄, postActivity.mjs와 공용) — 전용 크롬 프로필 + 접속 쿠키 재사용 + .env.local 자동 로그인.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDaou } from "./session.mjs";

const [url, outPath] = process.argv.slice(2);
if (!url || !outPath || !/^https:\/\/[a-z0-9.-]*daouoffice\.com\//.test(url)) {
  console.error("사용: node scripts/daou/fetchDoc.mjs <다우오피스 글 URL> <저장할 JSON 경로>");
  process.exit(1);
}

// 심사글 양식의 라벨(앞부분 일치). 값은 라벨 다음 줄부터 다음 라벨 전까지.
const LABELS = [
  "전략점포명", "지역분류", "지번 전체주소", "입점 층수", "점포 분류", "입점 예정 브랜드", "PC 선택 상품",
  "점포 개발자 AI 등급 평가", "점포 개발자 직접 점포 평가", "6개월 예상 매출", "권리금", "보증금", "임대료", "관리비", "렌트프리",
  "기타 임차비용", "교육환경보호구역", "엘리베이터", "화장실 현황", "직전 운영 업종", "현재 점포 상황", "철거비 관련 내용",
  "집합상가여부", "건축물대장상 면적", "예측 실평수", "예측 PC 대수", "예측 블랙라벨 PC 대수", "예측 벌툰", "예측 방 개수",
  "진행 예정인 PC 댓수", "반경 300M 이내 경쟁매장 개수", "경쟁점 평균 1시간 요금", "경쟁점 설명", "외부 사진", "내부 사진",
  "화장실 사진", "건축물대장", "현황도", "인허가 조사서", "[ 현장 체크 리스트 ]", "층고", "점포 전용 면적", "희망 PC 댓수",
  "활동기록",
];

function parseFields(text) {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const start = lines.findIndex((l) => l.trim() === "전략점포명");
  const fields = {};
  let cur = null;
  for (const line of lines.slice(start < 0 ? 0 : start)) {
    // 다우가 일부 라벨에 줄바꿈 없는 공백(U+00A0)을 쓴다 — "기타 임차비용"이 안 잡혀 렌트프리 값에 붙어 나왔다(2026-10-16).
    const t = line.replace(/ /g, " ").trim();
    const label = LABELS.find((l) => t === l || (t.startsWith(l) && t.length <= l.length + 40 && !t.includes(":")));
    if (label && !(label in fields)) {
      cur = label;
      fields[cur] = [];
      if (label === "활동기록") break;
      continue;
    }
    if (cur) fields[cur].push(line);
  }
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.join("\n").trim()]));
}

let session;
try {
  session = await openDaou(url, { readyText: "전략점포명" });
  const { page } = session;
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  const docNo = /문서번호:\s*(\S+)/.exec(text)?.[1] ?? null;
  const out = { url, docNo, fetchedAt: new Date().toISOString(), fields: parseFields(text), raw: text };
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  await session.saveCookies();
  console.log(`저장: ${outPath} (문서번호 ${docNo ?? "?"}, 라벨 ${Object.keys(out.fields).length}개)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await session?.ctx.close();
}
