FROM node:24-bookworm-slim

WORKDIR /app
RUN install -d -o node -g node /data
COPY server.mjs store.mjs http-interface.mjs candidates.mjs batch-report.mjs presentation.mjs catalog-audit.mjs ./

ENV REVIEW_DATA_DIR=/data REVIEW_CATALOG_PATH=/catalog/review-catalog.json
USER node
EXPOSE 3093
CMD ["node", "server.mjs"]
