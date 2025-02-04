FROM node:18-alpine AS builder

# Install only the necessary build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev

WORKDIR /app

# Install dependencies - split this to leverage Docker cache
COPY package*.json ./

# Use npm install with modern flags to speed up installation
RUN npm ci --omit=dev --omit=optional --no-audit

# Copy source
COPY . .

# Production stage
FROM node:18-alpine

# Install only the runtime dependencies needed for canvas
RUN apk add --no-cache \
    cairo \
    pango \
    jpeg \
    giflib

WORKDIR /app

# Copy only the necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js .
COPY --from=builder /app/package.json .

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
CMD ["node", "server.js"]
