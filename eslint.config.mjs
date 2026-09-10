import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 저장소에 올라가지 않는 1회성 조사·측정 스크립트(.gitignore 처리됨). 여기까지 검사하면
    // npm run lint 결과에 커밋과 무관한 경고가 섞여 "경고 0건"이라는 신호가 흐려진다.
    ".local-tools/**",
  ]),
]);

export default eslintConfig;
