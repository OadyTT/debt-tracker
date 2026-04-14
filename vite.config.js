import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Split chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        }
      }
    },
    // Minify aggressively
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,   // remove console.log in prod
        drop_debugger: true,
      }
    },
    // Show bundle size warnings at 500KB
    chunkSizeWarningLimit: 500,
  },
  // Preload fonts
  server: {
    host: true,
  }
})
