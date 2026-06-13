import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '192.168.31.182',
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
  ],
};

export default nextConfig;
