# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

# ---- Dependencies (inkl. Build-Tools für native Module) ----
FROM base AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Platzhalter-Secrets nur für den Build (Runtime nutzt echte Werte aus .env)
ENV AUTH_SECRET="build-time-placeholder-secret-please-override-xxxx"
ENV ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
ENV OIDC_ISSUER="http://localhost:3000"
ENV OIDC_CLIENT_ID="build-placeholder"
ENV OIDC_CLIENT_SECRET="build-placeholder"
RUN npm run build

# ---- Runtime (schlank) ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Zeitzone Europe/Berlin (für Logs/rohe Date-Nutzung; Anzeige nutzt zusätzlich
# explizit Intl mit timeZone). tzdata, damit TZ auf Debian-slim auflöst.
ENV TZ=Europe/Berlin
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# Upload-Verzeichnis (wird per Volume gemountet; DB liegt im Postgres-Container)
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
