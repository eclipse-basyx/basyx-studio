import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The UI is served under /app/<installation>/ui/, so every URL is relative.
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
})
