/** @type {import('next').NextConfig} */

// Standard hardening headers, applied to every response. Deliberately no
// Content-Security-Policy here — a strict CSP needs to be tuned against
// this app's actual scripts/images/fonts first, or it'll silently break
// things. Add one later once it's been tested against every page.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // pdfkit reads its built-in AFM font files from disk via fs.readFileSync.
  // Next.js/Vercel must leave it as an external CommonJS module so that those
  // font assets are resolvable at runtime in the serverless lambda.
  experimental: {
    serverComponentsExternalPackages: ["pdfkit"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
