import type { NextConfig } from "next";

// Local default :5000. On the VPS, build with BACKEND_URL=http://127.0.0.1:6666
// (your API behind dev.mohsindesigns.com) so Next /api + /socket.io rewrites hit the right process.
const backend = (process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Proxy /api → Express so public pages (e.g. /review PDF iframe) can use
  // same-origin URLs and avoid cross-port framing / "refused to connect".
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
      // Messages realtime (Socket.IO) — same-origin proxy for the browser.
      {
        source: "/socket.io/:path*",
        destination: `${backend}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
