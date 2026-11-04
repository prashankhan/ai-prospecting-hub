import type { NextConfig } from "next";

/**
 * Cache Components is intentionally disabled: every screen in this app is
 * authenticated, per-user and per-project, so request-time rendering is the
 * correct default. Revisit when public/static surfaces are added.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // CSV imports are capped at 2 MB; allow multipart overhead.
    serverActions: { bodySizeLimit: "3mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
