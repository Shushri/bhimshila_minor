import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The headers a disaster platform owes its users. Framing is denied because
  // an operations screen inside someone else's iframe is a clickjacking
  // surface; the mic is scoped to ourselves because voice is a first-class
  // input here and no embedded page gets to borrow it.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), geolocation=(self), camera=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
