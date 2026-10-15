// 다우오피스 Works 글(전략 점포 심사 등) 하나를 읽어 라벨별 값으로 저장한다(2026-10-15, 다우 심사글 → 후보지 등록 스킬용).
// 사용: node scripts/daou/fetchDoc.mjs <글 URL> <저장할 JSON 경로>
//
// 로그인: 이 PC의 크롬을 따로 쓰는 전용 프로필(.local-tools/daou-profile, git 밖)에 로그인 상태가 남는다.
// 풀려 있으면 .env.local의 DAOU_LOGIN_ID / DAOU_LOGIN_PASSWORD로 다시 로그인한다 — 값은 로그인 칸에만 넣고 출력하지 않는다.
// 두 값이 없으면 창을 띄워 사람이 로그인하게 기다린다(최대 3분).
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const [url, outPath] = process.argv.slice(2);
if (!url || !outPath || !/^https:\/\/[a-z0-9.-]*daouoffice\.com\//.test(url)) {
  console.error("사용: node scripts/daou/fetchDoc.mjs <다우오피스 글 URL> <저장할 JSON 경로>");
  process.exit(1);
}
const loginId = process.env.DAOU_LOGIN_ID;
const loginPw = process.env.DAOU_LOGIN_PASSWORD;
const canAutoLogin = Boolean(loginId && loginPw);

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
    const t = line.trim();
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

const profileDir = resolve(".local-tools/daou-profile");
mkdirSync(profileDir, { recursive: true });
const ctx = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: canAutoLogin });
const page = ctx.pages()[0] ?? (await ctx.newPage());
// 다우 로그인 쿠키는 세션 쿠키라 창을 닫으면 사라진다 → 매번 새로 로그인하면 "동시 접근 제한"(앞 접속이 남아 있음)에 걸린다(10-15).
// 그래서 접속 쿠키를 파일로 남겨 다음 실행에 다시 쓴다 — 접속 하나를 계속 이어 쓴다.
const cookieFile = resolve(profileDir, "session-cookies.json");
if (existsSync(cookieFile)) await ctx.addCookies(JSON.parse(readFileSync(cookieFile, "utf8"))).catch(() => {});
try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  if (page.url().includes("/login")) {
    if (canAutoLogin) {
      // 회사명(사이트) 칸이 다른 회사로 잡혀 있으면 아이디가 맞아도 "올바르지 않습니다"가 난다(10-15 첫 시험 — (주)나라이엔씨로 떠 있었다).
      const company = process.env.DAOU_COMPANY || "아이센스에프앤씨";
      const companyBox = page.locator(".wrap_login button").first();
      if ((await companyBox.innerText()).trim() !== company) {
        await companyBox.click();
        await page.getByRole("dialog").getByText(company, { exact: true }).first().click();
      }
      await page.locator('input.input_txt[type="text"]').first().fill(loginId);
      await page.locator('input[type="password"]').first().fill(loginPw);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
    } else {
      console.log("DAOU_LOGIN_ID / DAOU_LOGIN_PASSWORD가 없어 창에서 직접 로그인하기를 기다립니다(최대 3분)...");
    }
    if (canAutoLogin) {
      // 같은 아이디로 다른 곳(사람이 쓰는 크롬 등)에 접속돼 있으면 "동시 접근 제한" 창이 뜬다.
      // [기존 접속 종료]는 그쪽을 로그아웃시킨다 — 사용자 허락(10-15 "로그아웃시켜도 됨")으로 기본은 누른다. 막으려면 DAOU_KICK_EXISTING=0.
      const limit = page.getByText("동시 접근 제한", { exact: true });
      await Promise.race([limit.waitFor({ timeout: 8_000 }), page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 8_000 })]).catch(() => {});
      if (await limit.isVisible().catch(() => false)) {
        if (process.env.DAOU_KICK_EXISTING === "0") throw new Error("다우 '동시 접근 제한' — 같은 아이디가 다른 곳에 접속 중입니다(DAOU_KICK_EXISTING=0이라 기존 접속을 끊지 않음).");
        await page.getByRole("button", { name: "기존 접속 종료" }).click();
      }
    }
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: canAutoLogin ? 30_000 : 180_000 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  await page.getByText("전략점포명", { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  const docNo = /문서번호:\s*(\S+)/.exec(text)?.[1] ?? null;
  const out = { url, docNo, fetchedAt: new Date().toISOString(), fields: parseFields(text), raw: text };
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  writeFileSync(cookieFile, JSON.stringify(await ctx.cookies("https://cloud.daouoffice.com")));
  console.log(`저장: ${outPath} (문서번호 ${docNo ?? "?"}, 라벨 ${Object.keys(out.fields).length}개)`);
} catch (err) {
  if (page.url().includes("/login")) {
    console.error("로그인 실패 — .env.local의 DAOU_LOGIN_ID / DAOU_LOGIN_PASSWORD를 확인하세요(비밀번호 변경 등).");
    // 다우가 띄운 안내 문구(아이디 오류·자동입력 방지 문자 등)와 화면을 남긴다. 입력 칸 값은 innerText에 안 나온다.
    const msg = await page.evaluate(() => document.body.innerText).catch(() => "");
    const hint = msg.split("\n").map((l) => l.trim()).filter((l) => /올바르지|자동 입력|문자|잠금|초과/.test(l));
    if (hint.length) console.error("다우 안내: " + hint.join(" / "));
    await page.screenshot({ path: resolve(".local-tools/daou-login-failed.png") }).catch(() => {});
  }
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await ctx.close();
}
