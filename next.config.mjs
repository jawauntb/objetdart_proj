/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fonts are loaded via <link> tags at runtime, so skip build-time font optimization.
  optimizeFonts: false,
};
export default nextConfig;
