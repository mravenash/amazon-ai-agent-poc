import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@cloudscape-design')) return 'cloudscape';
            if (id.includes('@tanstack')) return 'tanstack';
            if (id.includes('zustand')) return 'state';
            if (id.includes('react')) return 'react-vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
