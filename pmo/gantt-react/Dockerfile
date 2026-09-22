ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app/pmo/gantt-react
COPY pmo/gantt-react/package*.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY pmo/gantt-react/index.html pmo/gantt-react/vite.config.js ./
COPY pmo/gantt-react/src ./src
COPY pmo/gantt-react/plugins ./plugins
COPY pmo/gantt-react/public ./public
COPY pmo/procedure-management/dashboard.html /app/pmo/procedure-management/dashboard.html
COPY echarts.min.js /app/echarts.min.js
RUN mkdir -p /app/pmo/deliverables /app/artifacts/pmo/deliverables node_modules/.vite node_modules/.vite-temp && chown -R node:node /app/artifacts /app/pmo/deliverables node_modules/.vite node_modules/.vite-temp
ENV PMO_DELIVERABLE_RUNTIME_DIR=/app/artifacts/pmo/deliverables
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "Promise.all(['/tasks.json','/api/pmo/deliverables'].map(async p=>{const r=await fetch('http://127.0.0.1:5173'+p);if(!r.ok)throw Error(p);const d=await r.json();if(p.includes('/api/')&&!d.ok)throw Error(p)})).catch(()=>process.exit(1))"
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
