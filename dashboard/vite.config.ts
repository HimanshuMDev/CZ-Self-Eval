import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  cacheDir: '/tmp/vite-cz-dashboard',
  build: {
    emptyOutDir: false,   // avoids EPERM on mounted filesystem
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Sessions API → local standalone server (connects to Atlas MongoDB)
      '/api/arena/chat-sessions': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/arena/chat-sessions', '/api/sessions'),
      },
      // Compare Reports API → same standalone server
      '/api/compare-reports': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
      // Metrics, eval results, judge, search → local server
      '/api/metrics':         { target: 'http://localhost:4001', changeOrigin: true },
      '/api/eval-results':    { target: 'http://localhost:4001', changeOrigin: true },
      '/api/eval/judge':      { target: 'http://localhost:4001', changeOrigin: true },
      '/api/sessions/search':     { target: 'http://localhost:4001', changeOrigin: true },
      '/api/sessions/questions':  { target: 'http://localhost:4001', changeOrigin: true },
      '/api/generate-questions':  { target: 'http://localhost:4001', changeOrigin: true },
      '/api/questions-bank':      { target: 'http://localhost:4001', changeOrigin: true },
      '/api/golden':              { target: 'http://localhost:4001', changeOrigin: true },
      '/api/eval-score':          { target: 'http://localhost:4001', changeOrigin: true },
    },
  }
})
