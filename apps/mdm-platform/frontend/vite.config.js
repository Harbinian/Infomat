import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { isolatedBackend, checkDevPort, freeDevPort } from './devBoundary.js';
import { sharedEditorPresentation } from './sharedEditorPresentation.js';

export default defineConfig(async ({ command }) => {
  const target = command === 'serve' ? isolatedBackend(process.env.MDM_ISOLATED_BACKEND) : null;
  return {
    base: '/app/',
    envDir: false,
    envPrefix: [],
    publicDir: false,
    resolve: { dedupe: ['react', 'react-dom', 'antd', 'cytoscape', 'elkjs'] },
    plugins: [{name:'mdm-shared-editor-presentation', enforce:'pre', transform:sharedEditorPresentation}, react(), {
      name: 'mdm-isolated-development',
      configResolved(config) {
        if (command === 'serve') {
          checkDevPort(config.server.port);
          if (config.server.host !== '127.0.0.1') throw new Error('Development must bind 127.0.0.1.');
          if (config.server.cors !== false || config.server.strictPort !== true) throw new Error('Development requires CORS off and strictPort on.');
        }
      }
    }],
    build: { outDir: 'dist', sourcemap: false, assetsInlineLimit: 0 },
    worker: { format: 'es' },
    server: {
      host: '127.0.0.1', port: command === 'serve' ? await freeDevPort() : undefined, strictPort: true, cors: false,
      proxy: target ? {
        '^/api(?:/|$)': { target, changeOrigin: false },
        '^/(?:echarts\\.min\\.js|logo\\.png)$': { target, changeOrigin: false },
        '^/$': { target, changeOrigin: false }
      } : undefined
    }
  };
});
