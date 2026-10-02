# ─── Kratos Dashboard — Northflank / Production Dockerfile ─────────────────────
# Node 22 Alpine: smallest & fastest, matches discord.js v14 + mongoose 9 reqs
FROM node:22-alpine

# Use a non-root user for security (best practice on PaaS)
WORKDIR /app

# ─── 1) Install production deps (cached layer) ───────────────────────────
# Copy only manifests first so `npm ci` layer is cached unless deps change
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ─── 2) Copy application source ───────────────────────────────────────────
COPY src ./src

# ─── 3) Runtime config ────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=10000
# Northflank/Render inject $PORT automatically; we default to 10000

EXPOSE 10000

# Start via node directly (no npm wrapper = faster boot, cleaner signals)
CMD ["node", "src/index.js"]
