const path = require('path');

/** @type {import('next').NextConfig} */

// COORD_BACKEND_URL: server-side only — used by Next.js rewrites to reach the backend
// (set this to the Docker service URL when running in a container).
// Falls back to NEXT_PUBLIC_API_URL, then localhost for local dev.
const API_URL = process.env.COORD_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

module.exports = {
  reactStrictMode: true,
  swcMinify: true,
  async rewrites() {
    // Use fallback so Next.js dynamic page routes (e.g. /launch/[id]) are served
    // by the React app on direct navigation; sub-paths like /launch/:id/audit are
    // still proxied to the backend because they have no matching page file.
    return {
      fallback: [
        { source: '/api/:path*',      destination: `${API_URL}/api/:path*` },
        { source: '/auth/:path*',     destination: `${API_URL}/auth/:path*` },
        { source: '/audit/:path*',    destination: `${API_URL}/audit/:path*` },
        { source: '/launch/:path*',   destination: `${API_URL}/launch/:path*` },
        { source: '/launches/:path*', destination: `${API_URL}/launches/:path*` },
        { source: '/committee/:path*',destination: `${API_URL}/committee/:path*` },
        { source: '/admin/:path*',    destination: `${API_URL}/admin/:path*` },
      ],
    };
  },
  webpack: (config) => {
    // Prevent Watchpack from watching ancestor directories (avoids ENOSPC in dev).
    // RegExp matches any path that does NOT start with this project root,
    // so only files inside web/app/ are ever watched.
    const projectRoot = path.resolve(__dirname);
    const escaped = projectRoot.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
    config.watchOptions = {
      ...config.watchOptions,
      ignored: new RegExp(`^(?!${escaped}(?:/|$))`),
    };

    config.module.rules.push({
      test: /\.yaml$/,
      use: 'yaml-loader',
    });

    // Fix: libsodium-wrappers-sumo ESM build has a broken relative import
    // for './libsodium-sumo.mjs'. Force webpack to use the CJS builds instead.
    config.resolve.alias = {
      ...config.resolve.alias,
      'libsodium-wrappers-sumo': path.resolve(
          __dirname,
          'node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'
      ),
    };

    return config;
  },
  images: {
    remotePatterns: [
      {
        hostname: 'raw.githubusercontent.com',
      },
      {
        hostname: 'gist.githubusercontent.com',
      },
    ],
  },
};
