import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.FRONTEND_PORT || 8888),
    proxy: {
      '/api': {
        target: `http://0.0.0.0:${process.env.PORT || 3001}`,
        changeOrigin: true,
        timeout: 2 * 60 * 60 * 1000,
        proxyTimeout: 2 * 60 * 60 * 1000,
      },
      '/uploads': `http://0.0.0.0:${process.env.PORT || 3001}`,
    },
  }
})
