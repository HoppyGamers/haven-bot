# ---------------------------------------------------------------------------
# Haven Bot — Dockerfile
# ---------------------------------------------------------------------------
# Build:   docker build -t haven-bot .
# Run:     docker run -d --env-file .env -v haven_data:/data haven-bot
# ---------------------------------------------------------------------------

# Use the LTS Alpine image — small footprint, matches the >=18 engine requirement
FROM node:20-alpine

# Install build tools needed to compile better-sqlite3's native bindings
RUN apk add --no-cache python3 make g++

# Run as non-root user for security
USER node

WORKDIR /app

# Copy dependency manifests first so Docker can cache the npm install layer.
# Only re-runs npm ci when package.json or package-lock.json actually change.
COPY --chown=node:node package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source files
COPY --chown=node:node src/ ./src/

# /data is where the database lives — mount a volume here to persist data
# across container restarts and updates.
VOLUME ["/data"]

# Tell the bot where to store the database
ENV DB_PATH=/data/haven-bot.db
ENV NODE_ENV=production

# Callback server port (must match CALLBACK_URL in .env)
EXPOSE 3000

# Health check — verifies the process is still running
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" || exit 1

CMD ["node", "src/index.js"]
