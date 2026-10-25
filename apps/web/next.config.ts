import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  // The browser verifier talks only to the RPC the verifier chooses.
  "connect-src 'self' https: http://127.0.0.1:8545 http://localhost:8545",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@blindcount/crypto", "@blindcount/domain", "@blindcount/contracts"],
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${API}/v1/:path*` },
      { source: "/health/:path*", destination: `${API}/health/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
