import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH é definido no GitHub Actions ("/bulk-scanner/"), pois o GitHub Pages
// publica o site em https://<usuario>.github.io/bulk-scanner/.
// Localmente fica "/" (http://localhost:5173/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    // PWA: permite instalar na tela inicial e usar sem internet.
    VitePWA({
      registerType: 'prompt', // versão nova só entra quando o usuário tocar em "Atualizar"
      injectRegister: false, // o registro é feito em src/ui/UpdateBanner.tsx
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Bulk Scanner',
        short_name: 'Bulk Scanner',
        description: 'Encontre cartas valiosas de Magic no meio do bulk usando a câmera.',
        lang: 'pt-BR',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f0f10',
        theme_color: '#111111',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Guardado na instalação: o "esqueleto" do app (pequeno).
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        // O motor de OCR (~12 MB) é guardado na primeira vez que for usado; os
        // preços ficam no IndexedDB (src/core/prices/cardDatabase.ts).
        globIgnores: ['tesseract/**', 'data/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//, /\/tesseract\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: { cacheName: 'tesseract', expiration: { maxEntries: 12 } },
          },
        ],
      },
    }),
  ],
});
