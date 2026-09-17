# Production Dockerfile for Asset Console
FROM node:20-alpine

# Install build dependencies for native modules (sharp, better-sqlite3)
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

# Install package dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node /app

# Switch to non-root user
USER node

# Environment defaults
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=assets.db \
    UPLOADS_DIR=uploads

EXPOSE 8080

CMD ["node", "server.js"]
