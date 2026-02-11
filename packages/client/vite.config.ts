import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9743,
    proxy: {
      '/api': {
        target: 'http://localhost:9742',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:9742',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
