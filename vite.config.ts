import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function saveTestAssetPlugin(): Plugin {
  return {
    name: 'save-test-asset',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/save-test-asset', (req, res) => {
        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString())
              const { filename, base64 } = body
              if (filename && base64) {
                const targetDir = path.resolve(process.cwd(), 'public', 'test-assets')
                if (!fs.existsSync(targetDir)) {
                  fs.mkdirSync(targetDir, { recursive: true })
                }
                const targetPath = path.resolve(targetDir, filename)
                fs.writeFileSync(targetPath, Buffer.from(base64, 'base64'))
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true, path: targetPath }))
                return
              }
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
              return
            }
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing filename or base64' }))
          })
        } else {
          res.writeHead(405).end()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true, // Mở mạng nội bộ để điện thoại cùng Wi-Fi truy cập được
  },
  build: {
    // Increase chunk size warning limit to reduce warnings for large bundles
    chunkSizeWarningLimit: 1000,
  },
  plugins: [
    react(),
    saveTestAssetPlugin(),
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
        name: 'Quản lý hàng hoá',
        short_name: 'Quản lý hàng hoá',
        description: 'Ứng dụng quản lý hàng hóa và tồn kho tiện lợi, trực quan',
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

