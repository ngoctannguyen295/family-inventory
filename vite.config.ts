import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      devOptions: {
        enabled: false,
      },
      includeAssets: [
        'favicon.svg',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'maskable-icon-512x512.png',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        name: 'Hàng hóa gia đình',
        short_name: 'Kho gia đình',
        description: 'Ứng dụng quản lý hàng hóa và tồn kho gia đình tiện lợi, trực quan',
        lang: 'vi',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0284c7',
        background_color: '#f0f9ff',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Chỉ precache giao diện và tài nguyên tĩnh của ứng dụng
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        navigateFallback: '/index.html',
        // Tuyệt đối không can thiệp hay cache các request đến Supabase API, Auth, Storage, Edge Functions
        navigateFallbackDenylist: [/^\/rest\//, /^\/storage\//, /^\/auth\//, /^\/functions\//],
        // Không cấu hình runtime-cache cho API, Auth, Storage, Edge Functions, ảnh private hay AI
        runtimeCaching: [],
      },
    }),
  ],
})
