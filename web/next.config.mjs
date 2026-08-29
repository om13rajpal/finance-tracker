/** @type {import('next').NextConfig} */
export default {
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiBase}/:path*` }];
  },
};
