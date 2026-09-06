# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY prisma ./prisma

RUN npm install

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/sdk packages/sdk

RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build --workspace=apps/api

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY prisma ./prisma

RUN npm install --omit=dev
RUN npx prisma generate --schema=prisma/schema.prisma

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/packages/sdk/dist packages/sdk/dist

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
