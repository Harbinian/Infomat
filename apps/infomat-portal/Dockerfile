FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.mjs services.json ./
COPY public ./public
ENV PORTAL_PORT=8080 PORTAL_BIND_HOST=0.0.0.0 PORTAL_PROBE_HOST=host.docker.internal
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
