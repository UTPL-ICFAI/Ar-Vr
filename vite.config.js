import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    https: false
  },
  resolve: {
    alias: {
      '@mediapipe/pose': path.resolve(__dirname, 'src/stubs/mediapipe-pose.js'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 5000
  }
})
