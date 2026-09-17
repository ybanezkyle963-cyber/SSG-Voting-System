import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built site works both at a domain root (Vercel)
  // and when opened straight from disk with no server at all. Hash routes mean
  // there are no real paths for a relative base to break.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
