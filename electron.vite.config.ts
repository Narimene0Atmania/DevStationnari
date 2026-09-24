import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // Keep off Vite's default 5173, which the dev servers we manage usually want.
    server: { port: 5199, strictPort: true },
    plugins: [react()]
  }
})
