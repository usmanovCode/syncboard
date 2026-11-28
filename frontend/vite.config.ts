/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The frontend always calls relative /api/... URLs; in dev they are forwarded to Spring Boot.
    proxy: {
      '/api': 'http://localhost:8080',
      // Board real-time channel (STOMP over WebSocket).
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The 5 s default is too tight under a full parallel run: the pinch-zoom test fires ~340 wheel
    // events, each querying the whole DOM, and took ~4 s even before the redesign. A higher ceiling
    // costs nothing when tests are fast.
    testTimeout: 15_000,
  },
})
