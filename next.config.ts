import type { NextConfig } from "next";
import assetRedirects from "./data/exercise-asset-redirects.json";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  async redirects() { return assetRedirects; },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
};

export default nextConfig;
