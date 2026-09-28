/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fonts are loaded via <link> tags at runtime, so skip build-time font optimization.
  optimizeFonts: false,
  // The MCP lives at /mcp for people and at /api/mcp for Next.
  async rewrites() {
    return [
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/mcp/i/:code", destination: "/api/mcp/i/:code" },
    ];
  },
  async redirects() {
    return [
      { source: "/movement", destination: "/tourbillon", permanent: true },
      { source: "/movement/:path*", destination: "/tourbillon/:path*", permanent: true },
    ];
  },
};
export default nextConfig;
