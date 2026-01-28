# Build stage
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

# Production stage
FROM node:20-alpine

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/*.js ./
COPY --from=build /app/package.json ./
COPY --from=build /app/avatars ./avatars
COPY --from=build /app/images ./images

# Create necessary directories and set permissions
RUN mkdir -p logs data && chmod 777 logs data

# Environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD pgrep node || exit 1

EXPOSE 1337

CMD ["node", "index.js"]
