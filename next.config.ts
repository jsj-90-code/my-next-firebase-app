import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin은 Next.js 기본 serverExternalPackages 목록에 있어서 런타임에 require()로
  // 불러오는데, 그 안의 jwks-rsa가 CJS require()로 ESM 전용인 jose를 불러오다가
  // "ERR_REQUIRE_ESM"으로 죽는 문제가 있다 (Vercel 배포에서만 재현, 로컬 dev는 영향 없음).
  // firebase-admin을 번들에 포함시키면(transpilePackages) 이 external-require 경로를 안 타서
  // 문제가 해결된다.
  transpilePackages: ["firebase-admin"],
};

export default nextConfig;
