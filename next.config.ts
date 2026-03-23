import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/process": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
