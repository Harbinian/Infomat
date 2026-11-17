FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && install -d -o node -g node /data

COPY domain.mjs joint-review.mjs server.mjs store.mjs topics.mjs review-context.mjs review-round.mjs ./
COPY config/organization-catalog.json ./config/organization-catalog.json
COPY public ./public

ENV REVIEW_BIND_HOST=0.0.0.0 \
    REVIEW_DATA_DIR=/data
USER node
EXPOSE 3090
CMD ["node", "server.mjs"]
