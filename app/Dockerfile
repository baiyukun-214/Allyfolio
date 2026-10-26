# Official Playwright image (Ubuntu 24.04 + Chromium system deps). Keep the tag in sync with "playwright" in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
# Pin Node 22 (node:sqlite, engines >=22.22) regardless of the Node shipped in the Playwright image.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# tsx runs the TypeScript sources, so dev deps are needed. Browsers already live in /ms-playwright; install is a no-op if versions match.
RUN npm ci --include=dev && npx playwright install chromium
COPY . .
RUN mkdir -p /data && chown -R pwuser /data /app
USER pwuser
ENV DATABASE_PATH=/data/allyfolio.db PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
