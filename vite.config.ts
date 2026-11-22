import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'utools/dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@lezer')) {
            return 'lezer'
          }
          if (id.includes('node_modules/@codemirror')) {
            return 'codemirror'
          }
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
