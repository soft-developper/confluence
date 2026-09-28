import type { NextConfig } from "next";

// Confluence admin dashboard, its own site (confluence:admin-site). Every response tells
// search engines not to index or follow it, on top of robots.txt and page metadata.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }, { key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
