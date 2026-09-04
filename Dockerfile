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
# Nicht-sensitive Platzhalter gelten nur für diesen Build-Schritt. Die Runtime
# erhält ihre echten Werte ausschließlich beim Containerstart aus der Umgebung.
RUN AUTH_SECRET="build-time-placeholder-secret-please-override-xxxx" \
    ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
    OIDC_ISSUER="http://localhost:3000" \
    OIDC_CLIENT_ID="build-placeholder" \
    OIDC_CLIENT_SECRET="build-placeholder" \
    npm run build

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
ENV PROTOCOL_PDF_PYTHON=/opt/protocol-pdf/bin/python
COPY scripts/protocol-pdf/requirements.txt /tmp/protocol-pdf-requirements.txt
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata python3 python3-venv libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
  && python3 -m venv /opt/protocol-pdf \
  && /opt/protocol-pdf/bin/pip install --no-cache-dir -r /tmp/protocol-pdf-requirements.txt \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/protocol-pdf ./scripts/protocol-pdf

# Upload-Verzeichnis (wird per Volume gemountet; DB liegt im Postgres-Container)
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
