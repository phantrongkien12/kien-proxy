/**
 * Baseline response headers. The CSP is report-only on purpose: it logs
 * violations without being able to break the live dashboard, and it can be
 * promoted to an enforcing policy once the reports come back clean.
 */
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
