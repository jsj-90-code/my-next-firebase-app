// 견적서 도구만 떼어 다른 사람 PC용 폴더로 묶기 (2026-10-23, 매뉴얼 대장 W04 "견적서 도구 폴더")
//   node scripts/quote/pack.mjs [출력 폴더]   기본: ~/Desktop/견적서도구
// 점포평가 저장소 전체를 주지 않고 스크립트·스킬·설치 안내만 넣는다. 비밀값(.env.local·로그인 정보)은 넣지 않는다.
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = process.argv[2] || join(homedir(), "Desktop", "견적서도구");
if (existsSync(join(out, "package.json"))) { console.error(`이미 있음: ${out} — 지우거나 다른 폴더를 줄 것`); process.exit(1); }
const copy = (rel, to = rel) => { mkdirSync(dirname(join(out, to)), { recursive: true }); copyFileSync(join(repo, rel), join(out, to)); };

for (const f of ["lib.mjs", "sync.mjs", "verify.mjs", "price.mjs", "login.mjs"]) copy(`scripts/quote/${f}`);
copy(".claude/skills/quote/SKILL.md");
copy("scripts/quote/SETUP.md", "SETUP.md");
const ver = JSON.parse((await import("node:fs")).readFileSync(join(repo, "package.json"), "utf8")).dependencies.googleapis;
writeFileSync(join(out, "package.json"), JSON.stringify({ name: "isens-quote-tool", private: true, type: "module", dependencies: { googleapis: ver } }, null, 2) + "\n");
writeFileSync(join(out, ".gitignore"), "node_modules/\n.env.local\n");
writeFileSync(join(out, "CLAUDE.md"), [
  "# 견적서 도구",
  "",
  "- 처음이면(`node_modules`나 `.env.local`이 없으면) `SETUP.md` 순서대로 설치를 돕는다.",
  "- 단가 갱신·영업부용 반영은 `.claude/skills/quote/SKILL.md`(견적서 스킬)를 따른다.",
  "- 사용자와는 한국어로, 쉬운 말로 이야기한다. 미리보기를 본 사용자가 \"적용해\"라고 하기 전에는 시트를 고치지 않는다.",
  "",
].join("\n"));
console.log(`만듦: ${out}\n압축해서 전달하고, 연결 정보 두 줄은 따로 1:1로 줄 것.`);
