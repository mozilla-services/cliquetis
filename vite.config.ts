/// <reference types="vitest" />

import { defineConfig } from 'vite'
import path from 'path'

/**
 * used to set the relative path from which we expect to serve the admin's
 * static bundle on the server:
 *    GH Pages:     /kinto-admin/
 *    Kinto plugin: /v1/admin/
 */
const ASSET_PATH = process.env.ASSET_PATH || "/";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 3000,
  },
  envPrefix: 'KINTO_JS',
  // plugins: [react()],
  base: ASSET_PATH,  
  define: {},
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, './src'),
      '@test': path.resolve(__dirname, './test')
    }
  },
  build: {
    outDir: "build"
  },
  test: {
    globals: true,
  }
})
