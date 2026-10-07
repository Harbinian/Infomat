import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { DOMAIN_MODULE_FILES } from './bridge.mjs';

const candidateOrigin = 'http://127.0.0.1:3027';
const proxy = Object.fromEntries(['/api', '/vendor', ...DOMAIN_MODULE_FILES.map(module => `/${module.file}`)].map(route => [route, candidateOrigin]));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/workbench/',
  plugins: [react()],
  build: { outDir: '../public/workbench', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy },
});
