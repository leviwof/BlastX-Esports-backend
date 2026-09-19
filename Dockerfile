# ---------- deps: full install (dev toolchain is needed to build) ----------
FROM node:22-alpine AS deps
WORKDIR /app
# Pinned explicitly: if the platform injects NODE_ENV=production here, npm would
# skip devDependencies and the build stage would have no compiler.
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: SWC compile (transpile-only, tiny heap) + build stamp ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
# openssl: required by the Prisma engine on Alpine (musl image ships without it)
RUN apk add --no-cache openssl
# The build stamp needs the commit SHA, and .git is excluded from the build context,
# so take it from the platform (scripts/write-build-info.js falls back to git locally
# and to `unknown` — which itself proves an image predates the stamping code).
ARG RAILWAY_GIT_COMMIT_SHA
ARG RAILWAY_GIT_BRANCH
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
ENV RAILWAY_GIT_BRANCH=${RAILWAY_GIT_BRANCH}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---------- prod-deps: production-only deps + generated Prisma client ----------
# The Prisma schema AND prisma.config.ts must be present before running
# `prisma generate`, otherwise the CLI cannot resolve the schema.
FROM node:22-alpine AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev && node_modules/.bin/prisma generate

# ---------- runtime: dist + prod deps + migrations only ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl \
 && addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --chown=nestjs:nodejs package.json prisma.config.ts ./
USER nestjs
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
