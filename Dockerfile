# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3010
COPY --from=build /app /app
RUN mkdir -p data
EXPOSE 3010
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
