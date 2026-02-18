import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/config': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/save-video': 'http://localhost:8000',
    },
  },
})
