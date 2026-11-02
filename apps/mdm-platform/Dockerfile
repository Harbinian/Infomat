# Build only from the batch's curated, verified context. Never use the whole
# checkout: private configuration, user data and Windows node_modules stay out.
ARG NODE_IMAGE=infomat-node:24.21.0
FROM ${NODE_IMAGE}
WORKDIR /app/apps/mdm-platform
COPY apps/mdm-platform/package.json apps/mdm-platform/package-lock.json ./
# MySQL runtime forbids SQLite. Retain locked legacy dependency descriptors;
# native install scripts are intentionally not enabled for legacy test modules.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY apps/mdm-platform/ ./
COPY apps/structured-output-service/ /app/apps/structured-output-service/
COPY scripts/ /app/scripts/
COPY docs/ /app/docs/
ENV NODE_ENV=development HOST=127.0.0.1 PORT=3000 MDM_ACCESS_MODE=http-local MDM_SESSION_STORE=mysql MDM_IDENTITY_READ_MODEL=mysql PROCESS_GOVERNANCE_READ_MODEL=mysql MDM_SYSTEM_ADMIN_ENABLED=1 PROCESS_V7_PREVIEW_ENABLED=0 PROCESS_V7_FORMAL_ENABLED=0 PROCESS_V7_AUTHORING_ENABLED=0 PROCESS_DATA_GOVERNANCE_ENABLED=0 MDM_ALLOW_LEGACY_TEST_MODE=0 ALLOW_INSECURE_SESSION_SECRET=0
LABEL infomat.service=mdm infomat.port=3000 infomat.process.primary=process-governance-v9
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["node", "docker/healthcheck.cjs"]
CMD ["node", "docker/entrypoint.cjs"]
