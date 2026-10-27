# API, 워커, 스케줄러가 같은 이미지를 쓰고 Railway 서비스마다 시작 명령만 다르게 둔다 (railway/*.json)

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# 워커가 대상 저장소를 clone할 때 git이 필요하다
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    CLAUDE_BIN=/app/node_modules/.bin/claude
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
# Claude Code를 root가 아닌 사용자로 실행한다
USER node
CMD ["node", "dist/api/main.js"]
