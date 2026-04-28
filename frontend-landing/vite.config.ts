import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'backlogoo.png'],
      manifest: {
        name: 'GrantChina — обучение в Китае',
        short_name: 'GrantChina',
        description: 'Помогаем студентам поступить в топ-университеты Китая',
        theme_color: '#e72727',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        lang: 'ru',
        icons: [
          { src: '/backlogoo.png', sizes: '192x192', type: 'image/png' },
          { src: '/backlogoo.png', sizes: '512x512', type: 'image/png' },
          { src: '/backlogoo.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Service worker сразу активируется при новом билде и забирает контроль
        // над всеми открытыми клиентами — старая закэшированная версия не "залипает".
        skipWaiting: true,
        clientsClaim: true,
        // Не кэшируем /admin (это проксированный CRM-бандл с другим life-cycle)
        // и не кэшируем POST/api запросы.
        navigateFallbackDenylist: [/^\/admin/, /^\/api/],
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,jpeg,svg,webp,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/flagcdn\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'flag-images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
