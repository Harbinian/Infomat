ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app/apps/structured-output-service
COPY apps/structured-output-service/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY apps/structured-output-service/server.js ./
COPY apps/structured-output-service/public ./public
COPY scripts/process-governance/v7-validator.js /app/scripts/process-governance/v7-validator.js
COPY docs/contracts/ /app/docs/contracts/
# Compatibility snapshots only; these files are not business authority.
COPY docs/organization/ /app/docs/organization/
COPY docs/work-role-data.json /app/docs/work-role-data.json
ARG APP_COMMIT=unknown
ENV NODE_ENV=production STRUCTURED_OUTPUT_HOST=0.0.0.0 STRUCTURED_OUTPUT_PORT=3001 STRUCTURED_OUTPUT_APP_COMMIT=${APP_COMMIT}
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health',{signal:AbortSignal.timeout(4000)}).then(async r=>{const h=await r.json();if(!r.ok||h.status!=='ok'||h.schema_version!=='process-governance-v7'||h.release_status!=='released')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
