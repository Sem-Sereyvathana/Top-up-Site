/** @type {import('next').NextConfig} */

// Standard hardening headers, applied to every response. The
// Content-Security-Policy is NOT set here — it lives in middleware.ts,
// where it is generated per request with a fresh nonce (a static CSP
// cannot carry a per-request nonce). Keep the two files in sync: this list
// covers everything except CSP.
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
    // Only these hosts may be proxied through /_next/image. A wildcard here
    // would let anyone use your server as a free image proxy.
    //  - res.cloudinary.com : all new admin uploads
    //  - *.public.blob.vercel-storage.com : images uploaded before the
    //    switch to Cloudinary (safe to remove once they're migrated)
    //  - cdn.sharustore.com : the seed data's image host
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "cdn.sharustore.com" },
    ],
  },
  // pdfkit reads its built-in AFM font files from disk via fs.readFileSync.
  // Next.js/Vercel must leave it as an external CommonJS module so that those
  // font assets are resolvable at runtime in the serverless lambda.
  // (Promoted out of `experimental` in Next 15 — was serverComponentsExternalPackages.)
  serverExternalPackages: ["pdfkit"],
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
