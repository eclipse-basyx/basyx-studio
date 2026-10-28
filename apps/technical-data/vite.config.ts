import { studioApp } from '@basyx/studio-app-kit/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The UI in ui/ is built to dist/ui/ with relative URLs, as Studio serves
// it under /app/<installation>/ui/, and Vuetify gets Studio's Sass settings
// (studioApp(), ADR 0043).
// The file viewer's thumbnails show the logo and the product images (ADR 0052).
export default defineConfig({
  plugins: [vue(), studioApp()],
  build: {
    chunkSizeWarningLimit: 8000,
  },
})
