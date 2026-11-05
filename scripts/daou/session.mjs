// 다우오피스 로그인·접속 재사용 공용 모듈(2026-11-05, fetchDoc.mjs에서 떼어 냄 — postActivity.mjs도 같이 쓴다).
// 이 PC의 크롬을 따로 쓰는 전용 프로필(.local-tools/daou-profile, git 밖)과 접속 쿠키 파일을 쓴다.
// 풀려 있으면 .env.local의 DAOU_LOGIN_ID / DAOU_LOGIN_PASSWORD로 다시 로그인한다 — 값은 로그인 칸에만 넣고 출력하지 않는다.
// 두 값이 없으면 창을 띄워 사람이 로그인하게 기다린다(최대 3분).
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export class DaouLoginError extends Error {}

export async function openDaou(url, { readyText } = {}) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const loginId = process.env.DAOU_LOGIN_ID;
  const loginPw = process.env.DAOU_LOGIN_PASSWORD;
  const canAutoLogin = Boolean(loginId && loginPw);
  const profileDir = resolve(".local-tools/daou-profile");
  mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: canAutoLogin });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // 다우 로그인 쿠키는 세션 쿠키라 창을 닫으면 사라진다 → 매번 새로 로그인하면 "동시 접근 제한"(앞 접속이 남아 있음)에 걸린다(10-15).
  // 그래서 접속 쿠키를 파일로 남겨 다음 실행에 다시 쓴다 — 접속 하나를 계속 이어 쓴다.
  const cookieFile = resolve(profileDir, "session-cookies.json");
  if (existsSync(cookieFile)) await ctx.addCookies(JSON.parse(readFileSync(cookieFile, "utf8"))).catch(() => {});
  const saveCookies = async () => writeFileSync(cookieFile, JSON.stringify(await ctx.cookies("https://cloud.daouoffice.com")));
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
        // 같은 아이디로 다른 곳(사람이 쓰는 크롬 등)에 접속돼 있으면 "동시 접근 제한" 창이 뜬다.
        // [기존 접속 종료]는 그쪽을 로그아웃시킨다 — 사용자 허락(10-15 "로그아웃시켜도 됨")으로 기본은 누른다. 막으려면 DAOU_KICK_EXISTING=0.
        const limit = page.getByText("동시 접근 제한", { exact: true });
        await Promise.race([limit.waitFor({ timeout: 8_000 }), page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 8_000 })]).catch(() => {});
        if (await limit.isVisible().catch(() => false)) {
          if (process.env.DAOU_KICK_EXISTING === "0") throw new DaouLoginError("다우 '동시 접근 제한' — 같은 아이디가 다른 곳에 접속 중입니다(DAOU_KICK_EXISTING=0이라 기존 접속을 끊지 않음).");
          await page.getByRole("button", { name: "기존 접속 종료" }).click();
        }
      } else {
        console.log("DAOU_LOGIN_ID / DAOU_LOGIN_PASSWORD가 없어 창에서 직접 로그인하기를 기다립니다(최대 3분)...");
      }
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: canAutoLogin ? 30_000 : 180_000 });
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    if (readyText) await page.getByText(readyText, { exact: true }).first().waitFor({ timeout: 30_000 });
    await saveCookies();
    return { ctx, page, saveCookies };
  } catch (err) {
    if (page.url().includes("/login")) {
      // 다우가 띄운 안내 문구(아이디 오류·자동입력 방지 문자 등)와 화면을 남긴다. 입력 칸 값은 innerText에 안 나온다.
      const msg = await page.evaluate(() => document.body.innerText).catch(() => "");
      const hint = msg.split("\n").map((l) => l.trim()).filter((l) => /올바르지|자동 입력|문자|잠금|초과/.test(l));
      await page.screenshot({ path: resolve(".local-tools/daou-login-failed.png") }).catch(() => {});
      await ctx.close().catch(() => {});
      throw new DaouLoginError("다우 로그인 실패 — .env.local의 DAOU_LOGIN_ID / DAOU_LOGIN_PASSWORD를 확인하세요(비밀번호 변경 등)." + (hint.length ? " 다우 안내: " + hint.join(" / ") : ""));
    }
    await ctx.close().catch(() => {});
    throw err;
  }
}
