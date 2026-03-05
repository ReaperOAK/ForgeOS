FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./
COPY src/dashboard/ ./dist/dashboard/

ENV NODE_ENV=production
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
