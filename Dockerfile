# Build stage
FROM node:18-alpine AS builder

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Production stage
FROM node:18-alpine

# Install only required system dependencies
RUN apk add --no-cache \
    fontconfig \
    freetype \
    freetype-dev \
    g++ \
    jpeg-dev \
    libpng-dev \
    make \
    python3

# Create app directory
WORKDIR /app

# Copy built node modules and source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Create uploads directory
RUN mkdir -p uploads && \
    # Set proper permissions
    chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000

# Start the server
CMD ["node", "server.js"]
