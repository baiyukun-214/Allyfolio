FROM node:22-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY . .
RUN useradd -m -u 10001 app && mkdir -p /data && chown -R app /data /app
USER app
ENV DATABASE_PATH=/data/allyfolio.db PORT=8787
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
