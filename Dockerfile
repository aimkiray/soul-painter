# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3010
COPY --from=build --chown=node:node /app /app
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3010
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
