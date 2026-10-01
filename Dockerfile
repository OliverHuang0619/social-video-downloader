FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.ts vite.config.ts vite.server.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SVD_OUTPUT_DIR=/downloads \
    SVD_CONFIG_DIR=/config \
    SVD_COOKIES_FILE=/config/cookies.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates tini gosu \
    && python3 -m venv /opt/media-tools \
    && /opt/media-tools/bin/pip install --no-cache-dir --upgrade yt-dlp gallery-dl \
    && ln -s /opt/media-tools/bin/yt-dlp /usr/local/bin/yt-dlp \
    && ln -s /opt/media-tools/bin/gallery-dl /usr/local/bin/gallery-dl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/dist /downloads /config \
    && chown -R node:node /app /downloads /config
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
VOLUME ["/downloads", "/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
