import { defineConfig } from "vitest/config";
import path from "node:path";

// tsconfig.json의 "@/*" -> "./src/*" 경로 별칭을 vitest에서도 그대로 쓰기 위한 최소 설정.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
