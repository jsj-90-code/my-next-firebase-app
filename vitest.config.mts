import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

// tsconfig.json의 "@/*" -> "./src/*" 경로 별칭을 vitest에서도 그대로 쓰기 위한 최소 설정.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // 2026-09-11 — .local-tools에 git worktree를 두고 작업할 때가 있는데(검토용 별도
    // 체크아웃), 각 워크트리에 src 전체가 들어 있어서 같은 테스트가 여러 번 잡혔다.
    // 여기서 1834개(474개 × 워크트리 수)가 나와 실제 규모를 착각하게 된다.
    // 2026-10-30 — 측정기 쪽 시험 두 개는 node:test로 쓰여 있어 vitest가 잡으면 "No test suite found"로
    // 붉는다(시험 자체는 통과). 그 둘은 `node --test`로 돌린다.
    exclude: [
      ...configDefaults.exclude,
      "**/.local-tools/**",
      "scripts/pingMonitor/agent/timestamp.test.mjs",
      "scripts/pingMonitor/notifications/watch.test.mjs",
    ],
  },
});
