// 견적서 반영 스크립트용 구글 로그인 — PC마다 처음 한 번 (2026-10-23)
//   node scripts/quote/login.mjs
// 브라우저가 열리면 본인 구글 계정으로 로그인·허용 → 로그인 정보가 ~/.isens-quote/token.json에 저장된다(git에 안 올라감).
// 그 뒤 sync.mjs·verify.mjs는 이 계정으로 시트를 고쳐서, 수정 기록에 본인 이름이 남는다.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exec } from "node:child_process";
import { oauthClient, SCOPES, TOKEN_FILE } from "./lib.mjs";

const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const client = oauthClient(redirect);
  if (!client) { console.error(".env.local에 QUOTE_OAUTH_CLIENT_ID · QUOTE_OAUTH_CLIENT_SECRET가 필요하다."); process.exit(1); }
  const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
  console.log("브라우저에서 로그인하세요(안 열리면 아래 주소를 크롬에 붙여넣기):\n" + url);
  exec(process.platform === "win32" ? `start "" "${url}"` : `open "${url}"`);

  server.on("request", async (req, res) => {
    const code = new URL(req.url, redirect).searchParams.get("code");
    if (!code) { res.end(); return; }
    try {
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) throw new Error("refresh_token을 못 받음 — 다시 실행할 것");
      const info = await client.getTokenInfo(tokens.access_token);
      mkdirSync(dirname(TOKEN_FILE), { recursive: true });
      writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: tokens.refresh_token, email: info.email, saved: new Date().toISOString() }, null, 2));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("로그인 완료 — 이 창은 닫아도 됩니다.");
      console.log(`로그인 완료: ${info.email} → ${TOKEN_FILE}`);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("실패: " + e.message);
      console.error("실패:", e.message); process.exitCode = 1;
    } finally { server.close(); }
  });
});
