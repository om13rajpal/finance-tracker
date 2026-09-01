/** @type {import('next').NextConfig} */
export default {
  async rewrites() {
    // Server-side only — deliberately NOT NEXT_PUBLIC_-prefixed. This is where
    // `/api/*` gets proxied TO on the backend; it must never reach the browser
    // bundle. (It used to share a name with the client's API base URL, which
    // meant the browser called the backend directly, cross-site, and the
    // sameSite=lax session cookie was silently dropped on every request.)
    const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiProxyTarget}/:path*` }];
  },
};
