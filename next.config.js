/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Fixes Firebase Google sign-in popup — Vercel's default COOP "same-origin"
          // blocks window.closed calls from the OAuth popup window.
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          // Firebase auth iframe + Google accounts need to be in frame-src.
          {
            key: 'Content-Security-Policy',
            value: "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://open.spotify.com https://embed.spotify.com;",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
