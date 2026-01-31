# Use Debian-slim base for better native module support (sharp)
FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Install build deps if you need to compile native modules (uncomment if required)
# RUN apt-get update && apt-get install -y build-essential libvips-dev ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
# Build Next.js (or other build steps)
RUN npm run build

# Remove devDependencies to shrink image
RUN npm prune --production

# --- final image ---
FROM node:20-bullseye-slim AS release
WORKDIR /app
ENV NODE_ENV=production

# Install tini for proper signal handling, and pm2-runtime to run multiple processes
RUN apt-get update && apt-get install -y ca-certificates curl --no-install-recommends && rm -rf /var/lib/apt/lists/*
# Install pm2-runtime globally
RUN npm install -g pm2@5

# If you need sharp runtime libs, uncomment:
# RUN apt-get update && apt-get install -y libvips42 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

# Create a non-root user (optional, safer)
RUN groupadd -r app && useradd --no-log-init -r -g app app && chown -R app:app /app
USER app

EXPOSE 3000   # Next.js default
EXPOSE 15500  # upload server per README

# Use pm2-runtime to run both Next and the upload server in production.
# pm2-runtime will keep both processes supervised and forward logs.
CMD ["pm2-runtime", "ecosystem.config.js", "--env", "production"]