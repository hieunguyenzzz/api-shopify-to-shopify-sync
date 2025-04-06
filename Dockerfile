FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (needed for build)
COPY package*.json ./
# npm ci will automatically run the 'prepare' script (generate:shopify-types)
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build TypeScript code
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files and install ONLY production dependencies, ignoring scripts
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist
# REMOVED: Copying node_modules from builder is unnecessary and includes devDeps
# COPY --from=builder /app/node_modules ./node_modules

# Copy .env file if it exists (You might want to handle this differently in production)
# COPY .env .env

# Expose the application port (adjust if your app uses a different port)
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/index.js"] 