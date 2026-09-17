import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  define: {
    /*
     * The commit this build came from, when a host provides it. Vercel sets
     * VERCEL_GIT_COMMIT_SHA for Git-triggered builds, so a deployment can be
     * traced back to a commit by looking at the page rather than the dashboard.
     * Empty for a local build, and the footer hides the line rather than
     * printing a blank one.
     */
    __BUILD_COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
  },
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
