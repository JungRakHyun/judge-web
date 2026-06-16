import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'JUDGE MAP - 법관 통합 정보 생태계',
        short_name: 'JUDGE MAP',
        theme_color: '#0F172A',
        background_color: '#0B1120',
        display: 'standalone',
        icons: [
          // { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          // { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
})