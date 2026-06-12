import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pmoDeliverablesPlugin } from './plugins/pmoDeliverablesPlugin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const PROCEDURE_DASHBOARD_FILE = path.resolve(__dirname, '../procedure-management/dashboard.html')
const ECHARTS_FILE = path.resolve(REPO_ROOT, 'echarts.min.js')

function pmoProcedureDashboardPlugin() {
  const routes = new Map([
    ['/procedure-management/dashboard.html', { filePath: PROCEDURE_DASHBOARD_FILE, contentType: 'text/html; charset=utf-8' }],
    ['/echarts.min.js', { filePath: ECHARTS_FILE, contentType: 'text/javascript; charset=utf-8' }],
  ])

  const serveProcedureAsset = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    const asset = routes.get(decodeURIComponent(url.pathname))
    if (!asset) {
      next()
      return
    }

    try {
      const source = await fsp.readFile(asset.filePath)
      res.statusCode = 200
      res.setHeader('Content-Type', asset.contentType)
      res.end(source)
    } catch {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`PMO procedure asset not found: ${path.relative(REPO_ROOT, asset.filePath)}`)
    }
  }

  return {
    name: 'pmo-procedure-dashboard',
    configureServer(server) {
      server.middlewares.use(serveProcedureAsset)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveProcedureAsset)
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'procedure-management/dashboard.html',
        source: await fsp.readFile(PROCEDURE_DASHBOARD_FILE, 'utf8'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'echarts.min.js',
        source: await fsp.readFile(ECHARTS_FILE),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [pmoProcedureDashboardPlugin(), pmoDeliverablesPlugin(), react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    // 允许 dev-only 插件读取同级 pmo/deliverables 正本文档。
    fs: { allow: ['..'] },
  },
})
