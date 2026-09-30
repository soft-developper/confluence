import type { NextConfig } from "next";

// Security headers on every page (confluence:security-headers). The app must never be shown
// inside another site's frame (clickjacking); frame-ancestors is the modern rule and
// X-Frame-Options covers older browsers. Only frame-ancestors is set in the CSP, so wallet
// and WalletConnect scripts keep working exactly as before.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
