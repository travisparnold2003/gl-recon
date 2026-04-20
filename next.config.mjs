/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Prevent flaky filesystem cache writes in this Windows workspace.
      config.cache = false;
    }
    return config;
  }
};

export default nextConfig;
