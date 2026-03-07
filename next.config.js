/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow Spotify embed iframe
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-src 'self' https://open.spotify.com https://embed.spotify.com;",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
