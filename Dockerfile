FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src src
COPY public public
COPY scripts scripts
COPY tsconfig.json tsconfig.base.json ./

ENV NODE_ENV=production
ENV MARKETPLACE_HOST=0.0.0.0
ENV MARKETPLACE_PORT=4320
ENV MARKETPLACE_DATA_DIR=/data
EXPOSE 4320
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://127.0.0.1:4320/api/health || exit 1
CMD ["pnpm", "start"]
