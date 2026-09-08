import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: /^node-fetch$/,
        replacement: fileURLToPath(new URL('./src/lib/citation-fetch.ts', import.meta.url)),
      },
      {
        find: /^sync-fetch$/,
        replacement: fileURLToPath(new URL('./src/lib/citation-sync-fetch.ts', import.meta.url)),
      },
    ],
  },
  optimizeDeps: { include: ['pdfjs-dist/legacy/build/pdf.mjs', 'docx'] },
  server: {
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.tmp/**', '**/.tools/**', '**/release/**'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
})
