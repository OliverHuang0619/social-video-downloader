import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.2.0'),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } }
})
