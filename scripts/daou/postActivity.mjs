// 다우오피스 Works 심사 글에 점포평가 멘트를 "활동기록"으로 올린다(2026-11-05, 슬랙 [다우에 게시] 버튼용).
// 사용: node scripts/daou/postActivity.mjs <글 URL> <멘트 글 파일> <결과 JSON 경로> [--dry-run]
//   --dry-run: 로그인·중복 확인·편집 칸에 글 넣기까지 하고 [등록] 대신 [취소]를 누른다(실제로는 아무것도 안 올라감).
// 결과 JSON status: posted(올림·다시 읽어 확인) | already(내가 쓴 "점포평가"가 이미 있음 — 안 올림) | dry-run | unverified(등록은 눌렀는데 다시 읽어도 안 보임) | error
// 중복 막기: 올리기 직전에 활동기록 API를 읽어, 로그인 계정이 쓴 글 중 "점포평가"로 시작하는 게 있으면 올리지 않는다.
//   (사람이 손으로 먼저 올렸어도 걸린다. 버튼 두 번 누르기는 listener.mjs의 잠금·상태 파일이 한 번 더 막는다.)
import { readFileSync, writeFileSync } from "node:fs";
import { openDaou, DaouLoginError } from "./session.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [url, textPath, outPath] = args.filter((a) => a !== "--dry-run");
const m = /^https:\/\/cloud\.daouoffice\.com\/gw\/app\/works\/applet\/(\d+)\/doc\/(\d+)/.exec(url ?? "");
if (!m || !textPath || !outPath) {
  console.error("사용: node scripts/daou/postActivity.mjs <다우 심사 글 URL> <멘트 글 파일> <결과 JSON> [--dry-run]");
  process.exit(1);
}
const [, appletId, docId] = m;
const text = readFileSync(textPath, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
const done = (r) => { writeFileSync(outPath, JSON.stringify({ docId, at: new Date().toISOString(), ...r }, null, 1)); console.log(r.status + (r.reason ? " — " + r.reason : "")); };
if (!text.startsWith("점포평가")) { done({ status: "error", reason: "멘트가 '점포평가'로 시작하지 않음 — 잘못된 글로 보고 올리지 않음" }); process.exit(2); }

// 멘트(줄글) → 다우 에디터 HTML: 한 줄 = 한 문단, 빈 줄 = 빈 문단
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = text.split("\n").map((l) => (l.trim() ? `<p>${esc(l)}</p>` : "<p>&nbsp;</p>")).join("");

let session;
try {
  session = await openDaou(url, { readyText: "전략점포명" });
  const { page } = session;
  await page.waitForTimeout(1500);
  const readMine = () => page.evaluate(async ({ appletId, docId }) => {
    const me = (await (await fetch("/gw/api/user/session")).json()).data;
    const acts = (await (await fetch(`/gw/api/works/applets/${appletId}/docs/${docId}/activity`)).json()).data ?? [];
    const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h ?? ""; return d.innerText.replace(/ /g, " ").trim(); };
    const mine = acts.filter((a) => a.createdBy?.loginId === me.loginId).map((a) => ({ id: a.id, createdAt: a.createdAt, text: plain(a.content) }));
    return { me: { loginId: me.loginId, name: me.name }, total: acts.length, evals: mine.filter((a) => a.text.startsWith("점포평가")) };
  }, { appletId, docId });

  const before = await readMine();
  if (before.evals.length) {
    done({ status: "already", account: before.me.name, activityId: before.evals[0].id, postedAt: before.evals[0].createdAt });
  } else {
    await page.locator("a.btn_tool", { hasText: "활동기록 쓰기" }).click();
    await page.waitForFunction(() => window.DEXT5 && document.querySelector("#writeActivity")?.offsetWidth > 0, null, { timeout: 20_000 });
    await page.waitForTimeout(1500); // 에디터가 다 뜨기 전에 넣으면 사라진다
    const got = await page.evaluate((h) => { window.DEXT5.setBodyValue(h); return window.DEXT5.getBodyValue(); }, html);
    if (!got.includes(esc(text.split("\n")[0]).slice(0, 10))) throw new Error("편집 칸에 글이 안 들어감");
    if (dryRun) {
      await page.locator("a#closeEditor").click();
      done({ status: "dry-run", account: before.me.name, activitiesBefore: before.total });
    } else {
      await page.locator("a#writeActivity").click();
      let after = null;
      for (let i = 0; i < 10 && !(after?.evals.length); i++) { await page.waitForTimeout(1500); after = await readMine(); }
      if (after?.evals.length) done({ status: "posted", account: after.me.name, activityId: after.evals[0].id, postedAt: after.evals[0].createdAt });
      else done({ status: "unverified", reason: "등록을 눌렀지만 다시 읽어도 안 보임 — 다우 글을 직접 확인" });
    }
  }
  await session.saveCookies();
} catch (err) {
  const login = err instanceof DaouLoginError;
  done({ status: "error", login, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
  process.exitCode = 1;
} finally {
  await session?.ctx.close();
}
