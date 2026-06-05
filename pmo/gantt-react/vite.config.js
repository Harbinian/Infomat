import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pmoDeliverablesPlugin } from './plugins/pmoDeliverablesPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [pmoDeliverablesPlugin(), react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // 允许 dev-only 插件读取同级 pmo/deliverables 正本文档。
    fs: { allow: ['..'] },
  },
})
