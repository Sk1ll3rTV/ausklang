import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const pagesBase = '/ausklang/';

export default defineConfig({
  base: pagesBase,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        id: pagesBase,
        name: 'Ausklang',
        short_name: 'Ausklang',
        description: 'Ruhig und adaptiv auf null Zigaretten.',
        lang: 'de',
        start_url: pagesBase,
        scope: pagesBase,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        icons: [
          { src: `${pagesBase}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${pagesBase}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${pagesBase}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // Startbilder lädt iOS selbst beim Hinzufügen zum Home-Bildschirm.
        globIgnores: ['splash/**'],
        navigateFallback: `${pagesBase}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
