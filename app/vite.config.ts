import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Any request starting with /api will be forwarded to your Python server
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Removes the "/api" prefix before sending it to Python if your API doesn't use it
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
