FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.ts vite.config.ts vite.server.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SVD_OUTPUT_DIR=/downloads \
    SVD_CONFIG_DIR=/config \
    SVD_IMPORT_DIR=/imports \
    SVD_COOKIES_FILE=/config/cookies.txt \
    SVD_SKILL_DIR=/app/skills/english-video-catalog \
    SVD_BROWSER_CDP=http://browser:9222 \
    SVD_BROWSER_VNC=http://browser:6080
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates tini gosu \
    && python3 -m venv /opt/media-tools \
    && /opt/media-tools/bin/pip install --no-cache-dir --upgrade yt-dlp gallery-dl \
    && ln -s /opt/media-tools/bin/yt-dlp /usr/local/bin/yt-dlp \
    && ln -s /opt/media-tools/bin/gallery-dl /usr/local/bin/gallery-dl \
    && npm install -g @openai/codex@0.130.0 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/dist /downloads /imports /config \
    && chown -R node:node /app /downloads /config
ARG CODEX_VERSION=0.130.0
ARG TARGETARCH
RUN codex_arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && if [ "$codex_arch" = "amd64" ]; then codex_arch="x64"; fi \
    && npm install -g "@openai/codex-linux-${codex_arch}@npm:@openai/codex@${CODEX_VERSION}-linux-${codex_arch}" \
    && codex --version
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node skills ./skills
RUN cd /app/skills/english-video-catalog/scripts && npm ci --omit=dev
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
VOLUME ["/downloads", "/imports", "/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
