// 보안규칙 행동 검증(firestore.rules.test.ts)을 에뮬레이터 위에서 돌린다.
//
// 2026-09-11 — 이 테스트 22건은 만들어진 뒤 **한 번도 실행된 적이 없었다.** 두 가지가 막고
// 있었다: ① `npm run test:rules`가 없는 바이너리 `firebase-tools`를 불렀다(실제 이름은
// `firebase`) ② 에뮬레이터에 Java가 필요한데 설치돼 있지 않았고, 설치 후에도 PATH에 안 잡혀
// 매번 JAVA_HOME을 손으로 넣어야 했다.
//
// 그래서 JDK를 알아서 찾는다. 못 찾으면 **무엇을 설치하면 되는지 알려주고 멈춘다** —
// 조용히 건너뛰면 "테스트가 있다"는 착각만 남는다(위 ①②가 정확히 그랬다).
import { execSync } from "node:child_process";
import { JDK_INSTALL_HINT, envWithJdk } from "./lib/jdk.mjs";

const env = envWithJdk();
if (!env) {
  console.error(`${JDK_INSTALL_HINT}\n\n이 테스트를 건너뛰면 firestore.rules를 지켜주는 것이 아무것도 없다.`);
  process.exit(1);
}
if (env.JAVA_HOME !== process.env.JAVA_HOME) console.log(`JDK를 찾았다: ${env.JAVA_HOME}`);

// 인자를 배열로 쪼개 shell에 넘기면 따옴표가 사라져 firebase가 "Too many arguments"로 죽는다
// (2026-09-11에 실제로 겪었다). 명령 문자열 하나로 넘긴다.
execSync(
  `npx firebase emulators:exec --only firestore --project demo-rules-test "vitest run firestore.rules.test.ts"`,
  { stdio: "inherit", env },
);
