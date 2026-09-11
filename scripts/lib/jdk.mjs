// Firestore 에뮬레이터는 JVM 위에서 돈다. Windows에서 JDK를 설치해도 PATH에 안 잡히는
// 경우가 많아(2026-09-11 실제로 겪음) 흔한 설치 위치를 직접 찾는다.
//
// 이 탐색이 없으면 에뮬레이터가 조용히 안 떠서 "테스트가 실패했다"와 "테스트가 아예 안 돌았다"를
// 구분 못 한다 — 그 바람에 변이 검사 결과를 한 번 잘못 읽었다.
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function javaOnPath() {
  try {
    execSync("java -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 흔한 설치 위치에서 JDK 홈을 찾는다. 못 찾으면 null. */
export function findJdkHome() {
  const roots = [
    "C:/Program Files/Eclipse Adoptium",
    "C:/Program Files/Java",
    "C:/Program Files/Microsoft/jdk",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Eclipse Adoptium") : null,
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const home = join(root, name);
      if (existsSync(join(home, "bin", "java.exe")) || existsSync(join(home, "bin", "java"))) return home;
    }
  }
  return null;
}

export const JDK_INSTALL_HINT = [
  "Firestore 에뮬레이터를 돌리려면 Java가 필요하다.",
  "",
  "설치:  winget install -e --id EclipseAdoptium.Temurin.21.JDK",
  "그 뒤 다시 실행하면 된다 — 설치 위치는 알아서 찾는다.",
].join("\n");

/**
 * JAVA_HOME/PATH가 채워진 env를 돌려준다. JDK가 없으면 null.
 * 호출부가 "없으면 멈춘다"를 직접 정하게 한다 — 조용히 건너뛰면 안 된다.
 */
export function envWithJdk(base = process.env) {
  const env = { ...base };
  if (env.JAVA_HOME || javaOnPath()) return env;
  const home = findJdkHome();
  if (!home) return null;
  env.JAVA_HOME = home;
  env.PATH = `${join(home, "bin")}${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
  return env;
}
