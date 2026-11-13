FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org && npm cache clean --force
COPY server.mjs store.mjs collector.mjs reconcile.mjs source-node.mjs detail-evidence.mjs quantity-review.mjs quantity-runner.mjs order-checks.mjs material-checks.mjs chain-checks.mjs unified-statistics.mjs statistics-inputs.mjs risk-policy.json datasets.mjs bridge.ps1 rules.json ./
COPY scripts/audit-quantity.py scripts/order-checks.py scripts/material-checks.py scripts/chain-checks.py scripts/unified-statistics.py scripts/risk-context.py scripts/preserve-material-checks.mjs scripts/preserve-order-checks.mjs ./scripts/
COPY scripts/check-persistence.py ./scripts/
COPY processing-checks.mjs ./
COPY publication-worker.mjs ./
COPY scripts/processing-checks.py ./scripts/
COPY sql ./sql
COPY public ./public
USER node
ENV NODE_ENV=production ORDER_DB_DRIVER=node ORDER_DATA_ROOT=/data ORDER_ACCESS=lan NODE_OPTIONS=--max-old-space-size=2048
EXPOSE 9998
HEALTHCHECK --interval=30s --timeout=15s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:9998/api/health').then(async r=>{const h=await r.json();process.exit(r.ok&&h.ok&&h.service==='order-reconciliation'&&h.sourceDriver==='node-mssql'?0:1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
