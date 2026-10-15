FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --registry=https://registry.npmjs.org && npm cache clean --force
COPY server.mjs database.mjs query.mjs fields.mjs access.mjs ./
COPY sql ./sql
COPY public ./public
USER node
ENV NODE_ENV=production U8_DB_DRIVER=node U8_LISTEN_HOST=0.0.0.0 U8_QUERY_PORT=3088
EXPOSE 3088
HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3088/api/health').then(async r=>{const h=await r.json();process.exit(r.ok&&h.ok&&h.databaseUser==='va2'&&h.timeZone==='UTC+8'?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
