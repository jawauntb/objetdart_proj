/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fonts are loaded via <link> tags at runtime, so skip build-time font optimization.
  optimizeFonts: false,
  async redirects() {
    return [
      { source: "/movement", destination: "/tourbillon", permanent: true },
      { source: "/movement/:path*", destination: "/tourbillon/:path*", permanent: true },
    ];
  },
};
export default nextConfig;
