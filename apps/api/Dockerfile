# Build from repo root: docker build -f apps/api/Dockerfile -t blindcount-api .
FROM node:24-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/verify-cli ./apps/verify-cli
RUN pnpm install --frozen-lockfile --filter @blindcount/api... && pnpm --filter @blindcount/db generate
RUN useradd --create-home --uid 10001 blindcount && mkdir -p /data && chown blindcount /data
USER blindcount
ENV NODE_ENV=production STORAGE_DIR=/data
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npx", "tsx", "src/main.ts"]
