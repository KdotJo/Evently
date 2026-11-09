import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { extractMiddleware } from './server/extract.ts'

// Serves POST /api/extract (Claude-backed intake extraction) from the dev and preview servers.
const extractApi = (): Plugin => ({
  name: 'extract-api',
  configureServer: (server) => void server.middlewares.use(extractMiddleware),
  configurePreviewServer: (server) => void server.middlewares.use(extractMiddleware),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), extractApi()],
})
